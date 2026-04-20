import { Box, Typography, TextField, Button, IconButton, Divider, Paper, MenuItem } from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import { FormComponentProps, RoleBindingFormData } from './index'

const defaultData: RoleBindingFormData = {
  name: '',
  namespace: 'default',
  roleRef: { kind: 'Role', name: '' },
  subjects: [],
}

export { defaultData as roleBindingDefaultData }

export function RoleBindingForm({ data, onChange, namespaceReadOnly }: FormComponentProps<RoleBindingFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<RoleBindingFormData>) => {
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

      {/* RoleRef */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          角色引用 (RoleRef)
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            select
            label="Kind"
            size="small"
            value={d.roleRef.kind}
            onChange={(e) => update({ roleRef: { ...d.roleRef, kind: e.target.value } })}
            sx={{ minWidth: 160, flex: 1 }}
          >
            <MenuItem value="Role">Role</MenuItem>
            <MenuItem value="ClusterRole">ClusterRole</MenuItem>
          </TextField>
          <TextField
            label="名称"
            size="small"
            value={d.roleRef.name}
            onChange={(e) => update({ roleRef: { ...d.roleRef, name: e.target.value } })}
            placeholder="角色名称"
            sx={{ minWidth: 200, flex: 2 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* Subjects */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            主体 (Subjects)
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              update({
                subjects: [...d.subjects, { kind: 'ServiceAccount', name: '', namespace: d.namespace }],
              })
            }
          >
            添加主体
          </Button>
        </Box>
        {d.subjects.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无主体，点击上方按钮添加
          </Typography>
        )}
        {d.subjects.map((subject, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              select
              label="Kind"
              size="small"
              value={subject.kind}
              onChange={(e) => {
                const subjects = [...d.subjects]
                subjects[idx] = { ...subject, kind: e.target.value }
                update({ subjects })
              }}
              sx={{ minWidth: 140, flex: 1 }}
            >
              <MenuItem value="ServiceAccount">ServiceAccount</MenuItem>
              <MenuItem value="User">User</MenuItem>
              <MenuItem value="Group">Group</MenuItem>
            </TextField>
            <TextField
              label="名称"
              size="small"
              value={subject.name}
              onChange={(e) => {
                const subjects = [...d.subjects]
                subjects[idx] = { ...subject, name: e.target.value }
                update({ subjects })
              }}
              sx={{ minWidth: 160, flex: 1 }}
            />
            <TextField
              label="命名空间"
              size="small"
              value={subject.namespace}
              onChange={(e) => {
                const subjects = [...d.subjects]
                subjects[idx] = { ...subject, namespace: e.target.value }
                update({ subjects })
              }}
              sx={{ minWidth: 140, flex: 1 }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const subjects = d.subjects.filter((_, i) => i !== idx)
                update({ subjects })
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
