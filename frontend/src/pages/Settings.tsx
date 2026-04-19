import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Tabs,
  Tab,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
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
  Alert,
  CircularProgress,
  Snackbar,
} from '@mui/material'
import { Delete as DeleteIcon, Edit as EditIcon, Refresh as TestIcon } from '@mui/icons-material'

import { DataSource, datasourceAPI, CreateDataSourceRequest } from '../lib/datasource-api'
import { aiPlatformAPI, AIPlatform, PlatformFormConfig, ProviderInfo } from '../lib/ai-platform-api'
import { logBackendAPI, LogBackend, LogBackendForm } from '../lib/log-backend-api'
import { clusterAPI, Cluster } from '../lib/cluster-api'
import { settingAPI } from '../lib/setting-api'
import { useSiteConfig } from '../context/SiteConfigContext'
import ConfirmDialog from '../components/ConfirmDialog'

function DataSourceSettings() {
  const [dataSources, setDataSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<CreateDataSourceRequest>({
    name: '',
    type: 'prometheus',
    url: '',
    config: '',
    cluster_id: undefined,
    is_default: false,
  })
  const [error, setError] = useState('')
  const [testingId, setTestingId] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })

  const showSnack = (message: string, severity: 'success' | 'error' = 'success') => setSnack({ open: true, message, severity })
  const closeSnack = () => setSnack((s) => ({ ...s, open: false }))

  const load = async () => {
    setLoading(true)
    try {
      const result = await datasourceAPI.list()
      if (result.success) setDataSources(result.data)
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleOpen = (ds?: DataSource) => {
    if (ds) {
      setEditingId(ds.id)
      setForm({
        name: ds.name,
        type: ds.type,
        url: ds.url,
        config: ds.config,
        cluster_id: ds.cluster_id,
        is_default: ds.is_default,
      })
    } else {
      setEditingId(null)
      setForm({ name: '', type: 'prometheus', url: '', config: '', cluster_id: undefined, is_default: false })
    }
    setDialogOpen(true)
    setError('')
  }

  const handleSave = async () => {
    if (!form.name || !form.url) {
      setError('请填写名称和地址')
      return
    }
    try {
      const payload = { ...form }
      if (editingId) {
        await datasourceAPI.update(editingId, payload)
      } else {
        await datasourceAPI.create(payload)
      }
      setDialogOpen(false)
      load()
    } catch (err: any) {
      setError(err.message || '保存失败')
    }
  }

  const handleDelete = async (id: number) => {
    setConfirmId(id)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    if (!confirmId) return
    try {
      await datasourceAPI.delete(confirmId)
      load()
      showSnack('删除成功')
    } catch (err: any) {
      showSnack(err.message || '删除失败', 'error')
    } finally {
      setConfirmOpen(false)
      setConfirmId(null)
    }
  }

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      const result = await datasourceAPI.test(id)
      if (result.success) {
        showSnack(`连通成功: ${result.message}`)
      } else {
        showSnack(`连通失败: ${result.message}`, 'error')
      }
      load()
    } catch (err: any) {
      showSnack(err.message || '测试失败', 'error')
    } finally {
      setTestingId(null)
    }
  }

  return (
    <Box>
      {error && !dialogOpen && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" onClick={() => handleOpen()}>
          添加数据源
        </Button>
      </Box>

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>名称</TableCell>
              <TableCell>类型</TableCell>
              <TableCell>地址</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>默认</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : dataSources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary' }}>
                  暂无数据源，点击右上角添加
                </TableCell>
              </TableRow>
            ) : (
              dataSources.map((ds) => (
                <TableRow key={ds.id}>
                  <TableCell>{ds.name}</TableCell>
                  <TableCell>
                    <Chip label={ds.type.toUpperCase()} size="small" />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>{ds.url}</TableCell>
                  <TableCell>
                    <Chip
                      label={ds.is_active ? '有效' : '无效'}
                      color={ds.is_active ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{ds.is_default ? '是' : '-'}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => handleTest(ds.id)}
                      disabled={testingId === ds.id}
                    >
                      {testingId === ds.id ? (
                        <CircularProgress size={18} />
                      ) : (
                        <TestIcon fontSize="small" />
                      )}
                    </IconButton>
                    <IconButton size="small" onClick={() => handleOpen(ds)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(ds.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>
          {editingId ? '编辑数据源' : '添加数据源'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="名称"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>类型</InputLabel>
              <Select
                value={form.type}
                label="类型"
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <MenuItem value="prometheus">Prometheus</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="URL"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              fullWidth
              placeholder="http://prometheus:9090"
            />
            <TextField
              label="关联集群 ID（高级）"
              value={form.cluster_id ?? ''}
              onChange={(e) => setForm({ ...form, cluster_id: e.target.value ? Number(e.target.value) : undefined })}
              fullWidth
              type="number"
              placeholder="留空表示全局数据源（可被多个集群共用）"
              helperText="通常无需填写。全局数据源会自动根据各集群的监控标签配置进行过滤"
            />
            <TextField
              label="配置 (JSON)"
              value={form.config}
              onChange={(e) => setForm({ ...form, config: e.target.value })}
              fullWidth
              multiline
              rows={3}
              placeholder='{"headers":{"X-Custom":"value"}}'
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSave}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="删除数据源"
        message="确定要删除此数据源吗？使用该数据源的面板将无法正常显示。"
        onClose={() => setConfirmOpen(false)}
        onConfirm={doDelete}
      />

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={closeSnack} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={closeSnack} severity={snack.severity} sx={{ width: '100%', borderRadius: '12px' }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

function AISettings() {
  const [platforms, setPlatforms] = useState<AIPlatform[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [providerTypes, setProviderTypes] = useState<ProviderInfo[]>([])
  const [form, setForm] = useState<{
    name: string
    provider_type: string
    config: PlatformFormConfig
  }>({
    name: '',
    provider_type: '',
    config: { url: '', token: '', model: 'Hermes', timeout: 300, max_context_length: 4096, max_history_messages: 10 },
  })
  const [error, setError] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testingDialog, setTestingDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; severity: 'success' | 'error' } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await aiPlatformAPI.list()
      if (res.success && Array.isArray(res.data)) {
        setPlatforms(res.data)
      }
    } catch (err: any) {
      setMessage({ text: err.message || '加载失败', severity: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    aiPlatformAPI.getProviderTypes().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setProviderTypes(res.data)
      }
    })
  }, [])

  const handleOpen = async (p?: AIPlatform) => {
    if (p) {
      setEditingId(p.id)
      try {
        const res = await aiPlatformAPI.get(p.id)
        if (res.success && res.data && 'config' in (res.data as any)) {
          const data = res.data as any
          setForm({
            name: data.name || p.name,
            provider_type: data.provider_type || p.provider_type,
            config: {
              url: data.config?.url || '',
              token: data.config?.token || '',
              model: data.config?.model || (data.provider_type === 'ollama' ? 'llama3' : ''),
              timeout: data.config?.timeout || (data.provider_type === 'ollama' ? 600 : 300),
              max_context_length: data.config?.max_context_length || (data.provider_type === 'ollama' ? 4096 : undefined),
              max_history_messages: data.config?.max_history_messages || 10,
            },
          })
        } else {
          setForm({
            name: p.name,
            provider_type: p.provider_type as any,
            config: { url: '', token: '', model: p.provider_type === 'ollama' ? 'llama3' : (p.provider_type === 'openclaw' ? 'openclaw' : ''), timeout: p.provider_type === 'ollama' ? 600 : 300, max_context_length: p.provider_type === 'ollama' ? 4096 : undefined, max_history_messages: 10 },
          })
        }
      } catch {
        setForm({
          name: p.name,
          provider_type: p.provider_type as any,
          config: { url: '', token: '', model: p.provider_type === 'ollama' ? 'llama3' : (p.provider_type === 'openclaw' ? 'openclaw' : ''), timeout: p.provider_type === 'ollama' ? 600 : 300 },
        })
      }
    } else {
      setEditingId(null)
      setForm({ name: '', provider_type: '', config: { url: '', token: '', model: 'Hermes', timeout: 300, max_history_messages: 10 } })
    }
    setDialogOpen(true)
    setTestingDialog(false)
    setError('')
    setMessage(null)
  }

  const handleSave = async () => {
    if (!form.name || !form.provider_type || !form.config.url) {
      setError('请填写名称、平台类型和服务地址')
      return
    }
    if (!form.config.model) {
      form.config.model = form.provider_type === 'ollama' ? 'llama3' : ''
    }
    setSaving(true)
    try {
      if (editingId) {
        await aiPlatformAPI.update(editingId, { name: form.name, config: form.config })
      } else {
        await aiPlatformAPI.create({
          name: form.name,
          provider_type: form.provider_type,
          config: form.config,
        })
      }
      setDialogOpen(false)
      load()
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setConfirmId(id)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    if (!confirmId) return
    try {
      await aiPlatformAPI.delete(confirmId)
      load()
      setMessage({ text: '删除成功', severity: 'success' })
    } catch (err: any) {
      setMessage({ text: err.message || '删除失败', severity: 'error' })
    } finally {
      setConfirmOpen(false)
      setConfirmId(null)
    }
  }

  const handleTest = async (id: string) => {
    setTestingId(id)
    try {
      const res = await aiPlatformAPI.test(id)
      if (res.success) {
        setMessage({ text: `连通成功: ${res.message}`, severity: 'success' })
      } else {
        setMessage({ text: `连通失败: ${res.error}`, severity: 'error' })
      }
      load()
    } catch (err: any) {
      setMessage({ text: err.message || '测试失败', severity: 'error' })
    } finally {
      setTestingId(null)
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      await aiPlatformAPI.setDefault(id)
      load()
    } catch (err: any) {
      setMessage({ text: err.message || '设置失败', severity: 'error' })
    }
  }

  const formatTime = (t?: string) => {
    if (!t) return '-'
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <Box>
      {message && !dialogOpen && (
        <Alert severity={message.severity} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" onClick={() => handleOpen()}>
          新增对接
        </Button>
      </Box>

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>名称</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>对接时间</TableCell>
              <TableCell>默认</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : platforms.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary' }}>
                  暂无 AI 平台，点击右上角添加
                </TableCell>
              </TableRow>
            ) : (
              platforms.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>
                    <Chip label={providerTypes.find(pt => pt.type === p.provider_type)?.name || p.provider_type} size="small" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={p.status === 'online' ? '在线' : p.status === 'offline' ? '离线' : '未知'}
                      color={p.status === 'online' ? 'success' : p.status === 'offline' ? 'error' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{formatTime(p.created_at)}</TableCell>
                  <TableCell>{p.is_default ? '是' : '-'}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => handleTest(p.id)}
                      disabled={testingId === p.id}
                      title="测试连接"
                    >
                      {testingId === p.id ? <CircularProgress size={18} /> : <TestIcon fontSize="small" />}
                    </IconButton>
                    {!p.is_default && (
                      <Button
                        size="small"
                        onClick={() => handleSetDefault(p.id)}
                        sx={{ minWidth: 0, mr: 0.5, fontSize: 12 }}
                      >
                        设为默认
                      </Button>
                    )}
                    <IconButton size="small" onClick={() => handleOpen(p)} title="编辑">
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(p.id)} title="删除">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>
          {editingId ? '编辑 AI 平台' : '新增 AI 平台'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {message && dialogOpen && (
              <Alert severity={message.severity} sx={{ mb: 0 }}>
                {message.text}
              </Alert>
            )}
            <TextField
              label="平台名称"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
              placeholder="如：公司 OpenClaw"
            />
            <FormControl fullWidth>
              <InputLabel>平台类型</InputLabel>
              <Select
                value={form.provider_type}
                label="平台类型"
                onChange={(e) => {
                  const pt = e.target.value as any
                  setForm({
                    ...form,
                    provider_type: pt,
                    config: {
                      ...form.config,
                      model: pt === 'ollama' ? 'llama3' : (pt === 'openclaw' ? 'openclaw' : 'Hermes'),
                      timeout: pt === 'ollama' ? 600 : 300,
                      max_context_length: pt === 'ollama' ? 4096 : undefined,
                      max_history_messages: form.config.max_history_messages || 10,
                    },
                  })
                }}
              >
                {providerTypes.map((pt) => (
                  <MenuItem key={pt.type} value={pt.type}>{pt.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {form.provider_type && (
              <>
                <TextField
                  label="服务地址"
                  value={form.config.url}
                  onChange={(e) => setForm({ ...form, config: { ...form.config, url: e.target.value } })}
                  fullWidth
                  placeholder={form.provider_type === 'ollama' ? 'http://localhost:11434' : 'http://127.0.0.1:8080'}
                  helperText="必须包含 http:// 或 https:// 协议头"
                  error={form.config.url !== '' && !form.config.url.match(/^https?:\/\//)}
                />
                {form.provider_type !== 'ollama' && (
                  <TextField
                    label="API Token"
                    type="password"
                    value={form.config.token}
                    onChange={(e) => setForm({ ...form, config: { ...form.config, token: e.target.value } })}
                    fullWidth
                    placeholder="sk-xxxxxxxx"
                  />
                )}
                <TextField
                  label="模型名称"
                  value={form.config.model}
                  onChange={(e) => setForm({ ...form, config: { ...form.config, model: e.target.value } })}
                  fullWidth
                  placeholder={form.provider_type === 'ollama' ? 'llama3' : 'gpt-4o'}
                />
                <TextField
                  label="请求超时时长（秒）"
                  type="number"
                  value={form.config.timeout}
                  onChange={(e) => setForm({ ...form, config: { ...form.config, timeout: parseInt(e.target.value) || 300 } })}
                  fullWidth
                  placeholder="300"
                  helperText={form.provider_type === 'ollama' ? 'Ollama 首次加载模型较慢，建议 300 ~ 1200 秒' : '建议 60 ~ 1800 秒，Hermes 等 Agent 建议 300 秒以上'}
                />
                {form.provider_type === 'ollama' && (
                  <TextField
                    label="最大上下文长度（num_ctx）"
                    type="number"
                    value={form.config.max_context_length}
                    onChange={(e) => setForm({ ...form, config: { ...form.config, max_context_length: parseInt(e.target.value) || 4096 } })}
                    fullWidth
                    placeholder="4096"
                    helperText="Ollama 加载模型时分配的上下文 token 数，建议 2048 ~ 32768"
                  />
                )}
                <TextField
                  label="最大历史消息条数"
                  type="number"
                  value={form.config.max_history_messages}
                  onChange={(e) => setForm({ ...form, config: { ...form.config, max_history_messages: parseInt(e.target.value) || 10 } })}
                  fullWidth
                  placeholder="10"
                  helperText="发送给 AI 时保留的最近消息条数（不含 system），建议 5 ~ 30"
                />
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => { setDialogOpen(false); setTestingDialog(false) }}>取消</Button>
          <Button
            variant="outlined"
            onClick={async () => {
              if (!form.name || !form.provider_type || !form.config.url) {
                setError('请填写名称、平台类型和服务地址后再测试')
                return
              }
              setTestingDialog(true)
              setError('')
              try {
                let testId = editingId
                if (!testId) {
                  const createRes = await aiPlatformAPI.create({
                    name: form.name,
                    provider_type: form.provider_type,
                    config: form.config,
                  })
                  const createdPlatform = Array.isArray(createRes.data) ? createRes.data[0] : createRes.data
                  if (!createRes.success || !createdPlatform?.id) {
                    setMessage({ text: createRes.error || '创建失败，无法测试', severity: 'error' })
                    return
                  }
                  testId = createdPlatform.id
                  setEditingId(testId)
                }
                const res = await aiPlatformAPI.test(testId!)
                if (res.success) {
                  setMessage({ text: `连通成功: ${res.message}`, severity: 'success' })
                } else {
                  setMessage({ text: `连通失败: ${res.error}`, severity: 'error' })
                }
              } catch (err: any) {
                setMessage({ text: err.message || '测试失败', severity: 'error' })
              } finally {
                setTestingDialog(false)
              }
            }}
            disabled={testingDialog}
            sx={{ mr: 'auto' }}
          >
            {testingDialog ? <CircularProgress size={18} /> : '测试连接'}
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} sx={{ color: 'inherit' }} /> : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="删除 AI 平台"
        message="确定要删除此 AI 平台吗？"
        onClose={() => setConfirmOpen(false)}
        onConfirm={doDelete}
      />
    </Box>
  )
}


function LogBackendSettings() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [backends, setBackends] = useState<LogBackend[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<LogBackendForm>({
    cluster_id: 0,
    name: '',
    type: 'elasticsearch',
    url: '',
    index_patterns: { all: 'k8s-es-logs-*', ingress: 'nginx-ingress-*', coredns: 'k8s-es-logs-*', lb: 'k8s-es-logs-*', app: 'k8s-es-logs-*' },
    username: '',
    password: '',
  })
  const [testingId, setTestingId] = useState<number | null>(null)
  const [dialogTesting, setDialogTesting] = useState(false)
  const [error, setError] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' })

  const showSnack = (message: string, severity: 'success' | 'error' | 'info' = 'info') => setSnack({ open: true, message, severity })
  const closeSnack = () => setSnack((s) => ({ ...s, open: false }))

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [cRes, bRes] = await Promise.all([
        clusterAPI.getClusters(),
        logBackendAPI.list(),
      ])
      if (cRes.success && cRes.data) {
        const list: Cluster[] = Array.isArray(cRes.data) ? cRes.data : cRes.data.clusters || []
        setClusters(list)
      }
      if (bRes.success && bRes.data) {
        setBackends(bRes.data)
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const clusterMap = useMemo(() => {
    const map: Record<number, string> = {}
    clusters.forEach((c) => (map[c.id] = c.name))
    return map
  }, [clusters])

  const resetForm = () => {
    setForm({
      cluster_id: 0,
      name: '',
      type: 'elasticsearch',
      url: '',
      index_patterns: { all: 'k8s-es-logs-*', ingress: 'nginx-ingress-*', coredns: 'k8s-es-logs-*', lb: 'k8s-es-logs-*', app: 'k8s-es-logs-*' },
      username: '',
      password: '',
    })
  }

  const handleOpenAdd = () => {
    setEditingId(null)
    resetForm()
    setDialogOpen(true)
    setDialogError('')
  }

  const handleOpenEdit = (b: LogBackend) => {
    setEditingId(b.id)
    setForm({
      cluster_id: b.cluster_id,
      name: b.name,
      type: b.type,
      url: b.url,
      index_patterns: {
        all: b.index_patterns?.all || 'k8s-es-logs-*',
        ingress: b.index_patterns?.ingress || 'nginx-ingress-*',
        coredns: b.index_patterns?.coredns || 'k8s-es-logs-*',
        lb: b.index_patterns?.lb || 'k8s-es-logs-*',
        app: b.index_patterns?.app || 'k8s-es-logs-*',
      },
      username: b.username || '',
      password: b.password || '',
    })
    setDialogOpen(true)
    setDialogError('')
  }

  const buildPayload = (): LogBackendForm => {
    const payload: LogBackendForm = { ...form }
    if (payload.username || payload.password) {
      const headers: Record<string, string> = {}
      if (payload.username && payload.password) {
        const basic = btoa(`${payload.username}:${payload.password}`)
        headers['Authorization'] = `Basic ${basic}`
      }
      payload.headers = headers
    }
    return payload
  }

  const handleSave = async () => {
    if (!form.cluster_id) {
      setDialogError('请选择集群')
      return
    }
    if (!form.name || !form.url) {
      setDialogError('请填写名称和地址')
      return
    }
    try {
      const payload = buildPayload()
      if (editingId) {
        const res = await logBackendAPI.update(editingId, payload)
        if (!res.success) {
          setDialogError(res.error || '保存失败')
          return
        }
      } else {
        const res = await logBackendAPI.create(payload)
        if (!res.success) {
          setDialogError(res.error || '保存失败')
          return
        }
      }
      setDialogOpen(false)
      loadData()
      showSnack('保存成功', 'success')
    } catch (err: any) {
      setDialogError(err.message || '保存失败')
    }
  }

  const handleDelete = async (id: number) => {
    setConfirmId(id)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    if (!confirmId) return
    try {
      const res = await logBackendAPI.delete(confirmId)
      if (res.success) {
        loadData()
        showSnack('删除成功', 'success')
      } else {
        showSnack(res.error || '删除失败', 'error')
      }
    } catch (err: any) {
      showSnack(err.message || '删除失败', 'error')
    } finally {
      setConfirmOpen(false)
      setConfirmId(null)
    }
  }

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      const res = await logBackendAPI.test(id)
      if (res.success) {
        showSnack(`连通成功: ${res.message}`, 'success')
      } else {
        let msg = res.error || '连通失败'
        if (msg.includes('no such host') || msg.includes('lookup')) {
          msg = '地址无法解析（可能是集群内部域名），建议改为 NodePort 或外部可访问地址'
        }
        showSnack(msg, 'error')
      }
    } catch (err: any) {
      showSnack(err.message || '测试失败', 'error')
    } finally {
      setTestingId(null)
    }
  }

  const handleDialogTest = async () => {
    if (!form.cluster_id) {
      setDialogError('请先选择集群')
      return
    }
    if (!form.name || !form.url) {
      setDialogError('请填写名称和地址')
      return
    }
    setDialogTesting(true)
    try {
      const payload = buildPayload()
      let id = editingId
      if (!id) {
        const createRes = await logBackendAPI.create(payload)
        if (!createRes.success || !createRes.data) {
          setDialogError(createRes.error || '保存失败，无法测试')
          setDialogTesting(false)
          return
        }
        id = createRes.data.id
        setEditingId(id)
        setBackends((prev) => [...prev, createRes.data!])
      } else {
        const updateRes = await logBackendAPI.update(id, payload)
        if (!updateRes.success) {
          setDialogError(updateRes.error || '保存失败，无法测试')
          setDialogTesting(false)
          return
        }
      }
      const testRes = await logBackendAPI.test(id)
      if (testRes.success) {
        showSnack(`连通成功: ${testRes.message}`, 'success')
      } else {
        let msg = testRes.error || '连通失败'
        if (msg.includes('no such host') || msg.includes('lookup')) {
          msg = '地址无法解析（可能是集群内部域名），建议改为 NodePort 或外部可访问地址'
        }
        showSnack(msg, 'error')
      }
    } catch (err: any) {
      showSnack(err.message || '测试失败', 'error')
    } finally {
      setDialogTesting(false)
    }
  }

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" onClick={handleOpenAdd}>
          添加日志后端
        </Button>
      </Box>

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>名称</TableCell>
              <TableCell>集群</TableCell>
              <TableCell>类型</TableCell>
              <TableCell>地址</TableCell>
              <TableCell>状态</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <CircularProgress size={24} sx={{ my: 2 }} />
                </TableCell>
              </TableRow>
            )}
            {!loading && backends.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  暂无日志后端配置，点击右上角添加
                </TableCell>
              </TableRow>
            )}
            {!loading && backends.map((b) => (
              <TableRow key={b.id} hover>
                <TableCell>{b.name}</TableCell>
                <TableCell>{clusterMap[b.cluster_id] || `集群${b.cluster_id}`}</TableCell>
                <TableCell><Chip label={b.type.toUpperCase()} size="small" /></TableCell>
                <TableCell>{b.url}</TableCell>
                <TableCell>
                  <Chip
                    label={b.status === 'online' ? '有效' : b.status === 'offline' ? '无效' : '未知'}
                    color={b.status === 'online' ? 'success' : b.status === 'offline' ? 'error' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => handleOpenEdit(b)} title="编辑">
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleTest(b.id)} disabled={testingId === b.id} title="测试连接">
                    {testingId === b.id ? <CircularProgress size={18} /> : <TestIcon fontSize="small" />}
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(b.id)} title="删除">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? '编辑日志后端' : '添加日志后端'}</DialogTitle>
        <DialogContent>
          {dialogError && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }}>
              {dialogError}
            </Alert>
          )}
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>集群</InputLabel>
            <Select
              value={form.cluster_id || ''}
              label="集群"
              onChange={(e) => setForm({ ...form, cluster_id: Number(e.target.value) })}
              disabled={!!editingId}
            >
              {clusters.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            label="名称"
            placeholder="如：KS-OS-日志"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>后端类型</InputLabel>
            <Select
              value={form.type}
              label="后端类型"
              onChange={(e) => setForm({ ...form, type: e.target.value as any })}
            >
              <MenuItem value="elasticsearch">Elasticsearch</MenuItem>
              <MenuItem value="opensearch">OpenSearch</MenuItem>
              <MenuItem value="loki">Loki</MenuItem>
            </Select>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            label="URL"
            placeholder="http://elasticsearch.monitoring.svc:9200"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            size="small"
            label="用户名（可选）"
            value={form.username || ''}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            size="small"
            label="密码（可选）"
            type="password"
            value={form.password || ''}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            sx={{ mb: 2 }}
          />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            索引/标签模式
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="All / 全局"
            value={form.index_patterns?.all || ''}
            onChange={(e) => setForm({ ...form, index_patterns: { ...form.index_patterns, all: e.target.value } })}
            sx={{ mb: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Ingress"
            value={form.index_patterns?.ingress || ''}
            onChange={(e) => setForm({ ...form, index_patterns: { ...form.index_patterns, ingress: e.target.value } })}
            sx={{ mb: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label="CoreDNS"
            value={form.index_patterns?.coredns || ''}
            onChange={(e) => setForm({ ...form, index_patterns: { ...form.index_patterns, coredns: e.target.value } })}
            sx={{ mb: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label="LB"
            value={form.index_patterns?.lb || ''}
            onChange={(e) => setForm({ ...form, index_patterns: { ...form.index_patterns, lb: e.target.value } })}
            sx={{ mb: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label="App"
            value={form.index_patterns?.app || ''}
            onChange={(e) => setForm({ ...form, index_patterns: { ...form.index_patterns, app: e.target.value } })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button variant="outlined" onClick={handleDialogTest} disabled={dialogTesting}>
            {dialogTesting ? <CircularProgress size={18} sx={{ mr: 1 }} /> : null}
            测试连接
          </Button>
          <Button variant="contained" onClick={handleSave}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="删除日志后端配置"
        message="确定要删除此日志后端配置吗？"
        onClose={() => setConfirmOpen(false)}
        onConfirm={doDelete}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={closeSnack}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={closeSnack} severity={snack.severity} sx={{ width: '100%', borderRadius: '12px' }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

function GeneralSettings() {
  const { config, refresh } = useSiteConfig()
  const [name, setName] = useState(config.platform_name || '')
  const [desc, setDesc] = useState(config.platform_description || '')
  const [logoUrl, setLogoUrl] = useState(config.logo_url || '')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  useEffect(() => {
    setName(config.platform_name || '')
    setDesc(config.platform_description || '')
    setLogoUrl(config.logo_url || '')
  }, [config])

  const handleSave = async () => {
    setLoading(true)
    try {
      const res = await settingAPI.updateSiteConfig({
        platform_name: name,
        platform_description: desc,
        logo_url: logoUrl,
      })
      if (res.success) {
        setSnack({ open: true, message: '保存成功', severity: 'success' })
        await refresh()
      } else {
        setSnack({ open: true, message: res.error || '保存失败', severity: 'error' })
      }
    } catch (e: any) {
      setSnack({ open: true, message: e?.message || '保存失败', severity: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await settingAPI.uploadLogo(file)
      if (res.success && res.data?.logo_url) {
        setLogoUrl(res.data.logo_url)
        setSnack({ open: true, message: 'Logo 上传成功', severity: 'success' })
      } else {
        setSnack({ open: true, message: res.error || '上传失败', severity: 'error' })
      }
    } catch (e: any) {
      setSnack({ open: true, message: e?.message || '上传失败', severity: 'error' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        平台基本信息
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 600, mt: 2 }}>
        <Box>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
            平台 Logo
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {logoUrl ? (
              <Box
                component="img"
                src={logoUrl}
                alt="logo"
                sx={{ width: 64, height: 64, borderRadius: '12px', objectFit: 'contain', border: '1px solid', borderColor: 'divider' }}
              />
            ) : (
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: '12px',
                  bgcolor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="h5" sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
                  {name ? name[0] : 'C'}
                </Typography>
              </Box>
            )}
            <Button variant="outlined" component="label" size="small" disabled={uploading}>
              {uploading ? '上传中...' : '上传 Logo'}
              <input type="file" hidden accept="image/*" onChange={handleLogoChange} />
            </Button>
            {logoUrl && (
              <Button variant="text" color="error" size="small" onClick={() => setLogoUrl('')}>
                移除
              </Button>
            )}
          </Box>
        </Box>

        <TextField
          label="平台名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          size="small"
          placeholder="CloudOps"
        />

        <TextField
          label="平台介绍"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          fullWidth
          size="small"
          placeholder="云原生运维管理平台"
        />

        <Box>
          <Button variant="contained" onClick={handleSave} disabled={loading}>
            {loading ? '保存中...' : '保存设置'}
          </Button>
        </Box>
      </Box>

      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity={snack.severity} sx={{ width: '100%', borderRadius: '12px' }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default function Settings() {
  const [tab, setTab] = useState(0)

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={600} gutterBottom>
          系统设置
        </Typography>
        <Typography variant="body2" color="text.secondary">
          管理数据源、AI 平台和系统配置
        </Typography>
      </Box>

      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, pt: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Tab label="数据源" />
          <Tab label="AI 平台" />
          <Tab label="日志后端" />
          <Tab label="通用" />
        </Tabs>
        <CardContent sx={{ pt: 3 }}>
          {tab === 0 && <DataSourceSettings />}
          {tab === 1 && <AISettings />}
          {tab === 2 && <LogBackendSettings />}
          {tab === 3 && <GeneralSettings />}
        </CardContent>
      </Card>
    </Box>
  )
}
