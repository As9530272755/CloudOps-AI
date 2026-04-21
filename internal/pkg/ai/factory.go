package ai

import (
	"fmt"
	"time"
)

// PlatformConfig AI 平台运行时配置
type PlatformConfig struct {
	Provider string           `json:"provider"`
	OpenClaw OpenClawDetail   `json:"openclaw"`
	Ollama   OllamaDetail     `json:"ollama"`
	Hermes   HermesDetail     `json:"hermes"`
}

// OpenClawDetail OpenClaw 配置细节
type OpenClawDetail struct {
	URL                string `json:"url"`
	Token              string `json:"token"`
	Model              string `json:"model"`
	Timeout            int    `json:"timeout"`             // 秒，默认 300
	MaxHistoryMessages int    `json:"max_history_messages"` // 默认 10
}

// OllamaDetail Ollama 配置细节
type OllamaDetail struct {
	URL                string `json:"url"`
	Model              string `json:"model"`
	Timeout            int    `json:"timeout"`             // 秒，默认 600
	MaxContextLength   int    `json:"max_context_length"`   // 默认 4096
	MaxHistoryMessages int    `json:"max_history_messages"` // 默认 10
}

// ProviderInfo 支持的 AI Provider 元信息
type ProviderInfo struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// SupportedProviders 返回所有支持的 Provider 类型列表
func SupportedProviders() []ProviderInfo {
	return []ProviderInfo{
		{Type: "openclaw", Name: "OpenClaw", Description: "OpenClaw / OpenAI 兼容 API"},
		{Type: "openai", Name: "Hermes", Description: "Hermes Agent / OpenAI 兼容 API（支持 Session 绑定）"},
		{Type: "ollama", Name: "Ollama", Description: "本地 Ollama 服务"},
	}
}

// NewProvider 根据配置创建对应 Provider
func NewProvider(cfg PlatformConfig, timeout time.Duration) (Provider, error) {
	switch cfg.Provider {
	case "ollama":
		return NewOllamaProvider(cfg.Ollama.URL, cfg.Ollama.Model, timeout, cfg.Ollama.MaxContextLength, cfg.Ollama.MaxHistoryMessages), nil
	case "openclaw":
		return NewOpenClawProvider(cfg.OpenClaw.URL, cfg.OpenClaw.Token, cfg.OpenClaw.Model, timeout, cfg.OpenClaw.MaxHistoryMessages), nil
	case "openai":
		return NewHermesProvider(cfg.Hermes.URL, cfg.Hermes.Token, cfg.Hermes.Model, timeout, cfg.Hermes.MaxHistoryMessages), nil
	default:
		return nil, fmt.Errorf("不支持的 AI Provider: %s", cfg.Provider)
	}
}
