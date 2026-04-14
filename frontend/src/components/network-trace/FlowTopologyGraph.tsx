import { useRef, useCallback, useEffect, useState } from 'react'
import { Box, useTheme } from '@mui/material'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { FlowNode, FlowEdge } from '../../lib/network-trace-api'

interface FlowTopologyGraphProps {
  nodes: FlowNode[]
  edges: FlowEdge[]
  target: FlowNode
  onNodeClick?: (node: FlowNode) => void
  onEdgeClick?: (edge: FlowEdge) => void
  onNodeDoubleClick?: (node: FlowNode) => void
  highlightNodeId?: string | null
}

// Istio-style palette for dark theme
const CATEGORY_COLORS: Record<string, string> = {
  target: '#2196f3', // blue 500
  pod: '#4caf50',    // green 500
  service: '#ff9800', // orange 500
  external: '#f44336', // red 500
  database: '#9c27b0', // purple 500
  ingress: '#00bcd4', // cyan 500
}

export default function FlowTopologyGraph({
  nodes,
  edges,
  target,
  onNodeClick,
  onEdgeClick,
  onNodeDoubleClick,
  highlightNodeId,
}: FlowTopologyGraphProps) {
  const theme = useTheme()
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const [mounted, setMounted] = useState(false)
  const [chartKey, setChartKey] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Initialize ECharts
  useEffect(() => {
    if (!chartRef.current || !mounted) return
    let instance: echarts.ECharts | null = null
    try {
      instance = echarts.init(chartRef.current, theme.palette.mode === 'dark' ? 'dark' : undefined, {
        renderer: 'canvas',
      })
      chartInstance.current = instance
      setChartKey((k) => k + 1)
    } catch (err) {
      console.error('ECharts init failed:', err)
      return
    }

    const handleResize = () => instance?.resize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      instance?.dispose()
      chartInstance.current = null
    }
  }, [mounted, theme.palette.mode])

  // Click handlers
  useEffect(() => {
    const instance = chartInstance.current
    if (!instance) return

    const handleClick = (params: any) => {
      if (params.dataType === 'node' && onNodeClick) {
        const node = nodes.find((n) => n.id === params.data.id) || target
        onNodeClick(node)
      }
      if (params.dataType === 'edge' && onEdgeClick) {
        const edge = edges.find((e) => e.source === params.data.source && e.target === params.data.target)
        if (edge) onEdgeClick(edge)
      }
    }

    instance.on('click', handleClick)
    return () => {
      instance.off('click', handleClick)
    }
  }, [nodes, edges, target, onNodeClick, onEdgeClick])

  // Double click for drill down
  useEffect(() => {
    const instance = chartInstance.current
    if (!instance) return

    const handleDblClick = (params: any) => {
      if (params.dataType === 'node' && onNodeDoubleClick) {
        const node = nodes.find((n) => n.id === params.data.id) || target
        onNodeDoubleClick(node)
      }
    }

    instance.on('dblclick', handleDblClick)
    return () => {
      instance.off('dblclick', handleDblClick)
    }
  }, [nodes, target, onNodeDoubleClick])

  // Build ECharts option
  const buildOption = useCallback((): EChartsOption => {
    const isDark = theme.palette.mode === 'dark'
    const bgColor = isDark ? '#0a0f1e' : '#ffffff' // deep navy for dark
    const textColor = isDark ? '#e8eaf6' : '#1a237e'

    const allNodes = [
      {
        ...target,
        symbolSize: target.symbolSize || 90,
        x: 0,
        y: 0,
        fixed: true,
        itemStyle: {
          color: CATEGORY_COLORS[target.type] || '#2196f3',
          shadowBlur: 40,
          shadowColor: 'rgba(33,150,243,0.6)',
          borderWidth: 4,
          borderColor: '#ffffff',
        },
        label: {
          show: true,
          position: 'bottom' as const,
          fontSize: 14,
          fontWeight: 700 as const,
          color: isDark ? '#ffffff' : textColor,
          distance: 14,
        },
      },
      ...nodes.map((n) => {
        const isHighlighted = highlightNodeId && n.id === highlightNodeId
        const color = CATEGORY_COLORS[n.type] || '#90a4ae'
        return {
          ...n,
          symbolSize: n.symbolSize || (n.type === 'service' ? 42 : n.type === 'database' ? 38 : 30),
          itemStyle: {
            color,
            shadowBlur: isHighlighted ? 16 : 8,
            shadowColor: isHighlighted ? color : `${color}40`,
            borderWidth: isHighlighted ? 2 : 0,
            borderColor: '#ffffff',
          },
          label: {
            show: true,
            position: 'bottom' as const,
            fontSize: 12,
            fontWeight: 500 as const,
            color: isDark ? '#ffffff' : textColor,
            distance: 10,
          },
        }
      }),
    ]

    const protocolColors: Record<string, string> = {
      HTTP: '#42a5f5',
      gRPC: '#66bb6a',
      TCP: '#78909c',
      MySQL: '#ab47bc',
      Redis: '#ec407a',
      UDP: '#ffa726',
    }

    const links = edges.map((e) => {
      const isHighlighted = highlightNodeId && (e.source === highlightNodeId || e.target === highlightNodeId)
      const width = Math.max(4, Math.min(14, Math.log(e.bytes / 1024 + 1) * 2.2))
      const color = protocolColors[e.protocol] || '#90a4ae'
      return {
        source: e.source,
        target: e.target,
        value: e.bytes,
        protocol: e.protocol,
        port: e.port,
        requests: e.requests,
        latencyP95: e.latencyP95,
        successRate: e.successRate,
        lineStyle: {
          width: isHighlighted ? width + 2 : width,
          color: color,
          curveness: 0.25,
          opacity: isHighlighted ? 1 : highlightNodeId ? 0.25 : 0.85,
          cap: 'round' as const,
        },
        emphasis: {
          lineStyle: { width: width + 4, opacity: 1 },
        },
        label: {
          show: true,
          position: 'middle' as const,
          fontSize: 10,
          fontWeight: 600 as const,
          color: isDark ? '#ffffff' : textColor,
          formatter: `${e.protocol}\n${formatBytes(e.bytes)}`,
          backgroundColor: 'transparent',
          borderWidth: 0,
          textBorderColor: isDark ? '#0a0f1e' : '#e0e0e0',
          textBorderWidth: 2,
          distance: 5,
        },
      }
    })

    const option: EChartsOption = {
      backgroundColor: bgColor,
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? 'rgba(16,22,40,0.95)' : 'rgba(255,255,255,0.95)',
        borderColor: isDark ? '#1e3a8a' : '#e0e0e0',
        textStyle: { color: isDark ? '#ffffff' : '#1a237e' },
        formatter: (params: any) => {
          if (params.dataType === 'node') {
            const d = params.data as FlowNode
            return `<div style="font-weight:bold;margin-bottom:4px;color:#42a5f5">${d.name}</div>
              <div>类型: ${d.type}</div>
              ${d.namespace ? `<div>Namespace: ${d.namespace}</div>` : ''}
              ${d.node ? `<div>Node: ${d.node}</div>` : ''}
            `
          }
          const d = params.data
          return `<div style="font-weight:bold;margin-bottom:4px;color:#42a5f5">${d.source} → ${d.target}</div>
            <div>协议: ${d.protocol} :${d.port}</div>
            <div>流量: ${formatBytes(d.value)}</div>
            <div>请求数: ${d.requests.toLocaleString()}</div>
            <div>延迟P95: ${d.latencyP95}ms</div>
            <div>成功率: ${d.successRate}%</div>
          `
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          zoom: 0.9,
          label: { show: true, position: 'bottom' },
          edgeSymbol: ['none' as const, 'arrow' as const],
          edgeSymbolSize: [0, 10],
          force: {
            repulsion: 2000,
            edgeLength: [120, 260],
            gravity: 0.12,
            friction: 0.08,
            layoutAnimation: true,
          },
          data: allNodes,
          links,
          emphasis: {
            focus: 'adjacency',
            lineStyle: { width: 8 },
          },
        },
      ],
    }
    return option
  }, [nodes, edges, target, theme.palette.mode, highlightNodeId])

  // Sync option to chart whenever buildOption changes or instance is (re)created
  useEffect(() => {
    const instance = chartInstance.current
    if (!instance) return
    try {
      instance.setOption(buildOption(), true)
    } catch (err) {
      console.error('ECharts setOption failed:', err)
    }
  }, [buildOption, chartKey])

  return (
    <Box
      ref={chartRef}
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: theme.palette.mode === 'dark' ? '#0a0f1e' : 'background.paper',
      }}
    />
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`
}
