import { Routes, Route, Navigate } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from './hooks/useAuth'
import MainLayout from './components/layout/MainLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Clusters from './pages/Clusters'
import Inspection from './pages/Inspection'
import Data from './pages/Data'
import Logs from './pages/Logs'
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
        <Route path="clusters" element={<Clusters />} />
        <Route path="clusters/:clusterId/*" element={<Clusters />} />
        <Route path="inspection" element={<Inspection />} />
        <Route path="data" element={<Data />} />
        <Route path="logs" element={<Logs />} />
        <Route path="ai" element={<AI />} />
        <Route path="terminal" element={<Terminal />} />
        <Route path="users" element={<Users />} />
        <Route path="tenants" element={<Tenants />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* 404 重定向 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App