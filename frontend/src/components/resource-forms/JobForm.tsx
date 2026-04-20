import { Box, Typography, TextField, Divider, MenuItem } from '@mui/material'
import { FormComponentProps, JobFormData } from './index'

const defaultData: JobFormData = {
  name: '',
  namespace: 'default',
  image: '',
  command: '',
  completions: 1,
  parallelism: 1,
  restartPolicy: 'Never',
}

export { defaultData as jobDefaultData }

export function JobForm({ data, onChange, namespaceReadOnly }: FormComponentProps<JobFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<JobFormData>) => {
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
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <TextField
            label="镜像地址"
            size="small"
            value={d.image}
            onChange={(e) => update({ image: e.target.value })}
            placeholder="例如: busybox:latest"
            helperText="容器镜像的完整地址"
            sx={{ minWidth: 300, flex: 2 }}
          />
          <TextField
            label="执行命令"
            size="small"
            value={d.command}
            onChange={(e) => update({ command: e.target.value })}
            placeholder="例如: echo hello"
            helperText="以空格分隔的命令参数"
            sx={{ minWidth: 240, flex: 2 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 任务配置 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          任务配置
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="完成数"
            size="small"
            type="number"
            value={d.completions}
            onChange={(e) => update({ completions: Math.max(1, Number(e.target.value)) })}
            inputProps={{ min: 1 }}
            helperText="需要成功完成的 Pod 数量"
            sx={{ minWidth: 120, flex: 1 }}
          />
          <TextField
            label="并行数"
            size="small"
            type="number"
            value={d.parallelism}
            onChange={(e) => update({ parallelism: Math.max(1, Number(e.target.value)) })}
            inputProps={{ min: 1 }}
            helperText="同时运行的 Pod 数量"
            sx={{ minWidth: 120, flex: 1 }}
          />
          <TextField
            select
            label="重启策略"
            size="small"
            value={d.restartPolicy}
            onChange={(e) => update({ restartPolicy: e.target.value as any })}
            sx={{ minWidth: 200, flex: 1 }}
          >
            <MenuItem value="Never">Never（不重启）</MenuItem>
            <MenuItem value="OnFailure">OnFailure（失败时重启）</MenuItem>
          </TextField>
        </Box>
      </Box>
    </Box>
  )
}
