import { Box, Typography, TextField, Divider } from '@mui/material'
import { FormComponentProps, VolumeAttachmentFormData } from './index'

const defaultData: VolumeAttachmentFormData = {
  name: '',
  namespace: 'default',
  attacher: '',
  nodeName: '',
  source: { persistentVolumeName: '' },
}

export { defaultData as volumeAttachmentDefaultData }

export function VolumeAttachmentForm({ data, onChange, namespaceReadOnly }: FormComponentProps<VolumeAttachmentFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<VolumeAttachmentFormData>) => {
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

      {/* 卷挂载设置 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          卷挂载设置
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="Attacher"
            size="small"
            value={d.attacher}
            onChange={(e) => update({ attacher: e.target.value })}
            placeholder="例如: csi-driver"
            helperText="CSI 驱动名称"
            sx={{ minWidth: 200, flex: 1 }}
          />
          <TextField
            label="节点名称"
            size="small"
            value={d.nodeName}
            onChange={(e) => update({ nodeName: e.target.value })}
            placeholder="例如: node-1"
            sx={{ minWidth: 200, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 卷来源 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          卷来源
        </Typography>
        <TextField
          label="PersistentVolume 名称"
          size="small"
          value={d.source.persistentVolumeName}
          onChange={(e) => update({ source: { ...d.source, persistentVolumeName: e.target.value } })}
          placeholder="输入 PV 名称"
          fullWidth
        />
      </Box>
    </Box>
  )
}
