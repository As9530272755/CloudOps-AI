import { apiClient as api } from './api'

export interface SiteConfig {
  platform_name: string
  platform_description: string
  logo_url: string
}

export interface SiteConfigResult {
  success: boolean
  data?: SiteConfig
  error?: string
}

export const settingAPI = {
  getSiteConfig: async () => {
    const response = await api.get('/settings/site')
    return response.data as SiteConfigResult
  },
  updateSiteConfig: async (data: SiteConfig) => {
    const response = await api.put('/settings/site', data)
    return response.data as SiteConfigResult
  },
  uploadLogo: async (file: File) => {
    const formData = new FormData()
    formData.append('logo', file)
    const response = await api.post('/settings/site/logo', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data as { success: boolean; data?: { logo_url: string }; error?: string }
  },
}
