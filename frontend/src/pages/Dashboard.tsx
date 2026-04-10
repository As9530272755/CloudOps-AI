import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Tooltip,
  Fab,
  Chip,
} from '@mui/material'
import {
  Add as AddIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material'
import GridLayout from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { glassEffect } from '../theme/theme'
import { clusterAPI, Cluster } from '../lib/cluster-api'
import { dashboardAPI, Dashboard as DashboardModel, DashboardPanel } from '../lib/dashboard-api'
import { ChartPanel } from '../components/charts/ChartPanel'
import PanelEditor from '../components/dashboard/PanelEditor'

const timeRangeOptions = [
  { label: '1小时', value: '1h' },
  { label: '6小时', value: '6h' },
  { label: '24小时', value: '24h' },
  { label: '7天', value: '7d' },
]

const refreshOptions = [
  { label: '关闭', value: 0 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
]

function getTimeRange(value: string) {
  const now = Math.floor(Date.now() / 1000)
  const map: Record<string, number> = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800 }
  return { start: now - (map[value] || 3600), end: now }
}

export default function Dashboard() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [dashboard, setDashboard] = useState<DashboardModel | null>(null)
  const [panels, setPanels] = useState<DashboardPanel[]>([])
  const [editMode, setEditMode] = useState(false)
  const [timeRange, setTimeRange] = useState('1h')
  const [refreshInterval, setRefreshInterval] = useState(0)
  const [refreshTick, setRefreshTick] = useState(0)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPanel, setEditingPanel] = useState<Partial<DashboardPanel> | undefined>(undefined)

  useMemo(() => getTimeRange(timeRange), [timeRange])

  // Load clusters for stat cards
  const loadClusters = useCallback(async () => {
    try {
      const result = await clusterAPI.getClusters()
      if (result.success) setClusters(result.data)
    } catch {}
  }, [])

  // Load default dashboard
  const loadDashboard = useCallback(async () => {
    try {
      const result = await dashboardAPI.getDefault()
      if (result.success) {
        setDashboard(result.data)
        setPanels(result.data.panels || [])
      }
    } catch {
      setDashboard(null)
      setPanels([])
    }
  }, [])

  useEffect(() => {
    loadClusters()
    loadDashboard()
  }, [loadClusters, loadDashboard])

  // Auto refresh
  useEffect(() => {
    if (!refreshInterval) return
    const timer = setInterval(() => {
      setRefreshTick((t) => t + 1)
    }, refreshInterval * 1000)
    return () => clearInterval(timer)
  }, [refreshInterval])

  // Ensure dashboard exists (auto-create if missing)
  const ensureDashboard = async () => {
    if (dashboard) return
    try {
      const result = await dashboardAPI.create({
        title: '首页',
        description: '默认仪表盘',
        is_default: true,
        config: JSON.stringify({ refresh: '30s' }),
      })
      if (result.success) {
        setDashboard(result.data)
        setPanels([])
      }
    } catch (err: any) {
      alert(err.message || '创建仪表盘失败')
    }
  }

  const layout = useMemo(() => {
    return panels.map((p) => {
      let pos = { x: 0, y: 0, w: 6, h: 4 }
      try {
        pos = JSON.parse(p.position)
      } catch {}
      return { i: String(p.id), ...pos }
    })
  }, [panels])

  // GridLayout key：面板增删时强制重绘，避免残留 overlay/死区
  const gridKey = useMemo(() => {
    return `grid-${panels.map((p) => p.id).join('-')}`
  }, [panels])

  const handleEditPanel = (panel: DashboardPanel) => {
    setEditingPanel(panel)
    setEditorOpen(true)
  }

  const handleDeletePanel = async (panel: DashboardPanel) => {
    if (!dashboard) return
    if (!confirm(`确定删除面板 "${panel.title}" 吗？`)) return
    try {
      await dashboardAPI.deletePanel(dashboard.id, panel.id)
      loadDashboard()
    } catch (err: any) {
      alert(err.message || '删除失败')
    }
  }

  const layoutChangedRef = useRef(false)

  const handleLayoutChange = useCallback((newLayout: any) => {
    if (!editMode) return
    const changed = (newLayout as any[]).some((l: any) => {
      const p = panels.find((pp) => String(pp.id) === l.i)
      if (!p) return false
      let pos = { x: 0, y: 0, w: 6, h: 4 }
      try { pos = JSON.parse(p.position) } catch {}
      return l.x !== pos.x || l.y !== pos.y || l.w !== pos.w || l.h !== pos.h
    })
    if (!changed) return

    layoutChangedRef.current = true
    const updated = panels.map((p) => {
      const item = (newLayout as any[]).find((l: any) => l.i === String(p.id))
      if (!item) return p
      return { ...p, position: JSON.stringify({ x: item.x, y: item.y, w: item.w, h: item.h }) }
    })
    setPanels(updated)
  }, [editMode, panels])

  const handleSaveLayout = async () => {
    if (!dashboard) return
    // Save all panel positions
    for (const p of panels) {
      await dashboardAPI.updatePanel(dashboard.id, p.id, {
        title: p.title,
        type: p.type,
        data_source_id: p.data_source_id,
        query: p.query,
        position: p.position,
        options: p.options,
        sort_order: p.sort_order,
      })
    }
    setEditMode(false)
    loadDashboard()
  }

  const handleAddPanel = () => {
    setEditingPanel(undefined)
    setEditorOpen(true)
  }

  const handleSavePanel = async (data: any) => {
    if (!dashboard) {
      await ensureDashboard()
    }
    const db = dashboard || (await dashboardAPI.getDefault()).data
    if (!db) return

    if (editingPanel?.id) {
      await dashboardAPI.updatePanel(db.id, editingPanel.id, data)
    } else {
      await dashboardAPI.createPanel(db.id, data)
    }
    setEditorOpen(false)
    loadDashboard()
  }

  const totalNodes = clusters.reduce((sum, c) => sum + (c.metadata?.node_count || 0), 0)
  const totalPods = clusters.reduce((sum, c) => sum + (c.metadata?.pod_count || 0), 0)
  const healthyClusters = clusters.filter((c) => c.metadata?.health_status === 'healthy').length

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Card sx={{ mb: 3, ...glassEffect }}>
        <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>仪表盘</Typography>
            <Typography variant="body2" color="text.secondary">
              可视化监控中心
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              size="small"
              value={timeRange}
              exclusive
              onChange={(_, v) => v && setTimeRange(v)}
            >
              {timeRangeOptions.map((opt) => (
                <ToggleButton key={opt.value} value={opt.value}>{opt.label}</ToggleButton>
              ))}
            </ToggleButtonGroup>

            <ToggleButtonGroup
              size="small"
              value={refreshInterval}
              exclusive
              onChange={(_, v) => v !== null && setRefreshInterval(v)}
            >
              {refreshOptions.map((opt) => (
                <ToggleButton key={opt.value} value={opt.value}>{opt.label}</ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Tooltip title="刷新">
              <IconButton onClick={() => setRefreshTick((t) => t + 1)}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>

            <Button
              variant={editMode ? 'contained' : 'outlined'}
              startIcon={editMode ? <SaveIcon /> : <EditIcon />}
              onClick={() => {
                if (editMode) {
                  handleSaveLayout()
                } else {
                  setEditMode(true)
                }
              }}
              sx={editMode ? { background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)', color: '#fff' } : {}}
            >
              {editMode ? '保存布局' : '编辑'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Stat Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        {[
          { label: '集群总数', value: clusters.length, color: '#007AFF' },
          { label: '健康集群', value: healthyClusters, color: '#34C759' },
          { label: '节点总数', value: totalNodes, color: '#5856D6' },
          { label: 'Pod 总数', value: totalPods, color: '#FF9500' },
        ].map((stat) => (
          <Card key={stat.label} sx={{ ...glassEffect, borderLeft: `4px solid ${stat.color}` }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">{stat.label}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: stat.color, mt: 1 }}>
                {stat.value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* 编辑模式：顶部管理条 */}
      {editMode && (
        <Card sx={{ mb: 3, ...glassEffect }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                面板管理
              </Typography>
              <Button variant="outlined" size="small" onClick={() => setEditMode(false)}>
                退出编辑
              </Button>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {panels.map((panel) => (
                <Card
                  key={panel.id}
                  sx={{
                    px: 2,
                    py: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.9)',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {panel.title}
                  </Typography>
                  <Chip label={panel.type} size="small" variant="outlined" />
                  <IconButton size="small" onClick={() => handleEditPanel(panel)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDeletePanel(panel)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Card>
              ))}
              {panels.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  当前无面板，点击下方按钮添加
                </Typography>
              )}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Dashboard Grid */}
      {!dashboard && !editMode ? (
        <Card sx={{ ...glassEffect, textAlign: 'center', py: 8 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            暂无仪表盘
          </Typography>
          <Button variant="contained" onClick={handleAddPanel} sx={{ borderRadius: '12px' }}>
            创建默认仪表盘并添加面板
          </Button>
        </Card>
      ) : (
        <Box sx={{ position: 'relative' }}>
          {panels.length === 0 && !editMode && (
            <Card sx={{ ...glassEffect, textAlign: 'center', py: 8 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>当前仪表盘为空</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                点击编辑按钮添加您的第一个监控面板
              </Typography>
              <Button variant="contained" onClick={() => setEditMode(true)} sx={{ borderRadius: '12px' }}>
                开始编辑
              </Button>
            </Card>
          )}

          {(panels.length > 0 || editMode) && (
            <GridLayout
              key={gridKey}
              className="layout"
              layout={layout}
              width={1200}
              gridConfig={{ cols: 12, rowHeight: 60 }}
              dragConfig={{ enabled: editMode, handle: '.drag-handle' }}
              resizeConfig={{ enabled: editMode }}
              onLayoutChange={handleLayoutChange}
            >
              {panels.map((panel) => (
                <Box key={panel.id}>
                  <ChartPanel
                    key={`${panel.id}-${refreshTick}-${timeRange}`}
                    title={panel.title}
                    type={panel.type as any}
                    query={panel.query}
                    dataSourceId={panel.data_source_id}
                    options={panel.options ? JSON.parse(panel.options) : {}}
                  />
                </Box>
              ))}
            </GridLayout>
          )}
        </Box>
      )}

      {editMode && (
        <Fab
          color="primary"
          sx={{ position: 'fixed', bottom: 24, right: 24 }}
          onClick={handleAddPanel}
        >
          <AddIcon />
        </Fab>
      )}

      <PanelEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSavePanel}
        initialData={editingPanel}
      />
    </Box>
  )
}
