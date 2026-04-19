package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/ai"
	"gorm.io/gorm"
)

// PlatformFormConfig 前端提交的通用平台配置表单
type PlatformFormConfig struct {
	URL                string `json:"url"`
	Token              string `json:"token"`
	Model              string `json:"model"`
	Timeout            int    `json:"timeout"`
	MaxContextLength   int    `json:"max_context_length"`
	MaxHistoryMessages int    `json:"max_history_messages"`
}

// AIPlatformService AI 平台管理服务（支持多平台资源池）
type AIPlatformService struct {
	db *gorm.DB
}

// NewAIPlatformService 创建 AI 平台服务
func NewAIPlatformService(db *gorm.DB) *AIPlatformService {
	return &AIPlatformService{
		db: db,
	}
}

// StartHealthMonitor 启动 AI 平台健康检查（每 30 秒一次）
func (s *AIPlatformService) StartHealthMonitor() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			var list []model.AIPlatform
			if err := s.db.Find(&list).Error; err != nil {
				continue
			}
			for _, p := range list {
				_ = s.TestConnection(p.ID)
			}
		}
	}()
}

// GetSupportedProviders 获取支持的 AI Provider 类型列表
func (s *AIPlatformService) GetSupportedProviders() []ai.ProviderInfo {
	return ai.SupportedProviders()
}

// ListPlatforms 列出所有平台（按默认优先、创建时间倒序）
func (s *AIPlatformService) ListPlatforms() ([]model.AIPlatform, error) {
	var platforms []model.AIPlatform
	if err := s.db.Order("is_default desc, created_at desc").Find(&platforms).Error; err != nil {
		return nil, err
	}
	return platforms, nil
}

// GetPlatform 根据 ID 获取平台
func (s *AIPlatformService) GetPlatform(id string) (*model.AIPlatform, error) {
	var p model.AIPlatform
	if err := s.db.Where("id = ?", id).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// CreatePlatform 创建平台
func (s *AIPlatformService) CreatePlatform(userID uint, name, providerType string, cfg PlatformFormConfig) (*model.AIPlatform, error) {
	cfgJSON, err := s.buildConfigJSON(providerType, cfg)
	if err != nil {
		return nil, fmt.Errorf("构建配置失败: %w", err)
	}

	p := model.AIPlatform{
		ID:           generatePlatformID(),
		Name:         name,
		ProviderType: providerType,
		ConfigJSON:   cfgJSON,
		Status:       "unknown",
		IsDefault:    false,
		CreatedBy:    userID,
	}

	// 如果是第一个平台，自动设为默认
	var count int64
	if err := s.db.Model(&model.AIPlatform{}).Count(&count).Error; err == nil && count == 0 {
		p.IsDefault = true
	}

	if err := s.db.Create(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// UpdatePlatform 更新平台
func (s *AIPlatformService) UpdatePlatform(id string, name string, cfg PlatformFormConfig) error {
	var p model.AIPlatform
	if err := s.db.Where("id = ?", id).First(&p).Error; err != nil {
		return err
	}

	cfgJSON, err := s.buildConfigJSON(p.ProviderType, cfg)
	if err != nil {
		return fmt.Errorf("构建配置失败: %w", err)
	}

	return s.db.Model(&p).Updates(map[string]interface{}{
		"name":        name,
		"config_json": cfgJSON,
	}).Error
}

// DeletePlatform 删除平台
func (s *AIPlatformService) DeletePlatform(id string) error {
	var p model.AIPlatform
	if err := s.db.Where("id = ?", id).First(&p).Error; err != nil {
		return err
	}
	if err := s.db.Delete(&p).Error; err != nil {
		return err
	}
	// 如果删的是默认平台，把最早的一个设为默认
	if p.IsDefault {
		var next model.AIPlatform
		if err := s.db.Order("created_at asc").First(&next).Error; err == nil {
			_ = s.db.Model(&next).Update("is_default", true)
		}
	}
	return nil
}

// SetDefaultPlatform 设置默认平台
func (s *AIPlatformService) SetDefaultPlatform(id string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.AIPlatform{}).Where("1=1").Update("is_default", false).Error; err != nil {
			return err
		}
		return tx.Model(&model.AIPlatform{}).Where("id = ?", id).Update("is_default", true).Error
	})
}

// TestConnection 测试平台连通性
func (s *AIPlatformService) TestConnection(id string) error {
	provider, err := s.NewProviderByID(id)
	if err != nil {
		return err
	}

	// 测试连接使用短超时，避免被聊天长超时拖垮
	testCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	status := "online"
	var hcErr error
	if hcErr = provider.HealthCheck(testCtx); hcErr != nil {
		status = "offline"
	}

	now := time.Now()
	_ = s.db.Model(&model.AIPlatform{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":          status,
		"last_checked_at": now,
	}).Error

	if status == "offline" {
		return fmt.Errorf("连接失败: %v", hcErr)
	}
	return nil
}

// NewProviderByID 根据平台 ID 动态创建 Provider 实例
func (s *AIPlatformService) NewProviderByID(id string) (ai.Provider, error) {
	p, err := s.GetPlatform(id)
	if err != nil {
		return nil, fmt.Errorf("平台不存在: %w", err)
	}

	var timeout time.Duration
	switch p.ProviderType {
	case "ollama":
		var detail ai.OllamaDetail
		if err := json.Unmarshal([]byte(p.ConfigJSON), &detail); err != nil {
			return nil, fmt.Errorf("解析配置失败: %w", err)
		}
		timeout = time.Duration(detail.Timeout) * time.Second
		if detail.Timeout <= 0 {
			timeout = 600 * time.Second
		}
		return ai.NewProvider(ai.PlatformConfig{
			Provider: "ollama",
			Ollama:   detail,
		}, timeout)
	case "openclaw", "openai":
		var detail ai.OpenClawDetail
		if err := json.Unmarshal([]byte(p.ConfigJSON), &detail); err != nil {
			return nil, fmt.Errorf("解析配置失败: %w", err)
		}
		timeout = time.Duration(detail.Timeout) * time.Second
		if detail.Timeout <= 0 {
			timeout = 300 * time.Second
		}
		return ai.NewProvider(ai.PlatformConfig{
			Provider: "openclaw",
			OpenClaw: detail,
		}, timeout)
	default:
		return nil, fmt.Errorf("不支持的 Provider 类型: %s", p.ProviderType)
	}
}

// DecryptConfig 直接返回配置字符串（已去掉加密）
func (s *AIPlatformService) DecryptConfig(configJSON string) (string, error) {
	return configJSON, nil
}

// GetDefaultPlatform 获取默认平台
func (s *AIPlatformService) GetDefaultPlatform() (*model.AIPlatform, error) {
	var p model.AIPlatform
	if err := s.db.Where("is_default = ?", true).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// 内部方法：根据 provider 类型构建配置 JSON
func normalizeURL(url string) string {
	url = strings.TrimSpace(url)
	if url != "" && !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = "http://" + url
	}
	return strings.TrimSuffix(url, "/")
}

func (s *AIPlatformService) buildConfigJSON(providerType string, cfg PlatformFormConfig) (string, error) {
	var cfgJSON []byte
	var err error

	cfg.URL = normalizeURL(cfg.URL)

	switch providerType {
	case "ollama":
		detail := ai.OllamaDetail{
			URL:                cfg.URL,
			Model:              cfg.Model,
			Timeout:            cfg.Timeout,
			MaxContextLength:   cfg.MaxContextLength,
			MaxHistoryMessages: cfg.MaxHistoryMessages,
		}
		cfgJSON, err = json.Marshal(detail)
	case "openclaw", "openai":
		detail := ai.OpenClawDetail{
			URL:                cfg.URL,
			Token:              cfg.Token,
			Model:              cfg.Model,
			Timeout:            cfg.Timeout,
			MaxHistoryMessages: cfg.MaxHistoryMessages,
		}
		cfgJSON, err = json.Marshal(detail)
	default:
		return "", fmt.Errorf("不支持的 provider 类型: %s", providerType)
	}

	if err != nil {
		return "", err
	}
	return string(cfgJSON), nil
}

func generatePlatformID() string {
	return fmt.Sprintf("plat_%d", time.Now().UnixNano())
}
