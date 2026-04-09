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
  metadata?: ClusterMetadata
}

export interface CreateClusterRequest {
  name: string
  display_name?: string
  description?: string
  auth_type: 'kubeconfig' | 'token'
  kubeconfig?: string
  token?: string
  server?: string
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
  
  deleteCluster: async (id: number) => {
    const response = await api.delete(`/clusters/${id}`)
    return response.data
  }
}