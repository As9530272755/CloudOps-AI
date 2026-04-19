package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/cloudops/platform/internal/service"
)

// ClusterHandler 集群处理器
type ClusterHandler struct {
	clusterService *service.ClusterService
}

// NewClusterHandler 创建处理器
func NewClusterHandler(clusterService *service.ClusterService) *ClusterHandler {
	return &ClusterHandler{
		clusterService: clusterService,
	}
}

// CreateCluster 创建集群
func (h *ClusterHandler) CreateCluster(c *gin.Context) {
	var req service.CreateClusterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 从上下文获取用户信息
	userID := c.GetUint("user_id")
	tenantID := c.GetUint("tenant_id")

	cluster, err := h.clusterService.CreateCluster(c.Request.Context(),
		userID, tenantID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data":    cluster,
	})
}

// ListClusters 集群列表
func (h *ClusterHandler) ListClusters(c *gin.Context) {
	var tenantID uint
	if !c.GetBool("is_superuser") {
		tenantID = c.GetUint("tenant_id")
	}

	keyword := c.Query("keyword")
	status := c.Query("status")
	authType := c.Query("auth_type")

	clusters, err := h.clusterService.ListClusters(c.Request.Context(), tenantID, keyword, status, authType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    clusters,
	})
}

// GetCluster 获取集群详情
func (h *ClusterHandler) GetCluster(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	cluster, err := h.clusterService.GetCluster(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    cluster,
	})
}

// UpdateCluster 更新集群
func (h *ClusterHandler) UpdateCluster(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	var req service.UpdateClusterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	cluster, err := h.clusterService.UpdateCluster(c.Request.Context(), tenantID.(uint), uint(id), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    cluster,
	})
}

// DeleteCluster 删除集群
func (h *ClusterHandler) DeleteCluster(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	userID, _ := c.Get("user_id")
	tenantID, _ := c.Get("tenant_id")

	if err := h.clusterService.DeleteCluster(c.Request.Context(), 
		userID.(uint), tenantID.(uint), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "cluster deleted successfully",
	})
}

// TestAndProbeCluster 测试连接并探测监控标签
func (h *ClusterHandler) TestAndProbeCluster(c *gin.Context) {
	var req service.CreateClusterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	result, err := h.clusterService.TestAndProbeCluster(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}