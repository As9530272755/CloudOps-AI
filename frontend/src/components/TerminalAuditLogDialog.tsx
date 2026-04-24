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
  TablePagination,
  Paper,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Alert,
  TextField,
  IconButton,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { terminalAPI, type TerminalAuditLog } from '../lib/terminal-api'

interface TerminalAuditLogDialogProps {
  open: boolean
  onClose: () => void
  clusterId: number
}

export default function TerminalAuditLogDialog({ open, onClose, clusterId }: TerminalAuditLogDialogProps) {
  const [logs, setLogs] = useState<TerminalAuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [limit, setLimit] = useState(20)
  const [actionType, setActionType] = useState('')
  const [commandFilter, setCommandFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await terminalAPI.listAuditLogs({
        cluster_id: clusterId,
        action_type: actionType || undefined,
        command: commandFilter || undefined,
        page: page + 1,
        limit,
      })
      if (res.success && res.data) {
        setLogs(res.data.list)
        setTotal(res.data.total)
      } else {
        setError(res.error || '获取审计日志失败')
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '获取审计日志失败')
    } finally {
      setLoading(false)
    }
  }, [clusterId, actionType, commandFilter, page, limit])

  useEffect(() => {
    if (open) {
      fetchLogs()
    }
  }, [open, fetchLogs])

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage)
  }

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLimit(parseInt(event.target.value, 10))
    setPage(0)
  }

  const getActionChipColor = (type: string) => {
    switch (type) {
      case 'login':
        return 'success'
      case 'logout':
        return 'default'
      case 'command':
        return 'primary'
      default:
        return 'default'
    }
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('zh-CN')
    } catch {
      return dateStr
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>终端审计日志</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>动作类型</InputLabel>
            <Select
              value={actionType}
              label="动作类型"
              onChange={(e) => {
                setActionType(e.target.value)
                setPage(0)
              }}
            >
              <MenuItem value="">全部</MenuItem>
              <MenuItem value="login">登录</MenuItem>
              <MenuItem value="command">命令</MenuItem>
              <MenuItem value="logout">登出</MenuItem>
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="命令筛选"
            placeholder="输入命令关键字"
            value={commandFilter}
            onChange={(e) => setCommandFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(0)
                fetchLogs()
              }
            }}
            InputProps={{
              endAdornment: (
                <IconButton size="small" onClick={() => { setPage(0); fetchLogs() }}>
                  <SearchIcon fontSize="small" />
                </IconButton>
              ),
            }}
            sx={{ minWidth: 240 }}
          />
        </Box>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 160 }}>时间</TableCell>
                <TableCell sx={{ minWidth: 80 }}>用户</TableCell>
                <TableCell sx={{ minWidth: 90 }}>类型</TableCell>
                <TableCell sx={{ minWidth: 200 }}>命令</TableCell>
                <TableCell sx={{ minWidth: 120 }}>工作目录</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography color="text.secondary" sx={{ py: 3 }}>
                      暂无审计日志
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id} hover>
                    <TableCell>{formatDate(log.created_at)}</TableCell>
                    <TableCell>{log.username}</TableCell>
                    <TableCell>
                      <Chip
                        label={log.action_type}
                        color={getActionChipColor(log.action_type) as any}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography
                        component="pre"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.8rem',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          m: 0,
                        }}
                        title={log.command}
                      >
                        {log.command || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>{log.working_dir || '-'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={limit}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[10, 20, 50]}
          labelRowsPerPage="每页"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button onClick={fetchLogs} variant="outlined" disabled={loading}>
          刷新
        </Button>
      </DialogActions>
    </Dialog>
  )
}
