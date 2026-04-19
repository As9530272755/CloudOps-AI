package service

import (
	"context"
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
	v1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/dynamic"
	authorizationv1 "k8s.io/api/authorization/v1"
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
	return result, total, nil
}

// kindToGVK 为 scheme 无法识别的类型提供手动 GVK 映射
func kindToGVK(kind string) schema.GroupVersionKind {
	switch kind {
	case "pods", "services", "endpoints", "persistentvolumeclaims", "configmaps", "secrets", "serviceaccounts", "nodes", "namespaces", "persistentvolumes", "events":
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

// getDynamicClient 获取指定集群的 dynamic client
func (s *K8sResourceService) getDynamicClient(clusterID uint) (dynamic.Interface, error) {
	cc := s.k8sManager.GetClusterClient(clusterID)
	if cc == nil {
		return nil, fmt.Errorf("集群缓存正在重建，请 5-10 秒后重试")
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
	return err
}
