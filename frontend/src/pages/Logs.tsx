import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Typography,
  Button,
  Tabs,
  Tab,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Paper,
  Alert,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Collapse,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  Avatar,
  TablePagination,
} from '@mui/material'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import dayjs, { Dayjs } from 'dayjs'
import {
  Search as SearchIcon,
  Psychology as AIIcon,
  ContentCopy as CopyIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Clear as ClearIcon,
  Send as SendIcon,
  Close as CloseIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
} from '@mui/icons-material'
import * as echarts from 'echarts'
import { Virtuoso } from 'react-virtuoso'
import { clusterAPI } from '../lib/cluster-api'
import { k8sAPI } from '../lib/k8s-api'
import { logBackendAPI, LogBackend } from '../lib/log-backend-api'
import { logAPI, LogEntry } from '../lib/log-api'
import { aiChatAPI, Message } from '../lib/ai-chat-api'
import { aiPlatformAPI, AIPlatform } from '../lib/ai-platform-api'
import { aiSessionAPI } from '../lib/ai-session-api'
import ContentBlock, { copyToClipboard } from '../components/ContentBlock'
import { compressImage, readTextFile } from '../lib/file-utils'

interface Cluster {
  id: number
  name: string
  display_name?: string
}

type LogType = 'all' | 'ingress' | 'coredns' | 'lb'

// 原预设时间选项已移除，当前使用自定义 datetime-local 范围选择
// const TIME_OPTIONS = [
//   { label: '最近 15 分钟', value: 15 * 60 * 1000 },
//   { label: '最近 1 小时', value: 60 * 60 * 1000 },
//   { label: '最近 6 小时', value: 6 * 60 * 60 * 1000 },
//   { label: '最近 24 小时', value: 24 * 60 * 60 * 1000 },
//   { label: '最近 7 天', value: 7 * 24 * 60 * 60 * 1000 },
// ]

const LEVEL_COLORS: Record<string, string> = {
  error: '#ef4444',
  err: '#ef4444',
  fatal: '#b91c1c',
  warn: '#f59e0b',
  warning: '#f59e0b',
  info: '#3b82f6',
  debug: '#9ca3af',
  trace: '#d1d5db',
}

function formatTime(d: Dayjs) {
  return d.toISOString()
}

// 时间范围硬限制已完全解除，原 getMaxTimeMs 逻辑保留如下以备后续参考：
// function getMaxTimeMs(backendCount: number) {
//   if (backendCount === 1) return TIME_OPTIONS[4].value
//   if (backendCount <= 3) return TIME_OPTIONS[3].value
//   if (backendCount <= 5) return TIME_OPTIONS[2].value
//   if (backendCount <= 10) return TIME_OPTIONS[1].value
//   return TIME_OPTIONS[0].value
// }

function detectLevel(entry: LogEntry): string {
  const msg = (entry.message || '').toLowerCase()
  const lvl = String(entry.fields?.level || entry.fields?.severity || entry.fields?.log_level || '').toLowerCase()
  if (msg.includes('noerror')) return 'info'
  if (lvl.includes('error') || lvl.includes('err') || msg.includes('error') || msg.includes('exception')) return 'error'
  if (lvl.includes('warn') || lvl.includes('warning') || msg.includes('warn')) return 'warn'
  if (lvl.includes('info')) return 'info'
  if (lvl.includes('debug')) return 'debug'
  if (lvl.includes('trace')) return 'trace'
  return 'other'
}

function HighlightText({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword.trim()) return <>{text}</>
  const parts = text.split(new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
          <Box component="span" key={i} sx={{ bgcolor: '#fde047', color: '#1f2937', px: 0.3, borderRadius: 0.5 }}>
            {part}
          </Box>
        ) : (
          part
        )
      )}
    </>
  )
}

function StatCards({
  total,
  errorCount,
  warnCount,
  infoCount,
  otherCount,
  activeLevel,
  onLevelClick,
}: {
  total: number
  errorCount: number
  warnCount: number
  infoCount: number
  otherCount: number
  activeLevel?: string
  onLevelClick?: (level: string) => void
}) {
  const items = [
    { label: '总日志数', value: total, color: '#6366f1', level: '' },
    { label: 'Error', value: errorCount, color: '#ef4444', level: 'error' },
    { label: 'Warn', value: warnCount, color: '#f59e0b', level: 'warn' },
    { label: 'Info', value: infoCount, color: '#3b82f6', level: 'info' },
    { label: '其他', value: otherCount, color: '#9ca3af', level: 'other' },
  ]
  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
      {items.map((it) => {
        const isActive = activeLevel === it.level
        const isLevelFilterActive = activeLevel !== ''
        return (
          <Card
            key={it.label}
            elevation={0}
            onClick={() => onLevelClick?.(it.level)}
            sx={{
              flex: 1,
              minWidth: 120,
              border: '1px solid',
              borderColor: isActive ? it.color : 'divider',
              bgcolor: isActive ? `${it.color}08` : 'background.paper',
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': { borderColor: it.color, bgcolor: `${it.color}12` },
              opacity: isLevelFilterActive && !isActive ? 0.7 : 1,
            }}
          >
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="h5" fontWeight={700} sx={{ color: it.color }}>
                {it.value.toLocaleString()}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {it.label}
              </Typography>
            </CardContent>
          </Card>
        )
      })}
    </Box>
  )
}

function LogRow({
  entry,
  clusterMap,
  keyword,
  selected,
  onSelect,
}: {
  entry: LogEntry
  clusterMap: Record<number, string>
  keyword: string
  selected: boolean
  onSelect: () => void
}) {
  const [open, setOpen] = useState(false)
  const level = detectLevel(entry)
  const levelColor = LEVEL_COLORS[level] || '#e5e7eb'
  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString('zh-CN') : '-'
  const location = [
    clusterMap[entry.cluster_id] || '未知集群',
    entry.namespace,
    entry.pod_name,
    entry.container,
  ]
    .filter(Boolean)
    .join(' / ')

  return (
    <Box sx={{ display: 'flex', position: 'relative', mb: 1 }}>
      <Box sx={{ width: 4, bgcolor: levelColor, borderRadius: '4px 0 0 4px', mr: 1.5, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            borderRadius: '0 8px 8px 0',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            '&:hover': { bgcolor: 'action.hover' },
            transition: 'background 0.2s',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Checkbox size="small" checked={selected} onChange={onSelect} sx={{ p: 0 }} />
                <Typography variant="caption" color="text.secondary">
                  {ts} · {location}
                </Typography>
              </Box>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'text.primary',
                  lineHeight: 1.5,
                  pl: 3.5,
                }}
              >
                <HighlightText text={entry.message} keyword={keyword} />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              {entry.fields?.status !== undefined && (
                <Chip
                  label={String(entry.fields.status)}
                  size="small"
                  color={Number(entry.fields.status) >= 400 ? 'error' : 'success'}
                  sx={{ height: 20, fontSize: 11 }}
                />
              )}
              <Tooltip title={open ? '收起详情' : '展开详情'}>
                <IconButton size="small" onClick={() => setOpen((v) => !v)}>
                  {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          <Collapse in={open}>
            <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px dashed', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                结构化字段
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'text.secondary',
                }}
              >
                {JSON.stringify(entry.fields || {}, null, 2)}
              </Box>
            </Box>
          </Collapse>
        </Paper>
      </Box>
    </Box>
  )
}

interface ChatMessage extends Message {
  id: string
}

function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

export default function Logs() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [backends, setBackends] = useState<LogBackend[]>([])
  const [selectedBackends, setSelectedBackends] = useState<number[]>([])
  const [logType, setLogType] = useState<LogType>('all')
  const [customFrom, setCustomFrom] = useState<Dayjs>(dayjs().subtract(15, 'minute'))
  const [customTo, setCustomTo] = useState<Dayjs>(dayjs())
  const [keyword, setKeyword] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [levelCounts, setLevelCounts] = useState<Record<string, number> | null>(null)
  const [globalLevelCounts, setGlobalLevelCounts] = useState<Record<string, number> | null>(null)
  const [histogram, setHistogram] = useState<{ time: string; count: number }[]>([])
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [perBackendErrors, setPerBackendErrors] = useState<string[]>([])
  const [queryMessages, setQueryMessages] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [globalTotal, setGlobalTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [aiPlatforms, setAiPlatforms] = useState<AIPlatform[]>([])
  const [selectedPlatformId, setSelectedPlatformId] = useState<string>('')

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [analysisSessionId, setAnalysisSessionId] = useState<string>('')

  const [namespaces, setNamespaces] = useState<string[]>([])
  const [selectedNamespace, setSelectedNamespace] = useState('')

  const [chatPendingImages, setChatPendingImages] = useState<string[]>([])
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const chatFileInputRef = useRef<HTMLInputElement>(null)
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const histogramRef = useRef(histogram)
  const queryIdRef = useRef(0)

  useEffect(() => {
    histogramRef.current = histogram
  }, [histogram])

  const clusterMap = useMemo(() => {
    const map: Record<number, string> = {}
    clusters.forEach((c) => {
      map[c.id] = c.display_name || c.name || ''
    })
    return map
  }, [clusters])

  useEffect(() => {
    if (selectedBackends.length === 0) {
      setNamespaces([])
      setSelectedNamespace('')
      return
    }
    const backend = backends.find((b) => b.id === selectedBackends[0])
    if (!backend) return
    k8sAPI.getNamespaces(backend.cluster_id).then((res: any) => {
      if (res.success && Array.isArray(res.data)) {
        setNamespaces(res.data)
      } else {
        setNamespaces([])
      }
    }).catch(() => {
      setNamespaces([])
    })
  }, [selectedBackends, backends])

  const filteredEntries = entries

  useEffect(() => {
    clusterAPI.getClusters().then((res: any) => {
      if (res.success && res.data) {
        const list: Cluster[] = Array.isArray(res.data) ? res.data : res.data.clusters || []
        setClusters(list)
      }
    })
    logBackendAPI.list().then((res) => {
      if (res.success && res.data) {
        setBackends(res.data)
        if (res.data.length > 0) {
          setSelectedBackends([res.data[0].id])
        }
      }
    })
    aiPlatformAPI.list().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setAiPlatforms(res.data)
        const def = res.data.find((p) => p.is_default)
        if (def) {
          setSelectedPlatformId(def.id)
        } else if (res.data.length > 0) {
          setSelectedPlatformId(res.data[0].id)
        }
      }
    })
  }, [])

  // 时间范围限制已解除，保留函数但不再使用
  // const maxDurationLabel = useMemo(() => {
  //   const max = getMaxTimeMs(selectedBackends.length)
  //   return TIME_OPTIONS.find((o) => o.value === max)?.label || ''
  // }, [selectedBackends])

  const stats = useMemo(() => {
    let errorCount = 0
    let warnCount = 0
    let infoCount = 0
    let otherCount = 0
    const counts = globalLevelCounts ?? levelCounts
    if (counts) {
      Object.entries(counts).forEach(([k, v]) => {
        const key = k.toLowerCase()
        if (key.includes('error') || key.includes('err')) errorCount += v
        else if (key.includes('warn') || key.includes('warning')) warnCount += v
        else if (key === 'info') infoCount += v
        else if (key === 'debug' || key === 'trace') otherCount += v
        else otherCount += v
      })
    } else {
      entries.forEach((e) => {
        const lvl = detectLevel(e)
        if (lvl === 'error') errorCount++
        else if (lvl === 'warn') warnCount++
        else if (lvl === 'info') infoCount++
        else otherCount++
      })
    }
    return { errorCount, warnCount, infoCount, otherCount }
  }, [entries, levelCounts, globalLevelCounts])

  const handleBackendChange = (e: any) => {
    const value = e.target.value as number[]
    setSelectedBackends(value)
  }

  const toggleSelect = (idx: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  const selectAllFiltered = () => {
    const visibleIndices = filteredEntries.map((e) => entries.indexOf(e)).filter((idx) => idx >= 0)
    const allSelected = visibleIndices.every((idx) => selectedIds.has(idx))
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        visibleIndices.forEach((idx) => next.delete(idx))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        visibleIndices.forEach((idx) => next.add(idx))
        return next
      })
    }
  }

  const handleCopySelected = () => {
    const selectedEntries = Array.from(selectedIds)
      .map((idx) => entries[idx])
      .filter(Boolean)
    if (selectedEntries.length === 0) return
    const text = selectedEntries.map((e) => e.message).join('\n')
    copyToClipboard(text)
  }

  const handleKeyDownQuery = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleQuery()
    }
  }

  const buildReq = (
    limit: number,
    offset: number,
    opts?: {
      logType?: LogType
      filters?: Record<string, string>
      keyword?: string
      selectedNamespace?: string
      customFrom?: Dayjs
      customTo?: Dayjs
    }
  ) => {
    const lt = opts?.logType ?? logType
    const f: Record<string, string> = { ...(opts?.filters ?? filters) }
    const kw = opts?.keyword ?? keyword
    const ns = opts?.selectedNamespace ?? selectedNamespace
    const from = opts?.customFrom ?? customFrom
    const to = opts?.customTo ?? customTo
    if (kw.trim()) {
      f.keyword = kw.trim()
    }
    if (ns.trim()) {
      f.namespace = ns.trim()
    }
    return {
      backend_ids: selectedBackends,
      log_type: lt,
      time_range: {
        from: formatTime(from),
        to: formatTime(to),
      },
      filters: f,
      limit,
      offset,
      mode: 'detail' as const,
    }
  }

  const executeQuery = async (req: any) => {
    const queryId = ++queryIdRef.current
    setLoading(true)
    setError('')
    setPerBackendErrors([])
    setQueryMessages([])

    try {
      const [queryRes, histRes] = await Promise.all([
        logAPI.query(req),
        selectedBackends.length === 1
          ? logAPI.histogram({ ...req, backend_id: selectedBackends[0] })
          : Promise.resolve(null),
      ])

      // 竞态保护：只处理最新请求的结果
      if (queryId !== queryIdRef.current) return

      if (queryRes.success && queryRes.data) {
        setEntries(queryRes.data.entries || [])
        setTotal(queryRes.data.total || 0)
        setLevelCounts(queryRes.data.level_counts || null)
        if (!req.filters?.level) {
          setGlobalLevelCounts(queryRes.data.level_counts || null)
          setGlobalTotal(queryRes.data.total || 0)
        }

        const backendErrs: string[] = []
        const backendMsgs: string[] = []
        ;(queryRes.data.backend_results || []).forEach((r: any) => {
          if (r.error) {
            const b = backends.find((x) => x.id === r.backend_id)
            const cname = clusterMap[b?.cluster_id || 0] || `集群${b?.cluster_id}`
            const bname = b?.name || `后端${r.backend_id}`
            let msg = r.error
            if (msg.includes('no such host') || msg.includes('lookup')) {
              msg = '地址无法解析（可能是集群内部域名），请修改为 NodePort 或外部可访问地址'
            }
            backendErrs.push(`${cname} / ${bname}: ${msg}`)
          }
          if (r.message) {
            const b = backends.find((x) => x.id === r.backend_id)
            const cname = clusterMap[b?.cluster_id || 0] || `集群${b?.cluster_id}`
            const bname = b?.name || `后端${r.backend_id}`
            backendMsgs.push(`${cname} / ${bname}: ${r.message}`)
          }
        })
        if (backendErrs.length > 0) {
          setPerBackendErrors(backendErrs)
        }
        if (backendMsgs.length > 0) {
          setQueryMessages(backendMsgs)
        }
      } else {
        setError(queryRes.error || '查询失败')
        setEntries([])
        setTotal(0)
        setLevelCounts(null)
      }

      if (histRes?.success && histRes.data) {
        setHistogram(histRes.data.histogram || [])
      } else if (selectedBackends.length !== 1) {
        setHistogram([])
      }
    } catch (err: any) {
      if (queryId !== queryIdRef.current) return
      setError(err.message || '请求异常')
      setEntries([])
      setTotal(0)
      setLevelCounts(null)
    } finally {
      if (queryId === queryIdRef.current) {
        setLoading(false)
      }
    }
  }

  const handleQuery = async () => {
    if (selectedBackends.length === 0) {
      setError('请至少选择一个日志后端')
      return
    }
    if (selectedBackends.length > 20) {
      setError('一次最多选择 20 个后端')
      return
    }
    if (customFrom.valueOf() >= customTo.valueOf()) {
      setError('结束时间必须晚于开始时间')
      return
    }
    setPage(1)
    setSelectedIds(new Set())
    await executeQuery(buildReq(pageSize, 0))
  }

  const handleChangePage = (_: unknown, newPage: number) => {
    const nextPage = newPage + 1
    setPage(nextPage)
    setSelectedIds(new Set())
    executeQuery(buildReq(pageSize, (nextPage - 1) * pageSize))
  }

  const handleChangeRowsPerPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ps = parseInt(e.target.value, 10)
    setPageSize(ps)
    setPage(1)
    setSelectedIds(new Set())
    executeQuery(buildReq(ps, 0))
  }

  const ensureAnalysisSession = async () => {
    if (analysisSessionId) return analysisSessionId
    if (!selectedPlatformId) return ''
    const res = await aiSessionAPI.create(selectedPlatformId, '日志分析')
    if (res.success && res.data && !Array.isArray(res.data)) {
      setAnalysisSessionId(res.data.id)
      return res.data.id
    }
    return ''
  }

  const buildSelectedLogSample = (maxChars = 12000) => {
    const selectedEntries = Array.from(selectedIds)
      .sort((a, b) => a - b)
      .map((idx) => entries[idx])
      .filter(Boolean)
    if (selectedEntries.length === 0) return ''
    const sb: string[] = []
    let len = 0
    for (const e of selectedEntries) {
      const line = `[${e.timestamp}] ${e.namespace || ''}/${e.pod_name || ''}/${e.container || ''}: ${e.message}`
      if (len + line.length + 1 > maxChars) {
        sb.push('... (更多日志已截断)')
        break
      }
      sb.push(line)
      len += line.length + 1
    }
    return sb.join('\n')
  }

  const handleAnalyze = async () => {
    if (selectedIds.size === 0) {
      setError('请至少勾选一条日志进行分析')
      return
    }
    const sample = buildSelectedLogSample()
    if (!sample) {
      setError('未能生成日志样本')
      return
    }
    setAnalyzing(true)
    setError('')
    const sessionId = await ensureAnalysisSession()
    if (!sessionId) {
      setError('创建 AI 会话失败，请检查 AI 平台配置')
      setAnalyzing(false)
      return
    }
    const systemMsg = '你是一位 Kubernetes 运维专家。请分析用户选中的容器日志，给出：1) 整体状态判断；2) 关键错误/告警提取；3) 排查建议。用中文回答，使用 Markdown 格式。'
    const userMsg = `请分析以下选中的日志（共 ${selectedIds.size} 条）：\n\n${sample}`
    const messages: ChatMessage[] = [
      { id: generateId(), role: 'system', content: systemMsg },
      { id: generateId(), role: 'user', content: userMsg },
    ]
    try {
      const aiRes = await aiChatAPI.chat(
        messages.map((m) => ({ role: m.role, content: m.content })),
        sessionId,
        selectedPlatformId || undefined
      )
      if (aiRes.success && aiRes.data) {
        messages.push({ id: generateId(), role: 'assistant', content: aiRes.data.content })
        setChatMessages(messages)
        setChatOpen(true)
      } else {
        setError(aiRes.error || 'AI 分析失败')
      }
    } catch (err: any) {
      setError(err.message || '分析请求失败')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleChatSend = async () => {
    if ((!chatInput.trim() && chatPendingImages.length === 0) || chatLoading) return
    const sessionId = await ensureAnalysisSession()
    if (!sessionId) {
      setChatMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: '❌ 错误：AI 会话未就绪' }])
      return
    }
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: chatInput.trim(),
      images: chatPendingImages.length > 0 ? [...chatPendingImages] : undefined,
    }
    const nextMessages = [...chatMessages, userMsg]
    setChatMessages(nextMessages)
    setChatInput('')
    setChatPendingImages([])
    setChatLoading(true)
    try {
      const aiRes = await aiChatAPI.chat(
        nextMessages.map((m) => ({ role: m.role, content: m.content, images: m.images })),
        sessionId,
        selectedPlatformId || undefined
      )
      if (aiRes.success && aiRes.data) {
        setChatMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: aiRes.data!.content }])
      } else {
        setChatMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: `❌ 错误：${aiRes.error || '请求失败'}` }])
      }
    } catch (err: any) {
      setChatMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: `❌ 错误：${err.message || '请求失败'}` }])
    } finally {
      setChatLoading(false)
    }
  }

  const handleDownloadAnalysis = () => {
    const analysisContent = chatMessages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n\n---\n\n')
    const blob = new Blob([analysisContent], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `日志分析_${dayjs().format('YYYY-MM-DD_HH-mm')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [chatMessages, chatLoading])

  useEffect(() => {
    if (histogram.length === 0) {
      try { chartInstance.current?.dispose() } catch {}
      chartInstance.current = null
      return
    }
    if (!chartRef.current) return
    const el = chartRef.current
    if (el.clientWidth === 0 || el.clientHeight === 0) return
    try {
      if (!chartInstance.current) {
        chartInstance.current = echarts.init(el)
        chartInstance.current.on('click', (params: any) => {
          const point = histogramRef.current[params.dataIndex]
          if (!point) return
          const clickedTime = dayjs(point.time)
          if (!clickedTime.isValid()) return
          const newFrom = clickedTime.subtract(5, 'minute')
          const newTo = clickedTime.add(5, 'minute')
          setCustomFrom(newFrom)
          setCustomTo(newTo)
          setPage(1)
          setSelectedIds(new Set())
          if (selectedBackends.length > 0 && selectedBackends.length <= 20) {
            executeQuery(buildReq(pageSize, 0, { customFrom: newFrom, customTo: newTo }))
          }
        })
      }
      const option: echarts.EChartsOption = {
        grid: { top: 10, right: 10, bottom: 20, left: 40 },
        xAxis: {
          type: 'category',
          data: histogram.map((h) => new Date(h.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
          axisLabel: { fontSize: 10 },
        },
        yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
        tooltip: { trigger: 'axis' },
        series: [
          {
            data: histogram.map((h) => h.count),
            type: 'bar',
            itemStyle: { color: '#6366f1', borderRadius: [3, 3, 0, 0] },
          },
        ],
      }
      chartInstance.current.setOption(option, true)
    } catch (e) {
      console.error('ECharts error:', e)
    }
  }, [histogram])

  useEffect(() => {
    const handleResize = () => {
      try { chartInstance.current?.resize() } catch {}
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      try { chartInstance.current?.dispose() } catch {}
      chartInstance.current = null
    }
  }, [])

  useEffect(() => {
    if (!chatOpen) return
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            try {
              const compressed = await compressImage(file)
              setChatPendingImages((prev) => (prev.length >= 3 ? prev : [...prev, compressed]))
            } catch {
              // ignore
            }
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [chatOpen])

  const handleChatFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        try {
          const compressed = await compressImage(file)
          setChatPendingImages((prev) => (prev.length >= 3 ? prev : [...prev, compressed]))
        } catch {
          // ignore
        }
      } else if (
        file.type.startsWith('text/') ||
        /\.(txt|md|json|yaml|yml|log|csv|go|py|js|ts|jsx|tsx|html|css|sh|sql|xml|properties|conf|ini|dockerfile|gradle|gitignore)$/i.test(file.name)
      ) {
        try {
          const text = await readTextFile(file)
          setChatInput((prev) => {
            const prefix = prev.trim() ? prev + '\n\n' : ''
            return `${prefix}[文件: ${file.name}]\n\`\`\`\n${text}\n\`\`\``
          })
        } catch {
          // ignore
        }
      }
    }
    e.target.value = ''
  }

  const removeChatPendingImage = (index: number) => {
    setChatPendingImages((prev) => prev.filter((_, i) => i !== index))
  }

  const renderFilters = () => {
    if (logType === 'ingress') {
      return (
        <>
          <TextField label="Host" size="small" sx={{ minWidth: 140 }} value={filters.host || ''} onChange={(e) => setFilters({ ...filters, host: e.target.value })} onKeyDown={handleKeyDownQuery} />
          <TextField label="Path" size="small" sx={{ minWidth: 140 }} value={filters.path || ''} onChange={(e) => setFilters({ ...filters, path: e.target.value })} onKeyDown={handleKeyDownQuery} />
          <TextField label="Status" size="small" sx={{ minWidth: 90 }} value={filters.status_code || ''} onChange={(e) => setFilters({ ...filters, status_code: e.target.value })} onKeyDown={handleKeyDownQuery} />
        </>
      )
    }
    if (logType === 'coredns') {
      return (
        <>
          <TextField label="域名" size="small" sx={{ minWidth: 160 }} value={filters.domain || ''} onChange={(e) => setFilters({ ...filters, domain: e.target.value })} onKeyDown={handleKeyDownQuery} />
          <TextField label="响应码" size="small" sx={{ minWidth: 100 }} value={filters.rcode || ''} onChange={(e) => setFilters({ ...filters, rcode: e.target.value })} onKeyDown={handleKeyDownQuery} />
        </>
      )
    }
    return (
      <>
        <TextField label="Service" size="small" sx={{ minWidth: 140 }} value={filters.service_name || ''} onChange={(e) => setFilters({ ...filters, service_name: e.target.value })} onKeyDown={handleKeyDownQuery} />
        <TextField label="源 IP" size="small" sx={{ minWidth: 120 }} value={filters.src_ip || ''} onChange={(e) => setFilters({ ...filters, src_ip: e.target.value })} onKeyDown={handleKeyDownQuery} />
      </>
    )
  }

  return (
    <Box sx={{ p: 3, height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h4" fontWeight={600} gutterBottom>
          日志中心
        </Typography>
        <Typography variant="body2" color="text.secondary">
          统一查询多集群日志后端，支持全量日志检索、场景化过滤与 AI 智能分析
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      {perBackendErrors.map((err, idx) => (
        <Alert severity="warning" sx={{ mb: 2, borderRadius: '12px' }} key={idx}>
          {err}
        </Alert>
      ))}

      {queryMessages.map((msg, idx) => (
        <Alert severity="info" sx={{ mb: 2, borderRadius: '12px' }} key={idx}>
          {msg}
        </Alert>
      ))}

      <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 2 }}>
          <Tabs
            value={logType}
            onChange={(_, v) => {
              setLogType(v)
              setEntries([])
              setHistogram([])
              setLevelCounts(null)
              setPerBackendErrors([])
              setFilters({})
              setSelectedIds(new Set())
              setSelectedNamespace('')
              setPage(1)
              if (selectedBackends.length > 0 && selectedBackends.length <= 20) {
                executeQuery(buildReq(pageSize, 0, { logType: v as LogType, filters: {}, selectedNamespace: '' }))
              }
            }}
            sx={{ minHeight: 36 }}
          >
            <Tab label="全部日志" value="all" sx={{ textTransform: 'none' }} />
            <Tab label="入口流量 (Ingress)" value="ingress" sx={{ textTransform: 'none' }} />
            <Tab label="系统组件 (CoreDNS)" value="coredns" sx={{ textTransform: 'none' }} />
            <Tab label="负载均衡 (LB)" value="lb" sx={{ textTransform: 'none' }} />
          </Tabs>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel>日志后端（多选）</InputLabel>
            <Select
              multiple
              value={selectedBackends}
              label="日志后端（多选）"
              onChange={handleBackendChange}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as number[]).map((id) => {
                    const b = backends.find((x) => x.id === id)
                    const cname = clusterMap[b?.cluster_id ?? 0] || `集群${b?.cluster_id ?? id}`
                    return <Chip key={id} label={`${cname} / ${b?.name || id}`} size="small" />
                  })}
                </Box>
              )}
            >
              {backends.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {clusterMap[b.cluster_id] || '未知集群'} / {b.name} ({b.type.toUpperCase()})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DateTimePicker
              label="开始时间"
              value={customFrom}
              onChange={(v) => v && setCustomFrom(v)}
              ampm={false}
              format="YYYY-MM-DD HH:mm"
              slotProps={{ textField: { size: 'small', sx: { minWidth: 190 } } }}
            />
            <Button size="small" variant="outlined" onClick={() => setCustomFrom(dayjs())}>
              当前
            </Button>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DateTimePicker
              label="结束时间"
              value={customTo}
              onChange={(v) => v && setCustomTo(v)}
              ampm={false}
              format="YYYY-MM-DD HH:mm"
              slotProps={{ textField: { size: 'small', sx: { minWidth: 190 } } }}
            />
            <Button size="small" variant="outlined" onClick={() => setCustomTo(dayjs())}>
              当前
            </Button>
          </Box>

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Namespace</InputLabel>
            <Select
              value={selectedNamespace}
              label="Namespace"
              onChange={(e) => setSelectedNamespace(e.target.value as string)}
            >
              <MenuItem value="">全部命名空间</MenuItem>
              {namespaces.map((ns) => (
                <MenuItem key={ns} value={ns}>
                  {ns}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="全局关键字"
            size="small"
            sx={{ minWidth: 200 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDownQuery}
            placeholder="搜索日志内容..."
            InputProps={{
              endAdornment: keyword ? (
                <IconButton size="small" onClick={() => setKeyword('')}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              ) : undefined,
            }}
          />

          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : <SearchIcon />}
            onClick={handleQuery}
            disabled={loading || selectedBackends.length === 0}
          >
            {loading ? '查询中...' : '查询日志'}
          </Button>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>AI 平台</InputLabel>
            <Select
              value={selectedPlatformId}
              label="AI 平台"
              onChange={(e) => setSelectedPlatformId(e.target.value as string)}
            >
              {aiPlatforms.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name} ({p.provider_type})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="outlined"
            startIcon={analyzing ? <CircularProgress size={18} /> : <AIIcon />}
            onClick={handleAnalyze}
            disabled={analyzing || selectedIds.size === 0 || !selectedPlatformId}
          >
            {analyzing ? '分析中...' : `AI 分析 (${selectedIds.size})`}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mt: 1 }}>
          {renderFilters()}
        </Box>
      </Paper>

      <StatCards
        total={globalTotal}
        errorCount={stats.errorCount}
        warnCount={stats.warnCount}
        infoCount={stats.infoCount}
        otherCount={stats.otherCount}
        activeLevel={filters.level || ''}
        onLevelClick={(level) => {
          if (level === '') {
            const newFilters = { ...filters }
            delete newFilters.level
            setFilters(newFilters)
            setPage(1)
            setSelectedIds(new Set())
            executeQuery(buildReq(pageSize, 0, { filters: newFilters }))
            return
          }
          const newLevel = filters.level === level ? '' : level
          const newFilters = { ...filters }
          if (newLevel) {
            newFilters.level = newLevel
          } else {
            delete newFilters.level
          }
          setFilters(newFilters)
          setPage(1)
          setSelectedIds(new Set())
          executeQuery(buildReq(pageSize, 0, { filters: newFilters }))
        }}
      />

      <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
        {/* 左侧日志流 */}
        <Paper
          elevation={0}
          sx={{
            flex: 1,
            minWidth: 0,
            border: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box
            sx={{
              p: 2,
              borderBottom: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {filteredEntries.length > 0 && (
                <Checkbox
                  size="small"
                  checked={filteredEntries.every((e) => selectedIds.has(entries.indexOf(e)))}
                  indeterminate={
                    filteredEntries.some((e) => selectedIds.has(entries.indexOf(e))) &&
                    !filteredEntries.every((e) => selectedIds.has(entries.indexOf(e)))
                  }
                  onChange={selectAllFiltered}
                />
              )}
              <Typography variant="subtitle2" fontWeight={600}>
                日志流 {entries.length > 0 ? `· 共 ${entries.length.toLocaleString()} 条` : ''}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {selectedIds.size > 0 && (
                <Tooltip title="复制选中">
                  <Button size="small" variant="outlined" startIcon={<CopyIcon fontSize="small" />} onClick={handleCopySelected}>
                    复制 ({selectedIds.size})
                  </Button>
                </Tooltip>
              )}
              {entries.length > 0 && (
                <Tooltip title="复制全部">
                  <IconButton size="small" onClick={() => copyToClipboard(entries.map((e) => e.message).join('\n'))}>
                    <CopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, p: 2 }}>
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
                <CircularProgress size={32} />
              </Box>
            )}
            {filteredEntries.length === 0 && !loading && (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', pt: 8 }}>
                {entries.length === 0 ? '暂无数据，请选择日志后端和过滤条件后点击查询' : '无符合条件的日志'}
              </Typography>
            )}
            {!loading && filteredEntries.length > 0 && (
              <Virtuoso
                style={{ height: '100%' }}
                data={filteredEntries}
                itemContent={(_, entry) => {
                  const realIdx = entries.indexOf(entry)
                  return (
                    <LogRow
                      entry={entry}
                      clusterMap={clusterMap}
                      keyword={keyword}
                      selected={selectedIds.has(realIdx)}
                      onSelect={() => toggleSelect(realIdx)}
                    />
                  )
                }}
              />
            )}
          </Box>
          {total > 0 && (
            <TablePagination
              component="div"
              count={total}
              page={page - 1}
              onPageChange={handleChangePage}
              rowsPerPage={pageSize}
              onRowsPerPageChange={handleChangeRowsPerPage}
              rowsPerPageOptions={[10, 20, 50, 100]}
              labelRowsPerPage="每页"
              labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count.toLocaleString()} 条`}
              sx={{ borderTop: '1px solid', borderColor: 'divider' }}
            />
          )}
        </Paper>

        {/* 右侧时间分布 */}
        {histogram.length > 0 && (
          <Paper
            elevation={0}
            sx={{
              width: 280,
              flexShrink: 0,
              border: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight={600}>
                时间分布
              </Typography>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, p: 1 }}>
              <Box ref={chartRef} sx={{ height: '100%', width: '100%' }} />
            </Box>
          </Paper>
        )}
      </Box>

      {/* AI 分析弹窗 */}
      <Dialog open={chatOpen} onClose={() => setChatOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AIIcon color="primary" />
              <Typography fontWeight={600}>AI 日志分析</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" startIcon={<DownloadIcon />} onClick={handleDownloadAnalysis}>
                下载分析
              </Button>
              <IconButton size="small" onClick={() => setChatOpen(false)}>
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '60vh' }}>
            <Box ref={chatScrollRef} sx={{ flex: 1, overflowY: 'auto', p: 2, bgcolor: 'background.default' }}>
              {chatMessages
                .filter((m) => m.role !== 'system')
                .map((msg) => (
                  <Box key={msg.id} sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                    <Avatar sx={{ width: 32, height: 32, bgcolor: msg.role === 'assistant' ? 'primary.main' : 'grey.400' }}>
                      {msg.role === 'assistant' ? <BotIcon sx={{ fontSize: 18 }} /> : <PersonIcon sx={{ fontSize: 18 }} />}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                        {msg.role === 'assistant' ? 'AI 助手' : '我'}
                      </Typography>
                      <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                        {msg.images && msg.images.length > 0 && (
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1 }}>
                            {msg.images.map((src, idx) => (
                              <Box
                                key={idx}
                                component="img"
                                src={src}
                                sx={{ maxWidth: 240, maxHeight: 160, borderRadius: 1, objectFit: 'cover', border: '1px solid', borderColor: 'divider' }}
                              />
                            ))}
                          </Box>
                        )}
                        <ContentBlock content={msg.content} />
                      </Paper>
                    </Box>
                  </Box>
                ))}
              {chatLoading && (
                <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                  <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                    <BotIcon sx={{ fontSize: 18 }} />
                  </Avatar>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                      AI 助手
                    </Typography>
                    <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', display: 'inline-flex' }}>
                      <CircularProgress size={20} />
                    </Paper>
                  </Box>
                </Box>
              )}
            </Box>
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
              {chatPendingImages.length > 0 && (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                  {chatPendingImages.map((src, idx) => (
                    <Box key={idx} sx={{ position: 'relative' }}>
                      <Box
                        component="img"
                        src={src}
                        sx={{
                          width: 56,
                          height: 56,
                          borderRadius: 1,
                          objectFit: 'cover',
                          border: '1px solid',
                          borderColor: 'divider',
                        }}
                      />
                      <IconButton
                        size="small"
                        onClick={() => removeChatPendingImage(idx)}
                        sx={{
                          position: 'absolute',
                          top: -8,
                          right: -8,
                          bgcolor: 'background.paper',
                          boxShadow: 1,
                          width: 18,
                          height: 18,
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 12 }} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                <input
                  type="file"
                  accept="image/*,text/plain,text/markdown,application/json,text/yaml,text/x-log,text/csv,text/xml,text/html,text/css,text/x-sh,application/sql,text/x-properties,text/x-ini,text/x-dockerfile,text/x-gradle,.txt,.md,.yaml,.yml,.log,.csv,.go,.py,.js,.ts,.jsx,.tsx,.html,.css,.sh,.sql,.xml,.properties,.conf,.ini,.dockerfile,.gradle,.gitignore"
                  multiple
                  hidden
                  ref={chatFileInputRef}
                  onChange={handleChatFileChange}
                />
                <IconButton size="small" onClick={() => chatFileInputRef.current?.click()} disabled={chatLoading}>
                  <ImageIcon fontSize="small" />
                </IconButton>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="继续追问 AI..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleChatSend()
                    }
                  }}
                />
                <Button variant="contained" onClick={handleChatSend} disabled={chatLoading || (!chatInput.trim() && chatPendingImages.length === 0)}>
                  <SendIcon fontSize="small" />
                </Button>
              </Box>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
