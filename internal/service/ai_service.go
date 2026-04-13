package service

import (
	"context"
	"fmt"

	"github.com/cloudops/platform/internal/pkg/ai"
)

// AIService 通用 AI 服务
type AIService struct {
	configSvc *AIConfigService
}

// NewAIService 创建 AI 服务
func NewAIService(configSvc *AIConfigService) *AIService {
	return &AIService{configSvc: configSvc}
}

func (s *AIService) getProvider() (ai.Provider, error) {
	return s.configSvc.NewProvider()
}

// GeneralChat 通用对话
func (s *AIService) GeneralChat(ctx context.Context, messages []ai.Message) (string, error) {
	return s.GeneralChatWithSession(ctx, "", messages)
}

// GeneralChatWithSession 带会话保持的通用对话
func (s *AIService) GeneralChatWithSession(ctx context.Context, sessionID string, messages []ai.Message) (string, error) {
	provider, err := s.getProvider()
	if err != nil {
		return "", err
	}
	provider.SetSessionID(sessionID)
	return provider.ChatCompletion(ctx, messages)
}

// GeneralChatStream 通用流式对话
func (s *AIService) GeneralChatStream(ctx context.Context, messages []ai.Message, onChunk func(ai.StreamResponse)) error {
	return s.GeneralChatStreamWithSession(ctx, "", messages, onChunk)
}

// GeneralChatStreamWithSession 带会话保持的通用流式对话
func (s *AIService) GeneralChatStreamWithSession(ctx context.Context, sessionID string, messages []ai.Message, onChunk func(ai.StreamResponse)) error {
	provider, err := s.getProvider()
	if err != nil {
		return err
	}
	provider.SetSessionID(sessionID)
	return provider.ChatCompletionStream(ctx, messages, onChunk)
}

// AnalyzeLogs 分析日志
func (s *AIService) AnalyzeLogs(ctx context.Context, logs string) (string, error) {
	provider, err := s.getProvider()
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

// AnalyzeInspection 深度分析巡检报告
func (s *AIService) AnalyzeInspection(ctx context.Context, report string) (string, error) {
	provider, err := s.getProvider()
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

// AnalyzeNetworkTrace 分析网络追踪数据
func (s *AIService) AnalyzeNetworkTrace(ctx context.Context, rawLogs string) (string, error) {
	provider, err := s.getProvider()
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
