import { useState, useEffect } from 'react'
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Tabs,
  Tab,
  Checkbox,
  Snackbar,
  Alert,
  Tooltip,
  Divider,
  Grid,
} from '@mui/material'
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Lock as LockIcon,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import ConfirmDialog from '../components/ConfirmDialog'

// ============ 类型定义 ============

interface Role {
  id: number
  name: string
  display_name: string
  scope: string
  level: number
  permissions_data: string
}

interface User {
  id: number
  tenant_id: number
  username: string
  email: string
  is_active: boolean
  is_superuser: boolean
  roles?: Role[]
}

interface NamespaceGrant {
  id: number
  cluster_id: number
  namespace: string
  role_id: number
  role?: Role
  cluster?: { id: number; name: string; display_name?: string }
}

interface UserDetail {
  user: User
  namespace_grants: NamespaceGrant[]
  module_override: {
    enabled_modules: string
    disabled_modules: string
  }
}

interface Cluster {
  id: number
  name: string
  display_name?: string
}

// ============ 功能模块定义 ============

const moduleGroups = [
  {
    group: '概览',
    modules: [{ key: 'module:dashboard', label: '仪表盘' }],
  },
  {
    group: 'Kubernetes',
    modules: [
      { key: 'module:cluster:manage', label: '集群管理' },
      { key: 'module:inspection', label: '巡检中心' },
      { key: 'module:network:trace', label: '网络追踪' },
      { key: 'module:data:manage', label: '数据管理' },
    ],
  },
  {
    group: '运维',
    modules: [
      { key: 'module:log:manage', label: '日志管理' },
      { key: 'module:terminal', label: 'Web终端' },
    ],
  },
  {
    group: '智能',
    modules: [{ key: 'module:ai:assistant', label: 'AI助手' }],
  },
  {
    group: '系统',
    modules: [
      { key: 'module:system:user', label: '用户管理' },
      { key: 'module:system:tenant', label: '租户管理' },
      { key: 'module:system:settings', label: '系统设置' },
    ],
  },
]

// ============ 组件 ============

export default function Users() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [activeTab, setActiveTab] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })

  // 表单状态
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    tenant_id: 1,
    role_ids: [] as number[],
    is_active: true,
    enabled_modules: [] as string[],
    disabled_modules: [] as string[],
  })

  // NS 授权表单
  const [nsForm, setNsForm] = useState({
    cluster_id: 0,
    namespace: '',
    role_id: 0,
  })

  // 查询数据
  const { data: usersData, isLoading: usersLoading } = useQuery<{ data: User[] }>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await apiClient.get('/users')
      return res.data
    },
  })

  const { data: rolesData } = useQuery<{ data: Role[] }>({
    queryKey: ['roles'],
    queryFn: async () => {
      const res = await apiClient.get('/roles')
      return res.data
    },
  })

  const { data: clustersData } = useQuery<{ data: Cluster[] }>({
    queryKey: ['clusters'],
    queryFn: async () => {
      const res = await apiClient.get('/clusters')
      return res.data
    },
  })

  const { data: userDetail } = useQuery<{ data: UserDetail }>({
    queryKey: ['user-detail', editingUser?.id],
    queryFn: async () => {
      if (!editingUser) return { data: { user: editingUser, namespace_grants: [], module_override: { enabled_modules: '', disabled_modules: '' } } }
      const res = await apiClient.get(`/users/${editingUser.id}`)
      return res.data
    },
    enabled: !!editingUser && dialogOpen,
  })

  const roles = rolesData?.data || []
  const users = usersData?.data || []
  const clusters = clustersData?.data || []
  const detail = userDetail?.data

  // 创建用户
  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.post('/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      closeDialog()
      setSnack({ open: true, message: '用户创建成功', severity: 'success' })
    },
    onError: (err: any) => {
      setSnack({ open: true, message: err.response?.data?.error || '创建失败', severity: 'error' })
    },
  })

  // 更新用户
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiClient.put(`/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      closeDialog()
      setSnack({ open: true, message: '用户更新成功', severity: 'success' })
    },
    onError: (err: any) => {
      setSnack({ open: true, message: err.response?.data?.error || '更新失败', severity: 'error' })
    },
  })

  // 删除用户
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setSnack({ open: true, message: '用户删除成功', severity: 'success' })
    },
    onError: (err: any) => {
      setSnack({ open: true, message: err.response?.data?.error || '删除失败', severity: 'error' })
    },
  })

  // NS 授权
  const grantNsMutation = useMutation({
    mutationFn: (data: any) => apiClient.post('/namespace-grants', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-detail', editingUser?.id] })
      setNsForm({ cluster_id: 0, namespace: '', role_id: 0 })
      setSnack({ open: true, message: '授权成功', severity: 'success' })
    },
    onError: (err: any) => {
      setSnack({ open: true, message: err.response?.data?.error || '授权失败', severity: 'error' })
    },
  })

  const revokeNsMutation = useMutation({
    mutationFn: (grantId: number) => apiClient.delete(`/namespace-grants/${grantId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-detail', editingUser?.id] })
      setSnack({ open: true, message: '撤销授权成功', severity: 'success' })
    },
  })

  // 初始化表单
  useEffect(() => {
    if (dialogOpen && editingUser && detail) {
      const override = detail.module_override || { enabled_modules: '[]', disabled_modules: '[]' }
      let enabled: string[] = []
      let disabled: string[] = []
      try { enabled = JSON.parse(override.enabled_modules || '[]') } catch {}
      try { disabled = JSON.parse(override.disabled_modules || '[]') } catch {}

      setForm({
        username: editingUser.username,
        email: editingUser.email,
        password: '',
        tenant_id: editingUser.tenant_id,
        role_ids: editingUser.roles?.map(r => r.id) || [],
        is_active: editingUser.is_active,
        enabled_modules: enabled,
        disabled_modules: disabled,
      })
    } else if (dialogOpen && !editingUser) {
      setForm({
        username: '',
        email: '',
        password: '',
        tenant_id: 1,
        role_ids: [],
        is_active: true,
        enabled_modules: [],
        disabled_modules: [],
      })
    }
  }, [dialogOpen, editingUser, detail])

  const openCreate = () => {
    setEditingUser(null)
    setActiveTab(0)
    setDialogOpen(true)
  }

  const openEdit = (user: User) => {
    setEditingUser(user)
    setActiveTab(0)
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setEditingUser(null)
    setActiveTab(0)
  }

  const handleSave = () => {
    const data = {
      username: form.username,
      email: form.email,
      tenant_id: form.tenant_id,
      role_ids: form.role_ids,
      is_active: form.is_active,
      enabled_modules: form.enabled_modules,
      disabled_modules: form.disabled_modules,
    }
    if (!editingUser) {
      if (!form.password) {
        setSnack({ open: true, message: '密码不能为空', severity: 'error' })
        return
      }
      createMutation.mutate({ ...data, password: form.password })
    } else {
      const updateData: any = { ...data }
      if (form.password) updateData.password = form.password
      updateMutation.mutate({ id: editingUser.id, data: updateData })
    }
  }

  const handleDelete = (id: number) => {
    setDeleteId(id)
    setConfirmOpen(true)
  }

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId)
      setConfirmOpen(false)
      setDeleteId(null)
    }
  }

  const toggleModule = (key: string, enabled: boolean) => {
    if (enabled) {
      setForm(prev => ({
        ...prev,
        enabled_modules: [...prev.enabled_modules.filter(m => m !== key), key],
        disabled_modules: prev.disabled_modules.filter(m => m !== key),
      }))
    } else {
      setForm(prev => ({
        ...prev,
        enabled_modules: prev.enabled_modules.filter(m => m !== key),
        disabled_modules: [...prev.disabled_modules.filter(m => m !== key), key],
      }))
    }
  }

  const getRolePermissions = (roleIds: number[]): string[] => {
    const perms = new Set<string>()
    roleIds.forEach(rid => {
      const role = roles.find(r => r.id === rid)
      if (role?.permissions_data) {
        try {
          const list = JSON.parse(role.permissions_data)
          list.forEach((p: string) => perms.add(p))
        } catch {}
      }
    })
    return Array.from(perms)
  }

  const basePermissions = getRolePermissions(form.role_ids)
  const isModuleEnabled = (key: string) => {
    if (form.enabled_modules.includes(key)) return true
    if (form.disabled_modules.includes(key)) return false
    return basePermissions.includes(key) || basePermissions.includes('*:*')
  }

  const handleGrantNs = () => {
    if (!editingUser || !nsForm.cluster_id || !nsForm.namespace || !nsForm.role_id) {
      setSnack({ open: true, message: '请填写完整信息', severity: 'error' })
      return
    }
    grantNsMutation.mutate({
      user_id: editingUser.id,
      cluster_id: nsForm.cluster_id,
      namespace: nsForm.namespace,
      role_id: nsForm.role_id,
    })
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" fontWeight={600} gutterBottom>
            用户管理
          </Typography>
          <Typography variant="body2" color="text.secondary">
            管理系统用户、角色分配和命名空间权限
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          添加用户
        </Button>
      </Box>

      <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell>ID</TableCell>
              <TableCell>用户名</TableCell>
              <TableCell>邮箱</TableCell>
              <TableCell>角色</TableCell>
              <TableCell>状态</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {usersLoading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  加载中...
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  暂无用户
                </TableCell>
              </TableRow>
            ) : (
              users.map(user => (
                <TableRow key={user.id} hover>
                  <TableCell>{user.id}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {user.username}
                      {user.is_superuser && (
                        <Chip size="small" color="primary" label="Superuser" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {user.roles?.map(role => (
                        <Chip
                          key={role.id}
                          size="small"
                          label={role.display_name}
                          color={role.scope === 'platform' ? 'error' : role.scope === 'cluster' ? 'warning' : 'default'}
                        />
                      )) || '-'}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={user.is_active ? '启用' : '禁用'}
                      color={user.is_active ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="编辑">
                      <IconButton size="small" onClick={() => openEdit(user)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="重置密码">
                      <IconButton size="small" onClick={() => openEdit(user)}>
                        <LockIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除">
                      <IconButton size="small" color="error" onClick={() => handleDelete(user.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 添加/编辑弹窗 */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle>{editingUser ? `编辑用户: ${editingUser.username}` : '添加用户'}</DialogTitle>
        <DialogContent sx={{ minHeight: 400 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 2 }}>
            <Tab label="基本信息" />
            <Tab label="功能模块权限" />
            {editingUser && <Tab label="命名空间授权" />}
          </Tabs>

          {activeTab === 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <TextField
                label="用户名"
                value={form.username}
                onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
                disabled={!!editingUser}
                fullWidth
              />
              <TextField
                label="邮箱"
                value={form.email}
                onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                fullWidth
              />
              <TextField
                label={editingUser ? '密码 (留空则不修改)' : '密码'}
                type="password"
                value={form.password}
                onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                fullWidth
              />
              <FormControl fullWidth>
                <InputLabel>角色</InputLabel>
                <Select
                  multiple
                  value={form.role_ids}
                  onChange={e => setForm(prev => ({ ...prev, role_ids: e.target.value as number[] }))}
                  renderValue={selected => (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {(selected as number[]).map(id => {
                        const role = roles.find(r => r.id === id)
                        return <Chip key={id} size="small" label={role?.display_name || id} />
                      })}
                    </Box>
                  )}
                >
                  {roles.map(role => (
                    <MenuItem key={role.id} value={role.id}>
                      {role.display_name} ({role.scope} / level {role.level})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_active}
                    onChange={e => setForm(prev => ({ ...prev, is_active: e.target.checked }))}
                  />
                }
                label={form.is_active ? '启用' : '禁用'}
              />
            </Box>
          )}

          {activeTab === 1 && (
            <Box sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                基于角色默认权限，可单独调整每个功能模块的访问权限
              </Typography>
              {moduleGroups.map(group => (
                <Box key={group.group} sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    {group.group}
                  </Typography>
                  <Grid container spacing={1}>
                    {group.modules.map(mod => {
                      const enabled = isModuleEnabled(mod.key)
                      const isBase = basePermissions.includes(mod.key) || basePermissions.includes('*:*')
                      return (
                        <Grid item xs={6} sm={4} md={3} key={mod.key}>
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1,
                              p: 1,
                              borderRadius: 1,
                              bgcolor: isBase ? 'action.hover' : 'transparent',
                            }}
                          >
                            <Checkbox
                              checked={enabled}
                              onChange={e => toggleModule(mod.key, e.target.checked)}
                              size="small"
                            />
                            <Typography variant="body2">{mod.label}</Typography>
                            {isBase && (
                              <Chip size="small" label="默认" variant="outlined" sx={{ height: 20, fontSize: '0.625rem' }} />
                            )}
                          </Box>
                        </Grid>
                      )
                    })}
                  </Grid>
                </Box>
              ))}
            </Box>
          )}

          {activeTab === 2 && editingUser && (
            <Box sx={{ pt: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                添加命名空间授权
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'flex-end' }}>
                <FormControl sx={{ minWidth: 180 }}>
                  <InputLabel>集群</InputLabel>
                  <Select
                    value={nsForm.cluster_id}
                    onChange={e => setNsForm(prev => ({ ...prev, cluster_id: e.target.value as number }))}
                  >
                    {clusters.map(c => (
                      <MenuItem key={c.id} value={c.id}>{c.display_name || c.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="命名空间"
                  value={nsForm.namespace}
                  onChange={e => setNsForm(prev => ({ ...prev, namespace: e.target.value }))}
                  sx={{ minWidth: 150 }}
                />
                <FormControl sx={{ minWidth: 150 }}>
                  <InputLabel>角色</InputLabel>
                  <Select
                    value={nsForm.role_id}
                    onChange={e => setNsForm(prev => ({ ...prev, role_id: e.target.value as number }))}
                  >
                    {roles.filter(r => r.scope === 'namespace').map(r => (
                      <MenuItem key={r.id} value={r.id}>{r.display_name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button variant="contained" onClick={handleGrantNs} size="small">
                  授权
                </Button>
              </Box>

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                当前授权
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>集群</TableCell>
                      <TableCell>命名空间</TableCell>
                      <TableCell>角色</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail?.namespace_grants?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary' }}>
                          暂无命名空间授权
                        </TableCell>
                      </TableRow>
                    )}
                    {detail?.namespace_grants?.map(grant => (
                      <TableRow key={grant.id}>
                        <TableCell>{grant.cluster?.display_name || grant.cluster?.name || grant.cluster_id}</TableCell>
                        <TableCell>{grant.namespace}</TableCell>
                        <TableCell>
                          <Chip size="small" label={grant.role?.display_name || grant.role_id} />
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            color="error"
                            onClick={() => revokeNsMutation.mutate(grant.id)}
                          >
                            撤销
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>取消</Button>
          <Button variant="contained" onClick={handleSave}>
            {editingUser ? '保存' : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="删除用户"
        message="确定要删除该用户吗？此操作不可恢复。"
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmDelete}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity={snack.severity} onClose={() => setSnack(prev => ({ ...prev, open: false }))}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
