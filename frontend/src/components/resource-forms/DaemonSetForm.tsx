import { Box, Typography, TextField, Button, IconButton, Divider, Paper } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, DaemonSetFormData } from './index'

const defaultData: DaemonSetFormData = {
  name: '',
  namespace: 'default',
  image: '',
  port: 80,
  nodeSelector: [],
}

export { defaultData as daemonSetDefaultData }

export function DaemonSetForm({ data, onChange, namespaceReadOnly }: FormComponentProps<DaemonSetFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<DaemonSetFormData>) => {
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

      {/* 容器设置 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          容器设置
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
            label="容器端口"
            size="small"
            type="number"
            value={d.port}
            onChange={(e) => update({ port: Number(e.target.value) })}
            sx={{ minWidth: 120, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 节点选择器 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            节点选择器
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => update({ nodeSelector: [...d.nodeSelector, { key: '', value: '' }] })}
          >
            添加选择器
          </Button>
        </Box>
        {d.nodeSelector.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无节点选择器，点击上方按钮添加
          </Typography>
        )}
        {d.nodeSelector.map((sel, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="键"
              size="small"
              value={sel.key}
              onChange={(e) => {
                const nodeSelector = [...d.nodeSelector]
                nodeSelector[idx] = { ...sel, key: e.target.value }
                update({ nodeSelector })
              }}
              sx={{ minWidth: 180, flex: 1 }}
            />
            <TextField
              label="值"
              size="small"
              value={sel.value}
              onChange={(e) => {
                const nodeSelector = [...d.nodeSelector]
                nodeSelector[idx] = { ...sel, value: e.target.value }
                update({ nodeSelector })
              }}
              sx={{ minWidth: 180, flex: 1 }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const nodeSelector = d.nodeSelector.filter((_, i) => i !== idx)
                update({ nodeSelector })
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
