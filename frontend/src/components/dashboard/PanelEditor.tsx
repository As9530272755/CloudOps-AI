import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Grid,
  Alert,
} from '@mui/material'
import { ChartPanel } from '../charts/ChartPanel'
import { DataSource, datasourceAPI } from '../../lib/datasource-api'
import { CreatePanelRequest } from '../../lib/dashboard-api'

interface PanelEditorProps {
  open: boolean
  onClose: () => void
  onSave: (data: CreatePanelRequest) => void
  initialData?: Partial<CreatePanelRequest>
}

const DEFAULT_POSITION = JSON.stringify({ x: 0, y: 0, w: 6, h: 4 })

export default function PanelEditor({ open, onClose, onSave, initialData }: PanelEditorProps) {
  const [dataSources, setDataSources] = useState<DataSource[]>([])
  const [title, setTitle] = useState(initialData?.title || '')
  const [type, setType] = useState(initialData?.type || 'line')
  const [dataSourceId, setDataSourceId] = useState<number>(initialData?.data_source_id || 0)
  const [query, setQuery] = useState(initialData?.query || '')
  const [position, setPosition] = useState(initialData?.position || DEFAULT_POSITION)
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

  const handleSave = () => {
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
      sort_order: 0,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{initialData?.title ? '编辑面板' : '新增面板'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={3} sx={{ mt: 0.5 }}>
          <Grid item xs={12} md={5}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                fullWidth
                size="small"
              />
              <FormControl fullWidth size="small">
                <InputLabel>图表类型</InputLabel>
                <Select value={type} label="图表类型" onChange={(e) => setType(e.target.value as any)}>
                  <MenuItem value="line">折线图</MenuItem>
                  <MenuItem value="bar">柱状图</MenuItem>
                  <MenuItem value="pie">饼图</MenuItem>
                  <MenuItem value="gauge">仪表盘</MenuItem>
                  <MenuItem value="stat">单值统计</MenuItem>
                  <MenuItem value="table">表格</MenuItem>
                </Select>
              </FormControl>
              {(() => {
                let parsed: any = {}
                try { if (options) parsed = JSON.parse(options) } catch {}
                const placement = parsed.legendPlacement || 'right'
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
                <Select
                  value={dataSourceId || ''}
                  label="数据源"
                  onChange={(e) => setDataSourceId(Number(e.target.value))}
                >
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
                label="位置 (JSON)"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                fullWidth
                size="small"
                helperText="格式: {x, y, w, h}，w范围0-12"
              />
              <TextField
                label="选项 (JSON)"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                fullWidth
                multiline
                rows={2}
                size="small"
                helperText="例如：{&quot;unit&quot;:&quot;%&quot;,&quot;legend&quot;:true}"
                error={(() => {
                  if (!options) return false
                  try { JSON.parse(options); return false } catch { return true }
                })()}
              />
            </Box>
          </Grid>
          <Grid item xs={12} md={7}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              预览
            </Typography>
            <Box sx={{ height: 320, borderRadius: 2, border: '1px dashed #ccc', p: 1 }}>
              {(() => {
                let parsedOptions = {}
                if (options) {
                  try {
                    parsedOptions = JSON.parse(options)
                  } catch {
                    // ignore invalid JSON during typing
                  }
                }
                return dataSourceId && query ? (
                  <ChartPanel
                    title={title || '预览'}
                    type={type as any}
                    query={query}
                    dataSourceId={dataSourceId}
                    options={parsedOptions}
                  />
                ) : (
                  <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                    请选择数据源并输入查询语句
                  </Box>
                )
              })()}
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSave}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
