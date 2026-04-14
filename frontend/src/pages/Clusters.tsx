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

import { clusterAPI, Cluster, ClusterListParams, CreateClusterRequest, UpdateClusterRequest } from '../lib/cluster-api'
import { k8sAPI, SearchResourceItem, resourceLabels, resourceCategories } from '../lib/k8s-api'

// 状态颜色映射
const statusColors: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  healthy: 'success',
  warning: 'warning',
  error: 'error',
  pending: 'default',
}

const statusLabels: Record<string, string> = {
  healthy: '正常',
  warning: '警告',
  error: '异常',
  pending: '检测中',
}

export default function Clusters() {
  const navigate = useNavigate()
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
    cluster_label_value: '',
    kubeconfig: '',
    token: '',
    server: '',
  })
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<ClusterListParams>({
    keyword: '',
    status: '',
    auth_type: '',
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOptions, setSearchOptions] = useState<SearchResourceItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchOptions([])
      return
    }
    const timer = setTimeout(() => {
      setSearchLoading(true)
      k8sAPI.searchResources(searchQuery, 20)
        .then((res) => {
          if (res.success && res.data) {
            setSearchOptions(res.data)
          }
        })
        .catch(() => setSearchOptions([]))
        .finally(() => setSearchLoading(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // 加载集群列表
  const loadClusters = async () => {
    setLoading(true)
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
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClusters()
  }, [])

  const resetForm = () => {
    setEditingId(null)
    setAuthType('kubeconfig')
    setFormData({
      name: '',
      display_name: '',
      description: '',
      auth_type: 'kubeconfig',
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

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此集群吗？')) return
    try {
      await clusterAPI.deleteCluster(id)
      loadClusters()
    } catch (err: any) {
      setError(err.message || '删除集群失败')
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* 页面标题 */}
      <Card sx={{ mb: 3, border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
              onClick={loadClusters}
              disabled={loading}
            >
              刷新
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenCreate}
              sx={{
                background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
                color: 'white',
                borderRadius: '12px',
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              添加集群
            </Button>
          </Box>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      {/* 筛选栏 */}
      <Card sx={{ mb: 3, border: '1px solid', borderColor: 'divider' }}>
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
                <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 140 }}>{option.name}</Typography>
                  <Chip label={resourceLabels[option.kind] || option.kind} size="small" sx={{ fontSize: 10, height: 18 }} />
                  <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 80 }}>{option.namespace}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1, textAlign: 'right' }}>{option.cluster_name}</Typography>
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
              ListboxProps={{ style: { maxHeight: 320 } }}
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
                <MenuItem value="warning">警告</MenuItem>
                <MenuItem value="error">异常</MenuItem>
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
                setFilters({ keyword: '', status: '', auth_type: '' })
                // 重置后自动刷新
                setTimeout(() => loadClusters(), 0)
              }}
            >
              重置
            </Button>
            <Button
              variant="contained"
              onClick={loadClusters}
              disabled={loading}
              sx={{
                background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
                color: 'white',
                borderRadius: '12px',
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              查询
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* 集群列表 */}
      <Card sx={{ border: '1px solid', borderColor: 'divider' }}>
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
                点击右上角"添加集群"按钮添加您的第一个 Kubernetes 集群
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
                    <TableCell>API Server</TableCell>
                    <TableCell>版本</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>节点/Pod</TableCell>
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
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {cluster.server || '-'}
                        </Typography>
                      </TableCell>
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
                      <TableCell>
                        <Typography variant="body2">
                          {cluster.metadata?.node_count !== undefined ? `${cluster.metadata.node_count} 节点` : '-'}
                          {cluster.metadata?.pod_count !== undefined && ` / ${cluster.metadata.pod_count} Pod`}
                        </Typography>
                      </TableCell>
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
        PaperProps={{
          sx: {
            borderRadius: '16px',
          },
        }}
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

            {/* 监控标签值 */}
            <TextField
              label="监控标签值"
              placeholder="例如：ks、prod-bj"
              value={formData.cluster_label_value}
              onChange={(e) => setFormData({ ...formData, cluster_label_value: e.target.value })}
              fullWidth
              helperText="在全局 Prometheus / VM 数据源中，该集群对应的 extra_label 标签值"
            />

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
          <Button
            onClick={handleSave}
            variant="contained"
            sx={{
              background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
              color: 'white',
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            {editingId ? '保存' : '确定添加'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
