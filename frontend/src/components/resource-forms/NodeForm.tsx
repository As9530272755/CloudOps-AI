import { Box, Typography, TextField, Button, IconButton, Divider, Paper } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, NodeFormData } from './index'

const defaultData: NodeFormData = {
  name: '',
  namespace: 'default',
  labels: [],
}

export { defaultData as nodeDefaultData }

export function NodeForm({ data, onChange, namespaceReadOnly }: FormComponentProps<NodeFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<NodeFormData>) => {
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
            helperText="Node 名称"
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

      {/* 标签 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            标签 (Labels)
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => update({ labels: [...d.labels, { key: '', value: '' }] })}
          >
            添加标签
          </Button>
        </Box>
        {d.labels.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无标签
          </Typography>
        )}
        {d.labels.map((label, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1.5, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="键"
              size="small"
              value={label.key}
              onChange={(e) => {
                const labels = [...d.labels]
                labels[idx] = { ...label, key: e.target.value }
                update({ labels })
              }}
              sx={{ minWidth: 160, flex: 1 }}
            />
            <TextField
              label="值"
              size="small"
              value={label.value}
              onChange={(e) => {
                const labels = [...d.labels]
                labels[idx] = { ...label, value: e.target.value }
                update({ labels })
              }}
              sx={{ minWidth: 160, flex: 1 }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const labels = d.labels.filter((_, i) => i !== idx)
                update({ labels })
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
