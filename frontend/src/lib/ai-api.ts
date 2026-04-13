import { apiClient as api } from './api'

export interface AIPlatformConfig {
  provider: 'openclaw' | 'ollama'
  openclaw: {
    url: string
    token: string
    model: string
  }
  ollama: {
    url: string
    model: string
  }
}

export interface AIConfigResult {
  success: boolean
  data?: AIPlatformConfig
  error?: string
}

export interface AITestResult {
  success: boolean
  message?: string
  error?: string
}

export const aiAPI = {
  // 获取 AI 平台配置
  getConfig: async () => {
    const response = await api.get('/settings/ai')
    return response.data as AIConfigResult
  },

  // 更新 AI 平台配置
  updateConfig: async (config: AIPlatformConfig) => {
    const response = await api.put('/settings/ai', config)
    return response.data as AIConfigResult
  },

  // 测试 AI 平台连通性
  testConnection: async () => {
    const response = await api.post('/settings/ai/test')
    return response.data as AITestResult
  },
}
