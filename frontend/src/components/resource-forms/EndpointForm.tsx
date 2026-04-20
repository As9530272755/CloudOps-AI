import { Box, Typography, TextField, Button, IconButton, Divider, Paper, Chip } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, EndpointFormData } from './index'

const defaultData: EndpointFormData = {
  name: '',
  namespace: 'default',
  subsets: [],
}

export { defaultData as endpointDefaultData }

export function EndpointForm({ data, onChange, namespaceReadOnly }: FormComponentProps<EndpointFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<EndpointFormData>) => {
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
            helperText="只能包含小写字母、数字和连字符(-)"
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
        </Box>
      </Box>

      <Divider />

      {/* Subsets */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            Subsets
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                subsets: [...d.subsets, { addresses: '', ports: [] }],
              })
            }
          >
            添加 Subset
          </Button>
        </Box>
        {d.subsets.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无 Subset，点击上方按钮添加
          </Typography>
        )}
        {d.subsets.map((subset, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                Subset #{idx + 1}
              </Typography>
              <IconButton
                size="small"
                color="error"
                onClick={() => {
                  const subsets = d.subsets.filter((_, i) => i !== idx)
                  update({ subsets })
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
            <TextField
              label="Addresses（逗号分隔）"
              size="small"
              value={subset.addresses}
              onChange={(e) => {
                const subsets = [...d.subsets]
                subsets[idx] = { ...subset, addresses: e.target.value }
                update({ subsets })
              }}
              placeholder="例如: 10.0.0.1, 10.0.0.2"
              fullWidth
              sx={{ mb: 2 }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                端口
              </Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => {
                  const subsets = [...d.subsets]
                  subsets[idx] = { ...subset, ports: [...subset.ports, { name: '', port: 80, protocol: 'TCP' }] }
                  update({ subsets })
                }}
              >
                添加端口
              </Button>
            </Box>
            {subset.ports.map((port, pidx) => (
              <Paper key={pidx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  label="端口名称"
                  size="small"
                  value={port.name}
                  onChange={(e) => {
                    const subsets = [...d.subsets]
                    const ports = [...subset.ports]
                    ports[pidx] = { ...port, name: e.target.value }
                    subsets[idx] = { ...subset, ports }
                    update({ subsets })
                  }}
                  placeholder="可选"
                  sx={{ minWidth: 100, flex: 1 }}
                />
                <TextField
                  label="端口"
                  size="small"
                  type="number"
                  value={port.port}
                  onChange={(e) => {
                    const subsets = [...d.subsets]
                    const ports = [...subset.ports]
                    ports[pidx] = { ...port, port: Number(e.target.value) }
                    subsets[idx] = { ...subset, ports }
                    update({ subsets })
                  }}
                  sx={{ minWidth: 80, flex: 1 }}
                />
                <Chip
                  label={port.protocol}
                  size="small"
                  onClick={() => {
                    const subsets = [...d.subsets]
                    const ports = [...subset.ports]
                    ports[pidx] = { ...port, protocol: port.protocol === 'TCP' ? 'UDP' : 'TCP' }
                    subsets[idx] = { ...subset, ports }
                    update({ subsets })
                  }}
                  sx={{ cursor: 'pointer' }}
                />
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => {
                    const subsets = [...d.subsets]
                    const ports = subset.ports.filter((_, i) => i !== pidx)
                    subsets[idx] = { ...subset, ports }
                    update({ subsets })
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
