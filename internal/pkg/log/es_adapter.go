package log

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ESAdapter Elasticsearch 适配器
type ESAdapter struct {
	URL           string
	IndexPatterns map[string]string
	Headers       map[string]string
	client        *http.Client
}

// NewESAdapter 创建 ES 适配器
func NewESAdapter(url string, indexPatterns map[string]string, headers map[string]string) *ESAdapter {
	return &ESAdapter{
		URL:           strings.TrimRight(url, "/"),
		IndexPatterns: indexPatterns,
		Headers:       headers,
		client:        &http.Client{Timeout: 10 * time.Second},
	}
}

func (e *ESAdapter) Name() string { return "elasticsearch" }

func (e *ESAdapter) TestConnection(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", e.URL+"/_cluster/health", nil)
	if err != nil {
		return err
	}
	e.setHeaders(req)
	resp, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ES health check failed: %d %s", resp.StatusCode, string(body))
	}
	return nil
}

func (e *ESAdapter) Count(ctx context.Context, req QueryRequest) (int64, error) {
	index := e.resolveIndex(req.LogType)
	query := e.buildQuery(req)

	body, err := json.Marshal(map[string]interface{}{"query": query["query"]})
	if err != nil {
		return 0, err
	}

	esReq, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/%s/_count", e.URL, index), bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	esReq.Header.Set("Content-Type", "application/json")
	e.setHeaders(esReq)

	resp, err := e.client.Do(esReq)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return 0, fmt.Errorf("ES count error: %d %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Count int64 `json:"count"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return 0, err
	}
	return result.Count, nil
}

func (e *ESAdapter) Query(ctx context.Context, req QueryRequest) (*QueryResult, error) {
	start := time.Now()
	index := e.resolveIndex(req.LogType)
	query := e.buildQuery(req)

	body, err := json.Marshal(query)
	if err != nil {
		return nil, err
	}

	esReq, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/%s/_search", e.URL, index), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	esReq.Header.Set("Content-Type", "application/json")
	e.setHeaders(esReq)

	resp, err := e.client.Do(esReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ES search error: %d %s", resp.StatusCode, string(respBody))
	}

	result := &QueryResult{
		ClusterID: uint64(req.ClusterID),
		Entries:   make([]LogEntry, 0),
		TookMs:    time.Since(start).Milliseconds(),
	}

	var esResp struct {
		Hits struct {
			Total struct {
				Value int64 `json:"value"`
			} `json:"total"`
			Hits []struct {
				Source map[string]interface{} `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(respBody, &esResp); err != nil {
		return nil, err
	}

	result.Total = esResp.Hits.Total.Value
	for _, h := range esResp.Hits.Hits {
		entry := e.sourceToEntry(h.Source, req)
		result.Entries = append(result.Entries, entry)
	}

	return result, nil
}

func (e *ESAdapter) QueryHistogram(ctx context.Context, req QueryRequest) (*QueryResult, error) {
	start := time.Now()
	index := e.resolveIndex(req.LogType)
	query := e.buildQuery(req)

	// 固定 interval 为 1m，最大 60 个点
	query["aggs"] = map[string]interface{}{
		"histogram": map[string]interface{}{
			"date_histogram": map[string]interface{}{
				"field":    "@timestamp",
				"fixed_interval": "1m",
				"format":   "epoch_millis",
				"min_doc_count": 0,
				"extended_bounds": map[string]interface{}{
					"min": req.TimeRange.From.UnixMilli(),
					"max": req.TimeRange.To.UnixMilli(),
				},
			},
		},
	}
	query["size"] = 0

	body, err := json.Marshal(query)
	if err != nil {
		return nil, err
	}

	esReq, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/%s/_search", e.URL, index), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	esReq.Header.Set("Content-Type", "application/json")
	e.setHeaders(esReq)

	resp, err := e.client.Do(esReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ES histogram error: %d %s", resp.StatusCode, string(respBody))
	}

	result := &QueryResult{
		ClusterID: uint64(req.ClusterID),
		TookMs:    time.Since(start).Milliseconds(),
	}

	var esResp struct {
		Aggregations struct {
			Histogram struct {
				Buckets []struct {
					Key       int64 `json:"key"`
					DocCount  int64 `json:"doc_count"`
				} `json:"buckets"`
			} `json:"histogram"`
		} `json:"aggregations"`
	}
	if err := json.Unmarshal(respBody, &esResp); err != nil {
		return nil, err
	}

	result.Histogram = make([]HistogramPoint, 0, len(esResp.Aggregations.Histogram.Buckets))
	for _, b := range esResp.Aggregations.Histogram.Buckets {
		result.Histogram = append(result.Histogram, HistogramPoint{
			Time:  time.UnixMilli(b.Key),
			Count: b.DocCount,
		})
	}
	return result, nil
}

func (e *ESAdapter) setHeaders(req *http.Request) {
	for k, v := range e.Headers {
		req.Header.Set(k, v)
	}
}

func (e *ESAdapter) resolveIndex(logType string) string {
	if e.IndexPatterns != nil {
		if idx, ok := e.IndexPatterns[logType]; ok && idx != "" {
			return idx
		}
	}
	switch logType {
	case "ingress":
		return "nginx-ingress-*"
	case "coredns":
		return "logstash-*"
	case "lb":
		return "logstash-*"
	default:
		return "logstash-*"
	}
}

func (e *ESAdapter) buildQuery(req QueryRequest) map[string]interface{} {
	must := []map[string]interface{}{
		{
			"range": map[string]interface{}{
				"@timestamp": map[string]interface{}{
					"gte": req.TimeRange.From.Format(time.RFC3339),
					"lte": req.TimeRange.To.Format(time.RFC3339),
				},
			},
		},
	}

	// 根据 log_type 追加基础过滤
	switch req.LogType {
	case "ingress":
		must = append(must,
			map[string]interface{}{"term": map[string]interface{}{"kubernetes.container_name": "controller"}},
			map[string]interface{}{"term": map[string]interface{}{"kubernetes.namespace_name": "ingress-nginx"}},
		)
	case "coredns":
		must = append(must,
			map[string]interface{}{"term": map[string]interface{}{"kubernetes.container_name": "coredns"}},
			map[string]interface{}{"term": map[string]interface{}{"kubernetes.namespace_name": "kube-system"}},
		)
	}

	// 用户自定义过滤
	if host, ok := req.Filters["host"]; ok && host != "" {
		must = append(must, map[string]interface{}{"match_phrase": map[string]interface{}{"host": host}})
	}
	if path, ok := req.Filters["path"]; ok && path != "" {
		must = append(must, map[string]interface{}{"wildcard": map[string]interface{}{"path": path}})
	}
	if status, ok := req.Filters["status_code"]; ok && status != "" {
		must = append(must, map[string]interface{}{"term": map[string]interface{}{"status": status}})
	}
	if method, ok := req.Filters["method"]; ok && method != "" {
		must = append(must, map[string]interface{}{"term": map[string]interface{}{"method": method}})
	}
	if service, ok := req.Filters["service_name"]; ok && service != "" {
		must = append(must, map[string]interface{}{"match_phrase": map[string]interface{}{"upstream_name": service}})
	}
	if domain, ok := req.Filters["domain"]; ok && domain != "" {
		must = append(must, map[string]interface{}{"match_phrase": map[string]interface{}{"log": domain}})
	}
	if rcode, ok := req.Filters["rcode"]; ok && rcode != "" {
		must = append(must, map[string]interface{}{"match_phrase": map[string]interface{}{"log": rcode}})
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	return map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must": must,
			},
		},
		"sort": []map[string]interface{}{
			{"@timestamp": "desc"},
		},
		"size": limit,
		"from": req.Offset,
	}
}

func (e *ESAdapter) sourceToEntry(source map[string]interface{}, req QueryRequest) LogEntry {
	entry := LogEntry{
		ClusterID: req.ClusterID,
		Fields:    make(map[string]interface{}),
	}

	// 提取时间
	if ts, ok := source["@timestamp"]; ok {
		entry.Timestamp = fmt.Sprintf("%v", ts)
	} else if t, ok := source["timestamp"]; ok {
		entry.Timestamp = fmt.Sprintf("%v", t)
	}

	// 提取 k8s 元数据
	if k8s, ok := source["kubernetes"].(map[string]interface{}); ok {
		if ns, ok := k8s["namespace_name"]; ok {
			entry.Namespace = fmt.Sprintf("%v", ns)
		}
		if pod, ok := k8s["pod_name"]; ok {
			entry.PodName = fmt.Sprintf("%v", pod)
		}
		if c, ok := k8s["container_name"]; ok {
			entry.Container = fmt.Sprintf("%v", c)
		}
	}

	// 提取消息
	if msg, ok := source["log"]; ok {
		entry.Message = fmt.Sprintf("%v", msg)
	} else if msg, ok := source["message"]; ok {
		entry.Message = fmt.Sprintf("%v", msg)
	} else {
		// fallback: 序列化整个 source
		b, _ := json.Marshal(source)
		entry.Message = string(b)
	}

	// 保留有用字段到 Fields
	for _, k := range []string{"status", "method", "host", "path", "request_time", "upstream_response_time", "upstream_addr"} {
		if v, ok := source[k]; ok {
			entry.Fields[k] = v
		}
	}

	entry.Message = truncateMessage(entry.Message, 4096)
	return entry
}

func truncateMessage(msg string, max int) string {
	if len(msg) <= max {
		return msg
	}
	return msg[:max] + "\n... (truncated)"
}
