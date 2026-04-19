import { Box, Typography, TextField, Divider, MenuItem } from '@mui/material'
import { FormComponentProps, PodFormData } from './index'

const defaultData: PodFormData = {
  name: '',
  namespace: 'default',
  image: '',
  restartPolicy: 'Always',
}

export { defaultData as podDefaultData }

export function PodForm({ data, onChange, namespaceReadOnly }: FormComponentProps<PodFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<PodFormData>) => {
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
        <TextField
          label="镜像地址"
          size="small"
          value={d.image}
          onChange={(e) => update({ image: e.target.value })}
          placeholder="例如: nginx:latest"
          helperText="容器镜像的完整地址"
          sx={{ minWidth: 360, width: '100%', maxWidth: 600 }}
        />
      </Box>

      <Divider />

      {/* 重启策略 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          重启策略
        </Typography>
        <TextField
          select
          label="策略"
          size="small"
          value={d.restartPolicy}
          onChange={(e) => update({ restartPolicy: e.target.value as any })}
          helperText={
            d.restartPolicy === 'Always'
              ? '容器退出后总是重启（适合长期运行的服务）'
              : d.restartPolicy === 'OnFailure'
              ? '仅在失败时重启（适合批处理任务）'
              : '从不重启（适合一次性任务）'
          }
          sx={{ minWidth: 300 }}
        >
          <MenuItem value="Always">Always（总是重启）</MenuItem>
          <MenuItem value="OnFailure">OnFailure（失败时重启）</MenuItem>
          <MenuItem value="Never">Never（不重启）</MenuItem>
        </TextField>
      </Box>
    </Box>
  )
}
