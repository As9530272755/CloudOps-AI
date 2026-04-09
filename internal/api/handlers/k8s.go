package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/cloudops/platform/internal/service"
)

// K8sHandler K8s资源处理器
type K8sHandler struct {
	k8sService *service.K8sResourceService
}

// NewK8sHandler 创建K8s处理器
func NewK8sHandler(k8sService *service.K8sResourceService) *K8sHandler {
	return &K8sHandler{
		k8sService: k8sService,
	}
}

// ListResources 统一资源列表接口
// GET /api/v1/clusters/:id/resources/:kind
func (h *K8sHandler) ListResources(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	kind := c.Param("kind")
	namespace := c.DefaultQuery("namespace", "")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 500 {
		limit = 500
	}

	items, total, err := h.k8sService.ListResources(c.Request.Context(), uint(clusterID), kind, namespace, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items": items,
			"total": total,
			"page":  page,
			"limit": limit,
		},
	})
}

// GetResourceYAML 获取资源YAML
// GET /api/v1/clusters/:id/resources/:kind/:name/yaml
func (h *K8sHandler) GetResourceYAML(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	kind := c.Param("kind")
	name := c.Param("name")
	namespace := c.Query("namespace")

	yamlStr, err := h.k8sService.GetResourceYAML(c.Request.Context(), uint(clusterID), kind, namespace, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    yamlStr,
	})
}

// GetResource 获取资源详情
// GET /api/v1/clusters/:id/resources/:kind/:name
// 或 GET /api/v1/clusters/:id/resources/:kind/:namespace/:name
func (h *K8sHandler) GetResource(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	kind := c.Param("kind")
	name := c.Param("name")
	namespace := c.Query("namespace")

	item, err := h.k8sService.GetResource(c.Request.Context(), uint(clusterID), kind, namespace, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    item,
	})
}

// GetNamespaces 获取命名空间列表
// GET /api/v1/clusters/:id/namespaces
func (h *K8sHandler) GetNamespaces(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	items, err := h.k8sService.GetNamespaces(c.Request.Context(), uint(clusterID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    items,
	})
}

// RefreshCluster 手动刷新集群缓存
// POST /api/v1/clusters/:id/refresh
func (h *K8sHandler) RefreshCluster(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	if err := h.k8sService.RefreshCluster(c.Request.Context(), uint(clusterID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "cluster cache refreshed",
	})
}

// GetClusterStats 获取集群统计概览
// GET /api/v1/clusters/:id/stats
func (h *K8sHandler) GetClusterStats(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	stats, err := h.k8sService.GetClusterStats(c.Request.Context(), uint(clusterID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}
