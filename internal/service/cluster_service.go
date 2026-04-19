package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"gorm.io/gorm"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/cloudops/platform/internal/model"
)

// ClusterService 集群管理服务
type ClusterService struct {
	db         *gorm.DB
	k8sManager *K8sManager
}

// NewClusterService 创建集群服务
func NewClusterService(db *gorm.DB, k8sManager *K8sManager) *ClusterService {
	return &ClusterService{
		db:         db,
		k8sManager: k8sManager,
	}
}

// CreateClusterRequest 创建集群请求
type CreateClusterRequest struct {
	Name              string `json:"name" binding:"required"`
	DisplayName       string `json:"display_name"`
	Description       string `json:"description"`
	AuthType          string `json:"auth_type" binding:"required"` // kubeconfig/token
	ClusterLabelName  string `json:"cluster_label_name"`
	ClusterLabelValue string `json:"cluster_label_value"`
	KubeConfig        string `json:"kubeconfig,omitempty"`
	Token             string `json:"token,omitempty"`
	Server            string `json:"server,omitempty"`
}

// CreateCluster 创建集群
func (s *ClusterService) CreateCluster(ctx context.Context, userID uint, tenantID uint, req *CreateClusterRequest) (*model.Cluster, error) {
	// 1. 验证集群名称唯一性
	var existing model.Cluster
	if err := s.db.Where("name = ? AND tenant_id = ?", req.Name, tenantID).First(&existing).Error; err == nil {
		return nil, fmt.Errorf("cluster name already exists")
	}

	// 2. 解析kubeconfig获取server地址
	var server string
	var encryptedData string

	if req.AuthType == "kubeconfig" {
		// 解析kubeconfig
		config, err := clientcmd.Load([]byte(req.KubeConfig))
		if err != nil {
			return nil, fmt.Errorf("invalid kubeconfig: %w", err)
		}
		
		// 获取当前context的server
		currentContext := config.CurrentContext
		if context, ok := config.Contexts[currentContext]; ok {
			if cluster, ok := config.Clusters[context.Cluster]; ok {
				server = cluster.Server
			}
		}
		
		encryptedData = req.KubeConfig
	} else if req.AuthType == "token" {
		server = req.Server
		encryptedData = req.Token
	}

	// 3. 创建集群记录
	cluster := &model.Cluster{
		TenantID:          tenantID,
		Name:              req.Name,
		DisplayName:       req.DisplayName,
		Description:       req.Description,
		AuthType:          req.AuthType,
		ClusterLabelName:  req.ClusterLabelName,
		ClusterLabelValue: req.ClusterLabelValue,
		Server:            server,
		IsActive:          true,
	}

	if err := s.db.Create(cluster).Error; err != nil {
		return nil, fmt.Errorf("create cluster failed: %w", err)
	}

	// 4. 创建密钥记录
	secret := &model.ClusterSecret{
		ClusterID:     cluster.ID,
		SecretType:    req.AuthType,
		EncryptedData: encryptedData,
	}

	if err := s.db.Create(secret).Error; err != nil {
		return nil, fmt.Errorf("create secret failed: %w", err)
	}

	// 5. 创建元数据记录
	metadata := &model.ClusterMetadata{
		ClusterID:    cluster.ID,
		HealthStatus: "pending",
	}
	if err := s.db.Create(metadata).Error; err != nil {
		return nil, fmt.Errorf("create metadata failed: %w", err)
	}

	// 6. 异步测试连接
	go s.testClusterConnection(cluster.ID)

	// 7. 记录审计日志
	s.logAudit(ctx, userID, tenantID, &cluster.ID, req.Name, "create", "cluster", 
		fmt.Sprintf("%d", cluster.ID), "", "success", "", 0)

	return cluster, nil
}

// ListClusters 获取集群列表（支持筛选 + 数据权限）
func (s *ClusterService) ListClusters(ctx context.Context, userID, tenantID uint, keyword, status, authType string) ([]model.Cluster, error) {
	var clusters []model.Cluster
	db := s.db.Preload("Metadata")
	if tenantID > 0 {
		db = db.Where("tenant_id = ?", tenantID)
	}

	if keyword != "" {
		db = db.Where("name LIKE ? OR display_name LIKE ? OR server LIKE ?",
			"%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
	}

	if authType != "" {
		db = db.Where("auth_type = ?", authType)
	}

	if status != "" {
		// 通过子查询筛选 metadata 中的 health_status
		db = db.Where("EXISTS (?)",
			s.db.Select("1").Table("cluster_metadata").
				Where("cluster_metadata.cluster_id = clusters.id").
				Where("cluster_metadata.health_status = ?", status))
	}

	// namespace 级角色：只返回有授权记录的集群
	if userID > 0 {
		rbacSvc := NewRBACService(s.db)
		scope, _, allowedClusters, _ := rbacSvc.GetDataScope(ctx, userID)
		if scope == "namespace" {
			if len(allowedClusters) > 0 {
				db = db.Where("id IN ?", allowedClusters)
			} else {
				// 没有任何授权，返回空结果
				return []model.Cluster{}, nil
			}
		}
	}

	if err := db.Find(&clusters).Error; err != nil {
		return nil, err
	}
	return clusters, nil
}

// GetCluster 获取集群详情
func (s *ClusterService) GetCluster(ctx context.Context, clusterID uint) (*model.Cluster, error) {
	var cluster model.Cluster
	if err := s.db.Preload("Metadata").Preload("Secrets").First(&cluster, clusterID).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

// DeleteCluster 删除集群
func (s *ClusterService) DeleteCluster(ctx context.Context, userID uint, tenantID uint, clusterID uint) error {
	// 获取集群信息用于审计日志
	var cluster model.Cluster
	if err := s.db.First(&cluster, clusterID).Error; err != nil {
		return err
	}

	// 物理删除关联数据
	s.db.Where("cluster_id = ?", clusterID).Delete(&model.ClusterSecret{})
	s.db.Where("cluster_id = ?", clusterID).Delete(&model.ClusterMetadata{})
	s.db.Where("cluster_id = ?", clusterID).Delete(&model.ClusterPermission{})
	s.db.Where("cluster_id = ?", clusterID).Delete(&model.ClusterLogBackend{})

	// 物理删除集群（避免软删除导致唯一索引冲突）
	if err := s.db.Unscoped().Delete(&model.Cluster{}, clusterID).Error; err != nil {
		return err
	}

	// 清理该集群的终端家目录（仅在用户手动删除时执行）
	homeDir := filepath.Join("/tmp/cloudops-home", fmt.Sprintf("cluster-%d", clusterID))
	_ = os.RemoveAll(homeDir)

	// 清理巡检任务中引用的该集群ID
	var tasks []model.InspectionTask
	if err := s.db.WithContext(ctx).Where("tenant_id = ?", tenantID).Find(&tasks).Error; err == nil {
		for _, task := range tasks {
			var ids []uint
			if json.Unmarshal([]byte(task.ClusterIDs), &ids) == nil {
				newIDs := make([]uint, 0, len(ids))
				for _, id := range ids {
					if id != clusterID {
						newIDs = append(newIDs, id)
					}
				}
				if len(newIDs) != len(ids) {
					if len(newIDs) == 0 {
						// 无关联集群则禁用该任务
						s.db.Model(&task).Updates(map[string]interface{}{"cluster_ids": "[]", "enabled": false})
					} else {
						b, _ := json.Marshal(newIDs)
						s.db.Model(&task).Update("cluster_ids", string(b))
					}
				}
			}
		}
	}

	// 从K8s管理器移除
	s.k8sManager.RemoveClient(clusterID)

	// 记录审计日志
	s.logAudit(ctx, userID, tenantID, &clusterID, cluster.Name, "delete", "cluster",
		fmt.Sprintf("%d", clusterID), "", "success", "", 0)

	return nil
}

// testClusterConnection 测试集群连接
func (s *ClusterService) testClusterConnection(clusterID uint) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	start := time.Now()
	
	// 获取客户端
	client, err := s.GetK8sClient(ctx, clusterID)
	if err != nil {
		s.updateClusterHealth(clusterID, "error", err.Error())
		return
	}

	// 测试连接 - 获取版本
	version, err := client.Discovery().ServerVersion()
	if err != nil {
		s.updateClusterHealth(clusterID, "error", err.Error())
		return
	}

	duration := time.Since(start).Milliseconds()

	// 获取集群信息
	nodes, _ := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	pods, _ := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	namespaces, _ := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})

	// 更新元数据
	metadata := model.ClusterMetadata{
		ClusterID:      clusterID,
		Version:        version.GitVersion,
		NodeCount:      len(nodes.Items),
		PodCount:       len(pods.Items),
		NamespaceCount: len(namespaces.Items),
		HealthStatus:   "healthy",
		LastSyncedAt:   &[]time.Time{time.Now()}[0],
	}

	s.db.Model(&model.ClusterMetadata{}).Where("cluster_id = ?", clusterID).Updates(metadata)

	// 启动 Informer
	go s.k8sManager.StartCluster(context.Background(), clusterID)

	// 记录审计日志
	s.logAudit(context.Background(), 0, 0, &clusterID, "", "health_check", "cluster", 
		fmt.Sprintf("%d", clusterID), "", "success", "", duration)
}

// updateClusterHealth 更新集群健康状态
func (s *ClusterService) updateClusterHealth(clusterID uint, status string, errorMsg string) {
	s.db.Model(&model.ClusterMetadata{}).Where("cluster_id = ?", clusterID).Update("health_status", status)
}

// StartHealthMonitor 启动集群健康检查（每 30 秒一次）
func (s *ClusterService) StartHealthMonitor() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			var list []model.Cluster
			if err := s.db.Find(&list).Error; err != nil {
				continue
			}
			for _, c := range list {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				client, err := s.GetK8sClient(ctx, c.ID)
				if err != nil {
					cancel()
					s.updateClusterHealth(c.ID, "error", "")
					continue
				}
				_, err = client.Discovery().ServerVersion()
				cancel()
				status := "error"
				if err == nil {
					status = "healthy"
				}
				s.updateClusterHealth(c.ID, status, "")
			}
		}
	}()
}

// GetK8sClient 获取K8s客户端
func (s *ClusterService) GetK8sClient(ctx context.Context, clusterID uint) (*kubernetes.Clientset, error) {
	// 先从管理器获取
	if client := s.k8sManager.GetClient(clusterID); client != nil {
		return client, nil
	}

	// 从数据库获取密钥
	var secret model.ClusterSecret
	if err := s.db.Where("cluster_id = ?", clusterID).First(&secret).Error; err != nil {
		return nil, fmt.Errorf("cluster secret not found")
	}

	var config *rest.Config
	var err error

	if secret.SecretType == "kubeconfig" {
		// 从kubeconfig构建配置
		config, err = clientcmd.RESTConfigFromKubeConfig([]byte(secret.EncryptedData))
		if err != nil {
			return nil, fmt.Errorf("parse kubeconfig failed: %w", err)
		}
	} else if secret.SecretType == "token" {
		// 从token构建配置
		var cluster model.Cluster
		s.db.First(&cluster, clusterID)
		
		config = &rest.Config{
			Host:        cluster.Server,
			BearerToken: secret.EncryptedData,
			TLSClientConfig: rest.TLSClientConfig{
				Insecure: true, // 生产环境应该验证证书
			},
		}
	}

	// 创建客户端
	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create k8s client failed: %w", err)
	}

	// 缓存客户端
	s.k8sManager.AddClient(clusterID, client)

	return client, nil
}

// UpdateClusterRequest 更新集群请求
type UpdateClusterRequest struct {
	DisplayName       string `json:"display_name"`
	Description       string `json:"description"`
	ClusterLabelName  string `json:"cluster_label_name"`
	ClusterLabelValue string `json:"cluster_label_value"`
}

// UpdateCluster 更新集群信息
func (s *ClusterService) UpdateCluster(ctx context.Context, tenantID, clusterID uint, req *UpdateClusterRequest) (*model.Cluster, error) {
	var cluster model.Cluster
	if err := s.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", tenantID, clusterID).First(&cluster).Error; err != nil {
		return nil, err
	}

	cluster.DisplayName = req.DisplayName
	cluster.Description = req.Description
	cluster.ClusterLabelName = req.ClusterLabelName
	cluster.ClusterLabelValue = req.ClusterLabelValue

	if err := s.db.WithContext(ctx).Save(&cluster).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

// ProbeLabelSuggestion 探测到的标签建议
type ProbeLabelSuggestion struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Source string `json:"source"`
}

// TestAndProbeResult 测试连接并探测结果
type TestAndProbeResult struct {
	Connected           bool                   `json:"connected"`
	KubernetesVersion   string                 `json:"kubernetes_version"`
	ClusterNameFromCtx  string                 `json:"cluster_name_from_context"`
	SuggestedLabels     []ProbeLabelSuggestion `json:"suggested_labels"`
	Message             string                 `json:"message,omitempty"`
}

// TestAndProbeCluster 临时连接集群并探测监控标签配置
func (s *ClusterService) TestAndProbeCluster(ctx context.Context, req *CreateClusterRequest) (*TestAndProbeResult, error) {
	result := &TestAndProbeResult{
		Connected:          false,
		SuggestedLabels:    make([]ProbeLabelSuggestion, 0),
	}

	// 1. 构建临时 rest.Config
	var config *rest.Config
	var err error
	if req.AuthType == "kubeconfig" && req.KubeConfig != "" {
		config, err = clientcmd.RESTConfigFromKubeConfig([]byte(req.KubeConfig))
		if err != nil {
			return nil, fmt.Errorf("解析 kubeconfig 失败: %w", err)
		}
		// 尝试从 kubeconfig 读取当前 context 名称
		if kcfg, err := clientcmd.Load([]byte(req.KubeConfig)); err == nil && kcfg.CurrentContext != "" {
			result.ClusterNameFromCtx = kcfg.CurrentContext
		}
	} else if req.AuthType == "token" && req.Server != "" && req.Token != "" {
		config = &rest.Config{
			Host:        req.Server,
			BearerToken: req.Token,
			TLSClientConfig: rest.TLSClientConfig{
				Insecure: true,
			},
		}
	} else {
		return nil, fmt.Errorf("缺少认证信息")
	}

	// 2. 测试 K8s 连通性
	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("创建 K8s 客户端失败: %w", err)
	}

	version, err := client.Discovery().ServerVersion()
	if err != nil {
		return nil, fmt.Errorf("连接集群失败: %w", err)
	}
	result.Connected = true
	result.KubernetesVersion = version.GitVersion

	// 3. 探测 Prometheus CRD
	dynClient, err := dynamic.NewForConfig(config)
	if err != nil {
		result.Message = "创建动态客户端失败，跳过监控探测"
		return result, nil
	}

	promGVR := schema.GroupVersionResource{
		Group:    "monitoring.coreos.com",
		Version:  "v1",
		Resource: "prometheuses",
	}

	namespaces := []string{"monitoring", "kubesphere-monitoring-system"}
	seen := make(map[string]bool)

	for _, ns := range namespaces {
		list, err := dynClient.Resource(promGVR).Namespace(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			continue
		}
		for _, item := range list.Items {
			name := item.GetName()

			// externalLabels
			spec, _, _ := unstructured.NestedMap(item.Object, "spec")
			if extLabels, _, err := unstructured.NestedMap(spec, "externalLabels"); err == nil {
				for k, v := range extLabels {
					val := fmt.Sprintf("%v", v)
					if val == "" {
						continue
					}
					key := fmt.Sprintf("%s=%s|%s", k, val, "externalLabels")
					if seen[key] {
						continue
					}
					seen[key] = true
					result.SuggestedLabels = append(result.SuggestedLabels, ProbeLabelSuggestion{
						Key:    k,
						Value:  val,
						Source: fmt.Sprintf("PrometheusCR/%s/%s externalLabels", ns, name),
					})
				}
			}

			// remoteWrite.writeRelabelConfigs
			rwList, _, _ := unstructured.NestedSlice(spec, "remoteWrite")
			for _, rw := range rwList {
				rwMap, ok := rw.(map[string]interface{})
				if !ok {
					continue
				}
				relabelConfigs, _, _ := unstructured.NestedSlice(rwMap, "writeRelabelConfigs")
				for _, rl := range relabelConfigs {
					rlMap, ok := rl.(map[string]interface{})
					if !ok {
						continue
					}
					targetLabel, _, _ := unstructured.NestedString(rlMap, "targetLabel")
					replacement, _, _ := unstructured.NestedString(rlMap, "replacement")
					if targetLabel == "" || replacement == "" {
						continue
					}
					key := fmt.Sprintf("%s=%s|%s", targetLabel, replacement, "remoteWrite")
					if seen[key] {
						continue
					}
					seen[key] = true
					result.SuggestedLabels = append(result.SuggestedLabels, ProbeLabelSuggestion{
						Key:    targetLabel,
						Value:  replacement,
						Source: fmt.Sprintf("PrometheusCR/%s/%s remoteWrite", ns, name),
					})
				}
			}
		}
	}

	// 4. 如果没有任何建议，尝试探测 VMAgent CRD
	if len(result.SuggestedLabels) == 0 {
		vmAgentGVR := schema.GroupVersionResource{
			Group:    "operator.victoriametrics.com",
			Version:  "v1beta1",
			Resource: "vmagents",
		}
		for _, ns := range namespaces {
			list, err := dynClient.Resource(vmAgentGVR).Namespace(ns).List(ctx, metav1.ListOptions{})
			if err != nil {
				continue
			}
			for _, item := range list.Items {
				name := item.GetName()
				spec, _, _ := unstructured.NestedMap(item.Object, "spec")
				remoteWrite, _, _ := unstructured.NestedSlice(spec, "remoteWrite")
				for _, rw := range remoteWrite {
					rwMap, ok := rw.(map[string]interface{})
					if !ok {
						continue
					}
					urlStr, _, _ := unstructured.NestedString(rwMap, "url")
					labels, _, _ := unstructured.NestedMap(rwMap, "externalLabels")
					for k, v := range labels {
						val := fmt.Sprintf("%v", v)
						if val == "" {
							continue
						}
						key := fmt.Sprintf("%s=%s|%s", k, val, "vmagent")
						if seen[key] {
							continue
						}
						seen[key] = true
						result.SuggestedLabels = append(result.SuggestedLabels, ProbeLabelSuggestion{
							Key:    k,
							Value:  val,
							Source: fmt.Sprintf("VMAgent/%s/%s remoteWrite", ns, name),
						})
					}
					// 如果 url 包含 vminsert，标记一下提示
					if urlStr != "" && len(result.SuggestedLabels) > 0 {
						result.Message = "检测到 VictoriaMetrics 远程写入配置"
					}
				}
			}
		}
	}

	if len(result.SuggestedLabels) == 0 {
		result.Message = "集群连接成功，未在 monitoring / kubesphere-monitoring-system 中检测到 Prometheus/VM 标签配置"
	}

	return result, nil
}

// logAudit 记录审计日志
func (s *ClusterService) logAudit(ctx context.Context, userID uint, tenantID uint, clusterID *uint, 
	clusterName string, action string, resource string, resourceID string, namespace string, 
	status string, errorMsg string, duration int64) {
	
	// 获取用户信息
	var username string
	if userID > 0 {
		var user model.User
		s.db.Select("username").First(&user, userID)
		username = user.Username
	}

	log := &model.AuditLog{
		UserID:      userID,
		Username:    username,
		TenantID:    tenantID,
		ClusterID:   clusterID,
		ClusterName: clusterName,
		Action:      action,
		Resource:    resource,
		ResourceID:  resourceID,
		Namespace:   namespace,
		Status:      status,
		ErrorMsg:    errorMsg,
		Duration:    duration,
	}

	s.db.Create(log)
}