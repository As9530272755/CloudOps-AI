package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/cloudops/platform/internal/pkg/ai"
	"github.com/cloudops/platform/internal/pkg/crypto"
)

const aiConfigFile = "data/ai_platform_config.json"

// AIConfigService AI 平台配置管理服务
type AIConfigService struct {
	mu        sync.RWMutex
	encryptor *crypto.AES256Encrypt
	config    ai.PlatformConfig
}

// NewAIConfigService 创建 AI 配置服务
func NewAIConfigService(secretKey string) *AIConfigService {
	s := &AIConfigService{
		encryptor: crypto.NewAES256Encrypt(secretKey),
		config: ai.PlatformConfig{
			Provider: "openclaw",
			OpenClaw: ai.OpenClawDetail{
				URL:   "",
				Token: "",
				Model: "default",
			},
			Ollama: ai.OllamaDetail{
				URL:   "",
				Model: "llama3",
			},
		},
	}
	_ = s.load()
	return s
}

// GetConfig 获取配置（返回给前端时，Token 做掩码处理）
func (s *AIConfigService) GetConfig() ai.PlatformConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cfg := s.config
	if cfg.OpenClaw.Token != "" {
		cfg.OpenClaw.Token = maskToken(cfg.OpenClaw.Token)
	}
	return cfg
}

// GetRawConfig 获取未脱敏的原始配置（仅后端内部使用）
// 注意：存储时 Token 被加密，此处会自动解密
func (s *AIConfigService) GetRawConfig() ai.PlatformConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cfg := s.config
	if cfg.OpenClaw.Token != "" {
		dec, err := s.encryptor.Decrypt(cfg.OpenClaw.Token)
		if err == nil {
			cfg.OpenClaw.Token = dec
		}
		// 如果解密失败，说明可能是明文旧数据，保持原值
	}
	return cfg
}

// UpdateConfig 更新配置
func (s *AIConfigService) UpdateConfig(cfg ai.PlatformConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// OpenClaw 模型固定为 openclaw，不依赖用户输入
	if cfg.Provider == "openclaw" {
		cfg.OpenClaw.Model = "openclaw"
	}

	// 如果前端传的是掩码值（如 sk-****），说明用户没改 Token，保留原值
	if isMasked(cfg.OpenClaw.Token) {
		cfg.OpenClaw.Token = s.config.OpenClaw.Token
	} else if cfg.OpenClaw.Token != "" {
		enc, err := s.encryptor.Encrypt(cfg.OpenClaw.Token)
		if err != nil {
			return fmt.Errorf("Token 加密失败: %w", err)
		}
		cfg.OpenClaw.Token = enc
	}

	s.config = cfg
	return s.save()
}

// TestConnection 测试当前配置的 AI 平台连通性
func (s *AIConfigService) TestConnection() error {
	cfg := s.GetRawConfig()
	timeout := 120 * time.Second
	ctxTimeout := 60 * time.Second
	if cfg.Provider == "ollama" {
		timeout = 600 * time.Second
		ctxTimeout = 300 * time.Second
	}
	provider, err := ai.NewProvider(cfg, timeout)
	if err != nil {
		return err
	}
	ctx, cancel := aiContext(ctxTimeout)
	defer cancel()
	return provider.HealthCheck(ctx)
}

// NewProvider 基于当前配置创建 Provider 实例（给业务模块使用）
func (s *AIConfigService) NewProvider() (ai.Provider, error) {
	cfg := s.GetRawConfig()
	if cfg.Provider == "" {
		return nil, fmt.Errorf("AI 平台尚未配置")
	}
	timeout := 60 * time.Second
	if cfg.Provider == "ollama" {
		timeout = 600 * time.Second // Ollama 大模型加载可能很慢
	}
	return ai.NewProvider(cfg, timeout)
}

// ListModels 获取当前配置平台的可用模型列表
func (s *AIConfigService) ListModels() ([]string, error) {
	provider, err := s.NewProvider()
	if err != nil {
		return nil, err
	}
	ctx, cancel := aiContext(15 * time.Second)
	defer cancel()
	return provider.ListModels(ctx)
}

func (s *AIConfigService) load() error {
	b, err := os.ReadFile(aiConfigFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := json.Unmarshal(b, &s.config); err != nil {
		return err
	}
	// Backfill empty models with defaults
	if s.config.Provider == "openclaw" && s.config.OpenClaw.Model == "" {
		s.config.OpenClaw.Model = "openclaw"
	}
	if s.config.Provider == "ollama" && s.config.Ollama.Model == "" {
		s.config.Ollama.Model = "llama3"
	}
	return nil
}

func (s *AIConfigService) save() error {
	_ = os.MkdirAll("data", 0755)
	b, err := json.MarshalIndent(s.config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(aiConfigFile, b, 0644)
}

func maskToken(token string) string {
	if len(token) <= 8 {
		return "****"
	}
	return token[:4] + "****" + token[len(token)-4:]
}

func isMasked(token string) bool {
	return len(token) >= 8 && token[4:8] == "****"
}

func aiContext(timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), timeout)
}
