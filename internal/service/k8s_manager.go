package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/cache"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/crypto"
	"gorm.io/gorm"
)

// ClusterClient 单个集群的客户端和缓存
type ClusterClient struct {
	Client      *kubernetes.Clientset
	Config      *rest.Config
	Factory     informers.SharedInformerFactory
	StopCh      chan struct{}
	LastUsed    time.Time
	Health      bool
	SyncReady   bool
	SyncMu      sync.RWMutex
	
	// Informer stores for fast memory access
	NodeStore            cache.Store
	NamespaceStore       cache.Store
	PodStore             cache.Store
	DeploymentStore      cache.Store
	StatefulSetStore     cache.Store
	DaemonSetStore       cache.Store
	ReplicaSetStore      cache.Store
	JobStore             cache.Store
	CronJobStore         cache.Store
	ServiceStore         cache.Store
	IngressStore         cache.Store
	EndpointStore        cache.Store
	PersistentVolumeStore       cache.Store
	PersistentVolumeClaimStore  cache.Store
	StorageClassStore    cache.Store
	ConfigMapStore       cache.Store
	SecretStore          cache.Store
	ServiceAccountStore  cache.Store
	RoleStore            cache.Store
	RoleBindingStore     cache.Store
	ClusterRoleStore     cache.Store
	ClusterRoleBindingStore cache.Store
	EventStore           cache.Store
}

// K8sManager K8s客户端与Informer管理器
type K8sManager struct {
	clients   map[uint]*ClusterClient
	mu        sync.RWMutex
	db        *gorm.DB
	encryptor *crypto.AES256Encrypt
}

// NewK8sManager 创建管理器
func NewK8sManager(db *gorm.DB, encryptor *crypto.AES256Encrypt) *K8sManager {
	m := &K8sManager{
		clients:   make(map[uint]*ClusterClient),
		db:        db,
		encryptor: encryptor,
	}
	return m
}

// InitClusters 启动时初始化所有活跃集群的Informer
func (km *K8sManager) InitClusters() {
	var clusters []model.Cluster
	if err := km.db.Where("is_active = ?", true).Find(&clusters).Error; err != nil {
		return
	}
	for _, cluster := range clusters {
		go km.StartCluster(context.Background(), cluster.ID)
	}
}

// GetClient 获取原始客户端（向后兼容）
func (km *K8sManager) GetClient(clusterID uint) *kubernetes.Clientset {
	km.mu.RLock()
	defer km.mu.RUnlock()

	if c, ok := km.clients[clusterID]; ok {
		c.LastUsed = time.Now()
		return c.Client
	}
	return nil
}

// GetClusterClient 获取完整ClusterClient（含Store）
func (km *K8sManager) GetClusterClient(clusterID uint) *ClusterClient {
	km.mu.RLock()
	defer km.mu.RUnlock()
	if c, ok := km.clients[clusterID]; ok {
		c.LastUsed = time.Now()
		return c
	}
	return nil
}

// buildConfig 从数据库构建 rest.Config
func (km *K8sManager) buildConfig(clusterID uint) (*rest.Config, error) {
	var secret model.ClusterSecret
	if err := km.db.Where("cluster_id = ?", clusterID).First(&secret).Error; err != nil {
		return nil, fmt.Errorf("cluster secret not found")
	}

	decryptedData, err := km.encryptor.Decrypt(secret.EncryptedData)
	if err != nil {
		return nil, fmt.Errorf("decrypt failed: %w", err)
	}

	var config *rest.Config
	if secret.SecretType == "kubeconfig" {
		config, err = clientcmd.RESTConfigFromKubeConfig([]byte(decryptedData))
		if err != nil {
			return nil, fmt.Errorf("parse kubeconfig failed: %w", err)
		}
	} else if secret.SecretType == "token" {
		var cluster model.Cluster
		km.db.First(&cluster, clusterID)
		config = &rest.Config{
			Host:        cluster.Server,
			BearerToken: decryptedData,
			TLSClientConfig: rest.TLSClientConfig{
				Insecure: true,
			},
		}
	}
	return config, nil
}

// createClusterClient 内部方法：构建并启动一个新的 ClusterClient
func (km *K8sManager) createClusterClient(ctx context.Context, clusterID uint) (*ClusterClient, error) {
	config, err := km.buildConfig(clusterID)
	if err != nil {
		return nil, err
	}

	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	version, err := client.Discovery().ServerVersion()
	if err != nil {
		return nil, err
	}

	stopCh := make(chan struct{})
	factory := informers.NewSharedInformerFactory(client, 10*time.Minute)

	cc := &ClusterClient{
		Client:    client,
		Config:    config,
		Factory:   factory,
		StopCh:    stopCh,
		LastUsed:  time.Now(),
		Health:    true,
	}

	// 注册所有资源类型的 Informer
	cc.NodeStore = factory.Core().V1().Nodes().Informer().GetStore()
	cc.NamespaceStore = factory.Core().V1().Namespaces().Informer().GetStore()
	cc.PodStore = factory.Core().V1().Pods().Informer().GetStore()
	cc.DeploymentStore = factory.Apps().V1().Deployments().Informer().GetStore()
	cc.StatefulSetStore = factory.Apps().V1().StatefulSets().Informer().GetStore()
	cc.DaemonSetStore = factory.Apps().V1().DaemonSets().Informer().GetStore()
	cc.ReplicaSetStore = factory.Apps().V1().ReplicaSets().Informer().GetStore()
	cc.JobStore = factory.Batch().V1().Jobs().Informer().GetStore()
	cc.CronJobStore = factory.Batch().V1().CronJobs().Informer().GetStore()
	cc.ServiceStore = factory.Core().V1().Services().Informer().GetStore()
	cc.IngressStore = factory.Networking().V1().Ingresses().Informer().GetStore()
	cc.EndpointStore = factory.Core().V1().Endpoints().Informer().GetStore()
	cc.PersistentVolumeStore = factory.Core().V1().PersistentVolumes().Informer().GetStore()
	cc.PersistentVolumeClaimStore = factory.Core().V1().PersistentVolumeClaims().Informer().GetStore()
	cc.StorageClassStore = factory.Storage().V1().StorageClasses().Informer().GetStore()
	cc.ConfigMapStore = factory.Core().V1().ConfigMaps().Informer().GetStore()
	cc.SecretStore = factory.Core().V1().Secrets().Informer().GetStore()
	cc.ServiceAccountStore = factory.Core().V1().ServiceAccounts().Informer().GetStore()
	cc.RoleStore = factory.Rbac().V1().Roles().Informer().GetStore()
	cc.RoleBindingStore = factory.Rbac().V1().RoleBindings().Informer().GetStore()
	cc.ClusterRoleStore = factory.Rbac().V1().ClusterRoles().Informer().GetStore()
	cc.ClusterRoleBindingStore = factory.Rbac().V1().ClusterRoleBindings().Informer().GetStore()
	cc.EventStore = factory.Core().V1().Events().Informer().GetStore()

	factory.Start(stopCh)

	synced := []cache.InformerSynced{
		factory.Core().V1().Nodes().Informer().HasSynced,
		factory.Core().V1().Namespaces().Informer().HasSynced,
		factory.Core().V1().Pods().Informer().HasSynced,
		factory.Apps().V1().Deployments().Informer().HasSynced,
		factory.Apps().V1().StatefulSets().Informer().HasSynced,
		factory.Apps().V1().DaemonSets().Informer().HasSynced,
		factory.Core().V1().Services().Informer().HasSynced,
	}

	ctxSync, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if !cache.WaitForCacheSync(ctxSync.Done(), synced...) {
		// 部分 sync 失败不阻塞
	}

	cc.SyncMu.Lock()
	cc.SyncReady = true
	cc.SyncMu.Unlock()

	// 更新元数据
	km.updateClusterMetadata(clusterID, version.GitVersion)
	km.updateHealth(clusterID, "healthy", "")

	return cc, nil
}

// StartCluster 启动指定集群的Client和Informer（冷启动，会替换旧的）
func (km *K8sManager) StartCluster(ctx context.Context, clusterID uint) error {
	km.mu.Lock()
	if existing, ok := km.clients[clusterID]; ok {
		close(existing.StopCh)
		delete(km.clients, clusterID)
	}
	km.mu.Unlock()

	cc, err := km.createClusterClient(ctx, clusterID)
	if err != nil {
		km.updateHealth(clusterID, "error", err.Error())
		return err
	}

	km.mu.Lock()
	km.clients[clusterID] = cc
	km.mu.Unlock()

	return nil
}

// RefreshCluster 热升级刷新：零停机重建 Informer
func (km *K8sManager) RefreshCluster(clusterID uint) error {
	// 1. 在后台创建新的 ClusterClient（旧的继续服务）
	cc, err := km.createClusterClient(context.Background(), clusterID)
	if err != nil {
		km.updateHealth(clusterID, "error", err.Error())
		return err
	}

	// 2. 原子替换
	km.mu.Lock()
	old, existed := km.clients[clusterID]
	km.clients[clusterID] = cc
	km.mu.Unlock()

	// 3. 关闭旧的（延迟 5 秒，避免有正在进行的读操作）
	if existed {
		go func(c *ClusterClient) {
			time.Sleep(5 * time.Second)
			close(c.StopCh)
		}(old)
	}

	return nil
}

// StopCluster 停止指定集群的Informer
func (km *K8sManager) StopCluster(clusterID uint) {
	km.mu.Lock()
	defer km.mu.Unlock()
	if c, ok := km.clients[clusterID]; ok {
		close(c.StopCh)
		delete(km.clients, clusterID)
	}
}

// AddClient 向后兼容：直接启动 Informer
func (km *K8sManager) AddClient(clusterID uint, client *kubernetes.Clientset) {
	// 启动 Informer（如果尚未启动）
	if km.GetClusterClient(clusterID) == nil {
		go km.StartCluster(context.Background(), clusterID)
	}
}

// RemoveClient 移除客户端（向后兼容）
func (km *K8sManager) RemoveClient(clusterID uint) {
	km.StopCluster(clusterID)
}

// updateHealth 更新元数据中的健康状态
func (km *K8sManager) updateHealth(clusterID uint, status string, errMsg string) {
	km.db.Model(&model.ClusterMetadata{}).Where("cluster_id = ?", clusterID).Update("health_status", status)
}

// updateClusterMetadata 更新版本号
func (km *K8sManager) updateClusterMetadata(clusterID uint, version string) {
	metadata := model.ClusterMetadata{
		ClusterID:    clusterID,
		Version:      version,
		HealthStatus: "healthy",
	}
	now := time.Now()
	metadata.LastSyncedAt = &now

	km.db.Model(&model.ClusterMetadata{}).Where("cluster_id = ?", clusterID).Updates(metadata)

	// 统计数量
	if cc := km.GetClusterClient(clusterID); cc != nil && cc.SyncReady {
		nodeCount := len(cc.NodeStore.List())
		nsCount := len(cc.NamespaceStore.List())
		podCount := len(cc.PodStore.List())
		km.db.Model(&model.ClusterMetadata{}).Where("cluster_id = ?", clusterID).Updates(map[string]interface{}{
			"node_count":      nodeCount,
			"namespace_count": nsCount,
			"pod_count":       podCount,
		})
	}
}

// HealthCheck 检查集群Informer是否健康
func (km *K8sManager) HealthCheck(clusterID uint) bool {
	cc := km.GetClusterClient(clusterID)
	if cc == nil {
		return false
	}
	cc.SyncMu.RLock()
	ready := cc.SyncReady
	cc.SyncMu.RUnlock()
	return ready && cc.Health
}

// GetNamespacedResourceList 统一获取命名空间级资源（从 Store 内存读取）
func (cc *ClusterClient) GetNamespacedResourceList(kind string, namespace string, page, limit int) ([]interface{}, int, error) {
	var store cache.Store
	switch kind {
	case "pods":
		store = cc.PodStore
	case "deployments":
		store = cc.DeploymentStore
	case "statefulsets":
		store = cc.StatefulSetStore
	case "daemonsets":
		store = cc.DaemonSetStore
	case "replicasets":
		store = cc.ReplicaSetStore
	case "jobs":
		store = cc.JobStore
	case "cronjobs":
		store = cc.CronJobStore
	case "services":
		store = cc.ServiceStore
	case "ingresses":
		store = cc.IngressStore
	case "endpoints":
		store = cc.EndpointStore
	case "persistentvolumeclaims":
		store = cc.PersistentVolumeClaimStore
	case "configmaps":
		store = cc.ConfigMapStore
	case "secrets":
		store = cc.SecretStore
	case "serviceaccounts":
		store = cc.ServiceAccountStore
	case "roles":
		store = cc.RoleStore
	case "rolebindings":
		store = cc.RoleBindingStore
	case "events":
		store = cc.EventStore
	default:
		return nil, 0, fmt.Errorf("unsupported namespaced resource kind: %s", kind)
	}

	list := store.List()
	var filtered []interface{}
	for _, obj := range list {
		if ns := getNamespace(obj); namespace == "" || namespace == "all" || ns == namespace {
			filtered = append(filtered, obj)
		}
	}
	return paginate(filtered, page, limit)
}

// GetClusterResourceList 统一获取集群级资源（从 Store 内存读取）
func (cc *ClusterClient) GetClusterResourceList(kind string, page, limit int) ([]interface{}, int, error) {
	var store cache.Store
	switch kind {
	case "nodes":
		store = cc.NodeStore
	case "namespaces":
		store = cc.NamespaceStore
	case "persistentvolumes":
		store = cc.PersistentVolumeStore
	case "storageclasses":
		store = cc.StorageClassStore
	case "clusterroles":
		store = cc.ClusterRoleStore
	case "clusterrolebindings":
		store = cc.ClusterRoleBindingStore
	default:
		return nil, 0, fmt.Errorf("unsupported cluster resource kind: %s", kind)
	}

	list := store.List()
	var result []interface{}
	for _, obj := range list {
		result = append(result, obj)
	}
	return paginate(result, page, limit)
}

// getNamespace 通用获取命名空间辅助函数
func getNamespace(obj interface{}) string {
	switch v := obj.(type) {
	case *corev1.Pod:
		return v.Namespace
	case *appsv1.Deployment:
		return v.Namespace
	case *appsv1.StatefulSet:
		return v.Namespace
	case *appsv1.DaemonSet:
		return v.Namespace
	case *appsv1.ReplicaSet:
		return v.Namespace
	case *batchv1.Job:
		return v.Namespace
	case *batchv1.CronJob:
		return v.Namespace
	case *corev1.Service:
		return v.Namespace
	case *networkingv1.Ingress:
		return v.Namespace
	case *corev1.Endpoints:
		return v.Namespace
	case *corev1.PersistentVolumeClaim:
		return v.Namespace
	case *corev1.ConfigMap:
		return v.Namespace
	case *corev1.Secret:
		return v.Namespace
	case *corev1.ServiceAccount:
		return v.Namespace
	case *rbacv1.Role:
		return v.Namespace
	case *rbacv1.RoleBinding:
		return v.Namespace
	case *corev1.Event:
		return v.Namespace
	default:
		return ""
	}
}

// paginate 分页辅助函数
func paginate(items []interface{}, page, limit int) ([]interface{}, int, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 500 {
		limit = 500
	}

	total := len(items)
	start := (page - 1) * limit
	end := start + limit
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}
	return items[start:end], total, nil
}

// GetResourceByName 按名称获取资源
func (cc *ClusterClient) GetResourceByName(kind, namespace, name string) (interface{}, error) {
	var store cache.Store
	var key string

	switch kind {
	case "nodes":
		store = cc.NodeStore
		key = name
	case "namespaces":
		store = cc.NamespaceStore
		key = name
	case "persistentvolumes":
		store = cc.PersistentVolumeStore
		key = name
	case "storageclasses":
		store = cc.StorageClassStore
		key = name
	case "clusterroles":
		store = cc.ClusterRoleStore
		key = name
	case "clusterrolebindings":
		store = cc.ClusterRoleBindingStore
		key = name
	case "pods":
		store = cc.PodStore
		key = namespace + "/" + name
	case "deployments":
		store = cc.DeploymentStore
		key = namespace + "/" + name
	case "statefulsets":
		store = cc.StatefulSetStore
		key = namespace + "/" + name
	case "daemonsets":
		store = cc.DaemonSetStore
		key = namespace + "/" + name
	case "replicasets":
		store = cc.ReplicaSetStore
		key = namespace + "/" + name
	case "jobs":
		store = cc.JobStore
		key = namespace + "/" + name
	case "cronjobs":
		store = cc.CronJobStore
		key = namespace + "/" + name
	case "services":
		store = cc.ServiceStore
		key = namespace + "/" + name
	case "ingresses":
		store = cc.IngressStore
		key = namespace + "/" + name
	case "endpoints":
		store = cc.EndpointStore
		key = namespace + "/" + name
	case "persistentvolumeclaims":
		store = cc.PersistentVolumeClaimStore
		key = namespace + "/" + name
	case "configmaps":
		store = cc.ConfigMapStore
		key = namespace + "/" + name
	case "secrets":
		store = cc.SecretStore
		key = namespace + "/" + name
	case "serviceaccounts":
		store = cc.ServiceAccountStore
		key = namespace + "/" + name
	case "roles":
		store = cc.RoleStore
		key = namespace + "/" + name
	case "rolebindings":
		store = cc.RoleBindingStore
		key = namespace + "/" + name
	case "events":
		store = cc.EventStore
		key = namespace + "/" + name
	default:
		return nil, fmt.Errorf("unsupported kind: %s", kind)
	}

	obj, exists, err := store.GetByKey(key)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("not found")
	}
	return obj, nil
}

// GetNamespaces 获取命名空间列表（用于前端下拉框）
func (cc *ClusterClient) GetNamespaces() []string {
	list := cc.NamespaceStore.List()
	var namespaces []string
	for _, obj := range list {
		if ns, ok := obj.(*corev1.Namespace); ok {
			namespaces = append(namespaces, ns.Name)
		}
	}
	return namespaces
}
