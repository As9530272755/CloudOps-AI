import { Box, Typography, TextField, Divider } from '@mui/material'
import { FormComponentProps, HorizontalPodAutoscalerFormData } from './index'

const defaultData: HorizontalPodAutoscalerFormData = {
  name: '',
  namespace: 'default',
  scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: '' },
  minReplicas: 1,
  maxReplicas: 10,
  targetCPUUtilizationPercentage: 50,
}

export { defaultData as horizontalPodAutoscalerDefaultData }

export function HorizontalPodAutoscalerForm({ data, onChange, namespaceReadOnly }: FormComponentProps<HorizontalPodAutoscalerFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<HorizontalPodAutoscalerFormData>) => {
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

      {/* 伸缩目标 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          伸缩目标
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="API Version"
            size="small"
            value={d.scaleTargetRef.apiVersion}
            onChange={(e) => update({ scaleTargetRef: { ...d.scaleTargetRef, apiVersion: e.target.value } })}
            sx={{ minWidth: 160, flex: 1 }}
          />
          <TextField
            label="Kind"
            size="small"
            value={d.scaleTargetRef.kind}
            onChange={(e) => update({ scaleTargetRef: { ...d.scaleTargetRef, kind: e.target.value } })}
            sx={{ minWidth: 160, flex: 1 }}
          />
          <TextField
            label="名称"
            size="small"
            value={d.scaleTargetRef.name}
            onChange={(e) => update({ scaleTargetRef: { ...d.scaleTargetRef, name: e.target.value } })}
            sx={{ minWidth: 200, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 伸缩策略 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          伸缩策略
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="最小副本数"
            size="small"
            type="number"
            value={d.minReplicas}
            onChange={(e) => update({ minReplicas: Math.max(0, Number(e.target.value)) })}
            inputProps={{ min: 0 }}
            sx={{ minWidth: 120, flex: 1 }}
          />
          <TextField
            label="最大副本数"
            size="small"
            type="number"
            value={d.maxReplicas}
            onChange={(e) => update({ maxReplicas: Math.max(1, Number(e.target.value)) })}
            inputProps={{ min: 1 }}
            sx={{ minWidth: 120, flex: 1 }}
          />
          <TextField
            label="目标 CPU 利用率 (%)"
            size="small"
            type="number"
            value={d.targetCPUUtilizationPercentage}
            onChange={(e) => update({ targetCPUUtilizationPercentage: Math.max(1, Number(e.target.value)) })}
            inputProps={{ min: 1 }}
            sx={{ minWidth: 160, flex: 1 }}
          />
        </Box>
      </Box>
    </Box>
  )
}
