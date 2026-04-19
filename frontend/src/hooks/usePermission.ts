import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/api'

export interface MenuItem {
  path: string
  label: string
  icon: string
}

export interface MenuGroup {
  group: string
  items: MenuItem[]
}

export function usePermission() {
  const { data: menuData, isLoading: menusLoading } = useQuery<{ data: MenuGroup[] }>({
    queryKey: ['user-menus'],
    queryFn: async () => {
      const res = await apiClient.get('/users/me/menus')
      return res.data
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: permData, isLoading: permsLoading } = useQuery<{ data: { permissions: string[]; modules: string[]; ai: string[] } }>({
    queryKey: ['user-permissions'],
    queryFn: async () => {
      const res = await apiClient.get('/users/me/permissions')
      return res.data
    },
    staleTime: 5 * 60 * 1000,
  })

  const menus = menuData?.data || []
  const permissions = permData?.data?.permissions || []
  const modules = permData?.data?.modules || []
  const aiPermissions = permData?.data?.ai || []

  const hasModule = (module: string): boolean => {
    if (modules.includes('*:*')) return true
    return modules.includes(module)
  }

  const hasPermission = (perm: string): boolean => {
    if (permissions.includes('*:*')) return true
    return permissions.includes(perm)
  }

  const hasAIPermission = (perm: string): boolean => {
    if (aiPermissions.includes('*:*')) return true
    return aiPermissions.includes(perm)
  }

  return {
    menus,
    permissions,
    modules,
    aiPermissions,
    isLoading: menusLoading || permsLoading,
    hasModule,
    hasPermission,
    hasAIPermission,
  }
}
