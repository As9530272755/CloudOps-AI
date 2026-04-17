import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Avatar,
} from '@mui/material'
import { CloudQueue as CloudIcon } from '@mui/icons-material'
import { useLogin } from '../lib/api'
import { useSiteConfig } from '../context/SiteConfigContext'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const loginMutation = useLogin()
  const { config } = useSiteConfig()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username || !password) {
      setError('请输入用户名和密码')
      return
    }

    try {
      const result = await loginMutation.mutateAsync({ username, password })
      if (result.success) {
        navigate('/')
      } else {
        setError(result.message || '登录失败')
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '登录失败，请稍后重试')
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: 2,
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth: 400,
          borderRadius: '16px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.06)',
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            {config.logo_url ? (
              <Box
                component="img"
                src={config.logo_url}
                alt={config.platform_name}
                sx={{ width: 64, height: 64, mx: 'auto', mb: 2, borderRadius: '12px', objectFit: 'contain' }}
              />
            ) : (
              <Avatar
                sx={{
                  width: 64,
                  height: 64,
                  mx: 'auto',
                  mb: 2,
                  bgcolor: 'primary.main',
                }}
              >
                <CloudIcon sx={{ fontSize: 32, color: 'primary.contrastText' }} />
              </Avatar>
            )}
            <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
              {config.platform_name || 'CloudOps'}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
              {config.platform_description || '云原生运维管理平台'}
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="用户名"
              variant="outlined"
              margin="normal"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              disabled={loginMutation.isPending}
            />
            <TextField
              fullWidth
              label="密码"
              type="password"
              variant="outlined"
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loginMutation.isPending}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={loginMutation.isPending}
              sx={{ mt: 3, mb: 2, py: 1.5, fontSize: '1rem' }}
            >
              {loginMutation.isPending ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                '登 录'
              )}
            </Button>
          </Box>

          <Box
            sx={{
              mt: 3,
              p: 2,
              borderRadius: '10px',
              bgcolor: 'action.hover',
            }}
          >
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                textAlign: 'center',
                color: 'text.secondary',
              }}
            >
              默认账号: admin / admin
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
