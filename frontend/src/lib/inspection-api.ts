import { apiClient as api } from './api'

export interface InspectionTask {
  id: number
  name: string
  description: string
  schedule: string
  schedule_type: string
  timezone: string
  enabled: boolean
  retry_times: number
  cluster_ids: number[]
  rules_config: any
  notify_config: any
  created_at: string
  updated_at: string
}

export interface InspectionJob {
  id: number
  task_id: number
  status: string
  trigger_type: string
  started_at: string
  finished_at: string
  total_clusters: number
  success_count: number
  failed_count: number
  score_avg: number
  risk_level: string
  created_at: string
}

export interface InspectionResultItem {
  id: number
  job_id: number
  cluster_id: number
  status: string
  score: number
  risk_level: string
  findings: any[]
  report_html?: string
  report_markdown?: string
  error_msg: string
  created_at: string
}

export const inspectionAPI = {
  // 一键快速巡检
  quickInspect: async () => {
    const res = await api.post('/inspection/quick')
    return res.data as { success: boolean; data?: InspectionJob; message?: string; error?: string }
  },

  // 任务管理
  listTasks: async () => {
    const res = await api.get('/inspection/tasks')
    return res.data as { success: boolean; data?: InspectionTask[]; error?: string }
  },
  createTask: async (data: Partial<InspectionTask>) => {
    const res = await api.post('/inspection/tasks', data)
    return res.data as { success: boolean; data?: InspectionTask; error?: string }
  },
  updateTask: async (id: number, data: Partial<InspectionTask>) => {
    const res = await api.put(`/inspection/tasks/${id}`, data)
    return res.data as { success: boolean; data?: InspectionTask; error?: string }
  },
  deleteTask: async (id: number) => {
    const res = await api.delete(`/inspection/tasks/${id}`)
    return res.data as { success: boolean; error?: string }
  },
  triggerTask: async (id: number) => {
    const res = await api.post(`/inspection/tasks/${id}/trigger`)
    return res.data as { success: boolean; message?: string; error?: string }
  },

  // 执行记录
  listJobs: async (params?: { task_id?: number; page?: number; limit?: number }) => {
    const res = await api.get('/inspection/jobs', { params })
    return res.data as { success: boolean; data?: { items: InspectionJob[]; total: number; page: number; limit: number }; error?: string }
  },
  getJob: async (id: number) => {
    const res = await api.get(`/inspection/jobs/${id}`)
    return res.data as { success: boolean; data?: { job: InspectionJob; results: InspectionResultItem[] }; error?: string }
  },
  getResult: async (id: number) => {
    const res = await api.get(`/inspection/results/${id}`)
    return res.data as { success: boolean; data?: InspectionResultItem; error?: string }
  },

  // 报告下载
  downloadReport: (jobId: number, clusterId?: number, format: 'html' | 'md' = 'html') => {
    const params = new URLSearchParams()
    if (clusterId) params.set('cluster_id', String(clusterId))
    params.set('format', format)
    return `${api.defaults.baseURL}/inspection/jobs/${jobId}/report?${params.toString()}`
  },
}
