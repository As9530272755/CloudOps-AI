import { useEffect, useRef, useState, useCallback } from 'react'
import { Box, Typography, CircularProgress, Paper } from '@mui/material'
import * as echarts from 'echarts'
import { ChartType, PanelOptions } from './types'
import { datasourceAPI } from '../../lib/datasource-api'

interface ChartPanelProps {
  title: string
  type: ChartType
  query: string
  dataSourceId: number
  options?: PanelOptions
  start?: string
  end?: string
  step?: string
}

function formatPrometheusData(result: any, chartType: ChartType) {
  if (!result?.data?.result) return null

  const series: Array<{ name: string; data: number[] }> = []
  const times: string[] = []

  const results = result.data.result

  if (chartType === 'stat' || chartType === 'gauge') {
    const first = results[0]
    const value = parseFloat(first?.value?.[1] || first?.values?.[0]?.[1] || 0)
    return { value, name: first?.metric?.__name__ || 'Value' }
  }

  if (chartType === 'pie') {
    const data = results.map((item: any) => ({
      name: item.metric?.instance || item.metric?.pod || item.metric?.name || 'unknown',
      value: parseFloat(item.value?.[1] || 0),
    }))
    return { data }
  }

  if (chartType === 'table') {
    const columns = ['Time', 'Metric', 'Value']
    const rows = results.flatMap((item: any) => {
      const metricName = Object.entries(item.metric)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
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
    const name = item.metric?.instance || item.metric?.pod || item.metric?.node || item.metric?.__name__ || 'Series'
    if (item.values) {
      const data: number[] = []
      item.values.forEach((v: [number, string]) => {
        if (times.length < item.values.length) {
          times.push(new Date(v[0] * 1000).toLocaleTimeString())
        }
        data.push(parseFloat(v[1]))
      })
      series.push({ name, data })
    } else if (item.value) {
      series.push({ name, data: [parseFloat(item.value[1])] })
      times.push(new Date().toLocaleTimeString())
    }
  })

  return { series, times }
}

export default function ChartPanel({
  title,
  type,
  query,
  dataSourceId,
  options = {},
  start,
  end,
  step,
}: ChartPanelProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [statValue, setStatValue] = useState<number | null>(null)
  const [tableData, setTableData] = useState<{ columns: string[]; rows: any[] } | null>(null)

  const loadData = useCallback(async () => {
    if (!dataSourceId || !query) return
    setLoading(true)
    setError('')
    try {
      const req: any = { query }
      if (start && end) {
        req.start = start
        req.end = end
        req.step = step || '15s'
      }
      const result = await datasourceAPI.query(dataSourceId, req)
      if (!result.success) {
        setError(result.error || result.message || 'Query failed')
        return
      }
      // 后端返回的是 ProxyQueryResponse { status, data, error }
      // 真正的 Prometheus 数据在 result.data.data
      const promData = result.data?.data
      const formatted = formatPrometheusData({ data: promData }, type)
      if (type === 'table' && formatted) {
        setTableData(formatted as { columns: string[]; rows: any[] })
      } else {
        setTableData(null)
      }
      renderChart(formatted)
    } catch (err: any) {
      setError(err.message || '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [dataSourceId, query, type, start, end, step])

  const renderChart = useCallback((formatted: any) => {
    if (!chartInstance.current || !formatted) return

    const colors = options.colors || ['#007AFF', '#5856D6', '#34C759', '#FF9500', '#FF3B30', '#AF52DE']

    if (type === 'stat') {
      setStatValue(formatted.value)
      chartInstance.current.clear()
      return
    }

    const baseOption: echarts.EChartsOption = {
      color: colors,
      grid: { top: 40, right: 20, bottom: 30, left: 50, containLabel: true },
      tooltip: { trigger: type === 'pie' ? 'item' : 'axis' },
    }

    let option: echarts.EChartsOption = { ...baseOption }

    switch (type) {
      case 'line':
      case 'bar':
        option = {
          ...option,
          xAxis: {
            type: 'category',
            data: formatted.times || [],
            axisLine: { lineStyle: { color: '#888' } },
          },
          yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: '#888' } },
            splitLine: { lineStyle: { color: '#eee' } },
          },
          series: formatted.series.map((s: any) => ({
            name: s.name,
            type,
            data: s.data,
            smooth: true,
            symbol: 'none',
            areaStyle: type === 'line' ? { opacity: 0.1 } : undefined,
          })),
          legend: options.legend !== false ? { bottom: 0, textStyle: { color: '#666' } } : undefined,
        }
        break
      case 'pie':
        option = {
          ...option,
          series: [{
            type: 'pie',
            radius: ['40%', '70%'],
            data: formatted.data || [],
            label: { show: true, formatter: '{b}: {c}' },
          }],
        }
        break
      case 'gauge':
        option = {
          ...option,
          series: [{
            type: 'gauge',
            min: options.min ?? 0,
            max: options.max ?? 100,
            detail: { formatter: '{value}' },
            data: [{ value: formatted.value, name: formatted.name }],
            axisLine: { lineStyle: { width: 10, color: [
              [0.3, '#34C759'], [0.7, '#FF9500'], [1, '#FF3B30']
            ] } },
          }],
        }
        break
      case 'table':
        chartInstance.current?.clear()
        return
    }

    chartInstance.current.setOption(option, true)
  }, [type, options])

  useEffect(() => {
    if (!chartRef.current) return

    // 初始化 ECharts
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }

    loadData()

    // ResizeObserver：容器尺寸变化时自动 resize + 重绘
    const ro = new ResizeObserver(() => {
      chartInstance.current?.resize()
      // 如果之前因尺寸为0没画出来，现在retry
      if (chartRef.current && chartRef.current.clientWidth > 0 && chartRef.current.clientHeight > 0) {
        chartInstance.current?.resize()
      }
    })
    ro.observe(chartRef.current)

    const handleWinResize = () => chartInstance.current?.resize()
    window.addEventListener('resize', handleWinResize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', handleWinResize)
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [loadData])

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

      {loading && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {error && !loading && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="caption" color="error">{error}</Typography>
        </Box>
      )}

      {!loading && !error && type === 'stat' && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <Typography variant="h3" sx={{ fontWeight: 700, color: '#007AFF' }}>
            {statValue !== null ? statValue.toFixed(options.decimals ?? 1) : '-'}
          </Typography>
          {options.unit && (
            <Typography variant="caption" color="text.secondary">{options.unit}</Typography>
          )}
        </Box>
      )}

      {!loading && !error && type === 'table' && tableData && (
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <Box component="table" sx={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <Box component="thead">
              <Box component="tr">
                {tableData.columns.map((h) => (
                  <Box component="th" key={h} sx={{ textAlign: 'left', p: 0.5, borderBottom: '1px solid #eee', color: '#666' }}>{h}</Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {tableData.rows.map((row: any, idx: number) => (
                <Box component="tr" key={idx}>
                  <Box component="td" sx={{ p: 0.5, borderBottom: '1px solid #f0f0f0' }}>{row.time}</Box>
                  <Box component="td" sx={{ p: 0.5, borderBottom: '1px solid #f0f0f0', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.metric}</Box>
                  <Box component="td" sx={{ p: 0.5, borderBottom: '1px solid #f0f0f0' }}>{row.value}</Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {!loading && !error && type !== 'stat' && type !== 'table' && (
        <Box ref={chartRef} sx={{ flex: 1, minHeight: 0 }} />
      )}
    </Paper>
  )
}
