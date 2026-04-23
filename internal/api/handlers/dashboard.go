package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/cloudops/platform/internal/service"
)

// DashboardHandler 仪表盘处理器
type DashboardHandler struct {
	dbService *service.DashboardService
}

// NewDashboardHandler 创建处理器
func NewDashboardHandler(dbService *service.DashboardService) *DashboardHandler {
	return &DashboardHandler{dbService: dbService}
}

// CreateDashboard 创建仪表盘
func (h *DashboardHandler) CreateDashboard(c *gin.Context) {
	var req service.CreateDashboardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	tenantID := c.GetUint("tenant_id")
	d, err := h.dbService.CreateDashboard(c.Request.Context(), tenantID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": d})
}

// ListDashboards 列表
func (h *DashboardHandler) ListDashboards(c *gin.Context) {
	var tenantID uint
	if !c.GetBool("is_superuser") {
		tenantID = c.GetUint("tenant_id")
	}
	list, err := h.dbService.ListDashboards(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": list})
}

// GetDashboard 详情
func (h *DashboardHandler) GetDashboard(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	d, err := h.dbService.GetDashboard(c.Request.Context(), tenantID.(uint), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "dashboard not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": d})
}

// GetDefaultDashboard 获取默认仪表盘
func (h *DashboardHandler) GetDefaultDashboard(c *gin.Context) {
	tenantID, _ := c.Get("tenant_id")
	d, err := h.dbService.GetDefaultDashboard(c.Request.Context(), tenantID.(uint))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "no dashboard found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": d})
}

// UpdateDashboard 更新
func (h *DashboardHandler) UpdateDashboard(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	var req service.CreateDashboardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	d, err := h.dbService.UpdateDashboard(c.Request.Context(), tenantID.(uint), uint(id), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": d})
}

// DeleteDashboard 删除
func (h *DashboardHandler) DeleteDashboard(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	if err := h.dbService.DeleteDashboard(c.Request.Context(), tenantID.(uint), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "deleted"})
}

// SetDefaultDashboard 设置默认仪表盘
func (h *DashboardHandler) SetDefaultDashboard(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid id"})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	if err := h.dbService.SetDefaultDashboard(c.Request.Context(), tenantID.(uint), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已设为默认仪表盘"})
}

// CreatePanel 创建面板
func (h *DashboardHandler) CreatePanel(c *gin.Context) {
	dashboardID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid dashboard id"})
		return
	}

	var req service.DashboardPanelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	panel, err := h.dbService.CreatePanel(c.Request.Context(), tenantID.(uint), uint(dashboardID), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": panel})
}

// ListPanels 列表面板
func (h *DashboardHandler) ListPanels(c *gin.Context) {
	dashboardID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid dashboard id"})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	panels, err := h.dbService.ListPanels(c.Request.Context(), tenantID.(uint), uint(dashboardID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": panels})
}

// UpdatePanel 更新面板
func (h *DashboardHandler) UpdatePanel(c *gin.Context) {
	dashboardID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid dashboard id"})
		return
	}
	panelID, err := strconv.Atoi(c.Param("panel_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid panel id"})
		return
	}

	var req service.DashboardPanelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	panel, err := h.dbService.UpdatePanel(c.Request.Context(), tenantID.(uint), uint(dashboardID), uint(panelID), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": panel})
}

// DeletePanel 删除面板
func (h *DashboardHandler) DeletePanel(c *gin.Context) {
	dashboardID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid dashboard id"})
		return
	}
	panelID, err := strconv.Atoi(c.Param("panel_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid panel id"})
		return
	}

	tenantID, _ := c.Get("tenant_id")
	if err := h.dbService.DeletePanel(c.Request.Context(), tenantID.(uint), uint(dashboardID), uint(panelID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "deleted"})
}
