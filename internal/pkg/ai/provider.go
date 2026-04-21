package ai

import (
	"context"
	"strings"
)

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

// AIErrorCode AI 平台错误分类
const (
	AIErrorCodeUnknown          = "unknown"
	AIErrorCodeContextExceeded  = "context_exceeded"
	AIErrorCodeRateLimited      = "rate_limited"
	AIErrorCodeTimeout          = "timeout"
	AIErrorCodeConnectionFailed = "connection_failed"
	AIErrorCodeAuthFailed       = "auth_failed"
)

// AIPlatformError AI 平台可识别错误
type AIPlatformError struct {
	Code    string
	Message string
}

func (e *AIPlatformError) Error() string {
	return e.Message
}

// classifyAIError 根据 AI 平台原始错误字符串分类错误码
func classifyAIError(errMsg string) *AIPlatformError {
	lower := strings.ToLower(errMsg)
	switch {
	case containsAny(lower, []string{
		"context length exceeded", "context_length_exceeded",
		"maximum context length", "max context length",
		"tokens exceeded", "token limit exceeded", "too many tokens",
		"exceeds maximum context length", "input length exceeded",
		"prompt is too long", "message too long",
	}):
		return &AIPlatformError{Code: AIErrorCodeContextExceeded, Message: errMsg}
	case containsAny(lower, []string{
		"rate limit", "rate_limit", "too many requests",
		"quota exceeded", "throttled", "capacity exceeded",
	}):
		return &AIPlatformError{Code: AIErrorCodeRateLimited, Message: errMsg}
	case containsAny(lower, []string{
		"timeout", "deadline exceeded", "i/o timeout",
		"request timeout", "context deadline exceeded",
	}):
		return &AIPlatformError{Code: AIErrorCodeTimeout, Message: errMsg}
	case containsAny(lower, []string{
		"connection refused", "no such host", "connection reset",
		"network is unreachable", "dial tcp", "broken pipe",
	}):
		return &AIPlatformError{Code: AIErrorCodeConnectionFailed, Message: errMsg}
	case containsAny(lower, []string{
		"unauthorized", "authentication", "invalid api key",
		"api key", "auth failed", "permission denied",
	}):
		return &AIPlatformError{Code: AIErrorCodeAuthFailed, Message: errMsg}
	default:
		return &AIPlatformError{Code: AIErrorCodeUnknown, Message: errMsg}
	}
}

func containsAny(s string, subs []string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// StreamResponse 流式响应回调
type StreamResponse struct {
	Content   string     `json:"content"`
	Done      bool       `json:"done"`
	Error     string     `json:"error,omitempty"`
	ErrorCode string     `json:"error_code,omitempty"`
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
