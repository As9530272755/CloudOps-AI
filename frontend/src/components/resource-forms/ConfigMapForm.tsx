import { Box, Typography, TextField, Button, IconButton, Divider, Paper } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, ConfigMapFormData } from './index'

const defaultData: ConfigMapFormData = {
  name: '',
  namespace: 'default',
  data: [{ key: '', value: '' }],
}

export { defaultData as configMapDefaultData }

export function ConfigMapForm({ data, onChange, namespaceReadOnly }: FormComponentProps<ConfigMapFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<ConfigMapFormData>) => {
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

      {/* 配置数据 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            配置数据
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => update({ data: [...d.data, { key: '', value: '' }] })}
          >
            添加键值对
          </Button>
        </Box>
        {d.data.map((item, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="键（Key）"
              size="small"
              value={item.key}
              onChange={(e) => {
                const newData = [...d.data]
                newData[idx] = { ...item, key: e.target.value }
                update({ data: newData })
              }}
              sx={{ minWidth: 180, flex: 1 }}
            />
            <TextField
              label="值（Value）"
              size="small"
              value={item.value}
              onChange={(e) => {
                const newData = [...d.data]
                newData[idx] = { ...item, value: e.target.value }
                update({ data: newData })
              }}
              multiline
              maxRows={6}
              sx={{ minWidth: 240, flex: 2 }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const newData = d.data.filter((_, i) => i !== idx)
                update({ data: newData.length ? newData : [{ key: '', value: '' }] })
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
