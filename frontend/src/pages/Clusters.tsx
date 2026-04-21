import React from 'react'
import { useState, useEffect, useMemo } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Autocomplete,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormLabel,

} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  CloudQueue as ClusterIcon,
  ArrowForward as EnterIcon,
  Search as SearchIcon,
} from '@mui/icons-material'

import { clusterAPI, Cluster, ClusterListParams, CreateClusterRequest, UpdateClusterRequest, TestAndProbeResult } from '../lib/cluster-api'
import { k8sAPI, SearchResourceItem, resourceLabels, resourceCategories } from '../lib/k8s-api'
import { wsManager, ResourceChangeMessage } from '../lib/ws'
import ConfirmDialog from '../components/ConfirmDialog'
import { usePermission } from '../hooks/usePermission'

// 全局搜索资源类别映射（业务功能分类）
const searchCategoryMap: Record<string, { label: string; resources: string[] }> = {
  '': { label: '全部', resources: [] },
  'loadbalance': { label: '负载均衡', resources: ['services', 'ingresses'] },
  'workloads': { label: '工作负载', resources: ['pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs', 'horizontalpodautoscalers', 'poddisruptionbudgets', 'replicationcontrollers'] },
  'network': { label: '网络', resources: ['endpoints', 'networkpolicies', 'endpointslices'] },
  'storage': { label: '存储', resources: ['persistentvolumes', 'persistentvolumeclaims', 'storageclasses'] },
  'config': { label: '配置', resources: ['configmaps', 'secrets', 'serviceaccounts', 'limitranges', 'resourcequotas', 'leases'] },
  'rbac': { label: '访问控制', resources: ['roles', 'rolebindings', 'clusterroles', 'clusterrolebindings'] },
  'nodes': { label: '节点', resources: ['nodes'] },
  'namespaces': { label: '命名空间', resources: ['namespaces'] },
  'events': { label: '事件', resources: ['events'] },
  'custom': { label: '自定义资源', resources: ['customresourcedefinitions', 'servicemonitors'] },
}

// 状态颜色映射（连接状态）
const statusColors: Record<string, 'success' | 'error' | 'default'> = {
  healthy: 'success',
  unhealthy: 'error',
  offline: 'error',
  pending: 'default',
}

const statusLabels: Record<string, string> = {
  healthy: '正常',
  unhealthy: '不健康',
  offline: '离线',
  pending: '检测中',
}

const SearchListbox = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  function SearchListbox(props, ref) {
    return (
      <Box component="ul" ref={ref} {...props}>
        <Box
          component="li"
          sx={{
            position: 'sticky',
            top: 0,
            bgcolor: 'background.paper',
            zIndex: 1,
            px: 1.5,
            py: 0.75,
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pointerEvents: 'none',
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 140, color: 'text.secondary' }}>名称</Typography>
          <Typography variant="caption" sx={{ fontWeight: 600, width: 70, color: 'text.secondary' }}>资源</Typography>
          <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 80, color: 'text.secondary' }}>NS</Typography>
          <Typography variant="caption" sx={{ fontWeight: 600, flex: 1, textAlign: 'right', color: 'text.secondary' }}>集群</Typography>
        </Box>
        {props.children}
      </Box>
    )
  }
)

export default function Clusters() {
  const navigate = useNavigate()
  const { permissions, modules } = usePermission()
  const isPlatformAdmin = permissions.includes('*:*') || modules.includes('*:*')
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(false)
  const [openDialog, setOpenDialog] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [authType, setAuthType] = useState<'kubeconfig' | 'token'>('kubeconfig')
  const [formData, setFormData] = useState<CreateClusterRequest>({
    name: '',
    display_name: '',
    description: '',
    auth_type: 'kubeconfig',
    cluster_label_name: 'cluster',
    cluster_label_value: '',
    kubeconfig: '',
    token: '',
    server: '',
  })
  const [probeOpen, setProbeOpen] = useState(false)
  const [probeLoading, setProbeLoading] = useState(false)
  const [probeResult, setProbeResult] = useState<TestAndProbeResult | null>(null)
  const [selectedProbeLabel, setSelectedProbeLabel] = useState('')
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<ClusterListParams>({
    keyword: '',
    status: '',
    auth_type: '',
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOptions, setSearchOptions] = useState<SearchResourceItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchCategoryFilter, setSearchCategoryFilter] = useState('')
  const [searchKindFilter, setSearchKindFilter] = useState('')
  const [searchNsFilter, setSearchNsFilter] = useState('')
  const [searchClusterFilter, setSearchClusterFilter] = useState<number | ''>('')
  const [searchLabelFilter, setSearchLabelFilter] = useState('')

  // 从搜索结果中提取唯一的命名空间列表（用于下拉筛选）
  const searchNamespaces = useMemo(() => {
    const set = new Set<string>()
    searchOptions.forEach((o) => {
      if (o.namespace && o.namespace !== '-') {
        set.add(o.namespace)
      }
    })
    return Array.from(set).sort()
  }, [searchOptions])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchOptions([])
      return
    }
    const timer = setTimeout(() => {
      setSearchLoading(true)
      // 构建 kind 参数：优先用具体资源类型，其次用资源类别下的所有 kind
      let kindParam = searchKindFilter
      if (!kindParam && searchCategoryFilter) {
        kindParam = searchCategoryMap[searchCategoryFilter].resources.join(',')
      }
      k8sAPI.searchResources(
        searchQuery,
        50,
        kindParam,
        searchNsFilter,
        searchClusterFilter,
        searchLabelFilter
      )
        .then((res) => {
          if (res.success && res.data) {
            setSearchOptions(res.data)
          }
        })
        .catch(() => setSearchOptions([]))
        .finally(() => setSearchLoading(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, searchKindFilter, searchCategoryFilter, searchNsFilter, searchClusterFilter, searchLabelFilter])

  // 加载集群列表
  const loadClusters = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params: ClusterListParams = {}
      if (filters.status) params.status = filters.status
      if (filters.auth_type) params.auth_type = filters.auth_type

      const result = await clusterAPI.getClusters(params)
      if (result.success) {
        setClusters(result.data)
      }
    } catch (err: any) {
      setError(err.message || '加载集群列表失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadClusters()

    // WebSocket 订阅集群状态变化（监听所有集群）
    wsManager.subscribe(null, null)
    const unsubscribe = wsManager.onMessage((msg: ResourceChangeMessage) => {
      if (msg.type === 'cluster_status_change') {
        setClusters((prev) =>
          prev.map((c) =>
            c.id === msg.cluster_id
              ? {
                  ...c,
                  metadata: {
                    ...c.metadata,
                    health_status: msg.status,
                  },
                }
              : c
          )
        )
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const resetForm = () => {
    setEditingId(null)
    setAuthType('kubeconfig')
    setFormData({
      name: '',
      display_name: '',
      description: '',
      auth_type: 'kubeconfig',
      cluster_label_name: 'cluster',
      cluster_label_value: '',
      kubeconfig: '',
      token: '',
      server: '',
    })
  }

  const handleOpenCreate = () => {
    resetForm()
    setOpenDialog(true)
  }

  const handleOpenEdit = (cluster: Cluster) => {
    setEditingId(cluster.id)
    setFormData({
      name: cluster.name,
      display_name: cluster.display_name || '',
      description: '',
      auth_type: 'kubeconfig',
      cluster_label_name: cluster.cluster_label_name || 'cluster',
      cluster_label_value: cluster.cluster_label_value || '',
      kubeconfig: '',
      token: '',
      server: cluster.server || '',
    })
    setOpenDialog(true)
  }

  // 处理创建/编辑集群
  const handleSave = async () => {
    try {
      if (editingId) {
        const payload: UpdateClusterRequest = {
          display_name: formData.display_name,
          description: formData.description,
          cluster_label_name: formData.cluster_label_name,
          cluster_label_value: formData.cluster_label_value,
        }
        const result = await clusterAPI.updateCluster(editingId, payload)
        if (result.success) {
          setOpenDialog(false)
          resetForm()
          loadClusters()
        }
      } else {
        const result = await clusterAPI.createCluster({
          ...formData,
          auth_type: authType,
        })
        if (result.success) {
          setOpenDialog(false)
          resetForm()
          loadClusters()
        }
      }
    } catch (err: any) {
      setError(err.message || (editingId ? '更新集群失败' : '创建集群失败'))
    }
  }

  const handleTestAndProbe = async () => {
    if (!editingId) {
      if (authType === 'kubeconfig' && !formData.kubeconfig?.trim()) {
        setError('请先填写 Kubeconfig')
        return
      }
      if (authType === 'token' && (!formData.server?.trim() || !formData.token?.trim())) {
        setError('请先填写 API Server 地址和 Token')
        return
      }
    }
    setProbeLoading(true)
    setError('')
    try {
      const payload: CreateClusterRequest = {
        ...formData,
        auth_type: authType,
      }
      const result = await clusterAPI.testAndProbe(payload)
      if (result.success && result.data) {
        setProbeResult(result.data)
        setSelectedProbeLabel('')
        setProbeOpen(true)
        // 自动回填集群名称建议
        if (result.data.cluster_name_from_context && !formData.name) {
          setFormData((prev) => ({ ...prev, name: result.data!.cluster_name_from_context }))
        }
      } else {
        setError(result.error || '探测失败')
      }
    } catch (err: any) {
      setError(err.message || '请求异常')
    } finally {
      setProbeLoading(false)
    }
  }

  const applyProbeLabel = () => {
    if (!probeResult) return
    if (selectedProbeLabel === 'custom') {
      // 保持手动输入，关闭弹窗
      setProbeOpen(false)
      return
    }
    const found = probeResult.suggested_labels.find(
      (l) => `${l.key}=${l.value}|${l.source}` === selectedProbeLabel
    )
    if (found) {
      setFormData((prev) => ({
        ...prev,
        cluster_label_name: found.key,
        cluster_label_value: found.value,
      }))
    }
    setProbeOpen(false)
  }

  // 处理删除集群
  // 实时模糊搜索过滤
  const filteredClusters = useMemo(() => {
    if (!searchQuery.trim()) return clusters
    const q = searchQuery.toLowerCase()
    return clusters.filter(
      (c) =>
        (c.display_name || '').toLowerCase().includes(q) ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.server || '').toLowerCase().includes(q)
    )
  }, [clusters, searchQuery])

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const handleDelete = async (id: number) => {
    setConfirmId(id)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    if (!confirmId) return
    try {
      await clusterAPI.deleteCluster(confirmId)
      loadClusters()
    } catch (err: any) {
      setError(err.message || '删除集群失败')
    } finally {
      setConfirmOpen(false)
      setConfirmId(null)
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* 页面标题 */}
      <Box sx={{ mb: 4 }}>
        <Card>
          <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
              集群管理
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              管理您的 Kubernetes 集群，支持 kubeconfig 和 Token 两种方式添加
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => loadClusters()}
              disabled={loading}
            >
              刷新
            </Button>
            {isPlatformAdmin && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
                添加集群
              </Button>
            )}
          </Box>
        </CardContent>
        </Card>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* 筛选栏 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
            <Autocomplete
              freeSolo
              size="small"
              sx={{ minWidth: 360 }}
              inputValue={searchQuery}
              onInputChange={(_, value) => setSearchQuery(value)}
              options={searchOptions}
              filterOptions={(x) => x}
              loading={searchLoading}
              noOptionsText="未找到匹配资源"
              getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
              onChange={(_, value) => {
                if (value && typeof value !== 'string') {
                  const cat = resourceCategories.find(c => c.resources.includes(value.kind))
                  const category = cat ? cat.key : 'workloads'
                  const nsParam = value.namespace && value.namespace !== '-' ? `&namespace=${encodeURIComponent(value.namespace)}` : ''
                  navigate(`/clusters/${value.cluster_id}?category=${category}&resource=${value.kind}${nsParam}&name=${encodeURIComponent(value.name)}`)
                }
              }}
              renderOption={(props, option) => (
                <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, px: 1.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.name}</Typography>
                  <Chip label={resourceLabels[option.kind] || option.kind} size="small" sx={{ fontSize: 10, height: 18, width: 70, justifyContent: 'flex-start' }} />
                  <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.namespace}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.cluster_name}</Typography>
                </Box>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="全局资源搜索"
                  placeholder="输入资源名称（Pod / Deployment / Service 等）"
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1, fontSize: 18 }} />,
                    endAdornment: (
                      <>
                        {searchLoading ? <CircularProgress color="inherit" size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
              ListboxProps={{
                style: { maxHeight: 360, padding: 0 },
                component: SearchListbox,
              } as any}
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>资源类别</InputLabel>
              <Select
                value={searchCategoryFilter}
                label="资源类别"
                onChange={(e) => {
                  setSearchCategoryFilter(e.target.value as string)
                  setSearchKindFilter('') // 切换类别时重置具体类型
                }}
              >
                {Object.entries(searchCategoryMap).map(([k, v]) => (
                  <MenuItem key={k} value={k}>{v.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>资源类型</InputLabel>
              <Select
                value={searchKindFilter}
                label="资源类型"
                onChange={(e) => setSearchKindFilter(e.target.value as string)}
              >
                <MenuItem value="">全部</MenuItem>
                {Object.entries(resourceLabels)
                  .filter(([k]) => {
                    if (!searchCategoryFilter) return true
                    return searchCategoryMap[searchCategoryFilter].resources.includes(k)
                  })
                  .map(([k, v]) => (
                    <MenuItem key={k} value={k}>{v}</MenuItem>
                  ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>集群</InputLabel>
              <Select
                value={searchClusterFilter}
                label="集群"
                onChange={(e) => setSearchClusterFilter(e.target.value as number | '')}
              >
                <MenuItem value="">全部集群</MenuItem>
                {clusters.map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.display_name || c.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Namespace</InputLabel>
              <Select
                value={searchNsFilter}
                label="Namespace"
                onChange={(e) => setSearchNsFilter(e.target.value as string)}
                disabled={searchNamespaces.length === 0}
              >
                <MenuItem value="">全部</MenuItem>
                {searchNamespaces.map((ns) => (
                  <MenuItem key={ns} value={ns}>{ns}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              sx={{ minWidth: 140 }}
              label="标签筛选"
              placeholder="app=nginx"
              value={searchLabelFilter}
              onChange={(e) => setSearchLabelFilter(e.target.value)}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>状态</InputLabel>
              <Select
                value={filters.status || ''}
                label="状态"
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              >
                <MenuItem value="">全部</MenuItem>
                <MenuItem value="healthy">正常</MenuItem>
                <MenuItem value="unhealthy">不健康</MenuItem>
                <MenuItem value="offline">离线</MenuItem>
                <MenuItem value="pending">检测中</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>认证方式</InputLabel>
              <Select
                value={filters.auth_type || ''}
                label="认证方式"
                onChange={(e) => setFilters({ ...filters, auth_type: e.target.value })}
              >
                <MenuItem value="">全部</MenuItem>
                <MenuItem value="kubeconfig">Kubeconfig</MenuItem>
                <MenuItem value="token">Token</MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              onClick={() => {
                setSearchQuery('')
                setSearchKindFilter('')
                setSearchNsFilter('')
                setSearchClusterFilter('')
                setSearchLabelFilter('')
                setFilters({ keyword: '', status: '', auth_type: '' })
                setTimeout(() => loadClusters(), 0)
              }}
            >
              重置
            </Button>
            <Button
              variant="contained"
              onClick={() => loadClusters()}
              disabled={loading}
            >
              查询
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* 集群列表 */}
      <Card>
        <CardContent>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : clusters.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <ClusterIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" sx={{ color: 'text.secondary', mb: 1 }}>
                暂无集群
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {isPlatformAdmin ? '点击右上角"添加集群"按钮添加您的第一个 Kubernetes 集群' : '请联系管理员添加集群'}
              </Typography>
            </Box>
          ) : filteredClusters.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <ClusterIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" sx={{ color: 'text.secondary', mb: 1 }}>
                未找到匹配的集群
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                请尝试更换搜索关键词
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} sx={{ background: 'transparent', boxShadow: 'none' }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>名称</TableCell>
                    {isPlatformAdmin && <TableCell>API Server</TableCell>}
                    <TableCell>版本</TableCell>
                    <TableCell>API 状态</TableCell>
                    {isPlatformAdmin && <TableCell>节点/Pod</TableCell>}
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredClusters.map((cluster) => (
                    <TableRow
                      key={cluster.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {cluster.display_name || cluster.name}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {cluster.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      {isPlatformAdmin && (
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {cluster.server || '-'}
                          </Typography>
                        </TableCell>
                      )}
                      <TableCell>
                        {cluster.metadata?.version || '-'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={statusLabels[cluster.metadata?.health_status || 'pending']}
                          color={statusColors[cluster.metadata?.health_status || 'pending']}
                          size="small"
                          sx={{ borderRadius: '6px' }}
                        />
                      </TableCell>
                      {isPlatformAdmin && (
                        <TableCell>
                          <Typography variant="body2">
                            {cluster.metadata?.node_count !== undefined ? `${cluster.metadata.node_count} 节点` : '-'}
                            {cluster.metadata?.pod_count !== undefined && ` / ${cluster.metadata.pod_count} Pod`}
                          </Typography>
                        </TableCell>
                      )}
                      <TableCell align="right">
                        <Tooltip title="进入集群">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/clusters/${cluster.id}`)
                            }}
                          >
                            <EnterIcon />
                          </IconButton>
                        </Tooltip>
                        {isPlatformAdmin && (
                          <>
                            <Tooltip title="编辑">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleOpenEdit(cluster)
                                }}
                              >
                                <EditIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="删除">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDelete(cluster.id)
                                }}
                              >
                                <DeleteIcon />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* 添加集群弹窗 */}
      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 600 }}>
          {editingId ? '编辑 Kubernetes 集群' : '添加 Kubernetes 集群'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* 认证方式选择 */}
            <FormControl fullWidth>
              <InputLabel>认证方式</InputLabel>
              <Select
                value={authType}
                label="认证方式"
                onChange={(e) => setAuthType(e.target.value as 'kubeconfig' | 'token')}
              >
                <MenuItem value="kubeconfig">Kubeconfig 文件</MenuItem>
                <MenuItem value="token">Token + API Server</MenuItem>
              </Select>
            </FormControl>

            {!editingId && (
              <TextField
                label="集群名称"
                placeholder="例如：prod-k8s"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                fullWidth
                required
              />
            )}

            {/* 显示名称 */}
            <TextField
              label="显示名称"
              placeholder="例如：生产集群"
              value={formData.display_name}
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              fullWidth
            />

            {/* 描述 */}
            <TextField
              label="描述"
              placeholder="集群描述信息..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              fullWidth
              multiline
              rows={2}
            />

            {/* 监控标签配置 */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
              <TextField
                label="标签名"
                placeholder="cluster"
                value={formData.cluster_label_name}
                onChange={(e) => setFormData({ ...formData, cluster_label_name: e.target.value })}
                sx={{ width: 140 }}
                helperText="extra_label 键"
              />
              <TextField
                label="标签值"
                placeholder="例如：ks、prod-bj"
                value={formData.cluster_label_value}
                onChange={(e) => setFormData({ ...formData, cluster_label_value: e.target.value })}
                fullWidth
                helperText="在全局 Prometheus / VM 数据源中，该集群对应的 extra_label 标签值"
              />
            </Box>

            {!editingId && (
              <Button
                variant="outlined"
                onClick={handleTestAndProbe}
                disabled={probeLoading}
                startIcon={probeLoading ? <CircularProgress size={18} /> : undefined}
                sx={{ alignSelf: 'flex-start' }}
              >
                {probeLoading ? '探测中...' : '测试连接并探测标签'}
              </Button>
            )}

            {/* 根据认证方式显示不同输入 */}
            {!editingId && (
              <>
                {authType === 'kubeconfig' ? (
                  <TextField
                    label="Kubeconfig"
                    placeholder="粘贴 kubeconfig YAML 内容..."
                    value={formData.kubeconfig}
                    onChange={(e) => setFormData({ ...formData, kubeconfig: e.target.value })}
                    fullWidth
                    multiline
                    rows={8}
                    required
                  />
                ) : (
                  <>
                    <TextField
                      label="API Server 地址"
                      placeholder="https://xxx:6443"
                      value={formData.server}
                      onChange={(e) => setFormData({ ...formData, server: e.target.value })}
                      fullWidth
                      required
                    />
                    <TextField
                      label="Token"
                      placeholder="ServiceAccount Token"
                      value={formData.token}
                      onChange={(e) => setFormData({ ...formData, token: e.target.value })}
                      fullWidth
                      required
                    />
                  </>
                )}
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button
            onClick={() => setOpenDialog(false)}
            sx={{ textTransform: 'none' }}
          >
            取消
          </Button>
          <Button onClick={handleSave} variant="contained">
            {editingId ? '保存' : '确定添加'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 探测结果弹窗 */}
      <Dialog open={probeOpen} onClose={() => setProbeOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>探测结果</DialogTitle>
        <DialogContent>
          {probeResult && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {probeResult.connected ? (
                <Alert severity="success">
                  集群连接成功（Kubernetes {probeResult.kubernetes_version}）
                </Alert>
              ) : (
                <Alert severity="error">集群连接失败</Alert>
              )}

              {probeResult.message && (
                <Typography variant="body2" color="text.secondary">
                  {probeResult.message}
                </Typography>
              )}

              {probeResult.suggested_labels.length > 0 && (
                <>
                  <FormControl component="fieldset">
                    <FormLabel component="legend">检测到以下监控标签配置，请选择：</FormLabel>
                    <RadioGroup
                      value={selectedProbeLabel}
                      onChange={(e) => setSelectedProbeLabel(e.target.value)}
                    >
                      {probeResult.suggested_labels.map((l, idx) => (
                        <FormControlLabel
                          key={idx}
                          value={`${l.key}=${l.value}|${l.source}`}
                          control={<Radio />}
                          label={
                            <Box>
                              <Typography variant="body2" fontWeight={600}>
                                {l.key} = {l.value}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                来源：{l.source}
                              </Typography>
                            </Box>
                          }
                        />
                      ))}
                      <FormControlLabel
                        value="custom"
                        control={<Radio />}
                        label="手动输入"
                      />
                    </RadioGroup>
                  </FormControl>
                </>
              )}

              {probeResult.suggested_labels.length === 0 && probeResult.connected && (
                <Alert severity="info">未检测到自动标签配置，请手动填写上方标签名和标签值</Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setProbeOpen(false)} sx={{ textTransform: 'none' }}>
            取消
          </Button>
          {probeResult && probeResult.suggested_labels.length > 0 && (
            <Button onClick={applyProbeLabel} variant="contained" disabled={!selectedProbeLabel}>
              确认选择
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="删除集群"
        message="确定要删除此集群吗？删除后相关数据将无法恢复。"
        onClose={() => setConfirmOpen(false)}
        onConfirm={doDelete}
      />
    </Box>
  )
}
