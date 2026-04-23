import { apiClient as api } from './api'

export interface Dashboard {
  id: number
  tenant_id: number
  title: string
  description: string
  config: string
  is_default: boolean
  created_at: string
  updated_at: string
  panels?: DashboardPanel[]
}

export interface DashboardPanel {
  id: number
  dashboard_id: number
  title: string
  type: 'line' | 'bar' | 'pie' | 'gauge' | 'stat' | 'table'
  data_source_id: number
  query: string
  position: string
  options: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CreateDashboardRequest {
  title: string
  description?: string
  config?: string
  is_default?: boolean
}

export interface CreatePanelRequest {
  title: string
  type: string
  data_source_id: number
  query: string
  position?: string
  options?: string
  sort_order?: number
}

export const dashboardAPI = {
  list: async () => {
    const response = await api.get('/dashboards')
    return response.data
  },
  get: async (id: number) => {
    const response = await api.get(`/dashboards/${id}`)
    return response.data
  },
  getDefault: async () => {
    const response = await api.get('/dashboards/default')
    return response.data
  },
  create: async (data: CreateDashboardRequest) => {
    const response = await api.post('/dashboards', data)
    return response.data
  },
  update: async (id: number, data: CreateDashboardRequest) => {
    const response = await api.put(`/dashboards/${id}`, data)
    return response.data
  },
  delete: async (id: number) => {
    const response = await api.delete(`/dashboards/${id}`)
    return response.data
  },
  setDefault: async (id: number) => {
    const response = await api.put(`/dashboards/${id}/default`)
    return response.data
  },
  createPanel: async (dashboardId: number, data: CreatePanelRequest) => {
    const response = await api.post(`/dashboards/${dashboardId}/panels`, data)
    return response.data
  },
  updatePanel: async (dashboardId: number, panelId: number, data: CreatePanelRequest) => {
    const response = await api.put(`/dashboards/${dashboardId}/panels/${panelId}`, data)
    return response.data
  },
  deletePanel: async (dashboardId: number, panelId: number) => {
    const response = await api.delete(`/dashboards/${dashboardId}/panels/${panelId}`)
    return response.data
  },
}
