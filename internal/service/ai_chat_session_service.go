package service

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/ai"
	"gorm.io/gorm"
)

// AIChatSessionService AI 聊天会话服务
type AIChatSessionService struct {
	db *gorm.DB
}

// NewAIChatSessionService 创建会话服务
func NewAIChatSessionService(db *gorm.DB) *AIChatSessionService {
	return &AIChatSessionService{db: db}
}

// ListSessions 列出用户的所有会话（按更新时间倒序）
func (s *AIChatSessionService) ListSessions(userID uint) ([]model.AIChatSession, error) {
	var sessions []model.AIChatSession
	if err := s.db.Where("user_id = ?", userID).Order("updated_at desc").Find(&sessions).Error; err != nil {
		return nil, err
	}
	return sessions, nil
}

// CreateSession 创建新会话
func (s *AIChatSessionService) CreateSession(userID uint, platformID string, title string) (*model.AIChatSession, error) {
	session := model.AIChatSession{
		ID:         generateSessionID(),
		UserID:     userID,
		PlatformID: platformID,
		Title:      title,
	}
	if err := s.db.Create(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

// GetSession 获取会话基本信息
func (s *AIChatSessionService) GetSession(sessionID string) (*model.AIChatSession, error) {
	var session model.AIChatSession
	if err := s.db.Where("id = ?", sessionID).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

// GetSessionMessages 获取会话消息历史
func (s *AIChatSessionService) GetSessionMessages(sessionID string, limit int) ([]ai.Message, error) {
	var msgs []model.AIChatMessage
	query := s.db.Where("session_id = ?", sessionID).Order("timestamp asc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&msgs).Error; err != nil {
		return nil, err
	}

	result := make([]ai.Message, 0, len(msgs))
	for _, m := range msgs {
		msg := ai.Message{
			Role:    m.Role,
			Content: m.Content,
		}
		if m.Images != "" {
			_ = json.Unmarshal([]byte(m.Images), &msg.Images)
		}
		result = append(result, msg)
	}
	return result, nil
}

// SaveMessage 保存单条消息
func (s *AIChatSessionService) SaveMessage(sessionID string, msg ai.Message) error {
	imagesJSON := ""
	if len(msg.Images) > 0 {
		b, _ := json.Marshal(msg.Images)
		imagesJSON = string(b)
	}

	m := model.AIChatMessage{
		SessionID: sessionID,
		Role:      msg.Role,
		Content:   msg.Content,
		Images:    imagesJSON,
		Timestamp: time.Now().UnixMilli(),
	}
	if err := s.db.Create(&m).Error; err != nil {
		return err
	}

	// 更新会话 updated_at
	return s.db.Model(&model.AIChatSession{}).Where("id = ?", sessionID).Update("updated_at", time.Now()).Error
}

// UpdateTitle 更新会话标题
func (s *AIChatSessionService) UpdateTitle(sessionID string, title string) error {
	return s.db.Model(&model.AIChatSession{}).Where("id = ?", sessionID).Update("title", title).Error
}

// UpdateSessionPlatform 更新会话绑定的 AI 平台
func (s *AIChatSessionService) UpdateSessionPlatform(sessionID string, platformID string) error {
	return s.db.Model(&model.AIChatSession{}).Where("id = ?", sessionID).Update("platform_id", platformID).Error
}

// ClearSessionMessages 清空会话消息（保留会话本身）
func (s *AIChatSessionService) ClearSessionMessages(sessionID string) error {
	return s.db.Where("session_id = ?", sessionID).Delete(&model.AIChatMessage{}).Error
}

// DeleteSession 删除会话及其消息
func (s *AIChatSessionService) DeleteSession(sessionID string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("session_id = ?", sessionID).Delete(&model.AIChatMessage{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", sessionID).Delete(&model.AIChatSession{}).Error
	})
}

// GetMessageCount 获取会话消息数（不含 system）
func (s *AIChatSessionService) GetMessageCount(sessionID string) (int64, error) {
	var count int64
	err := s.db.Model(&model.AIChatMessage{}).Where("session_id = ? AND role != ?", sessionID, "system").Count(&count).Error
	return count, err
}

func generateSessionID() string {
	return fmt.Sprintf("sess_%d", time.Now().UnixNano())
}
