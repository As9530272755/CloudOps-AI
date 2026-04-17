package service

import (
	"encoding/json"
	"fmt"

	"github.com/cloudops/platform/internal/model"
	"gorm.io/gorm"
)

// SiteConfig 站点配置
type SiteConfig struct {
	PlatformName        string `json:"platform_name"`
	PlatformDescription string `json:"platform_description"`
	LogoURL             string `json:"logo_url"`
}

const siteConfigKey = "site_config"

// SettingService 系统设置服务
type SettingService struct {
	db *gorm.DB
}

// NewSettingService 创建设置服务
func NewSettingService(db *gorm.DB) *SettingService {
	return &SettingService{db: db}
}

// GetSiteConfig 获取站点配置
func (s *SettingService) GetSiteConfig() (*SiteConfig, error) {
	var setting model.SystemSetting
	if err := s.db.Where(map[string]interface{}{"key": siteConfigKey}).First(&setting).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return &SiteConfig{
				PlatformName:        "CloudOps",
				PlatformDescription: "云原生运维管理平台",
				LogoURL:             "",
			}, nil
		}
		return nil, err
	}

	var cfg SiteConfig
	if err := json.Unmarshal([]byte(setting.Value), &cfg); err != nil {
		return nil, fmt.Errorf("解析站点配置失败: %w", err)
	}
	return &cfg, nil
}

// SaveSiteConfig 保存站点配置
func (s *SettingService) SaveSiteConfig(cfg *SiteConfig) error {
	data, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("序列化站点配置失败: %w", err)
	}

	setting := model.SystemSetting{
		Key:   siteConfigKey,
		Value: string(data),
	}

	return s.db.Save(&setting).Error
}
