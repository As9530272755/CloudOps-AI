import { Box, Typography, TextField, Divider, MenuItem } from '@mui/material'
import { FormComponentProps, CustomResourceDefinitionFormData } from './index'

const defaultData: CustomResourceDefinitionFormData = {
  name: '',
  namespace: 'default',
  group: '',
  versions: ['v1'],
  scope: 'Namespaced',
  names: { kind: '', plural: '', singular: '', shortNames: [] },
}

export { defaultData as customResourceDefinitionDefaultData }

export function CustomResourceDefinitionForm({ data, onChange, namespaceReadOnly }: FormComponentProps<CustomResourceDefinitionFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<CustomResourceDefinitionFormData>) => {
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

      {/* CRD 配置 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          CRD 配置
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <TextField
            label="Group"
            size="small"
            value={d.group}
            onChange={(e) => update({ group: e.target.value })}
            placeholder="例如: example.com"
            sx={{ minWidth: 240, flex: 1 }}
          />
          <TextField
            select
            label="作用域 (Scope)"
            size="small"
            value={d.scope}
            onChange={(e) => update({ scope: e.target.value as 'Namespaced' | 'Cluster' })}
            sx={{ minWidth: 200, flex: 1 }}
          >
            <MenuItem value="Namespaced">Namespaced</MenuItem>
            <MenuItem value="Cluster">Cluster</MenuItem>
          </TextField>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <TextField
            label="版本（逗号分隔）"
            size="small"
            value={d.versions.join(', ')}
            onChange={(e) => update({ versions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            placeholder="例如: v1, v1alpha1"
            sx={{ minWidth: 240, flex: 1 }}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <TextField
            label="Kind"
            size="small"
            value={d.names.kind}
            onChange={(e) => update({ names: { ...d.names, kind: e.target.value } })}
            sx={{ minWidth: 180, flex: 1 }}
          />
          <TextField
            label="Plural"
            size="small"
            value={d.names.plural}
            onChange={(e) => update({ names: { ...d.names, plural: e.target.value } })}
            sx={{ minWidth: 180, flex: 1 }}
          />
          <TextField
            label="Singular"
            size="small"
            value={d.names.singular}
            onChange={(e) => update({ names: { ...d.names, singular: e.target.value } })}
            sx={{ minWidth: 180, flex: 1 }}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="短名（逗号分隔）"
            size="small"
            value={d.names.shortNames.join(', ')}
            onChange={(e) => update({ names: { ...d.names, shortNames: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })}
            placeholder="例如: foos, f"
            sx={{ minWidth: 240, flex: 1 }}
          />
        </Box>
      </Box>
    </Box>
  )
}
