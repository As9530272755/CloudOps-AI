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

// validateQuery 校验查询参数（仅保留时间范围上限，解除过滤条件硬限制）
func validateQuery(req log.QueryRequest, backendCount int) error {
	duration := req.TimeRange.To.Sub(req.TimeRange.From)

	// 大幅放宽时间范围限制，20 集群也可查 7 天
	var maxDuration time.Duration
	switch {
	case backendCount == 1:
		maxDuration = 30 * 24 * time.Hour
	default:
		maxDuration = 7 * 24 * time.Hour
	}

	if duration > maxDuration {
		return fmt.Errorf("选中 %d 个后端时，最大允许查询范围为 %v", backendCount, maxDuration)
	}

	// 不再强制要求过滤条件；大数据量由 queryByBackend 自动降级采样

	if req.Limit <= 0 {
		req.Limit = 100
	}
	if req.Limit > 500 {
		req.Limit = 500
	}

	return nil
}

// ====== 日志后端 CRUD ======

func (s *LogService) ListLogBackends(clusterID uint, tenantID uint, userID uint) ([]model.ClusterLogBackend, error) {
	var list []model.ClusterLogBackend
	query := s.db.Order("id ASC")
	if clusterID > 0 {
		query = query.Where("cluster_id = ?", clusterID)
	}
	if tenantID > 0 {
		query = query.Where("tenant_id = ?", tenantID)
	}

	// namespace 级角色：只返回授权集群的日志后端
	if userID > 0 {
		rbacSvc := NewRBACService(s.db)
		scope, _, allowedClusters, _ := rbacSvc.GetDataScope(context.Background(), userID)
		if scope == "namespace" && len(allowedClusters) > 0 {
			query = query.Where("cluster_id IN ?", allowedClusters)
		}
	}

	err := query.Find(&list).Error
	return list, err
}

func (s *LogService) GetLogBackend(id uint) (model.ClusterLogBackend, error) {
	var b model.ClusterLogBackend
	err := s.db.First(&b, id).Error
	return b, err
}

func (s *LogService) CreateLogBackend(b *model.ClusterLogBackend) error {
	return s.db.Create(b).Error
}

// GetClusterTenantID 获取集群所属租户
func (s *LogService) GetClusterTenantID(clusterID uint) (uint, error) {
	var cluster model.Cluster
	if err := s.db.Select("tenant_id").First(&cluster, clusterID).Error; err != nil {
		return 0, err
	}
	return cluster.TenantID, nil
}

func (s *LogService) UpdateLogBackend(id uint, b *model.ClusterLogBackend) error {
	return s.db.Model(&model.ClusterLogBackend{}).Where("id = ?", id).Updates(map[string]interface{}{
		"name":           b.Name,
		"type":           b.Type,
		"url":            b.URL,
		"index_patterns": b.IndexPatterns,
		"headers":        b.Headers,
	}).Error
}

func (s *LogService) DeleteLogBackend(id uint) error {
	return s.db.Delete(&model.ClusterLogBackend{}, id).Error
}

// ====== 兼容旧版单条配置（用于自动发现兜底） ======

func (s *LogService) getLegacyLogBackend(clusterID uint) (model.LogBackendConfig, error) {
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

	if cfg.Type == "" || cfg.Type == "unknown" {
		detected, err := s.detectLogBackend(clusterID)
		if err != nil {
			return cfg, err
		}
		cfg = detected
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
						"ingress": "nginx-ingress-*",
						"coredns": "logstash-*",
						"lb":      "logstash-*",
						"app":     "logstash-*",
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
					IndexPatterns: map[string]string{
						"ingress": "nginx-ingress-*",
						"coredns": "logstash-*",
						"lb":      "logstash-*",
						"app":     "logstash-*",
					},
					DetectedAt: &now,
				}, nil
			}
		}
	}

	return model.LogBackendConfig{Type: "unknown"}, nil
}

// ====== 日志查询 ======

func (s *LogService) queryByBackend(ctx context.Context, backend model.ClusterLogBackend, req log.QueryRequest) (*log.QueryResult, error) {
	cfg := backend.ToConfig()
	adapter := log.NewAdapter(cfg)

	// Count 预检
	count, err := adapter.Count(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("日志计数失败: %w", err)
	}

	// 大数据量自动降级：允许正常翻页到 ES 默认窗口上限 (10000)，超出后提示
	if count > 50000 {
		const maxDeepPageOffset = 10000
		if req.Offset >= maxDeepPageOffset {
			maxPage := maxDeepPageOffset / req.Limit
			if req.Limit <= 0 {
				maxPage = 100
			}
			return nil, fmt.Errorf("数据量过大（约 %d 条），已到达分页上限（前 %d 页），请缩小时间范围或增加过滤条件", count, maxPage)
		}
		result, err := adapter.Query(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("日志查询失败: %w", err)
		}
		result.BackendID = uint64(backend.ID)
		result.ClusterID = uint64(backend.ClusterID)
		result.Total = count
		result.Message = fmt.Sprintf("该时间范围内匹配日志约 %d 条，已展示第 %d-%d 条，建议缩小时间范围或增加过滤条件", count, req.Offset+1, req.Offset+len(result.Entries))
		return result, nil
	}

	result, err := adapter.Query(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("日志查询失败: %w", err)
	}
	result.BackendID = uint64(backend.ID)
	result.ClusterID = uint64(backend.ClusterID)
	return result, nil
}

// QueryLogsMultiBackend 按 backend_id 并发查询（含权限过滤）
func (s *LogService) QueryLogsMultiBackend(ctx context.Context, backendIDs []uint, req log.QueryRequest, userID uint) ([]log.QueryResult, error) {
	if err := validateQuery(req, len(backendIDs)); err != nil {
		return nil, err
	}

	// namespace 级角色：过滤 backend_ids 为授权集群
	if userID > 0 {
		rbacSvc := NewRBACService(s.db)
		scope, _, allowedClusters, _ := rbacSvc.GetDataScope(ctx, userID)
		if scope == "namespace" && len(allowedClusters) > 0 {
			allowedSet := make(map[uint]bool)
			for _, cid := range allowedClusters {
				allowedSet[cid] = true
			}
			var filtered []uint
			for _, bid := range backendIDs {
				var b model.ClusterLogBackend
				if err := s.db.Select("cluster_id").First(&b, bid).Error; err == nil && allowedSet[b.ClusterID] {
					filtered = append(filtered, bid)
				}
			}
			backendIDs = filtered
		}
	}

	var backends []model.ClusterLogBackend
	if err := s.db.Where("id IN ?", backendIDs).Find(&backends).Error; err != nil {
		return nil, err
	}

	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(5)

	var mu sync.Mutex
	results := make([]log.QueryResult, 0, len(backends))

	for _, b := range backends {
		b := b
		reqCopy := req
		reqCopy.ClusterID = b.ClusterID
		g.Go(func() error {
			qCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()

			res, err := s.queryByBackend(qCtx, b, reqCopy)
			if err != nil {
				res = &log.QueryResult{
					BackendID: uint64(b.ID),
					ClusterID: uint64(b.ClusterID),
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

// QueryHistogram 单后端时序聚合
func (s *LogService) QueryHistogram(ctx context.Context, backendID uint, req log.QueryRequest) (*log.QueryResult, error) {
	backend, err := s.GetLogBackend(backendID)
	if err != nil {
		return nil, fmt.Errorf("获取日志后端失败: %w", err)
	}

	cfg := backend.ToConfig()
	adapter := log.NewAdapter(cfg)
	result, err := adapter.QueryHistogram(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("时序聚合失败: %w", err)
	}
	result.BackendID = uint64(backend.ID)
	result.ClusterID = uint64(backend.ClusterID)
	return result, nil
}

// TestConnection 测试指定后端连通性
func (s *LogService) TestConnection(ctx context.Context, backendID uint) error {
	backend, err := s.GetLogBackend(backendID)
	if err != nil {
		return err
	}
	cfg := backend.ToConfig()
	adapter := log.NewAdapter(cfg)
	return adapter.TestConnection(ctx)
}

// StartHealthMonitor 启动日志后端健康检查（每 30 秒一次）
func (s *LogService) StartHealthMonitor() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			var list []model.ClusterLogBackend
			if err := s.db.Find(&list).Error; err != nil {
				continue
			}
			for _, b := range list {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				err := s.TestConnection(ctx, b.ID)
				cancel()
				status := "offline"
				if err == nil {
					status = "online"
				}
				now := time.Now()
				_ = s.db.Model(&model.ClusterLogBackend{}).Where("id = ?", b.ID).Updates(map[string]interface{}{
					"status":          status,
					"last_checked_at": now,
				})
			}
		}
	}()
}
