import { useState, useEffect } from 'react'
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
} from '@mui/material'
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  CloudQueue as ClusterIcon,
  ArrowForward as EnterIcon,
} from '@mui/icons-material'
import { glassEffect } from '../theme/theme'
import { clusterAPI, Cluster, CreateClusterRequest } from '../../lib/cluster-api'

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
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(false)
  const [openDialog, setOpenDialog] = useState(false)
  const [authType, setAuthType] = useState<'kubeconfig' | 'token'>('kubeconfig')
  const [formData, setFormData] = useState<CreateClusterRequest>({
    name: '',
    display_name: '',
    description: '',
    auth_type: 'kubeconfig',
    kubeconfig: '',
    token: '',
    server: '',
  })
  const [error, setError] = useState('')
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null)

  // 加载集群列表
  const loadClusters = async () => {
    setLoading(true)
    try {
      const result = await clusterAPI.getClusters()
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

  // 处理创建集群
  const handleCreate = async () => {
    try {
      const result = await clusterAPI.createCluster({
        ...formData,
        auth_type: authType,
      })
      if (result.success) {
        setOpenDialog(false)
        setFormData({
          name: '',
          display_name: '',
          description: '',
          auth_type: 'kubeconfig',
          kubeconfig: '',
          token: '',
          server: '',
        })
        loadClusters()
      }
    } catch (err: any) {
      setError(err.message || '创建集群失败')
    }
  }

  // 处理删除集群
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
      <Card sx={{ mb: 3, ...glassEffect }}>
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
              onClick={() => setOpenDialog(true)}
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

      {/* 集群列表 */}
      <Card sx={{ ...glassEffect }}>
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
                  {clusters.map((cluster) => (
                    <TableRow
                      key={cluster.id}
                      hover
                      onClick={() => setSelectedCluster(cluster)}
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
                        {cluster.version || '-'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={statusLabels[cluster.status || 'pending']}
                          color={statusColors[cluster.status || 'pending']}
                          size="small"
                          sx={{ borderRadius: '6px' }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {cluster.node_count !== undefined ? `${cluster.node_count} 节点` : '-'}
                          {cluster.pod_count !== undefined && ` / ${cluster.pod_count} Pod`}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="进入集群">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedCluster(cluster)
                            }}
                          >
                            <EnterIcon />
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
            ...glassEffect,
            borderRadius: '16px',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>
          添加 Kubernetes 集群
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

            {/* 集群名称 */}
            <TextField
              label="集群名称"
              placeholder="例如：prod-k8s"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              required
            />

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

            {/* 根据认证方式显示不同输入 */}
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
            onClick={handleCreate}
            variant="contained"
            sx={{
              background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
              color: 'white',
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            确定添加
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
