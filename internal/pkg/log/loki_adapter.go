package log

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// LokiAdapter Loki 适配器（预留实现）
type LokiAdapter struct {
	URL     string
	Headers map[string]string
	client  *http.Client
}

// NewLokiAdapter 创建 Loki 适配器
func NewLokiAdapter(url string, headers map[string]string) *LokiAdapter {
	return &LokiAdapter{
		URL:     strings.TrimRight(url, "/"),
		Headers: headers,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (l *LokiAdapter) Name() string { return "loki" }

func (l *LokiAdapter) TestConnection(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", l.URL+"/ready", nil)
	if err != nil {
		return err
	}
	l.setHeaders(req)
	resp, err := l.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("loki ready check failed: %d %s", resp.StatusCode, string(body))
	}
	return nil
}

func (l *LokiAdapter) Count(ctx context.Context, req QueryRequest) (int64, error) {
	// Loki 没有原生 count API，先查询 limit=1 并依赖返回的 stats（简化版直接查询小量数据计数）
	// MVP 阶段预留：直接返回 0，表示跳过 count 预检或走兜底
	return 0, nil
}

func (l *LokiAdapter) Query(ctx context.Context, req QueryRequest) (*QueryResult, error) {
	queryStr := l.buildLogQL(req)
	u := fmt.Sprintf("%s/loki/api/v1/query_range?query=%s&start=%d&end=%d&limit=%d&direction=BACKWARD",
		l.URL,
		url.QueryEscape(queryStr),
		req.TimeRange.From.UnixNano(),
		req.TimeRange.To.UnixNano(),
		req.Limit,
	)

	httpReq, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	l.setHeaders(httpReq)

	resp, err := l.client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("loki query error: %d %s", resp.StatusCode, string(body))
	}

	result := &QueryResult{
		ClusterID: uint64(req.ClusterID),
		Entries:   make([]LogEntry, 0),
	}

	var lokiResp struct {
		Data struct {
			Result []struct {
				Stream map[string]string `json:"stream"`
				Values [][2]string       `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &lokiResp); err != nil {
		return nil, err
	}

	for _, r := range lokiResp.Data.Result {
		for _, v := range r.Values {
			entry := LogEntry{
				ClusterID: req.ClusterID,
				Timestamp: v[0],
				Message:   truncateMessage(v[1], 4096),
				Namespace: r.Stream["namespace"],
				PodName:   r.Stream["pod"],
				Container: r.Stream["container"],
			}
			result.Entries = append(result.Entries, entry)
		}
	}
	result.Total = int64(len(result.Entries))
	return result, nil
}

func (l *LokiAdapter) QueryHistogram(ctx context.Context, req QueryRequest) (*QueryResult, error) {
	queryStr := fmt.Sprintf("sum(count_over_time(%s[1m]))", l.buildLogQL(req))
	u := fmt.Sprintf("%s/loki/api/v1/query_range?query=%s&start=%d&end=%d&step=60",
		l.URL,
		url.QueryEscape(queryStr),
		req.TimeRange.From.UnixNano(),
		req.TimeRange.To.UnixNano(),
	)

	httpReq, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	l.setHeaders(httpReq)

	resp, err := l.client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("loki histogram error: %d %s", resp.StatusCode, string(body))
	}

	result := &QueryResult{
		ClusterID: uint64(req.ClusterID),
	}

	var lokiResp struct {
		Data struct {
			Result []struct {
				Values [][2]string `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &lokiResp); err != nil {
		return nil, err
	}

	for _, r := range lokiResp.Data.Result {
		for _, v := range r.Values {
			ts, _ := strconv.ParseInt(v[0], 10, 64)
			cnt, _ := strconv.ParseFloat(v[1], 64)
			result.Histogram = append(result.Histogram, HistogramPoint{
				Time:  time.UnixMilli(ts / 1e6),
				Count: int64(cnt),
			})
		}
	}
	return result, nil
}

func (l *LokiAdapter) setHeaders(req *http.Request) {
	for k, v := range l.Headers {
		req.Header.Set(k, v)
	}
}

func (l *LokiAdapter) buildLogQL(req QueryRequest) string {
	var selectors []string
	switch req.LogType {
	case "ingress":
		selectors = append(selectors, `{container="controller",namespace="ingress-nginx"}`)
	case "coredns":
		selectors = append(selectors, `{container="coredns",namespace="kube-system"}`)
	default:
		selectors = append(selectors, `{container=~".+",namespace=~"."}`)
	}

	// 这里简化处理：直接在 stream selector 后加 line filter
	pipeline := ""
	if host, ok := req.Filters["host"]; ok && host != "" {
		pipeline += fmt.Sprintf(` |~ "%s"`, host)
	}
	if path, ok := req.Filters["path"]; ok && path != "" {
		pipeline += fmt.Sprintf(` |~ "%s"`, path)
	}

	return selectors[0] + pipeline
}
