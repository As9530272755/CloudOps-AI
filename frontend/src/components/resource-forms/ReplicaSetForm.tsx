import { Box, Typography, TextField, Divider } from '@mui/material'
import { FormComponentProps, ReplicaSetFormData } from './index'

const defaultData: ReplicaSetFormData = {
  name: '',
  namespace: 'default',
  replicas: 1,
  image: '',
  port: 80,
}

export { defaultData as replicaSetDefaultData }

export function ReplicaSetForm({ data, onChange, namespaceReadOnly }: FormComponentProps<ReplicaSetFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<ReplicaSetFormData>) => {
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

      {/* 容器配置 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          容器配置
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="镜像地址"
            size="small"
            value={d.image}
            onChange={(e) => update({ image: e.target.value })}
            placeholder="例如: nginx:latest"
            helperText="容器镜像的完整地址"
            sx={{ minWidth: 300, flex: 2 }}
          />
          <TextField
            label="副本数"
            size="small"
            type="number"
            value={d.replicas}
            onChange={(e) => update({ replicas: Math.max(0, Number(e.target.value)) })}
            inputProps={{ min: 0 }}
            sx={{ minWidth: 120, flex: 1 }}
          />
          <TextField
            label="容器端口"
            size="small"
            type="number"
            value={d.port}
            onChange={(e) => update({ port: Number(e.target.value) })}
            sx={{ minWidth: 120, flex: 1 }}
          />
        </Box>
      </Box>
    </Box>
  )
}
