import { Box, Typography, TextField, Button, IconButton, Divider, Paper } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, CSINodeFormData } from './index'

const defaultData: CSINodeFormData = {
  name: '',
  namespace: 'default',
  drivers: [],
}

export { defaultData as csiNodeDefaultData }

export function CSINodeForm({ data, onChange, namespaceReadOnly }: FormComponentProps<CSINodeFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<CSINodeFormData>) => {
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

      {/* CSI 驱动列表 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            CSI 驱动列表
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                drivers: [...d.drivers, { name: '', nodeID: '', topologyKeys: '' }],
              })
            }
          >
            添加驱动
          </Button>
        </Box>
        {d.drivers.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无驱动，点击上方按钮添加
          </Typography>
        )}
        {d.drivers.map((driver, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                驱动 #{idx + 1}
              </Typography>
              <IconButton
                size="small"
                color="error"
                onClick={() => {
                  const drivers = d.drivers.filter((_, i) => i !== idx)
                  update({ drivers })
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <TextField
                label="驱动名称"
                size="small"
                value={driver.name}
                onChange={(e) => {
                  const drivers = [...d.drivers]
                  drivers[idx] = { ...driver, name: e.target.value }
                  update({ drivers })
                }}
                placeholder="例如: csi-driver.example.com"
                sx={{ minWidth: 220, flex: 1 }}
              />
              <TextField
                label="Node ID"
                size="small"
                value={driver.nodeID}
                onChange={(e) => {
                  const drivers = [...d.drivers]
                  drivers[idx] = { ...driver, nodeID: e.target.value }
                  update({ drivers })
                }}
                placeholder="节点在 CSI 驱动中的 ID"
                sx={{ minWidth: 200, flex: 1 }}
              />
            </Box>
            <TextField
              label="Topology Keys (逗号分隔)"
              size="small"
              value={driver.topologyKeys}
              onChange={(e) => {
                const drivers = [...d.drivers]
                drivers[idx] = { ...driver, topologyKeys: e.target.value }
                update({ drivers })
              }}
              placeholder="例如: topology.kubernetes.io/zone, topology.kubernetes.io/region"
              fullWidth
            />
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
