import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Pagination,
  CircularProgress,
  Alert,
  Grid,
  Breadcrumbs,
  Link,
  TextField,
  Snackbar,
} from '@mui/material'
import {
  ArrowBack as BackIcon,
  Refresh as RefreshIcon,
  Computer as NodeIcon,
  Dashboard as DashboardIcon,
  Apps as AppsIcon,
  NetworkCheck as NetworkIcon,
  Storage as StorageIcon,
  Settings as SettingsIcon,
  Security as SecurityIcon,
  Folder as FolderIcon,
  EventNote as EventIcon,
  Extension as ExtensionIcon,
  Search as SearchIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material'
import Editor from '@monaco-editor/react'

import { k8sAPI, resourceCategories, resourceLabels, ClusterStats } from '../lib/k8s-api'
import { clusterAPI, Cluster } from '../lib/cluster-api'

const iconMap: Record<string, any> = {
  Dashboard: DashboardIcon,
  Computer: NodeIcon,
  Apps: AppsIcon,
  NetworkCheck: NetworkIcon,
  Storage: StorageIcon,
  Settings: SettingsIcon,
  Security: SecurityIcon,
  Folder: FolderIcon,
  EventNote: EventIcon,
  Extension: ExtensionIcon,
}

// 需要命名空间过滤的资源
const namespacedResources = new Set([
  'pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets',
  'jobs', 'cronjobs', 'services', 'ingresses', 'endpoints',
  'persistentvolumeclaims', 'configmaps', 'secrets', 'serviceaccounts',
  'roles', 'rolebindings', 'events',
])

// 资源状态颜色映射（通用）
function getStatusColor(status?: string): 'success' | 'warning' | 'error' | 'default' | 'info' {
  if (!status) return 'default'
  const s = status.toLowerCase()
  if (s === 'running' || s === 'ready' || s === 'active' || s === 'bound' || s === 'true') return 'success'
  if (s === 'pending' || s === 'pending' || s === 'warning') return 'warning'
  if (s === 'failed' || s === 'error' || s === 'notready' || s === 'false' || s === 'crashloopbackoff') return 'error'
  if (s === 'succeeded' || s === 'completed') return 'info'
  return 'default'
}

export default function ClusterDetail() {
  const { clusterId } = useParams<{ clusterId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const id = Number(clusterId)

  const [cluster, setCluster] = useState<Cluster | null>(null)
  const [activeCategory, setActiveCategory] = useState('overview')
  const [activeResource, setActiveResource] = useState('')
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [selectedNamespace, setSelectedNamespace] = useState('default')
  const [stats, setStats] = useState<ClusterStats | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailItem, setDetailItem] = useState<any>(null)
  const [yamlMode, setYamlMode] = useState(false)
  const [yamlContent, setYamlContent] = useState('')
  const [yamlLoading, setYamlLoading] = useState(false)
  const [nsError, setNsError] = useState('')
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })
  const preRef = useRef<HTMLPreElement>(null)

  // 加载集群基本信息
  const loadCluster = async () => {
    try {
      const result = await clusterAPI.getClusters()
      if (result.success && result.data) {
        const c = result.data.find((x: Cluster) => x.id === id)
        if (c) setCluster(c)
      }
    } catch {}
  }

  // 加载命名空间
  const loadNamespaces = async () => {
    setNsError('')
    try {
      const result = await k8sAPI.getNamespaces(id)
      if (result.success && result.data) {
        setNamespaces(result.data)
        if (result.data.includes('default')) {
          setSelectedNamespace('default')
        } else {
          setSelectedNamespace(result.data[0] || 'all')
        }
      } else {
        setNsError(result.error || '命名空间加载失败')
        setNamespaces([])
      }
    } catch (err: any) {
      setNsError(err.message || '命名空间加载失败')
      setNamespaces([])
    }
  }

  // 加载概览统计
  const loadStats = async () => {
    try {
      const result = await k8sAPI.getStats(id)
      if (result.success && result.data) {
        setStats(result.data)
      }
    } catch {}
  }

  // 加载资源列表
  const loadResources = async (kind: string, currentPage = page, search = keyword) => {
    if (!kind) return
    setLoading(true)
    setError('')
    try {
      const ns = namespacedResources.has(kind) ? selectedNamespace : ''
      const result = await k8sAPI.getResources(id, kind, ns, currentPage, limit, search)
      if (result.success && result.data) {
        setItems(result.data.items)
        setTotal(result.data.total)
      } else {
        setError(result.error || '加载失败')
        setItems([])
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  // 查看详情
  const viewDetail = async (item: any) => {
    const kind = activeResource
    try {
      const result = await k8sAPI.getResource(id, kind, item.name, item.namespace)
      if (result.success && result.data) {
        setDetailItem(result.data)
      } else {
        setDetailItem(item)
      }
    } catch {
      setDetailItem(item)
    }
    setYamlMode(false)
    setYamlContent('')
    setDetailOpen(true)
  }

  // 加载YAML
  const loadYaml = async () => {
    if (!detailItem) return
    setYamlLoading(true)
    try {
      const result = await k8sAPI.getResourceYAML(id, activeResource, detailItem.name, detailItem.namespace)
      if (result.success && result.data) {
        setYamlContent(result.data)
        setYamlMode(true)
      }
    } catch (err: any) {
      setError(err.message || '加载 YAML 失败')
    } finally {
      setYamlLoading(false)
    }
  }

  // 刷新缓存
  const handleRefresh = async () => {
    try {
      await k8sAPI.refreshCluster(id)
      setError('')
      // 异步任务已启动，提示用户稍后手动刷新
      setSnackbar({ open: true, message: '缓存刷新任务已启动，请等待 5-10 秒后重新加载数据', severity: 'success' })
    } catch (err: any) {
      setError(err.message || '刷新失败')
    }
  }

  useEffect(() => {
    loadCluster()
    loadNamespaces()
    loadStats()
  }, [id])

  // 处理从搜索跳转过来的 deep link
  const urlCategory = searchParams.get('category')
  const urlResource = searchParams.get('resource')
  const urlNamespace = searchParams.get('namespace')
  const urlName = searchParams.get('name')

  useEffect(() => {
    if (urlCategory) {
      setActiveCategory(urlCategory)
      if (urlResource) {
        setActiveResource(urlResource)
      }
      if (urlNamespace) {
        setSelectedNamespace(urlNamespace)
      }
    }
  }, [urlCategory, urlResource, urlNamespace])

  useEffect(() => {
    if (activeCategory === 'overview') {
      loadStats()
      return
    }
    const category = resourceCategories.find(c => c.key === activeCategory)
    if (category && category.resources.length > 0) {
      const targetResource = category.resources.includes(activeResource) ? activeResource : category.resources[0]
      setActiveResource(targetResource)
      setPage(1)
      setKeyword('')
      loadResources(targetResource, 1, '')
    }
  }, [activeCategory, selectedNamespace, limit])

  // 资源列表加载后，自动打开指定资源的详情弹窗
  useEffect(() => {
    if (urlName && items.length > 0 && !loading && activeResource) {
      const target = items.find((item: any) => item.name === urlName)
      if (target) {
        viewDetail(target)
        searchParams.delete('name')
        setSearchParams(searchParams, { replace: true })
      }
    }
  }, [items, loading, urlName, activeResource])

  useEffect(() => {
    if (activeResource && activeCategory !== 'overview') {
      loadResources(activeResource, page)
    }
  }, [page])

  // keyword 搜索 debounce
  useEffect(() => {
    if (activeCategory === 'overview' || !activeResource) return
    const timer = setTimeout(() => {
      setPage(1)
      loadResources(activeResource, 1, keyword)
    }, 300)
    return () => clearTimeout(timer)
  }, [keyword])

  const category = resourceCategories.find(c => c.key === activeCategory)

  // 获取表格列
  const getColumns = (kind: string) => {
    const common = [{ key: 'name', label: '名称', width: '25%' }]
    switch (kind) {
      case 'nodes':
        return [...common, { key: 'status', label: '状态' }, { key: 'roles', label: '角色' }, { key: 'version', label: '版本' }, { key: 'internal_ip', label: 'IP' }]
      case 'pods':
        return [...common, { key: 'namespace', label: '命名空间' }, { key: 'status', label: '状态' }, { key: 'restarts', label: '重启次数' }, { key: 'node', label: '节点' }, { key: 'pod_ip', label: 'IP' }]
      case 'deployments':
      case 'statefulsets':
      case 'replicasets':
        return [...common, { key: 'namespace', label: '命名空间' }, { key: 'replicas', label: '副本' }]
      case 'daemonsets':
        return [...common, { key: 'namespace', label: '命名空间' }, { key: 'desired', label: '期望' }, { key: 'ready', label: '就绪' }]
      case 'jobs':
        return [...common, { key: 'namespace', label: '命名空间' }, { key: 'completions', label: '完成度' }]
      case 'cronjobs':
        return [...common, { key: 'namespace', label: '命名空间' }, { key: 'schedule', label: '调度' }]
      case 'services':
        return [...common, { key: 'namespace', label: '命名空间' }, { key: 'type', label: '类型' }, { key: 'cluster_ip', label: 'ClusterIP' }]
      case 'ingresses':
        return [...common, { key: 'namespace', label: '命名空间' }, { key: 'hosts', label: '域名' }]
      case 'persistentvolumes':
        return [...common, { key: 'status', label: '状态' }, { key: 'capacity', label: '容量' }, { key: 'claim', label: '声明' }]
      case 'persistentvolumeclaims':
        return [...common, { key: 'namespace', label: '命名空间' }, { key: 'status', label: '状态' }, { key: 'storage_class', label: '存储类' }]
      case 'events':
        return [
          { key: 'type', label: '类型' },
          { key: 'reason', label: '原因' },
          { key: 'object', label: '对象' },
          { key: 'message', label: '消息' },
          { key: 'count', label: '次数' },
        ]
      case 'customresourcedefinitions':
        return [
          ...common,
          { key: 'group', label: 'Group' },
          { key: 'scope', label: '作用域' },
          { key: 'versions', label: '版本' },
          { key: 'established', label: '状态' },
        ]
      default:
        return [...common, { key: 'namespace', label: '命名空间' }, { key: 'status', label: '状态' }]
    }
  }

  // 渲染单元格
  const renderCell = (item: any, key: string) => {
    const value = item[key]
    if (key === 'name') {
      return (
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main', cursor: 'pointer' }} onClick={() => viewDetail(item)}>
          {value}
        </Typography>
      )
    }
    if (key === 'status') {
      return <Chip label={value || '-'} color={getStatusColor(value)} size="small" sx={{ borderRadius: '6px' }} />
    }
    if (key === 'hosts' && Array.isArray(value)) {
      return value.join(', ')
    }
    if (key === 'roles' && Array.isArray(value)) {
      return value.join(', ')
    }
    if (key === 'established') {
      return <Chip label={value ? 'Established' : 'Not Established'} color={value ? 'success' : 'default'} size="small" sx={{ borderRadius: '6px' }} />
    }
    return String(value ?? '-')
  }

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部面包屑与操作 */}
      <Box sx={{ mb: 3 }}>
        <Card>
          <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button startIcon={<BackIcon />} onClick={() => navigate('/clusters')} variant="outlined" size="small">
              返回
            </Button>
            <Breadcrumbs>
              <Link underline="hover" color="inherit" sx={{ cursor: 'pointer' }} onClick={() => navigate('/clusters')}>集群管理</Link>
              <Typography color="text.primary" sx={{ fontWeight: 600 }}>
                {cluster?.display_name || cluster?.name || `集群 ${id}`}
              </Typography>
            </Breadcrumbs>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Chip
              label={cluster?.metadata?.health_status === 'healthy' ? '正常' : cluster?.metadata?.health_status === 'error' ? '异常' : '检测中'}
              color={cluster?.metadata?.health_status === 'healthy' ? 'success' : cluster?.metadata?.health_status === 'error' ? 'error' : 'default'}
              size="small"
            />
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={handleRefresh} disabled={loading} size="small">
              刷新缓存
            </Button>
          </Box>
        </CardContent>
        </Card>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* 主体：左侧 Tabs + 右侧内容 */}
      <Card sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Tabs
          orientation="vertical"
          value={activeCategory}
          onChange={(_, v) => setActiveCategory(v)}
          sx={{ borderRight: 1, borderColor: 'divider', minWidth: 180, bgcolor: 'rgba(0,0,0,0.02)' }}
        >
          {resourceCategories.map(cat => {
            const Icon = iconMap[cat.icon]
            return <Tab key={cat.key} value={cat.key} label={cat.label} icon={Icon ? <Icon /> : undefined} iconPosition="start" sx={{ justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none' }} />
          })}
        </Tabs>

        <Box sx={{ flex: 1, p: 3, overflow: 'auto' }}>
          {activeCategory === 'overview' && (
            <Box>
              <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>集群概览</Typography>
              <Grid container spacing={3}>
                {stats && Object.entries(stats).map(([key, value]) => (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={key}>
                    <Card sx={{ textAlign: 'center', p: 2 }}>
                      <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main' }}>{value}</Typography>
                      <Typography variant="body2" color="text.secondary">{resourceLabels[key] || key}</Typography>
                    </Card>
                  </Grid>
                ))}
                {!stats && <Typography color="text.secondary">暂无统计数据</Typography>}
              </Grid>
            </Box>
          )}

          {activeCategory !== 'overview' && category && (
            <Box>
              {/* 子资源 Tabs */}
              {category.resources.length > 1 && (
                <Tabs value={activeResource} onChange={(_, v) => { setActiveResource(v); setPage(1); setKeyword(''); loadResources(v, 1, ''); }} sx={{ mb: 2 }}>
                  {category.resources.map(r => (
                    <Tab key={r} value={r} label={resourceLabels[r] || r} sx={{ textTransform: 'none' }} />
                  ))}
                </Tabs>
              )}

              {/* 过滤栏 */}
              <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                {namespacedResources.has(activeResource) && (
                  <FormControl size="small" sx={{ minWidth: 200 }} error={!!nsError}>
                    <InputLabel>命名空间</InputLabel>
                    <Select value={selectedNamespace} label="命名空间" onChange={(e) => setSelectedNamespace(e.target.value)}>
                      <MenuItem value="all">全部命名空间</MenuItem>
                      {namespaces.map(ns => (
                        <MenuItem key={ns} value={ns}>{ns}</MenuItem>
                      ))}
                    </Select>
                    {nsError && (
                      <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                        {nsError}
                      </Typography>
                    )}
                  </FormControl>
                )}
                <TextField
                  size="small"
                  placeholder="搜索资源名称"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1, fontSize: 18 }} />,
                  }}
                  sx={{ minWidth: 240 }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                  共 {total} 条
                </Typography>
              </Box>

              {/* 表格 */}
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
              ) : (
                <TableContainer component={Paper} sx={{ background: 'transparent', boxShadow: 'none' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {getColumns(activeResource).map(col => (
                          <TableCell key={col.key} sx={{ fontWeight: 600 }}>{col.label}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {items.map((item, idx) => (
                        <TableRow key={idx} hover>
                          {getColumns(activeResource).map(col => (
                            <TableCell key={col.key}>{renderCell(item, col.key)}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                      {items.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={getColumns(activeResource).length} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                            暂无数据
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {/* 分页 */}
              {total > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mt: 2, gap: 2 }}>
                  <Pagination count={Math.max(1, Math.ceil(total / limit))} page={page} onChange={(_, p) => setPage(p)} color="primary" />
                  <FormControl size="small" sx={{ minWidth: 80 }}>
                    <Select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>
                      <MenuItem value={10}>10</MenuItem>
                      <MenuItem value={20}>20</MenuItem>
                      <MenuItem value={50}>50</MenuItem>
                      <MenuItem value={100}>100</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Card>

      {/* 详情弹窗 */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{detailItem?.name || '资源详情'}</span>
          {yamlMode && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<CopyIcon />}
                onClick={() => {
                  if (!yamlContent) {
                    setSnackbar({ open: true, message: 'YAML 内容为空', severity: 'error' })
                    return
                  }
                  const pre = preRef.current
                  if (!pre) {
                    setSnackbar({ open: true, message: '复制失败，请手动复制', severity: 'error' })
                    return
                  }
                  const selection = window.getSelection()
                  const range = document.createRange()
                  range.selectNodeContents(pre)
                  selection?.removeAllRanges()
                  selection?.addRange(range)
                  let ok = false
                  try { ok = document.execCommand('copy') } catch {}
                  selection?.removeAllRanges()
                  if (ok) {
                    setSnackbar({ open: true, message: 'YAML 已复制到剪贴板', severity: 'success' })
                  } else {
                    setSnackbar({ open: true, message: '复制失败，请手动复制', severity: 'error' })
                  }
                }}
                sx={{ textTransform: 'none' }}
              >
                复制 YAML
              </Button>
              <Button size="small" variant="outlined" onClick={() => setYamlMode(false)}>返回详情</Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  if (!yamlContent) return
                  const blob = new Blob([yamlContent], { type: 'text/yaml' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${detailItem?.name || 'resource'}.yaml`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                sx={{ textTransform: 'none' }}
              >
                下载 YAML
              </Button>
            </Box>
          )}
        </DialogTitle>
        <DialogContent dividers>
          {yamlMode ? (
            <Box sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Editor
                height="60vh"
                language="yaml"
                value={yamlContent}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  wordWrap: 'on',
                  automaticLayout: true,
                }}
              />
              <Box
                ref={preRef}
                component="pre"
                sx={{ position: 'absolute', left: '-9999px', top: 0, m: 0, p: 0, fontSize: 1, lineHeight: 1, opacity: 0 }}
              >
                {yamlContent}
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
              {detailItem && Object.entries(detailItem).map(([key, value]) => (
                <Box key={key} sx={{ display: 'flex', gap: 2, py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <Typography variant="body2" sx={{ minWidth: 140, color: 'text.secondary', fontWeight: 500 }}>{key}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: value && typeof value === 'string' && value.length > 50 ? 'monospace' : 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '-')}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          {!yamlMode && (
            <Button variant="outlined" onClick={loadYaml} disabled={yamlLoading} sx={{ textTransform: 'none' }}>
              {yamlLoading ? '加载中...' : '查看 YAML'}
            </Button>
          )}
          <Button onClick={() => setDetailOpen(false)} sx={{ textTransform: 'none' }}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
