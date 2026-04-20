import { Box, Typography, TextField, Button, IconButton, Divider, Paper } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, RoleFormData } from './index'

const defaultData: RoleFormData = {
  name: '',
  namespace: 'default',
  rules: [],
}

export { defaultData as roleDefaultData }

export function RoleForm({ data, onChange, namespaceReadOnly }: FormComponentProps<RoleFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<RoleFormData>) => {
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

      {/* 规则 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            规则 (Rules)
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                rules: [...d.rules, { apiGroups: '', resources: '', verbs: '' }],
              })
            }
          >
            添加规则
          </Button>
        </Box>
        {d.rules.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无规则，点击上方按钮添加
          </Typography>
        )}
        {d.rules.map((rule, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                规则 #{idx + 1}
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
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <TextField
                label="API Groups（逗号分隔）"
                size="small"
                value={rule.apiGroups}
                onChange={(e) => {
                  const rules = [...d.rules]
                  rules[idx] = { ...rule, apiGroups: e.target.value }
                  update({ rules })
                }}
                placeholder='例如: "", apps, rbac.authorization.k8s.io'
                sx={{ minWidth: 220, flex: 1 }}
              />
              <TextField
                label="Resources（逗号分隔）"
                size="small"
                value={rule.resources}
                onChange={(e) => {
                  const rules = [...d.rules]
                  rules[idx] = { ...rule, resources: e.target.value }
                  update({ rules })
                }}
                placeholder="例如: pods, services, deployments"
                sx={{ minWidth: 220, flex: 1 }}
              />
            </Box>
            <TextField
              label="Verbs（逗号分隔）"
              size="small"
              value={rule.verbs}
              onChange={(e) => {
                const rules = [...d.rules]
                rules[idx] = { ...rule, verbs: e.target.value }
                update({ rules })
              }}
              placeholder="例如: get, list, watch, create, update, patch, delete"
              fullWidth
            />
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
