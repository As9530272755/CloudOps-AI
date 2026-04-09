import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  useTheme,
  useMediaQuery,
  alpha,
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
  Logout as LogoutIcon,
  ChevronLeft as ChevronLeftIcon,
  Menu as MenuIcon,
  Notifications as NotificationsIcon,
  Search as SearchIcon,
} from '@mui/icons-material'
import { useLogout, useProfile } from '../../lib/api'
import { glassEffect, glassEffectDark } from '../../theme/theme'

const DRAWER_WIDTH = 280

const menuItems = [
  { path: '/', label: '仪表盘', icon: <DashboardIcon />, group: '概览' },
  { path: '/clusters', label: '集群管理', icon: <ClusterIcon />, group: 'Kubernetes' },
  { path: '/inspection', label: '巡检中心', icon: <InspectionIcon />, group: 'Kubernetes' },
  { path: '/data', label: '数据管理', icon: <DataIcon />, group: 'Kubernetes' },
  { path: '/logs', label: '日志管理', icon: <LogsIcon />, group: '运维' },
  { path: '/terminal', label: 'Web终端', icon: <TerminalIcon />, group: '运维' },
  { path: '/ai', label: 'AI助手', icon: <AIIcon />, group: '智能' },
  { path: '/users', label: '用户管理', icon: <UsersIcon />, group: '系统' },
  { path: '/tenants', label: '租户管理', icon: <TenantsIcon />, group: '系统' },
  { path: '/settings', label: '系统设置', icon: <SettingsIcon />, group: '系统' },
]

export default function MainLayout() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'))
  const [open, setOpen] = useState(!isMobile)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { data: user } = useProfile()
  const logoutMutation = useLogout()

  const handleDrawerToggle = () => setOpen(!open)
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)
  const handleMenuClose = () => setAnchorEl(null)
  
  const handleLogout = () => {
    handleMenuClose()
    logoutMutation.mutate()
  }

  const handleNavigate = (path: string) => {
    navigate(path)
    if (isMobile) setOpen(false)
  }

  const currentGroup = (path: string) => {
    const item = menuItems.find(m => m.path === path || (path !== '/' && path.startsWith(m.path)))
    return item?.group
  }

  // 分组菜单
  const groupedItems = menuItems.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {} as Record<string, typeof menuItems>)

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Logo 区域 */}
      <Box
        sx={{
          p: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0, 122, 255, 0.3)',
          }}
        >
          <ClusterIcon sx={{ color: '#FFFFFF', fontSize: 24 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              fontSize: '1.125rem',
              background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            CloudOps
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
            K8s 管理平台 v2.0
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ mx: 2, opacity: 0.5 }} />

      {/* 菜单列表 */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 2 }}>
        {Object.entries(groupedItems).map(([group, items]) => (
          <Box key={group} sx={{ mb: 2 }}>
            <Typography
              variant="caption"
              sx={{
                px: 3,
                py: 1,
                display: 'block',
                color: 'text.secondary',
                fontWeight: 600,
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {group}
            </Typography>
            <List sx={{ px: 1 }}>
              {items.map((item) => (
                <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    selected={
                      location.pathname === item.path ||
                      (item.path !== '/' && location.pathname.startsWith(item.path))
                    }
                    onClick={() => handleNavigate(item.path)}
                    sx={{
                      borderRadius: '12px',
                      py: 1.25,
                      px: 2,
                      transition: 'all 0.2s ease',
                      '&.Mui-selected': {
                        background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
                        color: '#FFFFFF',
                        boxShadow: '0 4px 12px rgba(0, 122, 255, 0.3)',
                        '& .MuiListItemIcon-root': {
                          color: '#FFFFFF',
                        },
                        '&:hover': {
                          background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
                        },
                      },
                      '&:hover': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.08),
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 40,
                        color:
                          location.pathname === item.path ||
                          (item.path !== '/' && location.pathname.startsWith(item.path))
                            ? '#FFFFFF'
                            : theme.palette.primary.main,
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontSize: '0.9375rem',
                        fontWeight: 500,
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>
        ))}
      </Box>

      {/* 用户信息 */}
      <Box
        sx={{
          p: 2,
          m: 2,
          borderRadius: '16px',
          background: alpha(theme.palette.primary.main, 0.05),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar
            sx={{
              width: 40,
              height: 40,
              background: 'linear-gradient(135deg, #5856D6 0%, #AF52DE 100%)',
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            {user?.username?.[0]?.toUpperCase() || 'A'}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="body2"
              noWrap
              sx={{ fontWeight: 600, fontSize: '0.9375rem' }}
            >
              {user?.username || 'Admin'}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', fontSize: '0.75rem' }}
            >
              {user?.is_superuser ? '系统管理员' : '用户'}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* 侧边栏 */}
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={open}
        onClose={handleDrawerToggle}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            ...glassEffect,
            borderRight: 'none',
          },
        }}
      >
        {drawer}
      </Drawer>

      {/* 主内容区 */}
      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          
          transition: theme.transitions.create('margin', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
        }}
      >
        {/* 顶部栏 */}
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            ...glassEffect,
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
          }}
        >
          <Toolbar sx={{ gap: 2, px: 3 }}>
            {/* 移动端菜单按钮 */}
            {isMobile && (
              <IconButton
                edge="start"
                onClick={handleDrawerToggle}
                sx={{
                  color: 'text.primary',
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                  },
                }}
              >
                <MenuIcon />
              </IconButton>
            )}

            {/* 搜索按钮 */}
            <IconButton
              sx={{
                color: 'text.secondary',
                bgcolor: alpha(theme.palette.primary.main, 0.05),
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                },
              }}
            >
              <SearchIcon />
            </IconButton>

            {/* 通知按钮 */}
            <IconButton
              sx={{
                color: 'text.secondary',
                bgcolor: alpha(theme.palette.primary.main, 0.05),
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                },
              }}
            >
              <NotificationsIcon />
            </IconButton>

            {/* 用户菜单 */}
            <IconButton onClick={handleMenuOpen}>
              <Avatar
                sx={{
                  width: 36,
                  height: 36,
                  background: 'linear-gradient(135deg, #5856D6 0%, #AF52DE 100%)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                }}
              >
                {user?.username?.[0]?.toUpperCase() || 'A'}
              </Avatar>
            </IconButton>

            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              PaperProps={{
                sx: {
                  ...glassEffect,
                  minWidth: 200,
                  mt: 1,
                },
              }}
            >
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="body2" fontWeight={600}>
                  {user?.username || 'Admin'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user?.email || 'admin@cloudops.local'}
                </Typography>
              </Box>
              <Divider />
              <MenuItem onClick={handleLogout} sx={{ py: 1.5 }}>
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>退出登录</ListItemText>
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        {/* 内容区 - 无缝填充满 */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 0,
            minHeight: 'calc(100vh - 64px)',
            bgcolor: 'transparent',
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}