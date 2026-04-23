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
  useTheme,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import {
  Add as AddIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Tune as TuneIcon,
} from '@mui/icons-material'
import ReactGridLayout from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { dashboardAPI, Dashboard as DashboardModel, DashboardPanel, CreatePanelRequest } from '../lib/dashboard-api'
import ConfirmDialog from '../components/ConfirmDialog'
import { ChartPanel } from '../components/charts/ChartPanel'
import PanelEditor from '../components/dashboard/PanelEditor'
import VariableSelector, { VariableValues } from '../components/dashboard/VariableSelector'
import VariableEditor from '../components/dashboard/VariableEditor'
import { DashboardVariable } from '../components/charts/types'

// === Grafana-style grid constants (from DashboardGrid.tsx) ===
const GRID_CELL_HEIGHT = 30
const GRID_CELL_VMARGIN = 8
const GRID_COLUMN_COUNT = 24

const timeRangeOptions = [
  { label: '1小时', value: '1h' },
  { label: '6小时', value: '6h' },
  { label: '24小时', value: '24h' },
  { label: '7天', value: '7d' },
  { label: '30天', value: '30d' },
  { label: '180天', value: '180d' },
  { label: '1年', value: '1y' },
]

const refreshOptions = [
  { label: '关闭', value: 0 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
]

function getQueryRange(value: string) {
  const now = Math.floor(Date.now() / 1000)
  const durationMap: Record<string, number> = {
    '1h': 3600,
    '6h': 21600,
    '24h': 86400,
    '7d': 604800,
    '30d': 2592000,
    '180d': 15552000,
    '1y': 31536000,
  }
  const stepMap: Record<string, number> = {
    '1h': 15,
    '6h': 60,
    '24h': 60,
    '7d': 300,
    '30d': 900,
    '180d': 3600,
    '1y': 21600,
  }
  const duration = durationMap[value] || 3600
  const step = stepMap[value] || 60
  return { start: now - duration, end: now, step }
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
  const theme = useTheme()
  const gridRootRef = useRef<HTMLDivElement>(null)
  const gridWrapperRef = useRef<HTMLDivElement>(null)
  const [gridWidth, setGridWidth] = useState(1200)
  const [dashboard, setDashboard] = useState<DashboardModel | null>(null)
  const [panels, setPanels] = useState<DashboardPanel[]>([])
  const [editMode, setEditMode] = useState(false)
  const [timeRange, setTimeRange] = useState('1h')
  const [refreshInterval, setRefreshInterval] = useState(0)
  const [refreshTick, setRefreshTick] = useState(0)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPanel, setEditingPanel] = useState<Partial<DashboardPanel> | undefined>(undefined)
  const [variableValues, setVariableValues] = useState<VariableValues>({})
  const [varEditorOpen, setVarEditorOpen] = useState(false)
  const [tempVariables, setTempVariables] = useState<DashboardVariable[]>([])

  // 从 URL 读取变量值
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const vars: VariableValues = {}
    params.forEach((value, key) => {
      if (key.startsWith('var-')) {
        vars[key.replace('var-', '')] = value
      }
    })
    setVariableValues(vars)
  }, [])

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

  const queryRange = useMemo(() => getQueryRange(timeRange), [timeRange])

  const dashboardVariables = useMemo((): DashboardVariable[] => {
    if (!dashboard?.config) return []
    try {
      const cfg = JSON.parse(dashboard.config)
      return Array.isArray(cfg.variables) ? cfg.variables : []
    } catch {
      return []
    }
  }, [dashboard?.config])

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
    loadDashboard()
  }, [loadDashboard])

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
      showSnack(err.message || '创建仪表盘失败', 'error')
    }
  }

  const layout = useMemo(() => {
    return panels.map((p) => {
      let pos = { x: 0, y: 0, w: 12, h: 8 }
      try {
        pos = JSON.parse(p.position)
      } catch {}
      return { i: String(p.id), x: pos.x, y: pos.y, w: pos.w, h: pos.h }
    })
  }, [panels])

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

  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })
  const showSnack = (message: string, severity: 'success' | 'error' = 'success') => setSnack({ open: true, message, severity })
  const closeSnack = () => setSnack((s) => ({ ...s, open: false }))

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmPanel, setConfirmPanel] = useState<DashboardPanel | null>(null)

  const handleDeletePanel = async (panel: DashboardPanel) => {
    if (!dashboard) return
    setConfirmPanel(panel)
    setConfirmOpen(true)
  }

  const doDeletePanel = async () => {
    if (!dashboard || !confirmPanel) return
    try {
      await dashboardAPI.deletePanel(dashboard.id, confirmPanel.id)
      loadDashboard()
    } catch (err: any) {
      showSnack(err.message || '删除失败', 'error')
    } finally {
      setConfirmOpen(false)
      setConfirmPanel(null)
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
      showSnack(err.message || '复制失败', 'error')
    }
  }

  const onDragStop = useCallback(
    (_layout: ReactGridLayout.Layout[], _oldItem: ReactGridLayout.Layout, newItem: ReactGridLayout.Layout) => {
      if (!editMode) return
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

  const handleVariableChange = (values: VariableValues) => {
    setVariableValues(values)
    // 同步到 URL
    const params = new URLSearchParams(window.location.search)
    Object.entries(values).forEach(([k, v]) => {
      params.set(`var-${k}`, v)
    })
    const newUrl = `${window.location.pathname}?${params.toString()}`
    window.history.replaceState({}, '', newUrl)
  }

  const handleOpenVarEditor = () => {
    setTempVariables([...dashboardVariables])
    setVarEditorOpen(true)
  }

  const handleSaveVariables = async () => {
    if (!dashboard) return
    try {
      const cfg = dashboard.config ? JSON.parse(dashboard.config) : {}
      cfg.variables = tempVariables
      await dashboardAPI.update(dashboard.id, {
        title: dashboard.title,
        description: dashboard.description,
        config: JSON.stringify(cfg),
        is_default: dashboard.is_default,
      })
      setVarEditorOpen(false)
      loadDashboard()
      showSnack('变量设置已保存')
    } catch (err: any) {
      showSnack(err.message || '保存失败', 'error')
    }
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
            start={queryRange.start}
            end={queryRange.end}
            step={queryRange.step}
            variables={variableValues}
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
    <Box
      sx={{
        p: 3,
        minHeight: '100vh',
        bgcolor: theme.palette.background.default,
        overflowX: 'hidden',
      }}
    >
      {/* === Header toolbar === */}
      <Box sx={{ mb: 4 }}>
        <Card>
          <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>仪表盘</Typography>
            <Typography variant="body2" color="text.secondary">
              可视化监控中心
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <VariableSelector
              variables={dashboardVariables}
              values={variableValues}
              onChange={handleVariableChange}
            />
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
              color="primary"
            >
              {editMode ? '保存布局' : '编辑'}
            </Button>
            {editMode && (
              <>
                <Button variant="outlined" startIcon={<TuneIcon />} onClick={handleOpenVarEditor}>
                  变量设置
                </Button>
                <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAddPanel}>
                  添加面板
                </Button>
              </>
            )}
          </Box>
        </CardContent>
        </Card>
      </Box>

      {/* === Dashboard Grid (Grafana style) === */}
      {!dashboard && !editMode ? (
        <Card sx={{ textAlign: 'center', py: 8, mt: 3 }}>
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
            <Card sx={{ textAlign: 'center', py: 8, mt: 3 }}>
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
              style={{ width: '100%', position: 'relative', zIndex: 1, overflow: 'hidden' }}
            >
              <div style={{ width: gridWidth, maxWidth: '100%', height: '100%' }} ref={gridWrapperRef}>
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

      <PanelEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSavePanel}
        initialData={editingPanel}
      />

      <Dialog open={varEditorOpen} onClose={() => setVarEditorOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>仪表盘变量设置</DialogTitle>
        <DialogContent>
          <VariableEditor variables={tempVariables} onChange={setTempVariables} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVarEditorOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSaveVariables}>保存</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="删除面板"
        message={confirmPanel ? `确定删除面板 "${confirmPanel.title}" 吗？` : ''}
        onClose={() => setConfirmOpen(false)}
        onConfirm={doDeletePanel}
      />

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={closeSnack} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={closeSnack} sx={{ borderRadius: '12px' }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
