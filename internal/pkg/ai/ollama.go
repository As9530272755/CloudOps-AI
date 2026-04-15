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
	BaseURL            string
	Model              string
	maxContextLength   int
	maxHistoryMessages int
	client             *http.Client
}

// NewOllamaProvider 创建 Ollama Provider
func NewOllamaProvider(baseURL, model string, timeout time.Duration, maxContextLength, maxHistoryMessages int) *OllamaProvider {
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	baseURL = strings.TrimSuffix(baseURL, "/")
	if model == "" {
		model = "llama3"
	}
	if maxContextLength <= 0 {
		maxContextLength = 4096
	}
	if maxHistoryMessages <= 0 {
		maxHistoryMessages = 10
	}
	return &OllamaProvider{
		BaseURL:            baseURL,
		Model:              model,
		maxContextLength:   maxContextLength,
		maxHistoryMessages: maxHistoryMessages,
		client:             &http.Client{Timeout: timeout},
	}
}

func (p *OllamaProvider) Name() string {
	return "ollama"
}

func (p *OllamaProvider) SetSessionID(id string) {
	// Ollama 无会话概念，空实现
}

func (p *OllamaProvider) MaxHistoryMessages() int {
	return p.maxHistoryMessages
}

func (p *OllamaProvider) ChatCompletion(ctx context.Context, messages []Message) (string, error) {
	payload := map[string]interface{}{
		"model":       p.Model,
		"messages":    toOllamaMessages(messages),
		"stream":      false,
		"keep_alive":  "5m",
		"options": map[string]interface{}{
			"num_ctx": p.maxContextLength,
		},
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
		"keep_alive":  "5m",
		"options": map[string]interface{}{
			"num_ctx": p.maxContextLength,
		},
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
	req, err := http.NewRequestWithContext(ctx, "GET", p.BaseURL+"/api/tags", nil)
	if err != nil {
		return err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Ollama API 返回状态码 %d: %s", resp.StatusCode, string(body))
	}
	// 可选：检查模型是否存在
	var result struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil // 只要能通就行，不强制要求模型一定存在
	}
	modelFound := false
	for _, m := range result.Models {
		if m.Name == p.Model || strings.HasPrefix(m.Name, p.Model+":") {
			modelFound = true
			break
		}
	}
	if !modelFound && len(result.Models) > 0 {
		return fmt.Errorf("Ollama 服务正常，但未找到模型 %s", p.Model)
	}
	return nil
}
