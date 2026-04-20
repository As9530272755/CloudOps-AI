import { Box, Typography, TextField, Divider, MenuItem, FormControlLabel, Checkbox } from '@mui/material'
import { FormComponentProps, StorageClassFormData } from './index'

const defaultData: StorageClassFormData = {
  name: '',
  namespace: 'default',
  provisioner: 'kubernetes.io/host-path',
  reclaimPolicy: 'Delete',
  volumeBindingMode: 'Immediate',
  allowVolumeExpansion: false,
}

export { defaultData as storageClassDefaultData }

export function StorageClassForm({ data, onChange, namespaceReadOnly }: FormComponentProps<StorageClassFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<StorageClassFormData>) => {
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

      {/* 配置 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          配置
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <TextField
            label="Provisioner"
            size="small"
            value={d.provisioner}
            onChange={(e) => update({ provisioner: e.target.value })}
            helperText="例如: kubernetes.io/host-path"
            sx={{ minWidth: 280, flex: 1 }}
          />
          <TextField
            select
            label="回收策略"
            size="small"
            value={d.reclaimPolicy}
            onChange={(e) => update({ reclaimPolicy: e.target.value as any })}
            sx={{ minWidth: 200, flex: 1 }}
          >
            <MenuItem value="Delete">Delete</MenuItem>
            <MenuItem value="Retain">Retain</MenuItem>
          </TextField>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <TextField
            select
            label="卷绑定模式"
            size="small"
            value={d.volumeBindingMode}
            onChange={(e) => update({ volumeBindingMode: e.target.value as any })}
            sx={{ minWidth: 200, flex: 1 }}
          >
            <MenuItem value="Immediate">Immediate（立即绑定）</MenuItem>
            <MenuItem value="WaitForFirstConsumer">WaitForFirstConsumer（延迟绑定）</MenuItem>
          </TextField>
        </Box>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={d.allowVolumeExpansion}
              onChange={(e) => update({ allowVolumeExpansion: e.target.checked })}
            />
          }
          label="允许卷扩容 (allowVolumeExpansion)"
        />
      </Box>
    </Box>
  )
}
