package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cloudops/platform/internal/pkg/ai"
)

// AIService 通用 AI 服务
type AIService struct {
	platformSvc *AIPlatformService
	sessionSvc  *AIChatSessionService
	configSvc   *AIConfigService // 保留给旧版分析任务做兼容
}

// NewAIService 创建 AI 服务
func NewAIService(platformSvc *AIPlatformService, sessionSvc *AIChatSessionService, configSvc *AIConfigService) *AIService {
	return &AIService{
		platformSvc: platformSvc,
		sessionSvc:  sessionSvc,
		configSvc:   configSvc,
	}
}

// resolvePlatformID 解析实际使用的平台 ID
func (s *AIService) resolvePlatformID(platformID string, sessionID string) (string, error) {
	if platformID != "" {
		return platformID, nil
	}
	if sessionID != "" {
		session, err := s.sessionSvc.GetSession(sessionID)
		if err == nil && session.PlatformID != "" {
			return session.PlatformID, nil
		}
	}
	p, err := s.platformSvc.GetDefaultPlatform()
	if err != nil {
		return "", fmt.Errorf("没有可用的 AI 平台，请先配置")
	}
	return p.ID, nil
}

// truncateMessages 截断消息数组，保留 system + 最近 limit 条，防止上下文过长导致超时
func truncateMessages(messages []ai.Message, limit int) []ai.Message {
	if len(messages) <= limit {
		return messages
	}
	var system *ai.Message
	var rest []ai.Message
	for _, m := range messages {
		if m.Role == "system" {
			tmp := m
			system = &tmp
		} else {
			rest = append(rest, m)
		}
	}
	if len(rest) > limit {
		rest = rest[len(rest)-limit:]
	}
	if system != nil {
		return append([]ai.Message{*system}, rest...)
	}
	return rest
}

// GeneralChat 通用对话（兼容旧接口，使用默认平台）
func (s *AIService) GeneralChat(ctx context.Context, messages []ai.Message) (string, error) {
	return s.GeneralChatWithSession(ctx, "", messages)
}

// GeneralChatWithSession 带会话保持的通用对话（兼容旧接口）
func (s *AIService) GeneralChatWithSession(ctx context.Context, sessionID string, messages []ai.Message) (string, error) {
	platformID, err := s.resolvePlatformID("", sessionID)
	if err != nil {
		return "", err
	}
	return s.GeneralChatWithPlatformSession(ctx, platformID, sessionID, messages)
}

// GeneralChatWithPlatformSession 指定平台 + 会话的通用对话
func (s *AIService) GeneralChatWithPlatformSession(ctx context.Context, platformID string, sessionID string, messages []ai.Message) (string, error) {
	provider, err := s.platformSvc.NewProviderByID(platformID)
	if err != nil {
		return "", err
	}
	if sessionID != "" {
		provider.SetSessionID(sessionID)
		if userMsg := extractLastUserMessage(messages); userMsg != nil {
			_ = s.sessionSvc.SaveMessage(sessionID, *userMsg)
		}
	}

	reply, err := provider.ChatCompletion(ctx, truncateMessages(messages, provider.MaxHistoryMessages()))
	if err != nil {
		return "", err
	}

	if sessionID != "" {
		_ = s.sessionSvc.SaveMessage(sessionID, ai.Message{Role: "assistant", Content: reply})
		s.tryGenerateTitle(platformID, sessionID, messages)
	}
	return reply, nil
}

// GeneralChatStream 通用流式对话（兼容旧接口）
func (s *AIService) GeneralChatStream(ctx context.Context, messages []ai.Message, onChunk func(ai.StreamResponse)) error {
	return s.GeneralChatStreamWithSession(ctx, "", messages, onChunk)
}

// GeneralChatStreamWithSession 带会话保持的通用流式对话（兼容旧接口）
func (s *AIService) GeneralChatStreamWithSession(ctx context.Context, sessionID string, messages []ai.Message, onChunk func(ai.StreamResponse)) error {
	platformID, err := s.resolvePlatformID("", sessionID)
	if err != nil {
		return err
	}
	return s.GeneralChatStreamWithPlatformSession(ctx, platformID, sessionID, messages, onChunk)
}

// GeneralChatStreamWithPlatformSession 指定平台 + 会话的流式对话
func (s *AIService) GeneralChatStreamWithPlatformSession(ctx context.Context, platformID string, sessionID string, messages []ai.Message, onChunk func(ai.StreamResponse)) error {
	provider, err := s.platformSvc.NewProviderByID(platformID)
	if err != nil {
		return err
	}

	if sessionID != "" {
		provider.SetSessionID(sessionID)
		if userMsg := extractLastUserMessage(messages); userMsg != nil {
			_ = s.sessionSvc.SaveMessage(sessionID, *userMsg)
		}
	}

	var fullReply strings.Builder
	wrappedOnChunk := func(chunk ai.StreamResponse) {
		if chunk.Content != "" {
			fullReply.WriteString(chunk.Content)
		}
		onChunk(chunk)
	}

	err = provider.ChatCompletionStream(ctx, truncateMessages(messages, provider.MaxHistoryMessages()), wrappedOnChunk)
	if err != nil {
		return err
	}

	if sessionID != "" {
		_ = s.sessionSvc.SaveMessage(sessionID, ai.Message{Role: "assistant", Content: fullReply.String()})
		s.tryGenerateTitle(platformID, sessionID, messages)
	}
	return nil
}

// tryGenerateTitle 尝试异步生成会话标题（当非 system 消息达到 3 条且标题为空时）
func (s *AIService) tryGenerateTitle(platformID string, sessionID string, messages []ai.Message) {
	go func() {
		session, err := s.sessionSvc.GetSession(sessionID)
		if err != nil || session.Title != "" {
			return
		}
		count, err := s.sessionSvc.GetMessageCount(sessionID)
		if err != nil || count < 3 {
			return
		}

		provider, err := s.platformSvc.NewProviderByID(platformID)
		if err != nil {
			return
		}
		provider.SetSessionID(sessionID)

		summaryPrompt := "请用不超过10个字总结以下对话主题，只返回标题本身，不要加任何解释：\n"
		for _, m := range messages {
			if m.Role == "system" {
				continue
			}
			summaryPrompt += fmt.Sprintf("%s: %s\n", m.Role, m.Content)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		title, err := provider.ChatCompletion(ctx, []ai.Message{
			{Role: "user", Content: summaryPrompt},
		})
		if err != nil {
			return
		}
		title = strings.TrimSpace(title)
		if title != "" {
			_ = s.sessionSvc.UpdateTitle(sessionID, title)
		}
	}()
}

func extractLastUserMessage(messages []ai.Message) *ai.Message {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return &messages[i]
		}
	}
	return nil
}

func (s *AIService) defaultProvider() (ai.Provider, error) {
	p, err := s.platformSvc.GetDefaultPlatform()
	if err != nil {
		return nil, fmt.Errorf("没有可用的 AI 平台，请先配置")
	}
	return s.platformSvc.NewProviderByID(p.ID)
}

// AnalyzeLogs 分析日志（走默认平台，兼容旧逻辑）
func (s *AIService) AnalyzeLogs(ctx context.Context, logs string) (string, error) {
	provider, err := s.defaultProvider()
	if err != nil {
		return "", err
	}
	prompt := fmt.Sprintf(
		"你是一位 Kubernetes 运维专家。请分析下面的容器日志，给出：1) 整体状态判断；2) 关键错误/告警提取；3) 排查建议。\n\n```\n%s\n```",
		logs,
	)
	return provider.ChatCompletion(ctx, []ai.Message{
		{Role: "system", Content: "你是一个专业的 K8s 日志分析师。"},
		{Role: "user", Content: prompt},
	})
}

// AnalyzeInspection 深度分析巡检报告（走默认平台）
func (s *AIService) AnalyzeInspection(ctx context.Context, report string) (string, error) {
	provider, err := s.defaultProvider()
	if err != nil {
		return "", err
	}
	prompt := fmt.Sprintf(
		"你是一位 Kubernetes 架构师。请对下面的巡检报告进行深度分析，给出：1) 核心风险点；2) 优先级排序；3) 具体的修复建议。\n\n%s",
		report,
	)
	return provider.ChatCompletion(ctx, []ai.Message{
		{Role: "system", Content: "你是一个专业的 K8s 架构师。"},
		{Role: "user", Content: prompt},
	})
}

// AnalyzeNetworkTrace 分析网络追踪数据（走默认平台）
func (s *AIService) AnalyzeNetworkTrace(ctx context.Context, rawLogs string) (string, error) {
	provider, err := s.defaultProvider()
	if err != nil {
		return "", err
	}
	prompt := fmt.Sprintf(
		"你是一位 Kubernetes 网络运维专家。请根据下面 tcpdump 抓包日志，为普通工程师写一段 150 字以内的中文总结。需包含：1) 和谁通信；2) 用了什么协议；3) 流量大小；4) 是否有异常。\n\n%s",
		rawLogs,
	)
	return provider.ChatCompletion(ctx, []ai.Message{
		{Role: "system", Content: "你是一个专业的 K8s 网络分析师。"},
		{Role: "user", Content: prompt},
	})
}
