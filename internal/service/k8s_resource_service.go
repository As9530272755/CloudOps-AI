package service

import (
	"context"
	"fmt"
	"time"

	"sigs.k8s.io/yaml"

	"k8s.io/client-go/kubernetes/scheme"

	corev1 "k8s.io/api/core/v1"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/runtime"
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

// ListResources 列出资源
func (s *K8sResourceService) ListResources(ctx context.Context, clusterID uint, kind, namespace string, page, limit int) ([]map[string]interface{}, int, error) {
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
	}

	if clusterKinds[kind] {
		items, total, err = cc.GetClusterResourceList(kind, page, limit)
	} else {
		items, total, err = cc.GetNamespacedResourceList(kind, namespace, page, limit)
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

	if runtimeObj, ok := obj.(runtime.Object); ok {
		// 补全 TypeMeta (apiVersion / kind)，确保 YAML 格式与 kubectl 一致
		gvks, _, err := scheme.Scheme.ObjectKinds(runtimeObj)
		if err == nil && len(gvks) > 0 {
			runtimeObj.GetObjectKind().SetGroupVersionKind(gvks[0])
		}
		out, err := yaml.Marshal(runtimeObj)
		if err != nil {
			return "", err
		}
		return string(out), nil
	}

	out, err := yaml.Marshal(obj)
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

// GetClusterStats 获取集群统计
func (s *K8sResourceService) GetClusterStats(ctx context.Context, clusterID uint) (map[string]interface{}, error) {
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

	return map[string]interface{}{
		"nodes":            len(cc.NodeStore.List()),
		"namespaces":       len(cc.NamespaceStore.List()),
		"pods":             len(cc.PodStore.List()),
		"deployments":      len(cc.DeploymentStore.List()),
		"statefulsets":     len(cc.StatefulSetStore.List()),
		"daemonsets":       len(cc.DaemonSetStore.List()),
		"services":         len(cc.ServiceStore.List()),
		"ingresses":        len(cc.IngressStore.List()),
		"jobs":             len(cc.JobStore.List()),
		"cronjobs":         len(cc.CronJobStore.List()),
		"persistentvolumes": len(cc.PersistentVolumeStore.List()),
		"configmaps":       len(cc.ConfigMapStore.List()),
		"secrets":          len(cc.SecretStore.List()),
		"events":           len(cc.EventStore.List()),
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
			"status":            string(v.Status.Phase),
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
