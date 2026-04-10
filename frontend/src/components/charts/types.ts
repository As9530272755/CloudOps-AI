export type ChartType = 'line' | 'bar' | 'pie' | 'gauge' | 'stat' | 'table'

export interface PanelPosition {
  x: number
  y: number
  w: number
  h: number
}

export interface PanelOptions {
  unit?: string
  legend?: boolean
  thresholds?: Array<{ value: number; color: string }>
  colors?: string[]
  min?: number
  max?: number
  decimals?: number
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
