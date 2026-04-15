package log

import (
	"context"
	"fmt"

	"github.com/cloudops/platform/internal/model"
)

// NewAdapter 根据集群日志后端配置创建对应适配器
func NewAdapter(cfg model.LogBackendConfig) Adapter {
	switch cfg.Type {
	case "elasticsearch":
		return NewESAdapter(cfg.URL, cfg.IndexPatterns, cfg.Headers)
	case "loki":
		return NewLokiAdapter(cfg.URL, cfg.Headers)
	default:
		return &unknownAdapter{}
	}
}

type unknownAdapter struct{}

func (u *unknownAdapter) Name() string { return "unknown" }
func (u *unknownAdapter) TestConnection(ctx context.Context) error {
	return fmt.Errorf("未配置或未识别日志后端")
}
func (u *unknownAdapter) Count(ctx context.Context, req QueryRequest) (int64, error) {
	return 0, fmt.Errorf("未配置或未识别日志后端")
}
func (u *unknownAdapter) Query(ctx context.Context, req QueryRequest) (*QueryResult, error) {
	return nil, fmt.Errorf("未配置或未识别日志后端")
}
func (u *unknownAdapter) QueryHistogram(ctx context.Context, req QueryRequest) (*QueryResult, error) {
	return nil, fmt.Errorf("未配置或未识别日志后端")
}
