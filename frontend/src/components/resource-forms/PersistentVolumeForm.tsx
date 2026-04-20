import { Box, Typography, TextField, Divider, MenuItem, FormControlLabel, Checkbox } from '@mui/material'
import { FormComponentProps, PersistentVolumeFormData } from './index'

const defaultData: PersistentVolumeFormData = {
  name: '',
  namespace: 'default',
  capacity: '10Gi',
  accessModes: ['ReadWriteOnce'],
  persistentVolumeReclaimPolicy: 'Retain',
  storageClassName: '',
  hostPath: '',
}

export { defaultData as persistentVolumeDefaultData }

export function PersistentVolumeForm({ data, onChange, namespaceReadOnly }: FormComponentProps<PersistentVolumeFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<PersistentVolumeFormData>) => {
    onChange({ ...d, ...patch })
  }

  const accessModeOptions = ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany']

  const toggleAccessMode = (mode: string) => {
    const modes = d.accessModes.includes(mode)
      ? d.accessModes.filter((m) => m !== mode)
      : [...d.accessModes, mode]
    update({ accessModes: modes })
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

      {/* 容量与访问模式 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          容量与访问模式
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <TextField
            label="容量"
            size="small"
            value={d.capacity}
            onChange={(e) => update({ capacity: e.target.value })}
            helperText="例如: 10Gi, 100Mi"
            sx={{ minWidth: 200, flex: 1 }}
          />
          <TextField
            select
            label="回收策略"
            size="small"
            value={d.persistentVolumeReclaimPolicy}
            onChange={(e) => update({ persistentVolumeReclaimPolicy: e.target.value as any })}
            sx={{ minWidth: 200, flex: 1 }}
          >
            <MenuItem value="Retain">Retain（保留）</MenuItem>
            <MenuItem value="Recycle">Recycle（回收）</MenuItem>
            <MenuItem value="Delete">Delete（删除）</MenuItem>
          </TextField>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {accessModeOptions.map((mode) => (
            <FormControlLabel
              key={mode}
              control={
                <Checkbox
                  size="small"
                  checked={d.accessModes.includes(mode)}
                  onChange={() => toggleAccessMode(mode)}
                />
              }
              label={mode}
            />
          ))}
        </Box>
      </Box>

      <Divider />

      {/* 存储配置 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          存储配置
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="StorageClass 名称"
            size="small"
            value={d.storageClassName}
            onChange={(e) => update({ storageClassName: e.target.value })}
            placeholder="例如: standard"
            sx={{ minWidth: 200, flex: 1 }}
          />
          <TextField
            label="HostPath（可选）"
            size="small"
            value={d.hostPath}
            onChange={(e) => update({ hostPath: e.target.value })}
            placeholder="例如: /data/pv"
            sx={{ minWidth: 200, flex: 1 }}
          />
        </Box>
      </Box>
    </Box>
  )
}
