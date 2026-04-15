package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/cloudops/platform/internal/pkg/ai"
	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// AIChatHandler AI 对话 Handler
type AIChatHandler struct {
	svc         *service.AIService
	taskService *service.AITaskService
	sessionSvc  *service.AIChatSessionService
}

func (h *AIChatHandler) getUserID(c *gin.Context) uint {
	if uid, exists := c.Get("user_id"); exists {
		return uid.(uint)
	}
	return 0
}

func (h *AIChatHandler) checkSessionOwner(c *gin.Context, sessionID string) bool {
	if sessionID == "" {
		return true
	}
	userID := h.getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "未登录"})
		return false
	}
	session, err := h.sessionSvc.GetSession(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "会话不存在"})
		return false
	}
	if session.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "无权访问该会话"})
		return false
	}
	return true
}

// NewAIChatHandler 创建 Handler
func NewAIChatHandler(svc *service.AIService, taskSvc *service.AITaskService, sessionSvc *service.AIChatSessionService) *AIChatHandler {
	return &AIChatHandler{
		svc:         svc,
		taskService: taskSvc,
		sessionSvc:  sessionSvc,
	}
}

// ChatRequest AI 对话请求
type ChatRequest struct {
	Messages   []ai.Message `json:"messages" binding:"required,min=1"`
	SessionID  string       `json:"session_id,omitempty"`
	PlatformID string       `json:"platform_id,omitempty"`
}

// Chat 非流式 AI 对话
func (h *AIChatHandler) Chat(c *gin.Context) {
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if !h.checkSessionOwner(c, req.SessionID) {
		return
	}

	reply, err := h.svc.GeneralChatWithPlatformSession(c.Request.Context(), req.PlatformID, req.SessionID, req.Messages)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"content": reply}})
}

// ChatStream 流式 AI 对话 (SSE)
func (h *AIChatHandler) ChatStream(c *gin.Context) {
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if !h.checkSessionOwner(c, req.SessionID) {
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)

	var mu sync.Mutex
	flush := func() {
		if f, ok := c.Writer.(http.Flusher); ok {
			f.Flush()
		}
	}

	// 定期发送空白心跳，防止浏览器/代理因长时间无数据而断开连接
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				mu.Lock()
				b, _ := json.Marshal(ai.StreamResponse{Content: "", Done: false})
				fmt.Fprintf(c.Writer, "data: %s\n\n", b)
				flush()
				mu.Unlock()
			case <-done:
				return
			}
		}
	}()

	err := h.svc.GeneralChatStreamWithPlatformSession(c.Request.Context(), req.PlatformID, req.SessionID, req.Messages, func(chunk ai.StreamResponse) {
		mu.Lock()
		b, _ := json.Marshal(chunk)
		fmt.Fprintf(c.Writer, "data: %s\n\n", b)
		flush()
		mu.Unlock()
	})
	close(done)

	if err != nil {
		mu.Lock()
		fmt.Fprintf(c.Writer, "data: {\"error\":%q}\n\n", err.Error())
		flush()
		mu.Unlock()
		fmt.Fprintf(c.Writer, "data: [DONE]\n\n")
		flush()
		return
	}

	// 发送结束标记
	mu.Lock()
	b, _ := json.Marshal(ai.StreamResponse{Done: true})
	fmt.Fprintf(c.Writer, "data: %s\n\n", b)
	flush()
	mu.Unlock()
}

// CreateTask 创建异步 AI 任务
func (h *AIChatHandler) CreateTask(c *gin.Context) {
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	userID := uint(0)
	if uid, exists := c.Get("user_id"); exists {
		userID = uid.(uint)
	}

	task, err := h.taskService.CreateTask(userID, req.SessionID, req.Messages)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"task_id": task.ID,
			"status":  task.Status,
		},
	})
}

// GetTask 轮询获取任务状态
func (h *AIChatHandler) GetTask(c *gin.Context) {
	taskID := c.Param("id")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "task_id 不能为空"})
		return
	}

	status, err := h.taskService.GetTask(taskID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    status,
	})
}
