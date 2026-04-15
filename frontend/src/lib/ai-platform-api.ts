import { apiClient as api } from './api'

export interface AIPlatform {
  id: string
  name: string
  provider_type: 'openclaw' | 'ollama'
  config_json: string
  status: string
  is_default: boolean
  last_checked_at?: string
  created_at: string
}

export interface PlatformFormConfig {
  url: string
  token: string
  model: string
  timeout: number
  max_context_length?: number
  max_history_messages?: number
}

export interface AIPlatformResult {
  success: boolean
  data?: AIPlatform | AIPlatform[]
  error?: string
}

export const aiPlatformAPI = {
  list: async () => {
    const response = await api.get('/ai/platforms')
    return response.data as AIPlatformResult
  },
  get: async (id: string) => {
    const response = await api.get(`/ai/platforms/${id}`)
    return response.data as AIPlatformResult
  },
  create: async (data: { name: string; provider_type: string; config: PlatformFormConfig }) => {
    const response = await api.post('/ai/platforms', data)
    return response.data as AIPlatformResult
  },
  update: async (id: string, data: { name: string; config: PlatformFormConfig }) => {
    const response = await api.put(`/ai/platforms/${id}`, data)
    return response.data as { success: boolean; error?: string }
  },
  delete: async (id: string) => {
    const response = await api.delete(`/ai/platforms/${id}`)
    return response.data as { success: boolean; error?: string }
  },
  test: async (id: string) => {
    const response = await api.post(`/ai/platforms/${id}/test`)
    return response.data as { success: boolean; message?: string; error?: string }
  },
  setDefault: async (id: string) => {
    const response = await api.post(`/ai/platforms/${id}/default`)
    return response.data as { success: boolean; error?: string }
  },
}
