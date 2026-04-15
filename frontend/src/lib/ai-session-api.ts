import { apiClient as api } from './api'
import type { Message } from './ai-chat-api'

export interface AIChatSession {
  id: string
  user_id: number
  platform_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface AIChatSessionResult {
  success: boolean
  data?: AIChatSession | AIChatSession[]
  error?: string
}

export interface AIChatMessagesResult {
  success: boolean
  data?: Message[]
  error?: string
}

export const aiSessionAPI = {
  list: async () => {
    const response = await api.get('/ai/sessions')
    return response.data as { success: boolean; data?: AIChatSession[]; error?: string }
  },
  create: async (platformId: string, title?: string) => {
    const response = await api.post('/ai/sessions', { platform_id: platformId, title })
    return response.data as AIChatSessionResult
  },
  getMessages: async (id: string, limit?: number) => {
    const response = await api.get(`/ai/sessions/${id}/messages`, { params: limit ? { limit } : undefined })
    return response.data as AIChatMessagesResult
  },
  updatePlatform: async (id: string, platformId: string) => {
    const response = await api.put(`/ai/sessions/${id}/platform`, { platform_id: platformId })
    return response.data as { success: boolean; error?: string }
  },
  updateTitle: async (id: string, title: string) => {
    const response = await api.put(`/ai/sessions/${id}/title`, { title })
    return response.data as { success: boolean; error?: string }
  },
  clearMessages: async (id: string) => {
    const response = await api.delete(`/ai/sessions/${id}/messages`)
    return response.data as { success: boolean; error?: string }
  },
  delete: async (id: string) => {
    const response = await api.delete(`/ai/sessions/${id}`)
    return response.data as { success: boolean; error?: string }
  },
}
