package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

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

// LogQueryRequest 日志查询请求
type LogQueryRequest struct {
	ClusterIDs []uint            `json:"cluster_ids" binding:"required,min=1,max=20"`
	LogType    string            `json:"log_type" binding:"required,oneof=ingress coredns lb app"`
	TimeRange  struct {
		From time.Time `json:"from" binding:"required"`
		To   time.Time `json:"to" binding:"required"`
	} `json:"time_range"`
	Filters map[string]string `json:"filters"`
	Limit   int               `json:"limit" binding:"min=1,max=500"`
	Offset  int               `json:"offset" binding:"min=0"`
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
	}
	qReq.TimeRange.From = req.TimeRange.From
	qReq.TimeRange.To = req.TimeRange.To

	results, err := h.logService.QueryLogsMultiCluster(c.Request.Context(), req.ClusterIDs, qReq)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 合并统计
	var total int64
	var allEntries []log.LogEntry
	for _, r := range results {
		total += r.Total
		allEntries = append(allEntries, r.Entries...)
	}

	// 按时间倒序合并后截断
	if len(allEntries) > req.Limit {
		allEntries = allEntries[:req.Limit]
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"total":      total,
			"limit":      req.Limit,
			"offset":     req.Offset,
			"cluster_results": results,
			"entries":    allEntries,
		},
	})
}

// QueryHistogram 查询日志时序分布
func (h *LogHandler) QueryHistogram(c *gin.Context) {
	var req struct {
		ClusterID uint              `json:"cluster_id" binding:"required"`
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

	result, err := h.logService.QueryHistogram(c.Request.Context(), req.ClusterID, qReq)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// TestLogBackend 测试集群日志后端连通性
func (h *LogHandler) TestLogBackend(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的集群 ID"})
		return
	}

	if err := h.logService.TestConnection(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "日志后端连接正常"})
}

// AnalyzeLogs AI 分析日志
func (h *LogHandler) AnalyzeLogs(c *gin.Context) {
	var req struct {
		ClusterIDs []uint   `json:"cluster_ids" binding:"required"`
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

	// 先查询日志（限制 100 条用于分析）
	qReq := log.QueryRequest{
		LogType: req.LogType,
		Filters: req.Filters,
		Limit:   100,
	}
	qReq.TimeRange.From = req.TimeRange.From
	qReq.TimeRange.To = req.TimeRange.To

	results, err := h.logService.QueryLogsMultiCluster(c.Request.Context(), req.ClusterIDs, qReq)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 提取错误日志优先，构造 Prompt
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

	// 采样：错误优先 + 补充正常日志，总长度控制
	sample := buildLogSample(errorLogs, normalLogs, 8000)
	if len(sample) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": "未找到符合条件的日志"})
		return
	}

	// TODO: 调用 AI 分析（此处复用 AIService.AnalyzeLogs，需要依赖注入）
	// 当前简化返回采样日志，供前端展示或后续接入 AI Stream
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"sample":     sample,
			"error_count": len(errorLogs),
			"total_count": len(errorLogs) + len(normalLogs),
		},
	})
}

func buildLogSample(errorLogs, normalLogs []string, maxChars int) string {
	var sb strings.Builder
	added := make(map[string]bool)

	// 先加错误日志
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

	// 再补正常日志
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
