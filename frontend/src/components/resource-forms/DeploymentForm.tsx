import { Box, Typography, TextField, Button, Chip, IconButton, Divider, Paper } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, DeploymentFormData } from './index'

const defaultData: DeploymentFormData = {
  name: '',
  namespace: 'default',
  image: '',
  replicas: 1,
  ports: [],
  env: [],
}

export { defaultData as deploymentDefaultData }

export function DeploymentForm({ data, onChange, namespaceReadOnly }: FormComponentProps<DeploymentFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<DeploymentFormData>) => {
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
            label="副本数"
            size="small"
            type="number"
            value={d.replicas}
            onChange={(e) => update({ replicas: Math.max(1, Number(e.target.value)) })}
            inputProps={{ min: 1 }}
            sx={{ minWidth: 120, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 端口设置 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            端口设置
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                ports: [...d.ports, { name: '', port: 80, targetPort: 80, protocol: 'TCP' }],
              })
            }
          >
            添加端口
          </Button>
        </Box>
        {d.ports.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无端口，点击上方按钮添加
          </Typography>
        )}
        {d.ports.map((port, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="端口名称"
              size="small"
              value={port.name}
              onChange={(e) => {
                const ports = [...d.ports]
                ports[idx] = { ...port, name: e.target.value }
                update({ ports })
              }}
              placeholder="可选"
              sx={{ minWidth: 120, flex: 1 }}
            />
            <TextField
              label="容器端口"
              size="small"
              type="number"
              value={port.targetPort}
              onChange={(e) => {
                const ports = [...d.ports]
                const tp = Number(e.target.value)
                ports[idx] = { ...port, targetPort: tp, port: port.port || tp }
                update({ ports })
              }}
              sx={{ minWidth: 100, flex: 1 }}
            />
            <TextField
              label="服务端口"
              size="small"
              type="number"
              value={port.port}
              onChange={(e) => {
                const ports = [...d.ports]
                ports[idx] = { ...port, port: Number(e.target.value) }
                update({ ports })
              }}
              sx={{ minWidth: 100, flex: 1 }}
            />
            <Chip
              label={port.protocol}
              size="small"
              onClick={() => {
                const ports = [...d.ports]
                ports[idx] = { ...port, protocol: port.protocol === 'TCP' ? 'UDP' : 'TCP' }
                update({ ports })
              }}
              sx={{ cursor: 'pointer' }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const ports = d.ports.filter((_, i) => i !== idx)
                update({ ports })
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Paper>
        ))}
      </Box>

      <Divider />

      {/* 环境变量 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            环境变量（高级）
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => update({ env: [...d.env, { name: '', value: '' }] })}
          >
            添加变量
          </Button>
        </Box>
        {d.env.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无环境变量
          </Typography>
        )}
        {d.env.map((env, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="变量名"
              size="small"
              value={env.name}
              onChange={(e) => {
                const envs = [...d.env]
                envs[idx] = { ...env, name: e.target.value }
                update({ env: envs })
              }}
              sx={{ minWidth: 180, flex: 1 }}
            />
            <TextField
              label="变量值"
              size="small"
              value={env.value}
              onChange={(e) => {
                const envs = [...d.env]
                envs[idx] = { ...env, value: e.target.value }
                update({ env: envs })
              }}
              sx={{ minWidth: 200, flex: 2 }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const envs = d.env.filter((_, i) => i !== idx)
                update({ env: envs })
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
