import axios from 'axios'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// API 基础 URL
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

// 创建 axios 实例
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器 - 添加 Token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器 - 处理 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ==================== 认证 API ====================

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  success: boolean
  message: string
  data: {
    access_token: string
    refresh_token: string
    token_type: string
    expires_in: number
    user: {
      id: number
      username: string
      email: string
      is_superuser: boolean
      tenant_id: number
    }
  }
}

export interface User {
  id: number
  username: string
  email: string
  is_superuser: boolean
  tenant_id: number
  roles?: string[]
}

// 登录
export const login = async (data: LoginRequest): Promise<LoginResponse> => {
  const response = await apiClient.post<LoginResponse>('/auth/login', data)
  return response.data
}

// 登出
export const logout = async (): Promise<void> => {
  await apiClient.post('/auth/logout')
}

// 获取用户信息
export const getProfile = async (): Promise<{ success: boolean; data: User }> => {
  const response = await apiClient.get('/auth/profile')
  return response.data
}

// ==================== 集群 API ====================

export interface Cluster {
  id: number
  name: string
  display_name: string
  description: string
  auth_type: string
  server: string
  is_active: boolean
  health_status: string
  node_count: number
  pod_count: number
  namespace_count: number
  version: string
}

// 获取集群列表
export const getClusters = async (): Promise<{ success: boolean; data: { clusters: Cluster[] } }> => {
  const response = await apiClient.get('/clusters')
  return response.data
}

// 获取集群详情
export const getCluster = async (id: number): Promise<{ success: boolean; data: Cluster }> => {
  const response = await apiClient.get(`/clusters/${id}`)
  return response.data
}

// ==================== React Query Hooks ====================

export const useLogin = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      if (data.success) {
        localStorage.setItem('access_token', data.data.access_token)
        localStorage.setItem('refresh_token', data.data.refresh_token)
        queryClient.setQueryData(['user'], data.data.user)
      }
    },
  })
}

export const useLogout = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      queryClient.clear()
      window.location.href = '/login'
    },
  })
}

export const useProfile = () => {
  return useQuery({
    queryKey: ['user'],
    queryFn: getProfile,
    enabled: !!localStorage.getItem('access_token'),
    select: (data) => data.data,
  })
}

export const useClusters = () => {
  return useQuery({
    queryKey: ['clusters'],
    queryFn: getClusters,
    select: (data) => data.data.clusters,
  })
}