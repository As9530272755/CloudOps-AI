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
	query["aggs"] = e.buildLevelAggs()

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
		// aggregation 失败时降级为不带 aggs 的查询
		if resp.StatusCode == 400 {
			return e.queryWithoutAggs(ctx, req, index)
		}
		return nil, fmt.Errorf("ES search error: %d %s", resp.StatusCode, string(respBody))
	}

	return e.parseQueryResult(respBody, req, start), nil
}

func (e *ESAdapter) queryWithoutAggs(ctx context.Context, req QueryRequest, index string) (*QueryResult, error) {
	start := time.Now()
	query := e.buildQuery(req)
	delete(query, "aggs")
	body, _ := json.Marshal(query)
	esReq, _ := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/%s/_search", e.URL, index), bytes.NewReader(body))
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
	return e.parseQueryResult(respBody, req, start), nil
}

func (e *ESAdapter) parseQueryResult(respBody []byte, req QueryRequest, start time.Time) *QueryResult {
	result := &QueryResult{
		ClusterID:   uint64(req.ClusterID),
		Entries:     make([]LogEntry, 0),
		LevelCounts: make(map[string]int64),
		TookMs:      time.Since(start).Milliseconds(),
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
		Aggregations struct {
			ByLevel struct {
				Buckets map[string]struct {
					DocCount int64 `json:"doc_count"`
				} `json:"buckets"`
			} `json:"by_level"`
		} `json:"aggregations"`
	}
	if err := json.Unmarshal(respBody, &esResp); err != nil {
		return result
	}

	result.Total = esResp.Hits.Total.Value
	for _, h := range esResp.Hits.Hits {
		entry := e.sourceToEntry(h.Source, req)
		result.Entries = append(result.Entries, entry)
	}
	for k, b := range esResp.Aggregations.ByLevel.Buckets {
		result.LevelCounts[k] = b.DocCount
	}

	return result
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
		Entries:   make([]LogEntry, 0),
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
		// 现代采集方案通常使用统一索引，优先使用 all / app 的通用配置
		if logType == "all" || logType == "app" || logType == "ingress" || logType == "coredns" || logType == "lb" {
			if idx, ok := e.IndexPatterns["all"]; ok && idx != "" {
				return idx
			}
			if idx, ok := e.IndexPatterns["app"]; ok && idx != "" {
				return idx
			}
		}
		// 精确匹配
		if idx, ok := e.IndexPatterns[logType]; ok && idx != "" {
			return idx
		}
	}
	// 旧版硬编码回退
	switch logType {
	case "ingress":
		return "nginx-ingress-*"
	case "coredns", "lb", "app":
		return "logstash-*"
	default:
		return "logstash-*"
	}
}

func (e *ESAdapter) buildLevelFilter(level string) map[string]interface{} {
	switch level {
	case "error":
		return map[string]interface{}{
			"bool": map[string]interface{}{
				"should": []map[string]interface{}{
					{"terms": map[string]interface{}{"level.keyword": []string{"error", "err", "fatal"}}},
					{"wildcard": map[string]interface{}{"log.keyword": "*error*"}},
					{"wildcard": map[string]interface{}{"message.keyword": "*error*"}},
				},
				"minimum_should_match": 1,
			},
		}
	case "warn":
		return map[string]interface{}{
			"bool": map[string]interface{}{
				"should": []map[string]interface{}{
					{"terms": map[string]interface{}{"level.keyword": []string{"warn", "warning"}}},
					{"wildcard": map[string]interface{}{"log.keyword": "*warn*"}},
					{"wildcard": map[string]interface{}{"message.keyword": "*warn*"}},
				},
				"minimum_should_match": 1,
			},
		}
	case "info":
		return map[string]interface{}{
			"bool": map[string]interface{}{
				"should": []map[string]interface{}{
					{"terms": map[string]interface{}{"level.keyword": []string{"info", "noerror"}}},
					{"wildcard": map[string]interface{}{"log.keyword": "*info*"}},
					{"wildcard": map[string]interface{}{"message.keyword": "*info*"}},
				},
				"minimum_should_match": 1,
			},
		}
	case "other":
		return map[string]interface{}{
			"bool": map[string]interface{}{
				"must_not": []map[string]interface{}{
					{"terms": map[string]interface{}{"level.keyword": []string{"error", "err", "fatal", "warn", "warning", "info", "noerror"}}},
					{"wildcard": map[string]interface{}{"log.keyword": "*error*"}},
					{"wildcard": map[string]interface{}{"log.keyword": "*warn*"}},
					{"wildcard": map[string]interface{}{"log.keyword": "*info*"}},
					{"wildcard": map[string]interface{}{"message.keyword": "*error*"}},
					{"wildcard": map[string]interface{}{"message.keyword": "*warn*"}},
					{"wildcard": map[string]interface{}{"message.keyword": "*info*"}},
				},
			},
		}
	default:
		return map[string]interface{}{"match_all": map[string]interface{}{}}
	}
}

func (e *ESAdapter) buildLevelAggs() map[string]interface{} {
	return map[string]interface{}{
		"by_level": map[string]interface{}{
			"filters": map[string]interface{}{
				"filters": map[string]interface{}{
					"error": e.buildLevelFilter("error"),
					"warn":  e.buildLevelFilter("warn"),
					"info":  e.buildLevelFilter("info"),
					"other": e.buildLevelFilter("other"),
				},
			},
		},
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

	// 场景化自动识别：按组件 Pod/Container 名称前缀匹配（最准确）
	// fallback 到 message 精确特征匹配（兼容无 metadata 字段的采集配置）
	// 使用 prefix / match_phrase / match 等 ES 基础查询，不依赖 regexp/exists，不会触发 query_shard_exception
	var should []map[string]interface{}

	// 辅助：在多个可能的字段名上添加 prefix 查询（ES 中不存在的字段自动忽略，不会报错）
	addPrefix := func(values []string) {
		fields := []string{"kubernetes.pod_name", "pod_name", "kubernetes.container_name", "container_name"}
		for _, field := range fields {
			for _, v := range values {
				should = append(should, map[string]interface{}{"prefix": map[string]interface{}{field: v}})
			}
		}
	}
	// 辅助：在 message / log 上做 match_phrase 短语匹配
	addPhrase := func(phrases []string) {
		for _, phrase := range phrases {
			should = append(should,
				map[string]interface{}{"match_phrase": map[string]interface{}{"message": phrase}},
				map[string]interface{}{"match_phrase": map[string]interface{}{"log": phrase}},
			)
		}
	}

	switch req.LogType {
	case "ingress":
		// 入口网关组件 Pod 前缀（覆盖常见 Ingress Controller）
		addPrefix([]string{"ingress-nginx", "nginx-ingress", "traefik", "kong", "haproxy-ingress"})
		// HTTP access log 强特征：协议版本（Nginx/Traefik 标准格式 "GET /xxx HTTP/1.1"）
		addPhrase([]string{"HTTP/1.1", "HTTP/1.0", "HTTP/2.0"})
		// JSON 结构化 HTTP 日志特征（如 KubeSphere 控制台请求日志）
		addPhrase([]string{"\"method\":\"GET\"", "\"method\":\"POST\"", "\"method\":\"PUT\"", "\"method\":\"DELETE\""})
		// 独立 method 字段
		for _, kw := range []string{"GET", "POST", "PUT", "DELETE", "PATCH"} {
			should = append(should, map[string]interface{}{"match": map[string]interface{}{"method": kw}})
		}
	case "coredns":
		// CoreDNS 组件 Pod 前缀
		addPrefix([]string{"coredns"})
		// CoreDNS 标准日志格式特征（"A IN domain.com" / "AAAA IN domain.com"）
		addPhrase([]string{"\"A IN ", "\"AAAA IN "})
		// DNS 响应码
		addPhrase([]string{"NOERROR", "NXDOMAIN", "SERVFAIL"})
		// CoreDNS 特有配置名
		addPhrase([]string{"Corefile", "cluster.local"})
	case "lb":
		// 负载均衡组件 Pod 前缀：
		//   kube-proxy — K8s Service 负载均衡（iptables/ipvs）
		//   metallb    — MetalLB 负载均衡器
		addPrefix([]string{"kube-proxy", "metallb"})
		// kube-proxy 日志特征（iptables/ipvs 规则同步）
		addPhrase([]string{"iptables", "ipvs", "proxier", "syncProxyRules"})
		// MetalLB 日志特征
		addPhrase([]string{"announcing", "memberlist", "load balancer"})
	}

	if len(should) > 0 {
		must = append(must, map[string]interface{}{
			"bool": map[string]interface{}{
				"should":               should,
				"minimum_should_match": 1,
			},
		})
	}

	// 全局关键字搜索：multi_match + wildcard 子串匹配，确保短关键词也能命中
	if kw, ok := req.Filters["keyword"]; ok && kw != "" {
		should := []map[string]interface{}{
			{"multi_match": map[string]interface{}{
				"query":     kw,
				"fields":    []string{"log^3", "message^3", "host", "path", "kubernetes.pod_name", "kubernetes.namespace_name", "kubernetes.container_name"},
				"type":      "best_fields",
				"fuzziness": "AUTO",
				"operator":  "or",
			}},
			{"wildcard": map[string]interface{}{"log.keyword": "*" + kw + "*"}},
			{"wildcard": map[string]interface{}{"message.keyword": "*" + kw + "*"}},
			{"wildcard": map[string]interface{}{"kubernetes.pod_name.keyword": "*" + kw + "*"}},
			{"wildcard": map[string]interface{}{"pod_name.keyword": "*" + kw + "*"}},
		}
		must = append(must, map[string]interface{}{
			"bool": map[string]interface{}{
				"should":               should,
				"minimum_should_match": 1,
			},
		})
	}

	// 命名空间过滤
	if ns, ok := req.Filters["namespace"]; ok && ns != "" {
		must = append(must, map[string]interface{}{
			"bool": map[string]interface{}{
				"should": []map[string]interface{}{
					{"term": map[string]interface{}{"kubernetes.namespace_name": ns}},
					{"term": map[string]interface{}{"namespace": ns}},
				},
				"minimum_should_match": 1,
			},
		})
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

	// 日志级别过滤
	if lvl, ok := req.Filters["level"]; ok && lvl != "" {
		must = append(must, e.buildLevelFilter(lvl))
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

	// 提取日志级别（供前端颜色标识）
	for _, lk := range []string{"level", "severity", "log_level", "lvl"} {
		if v, ok := source[lk]; ok {
			entry.Fields["level"] = fmt.Sprintf("%v", v)
			break
		}
	}

	// 保留有用字段到 Fields
	for _, k := range []string{"status", "method", "host", "path", "request_time", "upstream_response_time", "upstream_addr"} {
		if v, ok := source[k]; ok {
			entry.Fields[k] = v
		}
	}

	// 额外保留其他原始字段（排除已提取到顶层属性的常见键）
	extractedKeys := map[string]bool{
		"@timestamp": true, "timestamp": true, "log": true, "message": true,
		"kubernetes": true, "level": true, "severity": true, "log_level": true, "lvl": true,
	}
	for k, v := range source {
		if extractedKeys[k] {
			continue
		}
		if _, exists := entry.Fields[k]; !exists {
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
