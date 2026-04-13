package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// OpenClawProvider OpenClaw / OpenAI 兼容 Provider
type OpenClawProvider struct {
	BaseURL string
	APIKey  string
	Model   string
	client  *http.Client
}

// NewOpenClawProvider 创建 OpenClaw Provider
func NewOpenClawProvider(baseURL, apiKey, model string, timeout time.Duration) *OpenClawProvider {
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	if model == "" {
		model = "default"
	}
	return &OpenClawProvider{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Model:   model,
		client:  &http.Client{Timeout: timeout},
	}
}

func (p *OpenClawProvider) Name() string {
	return "openclaw"
}

func (p *OpenClawProvider) ChatCompletion(ctx context.Context, messages []Message) (string, error) {
	payload := map[string]interface{}{
		"model":    p.Model,
		"messages": messages,
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.BaseURL+"/v1/chat/completions", bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("OpenClaw API 返回状态码 %d", resp.StatusCode)
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("AI 返回空结果")
	}
	return result.Choices[0].Message.Content, nil
}

func (p *OpenClawProvider) HealthCheck(ctx context.Context) error {
	// 用短提示快速验证连通性
	_, err := p.ChatCompletion(ctx, []Message{
		{Role: "user", Content: "hello"},
	})
	return err
}
