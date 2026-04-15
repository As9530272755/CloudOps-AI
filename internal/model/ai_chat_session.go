package model

import "time"

// AIChatSession AI 聊天会话
type AIChatSession struct {
	ID         string    `gorm:"primaryKey;size:32" json:"id"`
	UserID     uint      `gorm:"index;not null" json:"user_id"`
	PlatformID string    `gorm:"size:32;not null" json:"platform_id"`
	Title      string    `gorm:"size:128" json:"title"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// TableName 指定表名
func (AIChatSession) TableName() string {
	return "ai_chat_sessions"
}
