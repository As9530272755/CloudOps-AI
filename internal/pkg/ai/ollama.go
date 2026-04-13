package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// OllamaProvider Ollama 本地模型 Provider
type OllamaProvider struct {
	BaseURL string
	Model   string
	client  *http.Client
}

// NewOllamaProvider 创建 Ollama Provider
func NewOllamaProvider(baseURL, model string, timeout time.Duration) *OllamaProvider {
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	if model == "" {
		model = "llama3"
	}
	return &OllamaProvider{
		BaseURL: baseURL,
		Model:   model,
		client:  &http.Client{Timeout: timeout},
	}
}

func (p *OllamaProvider) Name() string {
	return "ollama"
}

func (p *OllamaProvider) ChatCompletion(ctx context.Context, messages []Message) (string, error) {
	payload := map[string]interface{}{
		"model":    p.Model,
		"messages": messages,
		"stream":   false,
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.BaseURL+"/api/chat", bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Ollama API 返回状态码 %d", resp.StatusCode)
	}

	var result struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.Message.Content, nil
}

func (p *OllamaProvider) HealthCheck(ctx context.Context) error {
	_, err := p.ChatCompletion(ctx, []Message{
		{Role: "user", Content: "hello"},
	})
	return err
}
