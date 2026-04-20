import { Box, Typography, TextField, Chip, Divider } from '@mui/material'
import { FormComponentProps, NetworkPolicyFormData } from './index'

const defaultData: NetworkPolicyFormData = {
  name: '',
  namespace: 'default',
  podSelector: { key: 'app', value: '' },
  policyTypes: ['Ingress'],
}

export { defaultData as networkPolicyDefaultData }

export function NetworkPolicyForm({ data, onChange, namespaceReadOnly }: FormComponentProps<NetworkPolicyFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<NetworkPolicyFormData>) => {
    onChange({ ...d, ...patch })
  }

  const togglePolicyType = (type: string) => {
    const types = d.policyTypes.includes(type)
      ? d.policyTypes.filter((t) => t !== type)
      : [...d.policyTypes, type]
    update({ policyTypes: types.length ? types : ['Ingress'] })
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

      {/* Pod 选择器 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          Pod 选择器
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="标签键"
            size="small"
            value={d.podSelector.key}
            onChange={(e) => update({ podSelector: { ...d.podSelector, key: e.target.value } })}
            placeholder="例如: app"
            sx={{ minWidth: 180, flex: 1 }}
          />
          <TextField
            label="标签值"
            size="small"
            value={d.podSelector.value}
            onChange={(e) => update({ podSelector: { ...d.podSelector, value: e.target.value } })}
            placeholder="例如: my-app"
            sx={{ minWidth: 180, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 策略类型 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          策略类型
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {['Ingress', 'Egress'].map((type) => (
            <Chip
              key={type}
              label={type}
              color={d.policyTypes.includes(type) ? 'primary' : 'default'}
              onClick={() => togglePolicyType(type)}
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  )
}
