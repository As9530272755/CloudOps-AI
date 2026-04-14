package ai

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
	baseURL = strings.TrimSuffix(baseURL, "/")
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

func (p *OllamaProvider) SetSessionID(id string) {
	// Ollama 无会话概念，空实现
}

func (p *OllamaProvider) ChatCompletion(ctx context.Context, messages []Message) (string, error) {
	payload := map[string]interface{}{
		"model":       p.Model,
		"messages":    toOllamaMessages(messages),
		"stream":      false,
		"keep_alive":  "30m",
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
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Ollama API 返回状态码 %d: %s", resp.StatusCode, string(body))
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

func (p *OllamaProvider) ChatCompletionStream(ctx context.Context, messages []Message, onChunk func(StreamResponse)) error {
	payload := map[string]interface{}{
		"model":       p.Model,
		"messages":    toOllamaMessages(messages),
		"stream":      true,
		"keep_alive":  "30m",
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.BaseURL+"/api/chat", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/x-ndjson")

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Ollama API 返回状态码 %d: %s", resp.StatusCode, string(body))
	}

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}

		var result struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Done bool `json:"done"`
		}
		if err := json.Unmarshal(line, &result); err != nil {
			continue
		}
		onChunk(StreamResponse{Content: result.Message.Content, Done: result.Done})
		if result.Done {
			break
		}
	}
	return nil
}

func (p *OllamaProvider) ListModels(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", p.BaseURL+"/api/tags", nil)
	if err != nil {
		return nil, err
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Ollama API 返回状态码 %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	models := make([]string, 0, len(result.Models))
	for _, m := range result.Models {
		if m.Name != "" {
			models = append(models, m.Name)
		}
	}
	return models, nil
}

func toOllamaMessages(messages []Message) []Message {
	result := make([]Message, 0, len(messages))
	for _, m := range messages {
		if len(m.Images) > 0 {
			cleaned := make([]string, 0, len(m.Images))
			for _, img := range m.Images {
				idx := strings.Index(img, ",")
				if idx != -1 {
					cleaned = append(cleaned, img[idx+1:])
				} else {
					cleaned = append(cleaned, img)
				}
			}
			result = append(result, Message{
				Role:    m.Role,
				Content: m.Content,
				Images:  cleaned,
			})
		} else {
			result = append(result, m)
		}
	}
	return result
}

func (p *OllamaProvider) HealthCheck(ctx context.Context) error {
	_, err := p.ChatCompletion(ctx, []Message{
		{Role: "user", Content: "hello"},
	})
	return err
}
