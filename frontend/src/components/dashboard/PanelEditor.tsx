import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Alert,
  Paper,
  AppBar,
  Toolbar,
  IconButton,
  useTheme,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { ChartPanel } from '../charts/ChartPanel'
import { DataSource, datasourceAPI } from '../../lib/datasource-api'
import { CreatePanelRequest } from '../../lib/dashboard-api'

interface PanelEditorProps {
  open: boolean
  onClose: () => void
  onSave: (data: CreatePanelRequest) => void
  initialData?: Partial<CreatePanelRequest>
}

// 24-column default (Grafana style)
const DEFAULT_POSITION = JSON.stringify({ x: 0, y: 0, w: 12, h: 8 })

export default function PanelEditor({ open, onClose, onSave, initialData }: PanelEditorProps) {
  const theme = useTheme()
  const [dataSources, setDataSources] = useState<DataSource[]>([])
  const [title, setTitle] = useState(initialData?.title || '')
  const [type, setType] = useState(initialData?.type || 'line')
  const [dataSourceId, setDataSourceId] = useState<number>(initialData?.data_source_id || 0)
  const [query, setQuery] = useState(initialData?.query || '')
  const [position, setPosition] = useState(() => initialData?.position || DEFAULT_POSITION)
  const [options, setOptions] = useState(initialData?.options || '{}')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      loadDataSources()
      if (initialData) {
        setTitle(initialData.title || '')
        setType(initialData.type || 'line')
        setDataSourceId(initialData.data_source_id || 0)
        setQuery(initialData.query || '')
        setPosition(initialData.position || DEFAULT_POSITION)
        setOptions(initialData.options || '{}')
      }
    }
  }, [open, initialData])

  const loadDataSources = async () => {
    try {
      const result = await datasourceAPI.list('prometheus')
      if (result.success) {
        setDataSources(result.data)
        if (!dataSourceId && result.data.length > 0) {
          setDataSourceId(result.data[0].id)
        }
      }
    } catch (err: any) {
      setError(err.message || '加载数据源失败')
    }
  }

  const handleApply = () => {
    if (!title || !query || !dataSourceId) {
      setError('请填写完整信息')
      return
    }
    if (options) {
      try {
        JSON.parse(options)
      } catch {
        setError('选项 JSON 格式不正确')
        return
      }
    }
    setError('')
    onSave({
      title,
      type,
      data_source_id: dataSourceId,
      query,
      position,
      options,
      sort_order: initialData?.sort_order ?? 0,
    })
  }

  const handleDiscard = () => {
    onClose()
  }

  const parsedOptions = (() => {
    try {
      return options ? JSON.parse(options) : {}
    } catch {
      return {}
    }
  })()

  if (!open) return null

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: theme.palette.background.default,
      }}
    >
      {/* Top toolbar */}
      <AppBar position="static" elevation={0} sx={{ bgcolor: theme.palette.background.paper, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2 }}>
          <IconButton edge="start" onClick={handleDiscard}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
            {initialData?.title ? '编辑面板' : '新增面板'}
          </Typography>
          <Button variant="outlined" color="error" onClick={handleDiscard} sx={{ mr: 1 }}>
            放弃更改
          </Button>
          <Button variant="contained" onClick={handleApply}>
            应用
          </Button>
        </Toolbar>
      </AppBar>

      {/* Split view: left = panel preview, right = options */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left: panel preview */}
        <Box sx={{ flex: 1, minWidth: 0, p: 3, display: 'flex', flexDirection: 'column' }}>
          <Paper sx={{ flex: 1, minHeight: 0, borderRadius: 2, border: '1px dashed', borderColor: 'divider', p: 2, display: 'flex', flexDirection: 'column' }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
              实时预览
            </Typography>
            <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {dataSourceId && query ? (
                <ChartPanel
                  title={title || '预览'}
                  type={type as any}
                  query={query}
                  dataSourceId={dataSourceId}
                  options={parsedOptions}
                  width={0}
                  height={0}
                />
              ) : (
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                  请选择数据源并输入查询语句
                </Box>
              )}
            </Box>
          </Paper>
        </Box>

        {/* Right: options pane */}
        <Box sx={{ width: 420, borderLeft: '1px solid', borderColor: 'divider', overflowY: 'auto', bgcolor: theme.palette.background.paper }}>
          <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              面板选项
            </Typography>

            {error && <Alert severity="error">{error}</Alert>}

            <TextField label="标题" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" />

            <FormControl fullWidth size="small">
              <InputLabel>图表类型</InputLabel>
              <Select value={type} label="图表类型" onChange={(e) => setType(e.target.value as any)}>
                <MenuItem value="line">折线图</MenuItem>
                <MenuItem value="area">面积图</MenuItem>
                <MenuItem value="bar">柱状图</MenuItem>
                <MenuItem value="scatter">散点图</MenuItem>
                <MenuItem value="pie">饼图</MenuItem>
                <MenuItem value="gauge">仪表盘</MenuItem>
                <MenuItem value="stat">单值统计</MenuItem>
                <MenuItem value="table">表格</MenuItem>
                <MenuItem value="heatmap">热力图</MenuItem>
                <MenuItem value="text">文本</MenuItem>
              </Select>
            </FormControl>

            {(() => {
              const parsed: any = parsedOptions
              const placement = parsed.legendPlacement || 'bottom'
              const showLegend = parsed.legend !== false
              const setOpt = (patch: any) => {
                try {
                  const next = { ...parsed, ...patch }
                  setOptions(JSON.stringify(next))
                } catch {}
              }
              return (
                <>
                  <FormControl fullWidth size="small">
                    <InputLabel>图例位置</InputLabel>
                    <Select
                      value={showLegend ? placement : 'hidden'}
                      label="图例位置"
                      onChange={(e) => {
                        const v = e.target.value as any
                        if (v === 'hidden') setOpt({ legend: false })
                        else setOpt({ legend: true, legendPlacement: v })
                      }}
                    >
                      <MenuItem value="right">右侧</MenuItem>
                      <MenuItem value="left">左侧</MenuItem>
                      <MenuItem value="bottom">底部</MenuItem>
                      <MenuItem value="hidden">隐藏</MenuItem>
                    </Select>
                  </FormControl>
                </>
              )
            })()}

            <FormControl fullWidth size="small">
              <InputLabel>数据源</InputLabel>
              <Select value={dataSourceId || ''} label="数据源" onChange={(e) => setDataSourceId(Number(e.target.value))}>
                {dataSources.map((ds) => (
                  <MenuItem key={ds.id} value={ds.id}>
                    {ds.name} ({ds.url})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="PromQL 查询"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              fullWidth
              multiline
              rows={3}
              size="small"
              placeholder="例如：up"
            />

            <TextField
              label="网格位置 (JSON)"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              fullWidth
              size="small"
              helperText="格式: {x, y, w, h}，w 范围 0-24"
            />

            <TextField
              label="选项 (JSON)"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              fullWidth
              multiline
              rows={2}
              size="small"
              helperText='例如：{"unit":"%","legend":true}'
              error={(() => {
                if (!options) return false
                try { JSON.parse(options); return false } catch { return true }
              })()}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
