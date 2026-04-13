package handlers

import (
	"net/http"
	"strconv"

	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// NetworkTraceHandler 网络追踪 Handler
type NetworkTraceHandler struct {
	svc *service.NetworkTraceService
}

// NewNetworkTraceHandler 创建 Handler
func NewNetworkTraceHandler(svc *service.NetworkTraceService) *NetworkTraceHandler {
	return &NetworkTraceHandler{svc: svc}
}

// ==================== 配置管理 ====================

// GetConfig 获取网络追踪配置
func (h *NetworkTraceHandler) GetConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": h.svc.GetSettings()})
}

// UpdateConfig 更新网络追踪配置
func (h *NetworkTraceHandler) UpdateConfig(c *gin.Context) {
	var req service.NetworkTraceSettings
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if err := h.svc.UpdateSettings(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": h.svc.GetSettings()})
}

// ==================== 调试 / 抓包 ====================

// CreateDebug 创建 Ephemeral Container 抓包
func (h *NetworkTraceHandler) CreateDebug(c *gin.Context) {
	clusterID, _ := strconv.Atoi(c.Param("id"))
	var req struct {
		Namespace string `json:"namespace" binding:"required"`
		Pod       string `json:"pod" binding:"required"`
		Image     string `json:"image"`
		Command   string `json:"command"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if err := h.svc.CreateEphemeralDebug(c.Request.Context(), uint(clusterID), req.Namespace, req.Pod, req.Image, req.Command); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "调试容器已注入"})
}

// GetDebugLogs 获取调试容器日志
func (h *NetworkTraceHandler) GetDebugLogs(c *gin.Context) {
	clusterID, _ := strconv.Atoi(c.Param("id"))
	namespace := c.Query("namespace")
	pod := c.Query("pod")
	if namespace == "" || pod == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "namespace 和 pod 不能为空"})
		return
	}
	logs, err := h.svc.GetDebugLogs(c.Request.Context(), uint(clusterID), namespace, pod)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": logs})
}

// ==================== 流量拓扑（Mock） ====================

// GetTopology 获取流量拓扑（真实 K8s 逻辑拓扑）
func (h *NetworkTraceHandler) GetTopology(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	namespace := c.DefaultQuery("namespace", "default")
	pod := c.Query("pod")

	topo, err := h.svc.BuildTopology(uint(id), namespace, pod)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": topo})
}

// EnhanceTopology 增强拓扑：K8s + Prometheus + 抓包解析
func (h *NetworkTraceHandler) EnhanceTopology(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req struct {
		Namespace string `json:"namespace" binding:"required"`
		Pod       string `json:"pod" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	topo, pm, aiSummary, err := h.svc.EnhanceTopology(c.Request.Context(), uint(id), req.Namespace, req.Pod)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"topology":   topo,
		"prometheus": pm,
		"ai_summary": aiSummary,
	}})
}

// GetPodTraffic 获取 Prometheus Pod 流量指标
func (h *NetworkTraceHandler) GetPodTraffic(c *gin.Context) {
	_, _ = strconv.Atoi(c.Param("id"))
	namespace := c.DefaultQuery("namespace", "default")
	pod := c.Query("pod")

	pm, err := h.svc.GetPodTrafficMetrics(c.Request.Context(), namespace, pod)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": pm})
}

// GetFlowList 获取流量列表（基于 pcap 解析）
func (h *NetworkTraceHandler) GetFlowList(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	namespace := c.DefaultQuery("namespace", "default")
	pod := c.Query("pod")

	pcapData, err := h.svc.GetDebugPcap(c.Request.Context(), uint(id), namespace, pod)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": []service.FlowItem{}, "message": err.Error()})
		return
	}

	flows, err := h.svc.ParsePcapToFlowItems(uint(id), namespace, pod, pcapData)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": []service.FlowItem{}, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": flows})
}

// GetTimeseries 获取时序数据（空数据占位）
func (h *NetworkTraceHandler) GetTimeseries(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"timestamps":        []string{},
			"bytesPerSecond":    []int{},
			"requestsPerSecond": []int{},
			"latencyP95":        []int{},
		},
	})
}
