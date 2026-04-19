import { Box, Typography, TextField, Button, Chip, IconButton, Divider, Paper, MenuItem } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, ServiceFormData } from './index'

const defaultData: ServiceFormData = {
  name: '',
  namespace: 'default',
  type: 'ClusterIP',
  ports: [],
  selector: { key: 'app', value: '' },
}

export { defaultData as serviceDefaultData }

export function ServiceForm({ data, onChange, namespaceReadOnly }: FormComponentProps<ServiceFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<ServiceFormData>) => {
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

      {/* 服务类型 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          服务类型
        </Typography>
        <TextField
          select
          label="访问类型"
          size="small"
          value={d.type}
          onChange={(e) => update({ type: e.target.value as any })}
          helperText={
            d.type === 'ClusterIP'
              ? '仅在集群内部访问'
              : d.type === 'NodePort'
              ? '通过节点 IP + 端口访问'
              : d.type === 'LoadBalancer'
              ? '通过云负载均衡器暴露'
              : '映射到外部域名'
          }
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="ClusterIP">ClusterIP（集群内部）</MenuItem>
          <MenuItem value="NodePort">NodePort（节点端口）</MenuItem>
          <MenuItem value="LoadBalancer">LoadBalancer（负载均衡）</MenuItem>
          <MenuItem value="ExternalName">ExternalName（外部域名）</MenuItem>
        </TextField>
      </Box>

      <Divider />

      {/* 选择器 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          选择器（关联 Pod）
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="标签键"
            size="small"
            value={d.selector.key}
            onChange={(e) => update({ selector: { ...d.selector, key: e.target.value } })}
            placeholder="例如: app"
            sx={{ minWidth: 180, flex: 1 }}
          />
          <TextField
            label="标签值"
            size="small"
            value={d.selector.value}
            onChange={(e) => update({ selector: { ...d.selector, value: e.target.value } })}
            placeholder="例如: my-app"
            sx={{ minWidth: 180, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 端口映射 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            端口映射
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                ports: [
                  ...d.ports,
                  {
                    name: '',
                    port: 80,
                    targetPort: 80,
                    protocol: 'TCP',
                    ...(d.type === 'NodePort' ? { nodePort: undefined } : {}),
                  },
                ],
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
              helperText="Service 端口"
              sx={{ minWidth: 90, flex: 1 }}
            />
            <TextField
              label="目标端口"
              size="small"
              type="number"
              value={port.targetPort}
              onChange={(e) => {
                const ports = [...d.ports]
                ports[idx] = { ...port, targetPort: Number(e.target.value) }
                update({ ports })
              }}
              helperText="Pod 端口"
              sx={{ minWidth: 90, flex: 1 }}
            />
            {d.type === 'NodePort' && (
              <TextField
                label="节点端口"
                size="small"
                type="number"
                value={port.nodePort || ''}
                onChange={(e) => {
                  const ports = [...d.ports]
                  ports[idx] = { ...port, nodePort: Number(e.target.value) || undefined }
                  update({ ports })
                }}
                helperText="30000-32767"
                sx={{ minWidth: 90, flex: 1 }}
              />
            )}
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
    </Box>
  )
}
