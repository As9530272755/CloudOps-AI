package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/cloudops/platform/internal/service"
)

// DatasourceHandler 数据源处理器
type DatasourceHandler struct {
	dsService *service.DatasourceService
}

// NewDatasourceHandler 创建处理器
func NewDatasourceHandler(dsService *service.DatasourceService) *DatasourceHandler {
	return &DatasourceHandler{dsService: dsService}
}

// CreateDataSource 创建数据源
func (h *DatasourceHandler) CreateDataSource(c *gin.Context) {
	var req service.CreateDataSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	ds, err := h.dsService.CreateDataSource(c.Request.Context(), tenantID.(uint), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": ds})
}

// ListDataSources 数据源列表
func (h *DatasourceHandler) ListDataSources(c *gin.Context) {
	tenantID, _ := c.Get("tenant_id")
	dsType := c.Query("type")

	list, err := h.dsService.ListDataSources(c.Request.Context(), tenantID.(uint), dsType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": list})
}

// GetDataSource 获取详情
func (h *DatasourceHandler) GetDataSource(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	ds, err := h.dsService.GetDataSource(c.Request.Context(), tenantID.(uint), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "datasource not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": ds})
}

// UpdateDataSource 更新
func (h *DatasourceHandler) UpdateDataSource(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	var req service.CreateDataSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	ds, err := h.dsService.UpdateDataSource(c.Request.Context(), tenantID.(uint), uint(id), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": ds})
}

// DeleteDataSource 删除
func (h *DatasourceHandler) DeleteDataSource(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	if err := h.dsService.DeleteDataSource(c.Request.Context(), tenantID.(uint), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "deleted"})
}

// TestConnection 测试连通性
func (h *DatasourceHandler) TestConnection(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	ok, msg := h.dsService.TestConnection(c.Request.Context(), uint(id))
	if ok {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": msg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
}

// GetMetrics 获取指标名列表
func (h *DatasourceHandler) GetMetrics(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	ds, err := h.dsService.GetDataSource(c.Request.Context(), tenantID.(uint), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "datasource not found"})
		return
	}

	match := c.Query("match")
	metrics, err := h.dsService.GetPrometheusMetrics(c.Request.Context(), ds, match)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": metrics})
}

// ProxyQuery 代理查询
func (h *DatasourceHandler) ProxyQuery(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	var req service.ProxyQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	ds, err := h.dsService.GetDataSource(c.Request.Context(), tenantID.(uint), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "datasource not found"})
		return
	}

	result, err := h.dsService.ProxyPrometheusQuery(c.Request.Context(), ds, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
