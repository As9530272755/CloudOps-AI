import { Box, Typography, TextField, Button, IconButton, Divider, Paper } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, RuntimeClassFormData } from './index'

const defaultData: RuntimeClassFormData = {
  name: '',
  namespace: 'default',
  handler: 'runsc',
  overhead: { cpu: '', memory: '' },
  scheduling: [],
}

export { defaultData as runtimeClassDefaultData }

export function RuntimeClassForm({ data, onChange, namespaceReadOnly }: FormComponentProps<RuntimeClassFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<RuntimeClassFormData>) => {
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

      {/* Handler */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          Handler
        </Typography>
        <TextField
          label="Handler"
          size="small"
          value={d.handler}
          onChange={(e) => update({ handler: e.target.value })}
          placeholder="例如: runsc 或 kata"
          helperText="底层容器运行时的名称"
          fullWidth
        />
      </Box>

      <Divider />

      {/* Overhead */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          Overhead (Pod 固定开销)
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="CPU"
            size="small"
            value={d.overhead.cpu}
            onChange={(e) => update({ overhead: { ...d.overhead, cpu: e.target.value } })}
            placeholder="例如: 100m"
            sx={{ minWidth: 180, flex: 1 }}
          />
          <TextField
            label="Memory"
            size="small"
            value={d.overhead.memory}
            onChange={(e) => update({ overhead: { ...d.overhead, memory: e.target.value } })}
            placeholder="例如: 128Mi"
            sx={{ minWidth: 180, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* Node Selector */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            节点选择器 (Scheduling)
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => update({ scheduling: [...d.scheduling, { key: '', value: '' }] })}
          >
            添加标签
          </Button>
        </Box>
        {d.scheduling.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无节点选择器
          </Typography>
        )}
        {d.scheduling.map((item, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="标签键"
              size="small"
              value={item.key}
              onChange={(e) => {
                const scheduling = [...d.scheduling]
                scheduling[idx] = { ...item, key: e.target.value }
                update({ scheduling })
              }}
              sx={{ minWidth: 180, flex: 1 }}
            />
            <TextField
              label="标签值"
              size="small"
              value={item.value}
              onChange={(e) => {
                const scheduling = [...d.scheduling]
                scheduling[idx] = { ...item, value: e.target.value }
                update({ scheduling })
              }}
              sx={{ minWidth: 180, flex: 1 }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const scheduling = d.scheduling.filter((_, i) => i !== idx)
                update({ scheduling })
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
