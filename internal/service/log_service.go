package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/log"
)

// LogService 日志查询服务
type LogService struct {
	db         *gorm.DB
	k8sManager *K8sManager
}

// NewLogService 创建日志服务
func NewLogService(db *gorm.DB, km *K8sManager) *LogService {
	return &LogService{
		db:         db,
		k8sManager: km,
	}
}

// validateQuery 校验查询参数（时间-集群联动 + 过滤条件强制）
func validateQuery(req log.QueryRequest, clusterCount int) error {
	duration := req.TimeRange.To.Sub(req.TimeRange.From)

	var maxDuration time.Duration
	switch {
	case clusterCount == 1:
		maxDuration = 7 * 24 * time.Hour
	case clusterCount <= 3:
		maxDuration = 24 * time.Hour
	case clusterCount <= 5:
		maxDuration = 6 * time.Hour
	case clusterCount <= 10:
		maxDuration = time.Hour
	default:
		maxDuration = 15 * time.Minute
	}

	if duration > maxDuration {
		return fmt.Errorf("选中 %d 个集群时，最大允许查询范围为 %v", clusterCount, maxDuration)
	}

	if duration > time.Hour && len(req.Filters) == 0 {
		return fmt.Errorf("查询时间超过 1 小时时，必须提供至少一个过滤条件")
	}

	if req.Limit <= 0 {
		req.Limit = 100
	}
	if req.Limit > 500 {
		req.Limit = 500
	}

	return nil
}

// GetLogBackend 获取集群日志后端配置（公开方法）
func (s *LogService) GetLogBackend(clusterID uint) (model.LogBackendConfig, error) {
	return s.getLogBackend(clusterID)
}

// UpdateLogBackend 更新集群日志后端配置
func (s *LogService) UpdateLogBackend(clusterID uint, cfg model.LogBackendConfig) error {
	b, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return s.db.Model(&model.ClusterMetadata{}).Where("cluster_id = ?", clusterID).Update("log_backend", string(b)).Error
}

// getLogBackend 获取集群日志后端配置
func (s *LogService) getLogBackend(clusterID uint) (model.LogBackendConfig, error) {
	var meta model.ClusterMetadata
	if err := s.db.Where("cluster_id = ?", clusterID).First(&meta).Error; err != nil {
		return model.LogBackendConfig{}, err
	}

	var cfg model.LogBackendConfig
	if meta.LogBackend != "" {
		if err := json.Unmarshal([]byte(meta.LogBackend), &cfg); err != nil {
			return model.LogBackendConfig{}, err
		}
	}

	// 如果没有配置或类型未知，尝试自动发现
	if cfg.Type == "" || cfg.Type == "unknown" {
		detected, err := s.detectLogBackend(clusterID)
		if err != nil {
			return cfg, err
		}
		cfg = detected
		// 保存到数据库
		b, _ := json.Marshal(cfg)
		s.db.Model(&model.ClusterMetadata{}).Where("cluster_id = ?", clusterID).Update("log_backend", string(b))
	}

	return cfg, nil
}

// detectLogBackend 自动探测集群日志后端
func (s *LogService) detectLogBackend(clusterID uint) (model.LogBackendConfig, error) {
	client := s.k8sManager.GetClient(clusterID)
	if client == nil {
		return model.LogBackendConfig{Type: "unknown"}, fmt.Errorf("无法获取集群 %d 的 K8s 客户端", clusterID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. 探测 Elasticsearch / OpenSearch Service
	svcs, err := client.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, svc := range svcs.Items {
			nameLower := strings.ToLower(svc.Name)
			ns := svc.Namespace
			if strings.Contains(nameLower, "elasticsearch") || strings.Contains(nameLower, "opensearch") {
				url := fmt.Sprintf("http://%s.%s.svc:9200", svc.Name, ns)
				now := time.Now()
				return model.LogBackendConfig{
					Type: "elasticsearch",
					URL:  url,
					IndexPatterns: map[string]string{
						"ingress":   "nginx-ingress-*",
						"coredns":   "logstash-*",
						"lb":        "logstash-*",
						"app":       "logstash-*",
					},
					DetectedAt: &now,
				}, nil
			}
			if strings.Contains(nameLower, "loki") {
				url := fmt.Sprintf("http://%s.%s.svc:3100", svc.Name, ns)
				now := time.Now()
				return model.LogBackendConfig{
					Type: "loki",
					URL:  url,
					DetectedAt: &now,
				}, nil
			}
		}
	}

	return model.LogBackendConfig{Type: "unknown"}, nil
}

// QueryLogs 单集群日志查询（含 Count 预检 + 结果裁剪）
func (s *LogService) QueryLogs(ctx context.Context, req log.QueryRequest) (*log.QueryResult, error) {
	cfg, err := s.getLogBackend(req.ClusterID)
	if err != nil {
		return nil, fmt.Errorf("获取日志后端配置失败: %w", err)
	}

	adapter := log.NewAdapter(cfg)

	// Count 预检
	count, err := adapter.Count(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("日志计数失败: %w", err)
	}
	if count > 10000 {
		return nil, fmt.Errorf("该时间范围内匹配日志约 %d 条，建议缩小时间范围或增加过滤条件", count)
	}

	result, err := adapter.Query(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("日志查询失败: %w", err)
	}
	result.ClusterID = uint64(req.ClusterID)
	return result, nil
}

// QueryLogsMultiCluster 多集群日志查询（并发限制 5）
func (s *LogService) QueryLogsMultiCluster(ctx context.Context, clusterIDs []uint, req log.QueryRequest) ([]log.QueryResult, error) {
	if err := validateQuery(req, len(clusterIDs)); err != nil {
		return nil, err
	}

	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(5)

	var mu sync.Mutex
	results := make([]log.QueryResult, 0, len(clusterIDs))

	for _, cid := range clusterIDs {
		cid := cid
		reqCopy := req
		reqCopy.ClusterID = cid

		g.Go(func() error {
			qCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()

			res, err := s.QueryLogs(qCtx, reqCopy)
			if err != nil {
				res = &log.QueryResult{
					ClusterID: uint64(cid),
					Error:     err.Error(),
					Entries:   []log.LogEntry{},
				}
			}
			if res.Entries == nil {
				res.Entries = []log.LogEntry{}
			}

			mu.Lock()
			results = append(results, *res)
			mu.Unlock()
			return nil
		})
	}

	_ = g.Wait()
	return results, nil
}

// QueryHistogram 单集群时序聚合
func (s *LogService) QueryHistogram(ctx context.Context, clusterID uint, req log.QueryRequest) (*log.QueryResult, error) {
	cfg, err := s.getLogBackend(clusterID)
	if err != nil {
		return nil, fmt.Errorf("获取日志后端配置失败: %w", err)
	}

	adapter := log.NewAdapter(cfg)
	req.ClusterID = clusterID
	result, err := adapter.QueryHistogram(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("时序聚合失败: %w", err)
	}
	result.ClusterID = uint64(clusterID)
	return result, nil
}

// TestConnection 测试集群日志后端连通性
func (s *LogService) TestConnection(ctx context.Context, clusterID uint) error {
	cfg, err := s.getLogBackend(clusterID)
	if err != nil {
		return err
	}
	adapter := log.NewAdapter(cfg)
	return adapter.TestConnection(ctx)
}
