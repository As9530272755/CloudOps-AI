import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  Breadcrumbs,
  Link,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
} from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import FolderIcon from '@mui/icons-material/Folder'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import RefreshIcon from '@mui/icons-material/Refresh'
import { terminalAPI } from '../lib/terminal-api'

interface FileItem {
  name: string
  type: 'file' | 'dir'
  size: number
  mod_time: string
}

interface TerminalUploadDialogProps {
  open: boolean
  onClose: () => void
  clusterId: number
}

export default function TerminalUploadDialog({ open, onClose, clusterId }: TerminalUploadDialogProps) {
  const [currentPath, setCurrentPath] = useState('/root/')
  const [items, setItems] = useState<FileItem[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchFiles = useCallback(async () => {
    if (!clusterId) return
    setLoading(true)
    setError('')
    try {
      const res = await terminalAPI.listFiles(clusterId, currentPath)
      if (res.success && res.data) {
        setItems(res.data.items || [])
      } else {
        setError(res.error || '获取目录列表失败')
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '获取目录列表失败')
    } finally {
      setLoading(false)
    }
  }, [clusterId, currentPath])

  useEffect(() => {
    if (open) {
      setCurrentPath('/root/')
      setFile(null)
      setError('')
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      fetchFiles()
    }
  }, [open])

  useEffect(() => {
    if (open) {
      fetchFiles()
    }
  }, [currentPath, fetchFiles, open])

  const handleEnterDir = (dirName: string) => {
    const newPath = currentPath.endsWith('/') ? `${currentPath}${dirName}/` : `${currentPath}/${dirName}/`
    setCurrentPath(newPath)
  }

  const handleGoUp = () => {
    if (currentPath === '/root/') return
    const parts = currentPath.replace(/\/$/, '').split('/')
    parts.pop()
    const parent = parts.join('/') + '/'
    if (!parent.startsWith('/root/')) {
      setCurrentPath('/root/')
    } else {
      setCurrentPath(parent)
    }
  }

  const handleBreadcrumbClick = (index: number) => {
    const parts = currentPath.replace(/\/$/, '').split('/').filter(Boolean)
    const newParts = parts.slice(0, index + 1)
    const newPath = '/' + newParts.join('/') + '/'
    if (!newPath.startsWith('/root/')) {
      setCurrentPath('/root/')
    } else {
      setCurrentPath(newPath)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0])
      setError('')
    }
  }

  const handleUpload = async () => {
    if (!file) {
      setError('请选择要上传的文件')
      return
    }
    setUploading(true)
    setError('')
    try {
      await terminalAPI.uploadFile(clusterId, currentPath, file)
      setFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      fetchFiles()
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.error || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleClose = () => {
    setError('')
    setFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onClose()
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('zh-CN')
    } catch {
      return dateStr
    }
  }

  const breadcrumbParts = currentPath.replace(/\/$/, '').split('/').filter(Boolean)

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>上传文件到终端</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {/* 当前路径导航 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <IconButton size="small" onClick={handleGoUp} disabled={currentPath === '/root/'} title="返回上一级">
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={fetchFiles} disabled={loading} title="刷新">
            <RefreshIcon fontSize="small" />
          </IconButton>
          <Breadcrumbs separator="/" sx={{ flex: 1 }}>
            {breadcrumbParts.map((part, index) => (
              <Link
                key={index}
                component="button"
                underline="hover"
                color="inherit"
                onClick={() => handleBreadcrumbClick(index)}
                sx={{ cursor: 'pointer', fontSize: '0.875rem' }}
              >
                {part === 'root' ? '根目录' : part}
              </Link>
            ))}
          </Breadcrumbs>
        </Box>

        {/* 目录列表 */}
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>名称</TableCell>
                <TableCell>类型</TableCell>
                <TableCell>大小</TableCell>
                <TableCell>修改时间</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : items.filter((i) => i.type === 'dir').length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    <Typography color="text.secondary" sx={{ py: 2 }}>
                      此目录下没有子目录
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                items
                  .filter((i) => i.type === 'dir')
                  .map((item) => (
                    <TableRow key={item.name} hover>
                      <TableCell>
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
                          onClick={() => handleEnterDir(item.name)}
                        >
                          <FolderIcon color="primary" fontSize="small" />
                          <Typography variant="body2" color="primary.main">
                            {item.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>目录</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>{formatDate(item.mod_time)}</TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* 文件选择 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />
          <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileInputRef.current?.click()}>
            {file ? file.name : '选择文件'}
          </Button>
          {file && (
            <Typography variant="caption" color="text.secondary">
              大小: {(file.size / 1024).toFixed(1)} KB | 目标: {currentPath}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>取消</Button>
        <Button onClick={handleUpload} variant="contained" disabled={!file || uploading}>
          {uploading ? '上传中...' : '上传'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
