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
import { glassEffect } from '../theme/theme'
import { DataSource, datasourceAPI, CreateDataSourceRequest } from '../lib/datasource-api'

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
    is_default: false,
  })
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
        is_default: ds.is_default,
      })
    } else {
      setEditingId(null)
      setForm({ name: '', type: 'prometheus', url: '', config: '', is_default: false })
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
      if (editingId) {
        await datasourceAPI.update(editingId, form)
      } else {
        await datasourceAPI.create(form)
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
        <Button
          variant="contained"
          onClick={() => handleOpen()}
          sx={{
            background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
            color: 'white',
            borderRadius: '12px',
            textTransform: 'none',
            fontWeight: 600,
          }}
        >
          添加数据源
        </Button>
      </Box>

      <Card sx={{ ...glassEffect }}>
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

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { ...glassEffect, borderRadius: '16px' } }}
      >
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

export default function Settings() {
  const [tab, setTab] = useState(0)

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ mb: 3, ...glassEffect }}>
        <CardContent>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            系统设置
          </Typography>
          <Typography variant="body2" color="text.secondary">
            管理数据源、用户偏好和系统配置
          </Typography>
        </CardContent>
      </Card>

      <Card sx={{ ...glassEffect }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, pt: 1 }}>
          <Tab label="数据源" />
          <Tab label="通用" />
        </Tabs>
        <CardContent sx={{ pt: 3 }}>
          {tab === 0 && <DataSourceSettings />}
          {tab === 1 && (
            <Typography variant="body2" color="text.secondary">
              更多设置项开发中...
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
