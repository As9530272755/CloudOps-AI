import { useState, useEffect } from 'react'
import {
  Box,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  IconButton,
  Paper,
  Switch,
  FormControlLabel,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import { DashboardVariable } from '../charts/types'
import { DataSource, datasourceAPI } from '../../lib/datasource-api'

interface VariableEditorProps {
  variables: DashboardVariable[]
  onChange: (vars: DashboardVariable[]) => void
}

export default function VariableEditor({ variables, onChange }: VariableEditorProps) {
  const [dataSources, setDataSources] = useState<DataSource[]>([])
  const [testingVar, setTestingVar] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string[]>>({})

  useEffect(() => {
    datasourceAPI.list('prometheus').then((res) => {
      if (res.success) setDataSources(res.data)
    })
  }, [])

  const handleAdd = () => {
    const newVar: DashboardVariable = {
      name: `var${variables.length + 1}`,
      label: `变量 ${variables.length + 1}`,
      type: 'custom',
      options: ['option1', 'option2'],
      multi: false,
      includeAll: true,
    }
    onChange([...variables, newVar])
  }

  const handleUpdate = (index: number, patch: Partial<DashboardVariable>) => {
    const next = [...variables]
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }

  const handleDelete = (index: number) => {
    const next = [...variables]
    next.splice(index, 1)
    onChange(next)
  }

  const handleTestQuery = async (v: DashboardVariable, index: number) => {
    if (!v.query || !v.dataSourceId) return
    setTestingVar(v.name)
    try {
      const res = await datasourceAPI.queryVariables(v.dataSourceId, v.query, v.labelName)
      if (res.success && Array.isArray(res.data)) {
        setTestResult((prev) => ({ ...prev, [index]: res.data }))
      }
    } catch (e: any) {
      setTestResult((prev) => ({ ...prev, [index]: ['查询失败: ' + (e.message || '未知错误')] }))
    }
    setTestingVar(null)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          仪表盘变量 ({variables.length})
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={handleAdd} variant="outlined">
          添加变量
        </Button>
      </Box>

      {variables.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          暂无变量。点击"添加变量"创建类似 Grafana 的模板变量，在 PromQL 中使用 $变量名 引用。
        </Typography>
      )}

      {variables.map((v, i) => (
        <Paper key={i} variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField
                label="变量名"
                size="small"
                value={v.name}
                onChange={(e) => handleUpdate(i, { name: e.target.value })}
                helperText="PromQL 中使用 $name 引用"
                sx={{ flex: 1 }}
              />
              <TextField
                label="显示标签"
                size="small"
                value={v.label}
                onChange={(e) => handleUpdate(i, { label: e.target.value })}
                sx={{ flex: 1 }}
              />
              <IconButton size="small" color="error" onClick={() => handleDelete(i)} sx={{ mt: 0.5 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>

            <FormControl size="small" fullWidth>
              <InputLabel>类型</InputLabel>
              <Select
                value={v.type}
                label="类型"
                onChange={(e) => handleUpdate(i, { type: e.target.value as any })}
              >
                <MenuItem value="query">查询 (PromQL)</MenuItem>
                <MenuItem value="custom">自定义选项</MenuItem>
                <MenuItem value="text">文本输入</MenuItem>
              </Select>
            </FormControl>

            {v.type === 'query' && (
              <>
                <FormControl size="small" fullWidth>
                  <InputLabel>数据源</InputLabel>
                  <Select
                    value={v.dataSourceId || ''}
                    label="数据源"
                    onChange={(e) => handleUpdate(i, { dataSourceId: Number(e.target.value) || undefined })}
                  >
                    {dataSources.map((ds) => (
                      <MenuItem key={ds.id} value={ds.id}>
                        {ds.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="PromQL 查询"
                  size="small"
                  value={v.query || ''}
                  onChange={(e) => handleUpdate(i, { query: e.target.value })}
                  placeholder="例如: kube_node_info"
                  helperText="执行即时查询，从结果中提取指定 label 的值"
                />
                <TextField
                  label="Label 名称"
                  size="small"
                  value={v.labelName || ''}
                  onChange={(e) => handleUpdate(i, { labelName: e.target.value })}
                  placeholder="例如: cluster"
                  helperText="从查询结果的 metric label 中提取该字段的值，留空则取第一个非 __name__ label"
                />
                <Button
                  size="small"
                  variant="outlined"
                  disabled={testingVar === v.name || !v.query || !v.dataSourceId}
                  onClick={() => handleTestQuery(v, i)}
                >
                  {testingVar === v.name ? '查询中...' : '测试查询'}
                </Button>
                {testResult[i] && (
                  <Typography variant="caption" color="text.secondary">
                    结果: {testResult[i].slice(0, 10).join(', ')}{testResult[i].length > 10 ? ` ... 等 ${testResult[i].length} 个` : ''}
                  </Typography>
                )}
              </>
            )}

            {v.type === 'custom' && (
              <TextField
                label="选项 (逗号分隔)"
                size="small"
                value={(v.options || []).join(', ')}
                onChange={(e) =>
                  handleUpdate(i, {
                    options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                helperText="用英文逗号分隔多个选项"
              />
            )}

            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={!!v.multi}
                    onChange={(e) => handleUpdate(i, { multi: e.target.checked })}
                  />
                }
                label="允许多选"
              />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={!!v.includeAll}
                    onChange={(e) => handleUpdate(i, { includeAll: e.target.checked })}
                  />
                }
                label="包含 All 选项"
              />
            </Box>

            <TextField
              label="默认值"
              size="small"
              value={v.defaultValue || ''}
              onChange={(e) => handleUpdate(i, { defaultValue: e.target.value })}
              placeholder="可选，留空则使用第一个选项"
            />
          </Box>
        </Paper>
      ))}
    </Box>
  )
}
