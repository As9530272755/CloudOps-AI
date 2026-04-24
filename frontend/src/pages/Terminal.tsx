import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tab,
  Tabs,
  Typography,
  Paper,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import AddIcon from '@mui/icons-material/Add'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import DownloadIcon from '@mui/icons-material/Download'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { clusterAPI } from '../lib/cluster-api'
import TerminalUploadDialog from '../components/TerminalUploadDialog'
import TerminalDownloadDialog from '../components/TerminalDownloadDialog'
import TerminalAuditLogDialog from '../components/TerminalAuditLogDialog'

interface TerminalCluster {
  id: number
  name: string
  metadata?: {
    health_status?: string
  }
}

interface Session {
  id: string
  clusterId: number
  clusterName: string
  xterm: XTerm
  fitAddon: FitAddon
  ws?: WebSocket
  containerRef: React.RefObject<HTMLDivElement>
}

export default function TerminalPage() {
  const [clusters, setClusters] = useState<TerminalCluster[]>([])
  const [selectedCluster, setSelectedCluster] = useState<number | ''>('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [auditLogOpen, setAuditLogOpen] = useState(false)
  const token = localStorage.getItem('access_token') || ''

  // 加载集群列表（只保留 healthy 状态的集群）
  useEffect(() => {
    clusterAPI
      .getClusters()
      .then((res: any) => {
        const payload = res?.data ?? res
        const list: TerminalCluster[] = Array.isArray(payload) ? payload : []
        const healthyList = list.filter((c) => c.metadata?.health_status === 'healthy')
        setClusters(healthyList)
        if (healthyList.length > 0) {
          setSelectedCluster(healthyList[0].id)
        } else {
          setSelectedCluster('')
        }
      })
      .catch((err) => {
        console.error('加载集群列表失败:', err)
      })
  }, [])

  const createSession = () => {
    if (!selectedCluster || !token) return
    const cluster = clusters.find((c) => c.id === Number(selectedCluster))
    if (!cluster) return

    const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const containerRef = { current: null as HTMLDivElement | null }

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace, "Apple Color Emoji"',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)

    const newSession: Session = {
      id: sessionId,
      clusterId: cluster.id,
      clusterName: cluster.name,
      xterm,
      fitAddon,
      containerRef: containerRef as React.RefObject<HTMLDivElement>,
    }

    setSessions((prev) => [...prev, newSession])
    setActiveTab(sessionId)

    // DOM 挂载后再 open terminal
    setTimeout(() => {
      if (containerRef.current) {
        xterm.open(containerRef.current)
        fitAddon.fit()
        xterm.focus()
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl =
        `${proto}//${window.location.host}/ws/terminal` +
        `?cluster_id=${cluster.id}` +
        `&token=${encodeURIComponent(token)}`

      const ws = new WebSocket(wsUrl)
      newSession.ws = ws

      ws.onopen = () => {
        // 发送初始尺寸
        const dims = fitAddon.proposeDimensions()
        if (dims) {
          ws.send(JSON.stringify({ cols: dims.cols, rows: dims.rows }))
        }
      }

      ws.onmessage = (event) => {
        xterm.write(event.data)
      }

      ws.onerror = () => {
        xterm.writeln('\r\n\x1b[31m[WebSocket 连接错误]\x1b[0m')
      }

      ws.onclose = () => {
        xterm.writeln('\r\n\x1b[33m[连接已关闭]\x1b[0m')
      }

      xterm.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      })

      const handleResize = () => {
        try {
          fitAddon.fit()
          const d = fitAddon.proposeDimensions()
          if (d && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ cols: d.cols, rows: d.rows }))
          }
        } catch {}
      }

      window.addEventListener('resize', handleResize)

      const origClose = ws.close.bind(ws)
      ws.close = () => {
        window.removeEventListener('resize', handleResize)
        origClose()
      }
    }, 0)
  }

  // 切换 Tab 后自动聚焦终端
  useEffect(() => {
    if (activeTab) {
      const session = sessions.find((s) => s.id === activeTab)
      if (session) {
        setTimeout(() => session.xterm.focus(), 0)
      }
    }
  }, [activeTab, sessions])

  const closeSession = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId)
    if (session) {
      try {
        session.ws?.close()
      } catch {}
      session.xterm.dispose()
    }
    const remaining = sessions.filter((s) => s.id !== sessionId)
    setSessions(remaining)
    if (activeTab === sessionId) {
      setActiveTab(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
  }

  const activeSession = sessions.find((s) => s.id === activeTab)
  const activeClusterId = activeSession ? activeSession.clusterId : Number(selectedCluster)

  return (
    <Box sx={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', p: 0 }}>
      {/* Header */}
      <Box sx={{ px: 3, pt: 2, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Web 终端
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel>集群</InputLabel>
            <Select
              value={selectedCluster}
              label="集群"
              onChange={(e) => setSelectedCluster(Number(e.target.value))}
              disabled={clusters.length === 0}
            >
              {clusters.length === 0 && (
                <MenuItem disabled value="">暂无健康集群</MenuItem>
              )}
              {clusters.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={createSession}
            disabled={!selectedCluster || !token || clusters.length === 0}
          >
            新建连接
          </Button>

          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadFileIcon />}
            onClick={() => setUploadOpen(true)}
            disabled={!activeClusterId}
          >
            上传
          </Button>

          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={() => setDownloadOpen(true)}
            disabled={!activeClusterId}
          >
            下载
          </Button>

          <Button
            variant="outlined"
            size="small"
            startIcon={<VisibilityIcon />}
            onClick={() => setAuditLogOpen(true)}
            disabled={!activeClusterId}
          >
            审计日志
          </Button>
        </Box>
      </Box>

      {/* Tabs */}
      {sessions.length > 0 && (
        <Tabs
          value={activeTab || false}
          onChange={(_, val) => setActiveTab(val)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 40, borderBottom: '1px solid', borderColor: 'divider', px: 1 }}
        >
          {sessions.map((s) => (
            <Tab
              key={s.id}
              value={s.id}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="caption" sx={{ fontWeight: activeTab === s.id ? 600 : 400 }}>
                    {s.clusterName}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeSession(s.id)
                    }}
                    sx={{ p: 0.2, ml: 0.5 }}
                  >
                    <CloseIcon fontSize="inherit" />
                  </IconButton>
                </Box>
              }
              sx={{ textTransform: 'none', minHeight: 36, px: 1 }}
            />
          ))}
        </Tabs>
      )}

      {/* Terminal Containers */}
      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {sessions.length === 0 && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
            }}
          >
            <Typography>请选择集群并点击"新建连接"打开终端</Typography>
          </Box>
        )}

        {sessions.map((s) => (
          <Paper
            key={s.id}
            ref={s.containerRef}
            elevation={0}
            onClick={() => s.xterm.focus()}
            sx={{
              position: 'absolute',
              inset: 0,
              bgcolor: '#1e1e1e',
              p: 1,
              display: activeTab === s.id ? 'block' : 'none',
              overflow: 'hidden',
              '& .xterm-viewport': {
                backgroundColor: '#1e1e1e !important',
              },
            }}
          />
        ))}
      </Box>

      {/* Dialogs */}
      <TerminalUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        clusterId={activeClusterId}
      />
      <TerminalDownloadDialog
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        clusterId={activeClusterId}
      />
      <TerminalAuditLogDialog
        open={auditLogOpen}
        onClose={() => setAuditLogOpen(false)}
        clusterId={activeClusterId}
      />
    </Box>
  )
}
