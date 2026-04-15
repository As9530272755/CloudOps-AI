import { apiClient as api } from './api'

export interface LogQueryRequest {
  cluster_ids: number[]
  log_type: 'ingress' | 'coredns' | 'lb' | 'app'
  time_range: {
    from: string
    to: string
  }
  filters?: Record<string, string>
  limit?: number
  offset?: number
}

export interface LogEntry {
  timestamp: string
  cluster_id: number
  cluster_name: string
  namespace: string
  pod_name: string
  container: string
  message: string
  fields?: Record<string, any>
}

export interface LogQueryResult {
  total: number
  limit: number
  offset: number
  cluster_results: any[]
  entries: LogEntry[]
}

export interface HistogramPoint {
  time: string
  count: number
}

export const logAPI = {
  query: async (req: LogQueryRequest) => {
    const res = await api.post('/logs/query', req)
    return res.data as { success: boolean; data?: LogQueryResult; error?: string }
  },

  histogram: async (req: Omit<LogQueryRequest, 'cluster_ids'> & { cluster_id: number }) => {
    const res = await api.post('/logs/histogram', req)
    return res.data as { success: boolean; data?: { histogram: HistogramPoint[] }; error?: string }
  },

  analyze: async (req: LogQueryRequest) => {
    const res = await api.post('/logs/analyze', req)
    return res.data as { success: boolean; data?: { sample: string; error_count: number; total_count: number }; error?: string }
  },

  testBackend: async (clusterId: number) => {
    const res = await api.get(`/clusters/${clusterId}/logs/test`)
    return res.data as { success: boolean; message?: string; error?: string }
  },
}
