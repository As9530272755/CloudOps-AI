package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// AIPlatformHandler AI 平台管理 Handler
type AIPlatformHandler struct {
	svc *service.AIPlatformService
}

// NewAIPlatformHandler 创建 Handler
func NewAIPlatformHandler(svc *service.AIPlatformService) *AIPlatformHandler {
	return &AIPlatformHandler{svc: svc}
}

// ListPlatforms 列出所有平台
func (h *AIPlatformHandler) ListPlatforms(c *gin.Context) {
	platforms, err := h.svc.ListPlatforms()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": platforms})
}

// GetPlatform 获取单个平台（返回解密后的配置）
func (h *AIPlatformHandler) GetPlatform(c *gin.Context) {
	id := c.Param("id")
	p, err := h.svc.GetPlatform(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	decrypted, err := h.svc.DecryptConfig(p.ConfigJSON)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": p})
		return
	}

	var configMap map[string]interface{}
	_ = json.Unmarshal([]byte(decrypted), &configMap)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"id":            p.ID,
			"name":          p.Name,
			"provider_type": p.ProviderType,
			"status":        p.Status,
			"is_default":    p.IsDefault,
			"config":        configMap,
			"created_at":    p.CreatedAt,
			"updated_at":    p.UpdatedAt,
		},
	})
}

// CreatePlatform 创建平台
func (h *AIPlatformHandler) CreatePlatform(c *gin.Context) {
	var req struct {
		Name         string                       `json:"name" binding:"required"`
		ProviderType string                       `json:"provider_type" binding:"required"`
		Config       service.PlatformFormConfig   `json:"config" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	userID := uint(0)
	if uid, exists := c.Get("user_id"); exists {
		userID = uid.(uint)
	}

	p, err := h.svc.CreatePlatform(userID, req.Name, req.ProviderType, req.Config)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": p})
}

// UpdatePlatform 更新平台
func (h *AIPlatformHandler) UpdatePlatform(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Name   string                     `json:"name" binding:"required"`
		Config service.PlatformFormConfig `json:"config" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := h.svc.UpdatePlatform(id, req.Name, req.Config); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DeletePlatform 删除平台
func (h *AIPlatformHandler) DeletePlatform(c *gin.Context) {
	id := c.Param("id")
	if err := h.svc.DeletePlatform(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// TestPlatformConnection 测试平台连通性
func (h *AIPlatformHandler) TestPlatformConnection(c *gin.Context) {
	id := c.Param("id")
	if err := h.svc.TestConnection(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "连接成功"})
}

// SetDefaultPlatform 设置默认平台
func (h *AIPlatformHandler) SetDefaultPlatform(c *gin.Context) {
	id := c.Param("id")
	if err := h.svc.SetDefaultPlatform(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
