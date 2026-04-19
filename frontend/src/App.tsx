import { Routes, Route, Navigate } from 'react-router-dom'
import { Box, CircularProgress, Typography } from '@mui/material'
import { useAuth } from './hooks/useAuth'
import { usePermission } from './hooks/usePermission'
import MainLayout from './components/layout/MainLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Clusters from './pages/Clusters'
import ClusterDetail from './pages/ClusterDetail'
import Inspection from './pages/Inspection'
import Data from './pages/Data'
import Logs from './pages/Logs'
import NetworkTrace from './pages/NetworkTrace'
import AI from './pages/AI'
import Terminal from './pages/Terminal'
import Users from './pages/Users'
import Tenants from './pages/Tenants'
import Settings from './pages/Settings'

// 受保护的路由
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

// 403 页面
function ForbiddenPage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
      <Typography variant="h1" sx={{ fontSize: '6rem', fontWeight: 700, color: 'text.secondary' }}>
        403
      </Typography>
      <Typography variant="h6" sx={{ mt: 2, color: 'text.secondary' }}>
        您没有访问该页面的权限
      </Typography>
      <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
        请联系管理员为您开通相应权限
      </Typography>
    </Box>
  )
}

// 基于模块权限的路由守卫
function ModuleRoute({ module, children }: { module: string; children: React.ReactNode }) {
  const { hasModule, isLoading } = usePermission()

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!hasModule(module)) {
    return <ForbiddenPage />
  }

  return <>{children}</>
}

function App() {
  return (
    <Routes>
      {/* 登录页 */}
      <Route path="/login" element={<Login />} />
      
      {/* 受保护的路由 */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="clusters" element={<ModuleRoute module="module:cluster:manage"><Clusters /></ModuleRoute>} />
        <Route path="clusters/:clusterId" element={<ModuleRoute module="module:cluster:manage"><ClusterDetail /></ModuleRoute>} />
        <Route path="clusters/:clusterId/*" element={<ModuleRoute module="module:cluster:manage"><ClusterDetail /></ModuleRoute>} />
        <Route path="inspection" element={<ModuleRoute module="module:inspection"><Inspection /></ModuleRoute>} />
        <Route path="data" element={<ModuleRoute module="module:data:manage"><Data /></ModuleRoute>} />
        <Route path="logs" element={<ModuleRoute module="module:log:manage"><Logs /></ModuleRoute>} />
        <Route path="network-trace" element={<ModuleRoute module="module:network:trace"><NetworkTrace /></ModuleRoute>} />
        <Route path="ai" element={<ModuleRoute module="module:ai:assistant"><AI /></ModuleRoute>} />
        <Route path="terminal" element={<ModuleRoute module="module:terminal"><Terminal /></ModuleRoute>} />
        <Route path="users" element={<ModuleRoute module="module:system:user"><Users /></ModuleRoute>} />
        <Route path="tenants" element={<ModuleRoute module="module:system:tenant"><Tenants /></ModuleRoute>} />
        <Route path="settings" element={<ModuleRoute module="module:system:settings"><Settings /></ModuleRoute>} />
      </Route>

      {/* 404 重定向 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App