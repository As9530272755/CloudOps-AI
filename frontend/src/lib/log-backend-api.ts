import { apiClient as api } from './api'

export interface LogBackendConfig {
  type: 'elasticsearch' | 'opensearch' | 'loki' | 'sls' | 'unknown'
  url: string
  index_patterns: {
    ingress?: string
    coredns?: string
    lb?: string
    app?: string
  }
  headers?: Record<string, string>
  username?: string
  password?: string
  detected_at?: string
}

export const logBackendAPI = {
  get: async (clusterId: number) => {
    const res = await api.get(`/clusters/${clusterId}/log-backend`)
    return res.data as { success: boolean; data?: LogBackendConfig; error?: string }
  },

  update: async (clusterId: number, config: LogBackendConfig) => {
    const res = await api.put(`/clusters/${clusterId}/log-backend`, config)
    return res.data as { success: boolean; message?: string; error?: string }
  },

  test: async (clusterId: number) => {
    const res = await api.get(`/clusters/${clusterId}/logs/test`)
    return res.data as { success: boolean; message?: string; error?: string }
  },
}
