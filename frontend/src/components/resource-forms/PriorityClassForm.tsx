import { Box, Typography, TextField, Divider, FormControlLabel, Switch } from '@mui/material'
import { FormComponentProps, PriorityClassFormData } from './index'

const defaultData: PriorityClassFormData = {
  name: '',
  namespace: 'default',
  value: 1000,
  globalDefault: false,
  description: '',
}

export { defaultData as priorityClassDefaultData }

export function PriorityClassForm({ data, onChange }: FormComponentProps<PriorityClassFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<PriorityClassFormData>) => {
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
            label="优先级数值"
            size="small"
            type="number"
            value={d.value}
            onChange={(e) => update({ value: Number(e.target.value) })}
            sx={{ minWidth: 160, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 选项 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          选项
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={d.globalDefault}
              onChange={(e) => update({ globalDefault: e.target.checked })}
            />
          }
          label="设为全局默认 (globalDefault)"
        />
      </Box>

      <Divider />

      {/* 描述 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          描述
        </Typography>
        <TextField
          size="small"
          multiline
          rows={3}
          value={d.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="PriorityClass 描述信息"
          fullWidth
        />
      </Box>
    </Box>
  )
}
