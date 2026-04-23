import { useEffect, useState } from 'react'
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Chip,
} from '@mui/material'
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Home as HomeIcon,
} from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { dashboardAPI, Dashboard } from '../lib/dashboard-api'
import ConfirmDialog from '../components/ConfirmDialog'

export default function DashboardList() {
  const navigate = useNavigate()
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [createError, setCreateError] = useState('')

  const [deleteId, setDeleteId] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await dashboardAPI.list()
      if (res.success && Array.isArray(res.data)) {
        setDashboards(res.data)
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      setCreateError('请输入仪表盘名称')
      return
    }
    setCreateError('')
    try {
      const res = await dashboardAPI.create({ title: newTitle, description: newDesc })
      if (res.success && res.data) {
        setCreateOpen(false)
        setNewTitle('')
        setNewDesc('')
        navigate(`/dashboards/${res.data.id}`)
      } else {
        setCreateError(res.error || '创建失败')
      }
    } catch (err: any) {
      setCreateError(err.message || '创建失败')
    }
  }

  const handleSetDefault = async (id: number) => {
    try {
      const res = await dashboardAPI.setDefault(id)
      if (res.success) {
        load()
      }
    } catch (err: any) {
      setError(err.message || '设置失败')
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await dashboardAPI.delete(deleteId)
      setDeleteId(null)
      load()
    } catch (err: any) {
      setError(err.message || '删除失败')
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>仪表盘管理</Typography>
          <Typography variant="body2" color="text.secondary">创建和管理监控仪表盘</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          新建仪表盘
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2 }}>
        {dashboards.map((d) => (
          <Card key={d.id} variant="outlined" sx={{ cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}>
            <CardContent onClick={() => navigate(`/dashboards/${d.id}`)}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                <Typography variant="h6" fontWeight={600} noWrap sx={{ flex: 1 }}>
                  {d.title}
                </Typography>
                {d.is_default && <Chip label="首页" color="primary" size="small" />}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>
                {d.description || '暂无描述'}
              </Typography>
            </CardContent>
            <CardActions sx={{ justifyContent: 'flex-end' }}>
              {!d.is_default && (
                <Button size="small" startIcon={<HomeIcon />} onClick={() => handleSetDefault(d.id)}>
                  设为首页
                </Button>
              )}
              <IconButton size="small" onClick={() => navigate(`/dashboards/${d.id}`)}>
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => setDeleteId(d.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </CardActions>
          </Card>
        ))}
      </Box>

      {dashboards.length === 0 && !loading && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <Typography>暂无仪表盘，点击右上角创建</Typography>
        </Box>
      )}

      {/* 创建弹窗 */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>新建仪表盘</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
          <TextField
            label="名称"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            fullWidth
            margin="dense"
            autoFocus
          />
          <TextField
            label="描述"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            fullWidth
            margin="dense"
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleCreate}>创建</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        title="删除仪表盘"
        message="确定删除该仪表盘吗？其中的所有面板也会被删除。"
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </Box>
  )
}
