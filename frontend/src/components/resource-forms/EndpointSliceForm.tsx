import { Box, Typography, TextField, Button, IconButton, Divider, Paper, MenuItem, Chip } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, EndpointSliceFormData } from './index'

const defaultData: EndpointSliceFormData = {
  name: '',
  namespace: 'default',
  addressType: 'IPv4',
  endpoints: [],
  ports: [],
}

export { defaultData as endpointSliceDefaultData }

export function EndpointSliceForm({ data, onChange, namespaceReadOnly }: FormComponentProps<EndpointSliceFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<EndpointSliceFormData>) => {
    onChange({ ...d, ...patch })
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* 基本信息 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          基本信息
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="名称"
            size="small"
            value={d.name}
            onChange={(e) => update({ name: e.target.value })}
            sx={{ minWidth: 240, flex: 1 }}
          />
          <TextField
            label="命名空间"
            size="small"
            value={d.namespace}
            disabled={namespaceReadOnly}
            onChange={(e) => update({ namespace: e.target.value })}
            sx={{ minWidth: 200, flex: 1 }}
          />
          <TextField
            select
            label="地址类型"
            size="small"
            value={d.addressType}
            onChange={(e) => update({ addressType: e.target.value as any })}
            sx={{ minWidth: 140, flex: 1 }}
          >
            <MenuItem value="IPv4">IPv4</MenuItem>
            <MenuItem value="IPv6">IPv6</MenuItem>
            <MenuItem value="FQDN">FQDN</MenuItem>
          </TextField>
        </Box>
      </Box>

      <Divider />

      {/* Endpoints */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            Endpoints
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                endpoints: [...d.endpoints, { addresses: '', conditionsReady: true }],
              })
            }
          >
            添加 Endpoint
          </Button>
        </Box>
        {d.endpoints.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无 Endpoints，点击上方按钮添加
          </Typography>
        )}
        {d.endpoints.map((ep, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="地址"
              size="small"
              value={ep.addresses}
              onChange={(e) => {
                const eps = [...d.endpoints]
                eps[idx] = { ...ep, addresses: e.target.value }
                update({ endpoints: eps })
              }}
              placeholder="多个地址用逗号分隔"
              sx={{ minWidth: 200, flex: 2 }}
            />
            <Chip
              label={ep.conditionsReady ? 'Ready' : 'Not Ready'}
              size="small"
              color={ep.conditionsReady ? 'success' : 'default'}
              onClick={() => {
                const eps = [...d.endpoints]
                eps[idx] = { ...ep, conditionsReady: !ep.conditionsReady }
                update({ endpoints: eps })
              }}
              sx={{ cursor: 'pointer' }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const eps = d.endpoints.filter((_, i) => i !== idx)
                update({ endpoints: eps })
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Paper>
        ))}
      </Box>

      <Divider />

      {/* 端口 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            端口
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                ports: [...d.ports, { name: '', port: 80, protocol: 'TCP' }],
              })
            }
          >
            添加端口
          </Button>
        </Box>
        {d.ports.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无端口，点击上方按钮添加
          </Typography>
        )}
        {d.ports.map((port, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="端口名称"
              size="small"
              value={port.name}
              onChange={(e) => {
                const ports = [...d.ports]
                ports[idx] = { ...port, name: e.target.value }
                update({ ports })
              }}
              sx={{ minWidth: 120, flex: 1 }}
            />
            <TextField
              label="端口"
              size="small"
              type="number"
              value={port.port}
              onChange={(e) => {
                const ports = [...d.ports]
                ports[idx] = { ...port, port: Number(e.target.value) }
                update({ ports })
              }}
              sx={{ minWidth: 100, flex: 1 }}
            />
            <Chip
              label={port.protocol}
              size="small"
              onClick={() => {
                const ports = [...d.ports]
                ports[idx] = { ...port, protocol: port.protocol === 'TCP' ? 'UDP' : 'TCP' }
                update({ ports })
              }}
              sx={{ cursor: 'pointer' }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const ports = d.ports.filter((_, i) => i !== idx)
                update({ ports })
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
