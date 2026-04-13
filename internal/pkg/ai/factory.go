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
}

// OpenClawDetail OpenClaw 配置细节
type OpenClawDetail struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	Model string `json:"model"`
}

// OllamaDetail Ollama 配置细节
type OllamaDetail struct {
	URL   string `json:"url"`
	Model string `json:"model"`
}

// NewProvider 根据配置创建对应 Provider
func NewProvider(cfg PlatformConfig, timeout time.Duration) (Provider, error) {
	switch cfg.Provider {
	case "ollama":
		return NewOllamaProvider(cfg.Ollama.URL, cfg.Ollama.Model, timeout), nil
	case "openclaw", "openai":
		return NewOpenClawProvider(cfg.OpenClaw.URL, cfg.OpenClaw.Token, cfg.OpenClaw.Model, timeout), nil
	default:
		return nil, fmt.Errorf("不支持的 AI Provider: %s", cfg.Provider)
	}
}
