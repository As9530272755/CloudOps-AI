import { apiClient as api } from './api'

export interface LogBackend {
  id: number
  cluster_id: number
  name: string
  type: 'elasticsearch' | 'opensearch' | 'loki'
  url: string
  index_patterns?: {
    all?: string
    ingress?: string
    coredns?: string
    lb?: string
    app?: string
  }
  headers?: Record<string, string>
  username?: string
  password?: string
  created_at?: string
  updated_at?: string
}

export interface LogBackendForm {
  cluster_id: number
  name: string
  type: 'elasticsearch' | 'opensearch' | 'loki'
  url: string
  index_patterns: {
    all?: string
    ingress: string
    coredns: string
    lb: string
    app: string
  }
  headers?: Record<string, string>
  username?: string
  password?: string
}

export const logBackendAPI = {
  list: async (clusterId?: number) => {
    const res = await api.get('/log-backends', { params: clusterId ? { cluster_id: clusterId } : undefined })
    return res.data as { success: boolean; data?: LogBackend[]; error?: string }
  },

  get: async (id: number) => {
    const res = await api.get(`/log-backends/${id}`)
    return res.data as { success: boolean; data?: LogBackend; error?: string }
  },

  create: async (payload: LogBackendForm) => {
    const res = await api.post('/log-backends', payload)
    return res.data as { success: boolean; data?: LogBackend; error?: string }
  },

  update: async (id: number, payload: LogBackendForm) => {
    const res = await api.put(`/log-backends/${id}`, payload)
    return res.data as { success: boolean; message?: string; error?: string }
  },

  delete: async (id: number) => {
    const res = await api.delete(`/log-backends/${id}`)
    return res.data as { success: boolean; message?: string; error?: string }
  },

  test: async (id: number) => {
    const res = await api.get(`/log-backends/${id}/test`)
    return res.data as { success: boolean; message?: string; error?: string }
  },
}
