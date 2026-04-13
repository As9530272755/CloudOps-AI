package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/cloudops/platform/internal/pkg/ai"
	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// AIChatHandler AI 对话 Handler
type AIChatHandler struct {
	svc         *service.AIService
	taskService *service.AITaskService
}

// NewAIChatHandler 创建 Handler
func NewAIChatHandler(svc *service.AIService, taskSvc *service.AITaskService) *AIChatHandler {
	return &AIChatHandler{
		svc:         svc,
		taskService: taskSvc,
	}
}

// ChatRequest AI 对话请求
type ChatRequest struct {
	Messages  []ai.Message `json:"messages" binding:"required,min=1"`
	SessionID string       `json:"session_id,omitempty"`
}

// Chat 非流式 AI 对话
func (h *AIChatHandler) Chat(c *gin.Context) {
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	reply, err := h.svc.GeneralChatWithSession(c.Request.Context(), req.SessionID, req.Messages)
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

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)

	flush := func() {
		if f, ok := c.Writer.(http.Flusher); ok {
			f.Flush()
		}
	}

	err := h.svc.GeneralChatStreamWithSession(c.Request.Context(), req.SessionID, req.Messages, func(chunk ai.StreamResponse) {
		b, _ := json.Marshal(chunk)
		fmt.Fprintf(c.Writer, "data: %s\n\n", b)
		flush()
	})

	if err != nil {
		b, _ := json.Marshal(ai.StreamResponse{Content: err.Error(), Done: true})
		fmt.Fprintf(c.Writer, "data: %s\n\n", b)
		flush()
		return
	}

	// 发送结束标记
	b, _ := json.Marshal(ai.StreamResponse{Done: true})
	fmt.Fprintf(c.Writer, "data: %s\n\n", b)
	flush()
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
