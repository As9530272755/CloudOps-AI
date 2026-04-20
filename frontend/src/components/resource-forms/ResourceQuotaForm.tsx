import { Box, Typography, TextField, Button, IconButton, Divider, Paper } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, ResourceQuotaFormData } from './index'

const defaultData: ResourceQuotaFormData = {
  name: '',
  namespace: 'default',
  hard: [
    { key: 'requests.cpu', value: '' },
    { key: 'requests.memory', value: '' },
    { key: 'limits.cpu', value: '' },
    { key: 'limits.memory', value: '' },
  ],
}

export { defaultData as resourceQuotaDefaultData }

export function ResourceQuotaForm({ data, onChange, namespaceReadOnly }: FormComponentProps<ResourceQuotaFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<ResourceQuotaFormData>) => {
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
        </Box>
      </Box>

      <Divider />

      {/* 资源硬限制 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            资源硬限制 (Hard)
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => update({ hard: [...d.hard, { key: '', value: '' }] })}
          >
            添加限制
          </Button>
        </Box>
        {d.hard.map((item, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="资源名称"
              size="small"
              value={item.key}
              onChange={(e) => {
                const newHard = [...d.hard]
                newHard[idx] = { ...item, key: e.target.value }
                update({ hard: newHard })
              }}
              placeholder="例如: pods, services"
              sx={{ minWidth: 180, flex: 1 }}
            />
            <TextField
              label="限制值"
              size="small"
              value={item.value}
              onChange={(e) => {
                const newHard = [...d.hard]
                newHard[idx] = { ...item, value: e.target.value }
                update({ hard: newHard })
              }}
              placeholder="例如: 10, 20Gi"
              sx={{ minWidth: 180, flex: 1 }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const newHard = d.hard.filter((_, i) => i !== idx)
                update({ hard: newHard.length ? newHard : [{ key: '', value: '' }] })
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
