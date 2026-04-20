import { Box, Typography, TextField, Divider, Switch, FormControlLabel } from '@mui/material'
import { FormComponentProps, CronJobFormData } from './index'

const defaultData: CronJobFormData = {
  name: '',
  namespace: 'default',
  schedule: '',
  image: '',
  command: '',
  suspend: false,
}

export { defaultData as cronJobDefaultData }

export function CronJobForm({ data, onChange, namespaceReadOnly }: FormComponentProps<CronJobFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<CronJobFormData>) => {
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

      {/* 定时规则 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          定时规则
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            label="Schedule (Cron)"
            size="small"
            value={d.schedule}
            onChange={(e) => update({ schedule: e.target.value })}
            placeholder="例如: */5 * * * *"
            helperText="Cron 表达式，如 '0 2 * * *' 表示每天 2 点执行"
            sx={{ minWidth: 300, flex: 2 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={d.suspend}
                onChange={(e) => update({ suspend: e.target.checked })}
                size="small"
              />
            }
            label="暂停调度"
            sx={{ minWidth: 120 }}
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
    </Box>
  )
}
