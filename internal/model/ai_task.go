package model

import "time"

// AITask AI 异步任务模型
type AITask struct {
	ID        string    `gorm:"primaryKey;size:32" json:"id"`
	UserID    uint      `gorm:"index" json:"user_id"`
	SessionID string    `gorm:"index;size:64" json:"session_id"`
	Status    string    `gorm:"size:20" json:"status"` // pending / running / completed / failed
	Result    string    `json:"result"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName 指定表名
func (AITask) TableName() string {
	return "ai_tasks"
}
