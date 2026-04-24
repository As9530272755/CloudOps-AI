import { apiClient } from './api'

export interface TerminalAuditLog {
  id: number
  user_id: number
  username: string
  cluster_id: number
  cluster_name: string
  session_id: string
  action_type: 'login' | 'command' | 'logout'
  command?: string
  working_dir?: string
  ip_address?: string
  created_at: string
}

export interface AuditLogListResponse {
  success: boolean
  data?: {
    list: TerminalAuditLog[]
    total: number
    page: number
    limit: number
  }
  error?: string
}

export const terminalAPI = {
  uploadFile: async (clusterId: number, path: string, file: File) => {
    const form = new FormData()
    form.append('cluster_id', String(clusterId))
    form.append('path', path)
    form.append('file', file)
    const response = await apiClient.post('/terminal/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },

  downloadFile: async (clusterId: number, path: string) => {
    const response = await apiClient.get('/terminal/download', {
      params: { cluster_id: clusterId, path },
      responseType: 'blob',
    })
    const blob = new Blob([response.data])
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const filename = path.split('/').pop() || 'download'
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  },

  listFiles: async (clusterId: number, path: string) => {
    const response = await apiClient.get('/terminal/files', {
      params: { cluster_id: clusterId, path },
    })
    return response.data
  },

  listAuditLogs: async (params?: {
    cluster_id?: number
    session_id?: string
    action_type?: string
    command?: string
    page?: number
    limit?: number
  }): Promise<AuditLogListResponse> => {
    const response = await apiClient.get('/terminal/audit-logs', { params })
    return response.data
  },
}
