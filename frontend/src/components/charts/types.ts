export type ChartType = 'line' | 'bar' | 'pie' | 'gauge' | 'stat' | 'table' | 'area' | 'heatmap' | 'scatter' | 'text'

export interface DashboardVariable {
  name: string
  label: string
  type: 'query' | 'custom' | 'text'
  query?: string
  labelName?: string
  dataSourceId?: number
  options?: string[]
  multi?: boolean
  includeAll?: boolean
  defaultValue?: string
}

export interface PanelPosition {
  x: number
  y: number
  w: number
  h: number
}

// Grafana-style field config defaults (from Grafana source: GraphFieldConfig)
export interface PanelOptions {
  unit?: string
  legend?: boolean
  legendPlacement?: 'right' | 'left' | 'bottom' | 'hidden'
  thresholds?: Array<{ value: number; color: string }>
  colors?: string[]
  min?: number
  max?: number
  decimals?: number

  textContent?: string

  // Grafana-style line/bar/points config
  drawStyle?: 'line' | 'bar' | 'points'
  lineInterpolation?: 'linear' | 'smooth'
  lineWidth?: number
  lineStyle?: 'solid' | 'dash' | 'dot'
  fillOpacity?: number // 0-100, Grafana default = 0
  showPoints?: 'auto' | 'always' | 'never'
  pointSize?: number
  barAlignment?: 'before' | 'center' | 'after'
  barWidthFactor?: number
}

export interface PanelData {
  time?: string[]
  series: Array<{
    name: string
    data: number[]
  }>
}

export interface ChartPanelProps {
  title: string
  type: ChartType
  query: string
  dataSourceId: number
  options?: PanelOptions
  isEditing?: boolean
  onEdit?: () => void
  onDelete?: () => void
}
