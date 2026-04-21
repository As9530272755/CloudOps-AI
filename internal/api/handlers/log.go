package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/log"
	"github.com/cloudops/platform/internal/service"
)

// LogHandler 日志管理 Handler
type LogHandler struct {
	logService *service.LogService
}

// NewLogHandler 创建日志 Handler
func NewLogHandler(logService *service.LogService) *LogHandler {
	return &LogHandler{logService: logService}
}

// ====== 日志查询 ======

type LogQueryRequest struct {
	BackendIDs []uint            `json:"backend_ids" binding:"required,min=1,max=20"`
	LogType    string            `json:"log_type" binding:"required,oneof=all ingress coredns lb app"`
	TimeRange  struct {
		From time.Time `json:"from" binding:"required"`
		To   time.Time `json:"to" binding:"required"`
	} `json:"time_range"`
	Filters map[string]string `json:"filters"`
	Limit   int               `json:"limit" binding:"min=1,max=500"`
	Offset  int               `json:"offset" binding:"min=0"`
	Mode    string            `json:"mode,omitempty"`
}

// QueryLogs 查询日志
func (h *LogHandler) QueryLogs(c *gin.Context) {
	var req LogQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if req.Limit == 0 {
		req.Limit = 100
	}

	qReq := log.QueryRequest{
		LogType: req.LogType,
		Filters: req.Filters,
		Limit:   req.Limit,
		Offset:  req.Offset,
		Mode:    req.Mode,
	}
	qReq.TimeRange.From = req.TimeRange.From
	qReq.TimeRange.To = req.TimeRange.To

	userID := c.GetUint("user_id")
	results, err := h.logService.QueryLogsMultiBackend(c.Request.Context(), req.BackendIDs, qReq, userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	var total int64
	allEntries := make([]log.LogEntry, 0)
	levelCounts := make(map[string]int64)
	for _, r := range results {
		total += r.Total
		allEntries = append(allEntries, r.Entries...)
		for k, v := range r.LevelCounts {
			levelCounts[k] += v
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"total":           total,
			"limit":             req.Limit,
			"offset":            req.Offset,
			"backend_results": results,
			"entries":           allEntries,
			"level_counts":    levelCounts,
		},
	})
}

// QueryHistogram 查询日志时序分布
func (h *LogHandler) QueryHistogram(c *gin.Context) {
	var req struct {
		BackendID uint              `json:"backend_id" binding:"required"`
		LogType   string            `json:"log_type" binding:"required"`
		TimeRange struct {
			From time.Time `json:"from" binding:"required"`
			To   time.Time `json:"to" binding:"required"`
		} `json:"time_range"`
		Filters map[string]string `json:"filters"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	qReq := log.QueryRequest{
		LogType: req.LogType,
		Filters: req.Filters,
	}
	qReq.TimeRange.From = req.TimeRange.From
	qReq.TimeRange.To = req.TimeRange.To

	result, err := h.logService.QueryHistogram(c.Request.Context(), req.BackendID, qReq)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// AnalyzeLogs AI 分析日志
func (h *LogHandler) AnalyzeLogs(c *gin.Context) {
	var req struct {
		BackendIDs []uint   `json:"backend_ids" binding:"required"`
		LogType    string   `json:"log_type" binding:"required"`
		TimeRange  struct {
			From time.Time `json:"from" binding:"required"`
			To   time.Time `json:"to" binding:"required"`
		} `json:"time_range"`
		Filters map[string]string `json:"filters"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	qReq := log.QueryRequest{
		LogType: req.LogType,
		Filters: req.Filters,
		Limit:   100,
	}
	qReq.TimeRange.From = req.TimeRange.From
	qReq.TimeRange.To = req.TimeRange.To

	userID := c.GetUint("user_id")
	results, err := h.logService.QueryLogsMultiBackend(c.Request.Context(), req.BackendIDs, qReq, userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	var errorLogs []string
	var normalLogs []string
	for _, r := range results {
		for _, e := range r.Entries {
			msg := strings.TrimSpace(e.Message)
			if msg == "" {
				continue
			}
			if req.LogType == "ingress" {
				if status, ok := e.Fields["status"]; ok {
					if s, _ := strconv.Atoi(fmt.Sprintf("%v", status)); s >= 400 {
						errorLogs = append(errorLogs, msg)
						continue
					}
				}
			}
			normalLogs = append(normalLogs, msg)
		}
	}

	sample := buildLogSample(errorLogs, normalLogs, 8000)
	if len(sample) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": "未找到符合条件的日志"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"sample":      sample,
			"error_count": len(errorLogs),
			"total_count": len(errorLogs) + len(normalLogs),
		},
	})
}

func buildLogSample(errorLogs, normalLogs []string, maxChars int) string {
	var sb strings.Builder
	added := make(map[string]bool)

	for _, l := range errorLogs {
		if added[l] {
			continue
		}
		if sb.Len()+len(l)+1 > maxChars {
			break
		}
		sb.WriteString(l)
		sb.WriteByte('\n')
		added[l] = true
	}

	for _, l := range normalLogs {
		if added[l] {
			continue
		}
		if sb.Len()+len(l)+1 > maxChars {
			break
		}
		sb.WriteString(l)
		sb.WriteByte('\n')
		added[l] = true
	}

	return sb.String()
}

func fillBackendResp(b model.ClusterLogBackend) model.ClusterLogBackend {
	if b.IndexPatterns != "" {
		_ = json.Unmarshal([]byte(b.IndexPatterns), &b.IndexPatternsMap)
	}
	if b.Headers != "" {
		_ = json.Unmarshal([]byte(b.Headers), &b.HeadersMap)
	}
	return b
}

// ====== 日志后端配置 CRUD ======

// ListLogBackends 列出日志后端
func (h *LogHandler) ListLogBackends(c *gin.Context) {
	clusterID, _ := strconv.Atoi(c.Query("cluster_id"))
	var tenantID uint
	if !c.GetBool("is_superuser") {
		tenantID = c.GetUint("tenant_id")
	}
	userID := c.GetUint("user_id")
	list, err := h.logService.ListLogBackends(uint(clusterID), tenantID, userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	for i := range list {
		list[i] = fillBackendResp(list[i])
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": list})
}

// GetLogBackend 获取单个日志后端
func (h *LogHandler) GetLogBackend(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的后端 ID"})
		return
	}
	backend, err := h.logService.GetLogBackend(uint(id))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	backend = fillBackendResp(backend)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": backend})
}

// CreateLogBackend 创建日志后端
func (h *LogHandler) CreateLogBackend(c *gin.Context) {
	var req struct {
		model.ClusterLogBackend
		Headers map[string]string `json:"headers"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if req.Name == "" || req.URL == "" || req.Type == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "名称、类型和地址不能为空"})
		return
	}
	if req.IndexPatterns == "" {
		req.IndexPatterns = `{"ingress":"nginx-ingress-*","coredns":"logstash-*","lb":"logstash-*","app":"logstash-*"}`
	}
	if len(req.Headers) > 0 {
		b, _ := json.Marshal(req.Headers)
		req.ClusterLogBackend.Headers = string(b)
	}
	// 写入租户ID（从集群继承或从上下文获取）
	var tenantID uint
	if req.ClusterID > 0 {
		if tid, err := h.logService.GetClusterTenantID(req.ClusterID); err == nil {
			tenantID = tid
		}
	}
	if tenantID == 0 {
		tenantID = c.GetUint("tenant_id")
	}
	req.ClusterLogBackend.TenantID = tenantID

	if err := h.logService.CreateLogBackend(&req.ClusterLogBackend); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	req.ClusterLogBackend = fillBackendResp(req.ClusterLogBackend)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": req.ClusterLogBackend})
}

// UpdateLogBackend 更新日志后端
func (h *LogHandler) UpdateLogBackend(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的后端 ID"})
		return
	}

	var req struct {
		model.ClusterLogBackend
		Headers map[string]string `json:"headers"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if req.Name == "" || req.URL == "" || req.Type == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "名称、类型和地址不能为空"})
		return
	}
	if len(req.Headers) > 0 {
		b, _ := json.Marshal(req.Headers)
		req.ClusterLogBackend.Headers = string(b)
	}

	if err := h.logService.UpdateLogBackend(uint(id), &req.ClusterLogBackend); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "配置已保存"})
}

// DeleteLogBackend 删除日志后端
func (h *LogHandler) DeleteLogBackend(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的后端 ID"})
		return
	}

	if err := h.logService.DeleteLogBackend(uint(id)); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "配置已删除"})
}

// TestLogBackend 测试日志后端连通性
func (h *LogHandler) TestLogBackend(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的后端 ID"})
		return
	}

	if err := h.logService.TestConnection(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "日志后端连接正常"})
}
