import { Box, Typography, TextField, Button, IconButton, Divider, Paper, MenuItem } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, IngressFormData } from './index'

const defaultData: IngressFormData = {
  name: '',
  namespace: 'default',
  ingressClassName: 'nginx',
  rules: [],
  tls: [],
}

export { defaultData as ingressDefaultData }

export function IngressForm({ data, onChange, namespaceReadOnly }: FormComponentProps<IngressFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<IngressFormData>) => {
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
          <TextField
            label="Ingress Class"
            size="small"
            value={d.ingressClassName}
            onChange={(e) => update({ ingressClassName: e.target.value })}
            placeholder="例如: nginx"
            sx={{ minWidth: 200, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* Rules */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            路由规则 (Rules)
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                rules: [
                  ...d.rules,
                  { host: '', paths: [{ path: '/', pathType: 'Prefix', serviceName: '', servicePort: 80 }] },
                ],
              })
            }
          >
            添加 Rule
          </Button>
        </Box>
        {d.rules.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无 Rule，点击上方按钮添加
          </Typography>
        )}
        {d.rules.map((rule, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                Rule #{idx + 1}
              </Typography>
              <IconButton
                size="small"
                color="error"
                onClick={() => {
                  const rules = d.rules.filter((_, i) => i !== idx)
                  update({ rules })
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
            <TextField
              label="Host"
              size="small"
              value={rule.host}
              onChange={(e) => {
                const rules = [...d.rules]
                rules[idx] = { ...rule, host: e.target.value }
                update({ rules })
              }}
              placeholder="例如: example.com"
              fullWidth
              sx={{ mb: 2 }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                Paths
              </Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => {
                  const rules = [...d.rules]
                  rules[idx] = {
                    ...rule,
                    paths: [...rule.paths, { path: '/', pathType: 'Prefix', serviceName: '', servicePort: 80 }],
                  }
                  update({ rules })
                }}
              >
                添加 Path
              </Button>
            </Box>
            {rule.paths.map((path, pidx) => (
              <Paper key={pidx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  label="Path"
                  size="small"
                  value={path.path}
                  onChange={(e) => {
                    const rules = [...d.rules]
                    const paths = [...rule.paths]
                    paths[pidx] = { ...path, path: e.target.value }
                    rules[idx] = { ...rule, paths }
                    update({ rules })
                  }}
                  sx={{ minWidth: 100, flex: 1 }}
                />
                <TextField
                  select
                  label="Path Type"
                  size="small"
                  value={path.pathType}
                  onChange={(e) => {
                    const rules = [...d.rules]
                    const paths = [...rule.paths]
                    paths[pidx] = { ...path, pathType: e.target.value as any }
                    rules[idx] = { ...rule, paths }
                    update({ rules })
                  }}
                  sx={{ minWidth: 140, flex: 1 }}
                >
                  <MenuItem value="Prefix">Prefix</MenuItem>
                  <MenuItem value="Exact">Exact</MenuItem>
                  <MenuItem value="ImplementationSpecific">ImplementationSpecific</MenuItem>
                </TextField>
                <TextField
                  label="Service 名称"
                  size="small"
                  value={path.serviceName}
                  onChange={(e) => {
                    const rules = [...d.rules]
                    const paths = [...rule.paths]
                    paths[pidx] = { ...path, serviceName: e.target.value }
                    rules[idx] = { ...rule, paths }
                    update({ rules })
                  }}
                  sx={{ minWidth: 120, flex: 1 }}
                />
                <TextField
                  label="端口"
                  size="small"
                  type="number"
                  value={path.servicePort}
                  onChange={(e) => {
                    const rules = [...d.rules]
                    const paths = [...rule.paths]
                    paths[pidx] = { ...path, servicePort: Number(e.target.value) }
                    rules[idx] = { ...rule, paths }
                    update({ rules })
                  }}
                  sx={{ minWidth: 80, flex: 1 }}
                />
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => {
                    const rules = [...d.rules]
                    const paths = rule.paths.filter((_, i) => i !== pidx)
                    rules[idx] = { ...rule, paths }
                    update({ rules })
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Paper>
        ))}
      </Box>

      <Divider />

      {/* TLS */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            TLS
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                tls: [...d.tls, { hosts: '', secretName: '' }],
              })
            }
          >
            添加 TLS
          </Button>
        </Box>
        {d.tls.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无 TLS，点击上方按钮添加
          </Typography>
        )}
        {d.tls.map((tlsItem, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="Hosts（逗号分隔）"
              size="small"
              value={tlsItem.hosts}
              onChange={(e) => {
                const tls = [...d.tls]
                tls[idx] = { ...tlsItem, hosts: e.target.value }
                update({ tls })
              }}
              placeholder="例如: example.com, www.example.com"
              sx={{ minWidth: 200, flex: 2 }}
            />
            <TextField
              label="Secret 名称"
              size="small"
              value={tlsItem.secretName}
              onChange={(e) => {
                const tls = [...d.tls]
                tls[idx] = { ...tlsItem, secretName: e.target.value }
                update({ tls })
              }}
              placeholder="例如: my-secret"
              sx={{ minWidth: 150, flex: 1 }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const tls = d.tls.filter((_, i) => i !== idx)
                update({ tls })
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
