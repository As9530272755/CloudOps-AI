package handlers

import (
	"net/http"
	"strconv"

	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// AIChatSessionHandler AI 会话管理 Handler
type AIChatSessionHandler struct {
	svc *service.AIChatSessionService
}

// NewAIChatSessionHandler 创建 Handler
func NewAIChatSessionHandler(svc *service.AIChatSessionService) *AIChatSessionHandler {
	return &AIChatSessionHandler{svc: svc}
}

func (h *AIChatSessionHandler) getUserID(c *gin.Context) uint {
	if uid, exists := c.Get("user_id"); exists {
		return uid.(uint)
	}
	return 0
}

func (h *AIChatSessionHandler) checkSessionOwner(c *gin.Context, sessionID string) bool {
	userID := h.getUserID(c)
	if userID == 0 {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "未登录"})
		return false
	}
	session, err := h.svc.GetSession(sessionID)
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

// ListSessions 列出当前用户的会话
func (h *AIChatSessionHandler) ListSessions(c *gin.Context) {
	userID := uint(0)
	if uid, exists := c.Get("user_id"); exists {
		userID = uid.(uint)
	}
	sessions, err := h.svc.ListSessions(userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": sessions})
}

// CreateSession 创建会话
func (h *AIChatSessionHandler) CreateSession(c *gin.Context) {
	var req struct {
		PlatformID string `json:"platform_id" binding:"required"`
		Title      string `json:"title"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	userID := uint(0)
	if uid, exists := c.Get("user_id"); exists {
		userID = uid.(uint)
	}

	session, err := h.svc.CreateSession(userID, req.PlatformID, req.Title)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": session})
}

// GetSessionMessages 获取会话消息历史
func (h *AIChatSessionHandler) GetSessionMessages(c *gin.Context) {
	id := c.Param("id")
	if !h.checkSessionOwner(c, id) {
		return
	}
	limit := 0 // 0 表示不限制
	if l := c.Query("limit"); l != "" {
		// 简单解析，失败则保持 0
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	msgs, err := h.svc.GetSessionMessages(id, limit)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": msgs})
}

// DeleteSession 删除会话
func (h *AIChatSessionHandler) DeleteSession(c *gin.Context) {
	id := c.Param("id")
	if !h.checkSessionOwner(c, id) {
		return
	}
	if err := h.svc.DeleteSession(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// UpdateSessionPlatform 更新会话绑定的 AI 平台
func (h *AIChatSessionHandler) UpdateSessionPlatform(c *gin.Context) {
	id := c.Param("id")
	if !h.checkSessionOwner(c, id) {
		return
	}
	var req struct {
		PlatformID string `json:"platform_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if err := h.svc.UpdateSessionPlatform(id, req.PlatformID); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// UpdateSessionTitle 更新会话标题
func (h *AIChatSessionHandler) UpdateSessionTitle(c *gin.Context) {
	id := c.Param("id")
	if !h.checkSessionOwner(c, id) {
		return
	}
	var req struct {
		Title string `json:"title" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if err := h.svc.UpdateTitle(id, req.Title); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ClearSessionMessages 清空会话消息
func (h *AIChatSessionHandler) ClearSessionMessages(c *gin.Context) {
	id := c.Param("id")
	if !h.checkSessionOwner(c, id) {
		return
	}
	if err := h.svc.ClearSessionMessages(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
