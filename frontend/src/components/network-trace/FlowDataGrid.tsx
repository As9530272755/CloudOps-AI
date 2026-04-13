import { Box, Chip } from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'
import { FlowItem } from '../../lib/network-trace-api'

interface FlowDataGridProps {
  rows: FlowItem[]
  onDetailClick?: (row: FlowItem) => void
}

const PROTOCOL_COLORS: Record<string, { bg: string; color: string }> = {
  HTTP: { bg: '#e3f2fd', color: '#1976d2' },
  gRPC: { bg: '#e8f5e9', color: '#388e3c' },
  TCP: { bg: '#eceff1', color: '#546e7a' },
  UDP: { bg: '#fff3e0', color: '#ef6c00' },
  MySQL: { bg: '#f3e5f5', color: '#7b1fa2' },
  Redis: { bg: '#fce4ec', color: '#c2185b' },
}

function ProtocolBadge({ protocol }: { protocol: string }) {
  const style = PROTOCOL_COLORS[protocol] || { bg: '#f5f5f5', color: '#616161' }
  return (
    <Chip
      label={protocol}
      size="small"
      sx={{
        bgcolor: style.bg,
        color: style.color,
        fontWeight: 600,
        fontSize: '0.75rem',
        height: 22,
      }}
    />
  )
}

export default function FlowDataGrid({ rows, onDetailClick }: FlowDataGridProps) {
  const columns: GridColDef[] = [
    {
      field: 'sourcePod',
      headerName: '来源 Pod',
      width: 180,
      renderCell: (params) => (
        <Box sx={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#00c853' }} />
          {params.value}
        </Box>
      ),
    },
    {
      field: 'protocol',
      headerName: '协议',
      width: 90,
      renderCell: (params) => <ProtocolBadge protocol={params.value} />,
    },
    { field: 'port', headerName: '端口', width: 80, type: 'number' },
    {
      field: 'requests',
      headerName: '包数',
      width: 100,
      type: 'number',
      valueFormatter: (params) => Number(params.value).toLocaleString(),
    },
    {
      field: 'bytes',
      headerName: '流量',
      width: 100,
      valueFormatter: (params) => formatBytes(Number(params.value)),
    },
    {
      field: 'lastActive',
      headerName: '最后活跃',
      width: 120,
    },
    {
      field: 'actions',
      headerName: '操作',
      width: 90,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Box
          component="button"
          onClick={() => onDetailClick?.(params.row as FlowItem)}
          sx={{
            px: 1.5,
            py: 0.5,
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'primary.main',
            bgcolor: 'transparent',
            border: '1px solid',
            borderColor: 'primary.main',
            borderRadius: 1,
            cursor: 'pointer',
            '&:hover': { bgcolor: 'primary.50' },
          }}
        >
          详情
        </Box>
      ),
    },
  ]

  return (
    <DataGrid
      rows={rows.map((r, i) => ({ ...r, id: i }))}
      columns={columns}
      pageSizeOptions={[10, 25, 50]}
      initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
      disableRowSelectionOnClick

      sx={{
        border: 'none',
        '& .MuiDataGrid-cell:focus': { outline: 'none' },
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
