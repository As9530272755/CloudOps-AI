import { Box, Typography, TextField, Button, IconButton, Divider, Paper, Chip } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, StatefulSetFormData } from './index'

const defaultData: StatefulSetFormData = {
  name: '',
  namespace: 'default',
  replicas: 1,
  serviceName: '',
  image: '',
  port: 80,
  volumeClaimTemplates: [],
}

export { defaultData as statefulSetDefaultData }

export function StatefulSetForm({ data, onChange, namespaceReadOnly }: FormComponentProps<StatefulSetFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<StatefulSetFormData>) => {
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

      {/* 规格配置 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          规格配置
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
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 2 }}>
          <TextField
            label="Service 名称"
            size="small"
            value={d.serviceName}
            onChange={(e) => update({ serviceName: e.target.value })}
            placeholder="用于 Pod 网络标识的 Headless Service"
            sx={{ minWidth: 240, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 存储卷声明模板 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            存储卷声明模板 (VolumeClaimTemplates)
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                volumeClaimTemplates: [
                  ...d.volumeClaimTemplates,
                  { name: '', storageClassName: '', accessModes: 'ReadWriteOnce', storage: '1Gi' },
                ],
              })
            }
          >
            添加模板
          </Button>
        </Box>
        {d.volumeClaimTemplates.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无存储卷声明模板，点击上方按钮添加
          </Typography>
        )}
        {d.volumeClaimTemplates.map((vct, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                模板 #{idx + 1}
              </Typography>
              <IconButton
                size="small"
                color="error"
                onClick={() => {
                  const volumeClaimTemplates = d.volumeClaimTemplates.filter((_, i) => i !== idx)
                  update({ volumeClaimTemplates })
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <TextField
                label="名称"
                size="small"
                value={vct.name}
                onChange={(e) => {
                  const volumeClaimTemplates = [...d.volumeClaimTemplates]
                  volumeClaimTemplates[idx] = { ...vct, name: e.target.value }
                  update({ volumeClaimTemplates })
                }}
                sx={{ minWidth: 180, flex: 1 }}
              />
              <TextField
                label="StorageClass"
                size="small"
                value={vct.storageClassName}
                onChange={(e) => {
                  const volumeClaimTemplates = [...d.volumeClaimTemplates]
                  volumeClaimTemplates[idx] = { ...vct, storageClassName: e.target.value }
                  update({ volumeClaimTemplates })
                }}
                placeholder="例如: standard"
                sx={{ minWidth: 180, flex: 1 }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Chip
                label={vct.accessModes}
                size="small"
                onClick={() => {
                  const volumeClaimTemplates = [...d.volumeClaimTemplates]
                  const modes = ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany']
                  const next = modes[(modes.indexOf(vct.accessModes) + 1) % modes.length]
                  volumeClaimTemplates[idx] = { ...vct, accessModes: next as any }
                  update({ volumeClaimTemplates })
                }}
                sx={{ cursor: 'pointer' }}
              />
              <TextField
                label="存储大小"
                size="small"
                value={vct.storage}
                onChange={(e) => {
                  const volumeClaimTemplates = [...d.volumeClaimTemplates]
                  volumeClaimTemplates[idx] = { ...vct, storage: e.target.value }
                  update({ volumeClaimTemplates })
                }}
                placeholder="例如: 1Gi"
                sx={{ minWidth: 120, flex: 1 }}
              />
            </Box>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
