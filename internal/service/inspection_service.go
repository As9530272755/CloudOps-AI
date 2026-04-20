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
	db             *gorm.DB
	k8sManager     *K8sManager
	dsService      *DatasourceService
	clusterService *ClusterService
	cron           *cron.Cron
	taskEntries    map[uint]cron.EntryID
	mu             sync.Mutex
}

// NewInspectionService 创建巡检服务
func NewInspectionService(db *gorm.DB, k8sManager *K8sManager, dsService *DatasourceService, clusterService *ClusterService) *InspectionService {
	s := &InspectionService{
		db:             db,
		k8sManager:     k8sManager,
		dsService:      dsService,
		clusterService: clusterService,
		cron:           cron.New(cron.WithSeconds(), cron.WithLocation(time.Local)),
		taskEntries:    make(map[uint]cron.EntryID),
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

	// 实时连通性预检：集群 offline 时直接失败，不读 informer 旧缓存
	if s.clusterService != nil && !s.clusterService.IsClusterHealthy(clusterID) {
		res.Status = "failed"
		res.ErrorMsg = "集群连接异常，无法执行巡检"
		res.Score = 0
		res.RiskLevel = "critical"
		return res
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
	var meta model.ClusterMetadata
	if err := s.db.Where("cluster_id = ?", clusterID).First(&meta).Error; err != nil {
		return findings
	}
	if promData != nil && promData.HasProm {
		findings = append(findings, Finding{Category: "resource", Name: "节点资源使用汇总", Level: "pass", Actual: fmt.Sprintf("节点数 %d | 总内存 %.1f GB | 已用 %.1f GB", promData.NodeCount, promData.TotalMemGB, promData.UsedMemGB), Message: "已采集 Prometheus 实时指标", Weight: 10})
	} else {
		actual := fmt.Sprintf("节点数 %d", meta.NodeCount)
		if promData != nil {
			actual = fmt.Sprintf("节点数 %d | 总内存 %.1f GB", meta.NodeCount, promData.TotalMemGB)
		}
		findings = append(findings, Finding{Category: "resource", Name: "节点资源使用", Level: "pass", Actual: actual, Message: "未配置 Prometheus 实时指标", Weight: 10})
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

// NodeDetail 包含 K8s + Prometheus 融合后的节点详情
type NodeDetail struct {
	Name        string  `json:"name"`
	IP          string  `json:"ip"`
	Role        string  `json:"role"`
	CPUCore     int     `json:"cpu_core"`
	CPUUsage    float64 `json:"cpu_usage"`
	MemoryUsage float64 `json:"memory_usage"`
	DiskUsage   float64 `json:"disk_usage"`
	NodeStatus  string  `json:"node_status"`
	Schedulable string  `json:"schedulable"`
}

// PrometheusData 巡检增强数据
type PrometheusData struct {
	NodeCount   int            `json:"node_count"`
	MasterCount int            `json:"master_count"`
	WorkerCount int            `json:"worker_count"`
	PodCount    int            `json:"pod_count"`
	PodStatus   map[string]int `json:"pod_status"`
	NodeDetails []NodeDetail   `json:"node_details"`
	CpuTop      []NodeDetail   `json:"cpu_top"`
	MemTop      []NodeDetail   `json:"mem_top"`
	DiskTop     []NodeDetail   `json:"disk_top"`
	TotalCPU    float64        `json:"total_cpu"`
	TotalMemGB  float64        `json:"total_mem_gb"`
	UsedMemGB   float64        `json:"used_mem_gb"`
	MemRate     float64        `json:"mem_rate"`
	AvgCPURate  float64        `json:"avg_cpu_rate"`
	HealthyRate float64        `json:"healthy_rate"`
	HasProm     bool           `json:"has_prom"`
}

func (s *InspectionService) queryPrometheusData(ctx context.Context, tenantID uint, clusterID uint, cc *ClusterClient) *PrometheusData {
	data := &PrometheusData{
		PodStatus:   make(map[string]int),
		NodeDetails: make([]NodeDetail, 0),
	}

	// ========== 1. 基础数据：始终从 K8s Informer 获取（不依赖 Prometheus） ==========
	nodeItems := cc.NodeStore.List()
	data.NodeCount = len(nodeItems)
	podItems := cc.PodStore.List()
	data.PodCount = len(podItems)

	// Pod 状态分布（直接遍历 informer 缓存）
	for _, obj := range podItems {
		pod := obj.(*corev1.Pod)
		switch pod.Status.Phase {
		case corev1.PodRunning:
			data.PodStatus["Running"]++
		case corev1.PodPending:
			data.PodStatus["Pending"]++
		case corev1.PodFailed:
			data.PodStatus["Failed"]++
		case corev1.PodSucceeded:
			data.PodStatus["Succeeded"]++
		}
	}
	if data.PodCount > 0 {
		data.HealthyRate = float64(data.PodStatus["Running"]) * 100.0 / float64(data.PodCount)
	}

	// 节点详情基础信息 + 总资源（从 Node Capacity 获取）
	ipToDetail := make(map[string]*NodeDetail)
	for _, obj := range nodeItems {
		node := obj.(*corev1.Node)
		nd := &NodeDetail{Name: node.Name}
		// role
		if _, ok := node.Labels["node-role.kubernetes.io/control-plane"]; ok {
			nd.Role = "Master"
			data.MasterCount++
		} else if _, ok := node.Labels["node-role.kubernetes.io/master"]; ok {
			nd.Role = "Master"
			data.MasterCount++
		} else {
			nd.Role = "Worker"
			data.WorkerCount++
		}
		// IP
		for _, addr := range node.Status.Addresses {
			if addr.Type == corev1.NodeInternalIP {
				nd.IP = addr.Address
				break
			}
		}
		// status
		ready := false
		for _, c := range node.Status.Conditions {
			if c.Type == corev1.NodeReady && c.Status == corev1.ConditionTrue {
				ready = true
				break
			}
		}
		if ready {
			nd.NodeStatus = "Ready"
		} else {
			nd.NodeStatus = "NotReady"
		}
		// schedulable
		if node.Spec.Unschedulable {
			nd.Schedulable = "禁止调度"
		} else {
			nd.Schedulable = "可调度"
		}
		// CPU cores from K8s capacity
		if cpuQ := node.Status.Capacity.Cpu(); cpuQ != nil {
			cores := float64(cpuQ.MilliValue()) / 1000.0
			nd.CPUCore = int(cores)
			data.TotalCPU += cores
		}
		// Memory from K8s capacity
		if memQ := node.Status.Capacity.Memory(); memQ != nil {
			memBytes := float64(memQ.Value())
			data.TotalMemGB += memBytes / 1024 / 1024 / 1024
		}
		ipToDetail[nd.IP] = nd
	}

	// ========== 2. Prometheus 增强数据（可选） ==========
	// 辅助函数：用指定数据源尝试填充 Prometheus 指标，返回是否成功匹配当前集群
	tryFill := func(ds model.DataSource, extraLabels map[string]string) bool {
		cpuMap := s.queryPromQLMap(ctx, ds, `100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`, extraLabels)
		memMap := s.queryPromQLMap(ctx, ds, `100 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100`, extraLabels)
		diskMap := s.queryPromQLMap(ctx, ds, `100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100`, extraLabels)
		coreMap := s.queryPromQLMap(ctx, ds, `count(node_cpu_seconds_total{mode="idle"}) by (instance)`, extraLabels)

		var matchedDetails []NodeDetail
		matchedCount := 0
		for _, detail := range ipToDetail {
			found := false
			for inst, cpu := range cpuMap {
				// 支持 IP:port 格式 或 node name 精确匹配
				if strings.HasPrefix(inst, detail.IP+":") || inst == detail.Name {
					detail.CPUUsage = cpu
					detail.MemoryUsage = memMap[inst]
					detail.DiskUsage = diskMap[inst]
					var cores float64
					fmt.Sscanf(fmt.Sprintf("%v", coreMap[inst]), "%f", &cores)
					if detail.CPUCore == 0 && cores > 0 {
						detail.CPUCore = int(cores)
					}
					matchedDetails = append(matchedDetails, *detail)
					found = true
					matchedCount++
					break
				}
			}
			if !found {
				matchedDetails = append(matchedDetails, *detail)
			}
		}

		if matchedCount == 0 {
			return false
		}

		data.HasProm = true
		data.NodeDetails = matchedDetails

		data.CpuTop = topNByCPU(data.NodeDetails, 10)
		data.MemTop = topNByMem(data.NodeDetails, 10)
		data.DiskTop = topNByDisk(data.NodeDetails, 10)

		promTotalMemGB := s.queryPromQLScalar(ctx, ds, `sum(max by (instance) (node_memory_MemTotal_bytes)) / 1024 / 1024 / 1024`, extraLabels)
		if promTotalMemGB > 0 {
			data.TotalMemGB = promTotalMemGB
		}
		data.UsedMemGB = s.queryPromQLScalar(ctx, ds, `sum(max by (instance) (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)) / 1024 / 1024 / 1024`, extraLabels)
		if data.TotalMemGB > 0 {
			data.MemRate = data.UsedMemGB / data.TotalMemGB * 100
		}
		var cpuSum float64
		for _, nd := range data.NodeDetails {
			cpuSum += nd.CPUUsage
		}
		if len(data.NodeDetails) > 0 {
			data.AvgCPURate = cpuSum / float64(len(data.NodeDetails))
		}
		return true
	}

	// 2.1 查找专属数据源（ClusterID 精确匹配）
	var dedicatedDS model.DataSource
	if err := s.db.Where("cluster_id = ? AND type = ? AND is_active = ?", clusterID, "prometheus", true).First(&dedicatedDS).Error; err == nil {
		if tryFill(dedicatedDS, nil) {
			return data
		}
	}

	// 2.2 查找全局数据源 + 集群标签过滤（遍历所有全局数据源，直到有一个成功匹配）
	var cluster model.Cluster
	if err := s.db.First(&cluster, clusterID).Error; err == nil {
		var globalDSList []model.DataSource
		if err := s.db.Where("tenant_id = ? AND (cluster_id IS NULL OR cluster_id = 0) AND type = ? AND is_active = ?", tenantID, "prometheus", true).Find(&globalDSList).Error; err == nil && len(globalDSList) > 0 {
			for _, globalDS := range globalDSList {
				extraLabels := make(map[string]string)
				if cluster.ClusterLabelValue != "" {
					labelName := cluster.ClusterLabelName
					if labelName == "" {
						labelName = "cluster"
					}
					extraLabels[labelName] = cluster.ClusterLabelValue
					}
				if tryFill(globalDS, extraLabels) {
					return data
				}
			}
		}
	}

	// 2.3 都没有，返回 K8s 原生数据
	for _, nd := range ipToDetail {
		data.NodeDetails = append(data.NodeDetails, *nd)
	}
	return data
}

func (s *InspectionService) queryPromQLMap(ctx context.Context, ds model.DataSource, query string, extraLabels map[string]string) map[string]float64 {
	res := make(map[string]float64)
	if s.dsService == nil {
		return res
	}
	resp, err := s.dsService.ProxyPrometheusQuery(ctx, &ds, &ProxyQueryRequest{Query: query, ExtraLabels: extraLabels})
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
	// 处理 Prometheus HA 多副本去重：同一个 instance 可能有多条记录，取平均值
	temp := make(map[string][]float64)
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
			temp[instance] = append(temp[instance], v)
		}
	}
	for instance, vals := range temp {
		if len(vals) == 0 {
			continue
		}
		var sum float64
		for _, v := range vals {
			sum += v
		}
		res[instance] = sum / float64(len(vals))
	}
	return res
}

func (s *InspectionService) queryPromQLScalar(ctx context.Context, ds model.DataSource, query string, extraLabels map[string]string) float64 {
	if s.dsService == nil {
		return 0
	}
	resp, err := s.dsService.ProxyPrometheusQuery(ctx, &ds, &ProxyQueryRequest{Query: query, ExtraLabels: extraLabels})
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

func topNByCPU(items []NodeDetail, n int) []NodeDetail {
	sorted := make([]NodeDetail, len(items))
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

func topNByMem(items []NodeDetail, n int) []NodeDetail {
	sorted := make([]NodeDetail, len(items))
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

func topNByDisk(items []NodeDetail, n int) []NodeDetail {
	sorted := make([]NodeDetail, len(items))
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

// ===================== 报告生成器 =====================

func generateHTMLReport(cluster model.Cluster, findings []Finding, score int, riskLevel string, promData *PrometheusData) string {
	var sb strings.Builder
	nowStr := time.Now().Format("2006-01-02 15:04:05 MST")
	sb.WriteString(fmt.Sprintf("<h2>集群巡检报告: %s</h2>", cluster.DisplayName))
	sb.WriteString(fmt.Sprintf("<p>评分: <b>%d</b> &nbsp; 风险等级: <b>%s</b> &nbsp; 报告时间: %s</p>", score, riskLevel, nowStr))

	if promData != nil {
		// 一、集群规模
		sb.WriteString("<h3>一、集群规模</h3>")
		sb.WriteString("<h4>1.1 节点信息</h4>")
		sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>类型</th><th>节点数</th><th>总物理核</th></tr>")
		sb.WriteString(fmt.Sprintf("<tr><td>Master</td><td>%d</td><td>-</td></tr>", promData.MasterCount))
		sb.WriteString(fmt.Sprintf("<tr><td>Worker</td><td>%d</td><td>-</td></tr>", promData.WorkerCount))
		sb.WriteString(fmt.Sprintf("<tr><td><b>总计</b></td><td><b>%d</b></td><td><b>%.0f 核</b></td></tr>", promData.NodeCount, promData.TotalCPU))
		sb.WriteString("</table>")

		// 1.2 节点调度状态统计
		readyCount, notReadyCount, schedCount, unschedCount := 0, 0, 0, 0
		var unschedNames []string
		var notReadyNames []string
		for _, nd := range promData.NodeDetails {
			if nd.NodeStatus == "Ready" {
				readyCount++
			} else {
				notReadyCount++
				notReadyNames = append(notReadyNames, nd.Name)
			}
			if nd.Schedulable == "可调度" {
				schedCount++
			} else {
				unschedCount++
				unschedNames = append(unschedNames, nd.Name)
			}
		}
		sb.WriteString("<h4>1.2 节点调度状态统计</h4>")
		sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>状态</th><th>节点数</th><th>占比</th><th>节点列表</th></tr>")
		if promData.NodeCount > 0 {
			sb.WriteString(fmt.Sprintf("<tr><td>✅ 可调度节点</td><td>%d</td><td>%.1f%%</td><td>%s</td></tr>", schedCount, float64(schedCount)*100/float64(promData.NodeCount), truncJoin(unschedNames, 5, "全部")))
			sb.WriteString(fmt.Sprintf("<tr><td>❌ 禁止调度节点</td><td>%d</td><td>%.1f%%</td><td>%s</td></tr>", unschedCount, float64(unschedCount)*100/float64(promData.NodeCount), joinOrDefault(unschedNames, "无")))
			sb.WriteString(fmt.Sprintf("<tr><td>🟢 Ready 节点</td><td>%d</td><td>%.1f%%</td><td>%s</td></tr>", readyCount, float64(readyCount)*100/float64(promData.NodeCount), joinOrDefault(notReadyNames, "全部 Ready")))
			sb.WriteString(fmt.Sprintf("<tr><td>🔴 NotReady 节点</td><td>%d</td><td>%.1f%%</td><td>%s</td></tr>", notReadyCount, float64(notReadyCount)*100/float64(promData.NodeCount), joinOrDefault(notReadyNames, "无")))
		}
		sb.WriteString("</table>")

		// 二、Pod 状态统计
		sb.WriteString("<h3>二、Pod 状态统计</h3>")
		sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>状态</th><th>数量</th><th>占比</th></tr>")
		totalPods := promData.PodCount
		for _, status := range []string{"Running", "Pending", "Failed", "Succeeded"} {
			count := promData.PodStatus[status]
			pct := 0.0
			if totalPods > 0 {
				pct = float64(count) * 100.0 / float64(totalPods)
			}
			emoji := ""
			switch status {
			case "Running":
				emoji = "🟢"
			case "Pending":
				emoji = "⚪"
			case "Failed":
				emoji = "🔴"
			case "Succeeded":
				emoji = "🟠"
			}
			sb.WriteString(fmt.Sprintf("<tr><td>%s %s</td><td>%d</td><td>%.1f%%</td></tr>", emoji, status, count, pct))
		}
		sb.WriteString(fmt.Sprintf("<tr><td><b>总计</b></td><td><b>%d</b></td><td><b>100%%</b></td></tr>", totalPods))
		sb.WriteString("</table>")
		if totalPods > 0 {
			sb.WriteString(fmt.Sprintf("<p>集群健康率: <b>%.1f%%</b> (Running / Total)</p>", promData.HealthyRate))
		}

		// 三、资源使用情况
		sb.WriteString("<h3>三、资源使用情况</h3>")
		if !promData.HasProm {
			sb.WriteString("<p><i>未配置 Prometheus 数据源，以下仅展示静态资源信息。</i></p>")
		}
		sb.WriteString("<h4>3.1 内存资源</h4>")
		sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>指标</th><th>数值</th></tr>")
		sb.WriteString(fmt.Sprintf("<tr><td>总内存</td><td>%.1f GB</td></tr>", promData.TotalMemGB))
		if promData.HasProm {
			sb.WriteString(fmt.Sprintf("<tr><td>已用内存</td><td>%.1f GB</td></tr>", promData.UsedMemGB))
			sb.WriteString(fmt.Sprintf("<tr><td>可用内存</td><td>%.1f GB</td></tr>", promData.TotalMemGB-promData.UsedMemGB))
			sb.WriteString(fmt.Sprintf("<tr><td>使用率</td><td>%.1f%%</td></tr>", promData.MemRate))
		} else {
			sb.WriteString("<tr><td>已用内存</td><td>-</td></tr>")
			sb.WriteString("<tr><td>可用内存</td><td>-</td></tr>")
			sb.WriteString("<tr><td>使用率</td><td>-</td></tr>")
		}
		sb.WriteString("</table>")

		sb.WriteString("<h4>3.2 资源置备比分析</h4>")
		sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>资源类型</th><th>总量</th><th>已用/平均</th><th>使用率</th><th>评估</th></tr>")
		if promData.HasProm {
			cpuEval := evaluateRate(promData.AvgCPURate, 70, 85)
			memEval := evaluateRate(promData.MemRate, 80, 90)
			sb.WriteString(fmt.Sprintf("<tr><td>CPU 物理核心</td><td>%.0f 核</td><td>平均 %.1f%%</td><td>%.1f%%</td><td>%s</td></tr>", promData.TotalCPU, promData.AvgCPURate, promData.AvgCPURate, cpuEval))
			sb.WriteString(fmt.Sprintf("<tr><td>内存</td><td>%.1f GB</td><td>%.1f GB</td><td>%.1f%%</td><td>%s</td></tr>", promData.TotalMemGB, promData.UsedMemGB, promData.MemRate, memEval))
		} else {
			sb.WriteString(fmt.Sprintf("<tr><td>CPU 物理核心</td><td>%.0f 核</td><td>-</td><td>-</td><td>-</td></tr>", promData.TotalCPU))
			sb.WriteString(fmt.Sprintf("<tr><td>内存</td><td>%.1f GB</td><td>-</td><td>-</td><td>-</td></tr>", promData.TotalMemGB))
		}
		sb.WriteString("</table>")

		// 四、节点资源使用详情
		sb.WriteString("<h3>四、节点资源使用详情</h3>")
		sb.WriteString(fmt.Sprintf("<p>全部节点资源使用表 (%d 个节点)</p>", len(promData.NodeDetails)))
		sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>#</th><th>主机名</th><th>IP 地址</th><th>角色</th><th>物理核</th><th>CPU%</th><th>内存%</th><th>磁盘%</th><th>节点状态</th><th>调度状态</th></tr>")
		for i, nd := range promData.NodeDetails {
			if promData.HasProm {
				sb.WriteString(fmt.Sprintf("<tr><td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>%d</td><td>%.1f%%</td><td>%.1f%%</td><td>%.1f%%</td><td>%s</td><td>%s</td></tr>",
					i+1, nd.Name, nd.IP, nd.Role, nd.CPUCore, nd.CPUUsage, nd.MemoryUsage, nd.DiskUsage, nd.NodeStatus, nd.Schedulable))
			} else {
				sb.WriteString(fmt.Sprintf("<tr><td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>%d</td><td>-</td><td>-</td><td>-</td><td>%s</td><td>%s</td></tr>",
					i+1, nd.Name, nd.IP, nd.Role, nd.CPUCore, nd.NodeStatus, nd.Schedulable))
			}
		}
		sb.WriteString("</table>")

		// 4.3 CPU TOP10
		if promData.HasProm && len(promData.CpuTop) > 0 {
			sb.WriteString("<h4>4.3 CPU 使用率 TOP 10</h4>")
			sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>排名</th><th>节点名称</th><th>CPU%</th><th>调度状态</th><th>物理核</th></tr>")
			for i, nd := range promData.CpuTop {
				if i >= 10 {
					break
				}
				sb.WriteString(fmt.Sprintf("<tr><td>%d</td><td>%s</td><td>%.1f%%</td><td>%s</td><td>%d核</td></tr>", i+1, nd.Name, nd.CPUUsage, nd.Schedulable, nd.CPUCore))
			}
			sb.WriteString("</table>")
		}

		// 4.4 Mem TOP10
		if promData.HasProm && len(promData.MemTop) > 0 {
			sb.WriteString("<h4>4.4 内存使用率 TOP 10</h4>")
			sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>排名</th><th>节点名称</th><th>内存%</th><th>调度状态</th><th>物理核</th></tr>")
			for i, nd := range promData.MemTop {
				if i >= 10 {
					break
				}
				sb.WriteString(fmt.Sprintf("<tr><td>%d</td><td>%s</td><td>%.1f%%</td><td>%s</td><td>%d核</td></tr>", i+1, nd.Name, nd.MemoryUsage, nd.Schedulable, nd.CPUCore))
			}
			sb.WriteString("</table>")
		}

		// 4.5 Disk TOP10
		if promData.HasProm && len(promData.DiskTop) > 0 {
			sb.WriteString("<h4>4.5 磁盘使用率 TOP 10</h4>")
			sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>排名</th><th>节点名称</th><th>磁盘%</th><th>调度状态</th><th>物理核</th></tr>")
			for i, nd := range promData.DiskTop {
				if i >= 10 {
					break
				}
				sb.WriteString(fmt.Sprintf("<tr><td>%d</td><td>%s</td><td>%.1f%%</td><td>%s</td><td>%d核</td></tr>", i+1, nd.Name, nd.DiskUsage, nd.Schedulable, nd.CPUCore))
			}
			sb.WriteString("</table>")
		}

		// 五、风险评估
		sb.WriteString("<h3>五、风险评估</h3>")
		sb.WriteString("<h4>5.1 风险项分析</h4>")
		sb.WriteString("<table border='1' cellpadding='6' cellspacing='0'><tr><th>风险项</th><th>当前值</th><th>阈值</th><th>风险等级</th></tr>")
		// 用 findings 提取关键指标做风险矩阵
		failedCnt, pendingCnt, unschedRate := promData.PodStatus["Failed"], promData.PodStatus["Pending"], 0.0
		if promData.NodeCount > 0 {
			unsched := 0
			for _, nd := range promData.NodeDetails {
				if nd.Schedulable == "禁止调度" {
					unsched++
				}
			}
			unschedRate = float64(unsched) * 100.0 / float64(promData.NodeCount)
		}
		sb.WriteString(riskRowHTML("Failed Pod", fmt.Sprintf("%d 个", failedCnt), ">30", failedCnt, 30))
		sb.WriteString(riskRowHTML("Pending Pod", fmt.Sprintf("%d 个", pendingCnt), ">50", pendingCnt, 50))
		sb.WriteString(riskRowHTML("集群健康率", fmt.Sprintf("%.1f%%", promData.HealthyRate), "<95%", promData.HealthyRate < 95, 0))
		if promData.HasProm {
			sb.WriteString(riskRowHTML("内存使用率", fmt.Sprintf("%.1f%%", promData.MemRate), ">80%", promData.MemRate, 80))
			sb.WriteString(riskRowHTML("CPU 平均使用率", fmt.Sprintf("%.1f%%", promData.AvgCPURate), ">70%", promData.AvgCPURate, 70))
		} else {
			sb.WriteString("<tr><td>内存使用率</td><td>-</td><td>&gt;80%</td><td>未配置 Prometheus</td></tr>")
			sb.WriteString("<tr><td>CPU 平均使用率</td><td>-</td><td>&gt;70%</td><td>未配置 Prometheus</td></tr>")
		}
		sb.WriteString(riskRowHTML("禁止调度节点占比", fmt.Sprintf("%.1f%%", unschedRate), ">20%", unschedRate, 20))
		sb.WriteString("</table>")

		// 综合评分
		riskText := "✅ 低风险"
		if riskLevel == "medium" {
			riskText = "🟡 中风险"
		} else if riskLevel == "high" {
			riskText = "🔴 高风险"
		} else if riskLevel == "critical" {
			riskText = "🔴 极高风险"
		}
		sb.WriteString(fmt.Sprintf("<h4>5.2 综合风险评分</h4><p><b>%s (评分: %d)</b></p>", riskText, score))

		// 六、问题与建议
		sb.WriteString("<h3>六、问题与建议</h3>")
		var problems []string
		var suggestions []string
		if unschedCount > 0 {
			problems = append(problems, fmt.Sprintf("<li>%d 个节点被禁止调度 (%.1f%%): %s</li>", unschedCount, float64(unschedCount)*100/float64(promData.NodeCount), strings.Join(unschedNames, ", ")))
			suggestions = append(suggestions, fmt.Sprintf("<li>检查禁止调度节点原因: <code>kubectl get nodes %s -o jsonpath='{{range .items[*]}} {{.metadata.name}}\\t{{.spec.taints}}\\n{{end}}'</code></li>", strings.Join(takeFirst(unschedNames, 5), " ")))
		}
		if promData.HasProm && promData.MemRate > 80 {
			problems = append(problems, "<li>集群内存使用率超过 80%</li>")
			suggestions = append(suggestions, "<li>关注内存压力节点，考虑扩容或驱逐低优先级 Pod</li>")
		}
		if promData.HasProm && promData.AvgCPURate > 70 {
			problems = append(problems, "<li>集群 CPU 平均使用率超过 70%</li>")
			suggestions = append(suggestions, "<li>排查高 CPU 节点应用负载</li>")
		}
		// 磁盘 top3
		var diskWarn []string
		if promData.HasProm {
			for i, nd := range promData.DiskTop {
				if i >= 3 {
					break
				}
				if nd.DiskUsage > 70 {
					diskWarn = append(diskWarn, fmt.Sprintf("%s (%.1f%%)", nd.Name, nd.DiskUsage))
				}
			}
		}
		if len(diskWarn) > 0 {
			problems = append(problems, fmt.Sprintf("<li>部分节点磁盘使用率偏高: %s</li>", strings.Join(diskWarn, ", ")))
			suggestions = append(suggestions, "<li>清理磁盘空间: <code>docker image prune -a</code> / <code>docker container prune</code></li>")
		}
		// 内存 top3
		var memWarn []string
		if promData.HasProm {
			for i, nd := range promData.MemTop {
				if i >= 3 {
					break
				}
				if nd.MemoryUsage > 80 {
					memWarn = append(memWarn, fmt.Sprintf("%s (%.1f%%)", nd.Name, nd.MemoryUsage))
				}
			}
		}
		if len(memWarn) > 0 {
			problems = append(problems, fmt.Sprintf("<li>部分节点内存使用率偏高: %s</li>", strings.Join(memWarn, ", ")))
			suggestions = append(suggestions, "<li>监控高内存节点，排查内存泄漏</li>")
		}
		// CPU top3
		var cpuWarn []string
		if promData.HasProm {
			for i, nd := range promData.CpuTop {
				if i >= 3 {
					break
				}
				if nd.CPUUsage > 50 {
					cpuWarn = append(cpuWarn, fmt.Sprintf("%s (%.1f%%)", nd.Name, nd.CPUUsage))
				}
			}
		}
		if len(cpuWarn) > 0 {
			problems = append(problems, fmt.Sprintf("<li>部分节点 CPU 使用率偏高: %s</li>", strings.Join(cpuWarn, ", ")))
			suggestions = append(suggestions, "<li>排查高 CPU 使用率节点上的 Pod 资源请求与限制</li>")
		}
		if len(problems) == 0 {
			problems = append(problems, "<li>暂未发现明显风险项</li>")
			suggestions = append(suggestions, "<li>继续保持监控</li>")
		}
		sb.WriteString("<h4>6.1 发现的问题</h4><ol>" + strings.Join(problems, "") + "</ol>")
		sb.WriteString("<h4>6.2 优化建议</h4><ol>" + strings.Join(suggestions, "") + "</ol>")

		// 七、总结
		sb.WriteString("<h3>七、总结</h3>")
		sb.WriteString(fmt.Sprintf("<p>集群整体状态: <b>%s</b></p>", riskText))
		sb.WriteString("<p><b>优势:</b></p><ul>")
		if promData.HasProm && promData.AvgCPURate < 70 {
			sb.WriteString("<li>集群整体 CPU 使用率健康</li>")
		}
		if promData.HasProm && promData.MemRate < 80 {
			sb.WriteString("<li>集群整体内存使用率健康</li>")
		}
		if notReadyCount == 0 {
			sb.WriteString("<li>全部节点 Ready，无离线节点</li>")
		}
		if promData.HealthyRate > 90 {
			sb.WriteString(fmt.Sprintf("<li>%.1f%% Pod 正常运行</li>", promData.HealthyRate))
		}
		sb.WriteString("</ul>")
		if len(problems) > 0 && problems[0] != "<li>暂未发现明显风险项</li>" {
			sb.WriteString("<p><b>问题:</b></p><ul>")
			for _, p := range problems {
				p = strings.TrimPrefix(p, "<li>")
				p = strings.TrimSuffix(p, "</li>")
				sb.WriteString("<li>" + p + "</li>")
			}
			sb.WriteString("</ul>")
			sb.WriteString("<p><b>建议:</b></p><ul>")
			for _, sg := range suggestions {
				sg = strings.TrimPrefix(sg, "<li>")
				sg = strings.TrimSuffix(sg, "</li>")
				sb.WriteString("<li>" + sg + "</li>")
			}
			sb.WriteString("</ul>")
		}
	}

	// 检查项汇总（保留原有 findings）
	sb.WriteString("<h3>检查项汇总</h3>")
	sb.WriteString("<table border='1' cellpadding='8' cellspacing='0'><tr><th>检查项</th><th>状态</th><th>实际值</th><th>说明</th><th>建议</th></tr>")
	for _, f := range findings {
		sb.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%s</td><td>%v</td><td>%s</td><td>%s</td></tr>", f.Name, f.Level, f.Actual, f.Message, f.Suggestion))
	}
	sb.WriteString("</table>")
	return sb.String()
}

func generateMarkdownReport(cluster model.Cluster, findings []Finding, score int, riskLevel string, promData *PrometheusData) string {
	var sb strings.Builder
	nowStr := time.Now().Format("2006-01-02 15:04:05 MST")
	sb.WriteString(fmt.Sprintf("## 集群巡检报告: %s\n\n", cluster.DisplayName))
	sb.WriteString(fmt.Sprintf("- **评分**: %d\n- **风险等级**: %s\n- **报告时间**: %s\n\n", score, riskLevel, nowStr))

	if promData != nil {
		readyCount, notReadyCount, schedCount, unschedCount := 0, 0, 0, 0
		var unschedNames, notReadyNames []string
		for _, nd := range promData.NodeDetails {
			if nd.NodeStatus == "Ready" {
				readyCount++
			} else {
				notReadyCount++
				notReadyNames = append(notReadyNames, nd.Name)
			}
			if nd.Schedulable == "可调度" {
				schedCount++
			} else {
				unschedCount++
				unschedNames = append(unschedNames, nd.Name)
			}
		}

		sb.WriteString("### 一、集群规模\n")
		sb.WriteString("#### 1.1 节点信息\n")
		sb.WriteString("| 类型 | 节点数 | 总物理核 |\n")
		sb.WriteString("|------|--------|----------|\n")
		sb.WriteString(fmt.Sprintf("| Master | %d | - |\n", promData.MasterCount))
		sb.WriteString(fmt.Sprintf("| Worker | %d | - |\n", promData.WorkerCount))
		sb.WriteString(fmt.Sprintf("| **总计** | **%d** | **%.0f 核** |\n\n", promData.NodeCount, promData.TotalCPU))

		sb.WriteString("#### 1.2 节点调度状态统计\n")
		sb.WriteString("| 状态 | 节点数 | 占比 | 节点列表 |\n")
		sb.WriteString("|------|--------|------|----------|\n")
		if promData.NodeCount > 0 {
			sb.WriteString(fmt.Sprintf("| 可调度节点 | %d | %.1f%% | %s |\n", schedCount, float64(schedCount)*100/float64(promData.NodeCount), truncJoin(unschedNames, 5, "全部")))
			sb.WriteString(fmt.Sprintf("| 禁止调度节点 | %d | %.1f%% | %s |\n", unschedCount, float64(unschedCount)*100/float64(promData.NodeCount), joinOrDefault(unschedNames, "无")))
			sb.WriteString(fmt.Sprintf("| Ready 节点 | %d | %.1f%% | %s |\n", readyCount, float64(readyCount)*100/float64(promData.NodeCount), joinOrDefault(notReadyNames, "全部 Ready")))
			sb.WriteString(fmt.Sprintf("| NotReady 节点 | %d | %.1f%% | %s |\n\n", notReadyCount, float64(notReadyCount)*100/float64(promData.NodeCount), joinOrDefault(notReadyNames, "无")))
		}

		sb.WriteString("### 二、Pod 状态统计\n")
		sb.WriteString("| 状态 | 数量 | 占比 |\n")
		sb.WriteString("|------|------|------|\n")
		totalPods := promData.PodCount
		for _, status := range []string{"Running", "Pending", "Failed", "Succeeded"} {
			count := promData.PodStatus[status]
			pct := 0.0
			if totalPods > 0 {
				pct = float64(count) * 100.0 / float64(totalPods)
			}
			sb.WriteString(fmt.Sprintf("| %s | %d | %.1f%% |\n", status, count, pct))
		}
		sb.WriteString(fmt.Sprintf("| **总计** | **%d** | **100%%** |\n\n", totalPods))
		if totalPods > 0 {
			sb.WriteString(fmt.Sprintf("集群健康率: **%.1f%%** (Running / Total)\n\n", promData.HealthyRate))
		}

		sb.WriteString("### 三、资源使用情况\n")
		if !promData.HasProm {
			sb.WriteString("*未配置 Prometheus 数据源，以下仅展示静态资源信息。*\n\n")
		}
		sb.WriteString("#### 3.1 内存资源\n")
		sb.WriteString("| 指标 | 数值 |\n")
		sb.WriteString("|------|------|\n")
		sb.WriteString(fmt.Sprintf("| 总内存 | %.1f GB |\n", promData.TotalMemGB))
		if promData.HasProm {
			sb.WriteString(fmt.Sprintf("| 已用内存 | %.1f GB |\n", promData.UsedMemGB))
			sb.WriteString(fmt.Sprintf("| 可用内存 | %.1f GB |\n", promData.TotalMemGB-promData.UsedMemGB))
			sb.WriteString(fmt.Sprintf("| 使用率 | %.1f%% |\n\n", promData.MemRate))
		} else {
			sb.WriteString("| 已用内存 | - |\n")
			sb.WriteString("| 可用内存 | - |\n")
			sb.WriteString("| 使用率 | - |\n\n")
		}

		sb.WriteString("#### 3.2 资源置备比分析\n")
		sb.WriteString("| 资源类型 | 总量 | 已用/平均 | 使用率 | 评估 |\n")
		sb.WriteString("|----------|------|-----------|--------|------|\n")
		if promData.HasProm {
			cpuEval := evaluateRate(promData.AvgCPURate, 70, 85)
			memEval := evaluateRate(promData.MemRate, 80, 90)
			sb.WriteString(fmt.Sprintf("| CPU 物理核心 | %.0f 核 | 平均 %.1f%% | %.1f%% | %s |\n", promData.TotalCPU, promData.AvgCPURate, promData.AvgCPURate, cpuEval))
			sb.WriteString(fmt.Sprintf("| 内存 | %.1f GB | %.1f GB | %.1f%% | %s |\n\n", promData.TotalMemGB, promData.UsedMemGB, promData.MemRate, memEval))
		} else {
			sb.WriteString(fmt.Sprintf("| CPU 物理核心 | %.0f 核 | - | - | - |\n", promData.TotalCPU))
			sb.WriteString(fmt.Sprintf("| 内存 | %.1f GB | - | - | - |\n\n", promData.TotalMemGB))
		}

		sb.WriteString("### 四、节点资源使用详情\n")
		sb.WriteString(fmt.Sprintf("全部节点资源使用表 (%d 个节点)\n\n", len(promData.NodeDetails)))
		sb.WriteString("| # | 主机名 | IP 地址 | 角色 | 物理核 | CPU% | 内存% | 磁盘% | 节点状态 | 调度状态 |\n")
		sb.WriteString("|---|--------|---------|------|--------|------|------|------|----------|----------|\n")
		for i, nd := range promData.NodeDetails {
			if promData.HasProm {
				sb.WriteString(fmt.Sprintf("| %d | %s | %s | %s | %d | %.1f%% | %.1f%% | %.1f%% | %s | %s |\n",
					i+1, nd.Name, nd.IP, nd.Role, nd.CPUCore, nd.CPUUsage, nd.MemoryUsage, nd.DiskUsage, nd.NodeStatus, nd.Schedulable))
			} else {
				sb.WriteString(fmt.Sprintf("| %d | %s | %s | %s | %d | - | - | - | %s | %s |\n",
					i+1, nd.Name, nd.IP, nd.Role, nd.CPUCore, nd.NodeStatus, nd.Schedulable))
			}
		}
		sb.WriteString("\n")

		if promData.HasProm && len(promData.CpuTop) > 0 {
			sb.WriteString("#### 4.3 CPU 使用率 TOP 10\n")
			sb.WriteString("| 排名 | 节点名称 | CPU% | 调度状态 | 物理核 |\n")
			sb.WriteString("|------|----------|------|----------|--------|\n")
			for i, nd := range promData.CpuTop {
				if i >= 10 {
					break
				}
				sb.WriteString(fmt.Sprintf("| %d | %s | %.1f%% | %s | %d核 |\n", i+1, nd.Name, nd.CPUUsage, nd.Schedulable, nd.CPUCore))
			}
			sb.WriteString("\n")
		}
		if promData.HasProm && len(promData.MemTop) > 0 {
			sb.WriteString("#### 4.4 内存使用率 TOP 10\n")
			sb.WriteString("| 排名 | 节点名称 | 内存% | 调度状态 | 物理核 |\n")
			sb.WriteString("|------|----------|-------|----------|--------|\n")
			for i, nd := range promData.MemTop {
				if i >= 10 {
					break
				}
				sb.WriteString(fmt.Sprintf("| %d | %s | %.1f%% | %s | %d核 |\n", i+1, nd.Name, nd.MemoryUsage, nd.Schedulable, nd.CPUCore))
			}
			sb.WriteString("\n")
		}
		if promData.HasProm && len(promData.DiskTop) > 0 {
			sb.WriteString("#### 4.5 磁盘使用率 TOP 10\n")
			sb.WriteString("| 排名 | 节点名称 | 磁盘% | 调度状态 | 物理核 |\n")
			sb.WriteString("|------|----------|-------|----------|--------|\n")
			for i, nd := range promData.DiskTop {
				if i >= 10 {
					break
				}
				sb.WriteString(fmt.Sprintf("| %d | %s | %.1f%% | %s | %d核 |\n", i+1, nd.Name, nd.DiskUsage, nd.Schedulable, nd.CPUCore))
			}
			sb.WriteString("\n")
		}

		sb.WriteString("### 五、风险评估\n")
		sb.WriteString("#### 5.1 风险项分析\n")
		sb.WriteString("| 风险项 | 当前值 | 阈值 | 风险等级 |\n")
		sb.WriteString("|--------|--------|------|----------|\n")
		failedCnt, pendingCnt, unschedRate := promData.PodStatus["Failed"], promData.PodStatus["Pending"], 0.0
		if promData.NodeCount > 0 {
			unsched := 0
			for _, nd := range promData.NodeDetails {
				if nd.Schedulable == "禁止调度" {
					unsched++
				}
			}
			unschedRate = float64(unsched) * 100.0 / float64(promData.NodeCount)
		}
		sb.WriteString(riskRowMD("Failed Pod", fmt.Sprintf("%d 个", failedCnt), ">30", failedCnt, 30))
		sb.WriteString(riskRowMD("Pending Pod", fmt.Sprintf("%d 个", pendingCnt), ">50", pendingCnt, 50))
		sb.WriteString(riskRowMD("集群健康率", fmt.Sprintf("%.1f%%", promData.HealthyRate), "<95%", promData.HealthyRate < 95, 0))
		if promData.HasProm {
			sb.WriteString(riskRowMD("内存使用率", fmt.Sprintf("%.1f%%", promData.MemRate), ">80%", promData.MemRate, 80))
			sb.WriteString(riskRowMD("CPU 平均使用率", fmt.Sprintf("%.1f%%", promData.AvgCPURate), ">70%", promData.AvgCPURate, 70))
		} else {
			sb.WriteString("| 内存使用率 | - | >80% | 未配置 Prometheus |\n")
			sb.WriteString("| CPU 平均使用率 | - | >70% | 未配置 Prometheus |\n")
		}
		sb.WriteString(riskRowMD("禁止调度节点占比", fmt.Sprintf("%.1f%%", unschedRate), ">20%", unschedRate, 20))
		sb.WriteString("\n")

		riskText := "✅ 低风险"
		if riskLevel == "medium" {
			riskText = "🟡 中风险"
		} else if riskLevel == "high" {
			riskText = "🔴 高风险"
		} else if riskLevel == "critical" {
			riskText = "🔴 极高风险"
		}
		sb.WriteString(fmt.Sprintf("#### 5.2 综合风险评分\n**%s (评分: %d)**\n\n", riskText, score))

		sb.WriteString("### 六、问题与建议\n")
		var problems, suggestions []string
		if unschedCount > 0 {
			problems = append(problems, fmt.Sprintf("- %d 个节点被禁止调度 (%.1f%%): %s", unschedCount, float64(unschedCount)*100/float64(promData.NodeCount), strings.Join(unschedNames, ", ")))
			suggestions = append(suggestions, fmt.Sprintf("- 检查禁止调度节点原因: `kubectl get nodes %s -o jsonpath='{{range .items[*]}} {{.metadata.name}}\\t{{.spec.taints}}\\n{{end}}'`", strings.Join(takeFirst(unschedNames, 5), " ")))
		}
		if promData.HasProm && promData.MemRate > 80 {
			problems = append(problems, "- 集群内存使用率超过 80%")
			suggestions = append(suggestions, "- 关注内存压力节点，考虑扩容或驱逐低优先级 Pod")
		}
		if promData.HasProm && promData.AvgCPURate > 70 {
			problems = append(problems, "- 集群 CPU 平均使用率超过 70%")
			suggestions = append(suggestions, "- 排查高 CPU 节点应用负载")
		}
		var diskWarn []string
		if promData.HasProm {
			for i, nd := range promData.DiskTop {
				if i >= 3 {
					break
				}
				if nd.DiskUsage > 70 {
					diskWarn = append(diskWarn, fmt.Sprintf("%s (%.1f%%)", nd.Name, nd.DiskUsage))
				}
			}
		}
		if len(diskWarn) > 0 {
			problems = append(problems, fmt.Sprintf("- 部分节点磁盘使用率偏高: %s", strings.Join(diskWarn, ", ")))
			suggestions = append(suggestions, "- 清理磁盘空间: `docker image prune -a` / `docker container prune`")
		}
		var memWarn []string
		if promData.HasProm {
			for i, nd := range promData.MemTop {
				if i >= 3 {
					break
				}
				if nd.MemoryUsage > 80 {
					memWarn = append(memWarn, fmt.Sprintf("%s (%.1f%%)", nd.Name, nd.MemoryUsage))
				}
			}
		}
		if len(memWarn) > 0 {
			problems = append(problems, fmt.Sprintf("- 部分节点内存使用率偏高: %s", strings.Join(memWarn, ", ")))
			suggestions = append(suggestions, "- 监控高内存节点，排查内存泄漏")
		}
		var cpuWarn []string
		if promData.HasProm {
			for i, nd := range promData.CpuTop {
				if i >= 3 {
					break
				}
				if nd.CPUUsage > 50 {
					cpuWarn = append(cpuWarn, fmt.Sprintf("%s (%.1f%%)", nd.Name, nd.CPUUsage))
				}
			}
		}
		if len(cpuWarn) > 0 {
			problems = append(problems, fmt.Sprintf("- 部分节点 CPU 使用率偏高: %s", strings.Join(cpuWarn, ", ")))
			suggestions = append(suggestions, "- 排查高 CPU 使用率节点上的 Pod 资源请求与限制")
		}
		if len(problems) == 0 {
			problems = append(problems, "- 暂未发现明显风险项")
			suggestions = append(suggestions, "- 继续保持监控")
		}
		sb.WriteString("#### 6.1 发现的问题\n" + strings.Join(problems, "\n") + "\n\n")
		sb.WriteString("#### 6.2 优化建议\n" + strings.Join(suggestions, "\n") + "\n\n")

		sb.WriteString("### 七、总结\n")
		sb.WriteString(fmt.Sprintf("集群整体状态: **%s**\n\n", riskText))
		sb.WriteString("**优势:**\n")
		if promData.HasProm && promData.AvgCPURate < 70 {
			sb.WriteString("- 集群整体 CPU 使用率健康\n")
		}
		if promData.HasProm && promData.MemRate < 80 {
			sb.WriteString("- 集群整体内存使用率健康\n")
		}
		if notReadyCount == 0 {
			sb.WriteString("- 全部节点 Ready，无离线节点\n")
		}
		if promData.HealthyRate > 90 {
			sb.WriteString(fmt.Sprintf("- %.1f%% Pod 正常运行\n", promData.HealthyRate))
		}
		sb.WriteString("\n")
		if len(problems) > 0 && problems[0] != "- 暂未发现明显风险项" {
			sb.WriteString("**问题:**\n" + strings.Join(problems, "\n") + "\n\n")
			sb.WriteString("**建议:**\n" + strings.Join(suggestions, "\n") + "\n\n")
		}
	}

	sb.WriteString("### 检查项汇总\n")
	sb.WriteString("| 检查项 | 状态 | 实际值 | 说明 | 建议 |\n")
	sb.WriteString("|--------|------|--------|------|------|\n")
	for _, f := range findings {
		sb.WriteString(fmt.Sprintf("| %s | %s | %v | %s | %s |\n", f.Name, f.Level, f.Actual, f.Message, f.Suggestion))
	}
	return sb.String()
}

func riskRowHTML(name, actual, threshold string, exceed interface{}, numericThreshold float64) string {
	var level string
	switch v := exceed.(type) {
	case bool:
		if v {
			level = "🟡 警告"
		} else {
			level = "✅ 正常"
		}
	case float64:
		if v > numericThreshold {
			level = "🟡 警告"
		} else {
			level = "✅ 正常"
		}
	case int:
		if float64(v) > numericThreshold {
			level = "🟡 警告"
		} else {
			level = "✅ 正常"
		}
	}
	return fmt.Sprintf("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>", name, actual, threshold, level)
}

func riskRowMD(name, actual, threshold string, exceed interface{}, numericThreshold float64) string {
	var level string
	switch v := exceed.(type) {
	case bool:
		if v {
			level = "🟡 警告"
		} else {
			level = "✅ 正常"
		}
	case float64:
		if v > numericThreshold {
			level = "🟡 警告"
		} else {
			level = "✅ 正常"
		}
	case int:
		if float64(v) > numericThreshold {
			level = "🟡 警告"
		} else {
			level = "✅ 正常"
		}
	}
	return fmt.Sprintf("| %s | %s | %s | %s |\n", name, actual, threshold, level)
}

func evaluateRate(rate, warn, critical float64) string {
	if rate >= critical {
		return "🔴 高风险"
	}
	if rate >= warn {
		return "🟡 警告"
	}
	return "✅ 健康"
}

func joinOrDefault(arr []string, def string) string {
	if len(arr) == 0 {
		return def
	}
	return strings.Join(arr, ", ")
}

func truncJoin(arr []string, limit int, def string) string {
	if len(arr) == 0 {
		return def
	}
	if len(arr) <= limit {
		return strings.Join(arr, ", ")
	}
	return strings.Join(arr[:limit], ", ") + "..."
}

func takeFirst(arr []string, n int) []string {
	if len(arr) <= n {
		return arr
	}
	return arr[:n]
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

// DeleteTask 删除任务（物理删除 + 级联删除执行记录）
func (s *InspectionService) DeleteTask(id uint) error {
	s.mu.Lock()
	if entryID, ok := s.taskEntries[id]; ok {
		s.cron.Remove(entryID)
		delete(s.taskEntries, id)
	}
	s.mu.Unlock()
	// 级联删除关联的巡检执行记录
	if err := s.db.Where("task_id = ?", id).Delete(&model.InspectionJob{}).Error; err != nil {
		return err
	}
	// 物理删除任务（避免同名任务冲突 + 释放数据）
	return s.db.Unscoped().Delete(&model.InspectionTask{}, id).Error
}

// TriggerJob 手动触发巡检
func (s *InspectionService) TriggerJob(taskID uint) error {
	go s.triggerJob(taskID, "manual")
	return nil
}

// QuickInspect 一键快速巡检（无需预先创建任务）
func (s *InspectionService) QuickInspect(ctx context.Context, clusterIDs []uint) (*model.InspectionJob, error) {
	if len(clusterIDs) == 0 {
		var clusters []model.Cluster
		if err := s.db.Where("is_active = ?", true).Find(&clusters).Error; err != nil {
			return nil, err
		}
		if len(clusters) == 0 {
			return nil, fmt.Errorf("没有可用的活跃集群")
		}
		for _, c := range clusters {
			clusterIDs = append(clusterIDs, c.ID)
		}
	}

	// 创建临时 Job 记录
	job := model.InspectionJob{
		TaskID:        0, // 0 表示快速巡检
		Status:        "running",
		TriggerType:   "manual",
		StartedAt:     ptrTime(time.Now()),
		TotalClusters: len(clusterIDs),
	}
	if err := s.db.Create(&job).Error; err != nil {
		return nil, err
	}

	// 在后台执行巡检
	go func() {
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

func ptrTime(t time.Time) *time.Time {
	return &t
}
