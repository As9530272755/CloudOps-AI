import { apiClient as api } from './api'

export interface DataSource {
  id: number
  tenant_id: number
  cluster_id?: number
  name: string
  type: string
  url: string
  config: string
  is_default: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CreateDataSourceRequest {
  name: string
  type: string
  url: string
  config?: string
  cluster_id?: number
  is_default?: boolean
}

export interface ProxyQueryRequest {
  query: string
  start?: string
  end?: string
  step?: string
  extra_labels?: Record<string, string>
}

export interface ProxyQueryResponse {
  status: string
  data?: any
  error?: string
}

export const datasourceAPI = {
  list: async (type?: string) => {
    const response = await api.get('/datasources', { params: { type } })
    return response.data
  },
  get: async (id: number) => {
    const response = await api.get(`/datasources/${id}`)
    return response.data
  },
  create: async (data: CreateDataSourceRequest) => {
    const response = await api.post('/datasources', data)
    return response.data
  },
  update: async (id: number, data: CreateDataSourceRequest) => {
    const response = await api.put(`/datasources/${id}`, data)
    return response.data
  },
  delete: async (id: number) => {
    const response = await api.delete(`/datasources/${id}`)
    return response.data
  },
  test: async (id: number) => {
    const response = await api.post(`/datasources/${id}/test`)
    return response.data
  },
  query: async (id: number, req: ProxyQueryRequest) => {
    const response = await api.post(`/datasources/${id}/query`, req)
    return response.data
  },
  getMetrics: async (id: number, match?: string) => {
    const response = await api.get(`/datasources/${id}/metrics`, { params: { match } })
    return response.data
  },
}
