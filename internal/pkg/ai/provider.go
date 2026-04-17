package ai

import "context"

// Message LLM 消息结构
type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content"`
	Images     []string   `json:"images,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// ToolCall 模型发出的工具调用
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// Tool 可供模型调用的工具定义
type Tool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string      `json:"name"`
		Description string      `json:"description"`
		Parameters  interface{} `json:"parameters"`
	} `json:"function"`
}

// CompletionResult ChatCompletion 的完整结果
type CompletionResult struct {
	Content   string
	ToolCalls []ToolCall
}

// StreamResponse 流式响应回调
type StreamResponse struct {
	Content   string     `json:"content"`
	Done      bool       `json:"done"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// Provider AI 平台统一接口
type Provider interface {
	Name() string
	ChatCompletion(ctx context.Context, messages []Message, tools []Tool) (*CompletionResult, error)
	ChatCompletionStream(ctx context.Context, messages []Message, tools []Tool, onChunk func(StreamResponse)) error
	ListModels(ctx context.Context) ([]string, error)
	HealthCheck(ctx context.Context) error
	SetSessionID(id string)
	MaxHistoryMessages() int
}
