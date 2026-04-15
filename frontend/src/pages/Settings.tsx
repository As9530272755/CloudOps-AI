import { useEffect, useState } from 'react'
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
} from '@mui/material'
import { Delete as DeleteIcon, Edit as EditIcon, Refresh as TestIcon } from '@mui/icons-material'

import { DataSource, datasourceAPI, CreateDataSourceRequest } from '../lib/datasource-api'
import { aiPlatformAPI, AIPlatform, PlatformFormConfig } from '../lib/ai-platform-api'

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
  const [labelName, setLabelName] = useState('')
  const [error, setError] = useState('')
  const [testingId, setTestingId] = useState<number | null>(null)

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
      let parsedLabel = ''
      try {
        const cfg = JSON.parse(ds.config || '{}')
        parsedLabel = cfg.cluster_label_name || ''
      } catch {}
      setLabelName(parsedLabel)
    } else {
      setEditingId(null)
      setForm({ name: '', type: 'prometheus', url: '', config: '', cluster_id: undefined, is_default: false })
      setLabelName('')
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
      let cfg: any = {}
      try {
        cfg = JSON.parse(form.config || '{}')
      } catch {}
      if (labelName.trim()) {
        cfg.cluster_label_name = labelName.trim()
      } else {
        delete cfg.cluster_label_name
      }
      const payload = { ...form, config: JSON.stringify(cfg) }
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
    if (!confirm('确定要删除此数据源吗？使用该数据源的面板将无法正常显示。')) return
    try {
      await datasourceAPI.delete(id)
      load()
    } catch (err: any) {
      alert(err.message || '删除失败')
    }
  }

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      const result = await datasourceAPI.test(id)
      alert(result.success ? `连通成功: ${result.message}` : `连通失败: ${result.message}`)
    } catch (err: any) {
      alert(err.message || '测试失败')
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
                      label={ds.is_active ? '有效' : '禁用'}
                      color={ds.is_active ? 'success' : 'default'}
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
              label="集群区分标签名"
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
              fullWidth
              placeholder="cluster"
              helperText="用于 VictoriaMetrics / promxy 的 extra_label 过滤，如 cluster、env、team"
            />
            <TextField
              label="关联集群 ID"
              value={form.cluster_id ?? ''}
              onChange={(e) => setForm({ ...form, cluster_id: e.target.value ? Number(e.target.value) : undefined })}
              fullWidth
              type="number"
              placeholder="留空表示全局数据源（可被多个集群共用）"
              helperText="专属数据源直接绑定单个集群，不经过标签过滤"
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
    </Box>
  )
}

function AISettings() {
  const [platforms, setPlatforms] = useState<AIPlatform[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<{
    name: string
    provider_type: 'openclaw' | 'ollama' | ''
    config: PlatformFormConfig
  }>({
    name: '',
    provider_type: '',
    config: { url: '', token: '', model: '', timeout: 300, max_context_length: 4096, max_history_messages: 10 },
  })
  const [error, setError] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testingDialog, setTestingDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; severity: 'success' | 'error' } | null>(null)

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
              model: data.config?.model || (data.provider_type === 'ollama' ? 'llama3' : 'openclaw'),
              timeout: data.config?.timeout || (data.provider_type === 'ollama' ? 600 : 300),
              max_context_length: data.config?.max_context_length || (data.provider_type === 'ollama' ? 4096 : undefined),
              max_history_messages: data.config?.max_history_messages || 10,
            },
          })
        } else {
          setForm({
            name: p.name,
            provider_type: p.provider_type as any,
            config: { url: '', token: '', model: '', timeout: p.provider_type === 'ollama' ? 600 : 300, max_history_messages: 10 },
          })
        }
      } catch {
        setForm({
          name: p.name,
          provider_type: p.provider_type as any,
          config: { url: '', token: '', model: '', timeout: p.provider_type === 'ollama' ? 600 : 300 },
        })
      }
    } else {
      setEditingId(null)
      setForm({ name: '', provider_type: '', config: { url: '', token: '', model: '', timeout: 300, max_history_messages: 10 } })
    }
    setDialogOpen(true)
    setTestingDialog(false)
    setError('')
  }

  const handleSave = async () => {
    if (!form.name || !form.provider_type || !form.config.url) {
      setError('请填写名称、平台类型和服务地址')
      return
    }
    if (!form.config.model) {
      form.config.model = form.provider_type === 'ollama' ? 'llama3' : 'openclaw'
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
    if (!confirm('确定要删除此 AI 平台吗？')) return
    try {
      await aiPlatformAPI.delete(id)
      load()
    } catch (err: any) {
      alert(err.message || '删除失败')
    }
  }

  const handleTest = async (id: string) => {
    setTestingId(id)
    try {
      const res = await aiPlatformAPI.test(id)
      alert(res.success ? `连通成功: ${res.message}` : `连通失败: ${res.error}`)
      load()
    } catch (err: any) {
      alert(err.message || '测试失败')
    } finally {
      setTestingId(null)
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      await aiPlatformAPI.setDefault(id)
      load()
    } catch (err: any) {
      alert(err.message || '设置失败')
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
                    <Chip label={p.provider_type.toUpperCase()} size="small" />
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
                      model: pt === 'ollama' ? 'llama3' : 'openclaw',
                      timeout: pt === 'ollama' ? 600 : 300,
                      max_context_length: pt === 'ollama' ? 4096 : undefined,
                      max_history_messages: form.config.max_history_messages || 10,
                    },
                  })
                }}
              >
                <MenuItem value="openclaw">OpenClaw</MenuItem>
                <MenuItem value="ollama">Ollama</MenuItem>
              </Select>
            </FormControl>

            {form.provider_type && (
              <>
                <TextField
                  label="服务地址"
                  value={form.config.url}
                  onChange={(e) => setForm({ ...form, config: { ...form.config, url: e.target.value } })}
                  fullWidth
                  placeholder={form.provider_type === 'ollama' ? 'http://localhost:11434' : 'http://127.0.0.1:18789'}
                />
                {form.provider_type === 'openclaw' && (
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
                  placeholder={form.provider_type === 'ollama' ? 'llama3' : 'openclaw'}
                />
                <TextField
                  label="请求超时时长（秒）"
                  type="number"
                  value={form.config.timeout}
                  onChange={(e) => setForm({ ...form, config: { ...form.config, timeout: parseInt(e.target.value) || 300 } })}
                  fullWidth
                  placeholder="300"
                  helperText={form.provider_type === 'ollama' ? 'Ollama 首次加载模型较慢，建议 300 ~ 1200 秒' : '建议 60 ~ 1800 秒'}
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
          {editingId && (
            <Button
              variant="outlined"
              onClick={async () => {
                setTestingDialog(true)
                try {
                  const res = await aiPlatformAPI.test(editingId)
                  alert(res.success ? `连通成功: ${res.message}` : `连通失败: ${res.error}`)
                } catch (err: any) {
                  alert(err.message || '测试失败')
                } finally {
                  setTestingDialog(false)
                }
              }}
              disabled={testingDialog}
              sx={{ mr: 'auto' }}
            >
              {testingDialog ? <CircularProgress size={18} /> : '测试连接'}
            </Button>
          )}
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} sx={{ color: 'inherit' }} /> : '保存'}
          </Button>
        </DialogActions>
      </Dialog>
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
          <Tab label="通用" />
        </Tabs>
        <CardContent sx={{ pt: 3 }}>
          {tab === 0 && <DataSourceSettings />}
          {tab === 1 && <AISettings />}
          {tab === 2 && (
            <Typography variant="body2" color="text.secondary">
              更多设置项开发中...
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
