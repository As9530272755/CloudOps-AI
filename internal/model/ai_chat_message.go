package model

import "time"

// AIChatMessage AI 聊天消息
type AIChatMessage struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	SessionID string    `gorm:"index;size:32;not null" json:"session_id"`
	Role      string    `gorm:"size:20;not null" json:"role"`
	Content   string    `gorm:"type:text" json:"content"`
	Images    string    `gorm:"type:text" json:"images,omitempty"`
	Timestamp int64     `json:"timestamp"`
	CreatedAt time.Time `json:"created_at"`
}

// TableName 指定表名
func (AIChatMessage) TableName() string {
	return "ai_chat_messages"
}
