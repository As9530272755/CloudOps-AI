import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
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
} from '@mui/material'
import {
  Add as AddIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import ReactGridLayout from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { clusterAPI, Cluster } from '../lib/cluster-api'
import { dashboardAPI, Dashboard as DashboardModel, DashboardPanel, CreatePanelRequest } from '../lib/dashboard-api'
import { ChartPanel } from '../components/charts/ChartPanel'
import PanelEditor from '../components/dashboard/PanelEditor'

// === Grafana-style grid constants (from DashboardGrid.tsx) ===
const GRID_CELL_HEIGHT = 30
const GRID_CELL_VMARGIN = 8
const GRID_COLUMN_COUNT = 24

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

function sortPanelsByGridPos(panels: DashboardPanel[]): DashboardPanel[] {
  return [...panels].sort((a, b) => {
    let pa = { x: 0, y: 0 }
    let pb = { x: 0, y: 0 }
    try { pa = JSON.parse(a.position) } catch {}
    try { pb = JSON.parse(b.position) } catch {}
    if (pa.y !== pb.y) return pa.y - pb.y
    return pa.x - pb.x
  })
}

interface GrafanaGridItemProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

// Intercept react-grid-layout dimensions and pass width/height to children (same as Grafana DashboardGrid)
const GrafanaGridItem = React.forwardRef<HTMLDivElement, GrafanaGridItemProps>((props, ref) => {
  const { children, style, ...divProps } = props
  let width = 100
  let height = 100

  if (style) {
    const s = style as React.CSSProperties
    if (s.width != null) {
      width = typeof s.width === 'number' ? s.width : parseFloat(s.width as string)
    }
    if (s.height != null) {
      height = typeof s.height === 'number' ? s.height : parseFloat(s.height as string)
    }
  }

  const childArray = React.Children.toArray(children)
  return (
    <div {...divProps} style={style} ref={ref}>
      {childArray.length > 0 && React.isValidElement(childArray[0])
        ? React.cloneElement(childArray[0] as React.ReactElement, { width, height })
        : childArray[0]}
      {childArray.slice(1)}
    </div>
  )
})
GrafanaGridItem.displayName = 'GrafanaGridItem'

export default function Dashboard() {
  const gridRootRef = useRef<HTMLDivElement>(null)
  const gridWrapperRef = useRef<HTMLDivElement>(null)
  const [gridWidth, setGridWidth] = useState(1200)
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [dashboard, setDashboard] = useState<DashboardModel | null>(null)
  const [panels, setPanels] = useState<DashboardPanel[]>([])
  const [editMode, setEditMode] = useState(false)
  const [timeRange, setTimeRange] = useState('1h')
  const [refreshInterval, setRefreshInterval] = useState(0)
  const [refreshTick, setRefreshTick] = useState(0)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPanel, setEditingPanel] = useState<Partial<DashboardPanel> | undefined>(undefined)

  // === Grafana: ResizeObserver on root to track grid width ===
  useEffect(() => {
    if (!gridRootRef.current) return
    const el = gridRootRef.current
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w) setGridWidth(Math.floor(w))
    })
    ro.observe(el)
    setGridWidth(Math.floor(el.clientWidth))
    return () => ro.disconnect()
  }, [panels.length, editMode])

  useMemo(() => getTimeRange(timeRange), [timeRange])

  const loadClusters = useCallback(async () => {
    try {
      const result = await clusterAPI.getClusters()
      if (result.success) setClusters(result.data)
    } catch {}
  }, [])

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
    const timer = setInterval(() => setRefreshTick((t) => t + 1), refreshInterval * 1000)
    return () => clearInterval(timer)
  }, [refreshInterval])

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

  // Build layout for react-grid-layout (Grafana style)
  const layout = useMemo(() => {
    return panels.map((p) => {
      let pos = { x: 0, y: 0, w: 12, h: 8 }
      try {
        pos = JSON.parse(p.position)
      } catch {}
      return { i: String(p.id), x: pos.x, y: pos.y, w: pos.w, h: pos.h }
    })
  }, [panels])

  // Grafana animation hack: delay move animations to avoid fly-in on initial load
  useEffect(() => {
    if (gridWrapperRef.current) {
      const ref = gridWrapperRef.current
      const t = setTimeout(() => ref.classList.add('react-grid-layout--enable-move-animations'), 50)
      return () => clearTimeout(t)
    }
  }, [])

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

  const handleDuplicatePanel = async (panel: DashboardPanel) => {
    if (!dashboard) return
    let pos = { x: 0, y: 0, w: 12, h: 8 }
    try {
      pos = JSON.parse(panel.position)
    } catch {}
    pos.x = (pos.x + pos.w) % GRID_COLUMN_COUNT
    const data: CreatePanelRequest = {
      title: `${panel.title} (复制)`,
      type: panel.type,
      data_source_id: panel.data_source_id,
      query: panel.query,
      position: JSON.stringify(pos),
      options: panel.options,
      sort_order: panel.sort_order,
    }
    try {
      await dashboardAPI.createPanel(dashboard.id, data)
      loadDashboard()
    } catch (err: any) {
      alert(err.message || '复制失败')
    }
  }

  const onDragStop = useCallback(
    (_layout: ReactGridLayout.Layout[], _oldItem: ReactGridLayout.Layout, newItem: ReactGridLayout.Layout) => {
      if (!editMode) return
      // Update single item and sort
      const updated = panels.map((p) =>
        String(p.id) === newItem.i ? { ...p, position: JSON.stringify({ x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h }) } : p
      )
      setPanels(sortPanelsByGridPos(updated))
    },
    [editMode, panels]
  )

  const onResize = useCallback(
    (_layout: ReactGridLayout.Layout[], _oldItem: ReactGridLayout.Layout, newItem: ReactGridLayout.Layout) => {
      if (!editMode) return
      const updated = panels.map((p) =>
        String(p.id) === newItem.i ? { ...p, position: JSON.stringify({ x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h }) } : p
      )
      setPanels(sortPanelsByGridPos(updated))
    },
    [editMode, panels]
  )

  const onResizeStop = useCallback(
    (_layout: ReactGridLayout.Layout[], _oldItem: ReactGridLayout.Layout, newItem: ReactGridLayout.Layout) => {
      if (!editMode) return
      const updated = panels.map((p) =>
        String(p.id) === newItem.i ? { ...p, position: JSON.stringify({ x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h }) } : p
      )
      setPanels(sortPanelsByGridPos(updated))
    },
    [editMode, panels]
  )

  const handleSaveLayout = async () => {
    if (!dashboard) return
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

  const handleSavePanel = async (data: CreatePanelRequest) => {
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

  // Render individual panel wrapped in GrafanaGridItem
  const renderPanels = () => {
    return panels.map((panel) => {
      const parsedOptions = panel.options ? JSON.parse(panel.options) : {}
      return (
        <GrafanaGridItem key={panel.id}>
          <ChartPanel
            key={`${panel.id}-${refreshTick}-${timeRange}`}
            title={panel.title}
            type={panel.type as any}
            query={panel.query}
            dataSourceId={panel.data_source_id}
            options={parsedOptions}
            width={0}
            height={0}
            showMenu={editMode}
            onEdit={() => handleEditPanel(panel)}
            onDelete={() => handleDeletePanel(panel)}
            onDuplicate={() => handleDuplicatePanel(panel)}
          />
        </GrafanaGridItem>
      )
    })
  }

  return (
    <Box sx={{ p: 3, minHeight: '100vh' }}>
      {/* === Header toolbar === */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>仪表盘</Typography>
            <Typography variant="body2" color="text.secondary">
              可视化监控中心
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <ToggleButtonGroup size="small" value={timeRange} exclusive onChange={(_, v) => v && setTimeRange(v)}>
              {timeRangeOptions.map((opt) => (
                <ToggleButton key={opt.value} value={opt.value}>{opt.label}</ToggleButton>
              ))}
            </ToggleButtonGroup>

            <ToggleButtonGroup size="small" value={refreshInterval} exclusive onChange={(_, v) => v !== null && setRefreshInterval(v)}>
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
            >
              {editMode ? '保存布局' : '编辑'}
            </Button>
            {editMode && (
              <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAddPanel}>
                添加面板
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* === Stat cards === */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        {[
          { label: '集群总数', value: clusters.length, color: '#007AFF' },
          { label: '健康集群', value: healthyClusters, color: '#34C759' },
          { label: '节点总数', value: totalNodes, color: '#5856D6' },
          { label: 'Pod 总数', value: totalPods, color: '#FF9500' },
        ].map((stat) => (
          <Card key={stat.label} sx={{ borderLeft: `4px solid ${stat.color}` }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">{stat.label}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: stat.color, mt: 1 }}>
                {stat.value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* === Edit mode: no top management bar, panel actions are via ⋮ menu === */}

      {/* === Dashboard Grid (Grafana style) === */}
      {!dashboard && !editMode ? (
        <Card sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            暂无仪表盘
          </Typography>
          <Button variant="contained" onClick={handleAddPanel}>
            创建默认仪表盘并添加面板
          </Button>
        </Card>
      ) : (
        <Box sx={{ position: 'relative' }}>
          {panels.length === 0 && !editMode && (
            <Card sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>当前仪表盘为空</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                点击编辑按钮添加您的第一个监控面板
              </Typography>
              <Button variant="contained" onClick={() => setEditMode(true)}>
                开始编辑
              </Button>
            </Card>
          )}

          {(panels.length > 0 || editMode) && (
            <div
              ref={gridRootRef}
              style={{ flex: '1 1 auto', position: 'relative', zIndex: 1 }}
            >
              <div style={{ width: gridWidth, height: '100%' }} ref={gridWrapperRef}>
                <ReactGridLayout
                  width={gridWidth}
                  isDraggable={editMode}
                  isResizable={editMode}
                  containerPadding={[0, 0]}
                  useCSSTransforms={true}
                  margin={[GRID_CELL_VMARGIN, GRID_CELL_VMARGIN]}
                  cols={GRID_COLUMN_COUNT}
                  rowHeight={GRID_CELL_HEIGHT}
                  draggableHandle=".grid-drag-handle"
                  draggableCancel=".grid-drag-cancel"
                  layout={layout}
                  onDragStop={onDragStop}
                  onResize={onResize}
                  onResizeStop={onResizeStop}
                >
                  {renderPanels()}
                </ReactGridLayout>
              </div>
            </div>
          )}
        </Box>
      )}

      {/* === Add panel button moved to top toolbar === */}

      {/* === Grafana-style Panel Editor (full screen takeover) === */}
      <PanelEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSavePanel}
        initialData={editingPanel}
      />
    </Box>
  )
}
