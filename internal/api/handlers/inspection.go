package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// inspectionResultResp 用于把 Findings JSON 字符串解析为数组返回
type inspectionResultResp struct {
	model.InspectionResult
	Findings []map[string]interface{} `json:"findings"`
}

func toInspectionResultResp(r model.InspectionResult) inspectionResultResp {
	resp := inspectionResultResp{InspectionResult: r}
	if r.Findings != "" && r.Findings != "null" {
		_ = json.Unmarshal([]byte(r.Findings), &resp.Findings)
	}
	return resp
}

// InspectionHandler 巡检中心 Handler
type InspectionHandler struct {
	inspectionService *service.InspectionService
}

// NewInspectionHandler 创建Handler
func NewInspectionHandler(s *service.InspectionService) *InspectionHandler {
	return &InspectionHandler{inspectionService: s}
}

// taskReq 用于接收前端请求，cluster_ids 为数组
type taskReq struct {
	ID           uint     `json:"id"`
	Name         string   `json:"name" binding:"required"`
	Description  string   `json:"description"`
	Schedule     string   `json:"schedule"`
	ScheduleType string   `json:"schedule_type"`
	Timezone     string   `json:"timezone"`
	Enabled      bool     `json:"enabled"`
	RetryTimes   int      `json:"retry_times"`
	ClusterIDs   []uint   `json:"cluster_ids"`
	RulesConfig  string   `json:"rules_config"`
	NotifyConfig string   `json:"notify_config"`
}

func toInspectionTask(req taskReq) model.InspectionTask {
	clusterIDsStr := ""
	if len(req.ClusterIDs) > 0 {
		b, _ := json.Marshal(req.ClusterIDs)
		clusterIDsStr = string(b)
	}
	return model.InspectionTask{
		Name:         req.Name,
		Description:  req.Description,
		Schedule:     req.Schedule,
		ScheduleType: req.ScheduleType,
		Timezone:     req.Timezone,
		Enabled:      req.Enabled,
		RetryTimes:   req.RetryTimes,
		ClusterIDs:   clusterIDsStr,
		RulesConfig:  req.RulesConfig,
		NotifyConfig: req.NotifyConfig,
	}
}

// taskResp 用于返回给前端，cluster_ids 为数组
type taskResp struct {
	ID           uint      `json:"id"`
	TenantID     uint      `json:"tenant_id"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	Schedule     string    `json:"schedule"`
	ScheduleType string    `json:"schedule_type"`
	Timezone     string    `json:"timezone"`
	Enabled      bool      `json:"enabled"`
	RetryTimes   int       `json:"retry_times"`
	ClusterIDs   []uint    `json:"cluster_ids"`
	RulesConfig  string    `json:"rules_config"`
	NotifyConfig string    `json:"notify_config"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func toTaskResp(task model.InspectionTask) taskResp {
	resp := taskResp{
		ID:           task.ID,
		TenantID:     task.TenantID,
		Name:         task.Name,
		Description:  task.Description,
		Schedule:     task.Schedule,
		ScheduleType: task.ScheduleType,
		Timezone:     task.Timezone,
		Enabled:      task.Enabled,
		RetryTimes:   task.RetryTimes,
		RulesConfig:  task.RulesConfig,
		NotifyConfig: task.NotifyConfig,
		CreatedAt:    task.CreatedAt,
		UpdatedAt:    task.UpdatedAt,
	}
	if task.ClusterIDs != "" && task.ClusterIDs != "null" {
		_ = json.Unmarshal([]byte(task.ClusterIDs), &resp.ClusterIDs)
	}
	return resp
}

// ==================== 任务管理 ====================

// CreateTask 创建巡检任务
func (h *InspectionHandler) CreateTask(c *gin.Context) {
	var req taskReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if req.Timezone == "" {
		req.Timezone = "Asia/Shanghai"
	}
	if len(req.ClusterIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "请至少选择一个关联集群"})
		return
	}
	task := toInspectionTask(req)
	task.TenantID = c.GetUint("tenant_id")
	if err := h.inspectionService.CreateTask(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": toTaskResp(task)})
}

// ListTasks 任务列表
func (h *InspectionHandler) ListTasks(c *gin.Context) {
	query := h.inspectionService.DB().Order("updated_at DESC")
	// 非 superuser 只查本租户
	if !c.GetBool("is_superuser") {
		query = query.Where("tenant_id = ?", c.GetUint("tenant_id"))
	}
	var tasks []model.InspectionTask
	if err := query.Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	var resp []taskResp
	for _, t := range tasks {
		resp = append(resp, toTaskResp(t))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": resp})
}

// GetTask 任务详情
func (h *InspectionHandler) GetTask(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var task model.InspectionTask
	if err := h.inspectionService.DB().First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "任务不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": toTaskResp(task)})
}

// UpdateTask 修改任务
func (h *InspectionHandler) UpdateTask(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req taskReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	task := toInspectionTask(req)
	if len(req.ClusterIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "请至少选择一个关联集群"})
		return
	}
	task.ID = uint(id)
	task.TenantID = c.GetUint("tenant_id")
	if err := h.inspectionService.UpdateTask(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": toTaskResp(task)})
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

// QuickInspect 一键快速巡检
func (h *InspectionHandler) QuickInspect(c *gin.Context) {
	var req struct {
		ClusterIDs []uint `json:"cluster_ids"`
	}
	_ = c.ShouldBindJSON(&req)
	job, err := h.inspectionService.QuickInspect(c.Request.Context(), req.ClusterIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": job, "message": "一键巡检已触发"})
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

	// 组装任务名称
	type jobItem struct {
		model.InspectionJob
		TaskName string `json:"task_name"`
	}
	var items []jobItem
	for _, j := range jobs {
		item := jobItem{InspectionJob: j}
		if j.TaskID == 0 {
			item.TaskName = "一键巡检"
		} else {
			var task model.InspectionTask
			if err := h.inspectionService.DB().Select("name").First(&task, j.TaskID).Error; err == nil {
				item.TaskName = task.Name
			} else {
				item.TaskName = "未知任务"
			}
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items, "total": total, "page": page, "limit": limit}})
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
	h.inspectionService.DB().Where("job_id = ?", id).Where("cluster_id IN (?)", h.inspectionService.DB().Model(&model.Cluster{}).Select("id")).Find(&results)

	var resp []inspectionResultResp
	for _, r := range results {
		resp = append(resp, toInspectionResultResp(r))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"job": job, "results": resp}})
}

// GetResult 单集群结果详情
func (h *InspectionHandler) GetResult(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var res model.InspectionResult
	if err := h.inspectionService.DB().First(&res, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "记录不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": toInspectionResultResp(res)})
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
