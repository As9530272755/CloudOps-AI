package model

import "time"

// AIPlatform AI 平台配置（支持多平台资源池）
type AIPlatform struct {
	ID            string     `gorm:"primaryKey;size:32" json:"id"`
	Name          string     `gorm:"size:128;not null" json:"name"`
	ProviderType  string     `gorm:"size:32;not null" json:"provider_type"`
	ConfigJSON    string     `gorm:"type:text" json:"config_json"`
	Status        string     `gorm:"size:32;default:'unknown'" json:"status"`
	IsDefault     bool       `gorm:"default:false" json:"is_default"`
	LastCheckedAt *time.Time `json:"last_checked_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	CreatedBy     uint       `gorm:"index" json:"created_by"`
}

// TableName 指定表名
func (AIPlatform) TableName() string {
	return "ai_platforms"
}
