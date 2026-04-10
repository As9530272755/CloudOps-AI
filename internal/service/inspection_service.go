package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/robfig/cron/v3"
	"gorm.io/gorm"
	corev1 "k8s.io/api/core/v1"
)

// InspectionService 巡检服务
type InspectionService struct {
	db          *gorm.DB
	k8sManager  *K8sManager
	dsService   *DatasourceService
	cron        *cron.Cron
	taskEntries map[uint]cron.EntryID
	mu          sync.Mutex
}

// NewInspectionService 创建巡检服务
func NewInspectionService(db *gorm.DB, k8sManager *K8sManager, dsService *DatasourceService) *InspectionService {
	s := &InspectionService{
		db:          db,
		k8sManager:  k8sManager,
		dsService:   dsService,
		cron:        cron.New(cron.WithSeconds(), cron.WithLocation(time.Local)),
		taskEntries: make(map[uint]cron.EntryID),
	}
	return s
}

// StartScheduler 启动调度器并加载已有定时任务
func (s *InspectionService) StartScheduler() error {
	var tasks []model.InspectionTask
	if err := s.db.Where("enabled = ? AND schedule != ?", true, "").Find(&tasks).Error; err != nil {
		return err
	}
	for _, task := range tasks {
		if err := s.registerTask(task); err != nil {
			continue // 注册失败继续下一个
		}
	}
	s.cron.Start()
	return nil
}

// StopScheduler 停止调度器
func (s *InspectionService) StopScheduler() {
	ctx := s.cron.Stop()
	<-ctx.Done()
}

// ReloadTask 重新加载单个任务到调度器
func (s *InspectionService) ReloadTask(task model.InspectionTask) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entryID, ok := s.taskEntries[task.ID]; ok {
		s.cron.Remove(entryID)
		delete(s.taskEntries, task.ID)
	}
	if !task.Enabled || task.Schedule == "" {
		return nil
	}
	return s.registerTask(task)
}

func (s *InspectionService) registerTask(task model.InspectionTask) error {
	entryID, err := s.cron.AddFunc(task.Schedule, func() {
		s.triggerJob(task.ID, "scheduled")
	})
	if err != nil {
		return err
	}
	s.taskEntries[task.ID] = entryID
	return nil
}

// triggerJob 触发单次巡检
func (s *InspectionService) triggerJob(taskID uint, triggerType string) {
	ctx := context.Background()

	var task model.InspectionTask
	if err := s.db.First(&task, taskID).Error; err != nil {
		return
	}

	// 创建 Job 记录
	job := model.InspectionJob{
		TaskID:      taskID,
		Status:      "running",
		TriggerType: triggerType,
		StartedAt:   ptrTime(time.Now()),
	}
	if err := s.db.Create(&job).Error; err != nil {
		return
	}

	// 解析集群 ID 列表
	var clusterIDs []uint
	if task.ClusterIDs != "" && task.ClusterIDs != "null" {
		_ = json.Unmarshal([]byte(task.ClusterIDs), &clusterIDs)
	}
	if len(clusterIDs) == 0 {
		var clusters []model.Cluster
		if err := s.db.Where("is_active = ?", true).Find(&clusters).Error; err == nil {
			for _, c := range clusters {
				clusterIDs = append(clusterIDs, c.ID)
			}
		}
	}
	job.TotalClusters = len(clusterIDs)
	s.db.Save(&job)

	var wg sync.WaitGroup
	resultCh := make(chan *model.InspectionResult, len(clusterIDs))

	for _, cid := range clusterIDs {
		wg.Add(1)
		go func(clusterID uint) {
			defer wg.Done()
			res := s.inspectCluster(ctx, clusterID, task)
			res.JobID = job.ID
			resultCh <- res
		}(cid)
	}

	go func() {
		wg.Wait()
		close(resultCh)
	}()

	// 收集结果
	var successCount, failedCount int
	var totalScore int
	maxRisk := 0 // 0:low 1:medium 2:high 3:critical
	riskMap := map[string]int{"low": 0, "medium": 1, "high": 2, "critical": 3}

	for res := range resultCh {
		if res.Status == "success" {
			successCount++
			totalScore += res.Score
			if riskMap[res.RiskLevel] > maxRisk {
				maxRisk = riskMap[res.RiskLevel]
			}
		} else {
			failedCount++
		}
		s.db.Create(res)
	}

	// 更新 Job
	now := time.Now()
	job.FinishedAt = &now
	job.SuccessCount = successCount
	job.FailedCount = failedCount
	if successCount > 0 {
		job.ScoreAvg = totalScore / successCount
	}

	riskLevels := []string{"low", "medium", "high", "critical"}
	job.RiskLevel = riskLevels[maxRisk]

	if failedCount == 0 && successCount > 0 {
		job.Status = "success"
	} else if successCount > 0 {
		job.Status = "partial"
	} else {
		job.Status = "failed"
	}
	s.db.Save(&job)
}

// inspectCluster 执行单个集群巡检
func (s *InspectionService) inspectCluster(ctx context.Context, clusterID uint, task model.InspectionTask) *model.InspectionResult {
	res := &model.InspectionResult{
		ClusterID: clusterID,
		Status:    "success",
		Score:     100,
		RiskLevel: "low",
		Findings:  "[]",
	}

	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		res.Status = "failed"
		res.ErrorMsg = "集群未连接"
		return res
	}

	var cluster model.Cluster
	if err := s.db.First(&cluster, clusterID).Error; err != nil {
		res.Status = "failed"
		res.ErrorMsg = "集群信息不存在"
		return res
	}

	// 获取 Prometheus 数据源（取第一个活跃的）
	var promData *PrometheusData
	if s.dsService != nil {
		promData = s.queryPrometheusData(ctx, cluster.TenantID, clusterID, cc)
	}

	// 内置检查项（K8s API + Prometheus 结合）
	var findings []Finding
	findings = append(findings, s.checkNodeReadiness(cc, clusterID)...)
	findings = append(findings, s.checkPodHealth(cc, clusterID)...)
	findings = append(findings, s.checkNodeResources(cc, clusterID, promData)...)
	findings = append(findings, s.checkUnschedulableNodes(cc, clusterID)...)
	findings = append(findings, s.checkControlPlane(cc, clusterID)...)
	if promData != nil {
		findings = append(findings, s.checkPrometheusMetrics(promData, clusterID)...)
	}

	score, riskLevel := calculateScore(findings)
	res.Score = score
	res.RiskLevel = riskLevel

	b, _ := json.Marshal(findings)
	res.Findings = string(b)
	res.ReportHTML = generateHTMLReport(cluster, findings, score, riskLevel, promData)
	res.ReportMarkdown = generateMarkdownReport(cluster, findings, score, riskLevel, promData)

	return res
}

// ==================== 内置检查规则 ====================

// Finding 单条检查结果
type Finding struct {
	Category   string      `json:"category"`
	Name       string      `json:"name"`
	Level      string      `json:"level"`      // pass / info / warning / critical
	Actual     interface{} `json:"actual"`
	Expected   interface{} `json:"expected"`
	Message    string      `json:"message"`
	Suggestion string      `json:"suggestion"`
	Weight     int         `json:"weight"`
}

func (s *InspectionService) checkNodeReadiness(cc *ClusterClient, clusterID uint) []Finding {
	var findings []Finding
	store := cc.NodeStore
	if store == nil {
		findings = append(findings, Finding{Category: "node", Name: "节点就绪率", Level: "critical", Message: "无法获取节点信息", Weight: 20})
		return findings
	}
	items := store.List()
	if len(items) == 0 {
		findings = append(findings, Finding{Category: "node", Name: "节点就绪率", Level: "warning", Message: "集群中无节点", Weight: 20})
		return findings
	}
	ready := 0
	for _, obj := range items {
		node := obj.(*corev1.Node)
		for _, c := range node.Status.Conditions {
			if c.Type == corev1.NodeReady && c.Status == corev1.ConditionTrue {
				ready++
				break
			}
		}
	}
	rate := float64(ready) / float64(len(items))
	if rate < 0.90 {
		findings = append(findings, Finding{Category: "node", Name: "节点就绪率", Level: "critical", Actual: fmt.Sprintf("%.1f%%", rate*100), Expected: ">= 90%", Message: fmt.Sprintf("节点就绪率 %.1f%%，存在 NotReady 节点", rate*100), Suggestion: "检查 NotReady 节点 kubelet 和网络状态", Weight: 20})
	} else if rate < 0.95 {
		findings = append(findings, Finding{Category: "node", Name: "节点就绪率", Level: "warning", Actual: fmt.Sprintf("%.1f%%", rate*100), Expected: ">= 95%", Message: fmt.Sprintf("节点就绪率 %.1f%%", rate*100), Suggestion: "关注未就绪节点", Weight: 20})
	} else {
		findings = append(findings, Finding{Category: "node", Name: "节点就绪率", Level: "pass", Actual: fmt.Sprintf("%.1f%%", rate*100), Message: "节点就绪率正常", Weight: 20})
	}
	return findings
}

func (s *InspectionService) checkPodHealth(cc *ClusterClient, clusterID uint) []Finding {
	var findings []Finding
	store := cc.PodStore
	if store == nil {
		findings = append(findings, Finding{Category: "pod", Name: "Pod 健康检查", Level: "critical", Message: "无法获取 Pod 信息", Weight: 20})
		return findings
	}
	items := store.List()
	if len(items) == 0 {
		findings = append(findings, Finding{Category: "pod", Name: "Pod 健康检查", Level: "info", Message: "集群中无 Pod", Weight: 20})
		return findings
	}

	failed, pending, crashLoop := 0, 0, 0
	for _, obj := range items {
		pod := obj.(*corev1.Pod)
		switch pod.Status.Phase {
		case corev1.PodFailed:
			failed++
		case corev1.PodPending:
			pending++
		}
		for _, cs := range pod.Status.ContainerStatuses {
			if cs.State.Waiting != nil && cs.State.Waiting.Reason == "CrashLoopBackOff" {
				crashLoop++
			}
		}
	}

	if failed > 20 {
		findings = append(findings, Finding{Category: "pod", Name: "Failed Pod 数量", Level: "critical", Actual: failed, Expected: "<= 20", Message: fmt.Sprintf("存在 %d 个 Failed Pod", failed), Suggestion: "排查容器启动失败原因（镜像/OOM/配置错误）", Weight: 15})
	} else if failed > 5 {
		findings = append(findings, Finding{Category: "pod", Name: "Failed Pod 数量", Level: "warning", Actual: failed, Expected: "<= 5", Message: fmt.Sprintf("存在 %d 个 Failed Pod", failed), Suggestion: "关注异常 Pod", Weight: 15})
	} else {
		findings = append(findings, Finding{Category: "pod", Name: "Failed Pod 数量", Level: "pass", Actual: failed, Message: "Failed Pod 数量正常", Weight: 15})
	}

	if pending > 20 {
		findings = append(findings, Finding{Category: "pod", Name: "Pending Pod 数量", Level: "critical", Actual: pending, Expected: "<= 20", Message: fmt.Sprintf("存在 %d 个 Pending Pod", pending), Suggestion: "检查资源不足、亲和性约束或镜像拉取问题", Weight: 15})
	} else if pending > 10 {
		findings = append(findings, Finding{Category: "pod", Name: "Pending Pod 数量", Level: "warning", Actual: pending, Expected: "<= 10", Message: fmt.Sprintf("存在 %d 个 Pending Pod", pending), Suggestion: "关注调度延迟", Weight: 15})
	} else {
		findings = append(findings, Finding{Category: "pod", Name: "Pending Pod 数量", Level: "pass", Actual: pending, Message: "Pending Pod 数量正常", Weight: 15})
	}

	if crashLoop > 0 {
		findings = append(findings, Finding{Category: "pod", Name: "CrashLoopBackOff 数量", Level: "warning", Actual: crashLoop, Expected: "0", Message: fmt.Sprintf("存在 %d 个 CrashLoopBackOff 容器", crashLoop), Suggestion: "检查应用日志和启动命令", Weight: 10})
	} else {
		findings = append(findings, Finding{Category: "pod", Name: "CrashLoopBackOff 数量", Level: "pass", Actual: 0, Message: "无 CrashLoopBackOff 容器", Weight: 10})
	}

	return findings
}

func (s *InspectionService) checkNodeResources(cc *ClusterClient, clusterID uint, promData *PrometheusData) []Finding {
	var findings []Finding
	// 从 ClusterMetadata 获取统计信息
	var meta model.ClusterMetadata
	if err := s.db.Where("cluster_id = ?", clusterID).First(&meta).Error; err != nil {
		return findings
	}
	if promData != nil {
		findings = append(findings, Finding{Category: "resource", Name: "节点资源使用汇总", Level: "pass", Actual: fmt.Sprintf("节点数 %d | 总内存 %.1f GB | 已用 %.1f GB", promData.NodeCount, promData.TotalMemGB, promData.UsedMemGB), Message: "已采集 Prometheus 实时指标", Weight: 10})
	} else {
		findings = append(findings, Finding{Category: "resource", Name: "节点资源使用", Level: "pass", Actual: fmt.Sprintf("节点数 %d", meta.NodeCount), Message: "集群规模正常", Weight: 10})
	}
	return findings
}

func (s *InspectionService) checkUnschedulableNodes(cc *ClusterClient, clusterID uint) []Finding {
	var findings []Finding
	store := cc.NodeStore
	if store == nil {
		return findings
	}
	items := store.List()
	if len(items) == 0 {
		return findings
	}
	unschedulable := 0
	for _, obj := range items {
		node := obj.(*corev1.Node)
		if node.Spec.Unschedulable {
			unschedulable++
		}
	}
	rate := float64(unschedulable) / float64(len(items))
	if rate > 0.30 {
		findings = append(findings, Finding{Category: "node", Name: "禁止调度节点占比", Level: "critical", Actual: fmt.Sprintf("%.1f%% (%d/%d)", rate*100, unschedulable, len(items)), Expected: "<= 20%", Message: fmt.Sprintf("%.1f%% 节点被禁止调度", rate*100), Suggestion: "排查 cordon/taints 原因，恢复节点可调度", Weight: 15})
	} else if rate > 0.15 {
		findings = append(findings, Finding{Category: "node", Name: "禁止调度节点占比", Level: "warning", Actual: fmt.Sprintf("%.1f%% (%d/%d)", rate*100, unschedulable, len(items)), Expected: "<= 15%", Message: fmt.Sprintf("%.1f%% 节点被禁止调度", rate*100), Suggestion: "关注维护中的节点", Weight: 15})
	} else {
		findings = append(findings, Finding{Category: "node", Name: "禁止调度节点占比", Level: "pass", Actual: fmt.Sprintf("%.1f%%", rate*100), Message: "禁止调度节点占比正常", Weight: 15})
	}
	return findings
}

func (s *InspectionService) checkControlPlane(cc *ClusterClient, clusterID uint) []Finding {
	var findings []Finding
	// MVP 阶段：简单判断 API Server 是否可连接（ClusterClient 存在即可认为可连）
	if cc.Client == nil {
		findings = append(findings, Finding{Category: "control_plane", Name: "API Server 连通性", Level: "critical", Message: "无法连接 API Server", Suggestion: "检查集群证书和网络", Weight: 20})
	} else {
		findings = append(findings, Finding{Category: "control_plane", Name: "API Server 连通性", Level: "pass", Message: "API Server 连接正常", Weight: 20})
	}
	return findings
}

// ==================== 评分与报告 ====================

func calculateScore(findings []Finding) (int, string) {
	totalWeight := 0
	deducted := 0
	for _, f := range findings {
		totalWeight += f.Weight
		switch f.Level {
		case "critical":
			deducted += f.Weight
		case "warning":
			deducted += f.Weight / 2
		case "info":
			deducted += f.Weight / 4
		}
	}
	if totalWeight == 0 {
		return 100, "low"
	}
	score := 100 - (deducted * 100 / totalWeight)
	if score >= 90 {
		return score, "low"
	} else if score >= 70 {
		return score, "medium"
	} else if score >= 50 {
		return score, "high"
	}
	return score, "critical"
}

func generateHTMLReport(cluster model.Cluster, findings []Finding, score int, riskLevel string, promData *PrometheusData) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("<h2>集群巡检报告: %s</h2>", cluster.DisplayName))
	sb.WriteString(fmt.Sprintf("<p>评分: <b>%d</b> &nbsp; 风险等级: <b>%s</b></p>", score, riskLevel))

	if promData != nil {
		sb.WriteString(fmt.Sprintf("<h3>集群规模</h3><p>节点数: %d &nbsp; Pod 数: %d</p>", promData.NodeCount, promData.PodCount))

		if len(promData.PodStatus) > 0 {
			sb.WriteString("<h3>Pod 状态分布</h3><table border='1' cellpadding='6' cellspacing='0'><tr><th>状态</th><th>数量</th><th>占比</th></tr>")
			totalPods := 0
			for _, v := range promData.PodStatus {
				totalPods += v
			}
			for status, count := range promData.PodStatus {
				pct := 0.0
				if totalPods > 0 {
					pct = float64(count) * 100.0 / float64(totalPods)
				}
				sb.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%d</td><td>%.1f%%</td></tr>", status, count, pct))
			}
			sb.WriteString("</table>")
		}

		if len(promData.NodeUsages) > 0 {
			sb.WriteString("<h3>节点资源使用详情</h3><table border='1' cellpadding='6' cellspacing='0'><tr><th>节点</th><th>CPU%</th><th>内存%</th><th>磁盘%</th></tr>")
			for _, n := range promData.NodeUsages {
				sb.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%.1f%%</td><td>%.1f%%</td><td>%.1f%%</td></tr>", n.Name, n.CPUUsage, n.MemoryUsage, n.DiskUsage))
			}
			sb.WriteString("</table>")
		}

		if len(promData.CpuTop) > 0 {
			sb.WriteString("<h3>CPU 使用率 TOP 10</h3><table border='1' cellpadding='6' cellspacing='0'><tr><th>节点</th><th>CPU%</th></tr>")
			for i, n := range promData.CpuTop {
				if i >= 10 {
					break
				}
				sb.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%.1f%%</td></tr>", n.Name, n.CPUUsage))
			}
			sb.WriteString("</table>")
		}

		if len(promData.MemTop) > 0 {
			sb.WriteString("<h3>内存使用率 TOP 10</h3><table border='1' cellpadding='6' cellspacing='0'><tr><th>节点</th><th>内存%</th></tr>")
			for i, n := range promData.MemTop {
				if i >= 10 {
					break
				}
				sb.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%.1f%%</td></tr>", n.Name, n.MemoryUsage))
			}
			sb.WriteString("</table>")
		}
	}

	sb.WriteString("<h3>检查项汇总</h3><table border='1' cellpadding='8' cellspacing='0'><tr><th>检查项</th><th>状态</th><th>实际值</th><th>说明</th><th>建议</th></tr>")
	for _, f := range findings {
		sb.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%s</td><td>%v</td><td>%s</td><td>%s</td></tr>", f.Name, f.Level, f.Actual, f.Message, f.Suggestion))
	}
	sb.WriteString("</table>")
	return sb.String()
}

func generateMarkdownReport(cluster model.Cluster, findings []Finding, score int, riskLevel string, promData *PrometheusData) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("## 集群巡检报告: %s\n\n", cluster.DisplayName))
	sb.WriteString(fmt.Sprintf("- **评分**: %d\n- **风险等级**: %s\n\n", score, riskLevel))

	if promData != nil {
		sb.WriteString(fmt.Sprintf("### 集群规模\n- 节点数: %d\n- Pod 数: %d\n\n", promData.NodeCount, promData.PodCount))
		if len(promData.PodStatus) > 0 {
			sb.WriteString("### Pod 状态分布\n| 状态 | 数量 |\n|------|------|\n")
			for status, count := range promData.PodStatus {
				sb.WriteString(fmt.Sprintf("| %s | %d |\n", status, count))
			}
			sb.WriteString("\n")
		}
		if len(promData.NodeUsages) > 0 {
			sb.WriteString("### 节点资源使用详情\n| 节点 | CPU% | 内存% | 磁盘% |\n|------|------|------|------|\n")
			for _, n := range promData.NodeUsages {
				sb.WriteString(fmt.Sprintf("| %s | %.1f%% | %.1f%% | %.1f%% |\n", n.Name, n.CPUUsage, n.MemoryUsage, n.DiskUsage))
			}
			sb.WriteString("\n")
		}
	}

	sb.WriteString("### 检查项汇总\n| 检查项 | 状态 | 实际值 | 说明 | 建议 |\n")
	sb.WriteString("|--------|------|--------|------|------|\n")
	for _, f := range findings {
		sb.WriteString(fmt.Sprintf("| %s | %s | %v | %s | %s |\n", f.Name, f.Level, f.Actual, f.Message, f.Suggestion))
	}
	return sb.String()
}

// DB 暴露底层 gorm.DB 用于 handler 查询
func (s *InspectionService) DB() *gorm.DB {
	return s.db
}

// ==================== CRUD 服务方法 ====================

// CreateTask 创建任务
func (s *InspectionService) CreateTask(task *model.InspectionTask) error {
	if err := s.db.Create(task).Error; err != nil {
		return err
	}
	return s.ReloadTask(*task)
}

// UpdateTask 修改任务
func (s *InspectionService) UpdateTask(task *model.InspectionTask) error {
	if err := s.db.Save(task).Error; err != nil {
		return err
	}
	return s.ReloadTask(*task)
}

// DeleteTask 删除任务
func (s *InspectionService) DeleteTask(id uint) error {
	s.mu.Lock()
	if entryID, ok := s.taskEntries[id]; ok {
		s.cron.Remove(entryID)
		delete(s.taskEntries, id)
	}
	s.mu.Unlock()
	return s.db.Delete(&model.InspectionTask{}, id).Error
}

// TriggerJob 手动触发巡检
func (s *InspectionService) TriggerJob(taskID uint) error {
	go s.triggerJob(taskID, "manual")
	return nil
}

// QuickInspect 一键快速巡检所有活跃集群（无需预先创建任务）
func (s *InspectionService) QuickInspect(ctx context.Context) (*model.InspectionJob, error) {
	var clusters []model.Cluster
	if err := s.db.Where("is_active = ?", true).Find(&clusters).Error; err != nil {
		return nil, err
	}
	if len(clusters) == 0 {
		return nil, fmt.Errorf("没有可用的活跃集群")
	}

	// 创建临时 Job 记录
	job := model.InspectionJob{
		TaskID:        0, // 0 表示快速巡检
		Status:        "running",
		TriggerType:   "manual",
		StartedAt:     ptrTime(time.Now()),
		TotalClusters: len(clusters),
	}
	if err := s.db.Create(&job).Error; err != nil {
		return nil, err
	}

	// 在后台执行巡检
	go func() {
		var clusterIDs []uint
		for _, c := range clusters {
			clusterIDs = append(clusterIDs, c.ID)
		}
		task := model.InspectionTask{
			ClusterIDs: marshalUintArray(clusterIDs),
		}
		s.runJobWithTask(job.ID, task)
	}()

	return &job, nil
}

func (s *InspectionService) runJobWithTask(jobID uint, task model.InspectionTask) {
	ctx := context.Background()

	var clusterIDs []uint
	_ = json.Unmarshal([]byte(task.ClusterIDs), &clusterIDs)
	if len(clusterIDs) == 0 {
		var clusters []model.Cluster
		if err := s.db.Where("is_active = ?", true).Find(&clusters).Error; err == nil {
			for _, c := range clusters {
				clusterIDs = append(clusterIDs, c.ID)
			}
		}
	}

	var wg sync.WaitGroup
	resultCh := make(chan *model.InspectionResult, len(clusterIDs))

	for _, cid := range clusterIDs {
		wg.Add(1)
		go func(clusterID uint) {
			defer wg.Done()
			res := s.inspectCluster(ctx, clusterID, task)
			res.JobID = jobID
			resultCh <- res
		}(cid)
	}

	go func() {
		wg.Wait()
		close(resultCh)
	}()

	var successCount, failedCount int
	var totalScore int
	maxRisk := 0
	riskMap := map[string]int{"low": 0, "medium": 1, "high": 2, "critical": 3}

	for res := range resultCh {
		if res.Status == "success" {
			successCount++
			totalScore += res.Score
			if riskMap[res.RiskLevel] > maxRisk {
				maxRisk = riskMap[res.RiskLevel]
			}
		} else {
			failedCount++
		}
		s.db.Create(res)
	}

	var job model.InspectionJob
	if err := s.db.First(&job, jobID).Error; err != nil {
		return
	}

	now := time.Now()
	job.FinishedAt = &now
	job.SuccessCount = successCount
	job.FailedCount = failedCount
	if successCount > 0 {
		job.ScoreAvg = totalScore / successCount
	}
	riskLevels := []string{"low", "medium", "high", "critical"}
	job.RiskLevel = riskLevels[maxRisk]

	if failedCount == 0 && successCount > 0 {
		job.Status = "success"
	} else if successCount > 0 {
		job.Status = "partial"
	} else {
		job.Status = "failed"
	}
	s.db.Save(&job)
}

func marshalUintArray(ids []uint) string {
	b, _ := json.Marshal(ids)
	return string(b)
}

// ==================== 辅助函数 ====================

func ptrTime(t time.Time) *time.Time {
	return &t
}

// ==================== Prometheus 数据增强 ====================

type NodeUsage struct {
	Name         string  `json:"name"`
	CPUUsage     float64 `json:"cpu_usage"`
	MemoryUsage  float64 `json:"memory_usage"`
	DiskUsage    float64 `json:"disk_usage"`
}

type PrometheusData struct {
	NodeCount  int                 `json:"node_count"`
	PodCount   int                 `json:"pod_count"`
	PodStatus  map[string]int      `json:"pod_status"`
	NodeUsages []NodeUsage         `json:"node_usages"`
	CpuTop     []NodeUsage         `json:"cpu_top"`
	MemTop     []NodeUsage         `json:"mem_top"`
	DiskTop    []NodeUsage         `json:"disk_top"`
	TotalCPU   float64             `json:"total_cpu"`
	TotalMemGB float64             `json:"total_mem_gb"`
	UsedMemGB  float64             `json:"used_mem_gb"`
}

func (s *InspectionService) queryPrometheusData(ctx context.Context, tenantID uint, clusterID uint, cc *ClusterClient) *PrometheusData {
	var dsList []model.DataSource
	if err := s.db.Where("tenant_id = ? AND type = ? AND is_active = ?", tenantID, "prometheus", true).Find(&dsList).Error; err != nil || len(dsList) == 0 {
		return nil
	}
	ds := dsList[0]

	data := &PrometheusData{
		PodStatus: make(map[string]int),
	}

	// 1. 节点实时资源使用率（%）
	cpuMap := s.queryPromQLMap(ctx, ds, `100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`)
	memMap := s.queryPromQLMap(ctx, ds, `100 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100`)
	diskMap := s.queryPromQLMap(ctx, ds, `100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100`)

	// 2. Pod 状态分布
	data.PodStatus["Running"] = int(s.queryPromQLScalar(ctx, ds, `count(kube_pod_status_phase{phase="Running"})`))
	data.PodStatus["Pending"] = int(s.queryPromQLScalar(ctx, ds, `count(kube_pod_status_phase{phase="Pending"})`))
	data.PodStatus["Failed"] = int(s.queryPromQLScalar(ctx, ds, `count(kube_pod_status_phase{phase="Failed"})`))
	data.PodStatus["Succeeded"] = int(s.queryPromQLScalar(ctx, ds, `count(kube_pod_status_phase{phase="Succeeded"})`))

	// 3. 节点数 / Pod 总数
	data.NodeCount = len(cc.NodeStore.List())
	data.PodCount = len(cc.PodStore.List())

	// 4. 组装节点列表和 TOP10
	nodeNames := make(map[string]bool)
	for k := range cpuMap {
		nodeNames[k] = true
	}
	for k := range memMap {
		nodeNames[k] = true
	}
	for k := range diskMap {
		nodeNames[k] = true
	}
	for name := range nodeNames {
		data.NodeUsages = append(data.NodeUsages, NodeUsage{
			Name:        name,
			CPUUsage:    cpuMap[name],
			MemoryUsage: memMap[name],
			DiskUsage:   diskMap[name],
		})
	}

	// 按 CPU 排序 TOP10
	data.CpuTop = topNByCPU(data.NodeUsages, 10)
	data.MemTop = topNByMem(data.NodeUsages, 10)
	data.DiskTop = topNByDisk(data.NodeUsages, 10)

	// 5. 总资源（简化：取 PromQL 总和）
	data.TotalCPU = s.queryPromQLScalar(ctx, ds, `count(node_cpu_seconds_total{mode="idle"})`)
	data.TotalMemGB = s.queryPromQLScalar(ctx, ds, `sum(node_memory_MemTotal_bytes) / 1024 / 1024 / 1024`)
	data.UsedMemGB = s.queryPromQLScalar(ctx, ds, `sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / 1024 / 1024 / 1024`)

	return data
}

func (s *InspectionService) queryPromQLMap(ctx context.Context, ds model.DataSource, query string) map[string]float64 {
	res := make(map[string]float64)
	if s.dsService == nil {
		return res
	}
	resp, err := s.dsService.ProxyPrometheusQuery(ctx, &ds, &ProxyQueryRequest{Query: query})
	if err != nil || resp == nil || resp.Status != "success" {
		return res
	}
	dataMap, ok := resp.Data.(map[string]interface{})
	if !ok {
		return res
	}
	results, ok := dataMap["result"].([]interface{})
	if !ok {
		return res
	}
	for _, r := range results {
		row, ok := r.(map[string]interface{})
		if !ok {
			continue
		}
		metric, ok := row["metric"].(map[string]interface{})
		if !ok {
			continue
		}
		instance, _ := metric["instance"].(string)
		if instance == "" {
			instance, _ = metric["node"].(string)
		}
		value, ok := row["value"].([]interface{})
		if !ok || len(value) < 2 {
			continue
		}
		vStr, _ := value[1].(string)
		var v float64
		fmt.Sscanf(vStr, "%f", &v)
		if instance != "" {
			res[instance] = v
		}
	}
	return res
}

func (s *InspectionService) queryPromQLScalar(ctx context.Context, ds model.DataSource, query string) float64 {
	if s.dsService == nil {
		return 0
	}
	resp, err := s.dsService.ProxyPrometheusQuery(ctx, &ds, &ProxyQueryRequest{Query: query})
	if err != nil || resp == nil || resp.Status != "success" {
		return 0
	}
	dataMap, ok := resp.Data.(map[string]interface{})
	if !ok {
		return 0
	}
	results, ok := dataMap["result"].([]interface{})
	if !ok || len(results) == 0 {
		return 0
	}
	row, ok := results[0].(map[string]interface{})
	if !ok {
		return 0
	}
	value, ok := row["value"].([]interface{})
	if !ok || len(value) < 2 {
		return 0
	}
	vStr, _ := value[1].(string)
	var v float64
	fmt.Sscanf(vStr, "%f", &v)
	return v
}

func (s *InspectionService) checkPrometheusMetrics(promData *PrometheusData, clusterID uint) []Finding {
	var findings []Finding
	if promData.UsedMemGB > 0 && promData.TotalMemGB > 0 {
		memRate := promData.UsedMemGB / promData.TotalMemGB * 100
		if memRate > 85 {
			findings = append(findings, Finding{Category: "resource", Name: "集群内存使用率", Level: "warning", Actual: fmt.Sprintf("%.1f%%", memRate), Expected: "<= 80%", Message: fmt.Sprintf("集群内存使用率 %.1f%%", memRate), Suggestion: "关注内存压力节点，考虑扩容", Weight: 10})
		} else {
			findings = append(findings, Finding{Category: "resource", Name: "集群内存使用率", Level: "pass", Actual: fmt.Sprintf("%.1f%%", memRate), Message: "集群内存使用率正常", Weight: 10})
		}
	}
	return findings
}

func topNByCPU(items []NodeUsage, n int) []NodeUsage {
	sorted := make([]NodeUsage, len(items))
	copy(sorted, items)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].CPUUsage > sorted[i].CPUUsage {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	if len(sorted) > n {
		return sorted[:n]
	}
	return sorted
}

func topNByMem(items []NodeUsage, n int) []NodeUsage {
	sorted := make([]NodeUsage, len(items))
	copy(sorted, items)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].MemoryUsage > sorted[i].MemoryUsage {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	if len(sorted) > n {
		return sorted[:n]
	}
	return sorted
}

func topNByDisk(items []NodeUsage, n int) []NodeUsage {
	sorted := make([]NodeUsage, len(items))
	copy(sorted, items)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].DiskUsage > sorted[i].DiskUsage {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	if len(sorted) > n {
		return sorted[:n]
	}
	return sorted
}
