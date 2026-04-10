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
        bgcolor: '#070b14',
        backgroundImage: `
          radial-gradient(circle at 15% 25%, rgba(0,240,255,0.04) 0%, transparent 40%),
          radial-gradient(circle at 85% 75%, rgba(255,0,170,0.03) 0%, transparent 40%),
          linear-gradient(rgba(11,18,34,0.3) 1px, transparent 1px),
          linear-gradient(90deg, rgba(11,18,34,0.3) 1px, transparent 1px)
        `,
        backgroundSize: '100% 100%, 100% 100%, 40px 40px, 40px 40px',
      }}
    >
      {/* Sci-fi top toolbar */}
      <AppBar
        position="static"
        elevation={0}
        sx={{
          bgcolor: 'rgba(8,14,26,0.95)',
          borderBottom: '1px solid rgba(59,130,246,0.15)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <IconButton edge="start" onClick={handleDiscard} sx={{ color: '#94a3b8' }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600, color: '#e2e8f0' }}>
            {initialData?.title ? '编辑面板' : '新增面板'}
          </Typography>
          <Button
            variant="outlined"
            onClick={handleDiscard}
            sx={{ mr: 1, color: '#ff00aa', borderColor: 'rgba(255,0,170,0.35)', '&:hover': { borderColor: 'rgba(255,0,170,0.6)', background: 'rgba(255,0,170,0.06)' } }}
          >
            放弃更改
          </Button>
          <Button
            variant="contained"
            onClick={handleApply}
            sx={{ background: 'linear-gradient(135deg, #00f0ff 0%, #007AFF 100%)', color: '#fff', boxShadow: '0 0 16px rgba(0,240,255,0.25)' }}
          >
            应用
          </Button>
        </Toolbar>
      </AppBar>

      {/* Split view: left = panel preview, right = options */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left: panel preview */}
        <Box sx={{ flex: 1, minWidth: 0, p: 3, display: 'flex', flexDirection: 'column' }}>
          <Paper
            sx={{
              flex: 1,
              minHeight: 0,
              borderRadius: '8px',
              border: '1px solid rgba(59,130,246,0.12)',
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              background: 'linear-gradient(145deg, rgba(13,22,40,0.95) 0%, rgba(8,14,26,0.98) 100%)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
            elevation={0}
          >
            <Typography variant="caption" sx={{ color: '#64748b', mb: 1 }}>
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
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                  请选择数据源并输入查询语句
                </Box>
              )}
            </Box>
          </Paper>
        </Box>

        {/* Right: options pane */}
        <Box
          sx={{
            width: 420,
            borderLeft: '1px solid rgba(59,130,246,0.12)',
            overflowY: 'auto',
            bgcolor: 'rgba(8,14,26,0.95)',
          }}
        >
          <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#00f0ff', textShadow: '0 0 8px rgba(0,240,255,0.25)' }}>
              面板选项
            </Typography>

            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
              size="small"
              sx={{
                '& .MuiInputBase-root': { bgcolor: 'rgba(13,22,40,0.6)', color: '#e2e8f0' },
                '& .MuiInputLabel-root': { color: '#64748b' },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(59,130,246,0.25)' },
              }}
            />

            <FormControl fullWidth size="small" sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(59,130,246,0.25)' } }}>
              <InputLabel sx={{ color: '#64748b' }}>图表类型</InputLabel>
              <Select value={type} label="图表类型" onChange={(e) => setType(e.target.value as any)} sx={{ color: '#e2e8f0', bgcolor: 'rgba(13,22,40,0.6)' }}>
                <MenuItem value="line">折线图</MenuItem>
                <MenuItem value="bar">柱状图</MenuItem>
                <MenuItem value="pie">饼图</MenuItem>
                <MenuItem value="gauge">仪表盘</MenuItem>
                <MenuItem value="stat">单值统计</MenuItem>
                <MenuItem value="table">表格</MenuItem>
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
                  <FormControl fullWidth size="small" sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(59,130,246,0.25)' } }}>
                    <InputLabel sx={{ color: '#64748b' }}>图例位置</InputLabel>
                    <Select
                      value={showLegend ? placement : 'hidden'}
                      label="图例位置"
                      onChange={(e) => {
                        const v = e.target.value as any
                        if (v === 'hidden') setOpt({ legend: false })
                        else setOpt({ legend: true, legendPlacement: v })
                      }}
                      sx={{ color: '#e2e8f0', bgcolor: 'rgba(13,22,40,0.6)' }}
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

            <FormControl fullWidth size="small" sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(59,130,246,0.25)' } }}>
              <InputLabel sx={{ color: '#64748b' }}>数据源</InputLabel>
              <Select value={dataSourceId || ''} label="数据源" onChange={(e) => setDataSourceId(Number(e.target.value))} sx={{ color: '#e2e8f0', bgcolor: 'rgba(13,22,40,0.6)' }}>
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
              sx={{
                '& .MuiInputBase-root': { bgcolor: 'rgba(13,22,40,0.6)', color: '#e2e8f0' },
                '& .MuiInputLabel-root': { color: '#64748b' },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(59,130,246,0.25)' },
              }}
            />

            <TextField
              label="网格位置 (JSON)"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              fullWidth
              size="small"
              helperText="格式: {x, y, w, h}，w 范围 0-24"
              sx={{
                '& .MuiInputBase-root': { bgcolor: 'rgba(13,22,40,0.6)', color: '#e2e8f0' },
                '& .MuiInputLabel-root': { color: '#64748b' },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(59,130,246,0.25)' },
                '& .MuiFormHelperText-root': { color: '#64748b' },
              }}
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
              sx={{
                '& .MuiInputBase-root': { bgcolor: 'rgba(13,22,40,0.6)', color: '#e2e8f0' },
                '& .MuiInputLabel-root': { color: '#64748b' },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(59,130,246,0.25)' },
                '& .MuiFormHelperText-root': { color: '#64748b' },
              }}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
