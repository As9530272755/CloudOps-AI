package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/ai"
	"github.com/cloudops/platform/internal/pkg/redis"
	redislib "github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// AITaskService AI 异步任务服务
type AITaskService struct {
	db        *gorm.DB
	rdb       *redislib.Client
	aiService *AIService
	memStore  sync.Map // Redis 不可用时做内存回退
}

// NewAITaskService 创建任务服务
func NewAITaskService(db *gorm.DB, rdb *redislib.Client, aiSvc *AIService) *AITaskService {
	return &AITaskService{
		db:        db,
		rdb:       rdb,
		aiService: aiSvc,
	}
}

// TaskStatus 任务状态
type TaskStatus struct {
	ID        string    `json:"id"`
	Status    string    `json:"status"`
	Result    string    `json:"result"`
	Error     string    `json:"error"`
	UpdatedAt time.Time `json:"updated_at"`
}

// CreateTask 创建任务并立即返回 taskId
func (s *AITaskService) CreateTask(userID uint, sessionID string, messages []ai.Message) (*model.AITask, error) {
	task := &model.AITask{
		ID:        generateTaskID(),
		UserID:    userID,
		SessionID: sessionID,
		Status:    "running",
		Result:    "",
		Error:     "",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// 先写入缓存
	if err := s.saveToCache(task); err != nil {
		return nil, err
	}

	// 再写入 PG
	if err := s.db.Create(task).Error; err != nil {
		return nil, err
	}

	// 后台 goroutine 执行 AI 调用
	go s.runTask(task.ID, sessionID, messages)

	return task, nil
}

// GetTask 获取任务状态（优先缓存，回源 PG）
func (s *AITaskService) GetTask(taskID string) (*TaskStatus, error) {
	// 先读缓存
	if ts := s.loadFromCache(taskID); ts != nil {
		return ts, nil
	}

	// 缓存 miss，查 PG
	var task model.AITask
	if err := s.db.First(&task, "id = ?", taskID).Error; err != nil {
		return nil, err
	}
	return &TaskStatus{
		ID:        task.ID,
		Status:    task.Status,
		Result:    task.Result,
		Error:     task.Error,
		UpdatedAt: task.UpdatedAt,
	}, nil
}

// runTask 在 goroutine 中调用 AI 流式接口
func (s *AITaskService) runTask(taskID, sessionID string, messages []ai.Message) {
	ctx := context.Background()

	var fullResult string
	err := s.aiService.GeneralChatStreamWithSession(ctx, sessionID, messages, func(chunk ai.StreamResponse) {
		if chunk.Content != "" {
			fullResult += chunk.Content
		}
		_ = s.updateCache(taskID, "running", fullResult, "")
	})

	status := "completed"
	errMsg := ""
	if err != nil {
		status = "failed"
		errMsg = err.Error()
	}

	// 更新缓存
	_ = s.updateCache(taskID, status, fullResult, errMsg)

	// 落盘到 PG
	s.db.Model(&model.AITask{}).Where("id = ?", taskID).Updates(map[string]interface{}{
		"status":     status,
		"result":     fullResult,
		"error":      errMsg,
		"updated_at": time.Now(),
	})
}

func (s *AITaskService) saveToCache(task *model.AITask) error {
	if s.rdb != nil {
		ctx := context.Background()
		key := redis.GetRedisKey(task.ID)
		if err := s.rdb.HMSet(ctx, key, map[string]interface{}{
			"status":     task.Status,
			"result":     task.Result,
			"error":      task.Error,
			"updated_at": task.UpdatedAt.Format(time.RFC3339),
		}).Err(); err != nil {
			return err
		}
		_ = s.rdb.Expire(ctx, key, time.Hour).Err()
		return nil
	}

	s.memStore.Store(task.ID, &TaskStatus{
		ID:        task.ID,
		Status:    task.Status,
		Result:    task.Result,
		Error:     task.Error,
		UpdatedAt: task.UpdatedAt,
	})
	return nil
}

func (s *AITaskService) updateCache(taskID, status, result, errMsg string) error {
	now := time.Now()
	if s.rdb != nil {
		ctx := context.Background()
		key := redis.GetRedisKey(taskID)
		if e := s.rdb.HMSet(ctx, key, map[string]interface{}{
			"status":     status,
			"result":     result,
			"error":      errMsg,
			"updated_at": now.Format(time.RFC3339),
		}).Err(); e != nil {
			return e
		}
		_ = s.rdb.Expire(ctx, key, time.Hour).Err()
		return nil
	}

	s.memStore.Store(taskID, &TaskStatus{
		ID:        taskID,
		Status:    status,
		Result:    result,
		Error:     errMsg,
		UpdatedAt: now,
	})
	return nil
}

func (s *AITaskService) loadFromCache(taskID string) *TaskStatus {
	if s.rdb != nil {
		ctx := context.Background()
		key := redis.GetRedisKey(taskID)
		data, err := s.rdb.HGetAll(ctx, key).Result()
		if err != nil || len(data) == 0 {
			return nil
		}
		ts, _ := time.Parse(time.RFC3339, data["updated_at"])
		return &TaskStatus{
			ID:        taskID,
			Status:    data["status"],
			Result:    data["result"],
			Error:     data["error"],
			UpdatedAt: ts,
		}
	}

	if val, ok := s.memStore.Load(taskID); ok {
		return val.(*TaskStatus)
	}
	return nil
}

func generateTaskID() string {
	return fmt.Sprintf("task-%d", time.Now().UnixNano())
}
