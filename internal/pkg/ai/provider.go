package ai

import "context"

// Message LLM 消息结构
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Provider AI 平台统一接口
type Provider interface {
	Name() string
	ChatCompletion(ctx context.Context, messages []Message) (string, error)
	HealthCheck(ctx context.Context) error
}
