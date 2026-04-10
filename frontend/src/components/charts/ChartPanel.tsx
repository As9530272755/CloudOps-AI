import { useEffect, useRef, useState, useCallback } from 'react'
import { Box, Typography, CircularProgress, Paper, IconButton, Menu, MenuItem, useTheme } from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import * as echarts from 'echarts'
import { ChartType, PanelOptions } from './types'
import { datasourceAPI } from '../../lib/datasource-api'

// Dark mode: sci-fi neon palette
const DARK_COLORS = [
  '#00f0ff', '#ff00aa', '#00ff88', '#facc15', '#a855f7',
  '#f472b6', '#38bdf8', '#fb923c', '#ef4444', '#22d3ee',
  '#c084fc', '#34d399', '#fbbf24', '#f87171', '#60a5fa',
]

// Light mode: professional clean palette (Apple/Datadog inspired)
const LIGHT_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#5856D6', '#FF3B30',
  '#5AC8FA', '#AF52DE', '#FFCC00', '#A2845E', '#00C7BE',
  '#64D2FF', '#FF6482', '#BF5AF2', '#FFD60A', '#30B0C7',
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

  if (chartType === 'text') {
    const lines = results.map((item: any) => {
      const name = formatSeriesName(item.metric || {})
      const val = item.value?.[1] || '-'
      return `${name}: ${val}`
    })
    return { text: lines.join('\n') }
  }

  // line / bar / area / scatter / heatmap
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

function hexToRgba(hex: string, alpha: number) {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function GaugeCanvasParticles({
  active,
  colors,
  isDark,
}: {
  active: boolean
  colors?: string[]
  isDark: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>()
  const sizeRef = useRef({ w: 0, h: 0 })

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      sizeRef.current = { w: rect.width, h: rect.height }
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    const defaultColors = isDark ? ['#00f0ff', '#facc15', '#ff00aa'] : ['#007AFF', '#FF9500', '#FF3B30']
    const palette = colors?.length ? colors : defaultColors

    interface Bubble {
      angle: number
      radiusPct: number
      angleSpeed: number
      radiusSpeed: number
      baseSize: number
      color: string
      life: number
      maxLife: number
      bobOffset: number
      bobSpeed: number
      z: number // pseudo-depth for parallax size
    }

    const bubbles: Bubble[] = []
    const maxBubbles = 36
    const startAngle = (225 * Math.PI) / 180

    const spawn = () => {
      if (bubbles.length >= maxBubbles) return
      const angle = startAngle - Math.random() * 1.5 * Math.PI
      const isOrbiter = Math.random() > 0.5
      bubbles.push({
        angle,
        radiusPct: isOrbiter ? 0.48 + Math.random() * 0.22 : 0.2 + Math.random() * 0.32,
        angleSpeed: isOrbiter
          ? (Math.random() > 0.5 ? 0.0025 : -0.0025) * (0.7 + Math.random())
          : (Math.random() - 0.5) * 0.0012,
        radiusSpeed: isOrbiter ? 0 : (Math.random() - 0.5) * 0.0015,
        baseSize: isOrbiter ? 2.2 + Math.random() * 3 : 1.6 + Math.random() * 2.2,
        color: palette[Math.floor(Math.random() * palette.length)],
        life: 0,
        maxLife: 180 + Math.random() * 220,
        bobOffset: Math.random() * Math.PI * 2,
        bobSpeed: 0.02 + Math.random() * 0.03,
        z: Math.random(),
      })
    }

    let lastSpawn = 0
    let t = 0

    function drawSphere(
      c2d: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      r: number,
      color: string,
      alpha: number,
      lightX: number,
      lightY: number
    ) {
      // Outer soft atmospheric glow
      const glow = c2d.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 3)
      glow.addColorStop(0, hexToRgba(color, alpha * 0.5))
      glow.addColorStop(0.5, hexToRgba(color, alpha * 0.15))
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      c2d.fillStyle = glow
      c2d.beginPath()
      c2d.arc(cx, cy, r * 3, 0, Math.PI * 2)
      c2d.fill()

      // Main 3D sphere body
      const body = c2d.createRadialGradient(
        cx + r * lightX * 0.25,
        cy + r * lightY * 0.25,
        0,
        cx,
        cy,
        r
      )
      body.addColorStop(0, hexToRgba('#ffffff', 0.9))
      body.addColorStop(0.25, hexToRgba(color, alpha))
      body.addColorStop(0.65, hexToRgba(color, alpha * 0.8))
      body.addColorStop(1, hexToRgba(color, alpha * 0.25))
      c2d.fillStyle = body
      c2d.beginPath()
      c2d.arc(cx, cy, r, 0, Math.PI * 2)
      c2d.fill()

      // Sharp specular highlight
      const spec = c2d.createRadialGradient(
        cx - r * lightX * 0.35,
        cy - r * lightY * 0.35,
        0,
        cx - r * lightX * 0.35,
        cy - r * lightY * 0.35,
        r * 0.4
      )
      spec.addColorStop(0, 'rgba(255,255,255,0.85)')
      spec.addColorStop(0.5, hexToRgba(color, 0.35))
      spec.addColorStop(1, 'rgba(255,255,255,0)')
      c2d.fillStyle = spec
      c2d.beginPath()
      c2d.arc(cx - r * lightX * 0.35, cy - r * lightY * 0.35, r * 0.55, 0, Math.PI * 2)
      c2d.fill()
    }

    const draw = (now: number) => {
      t += 1
      const { w, h } = sizeRef.current
      ctx.clearRect(0, 0, w, h)
      if (w === 0 || h === 0) {
        animationRef.current = requestAnimationFrame(draw)
        return
      }

      const cx = w * 0.5
      const cy = h * 0.55
      const r = Math.min(w, h) * 0.9 * 0.5

      if (now - lastSpawn > 60 + Math.random() * 50) {
        spawn()
        if (Math.random() > 0.55) spawn()
        lastSpawn = now
      }

      const lightDir = {
        x: Math.cos(t * 0.01),
        y: Math.sin(t * 0.013),
      }

      // Update bubbles
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        b.angle += b.angleSpeed
        b.radiusPct += b.radiusSpeed
        if (b.radiusPct < 0.12 || b.radiusPct > 0.78) b.radiusSpeed *= -1
        b.life++
        if (b.life > b.maxLife) {
          bubbles.splice(i, 1)
        }
      }

      // Draw soft connector lines between near bubbles
      ctx.globalCompositeOperation = 'screen'
      ctx.lineWidth = 0.8
      for (let i = 0; i < bubbles.length; i++) {
        for (let j = i + 1; j < bubbles.length; j++) {
          const a = bubbles[i]
          const b = bubbles[j]
          const ax = cx + Math.cos(a.angle) * (r * a.radiusPct)
          const ay = cy - Math.sin(a.angle) * (r * a.radiusPct)
          const bx = cx + Math.cos(b.angle) * (r * b.radiusPct)
          const by = cy - Math.sin(b.angle) * (r * b.radiusPct)
          const dx = ax - bx
          const dy = ay - by
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 28) {
            const lineAlpha = (1 - dist / 28) * 0.25
            const grad = ctx.createLinearGradient(ax, ay, bx, by)
            grad.addColorStop(0, hexToRgba(a.color, lineAlpha))
            grad.addColorStop(1, hexToRgba(b.color, lineAlpha))
            ctx.strokeStyle = grad
            ctx.beginPath()
            ctx.moveTo(ax, ay)
            ctx.lineTo(bx, by)
            ctx.stroke()
          }
        }
      }

      // Draw bubbles (back-to-front by z)
      const sorted = [...bubbles].sort((a, b) => a.z - b.z)
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < sorted.length; i++) {
        const b = sorted[i]
        const lifeAlpha = Math.min(1, b.life / 40) * Math.min(1, (b.maxLife - b.life) / 40)
        const bob = Math.sin(t * b.bobSpeed + b.bobOffset) * 3
        const pr = r * b.radiusPct + bob
        const x = cx + Math.cos(b.angle) * pr
        const y = cy - Math.sin(b.angle) * pr
        const depthScale = 0.75 + b.z * 0.5
        const size = b.baseSize * depthScale
        drawSphere(ctx, x, y, size, b.color, lifeAlpha, lightDir.x, lightDir.y)
      }

      ctx.globalCompositeOperation = 'source-over'
      animationRef.current = requestAnimationFrame(draw)
    }

    animationRef.current = requestAnimationFrame(draw)

    return () => {
      ro.disconnect()
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [active, colors, isDark])

  if (!active) return null
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  )
}

function SciFiGauge({
  value,
  name,
  min,
  max,
  colors,
  isDark,
}: {
  value: number
  name: string
  min: number
  max: number
  colors?: string[]
  isDark: boolean
}) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1)))
  const pointerAngle = 225 - pct * 270

  const c1 = colors?.[0] || (isDark ? '#00f0ff' : '#007AFF')
  const c2 = colors?.[1] || colors?.[0] || (isDark ? '#facc15' : '#FF9500')
  const c3 = colors?.[2] || colors?.[1] || colors?.[0] || (isDark ? '#ff00aa' : '#FF3B30')

  const bgGradient = isDark
    ? 'radial-gradient(circle at 50% 55%, rgba(11,26,47,0.9) 0%, rgba(2,6,23,0.95) 60%)'
    : 'radial-gradient(circle at 50% 55%, rgba(255,255,255,0.9) 0%, rgba(243,244,246,0.95) 60%)'

  const textColor = isDark ? '#e2e8f0' : '#1f2937'
  const subTextColor = isDark ? '#94a3b8' : '#6b7280'
  const glowFilter = isDark ? 'url(#sf-glow)' : 'url(#sf-glow-light)'

  const describeArc = (cx: number, cy: number, r: number, start: number, end: number) => {
    const toRad = (a: number) => (a * Math.PI) / 180
    const x1 = cx + r * Math.cos(toRad(start))
    const y1 = cy - r * Math.sin(toRad(start))
    const x2 = cx + r * Math.cos(toRad(end))
    const y2 = cy - r * Math.sin(toRad(end))
    const largeArc = Math.abs(end - start) <= 180 ? 0 : 1
    const sweep = end > start ? 0 : 1
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`
  }

  const ticks: Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }> = []
  for (let i = 0; i <= 30; i++) {
    const a = 225 - i * 9
    const rad = (a * Math.PI) / 180
    const isMajor = i % 5 === 0
    const r1 = 90
    const r2 = isMajor ? 83 : 86
    ticks.push({
      x1: 100 + r1 * Math.cos(rad),
      y1: 100 - r1 * Math.sin(rad),
      x2: 100 + r2 * Math.cos(rad),
      y2: 100 - r2 * Math.sin(rad),
      major: isMajor,
    })
  }

  const seg1Path = describeArc(100, 100, 90, 225, 144)
  const seg2Path = describeArc(100, 100, 90, 144, 36)
  const seg3Path = describeArc(100, 100, 90, 36, -45)

  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', inset: 0, background: bgGradient }} />
      <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%', position: 'relative', zIndex: 2 }}>
        <defs>
          <filter id="sf-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="sf-glow-strong" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="sf-glow-light" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="center-pivot">
            <stop offset="0%" stopColor={c1} stopOpacity={1} />
            <stop offset="60%" stopColor={c2} stopOpacity={0.8} />
            <stop offset="100%" stopColor={c3} stopOpacity={0.4} />
          </radialGradient>
          <linearGradient id="scan-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={c1} stopOpacity={0} />
            <stop offset="50%" stopColor={c1} stopOpacity={0.35} />
            <stop offset="100%" stopColor={c1} stopOpacity={0} />
          </linearGradient>
        </defs>

        <style>{`
          @keyframes sf-spin { 100% { transform: rotate(360deg); } }
          @keyframes sf-scan { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          .sf-outer { transform-origin: 100px 100px; animation: sf-spin 10s linear infinite; }
          .sf-inner { transform-origin: 100px 100px; animation: sf-spin 14s linear infinite reverse; }
          .sf-scan { transform-origin: 100px 100px; animation: sf-scan 3.5s linear infinite; }
        `}</style>

        {/* outer dashed ring */}
        <g className="sf-outer">
          <circle cx="100" cy="100" r="94" fill="none" stroke={c1} strokeWidth="1" strokeDasharray="4 6" opacity={isDark ? 0.55 : 0.35} filter={glowFilter} />
        </g>

        {/* inner dashed ring reverse */}
        <g className="sf-inner">
          <circle cx="100" cy="100" r="72" fill="none" stroke={c2} strokeWidth="0.5" strokeDasharray="2 4" opacity={isDark ? 0.4 : 0.25} filter={glowFilter} />
        </g>

        {/* main colored scale arc */}
        <g filter={glowFilter}>
          <path d={seg1Path} fill="none" stroke={c1} strokeWidth="7" strokeLinecap="butt" opacity={0.95} />
          <path d={seg2Path} fill="none" stroke={c2} strokeWidth="7" strokeLinecap="butt" opacity={0.95} />
          <path d={seg3Path} fill="none" stroke={c3} strokeWidth="7" strokeLinecap="butt" opacity={0.95} />
        </g>

        {/* tick marks */}
        <g filter={glowFilter}>
          {ticks.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={isDark ? '#e2e8f0' : '#334155'} strokeWidth={t.major ? 1.5 : 0.8} opacity={t.major ? 0.9 : 0.55} />
          ))}
        </g>

        {/* scan beam wedge */}
        <g className="sf-scan" opacity={isDark ? 0.55 : 0.35}>
          <path d="M 100 100 L 196 92 L 196 108 Z" fill="url(#scan-grad)" filter={glowFilter} />
        </g>

        {/* pointer */}
        <g transform={`rotate(${90 - pointerAngle} 100 100)`} style={{ transition: 'transform 0.55s cubic-bezier(0.22,1,0.36,1)' }}>
          <rect x="99" y="56" width="2" height="44" rx="1" fill={c1} filter="url(#sf-glow-strong)" />
        </g>

        {/* center pivot */}
        <g>
          <circle cx="100" cy="100" r="12" fill="rgba(0,0,0,0.35)" stroke={c1} strokeWidth="1" filter={glowFilter} opacity={isDark ? 0.85 : 0.5} />
          <circle cx="100" cy="100" r="6" fill="url(#center-pivot)" filter="url(#sf-glow-strong)" />
          <circle cx="100" cy="100" r="2.5" fill="#ffffff" opacity={0.95} />
        </g>

        {/* text */}
        <text x="100" y="130" textAnchor="middle" fontSize="22" fontWeight="700" fill={textColor} fontFamily='ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' style={{ textShadow: isDark ? '0 0 8px rgba(0,0,0,0.8)' : 'none' }}>
          {value.toFixed(1)}
        </text>
        <text x="100" y="146" textAnchor="middle" fontSize="10" fill={subTextColor} fontFamily='ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' opacity={0.9}>
          {name || ''}
        </text>
      </svg>
    </Box>
  )
}

function CustomLegend({
  series,
  placement,
  isDark,
}: {
  series: Array<{ name: string }>
  placement: 'bottom' | 'left' | 'right'
  isDark: boolean
}) {
  const isHorizontal = placement === 'bottom'
  const maxWidth = isHorizontal ? 180 : 190
  const borderColor = isDark ? 'rgba(59,130,246,0.15)' : 'rgba(0,0,0,0.08)'
  const hoverBg = isDark ? 'rgba(59,130,246,0.08)' : 'rgba(0,0,0,0.04)'
  const textColor = isDark ? '#94a3b8' : '#475569'
  const palette = isDark ? DARK_COLORS : LIGHT_COLORS

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        flexWrap: isHorizontal ? 'wrap' : 'nowrap',
        gap: '5px 14px',
        overflow: 'auto',
        ...(isHorizontal
          ? { maxHeight: 68, pt: 1, borderTop: `1px solid ${borderColor}` }
          : { maxWidth: 210, pl: 1.5, borderLeft: `1px solid ${borderColor}` }),
        scrollbarWidth: 'thin',
        '&::-webkit-scrollbar': { width: '4px', height: '4px' },
        '&::-webkit-scrollbar-thumb': { background: isDark ? 'rgba(59,130,246,0.25)' : 'rgba(0,0,0,0.15)', borderRadius: '2px' },
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
            '&:hover': { background: hoverBg },
          }}
          title={s.name}
        >
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: palette[idx % palette.length],
              boxShadow: isDark ? `0 0 6px ${palette[idx % palette.length]}` : 'none',
              flexShrink: 0,
            }}
          />
          <Typography
            noWrap
            sx={{
              fontSize: '11px',
              color: textColor,
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
  start,
  end,
  step,
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
  start?: number
  end?: number
  step?: number
  onEdit?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  showMenu?: boolean
}) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const palette = isDark ? DARK_COLORS : LIGHT_COLORS

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
      const endTs = end ?? Math.floor(Date.now() / 1000)
      const startTs = start ?? (endTs - 3600 * 24)
      const stepSec = step ?? 300
      const result = await datasourceAPI.query(dataSourceId, { query, start: String(startTs), end: String(endTs), step: String(stepSec) })
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
  }, [dataSourceId, query, type, start, end, step])

  // 初始化 ECharts + ResizeObserver
  useEffect(() => {
    if (type === 'gauge' || type === 'stat' || type === 'table' || type === 'text') return
    if (!chartRef.current) return
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, isDark ? 'dark' : undefined, { renderer: 'canvas' })
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
  }, [isDark])

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
    if (type === 'stat' || type === 'table' || type === 'text' || type === 'gauge') return

    const legendPlacement = options?.legendPlacement ?? 'bottom'

    const hasSeries = Array.isArray(chartData.series) && Array.isArray(chartData.timestamps)
    const hasPieData = Array.isArray(chartData.data)
    if ((type === 'line' || type === 'bar' || type === 'area' || type === 'scatter' || type === 'heatmap') && !hasSeries) return
    if (type === 'pie' && !hasPieData) return

    const drawStyle = resolveOption(options, 'drawStyle')
    const lineWidth = resolveOption(options, 'lineWidth')
    const fillOpacity = resolveOption(options, 'fillOpacity')
    const showPoints = resolveOption(options, 'showPoints')
    const pointSize = resolveOption(options, 'pointSize')
    const lineInterpolation = resolveOption(options, 'lineInterpolation')

    // Theme-aware chart colors
    const axisColor = isDark ? '#1e3a5f' : '#d1d5db'
    const labelColor = isDark ? '#64748b' : '#6b7280'
    const splitColor = isDark ? '#0f172a' : '#f3f4f6'
    const tooltipBg = isDark ? 'rgba(11,17,32,0.95)' : '#ffffff'
    const tooltipBorder = isDark ? 'rgba(0,240,255,0.25)' : 'rgba(0,0,0,0.1)'
    const tooltipText = isDark ? '#e2e8f0' : '#1f2937'
    const tooltipTitle = isDark ? '#00f0ff' : '#007AFF'

    // Custom DOM legend means we don't need grid to reserve legend space
    const gridRight = legendPlacement === 'right' ? 16 : 16
    const gridLeft = legendPlacement === 'left' ? 16 : 48
    const gridBottom = legendPlacement === 'bottom' ? 16 : 24
    const gridTop = 24

    let option: echarts.EChartsOption = {}

    try {
      switch (type) {
        case 'line':
        case 'bar':
        case 'area':
        case 'scatter': {
          const effectiveType = type === 'scatter'
            ? 'scatter'
            : (type === 'bar' || drawStyle === 'bar' ? 'bar' : 'line')
          const dataLength = chartData.timestamps?.length || 1
          const symbol = type === 'scatter' || drawStyle === 'points'
            ? 'circle'
            : shouldShowPoints(showPoints, chartRef.current?.clientWidth || 400, dataLength)

          option = {
            backgroundColor: 'transparent',
            color: palette,
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
              axisPointer: {
                type: 'cross',
                label: { backgroundColor: isDark ? '#0b1120' : '#f3f4f6', color: isDark ? '#00f0ff' : '#007AFF' },
                lineStyle: { color: isDark ? 'rgba(0,240,255,0.4)' : 'rgba(0,122,255,0.3)' },
                crossStyle: { color: isDark ? 'rgba(0,240,255,0.2)' : 'rgba(0,122,255,0.15)' },
              },
              confine: true,
              order: 'valueDesc',
              enterable: true,
              extraCssText: isDark ? 'max-height: 260px; overflow-y: auto; backdrop-filter: blur(6px);' : 'max-height: 260px; overflow-y: auto;',
              formatter: (params: any) => {
                if (!Array.isArray(params) || params.length === 0) return ''
                const t = new Date(params[0].axisValue)
                const timeLabel = `${(t.getMonth() + 1).toString().padStart(2, '0')}/${t.getDate().toString().padStart(2, '0')} ${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`
                let html = `<div style="font-weight:600;margin-bottom:6px;color:${tooltipTitle};font-size:12px;">${timeLabel}</div>`
                for (let i = 0; i < params.length; i++) {
                  const p = params[i]
                  html += `<div style="display:flex;align-items:center;gap:6px;margin:3px 0;white-space:nowrap;color:${tooltipText};font-size:11px;">`
                  html += `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color};${isDark ? `box-shadow:0 0 5px ${p.color};` : ''}"></span>`
                  html += `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;max-width:260px;">${p.seriesName}</span>`
                  html += `<span style="font-weight:600;margin-left:8px;color:${isDark ? '#fff' : '#111827'};">${p.value}</span>`
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
              const areaOpacity = (type === 'area' && fillOpacity === 0 ? 15 : fillOpacity) / 100
              const c = palette[idx % palette.length]

              return {
                name: s.name,
                type: effectiveType,
                data: s.data.map((v: number, i: number) => [chartData.timestamps[i], v]),
                smooth: lineInterpolation === 'smooth',
                symbol: symbol,
                symbolSize: symbol === 'circle' ? pointSize : undefined,
                lineStyle: isLine ? { width: lineWidth, shadowBlur: isDark ? 8 : 0, shadowColor: c } : undefined,
                itemStyle: { color: c },
                areaStyle: areaOpacity > 0 ? { opacity: areaOpacity, color: new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c }, { offset: 1, color: 'transparent' }]) } : undefined,
                emphasis: {
                  lineStyle: { width: isLine ? Math.max(lineWidth + 1, 2) : undefined, shadowBlur: isDark ? 12 : 0, shadowColor: c },
                },
              }
            }),
          }
          break
        }
        case 'heatmap': {
          const timestamps = chartData.timestamps || []
          const seriesNames = chartData.series?.map((s: any) => s.name) || []
          const data: [number, number, number][] = []
          let maxVal = 0
          chartData.series?.forEach((s: any, y: number) => {
            s.data.forEach((v: number, x: number) => {
              data.push([x, y, v])
              if (v > maxVal) maxVal = v
            })
          })
          option = {
            backgroundColor: 'transparent',
            tooltip: {
              position: 'top',
              backgroundColor: tooltipBg,
              borderColor: tooltipBorder,
              borderWidth: 1,
              textStyle: { color: tooltipText, fontSize: 12 },
              formatter: (p: any) => {
                const s = seriesNames[p.data[1]] || '-'
                const t = new Date(timestamps[p.data[0]]).toLocaleString()
                return `<div style="font-weight:600;">${s}</div><div>${t}</div><div>value: ${p.data[2]}</div>`
              },
            },
            grid: { top: 10, right: 16, bottom: 50, left: 90 },
            xAxis: {
              type: 'category',
              data: timestamps.map((t: number) => {
                const d = new Date(t)
                return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
              }),
              splitArea: { show: true },
              axisLabel: { color: labelColor, fontSize: 9, rotate: 45 },
            },
            yAxis: {
              type: 'category',
              data: seriesNames,
              splitArea: { show: true },
              axisLabel: { color: labelColor, fontSize: 9 },
            },
            visualMap: {
              min: 0,
              max: maxVal || 1,
              calculable: true,
              orient: 'horizontal',
              left: 'center',
              bottom: 0,
              itemWidth: 12,
              itemHeight: 80,
              textStyle: { color: labelColor, fontSize: 10 },
              inRange: {
                color: isDark ? ['#0b1120', '#00f0ff', '#ff00aa'] : ['#f0f9ff', '#007AFF', '#FF3B30'],
              },
            },
            series: [{
              name: title,
              type: 'heatmap',
              data,
              label: { show: false },
              emphasis: {
                itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' },
              },
            }],
          }
          break
        }
        case 'pie': {
          const pieCount = (chartData.data || []).length
          const showPieLabel = pieCount <= 10
          option = {
            backgroundColor: 'transparent',
            color: palette,
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
              label: { show: showPieLabel, formatter: '{b}: {c}', fontSize: 10, color: isDark ? '#94a3b8' : '#475569' },
              emphasis: {
                itemStyle: { shadowBlur: isDark ? 14 : 8, shadowOffsetX: 0, shadowColor: isDark ? 'rgba(0, 240, 255, 0.6)' : 'rgba(0,0,0,0.2)' },
              },
            }],
          }
          break
        }

      }

      chartInstance.current.setOption(option, { notMerge: true })
    } catch (e) {
      console.error('ECharts render error:', e)
    }
  }, [chartData, type, options, isDark, palette])

  const legendPlacement = options?.legendPlacement ?? 'bottom'
  const showCustomLegend = options?.legend !== false && legendPlacement !== 'hidden' && (type === 'line' || type === 'bar' || type === 'area' || type === 'scatter' || type === 'pie')

  const titleColor = isDark ? '#00f0ff' : theme.palette.primary.main
  const titleShadow = isDark ? '0 0 8px rgba(0,240,255,0.35)' : 'none'

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
        bgcolor: theme.palette.background.paper,
        border: '1px solid',
        borderColor: theme.palette.divider,
        boxShadow: isDark
          ? '0 0 0 1px rgba(0,0,0,0.3), 0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)'
          : '0 2px 12px rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.3s, border-color 0.3s',
        '&:hover': {
          borderColor: isDark ? 'rgba(59,130,246,0.25)' : theme.palette.primary.main + '40',
          boxShadow: isDark
            ? '0 0 0 1px rgba(0,0,0,0.3), 0 12px 40px rgba(0,0,0,0.45), 0 0 18px rgba(0,240,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)'
            : '0 4px 20px rgba(0,0,0,0.1)',
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
            color: titleColor,
            textShadow: titleShadow,
            letterSpacing: '0.02em',
          }}
        >
          {title}
        </Typography>
        {showMenu && (
          <>
            <IconButton size="small" className="grid-drag-cancel" onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{ color: 'text.secondary' }}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              PaperProps={{ sx: { bgcolor: theme.palette.background.paper, border: '1px solid', borderColor: theme.palette.divider } }}
            >
              {onEdit && <MenuItem onClick={() => { setMenuAnchor(null); onEdit() }} sx={{ fontSize: 13 }}>编辑</MenuItem>}
              {onDuplicate && <MenuItem onClick={() => { setMenuAnchor(null); onDuplicate() }} sx={{ fontSize: 13 }}>复制</MenuItem>}
              {onDelete && <MenuItem onClick={() => { setMenuAnchor(null); onDelete() }} sx={{ color: 'error.main', fontSize: 13 }}>删除</MenuItem>}
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
                  color: options?.thresholds ? options.thresholds[0]?.color : 'text.primary',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                  textShadow: isDark ? '0 0 14px rgba(0,240,255,0.25)' : 'none',
                }}
              >
                {statValue !== null ? statValue.toFixed(options?.decimals ?? 1) : '-'}
              </Typography>
              {options?.unit && (
                <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5 }}>{options.unit}</Typography>
              )}
            </Box>
          ) : type === 'table' ? (
            <Box sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
              <Box component="table" sx={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: 'text.primary' }}>
                <Box component="thead">
                  <Box component="tr">
                    {['Time', 'Metric', 'Value'].map((h) => (
                      <Box
                        component="th"
                        key={h}
                        sx={{
                          textAlign: 'left',
                          p: 0.75,
                          borderBottom: '1px solid',
                          borderColor: theme.palette.divider,
                          color: isDark ? '#00f0ff' : theme.palette.primary.main,
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >{h}</Box>
                    ))}
                  </Box>
                </Box>
                <Box component="tbody">
                  {tableData?.rows.map((row: any, idx: number) => (
                    <Box component="tr" key={idx} sx={{ '&:hover': { background: theme.palette.action.hover } }}>
                      <Box component="td" sx={{ p: 0.75, borderBottom: '1px solid', borderColor: theme.palette.divider, color: 'text.secondary', fontSize: 10 }}>{row.time}</Box>
                      <Box component="td" sx={{ p: 0.75, borderBottom: '1px solid', borderColor: theme.palette.divider, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 10 }}>{row.metric}</Box>
                      <Box component="td" sx={{ p: 0.75, borderBottom: '1px solid', borderColor: theme.palette.divider, fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: 10 }}>{row.value}</Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          ) : type === 'text' ? (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, overflow: 'auto' }}>
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'text.primary',
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                  width: '100%',
                  textAlign: 'center',
                }}
              >
                {chartData?.text || options?.textContent || query || '请输入文本内容'}
              </Typography>
            </Box>
          ) : type === 'gauge' ? (
            <Box sx={{ position: 'absolute', inset: 0 }}>
              <SciFiGauge
                value={Number.isFinite(chartData?.value) ? (chartData as any).value : 0}
                name={(chartData as any)?.name ?? ''}
                min={options?.min ?? 0}
                max={options?.max ?? 100}
                colors={options?.gaugeColors}
                isDark={isDark}
              />
              {options?.gaugeParticles !== false && (
                <GaugeCanvasParticles active={!(!chartData)} colors={options?.gaugeColors} isDark={isDark} />
              )}
            </Box>
          ) : (
            <Box sx={{ position: 'absolute', inset: 0 }}>
              <Box
                className="grid-drag-cancel"
                ref={chartRef}
                sx={{ position: 'absolute', inset: 0 }}
              />
            </Box>
          )}

          {(loading || error) && type !== 'stat' && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: theme.palette.mode === 'dark' ? 'rgba(8,12,22,0.7)' : 'rgba(255,255,255,0.85)' }}>
              {loading && <CircularProgress size={24} sx={{ color: isDark ? '#00f0ff' : theme.palette.primary.main }} />}
              {error && !loading && <Typography variant="caption" color="error">{error}</Typography>}
            </Box>
          )}
        </Box>

        {showCustomLegend && chartData?.series && legendPlacement === 'bottom' && (
          <CustomLegend series={chartData.series} placement="bottom" isDark={isDark} />
        )}
        {showCustomLegend && chartData?.series && legendPlacement === 'right' && (
          <CustomLegend series={chartData.series} placement="right" isDark={isDark} />
        )}
        {showCustomLegend && chartData?.series && legendPlacement === 'left' && (
          <CustomLegend series={chartData.series} placement="left" isDark={isDark} />
        )}
      </Box>
    </Paper>
  )
}
