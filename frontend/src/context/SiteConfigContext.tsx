import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { settingAPI, SiteConfig } from '../lib/setting-api'

interface SiteConfigContextValue {
  config: SiteConfig
  loading: boolean
  refresh: () => Promise<void>
}

const defaultConfig: SiteConfig = {
  platform_name: 'CloudOps',
  platform_description: '云原生运维管理平台',
  logo_url: '',
}

const SiteConfigContext = createContext<SiteConfigContextValue>({
  config: defaultConfig,
  loading: true,
  refresh: async () => {},
})

export const useSiteConfig = () => useContext(SiteConfigContext)

export const SiteConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<SiteConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await settingAPI.getSiteConfig()
      if (res.success && res.data) {
        setConfig(res.data)
        document.title = res.data.platform_name || 'CloudOps'
      }
    } catch (err) {
      console.error('加载站点配置失败', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <SiteConfigContext.Provider value={{ config, loading, refresh }}>
      {children}
    </SiteConfigContext.Provider>
  )
}
