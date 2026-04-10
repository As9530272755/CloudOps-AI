import { useEffect, useRef, useState, useCallback } from 'react'
import { Box, Typography, CircularProgress, Paper } from '@mui/material'
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
  const times: string[] = []

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
        if (times.length < item.values.length) {
          times.push(new Date(v[0] * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
        }
        data.push(parseFloat(v[1]))
      })
      series.push({ name, data })
    } else if (item.value) {
      series.push({ name, data: [parseFloat(item.value[1])] })
      times.push(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    }
  })

  return { series, times }
}

// Grafana-style auto points: show points when density is low
// Heuristic: at least ~8px per data point on screen
function shouldShowPoints(showPoints: 'auto' | 'always' | 'never', chartWidth: number, dataLength: number): 'circle' | 'none' {
  if (showPoints === 'never') return 'none'
  if (showPoints === 'always') return 'circle'
  if (dataLength <= 1) return 'circle'
  return chartWidth / dataLength > 8 ? 'circle' : 'none'
}

export function ChartPanel({ title, type, query, dataSourceId, options }: {
  title: string
  type: ChartType
  query: string
  dataSourceId: number
  options?: PanelOptions
}) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const [chartData, setChartData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statValue, setStatValue] = useState<number | null>(null)
  const [tableData, setTableData] = useState<{ columns: string[]; rows: any[] } | null>(null)

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
      chartInstance.current = echarts.init(chartRef.current)
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

  // 数据或类型变化时重新拉取
  useEffect(() => {
    loadData()
  }, [loadData])

  // chartData 准备好后绘制（Grafana 风格）
  useEffect(() => {
    if (!chartInstance.current || !chartData) return
    if (type === 'stat' || type === 'table') return

    const showLegend = options?.legend !== false
    const chartWidth = chartRef.current?.clientWidth || 400
    const dataLength = chartData.times?.length || 1

    // Resolve Grafana-style options with defaults
    const drawStyle = resolveOption(options, 'drawStyle')
    const lineWidth = resolveOption(options, 'lineWidth')
    const fillOpacity = resolveOption(options, 'fillOpacity')
    const showPoints = resolveOption(options, 'showPoints')
    const pointSize = resolveOption(options, 'pointSize')
    const lineInterpolation = resolveOption(options, 'lineInterpolation')

    let option: echarts.EChartsOption = {}

    switch (type) {
      case 'line':
      case 'bar': {
        const effectiveType = drawStyle === 'points' ? 'line' : (drawStyle === 'bar' ? 'bar' : 'line')
        const symbol = drawStyle === 'points'
          ? 'circle'
          : shouldShowPoints(showPoints, chartWidth, dataLength)

        option = {
          backgroundColor: 'transparent',
          color: GRAFANA_COLORS,
          grid: {
            top: 16,
            right: showLegend ? 160 : 16,
            bottom: 40,
            left: 48,
            containLabel: false,
          },
          tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(31, 41, 55, 0.95)',
            borderColor: '#374151',
            textStyle: { color: '#f3f4f6', fontSize: 12 },
            axisPointer: { type: 'cross', label: { backgroundColor: '#6b7280' } },
            confine: true,
            order: 'valueDesc',
          },
          dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', start: 0, end: 100, height: 18, bottom: 8, borderColor: 'transparent', fillerColor: 'rgba(0,122,255,0.15)' },
          ],
          xAxis: {
            type: 'category',
            data: chartData.times || [],
            axisLine: { lineStyle: { color: '#d1d5db' } },
            axisLabel: { color: '#6b7280', fontSize: 11, rotate: 0 },
            splitLine: { show: true, lineStyle: { color: '#f3f4f6' } },
          },
          yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: '#6b7280', fontSize: 11 },
            splitLine: { lineStyle: { color: '#e5e7eb' } },
          },
          legend: showLegend
            ? {
                type: 'scroll',
                orient: 'vertical',
                right: 8,
                top: 8,
                bottom: 8,
                icon: 'roundRect',
                textStyle: { color: '#374151', fontSize: 11, width: 135, overflow: 'truncate' },
                pageIconColor: '#374151',
                pageTextStyle: { color: '#374151' },
                tooltip: { show: true },
              }
            : undefined,
          series: chartData.series.map((s: any) => {
            const isLine = effectiveType === 'line'
            const areaOpacity = isLine && fillOpacity > 0 ? fillOpacity / 100 : 0

            return {
              name: s.name,
              type: effectiveType,
              data: s.data,
              smooth: lineInterpolation === 'smooth',
              symbol: symbol,
              symbolSize: symbol === 'circle' ? pointSize : undefined,
              lineStyle: isLine ? { width: lineWidth } : undefined,
              itemStyle: isLine ? undefined : undefined,
              // Grafana: fill only when fillOpacity > 0
              areaStyle: areaOpacity > 0 ? { opacity: areaOpacity } : undefined,
              emphasis: {
                lineStyle: { width: isLine ? Math.max(lineWidth + 1, 2) : undefined },
              },
            }
          }),
        }
        break
      }
      case 'pie':
        option = {
          backgroundColor: 'transparent',
          color: GRAFANA_COLORS,
          tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(31, 41, 55, 0.95)',
            borderColor: '#374151',
            textStyle: { color: '#f3f4f6' },
          },
          legend: options?.legend !== false
            ? { type: 'scroll', orient: 'vertical', right: 8, top: 'center', textStyle: { fontSize: 11 } }
            : undefined,
          series: [{
            type: 'pie',
            radius: ['35%', '65%'],
            center: ['40%', '50%'],
            data: chartData.data || [],
            label: { show: true, formatter: '{b}: {c}', fontSize: 11 },
            emphasis: {
              itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' },
            },
          }],
        }
        break
      case 'gauge':
        option = {
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(31, 41, 55, 0.95)',
            borderColor: '#374151',
            textStyle: { color: '#f3f4f6' },
          },
          series: [{
            type: 'gauge',
            min: options?.min ?? 0,
            max: options?.max ?? 100,
            detail: { formatter: '{value}', fontSize: 24, color: '#374151' },
            data: [{ value: chartData.value, name: chartData.name }],
            axisLine: { lineStyle: { width: 12, color: [
              [0.3, '#7EB26D'], [0.7, '#EAB839'], [1, '#E24D42']
            ] } },
            splitLine: { length: 12 },
            axisTick: { length: 8 },
            axisLabel: { fontSize: 10, color: '#6b7280' },
            title: { fontSize: 12, color: '#6b7280', offsetCenter: [0, '70%'] },
          }],
        }
        break
    }

    try {
      chartInstance.current.setOption(option, { notMerge: true })
    } catch (e) {
      console.error('ECharts setOption error:', e)
    }
  }, [chartData, type, options])

  return (
    <Paper
      sx={{
        height: '100%',
        width: '100%',
        borderRadius: '16px',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: 'rgba(255,255,255,0.7)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.3)',
      }}
    >
      <Box className="drag-handle" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, position: 'relative', zIndex: 10 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1D2939' }}>
          {title}
        </Typography>
      </Box>

      {/* 图表区：始终保留 DOM，loading/error 用 overlay */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {type === 'stat' ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <Typography variant="h3" sx={{ fontWeight: 700, color: '#007AFF' }}>
              {statValue !== null ? statValue.toFixed(options?.decimals ?? 1) : '-'}
            </Typography>
            {options?.unit && (
              <Typography variant="caption" color="text.secondary">{options.unit}</Typography>
            )}
          </Box>
        ) : type === 'table' ? (
          <Box sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
            <Box component="table" sx={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <Box component="thead">
                <Box component="tr">
                  {['Time', 'Metric', 'Value'].map((h) => (
                    <Box component="th" key={h} sx={{ textAlign: 'left', p: 0.5, borderBottom: '1px solid #eee', color: '#666' }}>{h}</Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {tableData?.rows.map((row: any, idx: number) => (
                  <Box component="tr" key={idx}>
                    <Box component="td" sx={{ p: 0.5, borderBottom: '1px solid #f0f0f0' }}>{row.time}</Box>
                    <Box component="td" sx={{ p: 0.5, borderBottom: '1px solid #f0f0f0', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.metric}</Box>
                    <Box component="td" sx={{ p: 0.5, borderBottom: '1px solid #f0f0f0' }}>{row.value}</Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        ) : (
          <Box
            ref={chartRef}
            sx={{ position: 'absolute', inset: 0 }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          />
        )}

        {/* loading / error overlay */}
        {(loading || error) && type !== 'stat' && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.7)' }}>
            {loading && <CircularProgress size={24} />}
            {error && !loading && <Typography variant="caption" color="error">{error}</Typography>}
          </Box>
        )}
      </Box>
    </Paper>
  )
}
