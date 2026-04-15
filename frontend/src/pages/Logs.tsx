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
  Divider,
} from '@mui/material'
import {
  Search as SearchIcon,
  Psychology as AIIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material'
import * as echarts from 'echarts'
import { clusterAPI } from '../lib/cluster-api'
import { logAPI, LogEntry } from '../lib/log-api'
import { aiChatAPI } from '../lib/ai-chat-api'

interface Cluster {
  id: number
  name: string
}

type LogType = 'ingress' | 'coredns' | 'lb'

const TIME_OPTIONS = [
  { label: '最近 15 分钟', value: 15 * 60 * 1000 },
  { label: '最近 1 小时', value: 60 * 60 * 1000 },
  { label: '最近 6 小时', value: 6 * 60 * 60 * 1000 },
  { label: '最近 24 小时', value: 24 * 60 * 60 * 1000 },
  { label: '最近 7 天', value: 7 * 24 * 60 * 60 * 1000 },
]

function formatTime(d: Date) {
  return d.toISOString()
}

function getMaxTimeMs(clusterCount: number) {
  if (clusterCount === 1) return TIME_OPTIONS[4].value
  if (clusterCount <= 3) return TIME_OPTIONS[3].value
  if (clusterCount <= 5) return TIME_OPTIONS[2].value
  if (clusterCount <= 10) return TIME_OPTIONS[1].value
  return TIME_OPTIONS[0].value
}

export default function Logs() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selectedClusters, setSelectedClusters] = useState<number[]>([])
  const [logType, setLogType] = useState<LogType>('ingress')
  const [timeMs, setTimeMs] = useState<number>(TIME_OPTIONS[0].value)
  const [filters, setFilters] = useState<Record<string, string>>({})

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [histogram, setHistogram] = useState<{ time: string; count: number }[]>([])
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [total, setTotal] = useState(0)

  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    clusterAPI.getClusters().then((res: any) => {
      if (res.success && res.data) {
        const list: Cluster[] = Array.isArray(res.data) ? res.data : res.data.clusters || []
        setClusters(list)
        if (list.length > 0) {
          setSelectedClusters([list[0].id])
        }
      }
    })
  }, [])

  // 当集群数量变化时，检查当前时间范围是否超出限制
  useEffect(() => {
    const max = getMaxTimeMs(selectedClusters.length)
    if (timeMs > max) {
      setTimeMs(max)
    }
  }, [selectedClusters, timeMs])

  const availableTimeOptions = useMemo(() => {
    const max = getMaxTimeMs(selectedClusters.length)
    return TIME_OPTIONS.filter((o) => o.value <= max)
  }, [selectedClusters])

  const handleClusterChange = (e: any) => {
    const value = e.target.value as number[]
    setSelectedClusters(value)
  }

  const buildReq = (limit = 100, offset = 0) => {
    const now = Date.now()
    return {
      cluster_ids: selectedClusters,
      log_type: logType,
      time_range: {
        from: formatTime(new Date(now - timeMs)),
        to: formatTime(new Date(now)),
      },
      filters,
      limit,
      offset,
    }
  }

  const handleQuery = async () => {
    if (selectedClusters.length === 0) {
      setError('请至少选择一个集群')
      return
    }
    if (selectedClusters.length > 20) {
      setError('一次最多选择 20 个集群')
      return
    }
    setLoading(true)
    setError('')
    setAnalysis('')
    setEntries([])
    setHistogram([])
    setTotal(0)

    try {
      const [queryRes, histRes] = await Promise.all([
        logAPI.query(buildReq()),
        selectedClusters.length === 1
          ? logAPI.histogram({ ...buildReq(), cluster_id: selectedClusters[0] })
          : Promise.resolve(null),
      ])

      if (queryRes.success && queryRes.data) {
        setEntries(queryRes.data.entries || [])
        setTotal(queryRes.data.total || 0)
      } else {
        setError(queryRes.error || '查询失败')
      }

      if (histRes?.success && histRes.data) {
        setHistogram(histRes.data.histogram)
      }
    } catch (err: any) {
      setError(err.message || '请求异常')
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = async () => {
    if (entries.length === 0) {
      setError('请先查询日志')
      return
    }
    setAnalyzing(true)
    setError('')
    setAnalysis('')
    try {
      const res = await logAPI.analyze(buildReq())
      if (res.success && res.data) {
        const sample = res.data.sample
        const messages = [
          {
            role: 'system' as const,
            content: '你是一位 Kubernetes 运维专家。请分析下面的容器日志，给出：1) 整体状态判断；2) 关键错误/告警提取；3) 排查建议。用中文回答。',
          },
          {
            role: 'user' as const,
            content: `请分析以下日志样本（共 ${res.data.total_count} 条，其中异常 ${res.data.error_count} 条）：\n\n${sample}`,
          },
        ]
        const aiRes = await aiChatAPI.chat(messages)
        if (aiRes.success && aiRes.data) {
          setAnalysis(aiRes.data.content)
        } else {
          setError(aiRes.error || 'AI 分析失败')
        }
      } else {
        setError(res.error || '日志采样失败')
      }
    } catch (err: any) {
      setError(err.message || '分析请求失败')
    } finally {
      setAnalyzing(false)
    }
  }

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
      }
      const option: echarts.EChartsOption = {
        grid: { top: 30, right: 20, bottom: 30, left: 50 },
        xAxis: {
          type: 'category',
          data: histogram.map((h) => new Date(h.time).toLocaleTimeString('zh-CN')),
          axisLabel: { fontSize: 11 },
        },
        yAxis: { type: 'value', minInterval: 1 },
        tooltip: { trigger: 'axis' },
        series: [
          {
            data: histogram.map((h) => h.count),
            type: 'bar',
            itemStyle: { color: '#3f51b5', borderRadius: [4, 4, 0, 0] },
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

  const renderFilters = () => {
    if (logType === 'ingress') {
      return (
        <>
          <TextField label="Host" size="small" sx={{ minWidth: 180 }} value={filters.host || ''} onChange={(e) => setFilters({ ...filters, host: e.target.value })} />
          <TextField label="Path" size="small" sx={{ minWidth: 180 }} value={filters.path || ''} onChange={(e) => setFilters({ ...filters, path: e.target.value })} />
          <TextField label="Method" size="small" sx={{ minWidth: 100 }} value={filters.method || ''} onChange={(e) => setFilters({ ...filters, method: e.target.value })} />
          <TextField label="Status" size="small" sx={{ minWidth: 100 }} value={filters.status_code || ''} onChange={(e) => setFilters({ ...filters, status_code: e.target.value })} />
        </>
      )
    }
    if (logType === 'coredns') {
      return (
        <>
          <TextField label="域名" size="small" sx={{ minWidth: 200 }} value={filters.domain || ''} onChange={(e) => setFilters({ ...filters, domain: e.target.value })} />
          <TextField label="类型" size="small" sx={{ minWidth: 100 }} value={filters.qtype || ''} onChange={(e) => setFilters({ ...filters, qtype: e.target.value })} />
          <TextField label="响应码" size="small" sx={{ minWidth: 120 }} value={filters.rcode || ''} onChange={(e) => setFilters({ ...filters, rcode: e.target.value })} />
        </>
      )
    }
    return (
      <>
        <TextField label="Service" size="small" sx={{ minWidth: 180 }} value={filters.service_name || ''} onChange={(e) => setFilters({ ...filters, service_name: e.target.value })} />
        <TextField label="源 IP" size="small" sx={{ minWidth: 140 }} value={filters.src_ip || ''} onChange={(e) => setFilters({ ...filters, src_ip: e.target.value })} />
      </>
    )
  }

  return (
    <Box sx={{ p: 3, height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h4" fontWeight={600} gutterBottom>
          日志管理
        </Typography>
        <Typography variant="body2" color="text.secondary">
          直接查询集群日志后端，支持 Ingress、CoreDNS、LB 等多场景日志检索与 AI 分析
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Tabs value={logType} onChange={(_, v) => { setLogType(v); setEntries([]); setHistogram([]); setAnalysis(''); }} sx={{ mb: 2 }}>
          <Tab label="入口流量 (Ingress)" value="ingress" />
          <Tab label="系统组件 (CoreDNS)" value="coredns" />
          <Tab label="负载均衡 (LB)" value="lb" />
        </Tabs>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel>集群（多选）</InputLabel>
            <Select
              multiple
              value={selectedClusters}
              label="集群（多选）"
              onChange={handleClusterChange}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as number[]).map((id) => (
                    <Chip key={id} label={clusters.find((c) => c.id === id)?.name || id} size="small" />
                  ))}
                </Box>
              )}
            >
              {clusters.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>时间范围</InputLabel>
            <Select
              value={timeMs}
              label="时间范围"
              onChange={(e) => setTimeMs(Number(e.target.value))}
            >
              {availableTimeOptions.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {renderFilters()}

          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : <SearchIcon />}
            onClick={handleQuery}
            disabled={loading || selectedClusters.length === 0}
          >
            {loading ? '查询中...' : '查询日志'}
          </Button>

          <Button
            variant="outlined"
            startIcon={analyzing ? <CircularProgress size={18} /> : <AIIcon />}
            onClick={handleAnalyze}
            disabled={analyzing || entries.length === 0}
          >
            {analyzing ? '分析中...' : 'AI 分析'}
          </Button>
        </Box>
      </Paper>

      {histogram.length > 0 && (
        <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', height: 220 }}>
          <Box ref={chartRef} sx={{ height: '100%', width: '100%' }} />
        </Paper>
      )}

      <Paper elevation={0} sx={{ flex: 1, overflow: 'auto', border: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle2" fontWeight={600}>
            查询结果 {total > 0 ? `(共 ${total} 条，展示 ${entries.length} 条)` : ''}
          </Typography>
          {entries.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="复制全部">
                <IconButton size="small" onClick={() => navigator.clipboard.writeText(entries.map((e) => e.message).join('\n'))}>
                  <CopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
              <CircularProgress size={32} />
            </Box>
          )}
          {entries.length === 0 && !loading && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', pt: 8 }}>
              暂无数据，请选择集群和过滤条件后点击查询
            </Typography>
          )}

          {!loading && entries.map((entry, idx) => (
            <Box key={idx} sx={{ mb: 2, p: 2, borderRadius: 2, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {new Date(entry.timestamp).toLocaleString('zh-CN')} · {clusters.find((c) => c.id === entry.cluster_id)?.name || entry.cluster_id}
                  {entry.namespace && ` · ${entry.namespace}/${entry.pod_name}`}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {entry.fields?.status !== undefined && (
                    <Chip
                      label={String(entry.fields.status)}
                      size="small"
                      color={Number(entry.fields.status) >= 400 ? 'error' : 'success'}
                      sx={{ height: 20, fontSize: 11 }}
                    />
                  )}
                  {entry.fields?.method && (
                    <Chip label={String(entry.fields.method)} size="small" sx={{ height: 20, fontSize: 11 }} />
                  )}
                </Box>
              </Box>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  bgcolor: 'background.paper',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'text.primary',
                }}
              >
                {entry.message}
              </Box>
              {Object.keys(entry.fields || {}).length > 0 && (
                <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {Object.entries(entry.fields || {})
                    .filter(([k]) => !['status', 'method'].includes(k))
                    .map(([k, v]) => (
                      <Chip key={k} label={`${k}: ${String(v)}`} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} />
                    ))}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Paper>

      {analysis && (
        <Paper elevation={0} sx={{ p: 3, mt: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
            🤖 AI 分析结果
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
            {analysis}
          </Typography>
        </Paper>
      )}
    </Box>
  )
}
