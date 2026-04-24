import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Breadcrumbs,
  Link,
  Typography,
  Box,
  IconButton,
  Alert,
  CircularProgress,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import FolderIcon from '@mui/icons-material/Folder'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import RefreshIcon from '@mui/icons-material/Refresh'
import { terminalAPI } from '../lib/terminal-api'

interface FileItem {
  name: string
  type: 'file' | 'dir'
  size: number
  mod_time: string
}

interface TerminalDownloadDialogProps {
  open: boolean
  onClose: () => void
  clusterId: number
}

export default function TerminalDownloadDialog({ open, onClose, clusterId }: TerminalDownloadDialogProps) {
  const [currentPath, setCurrentPath] = useState('/root/')
  const [items, setItems] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState('')

  const fetchFiles = useCallback(async () => {
    if (!clusterId) return
    setLoading(true)
    setError('')
    try {
      const res = await terminalAPI.listFiles(clusterId, currentPath)
      if (res.success && res.data) {
        setItems(res.data.items || [])
      } else {
        setError(res.error || '获取文件列表失败')
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '获取文件列表失败')
    } finally {
      setLoading(false)
    }
  }, [clusterId, currentPath])

  useEffect(() => {
    if (open) {
      setCurrentPath('/root/')
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

  const handleDownload = async (fileName: string) => {
    const filePath = currentPath.endsWith('/')
      ? `${currentPath}${fileName}`
      : `${currentPath}/${fileName}`
    setDownloading(fileName)
    try {
      await terminalAPI.downloadFile(clusterId, filePath)
    } catch (err: any) {
      setError(err.response?.data?.error || '下载失败')
    } finally {
      setDownloading('')
    }
  }

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
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
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>从终端下载文件</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {/* 工具栏 */}
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

        {/* 文件列表 */}
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>名称</TableCell>
                <TableCell>类型</TableCell>
                <TableCell>大小</TableCell>
                <TableCell>修改时间</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography color="text.secondary" sx={{ py: 3 }}>
                      目录为空
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.name} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {item.type === 'dir' ? (
                          <FolderIcon color="primary" fontSize="small" />
                        ) : (
                          <InsertDriveFileIcon color="action" fontSize="small" />
                        )}
                        <Typography
                          variant="body2"
                          sx={{
                            cursor: item.type === 'dir' ? 'pointer' : 'default',
                            color: item.type === 'dir' ? 'primary.main' : 'inherit',
                          }}
                          onClick={() => {
                            if (item.type === 'dir') {
                              handleEnterDir(item.name)
                            }
                          }}
                        >
                          {item.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>{item.type === 'dir' ? '目录' : '文件'}</TableCell>
                    <TableCell>{item.type === 'dir' ? '-' : formatSize(item.size)}</TableCell>
                    <TableCell>{formatDate(item.mod_time)}</TableCell>
                    <TableCell align="right">
                      {item.type === 'file' && (
                        <Button
                          size="small"
                          startIcon={<DownloadIcon />}
                          onClick={() => handleDownload(item.name)}
                          disabled={downloading === item.name}
                        >
                          {downloading === item.name ? '下载中' : '下载'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
