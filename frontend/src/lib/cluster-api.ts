import { apiClient as api } from './api'

export interface ClusterMetadata {
  health_status?: string
  version?: string
  node_count?: number
  pod_count?: number
  namespace_count?: number
  last_synced_at?: string
}

export interface Cluster {
  id: number
  name: string
  display_name?: string
  server?: string
  cluster_label_name?: string
  cluster_label_value?: string
  permission_scope?: 'read-only' | 'read-write' | 'admin' | 'unknown'
  metadata?: ClusterMetadata
}

export interface CreateClusterRequest {
  name: string
  display_name?: string
  description?: string
  auth_type: 'kubeconfig' | 'token'
  cluster_label_name?: string
  cluster_label_value?: string
  kubeconfig?: string
  token?: string
  server?: string
  permission_scope?: string
}

export interface UpdateClusterRequest {
  display_name?: string
  description?: string
  cluster_label_name?: string
  cluster_label_value?: string
}

export interface ProbeLabelSuggestion {
  key: string
  value: string
  source: string
}

export interface TestAndProbeResult {
  connected: boolean
  kubernetes_version: string
  cluster_name_from_context: string
  suggested_labels: ProbeLabelSuggestion[]
  permission_scope: string
  message?: string
}

export interface ClusterListParams {
  keyword?: string
  status?: string
  auth_type?: string
}

export const clusterAPI = {
  getClusters: async (params?: ClusterListParams) => {
    const response = await api.get('/clusters', { params })
    return response.data
  },
  
  createCluster: async (data: CreateClusterRequest) => {
    const response = await api.post('/clusters', data)
    return response.data
  },
  
  updateCluster: async (id: number, data: UpdateClusterRequest) => {
    const response = await api.put(`/clusters/${id}`, data)
    return response.data
  },

  deleteCluster: async (id: number) => {
    const response = await api.delete(`/clusters/${id}`)
    return response.data
  },

  testAndProbe: async (data: CreateClusterRequest) => {
    const response = await api.post('/clusters/test-and-probe', data)
    return response.data as { success: boolean; data?: TestAndProbeResult; error?: string }
  }
}