import api from './api'

export interface Cluster {
  id: number
  name: string
  display_name?: string
  status?: string
  version?: string
  node_count?: number
  pod_count?: number
  server?: string
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

export const clusterAPI = {
  getClusters: async () => {
    const response = await api.get('/clusters')
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