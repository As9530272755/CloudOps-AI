import { useEffect, useRef, useState, useCallback } from 'react'
import { Box, Typography, CircularProgress, Paper, useTheme, IconButton, Menu, MenuItem } from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import * as echarts from 'echarts'
import { ChartType, PanelOptions } from './types'
import { datasourceAPI } from '../../lib/datasource-api'

// Grafana default color palette (from Grafana source code)
const GRAFANA_COLORS = [
  '#7EB26D', '#EAB839', '#6ED0E0', '#EF843C', '#E24D42',
  '#1F78C1', '#BA43A9', '#705DA0', '#508642', '#CCA300',
  '#447EBC', '#C15C17', '#890F02', '#0A437C', '#6D1F62',
  '#967302', '#2F575E', '#99440A', '#58140C', '#052B51',
  '#511749', '#3F6833', '#BF1B00', '#F2CC0C', '#70DBED',
  '#C4162A', '#64B0C8', '#E0F9D7', '#8AB8FF', '#F9934E',
]

// Grafana-style default field config
const DEFAULT_OPTIONS: Required<Pick<PanelOptions, 'drawStyle' | 'lineWidth' | 'fillOpacity' | 'showPoints' | 'pointSize' | 'lineInterpolation'>> = {
  drawStyle: 'line',
  lineWidth: 1,
  fillOpacity: 0,
  showPoints: 'auto',
  pointSize: 4,
  lineInterpolation: 'linear',
}

function resolveOption<T extends keyof typeof DEFAULT_OPTIONS>(opts: PanelOptions | undefined, key: T): typeof DEFAULT_OPTIONS[T] {
  const v = opts?.[key]
  return (v !== undefined ? v : DEFAULT_OPTIONS[key]) as typeof DEFAULT_OPTIONS[T]
}

function formatSeriesName(metric: Record<string, string>) {
  const labels = Object.entries(metric)
    .filter(([k]) => k !== '__name__')
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ')
  return labels || metric.__name__ || 'Value'
}

function formatPrometheusData(result: any, chartType: ChartType) {
  if (!result?.data?.result) return null

  const series: Array<{ name: string; data: number[] }> = []
  const timestamps: number[] = []

  const results = result.data.result

  if (chartType === 'stat' || chartType === 'gauge') {
    const first = results[0]
    const value = parseFloat(first?.value?.[1] || first?.values?.[0]?.[1] || 0)
    return { value, name: formatSeriesName(first?.metric || {}) }
  }

  if (chartType === 'pie') {
    const data = results.map((item: any) => ({
      name: formatSeriesName(item.metric || {}),
      value: parseFloat(item.value?.[1] || 0),
    }))
    return { data }
  }

  if (chartType === 'table') {
    const columns = ['Time', 'Metric', 'Value']
    const rows = results.flatMap((item: any) => {
      const metricName = formatSeriesName(item.metric || {})
      if (item.values) {
        return item.values.map((v: [number, string]) => ({
          time: new Date(v[0] * 1000).toLocaleString(),
          metric: metricName,
          value: v[1],
        }))
      }
      return [{
        time: new Date().toLocaleString(),
        metric: metricName,
        value: item.value?.[1] || '-',
      }]
    })
    return { columns, rows: rows.slice(0, 50) }
  }

  // line / bar
  results.forEach((item: any) => {
    const name = formatSeriesName(item.metric || {})
    if (item.values) {
      const data: number[] = []
      item.values.forEach((v: [number, string]) => {
        if (timestamps.length < item.values.length) {
          timestamps.push(v[0] * 1000)
        }
        data.push(parseFloat(v[1]))
      })
      series.push({ name, data })
    } else if (item.value) {
      series.push({ name, data: [parseFloat(item.value[1])] })
      timestamps.push(Date.now())
    }
  })

  return { series, timestamps }
}

function shouldShowPoints(showPoints: 'auto' | 'always' | 'never', chartWidth: number, dataLength: number): 'circle' | 'none' {
  if (showPoints === 'never') return 'none'
  if (showPoints === 'always') return 'circle'
  if (dataLength <= 1) return 'circle'
  return chartWidth / dataLength > 8 ? 'circle' : 'none'
}

export function ChartPanel({
  title,
  type,
  query,
  dataSourceId,
  options,
  width,
  height,
  onEdit,
  onDelete,
  onDuplicate,
  showMenu = false,
}: {
  title: string
  type: ChartType
  query: string
  dataSourceId: number
  options?: PanelOptions
  width?: number
  height?: number
  onEdit?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  showMenu?: boolean
}) {
  const theme = useTheme()
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const [chartData, setChartData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statValue, setStatValue] = useState<number | null>(null)
  const [tableData, setTableData] = useState<{ columns: string[]; rows: any[] } | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)

  const loadData = useCallback(async () => {
    if (!query || !dataSourceId) return
    setLoading(true)
    setError(null)

    try {
      const end = Math.floor(Date.now() / 1000)
      const start = end - 3600 * 24
      const step = 300
      const result = await datasourceAPI.query(dataSourceId, { query, start: String(start), end: String(end), step: String(step) })
      if (!result.success) {
        setError(result.error || result.message || 'Query failed')
        return
      }
      const promData = result.data?.data
      const formatted = formatPrometheusData({ data: promData }, type)
      if (!formatted) {
        setError('无数据')
        return
      }

      if (type === 'stat') {
        setStatValue((formatted as any).value)
      } else if (type === 'table') {
        setTableData(formatted as any)
      } else {
        setChartData(formatted)
      }
    } catch (err: any) {
      setError(err.message || '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [dataSourceId, query, type])

  // 初始化 ECharts + ResizeObserver
  useEffect(() => {
    if (!chartRef.current) return
    if (!chartInstance.current) {
      // 跟随系统主题：不强制 dark 主题
      chartInstance.current = echarts.init(chartRef.current, undefined, { renderer: 'canvas' })
    }

    const ro = new ResizeObserver(() => chartInstance.current?.resize())
    ro.observe(chartRef.current)

    const handleWinResize = () => chartInstance.current?.resize()
    window.addEventListener('resize', handleWinResize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', handleWinResize)
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [])

  // 外部 width/height 变化时重绘
  useEffect(() => {
    if (chartInstance.current) {
      chartInstance.current.resize()
    }
  }, [width, height])

  useEffect(() => {
    loadData()
  }, [loadData])

  // chartData 准备好后绘制
  useEffect(() => {
    if (!chartInstance.current || !chartData) return
    if (type === 'stat' || type === 'table') return

    const legendPlacement = options?.legendPlacement ?? 'bottom'
    const showLegend = options?.legend !== false && legendPlacement !== 'hidden'
    const chartWidth = chartRef.current?.clientWidth || 400

    function buildLegend() {
      if (!showLegend) return undefined
      const divider = theme.palette.divider
      const common = {
        type: 'scroll',
        textStyle: { color: theme.palette.text.primary, fontSize: 11 },
        tooltip: { show: true },
        borderWidth: 1,
        borderColor: divider,
        padding: [8, 10],
      }
      const maxLen = 32
      const fmt = (name: string) => name.length > maxLen ? name.slice(0, maxLen) + '...' : name
      if (legendPlacement === 'bottom') return { ...common, orient: 'horizontal', bottom: 0, left: 'center', icon: 'roundRect', height: 40, formatter: fmt } as any
      if (legendPlacement === 'left') return { ...common, orient: 'vertical', left: 0, top: 'middle', icon: 'roundRect', width: 200, formatter: fmt } as any
      if (legendPlacement === 'right') return { ...common, orient: 'vertical', right: 0, top: 'middle', icon: 'roundRect', width: 200, formatter: fmt } as any
      return { ...common, orient: 'horizontal', bottom: 0, left: 'center', icon: 'roundRect', height: 40, formatter: fmt } as any
    }

    const hasSeries = Array.isArray(chartData.series) && Array.isArray(chartData.timestamps)
    const hasPieData = Array.isArray(chartData.data)
    const hasGaugeData = chartData.value !== undefined
    if ((type === 'line' || type === 'bar') && !hasSeries) return
    if (type === 'pie' && !hasPieData) return
    if (type === 'gauge' && !hasGaugeData) return

    const drawStyle = resolveOption(options, 'drawStyle')
    const lineWidth = resolveOption(options, 'lineWidth')
    const fillOpacity = resolveOption(options, 'fillOpacity')
    const showPoints = resolveOption(options, 'showPoints')
    const pointSize = resolveOption(options, 'pointSize')
    const lineInterpolation = resolveOption(options, 'lineInterpolation')

    const axisColor = theme.palette.mode === 'dark' ? '#4b5563' : '#d1d5db'
    const labelColor = theme.palette.mode === 'dark' ? '#9ca3af' : '#6b7280'
    const splitColor = theme.palette.mode === 'dark' ? '#374151' : '#f3f4f6'
    const tooltipBg = theme.palette.mode === 'dark' ? '#1f2937' : '#ffffff'
    const tooltipBorder = theme.palette.mode === 'dark' ? '#374151' : '#e5e7eb'
    const tooltipText = theme.palette.mode === 'dark' ? '#f3f4f6' : '#111827'

    let option: echarts.EChartsOption = {}

    try {
      switch (type) {
        case 'line':
        case 'bar': {
          const effectiveType = drawStyle === 'points' ? 'line' : (drawStyle === 'bar' ? 'bar' : 'line')
          const dataLength = chartData.timestamps?.length || 1
          const symbol = drawStyle === 'points'
            ? 'circle'
            : shouldShowPoints(showPoints, chartWidth, dataLength)

          const gridRight = legendPlacement === 'right' ? (showLegend ? 220 : 16) : 16
          const gridLeft = legendPlacement === 'left' ? (showLegend ? 220 : 16) : 56
          const gridBottom = legendPlacement === 'bottom' ? (showLegend ? 64 : 24) : 24

          option = {
            backgroundColor: 'transparent',
            color: GRAFANA_COLORS,
            grid: {
              top: 24,
              right: gridRight,
              bottom: gridBottom,
              left: gridLeft,
              containLabel: false,
            },
            tooltip: {
              trigger: 'axis',
              backgroundColor: tooltipBg,
              borderColor: tooltipBorder,
              textStyle: { color: tooltipText, fontSize: 12 },
              axisPointer: { type: 'cross', label: { backgroundColor: splitColor } },
              confine: true,
              order: 'valueDesc',
              enterable: true,
              extraCssText: 'max-height: 260px; overflow-y: auto;',
              formatter: (params: any) => {
                if (!Array.isArray(params) || params.length === 0) return ''
                const t = new Date(params[0].axisValue)
                const timeLabel = `${(t.getMonth() + 1).toString().padStart(2, '0')}/${t.getDate().toString().padStart(2, '0')} ${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`
                let html = `<div style="font-weight:600;margin-bottom:4px;color:${tooltipText}">${timeLabel}</div>`
                for (let i = 0; i < params.length; i++) {
                  const p = params[i]
                  html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;white-space:nowrap;color:${tooltipText}">`
                  html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>`
                  html += `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;max-width:280px;">${p.seriesName}</span>`
                  html += `<span style="font-weight:600;margin-left:8px;">${p.value}</span>`
                  html += `</div>`
                }
                return html
              },
            },
            dataZoom: [
              { type: 'inside', start: 0, end: 100 },
            ],
            xAxis: {
              type: 'time',
              axisLine: { lineStyle: { color: axisColor } },
              axisLabel: { color: labelColor, fontSize: 11, rotate: 0, formatter: '{MM}-{dd} {HH}:{mm}' },
              splitLine: { show: false },
            },
            yAxis: {
              type: 'value',
              axisLine: { show: false },
              axisLabel: { color: labelColor, fontSize: 11 },
              splitLine: { lineStyle: { color: splitColor } },
            },
            legend: buildLegend(),
            series: chartData.series.map((s: any) => {
              const isLine = effectiveType === 'line'
              const areaOpacity = isLine && fillOpacity > 0 ? fillOpacity / 100 : 0

              return {
                name: s.name,
                type: effectiveType,
                data: s.data.map((v: number, idx: number) => [chartData.timestamps[idx], v]),
                smooth: lineInterpolation === 'smooth',
                symbol: symbol,
                symbolSize: symbol === 'circle' ? pointSize : undefined,
                lineStyle: isLine ? { width: lineWidth } : undefined,
                areaStyle: areaOpacity > 0 ? { opacity: areaOpacity } : undefined,
                emphasis: {
                  lineStyle: { width: isLine ? Math.max(lineWidth + 1, 2) : undefined },
                },
              }
            }),
          }
          break
        }
        case 'pie': {
          const pieCount = (chartData.data || []).length
          const showPieLabel = pieCount <= 10
          const centerX = legendPlacement === 'right' ? '40%' : (legendPlacement === 'left' ? '60%' : '50%')
          option = {
            backgroundColor: 'transparent',
            color: GRAFANA_COLORS,
            tooltip: {
              trigger: 'item',
              backgroundColor: tooltipBg,
              borderColor: tooltipBorder,
              textStyle: { color: tooltipText },
            },
            legend: buildLegend(),
            series: [{
              type: 'pie',
              radius: ['35%', '65%'],
              center: [centerX, '50%'],
              data: chartData.data || [],
              label: { show: showPieLabel, formatter: '{b}: {c}', fontSize: 11, color: labelColor },
              emphasis: {
                itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' },
              },
            }],
          }
          break
        }
        case 'gauge':
          option = {
            backgroundColor: 'transparent',
            tooltip: {
              trigger: 'item',
              backgroundColor: tooltipBg,
              borderColor: tooltipBorder,
              textStyle: { color: tooltipText },
            },
            series: [{
              type: 'gauge',
              min: options?.min ?? 0,
              max: options?.max ?? 100,
              detail: { formatter: '{value}', fontSize: 24, color: tooltipText },
              data: [{ value: chartData.value, name: chartData.name }],
              axisLine: { lineStyle: { width: 12, color: [
                [0.3, '#7EB26D'], [0.7, '#EAB839'], [1, '#E24D42']
              ] } },
              splitLine: { length: 12 },
              axisTick: { length: 8 },
              axisLabel: { fontSize: 10, color: labelColor },
              title: { fontSize: 12, color: labelColor, offsetCenter: [0, '70%'] },
            }],
          }
          break
      }

      chartInstance.current.setOption(option, { notMerge: true })
    } catch (e) {
      console.error('ECharts render error:', e)
    }
  }, [chartData, type, options, theme])

  return (
    <Paper
      sx={{
        height: '100%',
        width: '100%',
        borderRadius: '3px',
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      <Box className="grid-drag-handle" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, position: 'relative', zIndex: 10, cursor: 'move' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 500, fontSize: '0.8125rem', color: 'text.primary' }}>
          {title}
        </Typography>
        {showMenu && (
          <>
            <IconButton size="small" className="grid-drag-cancel" onClick={(e) => setMenuAnchor(e.currentTarget)}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              {onEdit && <MenuItem onClick={() => { setMenuAnchor(null); onEdit() }}>编辑</MenuItem>}
              {onDuplicate && <MenuItem onClick={() => { setMenuAnchor(null); onDuplicate() }}>复制</MenuItem>}
              {onDelete && <MenuItem onClick={() => { setMenuAnchor(null); onDelete() }} sx={{ color: 'error.main' }}>删除</MenuItem>}
            </Menu>
          </>
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', mt: 0.5 }}>
        {type === 'stat' ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <Typography variant="h3" sx={{ fontWeight: 700, color: options?.thresholds ? options.thresholds[0]?.color : 'text.primary' }}>
              {statValue !== null ? statValue.toFixed(options?.decimals ?? 1) : '-'}
            </Typography>
            {options?.unit && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{options.unit}</Typography>
            )}
          </Box>
        ) : type === 'table' ? (
          <Box sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
            <Box component="table" sx={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: 'text.primary' }}>
              <Box component="thead">
                <Box component="tr">
                  {['Time', 'Metric', 'Value'].map((h) => (
                    <Box component="th" key={h} sx={{ textAlign: 'left', p: 0.5, borderBottom: `1px solid ${theme.palette.divider}`, color: 'text.secondary' }}>{h}</Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {tableData?.rows.map((row: any, idx: number) => (
                  <Box component="tr" key={idx}>
                    <Box component="td" sx={{ p: 0.5, borderBottom: `1px solid ${theme.palette.divider}` }}>{row.time}</Box>
                    <Box component="td" sx={{ p: 0.5, borderBottom: `1px solid ${theme.palette.divider}`, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.metric}</Box>
                    <Box component="td" sx={{ p: 0.5, borderBottom: `1px solid ${theme.palette.divider}` }}>{row.value}</Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        ) : (
          <Box
            className="grid-drag-cancel"
            ref={chartRef}
            sx={{ position: 'absolute', inset: 0 }}
          />
        )}

        {(loading || error) && type !== 'stat' && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)' }}>
            {loading && <CircularProgress size={24} />}
            {error && !loading && <Typography variant="caption" color="error">{error}</Typography>}
          </Box>
        )}
      </Box>
    </Paper>
  )
}
