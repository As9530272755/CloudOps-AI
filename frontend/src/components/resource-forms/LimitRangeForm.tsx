import { Box, Typography, TextField, Button, IconButton, Divider, Paper, MenuItem } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, LimitRangeFormData } from './index'

const defaultData: LimitRangeFormData = {
  name: '',
  namespace: 'default',
  limits: [
    {
      type: 'Container',
      max: [],
      min: [],
      default: [],
      defaultRequest: [],
    },
  ],
}

export { defaultData as limitRangeDefaultData }

export function LimitRangeForm({ data, onChange, namespaceReadOnly }: FormComponentProps<LimitRangeFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<LimitRangeFormData>) => {
    onChange({ ...d, ...patch })
  }

  const updateLimit = (idx: number, patch: any) => {
    const limits = [...d.limits]
    limits[idx] = { ...limits[idx], ...patch }
    update({ limits })
  }

  const limitTypes = ['Container', 'Pod', 'PersistentVolumeClaim']

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

      {/* 限制规则 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            限制规则
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                limits: [
                  ...d.limits,
                  { type: 'Container', max: [], min: [], default: [], defaultRequest: [] },
                ],
              })
            }
          >
            添加规则
          </Button>
        </Box>
        {d.limits.map((limit, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <TextField
                select
                label="类型"
                size="small"
                value={limit.type}
                onChange={(e) => updateLimit(idx, { type: e.target.value })}
                sx={{ minWidth: 200 }}
              >
                {limitTypes.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              <IconButton
                size="small"
                color="error"
                onClick={() => {
                  const limits = d.limits.filter((_, i) => i !== idx)
                  update({ limits: limits.length ? limits : [{ type: 'Container', max: [], min: [], default: [], defaultRequest: [] }] })
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>

            {(['max', 'min', 'default', 'defaultRequest'] as const).map((field) => (
              <Box key={field} sx={{ mb: 2 }}>
                <Typography
                  variant="caption"
                  sx={{
                    mb: 1,
                    display: 'block',
                    fontWeight: 500,
                    color: 'text.secondary',
                  }}
                >
                  {field === 'defaultRequest'
                    ? '默认请求 (defaultRequest)'
                    : field === 'default'
                    ? '默认限制 (default)'
                    : field === 'max'
                    ? '最大值 (max)'
                    : '最小值 (min)'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(limit as any)[field].map((item: any, i: number) => (
                    <Paper key={i} variant="outlined" sx={{ p: 1, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <TextField
                        label="资源"
                        size="small"
                        value={item.key}
                        onChange={(e) => {
                          const arr = [...(limit as any)[field]]
                          arr[i] = { ...item, key: e.target.value }
                          updateLimit(idx, { [field]: arr })
                        }}
                        placeholder="cpu / memory"
                        sx={{ minWidth: 100 }}
                      />
                      <TextField
                        label="值"
                        size="small"
                        value={item.value}
                        onChange={(e) => {
                          const arr = [...(limit as any)[field]]
                          arr[i] = { ...item, value: e.target.value }
                          updateLimit(idx, { [field]: arr })
                        }}
                        placeholder="例如: 1Gi"
                        sx={{ minWidth: 120 }}
                      />
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          const arr = (limit as any)[field].filter((_: any, j: number) => j !== i)
                          updateLimit(idx, { [field]: arr })
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Paper>
                  ))}
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      const arr = [...(limit as any)[field], { key: '', value: '' }]
                      updateLimit(idx, { [field]: arr })
                    }}
                  >
                    添加
                  </Button>
                </Box>
              </Box>
            ))}
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
