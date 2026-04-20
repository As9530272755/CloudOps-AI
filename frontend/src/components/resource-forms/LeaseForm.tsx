import { Box, Typography, TextField, Divider } from '@mui/material'
import { FormComponentProps, LeaseFormData } from './index'

const defaultData: LeaseFormData = {
  name: '',
  namespace: 'kube-system',
  holderIdentity: '',
  leaseDurationSeconds: 15,
}

export { defaultData as leaseDefaultData }

export function LeaseForm({ data, onChange, namespaceReadOnly }: FormComponentProps<LeaseFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<LeaseFormData>) => {
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

      {/* 租约设置 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          租约设置
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="Holder Identity"
            size="small"
            value={d.holderIdentity}
            onChange={(e) => update({ holderIdentity: e.target.value })}
            placeholder="例如: node-1"
            sx={{ minWidth: 240, flex: 1 }}
          />
          <TextField
            label="租约时长 (秒)"
            size="small"
            type="number"
            value={d.leaseDurationSeconds}
            onChange={(e) => update({ leaseDurationSeconds: Math.max(1, Number(e.target.value)) })}
            inputProps={{ min: 1 }}
            sx={{ minWidth: 160, flex: 1 }}
          />
        </Box>
      </Box>
    </Box>
  )
}
