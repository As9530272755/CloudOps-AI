
import { useSiteConfig } from '../../context/SiteConfigContext'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Box,
  Drawer,
  List,
  Typography,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Divider,
  useTheme,
  useMediaQuery,
  IconButton,
  AppBar,
  Toolbar,
  Tooltip,
  CircularProgress,
} from '@mui/material'

import {
  Dashboard as DashboardIcon,
  CloudQueue as ClusterIcon,
  Assessment as InspectionIcon,
  Storage as DataIcon,
  Article as LogsIcon,
  Psychology as AIIcon,
  Terminal as TerminalIcon,
  People as UsersIcon,
  Business as TenantsIcon,
  Settings as SettingsIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  Menu as MenuIcon,
  MenuOpen as MenuOpenIcon,
  DeviceHub as NetworkTraceIcon,
  Logout as LogoutIcon,
} from '@mui/icons-material'
import { useProfile } from '../../lib/api'
import { useColorMode } from '../../context/ColorModeContext'
import { usePermission } from '../../hooks/usePermission'
import { useState, useEffect } from 'react'
import { wsManager } from '../../lib/ws'

const DRAWER_WIDTH = 260

// 图标映射表
const iconMap: Record<string, React.ReactNode> = {
  dashboard: <DashboardIcon />,
  cluster: <ClusterIcon />,
  inspection: <InspectionIcon />,
  network: <NetworkTraceIcon />,
  data: <DataIcon />,
  logs: <LogsIcon />,
  terminal: <TerminalIcon />,
  ai: <AIIcon />,
  users: <UsersIcon />,
  tenants: <TenantsIcon />,
  settings: <SettingsIcon />,
}

export default function MainLayout() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'))
  const [open, setOpen] = useState(!isMobile)
  const navigate = useNavigate()
  const location = useLocation()
  const { data: user } = useProfile()
  const { mode, toggleColorMode } = useColorMode()
  const isDark = mode === 'dark'
  const { menus, isLoading: menusLoading } = usePermission()

  const handleDrawerToggle = () => setOpen(!open)

  const { config } = useSiteConfig()

  const handleNavigate = (path: string) => {
    navigate(path)
    if (isMobile) setOpen(false)
  }

  const [wsState, setWsState] = useState(wsManager.getConnectionState())
  useEffect(() => {
    return wsManager.onConnectionStateChange(setWsState)
  }, [])

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Logo */}
      <Box
        sx={{
          px: 3,
          py: 2.5,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        {config.logo_url ? (
          <Box
            component="img"
            src={config.logo_url}
            alt={config.platform_name}
            sx={{ width: 40, height: 40, borderRadius: '10px', objectFit: 'contain' }}
          />
        ) : (
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '10px',
              bgcolor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ClusterIcon sx={{ color: 'primary.contrastText', fontSize: 22 }} />
          </Box>
        )}
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.0625rem', letterSpacing: '-0.02em' }}>
            {config.platform_name || 'CloudOps'}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
            {config.platform_description || 'K8s 管理平台'}
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ mx: 3, borderColor: 'divider' }} />

      {/* Menu */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 2, px: 2 }}>
        {menusLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {menus.map((group) => (
          <Box key={group.group} sx={{ mb: 2 }}>
            <Typography
              variant="overline"
              sx={{
                px: 2,
                py: 0.75,
                display: 'block',
                color: 'text.secondary',
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.04em',
              }}
            >
              {group.group}
            </Typography>
            <List sx={{ p: 0 }}>
              {group.items.map((item) => {
                const selected =
                  location.pathname === item.path ||
                  (item.path !== '/' && location.pathname.startsWith(item.path))
                return (
                  <ListItem key={item.path} disablePadding sx={{ mb: 0.25 }}>
                    <ListItemButton
                      selected={selected}
                      onClick={() => handleNavigate(item.path)}
                      sx={{
                        py: 1,
                        px: 2,
                        borderRadius: '10px',
                        color: selected ? 'text.primary' : 'text.secondary',
                        bgcolor: selected ? 'action.selected' : 'transparent',
                        '&:hover': {
                          bgcolor: 'action.hover',
                        },
                      }}
                    >
                      <ListItemIcon
                        sx={{
                          minWidth: 34,
                          color: selected ? 'text.primary' : 'text.secondary',
                        }}
                      >
                        {iconMap[item.icon] || <DashboardIcon />}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{
                          fontSize: '0.875rem',
                          fontWeight: selected ? 600 : 500,
                        }}
                      />
                    </ListItemButton>
                  </ListItem>
                )
              })}
            </List>
          </Box>
        ))}
      </Box>

      <Divider sx={{ mx: 3, borderColor: 'divider' }} />

      {/* Bottom actions */}
      <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title={open ? '收起侧边栏' : '展开侧边栏'}>
          <IconButton
            onClick={handleDrawerToggle}
            sx={{
              flex: 1,
              justifyContent: 'center',
              borderRadius: '10px',
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'divider',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {open ? <MenuOpenIcon fontSize="small" /> : <MenuIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title={isDark ? '切换亮色模式' : '切换暗色模式'}>
          <IconButton
            onClick={toggleColorMode}
            sx={{
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '10px',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* User */}
      <Box sx={{ p: 2 }}>
        <Box
          sx={{
            p: 2,
            borderRadius: '12px',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: 'secondary.main',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            {user?.username?.[0]?.toUpperCase() || 'A'}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
              {user?.username || 'Admin'}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
              {user?.is_superuser ? '系统管理员' : '用户'}
            </Typography>
          </Box>
          <Tooltip title="退出登录">
            <IconButton
              size="small"
              onClick={() => {
                localStorage.removeItem('access_token')
                localStorage.removeItem('refresh_token')
                window.location.href = '/login'
              }}
              sx={{ color: 'text.secondary' }}
            >
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant={isMobile ? 'temporary' : 'persistent'}
        open={open}
        onClose={handleDrawerToggle}
        sx={{
          width: open ? DRAWER_WIDTH : 0,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
          },
        }}
      >
        {drawer}
      </Drawer>

      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          transition: theme.transitions.create('margin', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
        }}
      >
        <AppBar
          position="static"
          elevation={0}
          sx={{
            display: { xs: 'flex', lg: 'none' },
          }}
        >
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <IconButton edge="start" onClick={handleDrawerToggle} sx={{ color: 'text.primary' }}>
              <MenuIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        {!open && !isMobile && (
          <Box
            sx={{
              position: 'fixed',
              bottom: 16,
              left: 16,
              zIndex: 1300,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1,
              py: 0.5,
              borderRadius: '10px',
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
            }}
          >
            <Tooltip title={wsState === 'connected' ? '实时推送正常' : wsState === 'connecting' ? '连接中...' : '实时推送断开'}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: wsState === 'connected' ? '#4caf50' : wsState === 'connecting' ? '#ff9800' : '#f44336',
                  boxShadow: `0 0 6px ${wsState === 'connected' ? '#4caf50' : wsState === 'connecting' ? '#ff9800' : '#f44336'}`,
                  cursor: 'pointer',
                }}
              />
            </Tooltip>
            <Tooltip title="展开侧边栏">
              <IconButton onClick={handleDrawerToggle} sx={{ color: 'text.primary' }}>
                <MenuIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={isDark ? '切换亮色模式' : '切换暗色模式'}>
              <IconButton onClick={toggleColorMode} sx={{ color: 'text.primary' }}>
                {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        )}

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 0,
            minHeight: 'calc(100vh - 64px)',
            bgcolor: 'background.default',
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
