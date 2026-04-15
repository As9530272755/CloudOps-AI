package ai

import "context"

// Message LLM 消息结构
type Message struct {
	Role    string   `json:"role"`
	Content string   `json:"content"`
	Images  []string `json:"images,omitempty"`
}

// StreamResponse 流式响应回调
type StreamResponse struct {
	Content string `json:"content"`
	Done    bool   `json:"done"`
}

// Provider AI 平台统一接口
type Provider interface {
	Name() string
	ChatCompletion(ctx context.Context, messages []Message) (string, error)
	ChatCompletionStream(ctx context.Context, messages []Message, onChunk func(StreamResponse)) error
	ListModels(ctx context.Context) ([]string, error)
	HealthCheck(ctx context.Context) error
	SetSessionID(id string)
	MaxHistoryMessages() int
}
