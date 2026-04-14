import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Box,
  Paper,
  Typography,
  Autocomplete,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  InputAdornment,
} from '@mui/material'
import {
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  Timeline as TimelineIcon,
  Storage as StorageIcon,
  Speed as SpeedIcon,
  Settings as SettingsIcon,
  Search as SearchIcon,
} from '@mui/icons-material'
import { Cluster } from '../lib/cluster-api'
import * as echarts from 'echarts'
import FlowTopologyGraph from '../components/network-trace/FlowTopologyGraph'
import FlowDataGrid from '../components/network-trace/FlowDataGrid'
import { clusterAPI } from '../lib/cluster-api'
import { k8sAPI } from '../lib/k8s-api'
import {
  networkTraceAPI,
  FlowTopology,
  FlowItem,
  FlowNode,
  FlowEdge,
} from '../lib/network-trace-api'

const DURATION_OPTIONS = [
  { label: '最近 5 分钟', value: '5m' },
  { label: '最近 15 分钟', value: '15m' },
  { label: '最近 30 分钟', value: '30m' },
  { label: '最近 1 小时', value: '1h' },
]

export default function NetworkTrace() {
  // Cluster / Namespace / Pod selection
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [clusterId, setClusterId] = useState<string>('')
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [namespace, setNamespace] = useState<string>('default')
  const [pods, setPods] = useState<string[]>([])
  const [pod, setPod] = useState<string>('')

  // Data states
  const [topology, setTopology] = useState<FlowTopology | null>(null)
  const [flowList, setFlowList] = useState<FlowItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState<string>('5m')
  const [protocolFilter, setProtocolFilter] = useState<string[]>([])
  const [allPodsMap, setAllPodsMap] = useState<Record<string, string[]>>({})

  // Config dialog
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [debugImage, setDebugImage] = useState<string>('nicolaka/netshoot:latest')

  // Debug states
  const [debugLoading, setDebugLoading] = useState(false)
  const [debugLogs, setDebugLogs] = useState<string>('')
  const [logWrap, setLogWrap] = useState(false)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<FlowEdge | null>(null)
  const [drawerTab, setDrawerTab] = useState(0)

  // Load clusters on mount
  useEffect(() => {
    clusterAPI.getClusters().then((res: any) => {
      const list = Array.isArray(res) ? res : res?.data || []
      setClusters(list)
      if (list.length > 0) {
        setClusterId(String(list[0].id))
      }
    })
    networkTraceAPI.getConfig().then((res) => {
      if (res.success && res.data) {
        setDebugImage(res.data.debug_image)
      }
    })
  }, [])

  // Load namespaces when cluster changes
  useEffect(() => {
    if (!clusterId) return
    k8sAPI.getNamespaces(Number(clusterId)).then((res) => {
      if (res.success && res.data) {
        const nsList = res.data.map((item: any) => item.metadata?.name || item)
        setNamespaces(nsList)
        if (!nsList.includes(namespace)) {
          setNamespace(nsList[0] || 'default')
        }
        // 并行加载所有 namespace 的 pods，用于全局搜索
        Promise.all(
          nsList.map((ns: string) =>
            k8sAPI
              .getResources(Number(clusterId), 'pods', ns)
              .then((res2: any) => {
                const items = res2?.data?.items || (Array.isArray(res2?.data) ? res2.data : [])
                const podNames = items
                  .map((item: any) => {
                    if (typeof item === 'string') return item
                    return item?.name || item?.metadata?.name || String(item)
                  })
                  .filter((n: string) => n && n !== '[object Object]')
                return { ns, podNames }
              })
              .catch(() => ({ ns, podNames: [] }))
          )
        ).then((results) => {
          const map: Record<string, string[]> = {}
          results.forEach(({ ns, podNames }) => {
            map[ns] = podNames
          })
          setAllPodsMap(map)
        })
      }
    })
  }, [clusterId])

  // Load pods when namespace changes
  useEffect(() => {
    if (!clusterId || !namespace) return
    k8sAPI
      .getResources(Number(clusterId), 'pods', namespace)
      .then((res: any) => {
        const items = res?.data?.items || (Array.isArray(res?.data) ? res.data : [])
        const podNames = items
          .map((item: any) => {
            if (typeof item === 'string') return item
            return item?.name || item?.metadata?.name || String(item)
          })
          .filter((n: string) => n && n !== '[object Object]')
        setPods(podNames)
        if (podNames.length > 0 && !podNames.includes(pod)) {
          setPod(podNames[0])
        }
      })
      .catch(() => {
        // fallback to empty if API differs
        setPods([])
      })
  }, [clusterId, namespace])

  const loadData = useCallback(async () => {
    if (!clusterId || !pod || !namespace) return
    setLoading(true)
    setError(null)
    try {
      const [topoRes, listRes] = await Promise.all([
        networkTraceAPI.getTopology(clusterId, namespace, pod, duration),
        networkTraceAPI.getFlowList(clusterId, namespace, pod, duration),
      ])

      if (topoRes.success && topoRes.data) {
        setTopology(topoRes.data)
      } else {
        setTopology(null)
        setError(topoRes.error || '获取拓扑数据失败')
      }

      if (listRes.success && listRes.data) {
        setFlowList(listRes.data)
      } else {
        setFlowList([])
      }
    } catch (err: any) {
      setTopology(null)
      setFlowList([])
      setError(err.message || '网络请求失败')
    } finally {
      setLoading(false)
    }
  }, [clusterId, namespace, pod, duration])

  // Auto load when selection stable
  useEffect(() => {
    const timer = setTimeout(() => {
      if (clusterId && pod && namespace && pods.includes(pod)) {
        loadData()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [clusterId, namespace, pod, duration, pods, loadData])

  const filteredFlowList = flowList.filter((row) =>
    protocolFilter.length === 0 ? true : protocolFilter.includes(row.protocol)
  )

  const allProtocols = Array.from(new Set(flowList.map((r) => r.protocol)))

  const handleNodeClick = (node: FlowNode) => {
    setSelectedNode(node)
    setSelectedEdge(null)
    setDrawerTab(0)
    setDrawerOpen(true)
  }

  const handleEdgeClick = (edge: FlowEdge) => {
    setSelectedEdge(edge)
    setSelectedNode(null)
    setDrawerTab(0)
    setDrawerOpen(true)
    loadTimeseries(edge.source, edge.target, edge.protocol)
  }

  const handleDetailClick = (row: FlowItem) => {
    const edge = {
      source: row.sourcePod,
      target: topology?.target.name || pod,
      protocol: row.protocol,
      port: row.port,
      bytes: row.bytes,
      requests: row.requests,
      latencyP95: row.latencyP95,
      successRate: row.successRate,
    }
    handleEdgeClick(edge)
  }

  const [timeseriesData, setTimeseriesData] = useState<any>(null)
  const [aiSummary, setAiSummary] = useState<string>('')

  const loadTimeseries = async (source: string, target: string, protocol: string) => {
    try {
      const res = await networkTraceAPI.getTimeseries(clusterId, source, target, protocol, duration)
      if (res.success && res.data) {
        setTimeseriesData(res.data)
      } else {
        setTimeseriesData(null)
      }
    } catch {
      setTimeseriesData(null)
    }
  }

  // 配置保存
  const handleSaveConfig = async () => {
    const res = await networkTraceAPI.updateConfig({ debug_image: debugImage })
    if (res.success) {
      setSnackbar({ open: true, message: '配置已保存', severity: 'success' })
      setConfigDialogOpen(false)
    } else {
      setSnackbar({ open: true, message: res.error || '保存失败', severity: 'error' })
    }
  }

  // 从当前选中的节点或链路解析抓包目标 Pod
  const resolveDebugTarget = () => {
    if (selectedNode) {
      // 仅当节点本身是 Pod（target 或其他 pod）时才直接使用
      if (selectedNode.id && selectedNode.id.startsWith('pod:')) {
        return { namespace: selectedNode.namespace || namespace, pod: selectedNode.name }
      }
      // 选中的是 Service、Ingress、外部 IP 等，默认对当前追踪目标 Pod 抓包
      return { namespace, pod }
    }
    if (selectedEdge) {
      // 优先尝试 target，再尝试 source，只匹配 pod:ns/name 格式
      for (const id of [selectedEdge.target, selectedEdge.source]) {
        const match = id.match(/^pod:([^/]+)\/(.+)$/)
        if (match) {
          return { namespace: match[1], pod: match[2] }
        }
      }
      // 链路两端都不是 Pod，也默认对当前追踪目标 Pod 抓包
      return { namespace, pod }
    }
    return { namespace, pod }
  }

  // 启动 Ephemeral Container 抓包
  const handleStartDebug = async () => {
    const target = resolveDebugTarget()
    if (!target) return
    setDebugLoading(true)
    try {
      const res = await networkTraceAPI.createDebug(clusterId, {
        namespace: target.namespace,
        pod: target.pod,
        image: debugImage,
        command: 'tcpdump -i any -nn -U -w /tmp/capture.pcap & TPID=$!; while kill -0 $TPID 2>/dev/null; do sleep 10; echo "===PCAP_BEGIN==="; base64 /tmp/capture.pcap | tr -d "\\n"; echo ""; echo "===PCAP_END==="; done; echo "capture stopped"',
      })
      if (res.success) {
        setSnackbar({ open: true, message: `Ephemeral Container 已注入 ${target.pod}，正在抓包...`, severity: 'success' })
        setDrawerTab(4)
      } else {
        setSnackbar({ open: true, message: res.error || '抓包启动失败', severity: 'error' })
      }
    } finally {
      setDebugLoading(false)
    }
  }

  // 解析抓包并增强拓扑
  const handleEnhanceTopology = async () => {
    if (!pod || !namespace) return
    setLoading(true)
    try {
      const res = await networkTraceAPI.enhanceTopology(clusterId, { namespace, pod })
      if (res.success && res.data) {
        setTopology(res.data.topology)
        setAiSummary(res.data.ai_summary || '')
        setSnackbar({ open: true, message: `拓扑已增强（抓包请求: ${res.data.topology.edges.reduce((sum, e) => sum + e.requests, 0)}，Prometheus RX: ${formatBytes(res.data.prometheus?.rx_bytes || 0)}/s）`, severity: 'success' })
      } else {
        setSnackbar({ open: true, message: res.error || '增强拓扑失败', severity: 'error' })
      }
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '网络请求失败', severity: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // 获取抓包日志
  const handleFetchDebugLogs = async () => {
    const target = resolveDebugTarget()
    if (!target) return
    setDebugLoading(true)
    try {
      const res = await networkTraceAPI.getDebugLogs(
        clusterId,
        target.namespace,
        target.pod
      )
      if (res.success && res.data !== undefined) {
        setDebugLogs(res.data)
      } else {
        setDebugLogs('暂无日志或 ephemeral container 尚未就绪')
      }
    } catch (err: any) {
      setDebugLogs('获取日志失败: ' + (err.message || String(err)))
    } finally {
      setDebugLoading(false)
    }
  }

  const totalBytes = flowList.reduce((sum, r) => sum + r.bytes, 0)
  const totalRequests = flowList.reduce((sum, r) => sum + r.requests, 0)

  return (
    <Box sx={{ p: 3, minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header Toolbar */}
      <Paper sx={{ p: 2, mb: 2, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
          <TimelineIcon color="primary" />
          网络追踪
        </Typography>

        <FormControl sx={{ minWidth: 160 }} size="small">
          <InputLabel>集群</InputLabel>
          <Select value={clusterId} label="集群" onChange={(e) => setClusterId(e.target.value)}>
            {clusters.map((c) => (
              <MenuItem key={c.id} value={String(c.id)}>
                {c.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ minWidth: 140 }} size="small">
          <InputLabel>Namespace</InputLabel>
          <Select
            value={namespace}
            label="Namespace"
            onChange={(e) => {
              setNamespace(e.target.value)
              setPod('')
            }}
          >
            {namespaces.map((ns) => (
              <MenuItem key={ns} value={ns}>
                {ns}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Autocomplete
          size="small"
          options={pods}
          value={pod}
          onChange={(_, v) => typeof v === 'string' && setPod(v)}
          getOptionLabel={(option) => typeof option === 'string' ? option : String(option)}
          isOptionEqualToValue={(opt, val) => opt === val}
          renderInput={(params) => <TextField {...params} label="目标 Pod" sx={{ width: 220 }} />}
        />

        <FormControl sx={{ minWidth: 130 }} size="small">
          <InputLabel>时间范围</InputLabel>
          <Select value={duration} label="时间范围" onChange={(e) => setDuration(e.target.value)}>
            {DURATION_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Autocomplete
          size="small"
          clearOnEscape
          value={null}
          options={Object.entries(allPodsMap).flatMap(([ns, podNames]) =>
            podNames.map((p) => ({ namespace: ns, pod: p, label: `${p} (${ns})` }))
          )}
          filterOptions={(options, state) =>
            options.filter((o) => o.label.toLowerCase().includes(state.inputValue.toLowerCase()))
          }
          getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
          isOptionEqualToValue={() => false}
          onChange={(_, value) => {
            if (value && typeof value !== 'string') {
              setNamespace(value.namespace)
              setPod(value.pod)
            }
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="全局搜索 Pod"
              sx={{ width: 240 }}
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          )}
          sx={{ '& .MuiAutocomplete-clearIndicator': { display: 'none' } }}
        />

        <Box sx={{ flex: 1 }} />

        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData} disabled={loading}>
          刷新
        </Button>
        <Button variant="contained" color="secondary" disabled={loading || !pod} onClick={handleEnhanceTopology}>
          解析抓包并刷新拓扑
        </Button>
        <Button variant="outlined" startIcon={<DownloadIcon />} disabled={!topology} onClick={() => alert('导出功能开发中')}>
          导出
        </Button>
        <Button variant="outlined" startIcon={<SettingsIcon />} onClick={() => setConfigDialogOpen(true)}>
          配置
        </Button>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      {/* Topology Graph */}
      <Paper
        sx={{
          p: 2,
          mb: 2,
          borderRadius: 3,
          height: 480,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            流量拓扑
          </Typography>
          {loading && <CircularProgress size={20} />}
        </Box>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {topology ? (
            <FlowTopologyGraph
              nodes={topology.nodes}
              edges={topology.edges}
              target={topology.target}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}

            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.secondary' }}>
              请选择集群和 Pod 后查看拓扑
            </Box>
          )}
        </Box>
      </Paper>

      {/* Metric Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, mb: 2 }}>
        <MetricCard icon={<StorageIcon color="primary" />} label="总流量" value={formatBytes(totalBytes)} />
        <MetricCard icon={<TimelineIcon color="success" />} label="总包数" value={totalRequests.toLocaleString()} />
        <MetricCard icon={<SpeedIcon color="warning" />} label="链路数" value={String(flowList.length)} />
      </Box>

      {/* Protocol Filters */}
      <Paper sx={{ p: 1.5, mb: 2, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, mr: 1 }}>
          协议筛选:
        </Typography>
        {allProtocols.map((proto) => {
          const selected = protocolFilter.includes(proto)
          return (
            <Chip
              key={proto}
              label={proto}
              clickable
              onClick={() =>
                setProtocolFilter((prev) =>
                  selected ? prev.filter((p) => p !== proto) : [...prev, proto]
                )
              }
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              size="small"
            />
          )
        })}
        {protocolFilter.length > 0 && (
          <Button size="small" onClick={() => setProtocolFilter([])}>
            清除
          </Button>
        )}
      </Paper>

      {/* Flow Data Grid */}
      <Paper sx={{ p: 2, borderRadius: 3, height: 420, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          流量明细
        </Typography>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <FlowDataGrid rows={filteredFlowList} onDetailClick={handleDetailClick} />
        </Box>
      </Paper>

      {/* Detail Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)} PaperProps={{ sx: { width: 900 } }}>
        <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
            链路详情
          </Typography>
          {selectedNode && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    节点
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {selectedNode.name}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={debugLoading}
                    onClick={handleStartDebug}
                    title="注入 Ephemeral Container 进行抓包"
                  >
                    {debugLoading ? '注入中...' : '一键抓包'}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={loading}
                    onClick={handleEnhanceTopology}
                    title="解析已有抓包日志并刷新拓扑"
                  >
                    {loading ? '解析中...' : '解析抓包'}
                  </Button>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                <Chip label={`类型: ${selectedNode.type}`} size="small" />
                {selectedNode.namespace && <Chip label={`NS: ${selectedNode.namespace}`} size="small" />}
                {selectedNode.node && <Chip label={`Node: ${selectedNode.node}`} size="small" />}
              </Box>
              {aiSummary && (
                <Alert severity="info" sx={{ mt: 2, borderRadius: 2 }}>
                  <Typography variant="subtitle2" fontWeight={600} gutterBottom>🤖 AI 抓包总结</Typography>
                  <Typography variant="body2">{aiSummary}</Typography>
                </Alert>
              )}
            </Box>
          )}
          {selectedEdge && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    链路
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {selectedEdge.source} → {selectedEdge.target}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={debugLoading}
                    onClick={handleStartDebug}
                    title="注入 Ephemeral Container 进行抓包（目标 Pod）"
                  >
                    {debugLoading ? '注入中...' : '一键抓包'}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={loading}
                    onClick={handleEnhanceTopology}
                    title="解析已有抓包日志并刷新拓扑"
                  >
                    {loading ? '解析中...' : '解析抓包'}
                  </Button>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                <Chip label={`${selectedEdge.protocol}:${selectedEdge.port}`} size="small" color="primary" />
                <Chip label={`流量: ${formatBytes(selectedEdge.bytes)}`} size="small" />
                <Chip label={`请求: ${selectedEdge.requests}`} size="small" />
                <Chip label={`延迟: ${selectedEdge.latencyP95}ms`} size="small" />
                <Chip label={`成功率: ${selectedEdge.successRate}%`} size="small" />
              </Box>
              {aiSummary && (
                <Alert severity="info" sx={{ mt: 2, borderRadius: 2 }}>
                  <Typography variant="subtitle2" fontWeight={600} gutterBottom>🤖 AI 抓包总结</Typography>
                  <Typography variant="body2">{aiSummary}</Typography>
                </Alert>
              )}
            </Box>
          )}

          <Divider sx={{ my: 1 }} />

          <Tabs value={drawerTab} onChange={(_, v) => setDrawerTab(v)} sx={{ mb: 1 }}>
            <Tab label="流量趋势" />
            <Tab label="L7 请求" />
            <Tab label="原始数据" />
            <Tab label="AI 分析" />
            <Tab label="调试日志" />
          </Tabs>

          <Box sx={{ flex: 1, minHeight: 0 }}>
            {drawerTab === 0 && (
              <Box sx={{ height: '100%' }}>
                {!selectedEdge ? (
                  <Box sx={{ color: 'text.secondary', textAlign: 'center', pt: 8 }}>选择一条链路查看流量趋势</Box>
                ) : !timeseriesData || !timeseriesData.timestamps || timeseriesData.timestamps.length === 0 ? (
                  <Box sx={{ color: 'text.secondary', textAlign: 'center', pt: 8 }}>暂无趋势数据</Box>
                ) : (
                  <TimeseriesChart data={timeseriesData} />
                )}
              </Box>
            )}
            {drawerTab === 1 && (
              <Box sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, fontFamily: 'monospace', fontSize: '0.875rem', color: 'text.primary' }}>
                {selectedEdge?.protocol === 'HTTP' || selectedEdge?.protocol === 'gRPC' ? (
                  <pre style={{ margin: 0, color: 'inherit' }}>
                    {JSON.stringify(
                      [
                        { method: 'GET', path: '/api/v1/users', status: 200, latency: '23ms', time: '10s前' },
                        { method: 'POST', path: '/api/v1/auth/login', status: 200, latency: '15ms', time: '12s前' },
                        { method: 'GET', path: '/api/v1/orders', status: 500, latency: '145ms', time: '30s前' },
                      ],
                      null,
                      2
                    )}
                  </pre>
                ) : (
                  '当前协议暂不支持 L7 解析'
                )}
              </Box>
            )}
            {drawerTab === 2 && (
              <Box sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, fontFamily: 'monospace', fontSize: '0.75rem', overflow: 'auto', height: '100%', color: 'text.primary' }}>
                <pre style={{ margin: 0, color: 'inherit' }}>{JSON.stringify(selectedNode || selectedEdge || {}, null, 2)}</pre>
              </Box>
            )}
            {drawerTab === 3 && (
              <Box sx={{ height: '100%', overflow: 'auto' }}>
                {!aiSummary ? (
                  <Box sx={{ color: 'text.secondary', textAlign: 'center', pt: 8 }}>
                    暂无 AI 分析，请先点击「解析抓包」生成拓扑
                  </Box>
                ) : (
                  <Alert severity="info" sx={{ borderRadius: 2, whiteSpace: 'pre-wrap' }}>
                    <Typography variant="subtitle2" fontWeight={600} gutterBottom>🤖 AI 抓包总结</Typography>
                    <Typography variant="body2">{aiSummary}</Typography>
                  </Alert>
                )}
              </Box>
            )}
            {drawerTab === 4 && (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Button variant="outlined" size="small" disabled={debugLoading} onClick={handleFetchDebugLogs}>
                    刷新日志
                  </Button>
                  <Button
                    variant={logWrap ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => setLogWrap((v) => !v)}
                    title={logWrap ? '关闭自动换行（横向滚动）' : '开启自动换行'}
                  >
                    {logWrap ? '已开启换行' : '自动换行'}
                  </Button>
                </Box>
                <Box
                  sx={{
                    flex: 1,
                    p: 1.5,
                    bgcolor: 'grey.900',
                    borderRadius: 2,
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    color: '#e2e8f0',
                    overflow: 'auto',
                    whiteSpace: logWrap ? 'pre-wrap' : 'pre',
                    wordBreak: logWrap ? 'break-all' : 'normal',
                  }}
                >
                  <pre style={{ margin: 0, color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit' }}>
                    {debugLogs || '点击"刷新日志"查看 ephemeral container 输出。若刚启动，请等待 5-10 秒再刷新。'}
                  </pre>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Drawer>

      {/* 配置 Dialog */}
      <Dialog open={configDialogOpen} onClose={() => setConfigDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>网络追踪配置</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              调试镜像用于 Ephemeral Container 抓包，支持 Harbor 私有仓库地址。
            </Typography>
            <TextField
              label="调试镜像地址"
              value={debugImage}
              onChange={(e) => setDebugImage(e.target.value)}
              fullWidth
              placeholder="例如: harbor.example.com/netshoot:latest"
              helperText="修改后会影响下次一键抓包使用的镜像"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSaveConfig}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

function MetricCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color?: string
}) {
  return (
    <Paper sx={{ p: 2, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>{icon}</Box>
      <Box>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700, color: color || 'text.primary' }}>
          {value}
        </Typography>
      </Box>
    </Paper>
  )
}

function TimeseriesChart({ data }: { data: any }) {
  const ref = useRef<HTMLDivElement>(null)
  const instance = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    instance.current = echarts.init(ref.current)
    const handleResize = () => instance.current?.resize()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      instance.current?.dispose()
    }
  }, [])

  useEffect(() => {
    if (!instance.current || !data) return
    const option: echarts.EChartsOption = {
      tooltip: { trigger: 'axis' },
      legend: { data: ['流量 (KB/s)', '请求数 (req/s)'] },
      grid: { left: 50, right: 30, top: 40, bottom: 30 },
      xAxis: { type: 'category', boundaryGap: false, data: data.timestamps },
      yAxis: [{ type: 'value', name: 'KB/s' }, { type: 'value', name: 'req/s' }],
      series: [
        {
          name: '流量 (KB/s)',
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.2 },
          data: data.bytesPerSecond.map((v: number) => (v / 1024).toFixed(1)),
        },
        {
          name: '请求数 (req/s)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: data.requestsPerSecond,
        },
      ],
    }
    instance.current.setOption(option, true)
  }, [data])

  return <Box ref={ref} sx={{ width: '100%', height: '100%' }} />
}



function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`
}
