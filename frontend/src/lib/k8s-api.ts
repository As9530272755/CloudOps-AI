import { apiClient as api } from './api'

export interface ResourceListResponse {
  items: any[]
  total: number
  page: number
  limit: number
}

export interface ResourceListResult {
  success: boolean
  data?: ResourceListResponse
  error?: string
}

export interface ResourceDetailResult {
  success: boolean
  data?: any
  error?: string
}

export interface NamespacesResult {
  success: boolean
  data?: string[]
  error?: string
}

export interface SearchResourceItem {
  cluster_id: number
  cluster_name: string
  kind: string
  namespace: string
  name: string
  status: string
}

export interface SearchResourcesResult {
  success: boolean
  data?: SearchResourceItem[]
  error?: string
}

export interface ClusterStats {
  [key: string]: number
}

export interface ClusterStatsResult {
  success: boolean
  data?: ClusterStats
  error?: string
}

export const k8sAPI = {
  // 全局资源搜索
  searchResources: async (keyword: string, limit: number = 20) => {
    const response = await api.get(`/search/resources?keyword=${encodeURIComponent(keyword)}&limit=${limit}`)
    return response.data as SearchResourcesResult
  },

  // 获取命名空间列表
  getNamespaces: async (clusterId: number) => {
    const response = await api.get(`/clusters/${clusterId}/namespaces`)
    return response.data as NamespacesResult
  },

  // 获取集群统计
  getStats: async (clusterId: number) => {
    const response = await api.get(`/clusters/${clusterId}/stats`)
    return response.data as ClusterStatsResult
  },

  // 刷新集群缓存
  refreshCluster: async (clusterId: number) => {
    const response = await api.post(`/clusters/${clusterId}/refresh`)
    return response.data
  },

  // 获取资源列表
  getResources: async (
    clusterId: number,
    kind: string,
    namespace: string = '',
    page: number = 1,
    limit: number = 20,
    keyword: string = ''
  ) => {
    const params = new URLSearchParams()
    if (namespace && namespace !== 'all') {
      params.set('namespace', namespace)
    }
    if (keyword && keyword.trim()) {
      params.set('keyword', keyword.trim())
    }
    params.set('page', String(page))
    params.set('limit', String(limit))
    const response = await api.get(`/clusters/${clusterId}/resources/${kind}?${params.toString()}`)
    return response.data as ResourceListResult
  },

  // 获取资源详情
  getResource: async (
    clusterId: number,
    kind: string,
    name: string,
    namespace: string = ''
  ) => {
    const params = new URLSearchParams()
    if (namespace && namespace !== 'all') {
      params.set('namespace', namespace)
    }
    const response = await api.get(`/clusters/${clusterId}/resources/${kind}/${name}?${params.toString()}`)
    return response.data as ResourceDetailResult
  },

  // 获取资源 YAML
  getResourceYAML: async (
    clusterId: number,
    kind: string,
    name: string,
    namespace: string = ''
  ) => {
    const params = new URLSearchParams()
    if (namespace && namespace !== 'all') {
      params.set('namespace', namespace)
    }
    const response = await api.get(`/clusters/${clusterId}/resources/${kind}/${name}/yaml?${params.toString()}`)
    return response.data
  },
}

// 资源类型定义
export const resourceCategories = [
  {
    key: 'overview',
    label: '概览',
    icon: 'Dashboard',
    resources: [] as string[],
  },
  {
    key: 'nodes',
    label: '节点',
    icon: 'Computer',
    resources: ['nodes'],
  },
  {
    key: 'workloads',
    label: '工作负载',
    icon: 'Apps',
    resources: ['pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs'],
  },
  {
    key: 'services',
    label: '服务与网络',
    icon: 'NetworkCheck',
    resources: ['services', 'ingresses', 'endpoints'],
  },
  {
    key: 'storage',
    label: '存储',
    icon: 'Storage',
    resources: ['persistentvolumes', 'persistentvolumeclaims', 'storageclasses'],
  },
  {
    key: 'config',
    label: '配置',
    icon: 'Settings',
    resources: ['configmaps', 'secrets', 'serviceaccounts'],
  },
  {
    key: 'rbac',
    label: '访问控制',
    icon: 'Security',
    resources: ['roles', 'rolebindings', 'clusterroles', 'clusterrolebindings'],
  },
  {
    key: 'namespaces',
    label: '命名空间',
    icon: 'Folder',
    resources: ['namespaces'],
  },
  {
    key: 'events',
    label: '事件',
    icon: 'EventNote',
    resources: ['events'],
  },
  {
    key: 'custom',
    label: '自定义资源',
    icon: 'Extension',
    resources: ['customresourcedefinitions'],
  },
]

export const resourceLabels: Record<string, string> = {
  nodes: '节点',
  namespaces: '命名空间',
  pods: 'Pod',
  deployments: 'Deployment',
  statefulsets: 'StatefulSet',
  daemonsets: 'DaemonSet',
  replicasets: 'ReplicaSet',
  jobs: 'Job',
  cronjobs: 'CronJob',
  services: 'Service',
  ingresses: 'Ingress',
  endpoints: 'Endpoints',
  persistentvolumes: 'PersistentVolume',
  persistentvolumeclaims: 'PersistentVolumeClaim',
  storageclasses: 'StorageClass',
  configmaps: 'ConfigMap',
  secrets: 'Secret',
  serviceaccounts: 'ServiceAccount',
  roles: 'Role',
  rolebindings: 'RoleBinding',
  clusterroles: 'ClusterRole',
  clusterrolebindings: 'ClusterRoleBinding',
  events: 'Event',
  customresourcedefinitions: 'CustomResourceDefinition',
}
