import { Box, Typography, TextField, Divider } from '@mui/material'
import { FormComponentProps, PodDisruptionBudgetFormData } from './index'

const defaultData: PodDisruptionBudgetFormData = {
  name: '',
  namespace: 'default',
  minAvailable: '1',
  maxUnavailable: '',
  selector: { key: 'app', value: '' },
}

export { defaultData as podDisruptionBudgetDefaultData }

export function PodDisruptionBudgetForm({ data, onChange, namespaceReadOnly }: FormComponentProps<PodDisruptionBudgetFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<PodDisruptionBudgetFormData>) => {
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

      {/* 中断预算 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          中断预算
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="最小可用"
            size="small"
            value={d.minAvailable}
            onChange={(e) => update({ minAvailable: e.target.value })}
            placeholder="例如: 1 或 50%"
            helperText="可接受的 Pod 数量或百分比"
            sx={{ minWidth: 180, flex: 1 }}
          />
          <TextField
            label="最大不可用"
            size="small"
            value={d.maxUnavailable}
            onChange={(e) => update({ maxUnavailable: e.target.value })}
            placeholder="例如: 1 或 50%"
            helperText="可选，与最小可用互斥"
            sx={{ minWidth: 180, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 选择器 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          选择器
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="标签键"
            size="small"
            value={d.selector.key}
            onChange={(e) => update({ selector: { ...d.selector, key: e.target.value } })}
            sx={{ minWidth: 180, flex: 1 }}
          />
          <TextField
            label="标签值"
            size="small"
            value={d.selector.value}
            onChange={(e) => update({ selector: { ...d.selector, value: e.target.value } })}
            sx={{ minWidth: 180, flex: 1 }}
          />
        </Box>
      </Box>
    </Box>
  )
}
