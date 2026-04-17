package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// SettingHandler 系统设置 Handler
type SettingHandler struct {
	settingService *service.SettingService
}

// NewSettingHandler 创建设置 Handler
func NewSettingHandler(settingService *service.SettingService) *SettingHandler {
	return &SettingHandler{settingService: settingService}
}

// GetSiteConfig 获取站点配置
func (h *SettingHandler) GetSiteConfig(c *gin.Context) {
	cfg, err := h.settingService.GetSiteConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": cfg})
}

// UpdateSiteConfig 更新站点配置
func (h *SettingHandler) UpdateSiteConfig(c *gin.Context) {
	var req service.SiteConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := h.settingService.SaveSiteConfig(&req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": req})
}

// UploadLogo 上传 Logo
func (h *SettingHandler) UploadLogo(c *gin.Context) {
	file, err := c.FormFile("logo")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "请选择要上传的文件"})
		return
	}

	// 只允许图片
	ext := filepath.Ext(file.Filename)
	if ext != ".png" && ext != ".jpg" && ext != ".jpeg" && ext != ".gif" && ext != ".svg" && ext != ".webp" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "仅支持 png/jpg/jpeg/gif/svg/webp 格式的图片"})
		return
	}

	// 确保上传目录存在
	uploadDir := "uploads"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "创建上传目录失败"})
		return
	}

	// 生成唯一文件名
	filename := fmt.Sprintf("logo_%d%s", time.Now().Unix(), ext)
	dst := filepath.Join(uploadDir, filename)

	if err := c.SaveUploadedFile(file, dst); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "保存文件失败"})
		return
	}

	logoURL := "/uploads/" + filename
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"logo_url": logoURL}})
}
