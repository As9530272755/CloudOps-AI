package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/cloudops/platform/internal/pkg/ai"
)

// AgentRuntimeProxy 代理 Node.js Agent Runtime 的服务
type AgentRuntimeProxy struct {
	platformSvc *AIPlatformService
	baseURL     string
	client      *http.Client
}

// NewAgentRuntimeProxy 创建代理
func NewAgentRuntimeProxy(platformSvc *AIPlatformService) *AgentRuntimeProxy {
	return &AgentRuntimeProxy{
		platformSvc: platformSvc,
		baseURL:     "http://127.0.0.1:19000",
		client:      &http.Client{Timeout: 30 * time.Second},
	}
}

// ModelConfig Node.js 运行时需要的模型配置
type ModelConfig struct {
	Provider      string `json:"provider"`
	ModelID       string `json:"modelId"`
	BaseURL       string `json:"baseUrl,omitempty"`
	APIKey        string `json:"apiKey,omitempty"`
	ContextWindow int    `json:"contextWindow,omitempty"`
	MaxTokens     int    `json:"maxTokens,omitempty"`
}



func (p *AgentRuntimeProxy) resolveModelConfig(platformID string) (*ModelConfig, error) {
	platform, err := p.platformSvc.GetPlatform(platformID)
	if err != nil {
		return nil, fmt.Errorf("平台不存在: %w", err)
	}

	decrypted, err := p.platformSvc.DecryptConfig(platform.ConfigJSON)
	if err != nil {
		return nil, fmt.Errorf("解密配置失败: %w", err)
	}

	switch platform.ProviderType {
	case "ollama":
		var detail ai.OllamaDetail
		if err := json.Unmarshal([]byte(decrypted), &detail); err != nil {
			return nil, fmt.Errorf("解析配置失败: %w", err)
		}
		ctxWindow := detail.MaxContextLength
		if ctxWindow <= 0 {
			ctxWindow = 65536
		}
		return &ModelConfig{
			Provider:      "ollama",
			ModelID:       detail.Model,
			BaseURL:       detail.URL,
			ContextWindow: ctxWindow,
			MaxTokens:     4096,
		}, nil
	case "openclaw", "openai":
		var detail ai.OpenClawDetail
		if err := json.Unmarshal([]byte(decrypted), &detail); err != nil {
			return nil, fmt.Errorf("解析配置失败: %w", err)
		}
		return &ModelConfig{
			Provider:      "openclaw",
			ModelID:       detail.Model,
			BaseURL:       detail.URL,
			APIKey:        detail.Token,
			ContextWindow: 8192,
			MaxTokens:     4096,
		}, nil
	default:
		return nil, fmt.Errorf("不支持的 Provider 类型: %s", platform.ProviderType)
	}
}

// EnsureSession 确保 Node.js 运行时有对应的会话
func (p *AgentRuntimeProxy) EnsureSession(ctx context.Context, sessionID, platformID string) error {
	modelCfg, err := p.resolveModelConfig(platformID)
	if err != nil {
		return err
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"sessionId":    sessionID,
		"modelConfig":  modelCfg,
	})

	req, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/agent/sessions", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("Agent Runtime 连接失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Agent Runtime 创建会话失败: %s", string(body))
	}
	return nil
}

// AgentChatStream 向 Node.js 运行时发起 Agent 对话并流式返回事件
func (p *AgentRuntimeProxy) AgentChatStream(ctx context.Context, sessionID, platformID string, messages []ai.Message, onEvent func(AgentEvent)) error {
	if err := p.EnsureSession(ctx, sessionID, platformID); err != nil {
		return err
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"messages": convertMessages(messages),
	})

	req, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/agent/sessions/"+sessionID+"/prompt", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("Agent Runtime 请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Agent Runtime 返回错误 %d: %s", resp.StatusCode, string(body))
	}

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		var ev AgentEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			continue
		}
		onEvent(ev)
		if ev.Done {
			break
		}
	}
	return nil
}

func convertMessages(messages []ai.Message) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(messages))
	for _, m := range messages {
		msg := map[string]interface{}{
			"role":    m.Role,
			"content": m.Content,
		}
		if len(m.ToolCalls) > 0 {
			msg["tool_calls"] = m.ToolCalls
		}
		if m.ToolCallID != "" {
			msg["tool_call_id"] = m.ToolCallID
		}
		out = append(out, msg)
	}
	return out
}
