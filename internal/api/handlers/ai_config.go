package handlers

import (
	"net/http"

	"github.com/cloudops/platform/internal/pkg/ai"
	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// AIConfigHandler AI 平台配置 Handler
type AIConfigHandler struct {
	svc *service.AIConfigService
}

// NewAIConfigHandler 创建 Handler
func NewAIConfigHandler(svc *service.AIConfigService) *AIConfigHandler {
	return &AIConfigHandler{svc: svc}
}

// GetConfig 获取 AI 平台配置
func (h *AIConfigHandler) GetConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": h.svc.GetConfig()})
}

// UpdateConfig 更新 AI 平台配置
func (h *AIConfigHandler) UpdateConfig(c *gin.Context) {
	var req ai.PlatformConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if err := h.svc.UpdateConfig(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": h.svc.GetConfig()})
}

// TestConnection 测试 AI 平台连通性
func (h *AIConfigHandler) TestConnection(c *gin.Context) {
	if err := h.svc.TestConnection(); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "AI 平台连接成功"})
}
