import { Box, Typography, TextField, Divider, Chip, FormControlLabel, Switch } from '@mui/material'
import { FormComponentProps, CSIDriverFormData } from './index'

const defaultData: CSIDriverFormData = {
  name: '',
  namespace: 'default',
  attachRequired: true,
  podInfoOnMount: false,
  volumeLifecycleModes: ['Persistent'],
}

export { defaultData as csiDriverDefaultData }

export function CSIDriverForm({ data, onChange, namespaceReadOnly }: FormComponentProps<CSIDriverFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<CSIDriverFormData>) => {
    onChange({ ...d, ...patch })
  }

  const lifecycleModes = ['Persistent', 'Ephemeral']

  const toggleMode = (mode: string) => {
    const modes = d.volumeLifecycleModes.includes(mode)
      ? d.volumeLifecycleModes.filter((m) => m !== mode)
      : [...d.volumeLifecycleModes, mode]
    update({ volumeLifecycleModes: modes.length ? modes : ['Persistent'] })
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

      {/* 选项 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          选项
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Switch
                checked={d.attachRequired}
                onChange={(e) => update({ attachRequired: e.target.checked })}
              />
            }
            label="需要 attach (attachRequired)"
          />
          <FormControlLabel
            control={
              <Switch
                checked={d.podInfoOnMount}
                onChange={(e) => update({ podInfoOnMount: e.target.checked })}
              />
            }
            label="挂载时传递 Pod 信息 (podInfoOnMount)"
          />
        </Box>
      </Box>

      <Divider />

      {/* 卷生命周期模式 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          卷生命周期模式
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {lifecycleModes.map((mode) => (
            <Chip
              key={mode}
              label={mode}
              color={d.volumeLifecycleModes.includes(mode) ? 'primary' : 'default'}
              onClick={() => toggleMode(mode)}
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  )
}
