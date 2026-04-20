package service

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	networkingv1 "k8s.io/api/networking/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	discoveryv1 "k8s.io/api/discovery/v1"
	policyv1 "k8s.io/api/policy/v1"
	coordinationv1 "k8s.io/api/coordination/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/cache"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	v1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	apiextensionsinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/ws"
	"gorm.io/gorm"
)

// ClusterClient 单个集群的客户端和缓存
type ClusterClient struct {
	Client         *kubernetes.Clientset
	DynamicClient  dynamic.Interface
	Config         *rest.Config
	Factory        informers.SharedInformerFactory
	StopCh         chan struct{}
	LastUsed       time.Time
	Health         bool
	SyncReady      bool
	SyncMu         sync.RWMutex
	clusterID      uint

	ApiExtClient   apiextensionsclientset.Interface
	ApiExtFactory  apiextensionsinformers.SharedInformerFactory

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
	HorizontalPodAutoscalerStore cache.Store
	NetworkPolicyStore   cache.Store
	PodDisruptionBudgetStore cache.Store
	EndpointSliceStore   cache.Store
	ReplicationControllerStore cache.Store
	LimitRangeStore      cache.Store
	ResourceQuotaStore   cache.Store
	LeaseStore           cache.Store
	CRDStore             cache.Store
}

// K8sManager K8s客户端与Informer管理器
type K8sManager struct {
	clients map[uint]*ClusterClient
	mu      sync.RWMutex
	db      *gorm.DB
}

// NewK8sManager 创建管理器
func NewK8sManager(db *gorm.DB) *K8sManager {
	m := &K8sManager{
		clients: make(map[uint]*ClusterClient),
		db:      db,
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

// SearchResult 全局资源搜索结果
type SearchResult struct {
	ClusterID   uint              `json:"cluster_id"`
	ClusterName string            `json:"cluster_name"`
	Kind        string            `json:"kind"`
	Namespace   string            `json:"namespace"`
	Name        string            `json:"name"`
	Status      string            `json:"status"`
	Labels      map[string]string `json:"labels"`
}

func copyLabels(m map[string]string) map[string]string {
	if m == nil {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func matchLabelSelector(labels map[string]string, selector string) bool {
	if selector == "" {
		return true
	}
	// support key=value or key:value or just key
	if strings.Contains(selector, "=") {
		parts := strings.SplitN(selector, "=", 2)
		if len(parts) == 2 {
			key, val := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
			if v, ok := labels[key]; ok && strings.Contains(strings.ToLower(v), strings.ToLower(val)) {
				return true
			}
		}
		return false
	}
	for k, v := range labels {
		if strings.Contains(strings.ToLower(k), strings.ToLower(selector)) || strings.Contains(strings.ToLower(v), strings.ToLower(selector)) {
			return true
		}
	}
	return false
}

// SearchGlobalResources 跨集群全局搜索资源（按名称模糊匹配，支持过滤）
func (km *K8sManager) SearchGlobalResources(keyword string, limit int, kindFilter string, nsFilter string, clusterFilter uint, labelFilter string) ([]SearchResult, error) {
	if limit <= 0 {
		limit = 20
	}
	kwordLower := strings.ToLower(keyword)

	km.mu.RLock()
	clients := make(map[uint]*ClusterClient)
	for id, cc := range km.clients {
		clients[id] = cc
	}
	km.mu.RUnlock()

	var result []SearchResult

	// 解析 kindFilter（支持逗号分隔的多 kind）
	var kindSet map[string]bool
	if kindFilter != "" {
		kindSet = make(map[string]bool)
		for _, k := range strings.Split(kindFilter, ",") {
			kindSet[strings.TrimSpace(k)] = true
		}
	}

	// helper: append from store
	appendFromStore := func(cc *ClusterClient, kind string, store cache.Store, matchFunc func(obj interface{}) (SearchResult, bool)) {
		if store == nil {
			return
		}
		if kindSet != nil && !kindSet[kind] {
			return
		}
		for _, obj := range store.List() {
			if len(result) >= limit {
				return
			}
			if r, ok := matchFunc(obj); ok {
				if nsFilter != "" && r.Namespace != "-" && r.Namespace != nsFilter {
					continue
				}
				if labelFilter != "" && !matchLabelSelector(r.Labels, labelFilter) {
					continue
				}
				result = append(result, r)
			}
		}
	}

	for id, cc := range clients {
		if clusterFilter != 0 && id != clusterFilter {
			continue
		}
		// fetch cluster name
		var clusterName string
		var cluster model.Cluster
		if err := km.db.First(&cluster, id).Error; err == nil {
			clusterName = cluster.DisplayName
			if clusterName == "" {
				clusterName = cluster.Name
			}
		}

		appendFromStore(cc, "pods", cc.PodStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.Pod)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "pods", Namespace: v.Namespace, Name: v.Name, Status: podStatus(v), Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "deployments", cc.DeploymentStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*appsv1.Deployment)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "deployments", Namespace: v.Namespace, Name: v.Name, Status: fmt.Sprintf("%d/%d", v.Status.ReadyReplicas, *v.Spec.Replicas), Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "statefulsets", cc.StatefulSetStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*appsv1.StatefulSet)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "statefulsets", Namespace: v.Namespace, Name: v.Name, Status: fmt.Sprintf("%d/%d", v.Status.ReadyReplicas, *v.Spec.Replicas), Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "daemonsets", cc.DaemonSetStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*appsv1.DaemonSet)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "daemonsets", Namespace: v.Namespace, Name: v.Name, Status: fmt.Sprintf("%d/%d", v.Status.NumberReady, v.Status.DesiredNumberScheduled), Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "services", cc.ServiceStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.Service)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "services", Namespace: v.Namespace, Name: v.Name, Status: string(v.Spec.Type), Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "ingresses", cc.IngressStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*networkingv1.Ingress)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "ingresses", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "configmaps", cc.ConfigMapStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.ConfigMap)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "configmaps", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "secrets", cc.SecretStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.Secret)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "secrets", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "nodes", cc.NodeStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.Node)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				status := "Unknown"
				for _, c := range v.Status.Conditions {
					if c.Type == corev1.NodeReady {
						if c.Status == corev1.ConditionTrue {
							status = "Ready"
						} else {
							status = "NotReady"
						}
						break
					}
				}
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "nodes", Namespace: "-", Name: v.Name, Status: status, Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "namespaces", cc.NamespaceStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.Namespace)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "namespaces", Namespace: "-", Name: v.Name, Status: string(v.Status.Phase), Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "events", cc.EventStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.Event)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) || strings.Contains(strings.ToLower(v.Reason), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "events", Namespace: v.Namespace, Name: v.Name, Status: v.Reason, Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "horizontalpodautoscalers", cc.HorizontalPodAutoscalerStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*autoscalingv2.HorizontalPodAutoscaler)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "horizontalpodautoscalers", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "networkpolicies", cc.NetworkPolicyStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*networkingv1.NetworkPolicy)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "networkpolicies", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "poddisruptionbudgets", cc.PodDisruptionBudgetStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*policyv1.PodDisruptionBudget)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "poddisruptionbudgets", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "endpointslices", cc.EndpointSliceStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*discoveryv1.EndpointSlice)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "endpointslices", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "replicationcontrollers", cc.ReplicationControllerStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.ReplicationController)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "replicationcontrollers", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "limitranges", cc.LimitRangeStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.LimitRange)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "limitranges", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "resourcequotas", cc.ResourceQuotaStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*corev1.ResourceQuota)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "resourcequotas", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "leases", cc.LeaseStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*coordinationv1.Lease)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "leases", Namespace: v.Namespace, Name: v.Name, Status: "", Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
		appendFromStore(cc, "customresourcedefinitions", cc.CRDStore, func(obj interface{}) (SearchResult, bool) {
			v := obj.(*v1.CustomResourceDefinition)
			if strings.Contains(strings.ToLower(v.Name), kwordLower) {
				return SearchResult{ClusterID: id, ClusterName: clusterName, Kind: "customresourcedefinitions", Namespace: "-", Name: v.Name, Status: string(v.Spec.Scope), Labels: copyLabels(v.Labels)}, true
			}
			return SearchResult{}, false
		})
		if len(result) >= limit {
			break
		}
	}

	return result, nil
}

// BuildConfig 暴露 buildConfig 给外部服务（如 Terminal）
func (km *K8sManager) BuildConfig(clusterID uint) (*rest.Config, error) {
	return km.buildConfig(clusterID)
}

// GetClusterKubeconfigContent 返回可用于 kubectl 的 kubeconfig YAML 内容
func (km *K8sManager) GetClusterKubeconfigContent(clusterID uint) ([]byte, error) {
	var secret model.ClusterSecret
	if err := km.db.Where("cluster_id = ?", clusterID).First(&secret).Error; err != nil {
		return nil, fmt.Errorf("cluster secret not found")
	}

	if secret.SecretType == "kubeconfig" {
		return []byte(secret.EncryptedData), nil
	}

	if secret.SecretType == "token" {
		var cluster model.Cluster
		if err := km.db.First(&cluster, clusterID).Error; err != nil {
			return nil, fmt.Errorf("cluster not found")
		}
		kubeconfig := fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: %s
  name: cluster
current-context: ctx
contexts:
- context:
    cluster: cluster
    user: user
  name: ctx
users:
- name: user
  user:
    token: %s
`, cluster.Server, secret.EncryptedData)
		return []byte(kubeconfig), nil
	}

	return nil, fmt.Errorf("unsupported secret type: %s", secret.SecretType)
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

	var config *rest.Config
	var err error
	if secret.SecretType == "kubeconfig" {
		config, err = clientcmd.RESTConfigFromKubeConfig([]byte(secret.EncryptedData))
		if err != nil {
			return nil, fmt.Errorf("parse kubeconfig failed: %w", err)
		}
	} else if secret.SecretType == "token" {
		var cluster model.Cluster
		km.db.First(&cluster, clusterID)
		config = &rest.Config{
			Host:        cluster.Server,
			BearerToken: secret.EncryptedData,
			TLSClientConfig: rest.TLSClientConfig{
				Insecure: true,
			},
		}
	}
	return config, nil
}

// addResourceEventHandler 为 informer 添加事件处理器，在资源变化时广播 WebSocket
func addResourceEventHandler(informer cache.SharedIndexInformer, clusterID uint, kind string, cc *ClusterClient) {
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if !cc.SyncReady {
				return
			}
			metaObj, ok := obj.(metav1.Object)
			if !ok {
				return
			}
			log.Printf("[informer] %s/%s added in cluster %d", kind, metaObj.GetName(), clusterID)
			invalidateListCache(context.Background(), clusterID, kind)
			ws.Broadcast(ws.ResourceChangeMessage{
				Type:      "resource_change",
				ClusterID: clusterID,
				Kind:      kind,
				Namespace: metaObj.GetNamespace(),
				Name:      metaObj.GetName(),
				Action:    "create",
			})
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if !cc.SyncReady {
				return
			}
			metaObj, ok := newObj.(metav1.Object)
			if !ok {
				return
			}
			log.Printf("[informer] %s/%s updated in cluster %d", kind, metaObj.GetName(), clusterID)
			invalidateListCache(context.Background(), clusterID, kind)
			ws.Broadcast(ws.ResourceChangeMessage{
				Type:      "resource_change",
				ClusterID: clusterID,
				Kind:      kind,
				Namespace: metaObj.GetNamespace(),
				Name:      metaObj.GetName(),
				Action:    "update",
			})
		},
		DeleteFunc: func(obj interface{}) {
			if !cc.SyncReady {
				return
			}
			metaObj, ok := obj.(metav1.Object)
			if !ok {
				return
			}
			log.Printf("[informer] %s/%s deleted in cluster %d", kind, metaObj.GetName(), clusterID)
			invalidateListCache(context.Background(), clusterID, kind)
			ws.Broadcast(ws.ResourceChangeMessage{
				Type:      "resource_change",
				ClusterID: clusterID,
				Kind:      kind,
				Namespace: metaObj.GetNamespace(),
				Name:      metaObj.GetName(),
				Action:    "delete",
			})
		},
	})
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

	apiextClient, err := apiextensionsclientset.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	version, err := client.Discovery().ServerVersion()
	if err != nil {
		return nil, err
	}

	stopCh := make(chan struct{})
	factory := informers.NewSharedInformerFactory(client, 60*time.Second)
	apiextFactory := apiextensionsinformers.NewSharedInformerFactory(apiextClient, 60*time.Second)

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	cc := &ClusterClient{
		Client:         client,
		DynamicClient:  dynamicClient,
		Config:         config,
		Factory:        factory,
		ApiExtClient:   apiextClient,
		ApiExtFactory:  apiextFactory,
		StopCh:         stopCh,
		LastUsed:       time.Now(),
		Health:         true,
		clusterID:      clusterID,
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
	cc.HorizontalPodAutoscalerStore = factory.Autoscaling().V2().HorizontalPodAutoscalers().Informer().GetStore()
	cc.NetworkPolicyStore = factory.Networking().V1().NetworkPolicies().Informer().GetStore()
	cc.PodDisruptionBudgetStore = factory.Policy().V1().PodDisruptionBudgets().Informer().GetStore()
	cc.EndpointSliceStore = factory.Discovery().V1().EndpointSlices().Informer().GetStore()
	cc.ReplicationControllerStore = factory.Core().V1().ReplicationControllers().Informer().GetStore()
	cc.LimitRangeStore = factory.Core().V1().LimitRanges().Informer().GetStore()
	cc.ResourceQuotaStore = factory.Core().V1().ResourceQuotas().Informer().GetStore()
	cc.LeaseStore = factory.Coordination().V1().Leases().Informer().GetStore()
	cc.CRDStore = apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Informer().GetStore()

	// 为所有 informer 注册事件处理器，资源变化时广播 WebSocket
	addResourceEventHandler(factory.Core().V1().Nodes().Informer(), clusterID, "nodes", cc)
	addResourceEventHandler(factory.Core().V1().Namespaces().Informer(), clusterID, "namespaces", cc)
	addResourceEventHandler(factory.Core().V1().Pods().Informer(), clusterID, "pods", cc)
	addResourceEventHandler(factory.Apps().V1().Deployments().Informer(), clusterID, "deployments", cc)
	addResourceEventHandler(factory.Apps().V1().StatefulSets().Informer(), clusterID, "statefulsets", cc)
	addResourceEventHandler(factory.Apps().V1().DaemonSets().Informer(), clusterID, "daemonsets", cc)
	addResourceEventHandler(factory.Apps().V1().ReplicaSets().Informer(), clusterID, "replicasets", cc)
	addResourceEventHandler(factory.Batch().V1().Jobs().Informer(), clusterID, "jobs", cc)
	addResourceEventHandler(factory.Batch().V1().CronJobs().Informer(), clusterID, "cronjobs", cc)
	addResourceEventHandler(factory.Core().V1().Services().Informer(), clusterID, "services", cc)
	addResourceEventHandler(factory.Networking().V1().Ingresses().Informer(), clusterID, "ingresses", cc)
	addResourceEventHandler(factory.Core().V1().Endpoints().Informer(), clusterID, "endpoints", cc)
	addResourceEventHandler(factory.Core().V1().PersistentVolumes().Informer(), clusterID, "persistentvolumes", cc)
	addResourceEventHandler(factory.Core().V1().PersistentVolumeClaims().Informer(), clusterID, "persistentvolumeclaims", cc)
	addResourceEventHandler(factory.Storage().V1().StorageClasses().Informer(), clusterID, "storageclasses", cc)
	addResourceEventHandler(factory.Core().V1().ConfigMaps().Informer(), clusterID, "configmaps", cc)
	addResourceEventHandler(factory.Core().V1().Secrets().Informer(), clusterID, "secrets", cc)
	addResourceEventHandler(factory.Core().V1().ServiceAccounts().Informer(), clusterID, "serviceaccounts", cc)
	addResourceEventHandler(factory.Rbac().V1().Roles().Informer(), clusterID, "roles", cc)
	addResourceEventHandler(factory.Rbac().V1().RoleBindings().Informer(), clusterID, "rolebindings", cc)
	addResourceEventHandler(factory.Rbac().V1().ClusterRoles().Informer(), clusterID, "clusterroles", cc)
	addResourceEventHandler(factory.Rbac().V1().ClusterRoleBindings().Informer(), clusterID, "clusterrolebindings", cc)
	addResourceEventHandler(factory.Core().V1().Events().Informer(), clusterID, "events", cc)
	addResourceEventHandler(factory.Autoscaling().V2().HorizontalPodAutoscalers().Informer(), clusterID, "horizontalpodautoscalers", cc)
	addResourceEventHandler(factory.Networking().V1().NetworkPolicies().Informer(), clusterID, "networkpolicies", cc)
	addResourceEventHandler(factory.Policy().V1().PodDisruptionBudgets().Informer(), clusterID, "poddisruptionbudgets", cc)
	addResourceEventHandler(factory.Discovery().V1().EndpointSlices().Informer(), clusterID, "endpointslices", cc)
	addResourceEventHandler(factory.Core().V1().ReplicationControllers().Informer(), clusterID, "replicationcontrollers", cc)
	addResourceEventHandler(factory.Core().V1().LimitRanges().Informer(), clusterID, "limitranges", cc)
	addResourceEventHandler(factory.Core().V1().ResourceQuotas().Informer(), clusterID, "resourcequotas", cc)
	addResourceEventHandler(factory.Coordination().V1().Leases().Informer(), clusterID, "leases", cc)
	addResourceEventHandler(apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Informer(), clusterID, "customresourcedefinitions", cc)

	factory.Start(stopCh)
	apiextFactory.Start(stopCh)

	synced := []cache.InformerSynced{
		factory.Core().V1().Nodes().Informer().HasSynced,
		factory.Core().V1().Namespaces().Informer().HasSynced,
		factory.Core().V1().Pods().Informer().HasSynced,
		factory.Apps().V1().Deployments().Informer().HasSynced,
		factory.Apps().V1().StatefulSets().Informer().HasSynced,
		factory.Apps().V1().DaemonSets().Informer().HasSynced,
		factory.Apps().V1().ReplicaSets().Informer().HasSynced,
		factory.Batch().V1().Jobs().Informer().HasSynced,
		factory.Batch().V1().CronJobs().Informer().HasSynced,
		factory.Core().V1().Services().Informer().HasSynced,
		factory.Networking().V1().Ingresses().Informer().HasSynced,
		factory.Core().V1().Endpoints().Informer().HasSynced,
		factory.Core().V1().PersistentVolumes().Informer().HasSynced,
		factory.Core().V1().PersistentVolumeClaims().Informer().HasSynced,
		factory.Storage().V1().StorageClasses().Informer().HasSynced,
		factory.Core().V1().ConfigMaps().Informer().HasSynced,
		factory.Core().V1().Secrets().Informer().HasSynced,
		factory.Core().V1().ServiceAccounts().Informer().HasSynced,
		factory.Rbac().V1().Roles().Informer().HasSynced,
		factory.Rbac().V1().RoleBindings().Informer().HasSynced,
		factory.Rbac().V1().ClusterRoles().Informer().HasSynced,
		factory.Rbac().V1().ClusterRoleBindings().Informer().HasSynced,
		factory.Core().V1().Events().Informer().HasSynced,
		factory.Autoscaling().V2().HorizontalPodAutoscalers().Informer().HasSynced,
		factory.Networking().V1().NetworkPolicies().Informer().HasSynced,
		factory.Policy().V1().PodDisruptionBudgets().Informer().HasSynced,
		factory.Discovery().V1().EndpointSlices().Informer().HasSynced,
		factory.Core().V1().ReplicationControllers().Informer().HasSynced,
		factory.Core().V1().LimitRanges().Informer().HasSynced,
		factory.Core().V1().ResourceQuotas().Informer().HasSynced,
		factory.Coordination().V1().Leases().Informer().HasSynced,
		apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Informer().HasSynced,
	}

	ctxSync, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	if !cache.WaitForCacheSync(ctxSync.Done(), synced...) {
		// 部分 sync 超时，但 reflector 会继续后台重试，先标记 ready 避免阻塞
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
func (cc *ClusterClient) GetNamespacedResourceList(kind string, namespace string, keyword string, page, limit int) ([]interface{}, int, error) {
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
	case "horizontalpodautoscalers":
		store = cc.HorizontalPodAutoscalerStore
	case "networkpolicies":
		store = cc.NetworkPolicyStore
	case "poddisruptionbudgets":
		store = cc.PodDisruptionBudgetStore
	case "endpointslices":
		store = cc.EndpointSliceStore
	case "replicationcontrollers":
		store = cc.ReplicationControllerStore
	case "limitranges":
		store = cc.LimitRangeStore
	case "resourcequotas":
		store = cc.ResourceQuotaStore
	case "leases":
		store = cc.LeaseStore
	default:
		return nil, 0, fmt.Errorf("unsupported namespaced resource kind: %s", kind)
	}

	list := store.List()
	var filtered []interface{}
	keywordLower := strings.ToLower(keyword)
	for _, obj := range list {
		if ns := getNamespace(obj); namespace == "" || namespace == "all" || ns == namespace {
			if keyword == "" || strings.Contains(strings.ToLower(getName(obj)), keywordLower) {
				filtered = append(filtered, obj)
			}
		}
	}
	return paginate(filtered, page, limit)
}

// GetClusterResourceList 统一获取集群级资源（从 Store 内存读取）
func (cc *ClusterClient) GetClusterResourceList(kind string, keyword string, page, limit int) ([]interface{}, int, error) {
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
	case "customresourcedefinitions":
		store = cc.CRDStore
	default:
		return nil, 0, fmt.Errorf("unsupported cluster resource kind: %s", kind)
	}

	list := store.List()
	var result []interface{}
	keywordLower := strings.ToLower(keyword)
	for _, obj := range list {
		if keyword == "" || strings.Contains(strings.ToLower(getName(obj)), keywordLower) {
			result = append(result, obj)
		}
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
	case *v1.CustomResourceDefinition:
		return ""
	case *autoscalingv2.HorizontalPodAutoscaler:
		return v.Namespace
	case *networkingv1.NetworkPolicy:
		return v.Namespace
	case *policyv1.PodDisruptionBudget:
		return v.Namespace
	case *discoveryv1.EndpointSlice:
		return v.Namespace
	case *corev1.ReplicationController:
		return v.Namespace
	case *corev1.LimitRange:
		return v.Namespace
	case *corev1.ResourceQuota:
		return v.Namespace
	case *coordinationv1.Lease:
		return v.Namespace
	default:
		return ""
	}
}

// getName 通用获取资源名称辅助函数
func getName(obj interface{}) string {
	switch v := obj.(type) {
	case *corev1.Node:
		return v.Name
	case *corev1.Namespace:
		return v.Name
	case *corev1.Pod:
		return v.Name
	case *appsv1.Deployment:
		return v.Name
	case *appsv1.StatefulSet:
		return v.Name
	case *appsv1.DaemonSet:
		return v.Name
	case *appsv1.ReplicaSet:
		return v.Name
	case *batchv1.Job:
		return v.Name
	case *batchv1.CronJob:
		return v.Name
	case *corev1.Service:
		return v.Name
	case *networkingv1.Ingress:
		return v.Name
	case *corev1.Endpoints:
		return v.Name
	case *corev1.PersistentVolume:
		return v.Name
	case *corev1.PersistentVolumeClaim:
		return v.Name
	case *storagev1.StorageClass:
		return v.Name
	case *corev1.ConfigMap:
		return v.Name
	case *corev1.Secret:
		return v.Name
	case *corev1.ServiceAccount:
		return v.Name
	case *rbacv1.Role:
		return v.Name
	case *rbacv1.RoleBinding:
		return v.Name
	case *rbacv1.ClusterRole:
		return v.Name
	case *rbacv1.ClusterRoleBinding:
		return v.Name
	case *corev1.Event:
		return v.Name
	case *v1.CustomResourceDefinition:
		return v.Name
	case *autoscalingv2.HorizontalPodAutoscaler:
		return v.Name
	case *networkingv1.NetworkPolicy:
		return v.Name
	case *policyv1.PodDisruptionBudget:
		return v.Name
	case *discoveryv1.EndpointSlice:
		return v.Name
	case *corev1.ReplicationController:
		return v.Name
	case *corev1.LimitRange:
		return v.Name
	case *corev1.ResourceQuota:
		return v.Name
	case *coordinationv1.Lease:
		return v.Name
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
	case "customresourcedefinitions":
		store = cc.CRDStore
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
	case "horizontalpodautoscalers":
		store = cc.HorizontalPodAutoscalerStore
		key = namespace + "/" + name
	case "networkpolicies":
		store = cc.NetworkPolicyStore
		key = namespace + "/" + name
	case "poddisruptionbudgets":
		store = cc.PodDisruptionBudgetStore
		key = namespace + "/" + name
	case "endpointslices":
		store = cc.EndpointSliceStore
		key = namespace + "/" + name
	case "replicationcontrollers":
		store = cc.ReplicationControllerStore
		key = namespace + "/" + name
	case "limitranges":
		store = cc.LimitRangeStore
		key = namespace + "/" + name
	case "resourcequotas":
		store = cc.ResourceQuotaStore
		key = namespace + "/" + name
	case "leases":
		store = cc.LeaseStore
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
