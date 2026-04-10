package handlers

import (
	"net/http"
	"strconv"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// InspectionHandler 巡检中心 Handler
type InspectionHandler struct {
	inspectionService *service.InspectionService
}

// NewInspectionHandler 创建Handler
func NewInspectionHandler(s *service.InspectionService) *InspectionHandler {
	return &InspectionHandler{inspectionService: s}
}

// ==================== 任务管理 ====================

// CreateTask 创建巡检任务
func (h *InspectionHandler) CreateTask(c *gin.Context) {
	var req model.InspectionTask
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if req.Timezone == "" {
		req.Timezone = "Asia/Shanghai"
	}
	if err := h.inspectionService.CreateTask(&req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": req})
}

// ListTasks 任务列表
func (h *InspectionHandler) ListTasks(c *gin.Context) {
	var tasks []model.InspectionTask
	if err := h.inspectionService.DB().Order("updated_at DESC").Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": tasks})
}

// GetTask 任务详情
func (h *InspectionHandler) GetTask(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var task model.InspectionTask
	if err := h.inspectionService.DB().First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "任务不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": task})
}

// UpdateTask 修改任务
func (h *InspectionHandler) UpdateTask(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req model.InspectionTask
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.inspectionService.UpdateTask(&req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": req})
}

// DeleteTask 删除任务
func (h *InspectionHandler) DeleteTask(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := h.inspectionService.DeleteTask(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// TriggerTask 手动触发巡检
func (h *InspectionHandler) TriggerTask(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := h.inspectionService.TriggerJob(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "巡检任务已触发"})
}

// ==================== 执行记录与报告 ====================

// ListJobs 执行历史
func (h *InspectionHandler) ListJobs(c *gin.Context) {
	taskID, _ := strconv.Atoi(c.Query("task_id"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	var jobs []model.InspectionJob
	db := h.inspectionService.DB().Order("created_at DESC")
	if taskID > 0 {
		db = db.Where("task_id = ?", taskID)
	}
	var total int64
	db.Model(&model.InspectionJob{}).Count(&total)
	db.Offset((page - 1) * limit).Limit(limit).Find(&jobs)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": jobs, "total": total, "page": page, "limit": limit}})
}

// GetJob 执行详情
func (h *InspectionHandler) GetJob(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var job model.InspectionJob
	if err := h.inspectionService.DB().First(&job, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "记录不存在"})
		return
	}
	var results []model.InspectionResult
	h.inspectionService.DB().Where("job_id = ?", id).Find(&results)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"job": job, "results": results}})
}

// GetResult 单集群结果详情
func (h *InspectionHandler) GetResult(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var res model.InspectionResult
	if err := h.inspectionService.DB().First(&res, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "记录不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": res})
}

// DownloadReport 下载报告
func (h *InspectionHandler) DownloadReport(c *gin.Context) {
	jobID, _ := strconv.Atoi(c.Param("id"))
	clusterID, _ := strconv.Atoi(c.Query("cluster_id"))
	format := c.DefaultQuery("format", "html")
	var res model.InspectionResult
	db := h.inspectionService.DB().Where("job_id = ?", jobID)
	if clusterID > 0 {
		db = db.Where("cluster_id = ?", clusterID)
	}
	if err := db.First(&res).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "报告不存在"})
		return
	}
	content := res.ReportHTML
	contentType := "text/html; charset=utf-8"
	filename := "report.html"
	if format == "md" {
		content = res.ReportMarkdown
		contentType = "text/markdown; charset=utf-8"
		filename = "report.md"
	}
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", "attachment; filename="+filename)
	c.String(http.StatusOK, content)
}
