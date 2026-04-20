import { Box, Typography, TextField, Divider } from '@mui/material'
import { FormComponentProps, ServiceAccountFormData } from './index'

const defaultData: ServiceAccountFormData = {
  name: '',
  namespace: 'default',
}

export { defaultData as serviceAccountDefaultData }

export function ServiceAccountForm({ data, onChange, namespaceReadOnly }: FormComponentProps<ServiceAccountFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<ServiceAccountFormData>) => {
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

      <Box>
        <Typography variant="body2" color="text.secondary">
          ServiceAccount 用于为 Pod 提供身份标识，创建后可在 Pod 的 spec.serviceAccountName 中引用。
        </Typography>
      </Box>
    </Box>
  )
}
