package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/ai"
	logpkg "github.com/cloudops/platform/internal/pkg/log"
	"gorm.io/gorm"
)

// AgentEvent Agent 执行过程中的事件
type AgentEvent struct {
	Type    string `json:"type"` // text | tool_start | tool_end | error | done
	Content string `json:"content,omitempty"`
	Tool    string `json:"tool,omitempty"`
	Input   string `json:"input,omitempty"`
	Output  string `json:"output,omitempty"`
	Done    bool   `json:"done,omitempty"`
}

// AgentService AI Agent 服务
type AgentService struct {
	platformSvc *AIPlatformService
	sessionSvc  *AIChatSessionService
	db          *gorm.DB
	k8sSvc      *K8sResourceService
	logSvc      *LogService
}

// NewAgentService 创建 Agent 服务
func NewAgentService(platformSvc *AIPlatformService, sessionSvc *AIChatSessionService, logSvc *LogService, k8sSvc *K8sResourceService, db *gorm.DB) *AgentService {
	return &AgentService{platformSvc: platformSvc, sessionSvc: sessionSvc, db: db, k8sSvc: k8sSvc, logSvc: logSvc}
}

// AgentChatStream 执行 Agent 流式对话
func (s *AgentService) AgentChatStream(ctx context.Context, platformID, sessionID string, messages []ai.Message, onEvent func(AgentEvent)) error {
	provider, err := s.platformSvc.NewProviderByID(platformID)
	if err != nil {
		onEvent(AgentEvent{Type: "error", Content: err.Error()})
		onEvent(AgentEvent{Type: "done", Done: true})
		return err
	}
	if sessionID != "" {
		provider.SetSessionID(sessionID)
		if userMsg := extractLastUserMessage(messages); userMsg != nil {
			_ = s.sessionSvc.SaveMessage(sessionID, *userMsg)
		}
	}

	tools := s.buildTools()
	messages = s.injectSystemPrompt(messages)

	var answer strings.Builder
	for i := 0; i < 5; i++ {
		res, err := provider.ChatCompletion(ctx, truncateMessages(messages, provider.MaxHistoryMessages()), tools)
		if err != nil {
			onEvent(AgentEvent{Type: "error", Content: err.Error()})
			onEvent(AgentEvent{Type: "done", Done: true})
			return err
		}

		if len(res.ToolCalls) == 0 {
			answer.WriteString(res.Content)
			chunks := splitText(res.Content, 30)
			for _, chunk := range chunks {
				onEvent(AgentEvent{Type: "text", Content: chunk})
			}
			break
		}

		// 记录 assistant 的 tool_calls 到上下文
		messages = append(messages, ai.Message{Role: "assistant", Content: res.Content, ToolCalls: res.ToolCalls})

		for _, tc := range res.ToolCalls {
			onEvent(AgentEvent{Type: "tool_start", Tool: tc.Function.Name, Input: tc.Function.Arguments})
			output, err := s.execTool(ctx, tc)
			if err != nil {
				output = fmt.Sprintf("执行失败: %v", err)
			}
			output = truncateOutput(output, 4000)
			onEvent(AgentEvent{Type: "tool_end", Tool: tc.Function.Name, Input: tc.Function.Arguments, Output: output})
			// Ollama/qwen 对 role:tool 支持不佳，改用 user 角色并显式包装工具结果
			wrapped := fmt.Sprintf("工具 %s 返回结果如下，请基于该结果判断是否需要继续调用其他工具。若信息已足够，请直接给出最终中文回答。\n%s", tc.Function.Name, output)
			messages = append(messages, ai.Message{Role: "user", Content: wrapped})
		}
	}

	if sessionID != "" {
		_ = s.sessionSvc.SaveMessage(sessionID, ai.Message{Role: "assistant", Content: answer.String()})
	}
	onEvent(AgentEvent{Type: "done", Done: true})
	return nil
}

func (s *AgentService) injectSystemPrompt(messages []ai.Message) []ai.Message {
	prompt := `You are CloudOps, an AI assistant that can call tools to query Kubernetes clusters and logs.

Available tools:
1. list_clusters(): List all connected clusters.
2. get_cluster_status(cluster_id): Get cluster resource stats.
3. list_pods(cluster_id, namespace?): List pods in a cluster.
4. query_logs(cluster_id, keyword?, log_type?, namespace?, start_time?, end_time?, limit?): Query logs.

Rules:
- Call as many tools as needed, in sequence, until you can fully answer the user's question.
- Do NOT stop after a single tool call if the user's question is not yet answered.
- Do NOT ask the user for clarification unless the task is truly impossible.
- Use exact arguments. Answer concisely in Chinese once you have enough information.`

	for i := range messages {
		if messages[i].Role == "system" {
			messages[i].Content = prompt
			return messages
		}
	}
	return append([]ai.Message{{Role: "system", Content: prompt}}, messages...)
}

func (s *AgentService) buildTools() []ai.Tool {
	return []ai.Tool{
		{
			Type: "function",
			Function: struct {
				Name        string      `json:"name"`
				Description string      `json:"description"`
				Parameters  interface{} `json:"parameters"`
			}{
				Name:        "list_clusters",
				Description: "列出当前用户对接的所有 Kubernetes 集群",
				Parameters: map[string]interface{}{
					"type":       "object",
					"properties": map[string]interface{}{},
				},
			},
		},
		{
			Type: "function",
			Function: struct {
				Name        string      `json:"name"`
				Description string      `json:"description"`
				Parameters  interface{} `json:"parameters"`
			}{
				Name:        "get_cluster_status",
				Description: "获取集群资源统计概览，包括节点、Pod、Deployment 等数量",
				Parameters: map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"cluster_id": map[string]interface{}{
							"type":        "integer",
							"description": "集群 ID",
						},
					},
					"required": []string{"cluster_id"},
				},
			},
		},
		{
			Type: "function",
			Function: struct {
				Name        string      `json:"name"`
				Description string      `json:"description"`
				Parameters  interface{} `json:"parameters"`
			}{
				Name:        "list_pods",
				Description: "列出指定集群中的 Pod 列表",
				Parameters: map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"cluster_id": map[string]interface{}{
							"type":        "integer",
							"description": "集群 ID",
						},
						"namespace": map[string]interface{}{
							"type":        "string",
							"description": "命名空间过滤，可选",
						},
					},
					"required": []string{"cluster_id"},
				},
			},
		},
		{
			Type: "function",
			Function: struct {
				Name        string      `json:"name"`
				Description string      `json:"description"`
				Parameters  interface{} `json:"parameters"`
			}{
				Name:        "query_logs",
				Description: "查询 Elasticsearch/OpenSearch 日志",
				Parameters: map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"cluster_id": map[string]interface{}{
							"type":        "integer",
							"description": "集群 ID",
						},
						"keyword": map[string]interface{}{
							"type":        "string",
							"description": "搜索关键词",
						},
						"log_type": map[string]interface{}{
							"type":        "string",
							"enum":        []string{"app", "ingress", "coredns", "lb"},
							"description": "日志类型，默认 app",
						},
						"namespace": map[string]interface{}{
							"type":        "string",
							"description": "命名空间过滤",
						},
						"start_time": map[string]interface{}{
							"type":        "string",
							"description": "开始时间，RFC3339",
						},
						"end_time": map[string]interface{}{
							"type":        "string",
							"description": "结束时间，RFC3339",
						},
						"limit": map[string]interface{}{
							"type":        "integer",
							"description": "返回条数，默认 20，最大 100",
						},
					},
					"required": []string{"cluster_id"},
				},
			},
		},
	}
}

// ExecuteTool 公开执行单个工具（供内部 HTTP API 使用）
func (s *AgentService) ExecuteTool(ctx context.Context, toolName string, arguments string) (string, error) {
	tc := ai.ToolCall{
		Function: struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		}{
			Name:      toolName,
			Arguments: arguments,
		},
	}
	return s.execTool(ctx, tc)
}

func (s *AgentService) execTool(ctx context.Context, tc ai.ToolCall) (string, error) {
	switch tc.Function.Name {
	case "list_clusters":
		var clusters []model.Cluster
		if err := s.db.Find(&clusters).Error; err != nil {
			return "", err
		}
		var list []map[string]interface{}
		for _, c := range clusters {
			name := c.DisplayName
			if name == "" {
				name = c.Name
			}
			list = append(list, map[string]interface{}{"id": c.ID, "name": name})
		}
		b, _ := json.Marshal(list)
		return string(b), nil
	case "get_cluster_status":
		var a struct{ ClusterID uint `json:"cluster_id"` }
		if err := json.Unmarshal([]byte(tc.Function.Arguments), &a); err != nil {
			return "", fmt.Errorf("参数解析失败: %w", err)
		}
		stats, err := s.k8sSvc.GetClusterStats(ctx, a.ClusterID, []string{"*"})
		if err != nil {
			return "", err
		}
		b, _ := json.Marshal(stats)
		return string(b), nil
	case "list_pods":
		var a struct {
			ClusterID uint   `json:"cluster_id"`
			Namespace string `json:"namespace"`
		}
		if err := json.Unmarshal([]byte(tc.Function.Arguments), &a); err != nil {
			return "", fmt.Errorf("参数解析失败: %w", err)
		}
		pods, total, err := s.k8sSvc.ListResources(ctx, a.ClusterID, "pods", a.Namespace, "", 1, 50)
		if err != nil {
			return "", err
		}
		b, _ := json.Marshal(map[string]interface{}{"total": total, "pods": pods})
		return string(b), nil
	case "query_logs":
		var a struct {
			ClusterID uint   `json:"cluster_id"`
			Keyword   string `json:"keyword"`
			LogType   string `json:"log_type"`
			Namespace string `json:"namespace"`
			StartTime string `json:"start_time"`
			EndTime   string `json:"end_time"`
			Limit     int    `json:"limit"`
		}
		if err := json.Unmarshal([]byte(tc.Function.Arguments), &a); err != nil {
			return "", fmt.Errorf("参数解析失败: %w", err)
		}
		if a.LogType == "" {
			a.LogType = "app"
		}
		if a.Limit <= 0 || a.Limit > 100 {
			a.Limit = 20
		}
		end := time.Now()
		start := end.Add(-1 * time.Hour)
		if a.StartTime != "" {
			if ts, err := time.Parse(time.RFC3339, a.StartTime); err == nil {
				start = ts
			}
		}
		if a.EndTime != "" {
			if ts, err := time.Parse(time.RFC3339, a.EndTime); err == nil {
				end = ts
			}
		}
		var backends []model.ClusterLogBackend
		if err := s.db.Where("cluster_id = ?", a.ClusterID).Find(&backends).Error; err != nil {
			return "", err
		}
		if len(backends) == 0 {
			return "", fmt.Errorf("该集群未配置日志后端")
		}
		backendIDs := make([]uint, 0, len(backends))
		for _, b := range backends {
			backendIDs = append(backendIDs, b.ID)
		}
		req := logpkg.QueryRequest{
			ClusterID: a.ClusterID,
			LogType:   a.LogType,
			Limit:     a.Limit,
			Offset:    0,
			Mode:      "detail",
		}
		req.TimeRange.From = start
		req.TimeRange.To = end
		if a.Namespace != "" {
			req.Filters = map[string]string{"namespace": a.Namespace}
		}
		if a.Keyword != "" {
			req.Filters["keyword"] = a.Keyword
		}
		results, err := s.logSvc.QueryLogsMultiBackend(ctx, backendIDs, req, 0)
		if err != nil {
			return "", err
		}
		var sb strings.Builder
		var total int64
		for _, r := range results {
			total += r.Total
			if r.Error != "" {
				sb.WriteString(fmt.Sprintf("后端 %d 查询出错: %s\n", r.BackendID, r.Error))
				continue
			}
			sb.WriteString(fmt.Sprintf("后端 %d 返回 %d 条:\n", r.BackendID, len(r.Entries)))
			for _, e := range r.Entries {
				sb.WriteString(fmt.Sprintf("[%s] %s/%s: %s\n", e.Timestamp, e.Namespace, e.PodName, e.Message))
			}
		}
		return fmt.Sprintf("共匹配约 %d 条日志\n%s", total, sb.String()), nil
	default:
		return "", fmt.Errorf("未知工具: %s", tc.Function.Name)
	}
}

func truncateOutput(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "\n...[内容已截断]"
}

func splitText(text string, chunkSize int) []string {
	if len(text) == 0 {
		return nil
	}
	var chunks []string
	runes := []rune(text)
	for i := 0; i < len(runes); i += chunkSize {
		end := i + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[i:end]))
	}
	return chunks
}
