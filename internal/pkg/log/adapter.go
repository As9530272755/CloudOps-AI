package log

import (
	"context"
	"time"
)

// LogEntry 单条日志
type LogEntry struct {
	Timestamp   string                 `json:"timestamp"`
	ClusterID   uint                   `json:"cluster_id"`
	ClusterName string                 `json:"cluster_name"`
	Namespace   string                 `json:"namespace"`
	PodName     string                 `json:"pod_name"`
	Container   string                 `json:"container"`
	Message     string                 `json:"message"`
	Fields      map[string]interface{} `json:"fields,omitempty"`
}

// HistogramPoint 时序直方图单点
type HistogramPoint struct {
	Time  time.Time `json:"time"`
	Count int64     `json:"count"`
}

// QueryRequest 日志查询请求
type QueryRequest struct {
	ClusterID   uint
	ClusterName string
	LogType     string // ingress | coredns | lb | app
	TimeRange   struct {
		From time.Time
		To   time.Time
	}
	Filters map[string]string
	Limit   int
	Offset  int
}

// QueryResult 日志查询结果
type QueryResult struct {
	ClusterID uint64           `json:"cluster_id"`
	Total     int64            `json:"total"`
	Entries   []LogEntry       `json:"entries"`
	Histogram []HistogramPoint `json:"histogram,omitempty"`
	Error     string           `json:"error,omitempty"`
	TookMs    int64            `json:"took_ms"`
}

// Adapter 日志后端适配器接口
type Adapter interface {
	Name() string
	TestConnection(ctx context.Context) error
	Count(ctx context.Context, req QueryRequest) (int64, error)
	Query(ctx context.Context, req QueryRequest) (*QueryResult, error)
	QueryHistogram(ctx context.Context, req QueryRequest) (*QueryResult, error)
}
