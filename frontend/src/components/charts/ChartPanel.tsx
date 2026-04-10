import { useEffect, useRef, useState, useCallback } from 'react'
import { Box, Typography, CircularProgress, Paper, IconButton, Menu, MenuItem } from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import * as echarts from 'echarts'
import { ChartType, PanelOptions } from './types'
import { datasourceAPI } from '../../lib/datasource-api'

// Sci-fi neon palette inspired by Datadog / VictoriaMetrics / modern cyberpunk dashboards
const SCI_FI_COLORS = [
  '#00f0ff', '#ff00aa', '#00ff88', '#facc15', '#a855f7',
  '#f472b6', '#38bdf8', '#fb923c', '#ef4444', '#22d3ee',
  '#c084fc', '#34d399', '#fbbf24', '#f87171', '#60a5fa',
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

function CustomLegend({
  series,
  placement,
}: {
  series: Array<{ name: string }>
  placement: 'bottom' | 'left' | 'right'
}) {
  const isHorizontal = placement === 'bottom'
  const maxWidth = isHorizontal ? 180 : 190

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        flexWrap: isHorizontal ? 'wrap' : 'nowrap',
        gap: '5px 14px',
        overflow: 'auto',
        ...(isHorizontal
          ? { maxHeight: 68, pt: 1, borderTop: '1px solid rgba(59,130,246,0.15)' }
          : { maxWidth: 210, pl: 1.5, borderLeft: '1px solid rgba(59,130,246,0.15)' }),
        scrollbarWidth: 'thin',
        '&::-webkit-scrollbar': { width: '4px', height: '4px' },
        '&::-webkit-scrollbar-thumb': { background: 'rgba(59,130,246,0.25)', borderRadius: '2px' },
      }}
    >
      {series.map((s, idx) => (
        <Box
          key={s.name + idx}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.8,
            cursor: 'pointer',
            px: 0.5,
            py: 0.2,
            borderRadius: '4px',
            transition: 'background 0.2s',
            '&:hover': { background: 'rgba(59,130,246,0.08)' },
          }}
          title={s.name}
        >
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: SCI_FI_COLORS[idx % SCI_FI_COLORS.length],
              boxShadow: `0 0 6px ${SCI_FI_COLORS[idx % SCI_FI_COLORS.length]}`,
              flexShrink: 0,
            }}
          />
          <Typography
            noWrap
            sx={{
              fontSize: '11px',
              color: '#94a3b8',
              maxWidth,
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            }}
          >
            {s.name}
          </Typography>
        </Box>
      ))}
    </Box>
  )
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
      chartInstance.current = echarts.init(chartRef.current, 'dark')
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

    // Sci-fi dark theme colors (hardcoded for consistent aesthetic)
    const axisColor = '#1e3a5f'
    const labelColor = '#64748b'
    const splitColor = '#0f172a'
    const tooltipBg = 'rgba(11,17,32,0.95)'
    const tooltipBorder = 'rgba(0,240,255,0.25)'
    const tooltipText = '#e2e8f0'

    // Custom DOM legend means we don't need grid to reserve legend space
    const gridRight = legendPlacement === 'right' && showLegend ? 16 : 16
    const gridLeft = legendPlacement === 'left' && showLegend ? 16 : 48
    const gridBottom = legendPlacement === 'bottom' && showLegend ? 16 : 24
    const gridTop = 24

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

          option = {
            backgroundColor: 'transparent',
            color: SCI_FI_COLORS,
            grid: {
              top: gridTop,
              right: gridRight,
              bottom: gridBottom,
              left: gridLeft,
              containLabel: false,
            },
            tooltip: {
              trigger: 'axis',
              backgroundColor: tooltipBg,
              borderColor: tooltipBorder,
              borderWidth: 1,
              textStyle: { color: tooltipText, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
              axisPointer: { type: 'cross', label: { backgroundColor: '#0b1120', color: '#00f0ff' }, lineStyle: { color: 'rgba(0,240,255,0.4)' }, crossStyle: { color: 'rgba(0,240,255,0.2)' } },
              confine: true,
              order: 'valueDesc',
              enterable: true,
              extraCssText: 'max-height: 260px; overflow-y: auto; backdrop-filter: blur(6px);',
              formatter: (params: any) => {
                if (!Array.isArray(params) || params.length === 0) return ''
                const t = new Date(params[0].axisValue)
                const timeLabel = `${(t.getMonth() + 1).toString().padStart(2, '0')}/${t.getDate().toString().padStart(2, '0')} ${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`
                let html = `<div style="font-weight:600;margin-bottom:6px;color:#00f0ff;font-size:12px;">${timeLabel}</div>`
                for (let i = 0; i < params.length; i++) {
                  const p = params[i]
                  html += `<div style="display:flex;align-items:center;gap:6px;margin:3px 0;white-space:nowrap;color:#e2e8f0;font-size:11px;">`
                  html += `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color};box-shadow:0 0 5px ${p.color};"></span>`
                  html += `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;max-width:260px;">${p.seriesName}</span>`
                  html += `<span style="font-weight:600;margin-left:8px;color:#fff;">${p.value}</span>`
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
              axisLabel: { color: labelColor, fontSize: 10, rotate: 0, formatter: '{MM}-{dd} {HH}:{mm}' },
              splitLine: { show: false },
            },
            yAxis: {
              type: 'value',
              axisLine: { show: false },
              axisLabel: { color: labelColor, fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
              splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
            },
            legend: { show: false }, // custom DOM legend instead
            series: chartData.series.map((s: any, idx: number) => {
              const isLine = effectiveType === 'line'
              const areaOpacity = isLine && fillOpacity > 0 ? fillOpacity / 100 : 0
              const c = SCI_FI_COLORS[idx % SCI_FI_COLORS.length]

              return {
                name: s.name,
                type: effectiveType,
                data: s.data.map((v: number, i: number) => [chartData.timestamps[i], v]),
                smooth: lineInterpolation === 'smooth',
                symbol: symbol,
                symbolSize: symbol === 'circle' ? pointSize : undefined,
                lineStyle: isLine ? { width: lineWidth, shadowBlur: 8, shadowColor: c } : undefined,
                itemStyle: { color: c },
                areaStyle: areaOpacity > 0 ? { opacity: areaOpacity, color: new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c }, { offset: 1, color: 'transparent' }]) } : undefined,
                emphasis: {
                  lineStyle: { width: isLine ? Math.max(lineWidth + 1, 2) : undefined, shadowBlur: 12, shadowColor: c },
                },
              }
            }),
          }
          break
        }
        case 'pie': {
          const pieCount = (chartData.data || []).length
          const showPieLabel = pieCount <= 10
          option = {
            backgroundColor: 'transparent',
            color: SCI_FI_COLORS,
            tooltip: {
              trigger: 'item',
              backgroundColor: tooltipBg,
              borderColor: tooltipBorder,
              borderWidth: 1,
              textStyle: { color: tooltipText },
            },
            legend: { show: false },
            series: [{
              type: 'pie',
              radius: ['35%', '65%'],
              center: ['50%', '50%'],
              data: chartData.data || [],
              label: { show: showPieLabel, formatter: '{b}: {c}', fontSize: 10, color: '#94a3b8' },
              emphasis: {
                itemStyle: { shadowBlur: 14, shadowOffsetX: 0, shadowColor: 'rgba(0, 240, 255, 0.6)' },
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
              borderWidth: 1,
              textStyle: { color: tooltipText },
            },
            series: [{
              type: 'gauge',
              min: options?.min ?? 0,
              max: options?.max ?? 100,
              detail: { formatter: '{value}', fontSize: 26, color: '#e2e8f0', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
              data: [{ value: chartData.value, name: chartData.name }],
              axisLine: { lineStyle: { width: 12, color: [
                [0.3, '#00f0ff'], [0.7, '#facc15'], [1, '#ff00aa']
              ] } },
              splitLine: { length: 12, lineStyle: { color: '#1e3a5f' } },
              axisTick: { length: 8, lineStyle: { color: '#1e3a5f' } },
              axisLabel: { fontSize: 10, color: '#64748b' },
              title: { fontSize: 12, color: '#64748b', offsetCenter: [0, '70%'] },
            }],
          }
          break
      }

      chartInstance.current.setOption(option, { notMerge: true })
    } catch (e) {
      console.error('ECharts render error:', e)
    }
  }, [chartData, type, options])

  const legendPlacement = options?.legendPlacement ?? 'bottom'
  const showCustomLegend = options?.legend !== false && legendPlacement !== 'hidden' && (type === 'line' || type === 'bar' || type === 'pie')

  return (
    <Paper
      sx={{
        height: '100%',
        width: '100%',
        borderRadius: '6px',
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: 'linear-gradient(145deg, rgba(13,20,36,0.95) 0%, rgba(8,12,22,0.98) 100%)',
        border: '1px solid rgba(59,130,246,0.12)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.3), 0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)',
        transition: 'box-shadow 0.3s, border-color 0.3s',
        '&:hover': {
          borderColor: 'rgba(59,130,246,0.25)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.3), 0 12px 40px rgba(0,0,0,0.45), 0 0 18px rgba(0,240,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)',
        },
      }}
      elevation={0}
    >
      <Box className="grid-drag-handle" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, position: 'relative', zIndex: 10, cursor: 'move' }}>
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 500,
            fontSize: '0.8125rem',
            color: '#00f0ff',
            textShadow: '0 0 8px rgba(0,240,255,0.35)',
            letterSpacing: '0.02em',
          }}
        >
          {title}
        </Typography>
        {showMenu && (
          <>
            <IconButton size="small" className="grid-drag-cancel" onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{ color: '#94a3b8' }}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              PaperProps={{ sx: { bgcolor: 'rgba(11,17,32,0.98)', border: '1px solid rgba(59,130,246,0.25)', color: '#e2e8f0' } }}
            >
              {onEdit && <MenuItem onClick={() => { setMenuAnchor(null); onEdit() }} sx={{ color: '#e2e8f0', fontSize: 13 }}>编辑</MenuItem>}
              {onDuplicate && <MenuItem onClick={() => { setMenuAnchor(null); onDuplicate() }} sx={{ color: '#e2e8f0', fontSize: 13 }}>复制</MenuItem>}
              {onDelete && <MenuItem onClick={() => { setMenuAnchor(null); onDelete() }} sx={{ color: '#ff00aa', fontSize: 13 }}>删除</MenuItem>}
            </Menu>
          </>
        )}
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: showCustomLegend && legendPlacement === 'right' ? 'row' : 'column',
        }}
      >
        <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative', mt: 0.5 }}>
          {type === 'stat' ? (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <Typography
                variant="h3"
                sx={{
                  fontWeight: 700,
                  color: options?.thresholds ? options.thresholds[0]?.color : '#e2e8f0',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                  textShadow: '0 0 14px rgba(0,240,255,0.25)',
                }}
              >
                {statValue !== null ? statValue.toFixed(options?.decimals ?? 1) : '-'}
              </Typography>
              {options?.unit && (
                <Typography variant="caption" sx={{ color: '#64748b', mt: 0.5 }}>{options.unit}</Typography>
              )}
            </Box>
          ) : type === 'table' ? (
            <Box sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
              <Box component="table" sx={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: '#e2e8f0' }}>
                <Box component="thead">
                  <Box component="tr">
                    {['Time', 'Metric', 'Value'].map((h) => (
                      <Box component="th" key={h} sx={{ textAlign: 'left', p: 0.75, borderBottom: '1px solid rgba(59,130,246,0.2)', color: '#00f0ff', fontSize: 10, fontWeight: 600 }}>{h}</Box>
                    ))}
                  </Box>
                </Box>
                <Box component="tbody">
                  {tableData?.rows.map((row: any, idx: number) => (
                    <Box component="tr" key={idx} sx={{ '&:hover': { background: 'rgba(59,130,246,0.06)' } }}>
                      <Box component="td" sx={{ p: 0.75, borderBottom: '1px solid rgba(30,58,95,0.4)', color: '#94a3b8', fontSize: 10 }}>{row.time}</Box>
                      <Box component="td" sx={{ p: 0.75, borderBottom: '1px solid rgba(30,58,95,0.4)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 10 }}>{row.metric}</Box>
                      <Box component="td" sx={{ p: 0.75, borderBottom: '1px solid rgba(30,58,95,0.4)', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: 10 }}>{row.value}</Box>
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
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(8,12,22,0.7)' }}>
              {loading && <CircularProgress size={24} sx={{ color: '#00f0ff' }} />}
              {error && !loading && <Typography variant="caption" sx={{ color: '#ff00aa' }}>{error}</Typography>}
            </Box>
          )}
        </Box>

        {showCustomLegend && chartData?.series && legendPlacement === 'bottom' && (
          <CustomLegend series={chartData.series} placement="bottom" />
        )}
        {showCustomLegend && chartData?.series && legendPlacement === 'right' && (
          <CustomLegend series={chartData.series} placement="right" />
        )}
        {showCustomLegend && chartData?.series && legendPlacement === 'left' && (
          <CustomLegend series={chartData.series} placement="left" />
        )}
      </Box>
    </Paper>
  )
}
