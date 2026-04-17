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
		maxContextLength = 8192
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

func (p *OllamaProvider) ChatCompletion(ctx context.Context, messages []Message, tools []Tool) (*CompletionResult, error) {
	payload := map[string]interface{}{
		"model":       p.Model,
		"messages":    toOllamaMessages(messages),
		"stream":      false,
		"keep_alive":  "5m",
		"options": map[string]interface{}{
			"num_ctx": p.maxContextLength,
		},
	}
	if len(tools) > 0 {
		payload["tools"] = tools
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.BaseURL+"/api/chat", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

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
		Message struct {
			Role      string          `json:"role"`
			Content   string          `json:"content"`
			ToolCalls []ollamaToolCall `json:"tool_calls"`
		} `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	tcs := convertOllamaToolCalls(result.Message.ToolCalls)
	return &CompletionResult{
		Content:   result.Message.Content,
		ToolCalls: tcs,
	}, nil
}

// ChatCompletionJSON 强制模型输出 JSON（Ollama 原生支持 format: json）
func (p *OllamaProvider) ChatCompletionJSON(ctx context.Context, messages []Message) (*CompletionResult, error) {
	payload := map[string]interface{}{
		"model":       p.Model,
		"messages":    toOllamaMessages(messages),
		"stream":      false,
		"format":      "json",
		"keep_alive":  "5m",
		"options": map[string]interface{}{
			"num_ctx": p.maxContextLength,
		},
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.BaseURL+"/api/chat", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

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
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &CompletionResult{
		Content:   result.Message.Content,
		ToolCalls: nil,
	}, nil
}

func (p *OllamaProvider) ChatCompletionStream(ctx context.Context, messages []Message, tools []Tool, onChunk func(StreamResponse)) error {
	payload := map[string]interface{}{
		"model":       p.Model,
		"messages":    toOllamaMessages(messages),
		"stream":      true,
		"keep_alive":  "5m",
		"options": map[string]interface{}{
			"num_ctx": p.maxContextLength,
		},
	}
	if len(tools) > 0 {
		payload["tools"] = tools
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

	var finalToolCalls []ToolCall
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
				Role      string          `json:"role"`
				Content   string          `json:"content"`
				ToolCalls []ollamaToolCall `json:"tool_calls"`
			} `json:"message"`
			Done bool `json:"done"`
		}
		if err := json.Unmarshal(line, &result); err != nil {
			continue
		}
		if len(result.Message.ToolCalls) > 0 {
			finalToolCalls = append(finalToolCalls, convertOllamaToolCalls(result.Message.ToolCalls)...)
		}
		onChunk(StreamResponse{Content: result.Message.Content, Done: result.Done, ToolCalls: finalToolCalls})
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
		msg := Message{
			Role:       m.Role,
			Content:    m.Content,
			ToolCalls:  m.ToolCalls,
			ToolCallID: m.ToolCallID,
		}
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
			msg.Images = cleaned
		}
		result = append(result, msg)
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
	var result struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
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

// ollamaToolCall Ollama 原始返回，arguments 可能是对象也可能是字符串
type ollamaToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

// convertOllamaToolCalls 把 Ollama 原始 tool_calls 归一化为 ToolCall，arguments 统一转成 JSON 字符串
func convertOllamaToolCalls(otcs []ollamaToolCall) []ToolCall {
	if len(otcs) == 0 {
		return nil
	}
	out := make([]ToolCall, 0, len(otcs))
	for _, otc := range otcs {
		if otc.Function.Name == "" {
			continue
		}
		args := strings.TrimSpace(string(otc.Function.Arguments))
		if args == "" || args == "null" {
			args = "{}"
		} else if args[0] == '{' {
			// 已经是 JSON 对象字符串，保留
		} else if args[0] == '"' && args[len(args)-1] == '"' {
			// 是 JSON 字符串（被双引号包裹），需要解包
			var s string
			if err := json.Unmarshal(otc.Function.Arguments, &s); err == nil {
				args = s
			} else {
				args = "{}"
			}
		} else {
			// 其他情况，尝试解析为对象，否则默认空对象
			var raw map[string]interface{}
			if err := json.Unmarshal([]byte(args), &raw); err == nil {
				b, _ := json.Marshal(raw)
				args = string(b)
			} else {
				args = "{}"
			}
		}
		out = append(out, ToolCall{
			ID:   otc.ID,
			Type: otc.Type,
			Function: struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			}{
				Name:      otc.Function.Name,
				Arguments: args,
			},
		})
	}
	return out
}
