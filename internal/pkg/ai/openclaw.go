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

// OpenClawProvider OpenClaw / OpenAI 兼容 Provider
type OpenClawProvider struct {
	BaseURL   string
	APIKey    string
	Model     string
	SessionID string
	client    *http.Client
}

// NewOpenClawProvider 创建 OpenClaw Provider
func NewOpenClawProvider(baseURL, apiKey, model string, timeout time.Duration) *OpenClawProvider {
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	baseURL = strings.TrimSuffix(baseURL, "/")
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

func (p *OpenClawProvider) SetSessionID(id string) {
	p.SessionID = id
}

func (p *OpenClawProvider) setAuth(req *http.Request) {
	if p.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
	}
}

func (p *OpenClawProvider) normalizeModel() string {
	if p.Model == "" {
		return "openclaw"
	}
	return p.Model
}

type openAIMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

func toOpenAIMessages(messages []Message) []openAIMessage {
	result := make([]openAIMessage, 0, len(messages))
	for _, m := range messages {
		if len(m.Images) > 0 {
			parts := []map[string]interface{}{
				{"type": "text", "text": m.Content},
			}
			for _, img := range m.Images {
				parts = append(parts, map[string]interface{}{
					"type": "image_url",
					"image_url": map[string]interface{}{"url": img},
				})
			}
			result = append(result, openAIMessage{Role: m.Role, Content: parts})
		} else {
			result = append(result, openAIMessage{Role: m.Role, Content: m.Content})
		}
	}
	return result
}

func (p *OpenClawProvider) ChatCompletion(ctx context.Context, messages []Message) (string, error) {
	payload := map[string]interface{}{
		"model":    p.normalizeModel(),
		"messages": toOpenAIMessages(messages),
	}
	if p.SessionID != "" {
		payload["session_id"] = p.SessionID
		payload["conversation_id"] = p.SessionID
		payload["user"] = p.SessionID
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
	if p.SessionID != "" {
		req.Header.Set("X-Session-ID", p.SessionID)
		req.Header.Set("X-Conversation-ID", p.SessionID)
	}
	p.setAuth(req)

	resp, err := p.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("OpenClaw API 返回状态码 %d: %s", resp.StatusCode, string(body))
	}

	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	if result.SessionID != "" {
		p.SessionID = result.SessionID
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("AI 返回空结果")
	}
	return result.Choices[0].Message.Content, nil
}

func (p *OpenClawProvider) ChatCompletionStream(ctx context.Context, messages []Message, onChunk func(StreamResponse)) error {
	payload := map[string]interface{}{
		"model":    p.normalizeModel(),
		"messages": toOpenAIMessages(messages),
		"stream":   true,
	}
	if p.SessionID != "" {
		payload["session_id"] = p.SessionID
		payload["conversation_id"] = p.SessionID
		payload["user"] = p.SessionID
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.BaseURL+"/v1/chat/completions", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if p.SessionID != "" {
		req.Header.Set("X-Session-ID", p.SessionID)
		req.Header.Set("X-Conversation-ID", p.SessionID)
	}
	p.setAuth(req)

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("OpenClaw API 返回状态码 %d: %s", resp.StatusCode, string(body))
	}

	// 如果返回的不是 SSE，则按普通 JSON 一次性读取
	contentType := resp.Header.Get("Content-Type")
	if !strings.Contains(contentType, "text/event-stream") {
		body, _ := io.ReadAll(resp.Body)
		var result struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
			SessionID string `json:"session_id"`
		}
		if err := json.Unmarshal(body, &result); err == nil {
			if result.SessionID != "" {
				p.SessionID = result.SessionID
			}
			if len(result.Choices) > 0 {
				onChunk(StreamResponse{Content: result.Choices[0].Message.Content})
			}
		}
		onChunk(StreamResponse{Done: true})
		return nil
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
		if line == "" || !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			onChunk(StreamResponse{Done: true})
			break
		}

		var result struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
			SessionID string `json:"session_id"`
		}
		if err := json.Unmarshal([]byte(data), &result); err != nil {
			continue
		}
		if result.SessionID != "" {
			p.SessionID = result.SessionID
		}
		if len(result.Choices) > 0 {
			content := result.Choices[0].Delta.Content
			if content == "" {
				content = result.Choices[0].Message.Content
			}
			onChunk(StreamResponse{Content: content})
		}
	}
	onChunk(StreamResponse{Done: true})
	return nil
}

func (p *OpenClawProvider) ListModels(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", p.BaseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	p.setAuth(req)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("OpenClaw API 返回状态码 %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	models := make([]string, 0, len(result.Data))
	for _, m := range result.Data {
		if m.ID != "" {
			models = append(models, m.ID)
		}
	}
	return models, nil
}

func (p *OpenClawProvider) HealthCheck(ctx context.Context) error {
	_, err := p.ChatCompletion(ctx, []Message{
		{Role: "user", Content: "hello"},
	})
	return err
}
