package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"strings"

	"sigs.k8s.io/yaml"

	"k8s.io/client-go/kubernetes/scheme"

	corev1 "k8s.io/api/core/v1"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	networkingv1 "k8s.io/api/networking/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	policyv1 "k8s.io/api/policy/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	coordinationv1 "k8s.io/api/coordination/v1"
	v1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/dynamic"
	authorizationv1 "k8s.io/api/authorization/v1"

	"github.com/cloudops/platform/internal/pkg/redis"
	"github.com/cloudops/platform/internal/pkg/ws"
)

// K8sResourceService K8s资源服务
type K8sResourceService struct {
	k8sManager *K8sManager
}

// NewK8sResourceService 创建资源服务
func NewK8sResourceService(k8sManager *K8sManager) *K8sResourceService {
	return &K8sResourceService{
		k8sManager: k8sManager,
	}
}

// SearchResources 全局资源搜索
func (s *K8sResourceService) SearchResources(ctx context.Context, keyword string, limit int, kindFilter string, nsFilter string, clusterFilter uint, labelFilter string) ([]SearchResult, error) {
	return s.k8sManager.SearchGlobalResources(keyword, limit, kindFilter, nsFilter, clusterFilter, labelFilter)
}

// ListResources 列出资源
func (s *K8sResourceService) ListResources(ctx context.Context, clusterID uint, kind, namespace, keyword string, page, limit int) ([]map[string]interface{}, int, error) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		// 异步启动，不阻塞 HTTP 请求
		go s.k8sManager.StartCluster(context.Background(), clusterID)
		return nil, 0, fmt.Errorf("集群缓存正在重建，请 5-10 秒后重试")
	}

	cc.SyncMu.RLock()
	ready := cc.SyncReady
	cc.SyncMu.RUnlock()
	if !ready {
		return nil, 0, fmt.Errorf("集群缓存正在同步，请稍后重试")
	}

	// Redis 缓存：多用户共享，减少 informer 内存扫描压力
	cacheKey := fmt.Sprintf("k8s:list:%d:%s:%s:%s:%d:%d", clusterID, kind, namespace, keyword, page, limit)
	if redis.Client != nil {
		cached, err := redis.Client.Get(ctx, cacheKey).Result()
		if err == nil && cached != "" {
			var cachedResult struct {
				Items []map[string]interface{} `json:"items"`
				Total int                      `json:"total"`
			}
			if jsonErr := json.Unmarshal([]byte(cached), &cachedResult); jsonErr == nil {
				return cachedResult.Items, cachedResult.Total, nil
			}
		}
	}

	var items []interface{}
	var total int
	var err error

	clusterKinds := map[string]bool{
		"nodes": true, "namespaces": true, "persistentvolumes": true,
		"storageclasses": true, "clusterroles": true, "clusterrolebindings": true,
		"customresourcedefinitions": true,
	}

	if clusterKinds[kind] {
		items, total, err = cc.GetClusterResourceList(kind, keyword, page, limit)
	} else {
		items, total, err = cc.GetNamespacedResourceList(kind, namespace, keyword, page, limit)
	}
	if err != nil {
		return nil, 0, err
	}

	result := make([]map[string]interface{}, 0, len(items))
	for _, obj := range items {
		result = append(result, convertToSummary(obj))
	}

	// 写入 Redis 缓存（TTL 5 秒）
	if redis.Client != nil {
		cacheData, _ := json.Marshal(struct {
			Items []map[string]interface{} `json:"items"`
			Total int                      `json:"total"`
		}{Items: result, Total: total})
		_ = redis.Client.Set(ctx, cacheKey, string(cacheData), 5*time.Second)
	}

	return result, total, nil
}

// kindToGVK 为 scheme 无法识别的类型提供手动 GVK 映射
func kindToGVK(kind string) schema.GroupVersionKind {
	switch kind {
	case "pods", "services", "endpoints", "persistentvolumeclaims", "configmaps", "secrets", "serviceaccounts", "nodes", "namespaces", "persistentvolumes", "events", "replicationcontrollers", "limitranges", "resourcequotas":
		return schema.GroupVersionKind{Version: "v1", Kind: kindToTitle(kind)}
	case "deployments", "daemonsets", "replicasets", "statefulsets":
		return schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: kindToTitle(kind)}
	case "jobs", "cronjobs":
		return schema.GroupVersionKind{Group: "batch", Version: "v1", Kind: kindToTitle(kind)}
	case "ingresses":
		return schema.GroupVersionKind{Group: "networking.k8s.io", Version: "v1", Kind: "Ingress"}
	case "storageclasses":
		return schema.GroupVersionKind{Group: "storage.k8s.io", Version: "v1", Kind: "StorageClass"}
	case "roles", "rolebindings", "clusterroles", "clusterrolebindings":
		return schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: kindToTitle(kind)}
	case "customresourcedefinitions":
		return schema.GroupVersionKind{Group: "apiextensions.k8s.io", Version: "v1", Kind: "CustomResourceDefinition"}
	case "horizontalpodautoscalers":
		return schema.GroupVersionKind{Group: "autoscaling", Version: "v2", Kind: "HorizontalPodAutoscaler"}
	case "networkpolicies":
		return schema.GroupVersionKind{Group: "networking.k8s.io", Version: "v1", Kind: "NetworkPolicy"}
	case "poddisruptionbudgets":
		return schema.GroupVersionKind{Group: "policy", Version: "v1", Kind: "PodDisruptionBudget"}
	case "endpointslices":
		return schema.GroupVersionKind{Group: "discovery.k8s.io", Version: "v1", Kind: "EndpointSlice"}
	case "leases":
		return schema.GroupVersionKind{Group: "coordination.k8s.io", Version: "v1", Kind: "Lease"}
	case "servicemonitors":
		return schema.GroupVersionKind{Group: "monitoring.coreos.com", Version: "v1", Kind: "ServiceMonitor"}
	default:
		return schema.GroupVersionKind{}
	}
}

func kindToTitle(kind string) string {
	if kind == "" {
		return ""
	}
	// 简单规则：去掉末尾的 s，首字母大写
	s := kind
	if strings.HasSuffix(s, "ies") {
		s = strings.TrimSuffix(s, "ies") + "y"
	} else if strings.HasSuffix(s, "ses") {
		s = strings.TrimSuffix(s, "es")
	} else if strings.HasSuffix(s, "s") {
		s = strings.TrimSuffix(s, "s")
	}
	return strings.Title(s)
}

// GetResourceYAML 获取资源YAML
func (s *K8sResourceService) GetResourceYAML(ctx context.Context, clusterID uint, kind, namespace, name string) (string, error) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		go s.k8sManager.StartCluster(context.Background(), clusterID)
		return "", fmt.Errorf("集群缓存正在重建，请 5-10 秒后重试")
	}

	cc.SyncMu.RLock()
	ready := cc.SyncReady
	cc.SyncMu.RUnlock()
	if !ready {
		return "", fmt.Errorf("集群缓存正在同步，请稍后重试")
	}

	obj, err := cc.GetResourceByName(kind, namespace, name)
	if err != nil {
		return "", fmt.Errorf("资源未找到")
	}

	var gvk schema.GroupVersionKind
	if runtimeObj, ok := obj.(runtime.Object); ok {
		// 优先从 scheme 获取 GVK
		gvks, _, err := scheme.Scheme.ObjectKinds(runtimeObj)
		if err == nil && len(gvks) > 0 {
			gvk = gvks[0]
		}
	}
	if gvk.Empty() {
		gvk = kindToGVK(kind)
	}

	// 转换为 unstructured map，确保 YAML 与 kubectl 输出一致（map 顺序、字段完整）
	unstructuredMap, err := runtime.DefaultUnstructuredConverter.ToUnstructured(obj)
	if err != nil {
		return "", fmt.Errorf("convert to unstructured failed: %w", err)
	}
	if unstructuredMap == nil {
		unstructuredMap = map[string]interface{}{}
	}
	if !gvk.Empty() {
		unstructuredMap["apiVersion"] = gvk.GroupVersion().String()
		unstructuredMap["kind"] = gvk.Kind
	}

	// 清理对人类阅读无用的内部字段
	delete(unstructuredMap, "status")
	if metadata, ok := unstructuredMap["metadata"].(map[string]interface{}); ok {
		delete(metadata, "managedFields")
	}

	out, err := yaml.Marshal(unstructuredMap)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// GetResource 获取资源详情
func (s *K8sResourceService) GetResource(ctx context.Context, clusterID uint, kind, namespace, name string) (map[string]interface{}, error) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		go s.k8sManager.StartCluster(context.Background(), clusterID)
		return nil, fmt.Errorf("集群缓存正在重建，请 5-10 秒后重试")
	}

	cc.SyncMu.RLock()
	ready := cc.SyncReady
	cc.SyncMu.RUnlock()
	if !ready {
		return nil, fmt.Errorf("集群缓存正在同步，请稍后重试")
	}

	obj, err := cc.GetResourceByName(kind, namespace, name)
	if err != nil {
		return nil, fmt.Errorf("资源未找到")
	}
	return convertToDetail(obj), nil
}

// GetCRDCustomResources 获取指定 CRD 下的 Custom Resource 实例列表
func (s *K8sResourceService) GetCRDCustomResources(ctx context.Context, clusterID uint, crdName string, namespace string) ([]map[string]interface{}, error) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		go s.k8sManager.StartCluster(context.Background(), clusterID)
		return nil, fmt.Errorf("集群缓存正在重建，请 5-10 秒后重试")
	}

	cc.SyncMu.RLock()
	ready := cc.SyncReady
	cc.SyncMu.RUnlock()
	if !ready {
		return nil, fmt.Errorf("集群缓存正在同步，请稍后重试")
	}

	// 从 CRDStore 获取 CRD 定义
	obj, exists, err := cc.CRDStore.GetByKey(crdName)
	if err != nil {
		return nil, fmt.Errorf("查询 CRD 失败: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("CRD 未找到")
	}

	crd, ok := obj.(*v1.CustomResourceDefinition)
	if !ok {
		return nil, fmt.Errorf("CRD 类型错误")
	}

	// 解析 GVR
	group := crd.Spec.Group
	resource := crd.Spec.Names.Plural
	var version string
	for _, v := range crd.Spec.Versions {
		if v.Served {
			version = v.Name
			break
		}
	}
	if version == "" {
		return nil, fmt.Errorf("CRD 没有可用的 served version")
	}

	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: resource}

	// 获取 dynamic client
	client, err := s.getDynamicClient(clusterID)
	if err != nil {
		return nil, err
	}

	// 根据 scope 查询
	var list *unstructured.UnstructuredList
	if crd.Spec.Scope == v1.NamespaceScoped {
		if namespace != "" && namespace != "all" {
			list, err = client.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{})
		} else {
			list, err = client.Resource(gvr).List(ctx, metav1.ListOptions{})
		}
	} else {
		list, err = client.Resource(gvr).List(ctx, metav1.ListOptions{})
	}
	if err != nil {
		return nil, fmt.Errorf("查询 CR 列表失败: %w", err)
	}

	items := make([]map[string]interface{}, 0, len(list.Items))
	for _, item := range list.Items {
		items = append(items, map[string]interface{}{
			"name":              item.GetName(),
			"namespace":         item.GetNamespace(),
			"creationTimestamp": item.GetCreationTimestamp().Format(time.RFC3339),
		})
	}
	return items, nil
}

// GetNamespaces 获取命名空间列表
func (s *K8sResourceService) GetNamespaces(ctx context.Context, clusterID uint) ([]string, error) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		go s.k8sManager.StartCluster(context.Background(), clusterID)
		return nil, fmt.Errorf("集群缓存正在重建，请 5-10 秒后重试")
	}

	cc.SyncMu.RLock()
	ready := cc.SyncReady
	cc.SyncMu.RUnlock()
	if !ready {
		return nil, fmt.Errorf("集群缓存正在同步，请稍后重试")
	}
	return cc.GetNamespaces(), nil
}

// RefreshCluster 热升级刷新集群连接（零停机，后台异步执行）
func (s *K8sResourceService) RefreshCluster(ctx context.Context, clusterID uint) error {
	go s.k8sManager.RefreshCluster(clusterID)
	return nil
}

// countStoreByNamespaces 按授权命名空间统计 store 中的对象数量
func countStoreByNamespaces(store cache.Store, allowedNS map[string]bool) int {
	count := 0
	for _, obj := range store.List() {
		if accessor, ok := obj.(metav1.Object); ok {
			if allowedNS[accessor.GetNamespace()] {
				count++
			}
		}
	}
	return count
}

// GetClusterStats 获取集群统计（支持 namespace 级权限过滤）
func (s *K8sResourceService) GetClusterStats(ctx context.Context, clusterID uint, allowedNamespaces []string) (map[string]interface{}, error) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		go s.k8sManager.StartCluster(context.Background(), clusterID)
		return nil, fmt.Errorf("集群缓存正在重建，请 5-10 秒后重试")
	}

	cc.SyncMu.RLock()
	ready := cc.SyncReady
	cc.SyncMu.RUnlock()
	if !ready {
		return nil, fmt.Errorf("集群缓存正在同步，请稍后重试")
	}

	// 平台/集群级用户：返回全部统计
	if len(allowedNamespaces) == 0 || allowedNamespaces[0] == "*" {
		return map[string]interface{}{
			"nodes":                     len(cc.NodeStore.List()),
			"namespaces":                len(cc.NamespaceStore.List()),
			"pods":                      len(cc.PodStore.List()),
			"deployments":               len(cc.DeploymentStore.List()),
			"statefulsets":              len(cc.StatefulSetStore.List()),
			"daemonsets":                len(cc.DaemonSetStore.List()),
			"services":                  len(cc.ServiceStore.List()),
			"ingresses":                 len(cc.IngressStore.List()),
			"jobs":                      len(cc.JobStore.List()),
			"cronjobs":                  len(cc.CronJobStore.List()),
			"persistentvolumes":         len(cc.PersistentVolumeStore.List()),
			"configmaps":                len(cc.ConfigMapStore.List()),
			"secrets":                   len(cc.SecretStore.List()),
			"events":                    len(cc.EventStore.List()),
			"customresourcedefinitions": len(cc.CRDStore.List()),
			"horizontalpodautoscalers":  len(cc.HorizontalPodAutoscalerStore.List()),
			"networkpolicies":           len(cc.NetworkPolicyStore.List()),
			"poddisruptionbudgets":      len(cc.PodDisruptionBudgetStore.List()),
			"endpointslices":            len(cc.EndpointSliceStore.List()),
			"replicationcontrollers":    len(cc.ReplicationControllerStore.List()),
			"limitranges":               len(cc.LimitRangeStore.List()),
			"resourcequotas":            len(cc.ResourceQuotaStore.List()),
			"leases":                    len(cc.LeaseStore.List()),
		"servicemonitors":           len(cc.ServiceMonitorStore.List()),
		}, nil
	}

	// namespace 级用户：只统计授权命名空间中的资源
	allowedSet := make(map[string]bool)
	for _, ns := range allowedNamespaces {
		allowedSet[ns] = true
	}

	return map[string]interface{}{
		"namespaces":       len(allowedNamespaces),
		"pods":             countStoreByNamespaces(cc.PodStore, allowedSet),
		"deployments":      countStoreByNamespaces(cc.DeploymentStore, allowedSet),
		"statefulsets":     countStoreByNamespaces(cc.StatefulSetStore, allowedSet),
		"daemonsets":       countStoreByNamespaces(cc.DaemonSetStore, allowedSet),
		"services":         countStoreByNamespaces(cc.ServiceStore, allowedSet),
		"ingresses":        countStoreByNamespaces(cc.IngressStore, allowedSet),
		"jobs":             countStoreByNamespaces(cc.JobStore, allowedSet),
		"cronjobs":         countStoreByNamespaces(cc.CronJobStore, allowedSet),
		"configmaps":       countStoreByNamespaces(cc.ConfigMapStore, allowedSet),
		"secrets":          countStoreByNamespaces(cc.SecretStore, allowedSet),
		"events":           countStoreByNamespaces(cc.EventStore, allowedSet),
		"horizontalpodautoscalers": countStoreByNamespaces(cc.HorizontalPodAutoscalerStore, allowedSet),
		"networkpolicies":  countStoreByNamespaces(cc.NetworkPolicyStore, allowedSet),
		"poddisruptionbudgets": countStoreByNamespaces(cc.PodDisruptionBudgetStore, allowedSet),
		"endpointslices":   countStoreByNamespaces(cc.EndpointSliceStore, allowedSet),
		"replicationcontrollers": countStoreByNamespaces(cc.ReplicationControllerStore, allowedSet),
		"limitranges":      countStoreByNamespaces(cc.LimitRangeStore, allowedSet),
		"resourcequotas":   countStoreByNamespaces(cc.ResourceQuotaStore, allowedSet),
		"leases":           countStoreByNamespaces(cc.LeaseStore, allowedSet),
		"servicemonitors":  countStoreByNamespaces(cc.ServiceMonitorStore, allowedSet),
	}, nil
}

// fallbackListResources 缓存未就绪时直接调用 API
func (s *K8sResourceService) fallbackListResources(ctx context.Context, clusterID uint, kind, namespace string, page, limit int) ([]map[string]interface{}, int, error) {
	client := s.k8sManager.GetClient(clusterID)
	if client == nil {
		return nil, 0, fmt.Errorf("k8s client not available")
	}
	_ = ctx
	_ = client
	// 降级策略较复杂，先返回提示
	return nil, 0, fmt.Errorf("cluster cache is warming up, please retry in a few seconds")
}

// fallbackGetResource 缓存未命中时直接调用 API
func (s *K8sResourceService) fallbackGetResource(ctx context.Context, clusterID uint, kind, namespace, name string) (map[string]interface{}, error) {
	client := s.k8sManager.GetClient(clusterID)
	if client == nil {
		return nil, fmt.Errorf("k8s client not available")
	}
	_ = ctx
	_ = client
	return nil, fmt.Errorf("resource not found in cache")
}

// convertToSummary 将 K8s 对象转换为列表摘要
func convertToSummary(obj interface{}) map[string]interface{} {
	switch v := obj.(type) {
	case *corev1.Node:
		return map[string]interface{}{
			"name":              v.Name,
			"status":            nodeStatus(v),
			"roles":             nodeRoles(v.Labels),
			"version":           v.Status.NodeInfo.KubeletVersion,
			"os_image":          v.Status.NodeInfo.OSImage,
			"internal_ip":       nodeInternalIP(v),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.Namespace:
		return map[string]interface{}{
			"name":              v.Name,
			"status":            string(v.Status.Phase),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.Pod:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"status":            podStatus(v),
			"restarts":          podRestarts(v),
			"node":              v.Spec.NodeName,
			"pod_ip":            v.Status.PodIP,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *appsv1.Deployment:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"replicas":          fmt.Sprintf("%d/%d", v.Status.ReadyReplicas, *v.Spec.Replicas),
			"available":         v.Status.AvailableReplicas,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *appsv1.StatefulSet:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"replicas":          fmt.Sprintf("%d/%d", v.Status.ReadyReplicas, *v.Spec.Replicas),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *appsv1.DaemonSet:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"desired":           v.Status.DesiredNumberScheduled,
			"ready":             v.Status.NumberReady,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *appsv1.ReplicaSet:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"replicas":          fmt.Sprintf("%d/%d", v.Status.ReadyReplicas, *v.Spec.Replicas),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *batchv1.Job:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"completions":       fmt.Sprintf("%d/%d", v.Status.Succeeded, *v.Spec.Completions),
			"duration":          v.Status.CompletionTime,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *batchv1.CronJob:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"schedule":          v.Spec.Schedule,
			"suspend":           v.Spec.Suspend,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.Service:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"type":              string(v.Spec.Type),
			"cluster_ip":        v.Spec.ClusterIP,
			"external_ip":       serviceExternalIPs(v),
			"ports":             servicePorts(v),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *networkingv1.Ingress:
		className := ""
		if v.Spec.IngressClassName != nil {
			className = *v.Spec.IngressClassName
		}
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"class":             className,
			"hosts":             ingressHosts(v),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.Endpoints:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"endpoints":         len(v.Subsets),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.PersistentVolume:
		return map[string]interface{}{
			"name":              v.Name,
			"capacity":          v.Spec.Capacity.Storage(),
			"access_modes":      v.Spec.AccessModes,
			"status":            string(v.Status.Phase),
			"claim":             pvClaim(v),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.PersistentVolumeClaim:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"status":            string(v.Status.Phase),
			"capacity":          v.Status.Capacity.Storage(),
			"storage_class":     *v.Spec.StorageClassName,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *storagev1.StorageClass:
		return map[string]interface{}{
			"name":              v.Name,
			"provisioner":       v.Provisioner,
			"reclaim_policy":    *v.ReclaimPolicy,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.ConfigMap:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"data_keys":         len(v.Data),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.Secret:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"type":              string(v.Type),
			"data_keys":         len(v.Data),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.ServiceAccount:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"secrets":           len(v.Secrets),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *rbacv1.Role:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"rules":             len(v.Rules),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *rbacv1.RoleBinding:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"role":              v.RoleRef.Name,
			"subjects":          len(v.Subjects),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *rbacv1.ClusterRole:
		return map[string]interface{}{
			"name":              v.Name,
			"rules":             len(v.Rules),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *rbacv1.ClusterRoleBinding:
		return map[string]interface{}{
			"name":              v.Name,
			"role":              v.RoleRef.Name,
			"subjects":          len(v.Subjects),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.Event:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"type":              v.Type,
			"reason":            v.Reason,
			"object":            v.InvolvedObject.Name,
			"message":           v.Message,
			"count":             v.Count,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *v1.CustomResourceDefinition:
		versions := make([]string, 0, len(v.Spec.Versions))
		established := false
		for _, ver := range v.Spec.Versions {
			versions = append(versions, ver.Name)
		}
		for _, cond := range v.Status.Conditions {
			if cond.Type == v1.Established && cond.Status == v1.ConditionTrue {
				established = true
				break
			}
		}
		return map[string]interface{}{
			"name":              v.Name,
			"group":             v.Spec.Group,
			"scope":             string(v.Spec.Scope),
			"versions":          strings.Join(versions, ", "),
			"established":       established,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *autoscalingv2.HorizontalPodAutoscaler:
		scaleTarget := fmt.Sprintf("%s/%s", v.Spec.ScaleTargetRef.Kind, v.Spec.ScaleTargetRef.Name)
		minReplicas := int32(0)
		if v.Spec.MinReplicas != nil {
			minReplicas = *v.Spec.MinReplicas
		}
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"scale_target":      scaleTarget,
			"min_replicas":      minReplicas,
			"max_replicas":      v.Spec.MaxReplicas,
			"current_replicas":  v.Status.CurrentReplicas,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *networkingv1.NetworkPolicy:
		policyTypes := make([]string, 0, len(v.Spec.PolicyTypes))
		for _, pt := range v.Spec.PolicyTypes {
			policyTypes = append(policyTypes, string(pt))
		}
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"pod_selector":      v.Spec.PodSelector.String(),
			"policy_types":      strings.Join(policyTypes, ", "),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *policyv1.PodDisruptionBudget:
		minAvailable := ""
		if v.Spec.MinAvailable != nil {
			minAvailable = v.Spec.MinAvailable.String()
		}
		maxUnavailable := ""
		if v.Spec.MaxUnavailable != nil {
			maxUnavailable = v.Spec.MaxUnavailable.String()
		}
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"min_available":     minAvailable,
			"max_unavailable":   maxUnavailable,
			"current_healthy":   v.Status.CurrentHealthy,
			"desired_healthy":   v.Status.DesiredHealthy,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *discoveryv1.EndpointSlice:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"address_type":      string(v.AddressType),
			"endpoints":         len(v.Endpoints),
			"ports":             len(v.Ports),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.ReplicationController:
		replicas := int32(0)
		if v.Spec.Replicas != nil {
			replicas = *v.Spec.Replicas
		}
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"replicas":          fmt.Sprintf("%d/%d", v.Status.ReadyReplicas, replicas),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.LimitRange:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"limits":            len(v.Spec.Limits),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *corev1.ResourceQuota:
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"hard":              len(v.Spec.Hard),
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *coordinationv1.Lease:
		renewTime := ""
		if v.Spec.RenewTime != nil {
			renewTime = v.Spec.RenewTime.Format(time.RFC3339)
		}
		return map[string]interface{}{
			"name":              v.Name,
			"namespace":         v.Namespace,
			"holder_identity":   v.Spec.HolderIdentity,
			"renew_time":        renewTime,
			"creationTimestamp": v.CreationTimestamp.Format(time.RFC3339),
		}
	case *unstructured.Unstructured:
		return map[string]interface{}{
			"name":              v.GetName(),
			"namespace":         v.GetNamespace(),
			"creationTimestamp": v.GetCreationTimestamp().Format(time.RFC3339),
		}
	default:
		return map[string]interface{}{"kind": "unknown"}
	}
}

// convertToDetail 详情转换
func convertToDetail(obj interface{}) map[string]interface{} {
	summary := convertToSummary(obj)
	summary["_yamlAvailable"] = true

	switch v := obj.(type) {
	case runtime.Object:
		summary["_kind"] = v.GetObjectKind().GroupVersionKind().Kind
	}
	return summary
}

// ---------- 辅助函数 ----------

func nodeStatus(node *corev1.Node) string {
	for _, cond := range node.Status.Conditions {
		if cond.Type == corev1.NodeReady {
			if cond.Status == corev1.ConditionTrue {
				return "Ready"
			}
			return "NotReady"
		}
	}
	return "Unknown"
}

func nodeRoles(labels map[string]string) []string {
	var roles []string
	if labels["node-role.kubernetes.io/control-plane"] == "true" || labels["node-role.kubernetes.io/master"] == "true" {
		roles = append(roles, "control-plane")
	}
	if labels["node-role.kubernetes.io/worker"] == "true" || labels["node-role.kubernetes.io/node"] == "true" {
		roles = append(roles, "worker")
	}
	if len(roles) == 0 {
		roles = append(roles, "worker")
	}
	return roles
}

func nodeInternalIP(node *corev1.Node) string {
	for _, addr := range node.Status.Addresses {
		if addr.Type == corev1.NodeInternalIP {
			return addr.Address
		}
	}
	return ""
}

func podStatus(pod *corev1.Pod) string {
	// 正在删除的 Pod 优先显示 Terminating（与 kubectl 一致）
	if pod.DeletionTimestamp != nil {
		return "Terminating"
	}

	phase := pod.Status.Phase

	// 已完成的 Pod
	if phase == corev1.PodSucceeded {
		return "Completed"
	}

	// 检查容器级别状态（模拟 kubectl 的 STATUS 列）
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			return cs.State.Waiting.Reason
		}
		if cs.State.Terminated != nil && cs.State.Terminated.Reason != "" {
			return cs.State.Terminated.Reason
		}
	}

	// 检查初始化容器状态
	for _, cs := range pod.Status.InitContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			return cs.State.Waiting.Reason
		}
		if cs.State.Terminated != nil && cs.State.Terminated.Reason != "" {
			return cs.State.Terminated.Reason
		}
	}

	// Ephemeral 容器状态
	for _, cs := range pod.Status.EphemeralContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			return cs.State.Waiting.Reason
		}
		if cs.State.Terminated != nil && cs.State.Terminated.Reason != "" {
			return cs.State.Terminated.Reason
		}
	}

	return string(phase)
}

func podRestarts(pod *corev1.Pod) int32 {
	var restarts int32
	for _, cs := range pod.Status.ContainerStatuses {
		restarts += cs.RestartCount
	}
	return restarts
}

func serviceExternalIPs(svc *corev1.Service) string {
	if len(svc.Status.LoadBalancer.Ingress) > 0 {
		return svc.Status.LoadBalancer.Ingress[0].IP
	}
	return "None"
}

func servicePorts(svc *corev1.Service) string {
	var ports string
	for i, p := range svc.Spec.Ports {
		if i > 0 {
			ports += ","
		}
		ports += fmt.Sprintf("%d/%s", p.Port, p.Protocol)
	}
	return ports
}

func ingressHosts(ing *networkingv1.Ingress) []string {
	var hosts []string
	for _, rule := range ing.Spec.Rules {
		hosts = append(hosts, rule.Host)
	}
	return hosts
}

func pvClaim(pv *corev1.PersistentVolume) string {
	if pv.Spec.ClaimRef != nil {
		return pv.Spec.ClaimRef.Namespace + "/" + pv.Spec.ClaimRef.Name
	}
	return ""
}


// clusterLevelKinds cluster-level 资源（不需要 namespace）
var clusterLevelKinds = map[string]bool{
	"nodes": true, "persistentvolumes": true, "storageclasses": true,
	"clusterroles": true, "clusterrolebindings": true,
	"customresourcedefinitions": true, "namespaces": true,
}

// invalidateListCache 清除指定集群+资源类型的列表缓存，确保写操作后前端立即看到最新数据
func invalidateListCache(ctx context.Context, clusterID uint, kind string) {
	if redis.Client == nil {
		return
	}
	pattern := fmt.Sprintf("k8s:list:%d:%s:*", clusterID, kind)
	iter := redis.Client.Scan(ctx, 0, pattern, 0).Iterator()
	for iter.Next(ctx) {
		_ = redis.Client.Del(ctx, iter.Val())
	}
}

// getDynamicClient 获取指定集群的 dynamic client
func (s *K8sResourceService) getDynamicClient(clusterID uint) (dynamic.Interface, error) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		return nil, fmt.Errorf("集群缓存正在重建，请 5-10 秒后重试")
	}
	if cc.DynamicClient != nil {
		return cc.DynamicClient, nil
	}
	return dynamic.NewForConfig(cc.Config)
}

// canPerformAction 通过 SelfSubjectAccessReview 校验 kubeconfig 实际权限（兜底）
func (s *K8sResourceService) canPerformAction(ctx context.Context, clusterID uint, verb, kind, namespace string) (bool, error) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		return false, fmt.Errorf("k8s client not available")
	}

	gvk := kindToGVK(kind)
	sar := &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: &authorizationv1.ResourceAttributes{
				Verb:      verb,
				Group:     gvk.Group,
				Resource:  kind,
				Namespace: namespace,
			},
		},
	}

	result, err := cc.Client.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, sar, metav1.CreateOptions{})
	if err != nil {
		return false, err
	}
	return result.Status.Allowed, nil
}

// CreateResource 创建 K8s 资源（含权限兜底校验）
func (s *K8sResourceService) CreateResource(ctx context.Context, clusterID uint, kind, namespace string, manifest map[string]interface{}) (map[string]interface{}, error) {
	// 兜底权限校验
	allowed, err := s.canPerformAction(ctx, clusterID, "create", kind, namespace)
	if err != nil {
		return nil, fmt.Errorf("权限校验失败: %w", err)
	}
	if !allowed {
		return nil, fmt.Errorf("权限不足: 无法创建 %s", kind)
	}

	client, err := s.getDynamicClient(clusterID)
	if err != nil {
		return nil, err
	}

	gvk := kindToGVK(kind)
	gvr := schema.GroupVersionResource{
		Group:    gvk.Group,
		Version:  gvk.Version,
		Resource: kind,
	}

	obj := &unstructured.Unstructured{Object: manifest}
	var result *unstructured.Unstructured
	if clusterLevelKinds[kind] {
		result, err = client.Resource(gvr).Create(ctx, obj, metav1.CreateOptions{})
	} else {
		result, err = client.Resource(gvr).Namespace(namespace).Create(ctx, obj, metav1.CreateOptions{})
	}
	if err != nil {
		return nil, err
	}
	// 主动同步缓存：增量更新单个对象，避免 Replace 整个 store 导致其他 namespace 数据丢失
	go s.syncObjectToStore(context.Background(), clusterID, kind, namespace, result.GetName(), "update")
	// 清除 Redis 列表缓存，确保前端立即看到新数据
	invalidateListCache(context.Background(), clusterID, kind)
	return result.Object, nil
}

// UpdateResource 更新 K8s 资源（含权限兜底校验）
func (s *K8sResourceService) UpdateResource(ctx context.Context, clusterID uint, kind, namespace, name string, manifest map[string]interface{}) (map[string]interface{}, error) {
	allowed, err := s.canPerformAction(ctx, clusterID, "update", kind, namespace)
	if err != nil {
		return nil, fmt.Errorf("权限校验失败: %w", err)
	}
	if !allowed {
		return nil, fmt.Errorf("权限不足: 无法更新 %s", kind)
	}

	client, err := s.getDynamicClient(clusterID)
	if err != nil {
		return nil, err
	}

	gvk := kindToGVK(kind)
	gvr := schema.GroupVersionResource{
		Group:    gvk.Group,
		Version:  gvk.Version,
		Resource: kind,
	}

	obj := &unstructured.Unstructured{Object: manifest}
	obj.SetName(name)
	var result *unstructured.Unstructured
	if clusterLevelKinds[kind] {
		result, err = client.Resource(gvr).Update(ctx, obj, metav1.UpdateOptions{})
	} else {
		result, err = client.Resource(gvr).Namespace(namespace).Update(ctx, obj, metav1.UpdateOptions{})
	}
	if err != nil {
		return nil, err
	}
	// 主动同步缓存：增量更新单个对象
	go s.syncObjectToStore(context.Background(), clusterID, kind, namespace, name, "update")
	// 清除 Redis 列表缓存
	invalidateListCache(context.Background(), clusterID, kind)
	return result.Object, nil
}

// DeleteResource 删除 K8s 资源（含权限兜底校验）
func (s *K8sResourceService) DeleteResource(ctx context.Context, clusterID uint, kind, namespace, name string) error {
	allowed, err := s.canPerformAction(ctx, clusterID, "delete", kind, namespace)
	if err != nil {
		return fmt.Errorf("权限校验失败: %w", err)
	}
	if !allowed {
		return fmt.Errorf("权限不足: 无法删除 %s", kind)
	}

	client, err := s.getDynamicClient(clusterID)
	if err != nil {
		return err
	}

	gvk := kindToGVK(kind)
	gvr := schema.GroupVersionResource{
		Group:    gvk.Group,
		Version:  gvk.Version,
		Resource: kind,
	}

	if clusterLevelKinds[kind] {
		err = client.Resource(gvr).Delete(ctx, name, metav1.DeleteOptions{})
	} else {
		err = client.Resource(gvr).Namespace(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	}
	if err != nil {
		return err
	}
	// 主动同步缓存：从 store 中删除单个对象
	go s.syncObjectToStore(context.Background(), clusterID, kind, namespace, name, "delete")
	// 清除 Redis 列表缓存
	invalidateListCache(context.Background(), clusterID, kind)
	return nil
}

// syncObjectToStore 写操作后增量同步单个对象到 informer store，
// 避免 Replace 整个 store 导致其他 namespace 数据丢失。
func (s *K8sResourceService) syncObjectToStore(ctx context.Context, clusterID uint, kind, namespace, name, operation string) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		return
	}

	store := getStoreByKind(cc, kind)
	if store == nil {
		return
	}

	switch operation {
	case "create", "update":
		client, err := s.getDynamicClient(clusterID)
		if err != nil {
			return
		}
		gvk := kindToGVK(kind)
		gvr := schema.GroupVersionResource{
			Group:    gvk.Group,
			Version:  gvk.Version,
			Resource: kind,
		}
		// K8s API 有最终一致性：Create 返回 200 后，Get 可能短暂返回 NotFound。
		// 使用指数退避重试，最多 5 次（总等待约 3 秒）。
		var obj *unstructured.Unstructured
		for attempt := 0; attempt < 5; attempt++ {
			if clusterLevelKinds[kind] {
				obj, err = client.Resource(gvr).Get(ctx, name, metav1.GetOptions{})
			} else {
				obj, err = client.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
			}
			if err == nil {
				break
			}
			if attempt < 4 {
				time.Sleep(time.Duration(200*(1<<attempt)) * time.Millisecond)
			}
		}
		if err != nil {
			return
		}
		typedObj, convErr := convertUnstructuredToTyped(obj)
		if convErr != nil {
			return
		}
		_ = store.Update(typedObj)
	case "delete":
		key := name
		if !clusterLevelKinds[kind] && namespace != "" {
			key = namespace + "/" + name
		}
		oldObj, exists, err := store.GetByKey(key)
		if err != nil || !exists {
			return
		}
		_ = store.Delete(oldObj)
	}

	// 异步兜底：再次清除 Redis 缓存（防止主流程清除失败）
	invalidateListCache(context.Background(), clusterID, kind)

	// 广播 WebSocket 推送，前端收到后自动刷新
	ws.Broadcast(ws.ResourceChangeMessage{
		Type:      "resource_change",
		ClusterID: clusterID,
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
		Action:    operation,
	})
}

// getStoreByKind 根据资源类型获取对应的 informer store
func getStoreByKind(cc *ClusterClient, kind string) cache.Store {
	switch kind {
	case "nodes":
		return cc.NodeStore
	case "namespaces":
		return cc.NamespaceStore
	case "pods":
		return cc.PodStore
	case "deployments":
		return cc.DeploymentStore
	case "statefulsets":
		return cc.StatefulSetStore
	case "daemonsets":
		return cc.DaemonSetStore
	case "replicasets":
		return cc.ReplicaSetStore
	case "jobs":
		return cc.JobStore
	case "cronjobs":
		return cc.CronJobStore
	case "services":
		return cc.ServiceStore
	case "ingresses":
		return cc.IngressStore
	case "endpoints":
		return cc.EndpointStore
	case "persistentvolumes":
		return cc.PersistentVolumeStore
	case "persistentvolumeclaims":
		return cc.PersistentVolumeClaimStore
	case "storageclasses":
		return cc.StorageClassStore
	case "configmaps":
		return cc.ConfigMapStore
	case "secrets":
		return cc.SecretStore
	case "serviceaccounts":
		return cc.ServiceAccountStore
	case "roles":
		return cc.RoleStore
	case "rolebindings":
		return cc.RoleBindingStore
	case "clusterroles":
		return cc.ClusterRoleStore
	case "clusterrolebindings":
		return cc.ClusterRoleBindingStore
	case "events":
		return cc.EventStore
	case "customresourcedefinitions":
		return cc.CRDStore
	case "horizontalpodautoscalers":
		return cc.HorizontalPodAutoscalerStore
	case "networkpolicies":
		return cc.NetworkPolicyStore
	case "poddisruptionbudgets":
		return cc.PodDisruptionBudgetStore
	case "endpointslices":
		return cc.EndpointSliceStore
	case "replicationcontrollers":
		return cc.ReplicationControllerStore
	case "limitranges":
		return cc.LimitRangeStore
	case "resourcequotas":
		return cc.ResourceQuotaStore
	case "leases":
		return cc.LeaseStore
	case "servicemonitors":
		return cc.ServiceMonitorStore
	default:
		return nil
	}
}

// convertUnstructuredToTyped 将 unstructured.Unstructured 转换为 scheme 中注册的 typed object
func convertUnstructuredToTyped(obj *unstructured.Unstructured) (interface{}, error) {
	gvk := obj.GroupVersionKind()
	if gvk.Empty() {
		// 如果 unstructured 没有 GVK，尝试从 Object 的 apiVersion/kind 字段推断
		apiVersion, _, _ := unstructured.NestedString(obj.Object, "apiVersion")
		kind, _, _ := unstructured.NestedString(obj.Object, "kind")
		if apiVersion != "" && kind != "" {
			gv, err := schema.ParseGroupVersion(apiVersion)
			if err == nil {
				gvk = gv.WithKind(kind)
			}
		}
	}
	if gvk.Empty() {
		return nil, fmt.Errorf("无法解析 GVK")
	}

	typedObj, err := scheme.Scheme.New(gvk)
	if err != nil {
		// scheme 中未注册的类型（如 CRD）直接返回 unstructured
		return obj, nil
	}

	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(obj.Object, typedObj); err != nil {
		return nil, err
	}

	return typedObj, nil
}
