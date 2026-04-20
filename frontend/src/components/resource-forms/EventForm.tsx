import { Box, Typography, TextField, Divider, MenuItem } from '@mui/material'
import { FormComponentProps, EventFormData } from './index'

const defaultData: EventFormData = {
  name: '',
  namespace: 'default',
  reason: '',
  message: '',
  type: 'Normal',
  involvedObject: { kind: 'Pod', name: '' },
}

export { defaultData as eventDefaultData }

export function EventForm({ data, onChange, namespaceReadOnly }: FormComponentProps<EventFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<EventFormData>) => {
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

      {/* 事件详情 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          事件详情
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <TextField
            label="原因 (Reason)"
            size="small"
            value={d.reason}
            onChange={(e) => update({ reason: e.target.value })}
            sx={{ minWidth: 200, flex: 1 }}
          />
          <TextField
            select
            label="类型 (Type)"
            size="small"
            value={d.type}
            onChange={(e) => update({ type: e.target.value as 'Normal' | 'Warning' })}
            sx={{ minWidth: 160, flex: 1 }}
          >
            <MenuItem value="Normal">Normal</MenuItem>
            <MenuItem value="Warning">Warning</MenuItem>
          </TextField>
        </Box>
        <TextField
          label="消息 (Message)"
          size="small"
          multiline
          rows={2}
          value={d.message}
          onChange={(e) => update({ message: e.target.value })}
          fullWidth
          sx={{ mb: 2 }}
        />
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="关联对象类型 (Kind)"
            size="small"
            value={d.involvedObject.kind}
            onChange={(e) => update({ involvedObject: { ...d.involvedObject, kind: e.target.value } })}
            sx={{ minWidth: 180, flex: 1 }}
          />
          <TextField
            label="关联对象名称 (Name)"
            size="small"
            value={d.involvedObject.name}
            onChange={(e) => update({ involvedObject: { ...d.involvedObject, name: e.target.value } })}
            sx={{ minWidth: 180, flex: 1 }}
          />
        </Box>
      </Box>
    </Box>
  )
}
