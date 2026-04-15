package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/cloudops/platform/internal/pkg/ai"
	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// AIConfigHandler AI 平台配置 Handler（兼容旧接口，底层代理到默认平台）
type AIConfigHandler struct {
	svc         *service.AIConfigService
	platformSvc *service.AIPlatformService
}

// NewAIConfigHandler 创建 Handler
func NewAIConfigHandler(svc *service.AIConfigService, platformSvc *service.AIPlatformService) *AIConfigHandler {
	return &AIConfigHandler{svc: svc, platformSvc: platformSvc}
}

// GetConfig 获取默认 AI 平台配置（兼容旧版单平台接口）
func (h *AIConfigHandler) GetConfig(c *gin.Context) {
	p, err := h.platformSvc.GetDefaultPlatform()
	if err != nil {
		// 无默认平台时回退到旧配置
		c.JSON(http.StatusOK, gin.H{"success": true, "data": h.svc.GetConfig()})
		return
	}

	decrypted, err := h.platformSvc.DecryptConfig(p.ConfigJSON)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": h.svc.GetConfig()})
		return
	}

	cfg := ai.PlatformConfig{Provider: p.ProviderType}
	switch p.ProviderType {
	case "ollama":
		var detail ai.OllamaDetail
		_ = json.Unmarshal([]byte(decrypted), &detail)
		cfg.Ollama = detail
	case "openclaw", "openai":
		var detail ai.OpenClawDetail
		_ = json.Unmarshal([]byte(decrypted), &detail)
		cfg.OpenClaw = detail
	}

	// 脱敏 token
	if cfg.OpenClaw.Token != "" {
		cfg.OpenClaw.Token = maskToken(cfg.OpenClaw.Token)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": cfg})
}

// UpdateConfig 更新默认 AI 平台配置（兼容旧版）
func (h *AIConfigHandler) UpdateConfig(c *gin.Context) {
	var req ai.PlatformConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	p, err := h.platformSvc.GetDefaultPlatform()
	if err != nil {
		// 无默认平台时回退到旧文件存储
		if err := h.svc.UpdateConfig(req); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": h.svc.GetConfig()})
		return
	}

	var formCfg service.PlatformFormConfig
	switch req.Provider {
	case "ollama":
		formCfg = service.PlatformFormConfig{
			URL:     req.Ollama.URL,
			Model:   req.Ollama.Model,
			Timeout: req.Ollama.Timeout,
		}
	case "openclaw", "openai":
		formCfg = service.PlatformFormConfig{
			URL:     req.OpenClaw.URL,
			Token:   req.OpenClaw.Token,
			Model:   req.OpenClaw.Model,
			Timeout: req.OpenClaw.Timeout,
		}
	}

	if err := h.platformSvc.UpdatePlatform(p.ID, p.Name, formCfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// TestConnection 测试默认 AI 平台连通性
func (h *AIConfigHandler) TestConnection(c *gin.Context) {
	p, err := h.platformSvc.GetDefaultPlatform()
	if err != nil {
		if err := h.svc.TestConnection(); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "AI 平台连接成功"})
		return
	}
	if err := h.platformSvc.TestConnection(p.ID); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "AI 平台连接成功"})
}

// GetModels 获取默认 AI 平台可用模型列表
func (h *AIConfigHandler) GetModels(c *gin.Context) {
	p, err := h.platformSvc.GetDefaultPlatform()
	if err != nil {
		models, err := h.svc.ListModels()
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": models})
		return
	}

	provider, err := h.platformSvc.NewProviderByID(p.ID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	models, err := provider.ListModels(ctx)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": models})
}

func maskToken(token string) string {
	if len(token) <= 8 {
		return "****"
	}
	return token[:4] + "****" + token[len(token)-4:]
}
