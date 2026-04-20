import React, { useState, useEffect } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  Pagination,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  Grid,
  Checkbox,
  ListItemText,
} from '@mui/material'
import {
  Add as AddIcon,
  PlayArrow as RunIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Assessment as ReportIcon,
  FlashOn as QuickIcon,
} from '@mui/icons-material'

// html2pdf.js 改为动态导入，避免打包兼容性问题导致页面白屏
import { inspectionAPI, InspectionTask, InspectionJob, InspectionResultItem } from '../lib/inspection-api'
import ConfirmDialog from '../components/ConfirmDialog'
import { clusterAPI, Cluster } from '../lib/cluster-api'

const riskColors: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
  critical: 'error',
}

const riskLabels: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '极高风险',
}

const schedulePresets = [
  { label: '手动执行', value: '' },
  { label: '每小时', value: '0 0 * * * *' },
  { label: '每天 09:00', value: '0 0 9 * * *' },
  { label: '每周一 09:00', value: '0 0 9 * * 1' },
]

export default function Inspection() {
  const [activeTab, setActiveTab] = useState(0)
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [tasks, setTasks] = useState<InspectionTask[]>([])
  const [jobs, setJobs] = useState<InspectionJob[]>([])
  const [jobTotal, setJobTotal] = useState(0)
  const [jobPage, setJobPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 弹窗状态
  const [taskDialog, setTaskDialog] = useState(false)
  const [editingTask, setEditingTask] = useState<InspectionTask | null>(null)
  const [reportDialog, setReportDialog] = useState(false)
  const [selectedJob, setSelectedJob] = useState<{ job: InspectionJob; results: InspectionResultItem[] } | null>(null)
  const [quickDialogOpen, setQuickDialogOpen] = useState(false)
  const [quickClusterIds, setQuickClusterIds] = useState<number[]>([])

  // 表单
  const [form, setForm] = useState<Partial<InspectionTask>>({
    name: '',
    description: '',
    schedule: '',
    schedule_type: 'manual',
    timezone: 'Asia/Shanghai',
    enabled: true,
    retry_times: 0,
    cluster_ids: [],
  })

  const loadClusters = async () => {
    try {
      const res = await clusterAPI.getClusters()
      if (res.success && res.data) setClusters(res.data)
    } catch {}
  }

  const loadTasks = async () => {
    try {
      const res = await inspectionAPI.listTasks()
      if (res.success && res.data) setTasks(res.data)
    } catch (err: any) {
      setError(err.message || '加载任务失败')
    }
  }

  const loadJobs = async () => {
    setLoading(true)
    try {
      const res = await inspectionAPI.listJobs({ page: jobPage, limit: 10 })
      if (res.success && res.data) {
        setJobs(res.data.items)
        setJobTotal(res.data.total)
      }
    } catch (err: any) {
      setError(err.message || '加载执行记录失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClusters()
    loadTasks()
  }, [])

  useEffect(() => {
    loadJobs()
  }, [jobPage])

  const handleSaveTask = async () => {
    if (!form.name) return
    if (!form.cluster_ids || form.cluster_ids.length === 0) {
      setError('请至少选择一个关联集群')
      return
    }
    let schedule = form.schedule || ''
    let scheduleType = form.schedule_type || 'manual'
    if (scheduleType !== 'custom' && scheduleType !== 'manual') {
      const preset = schedulePresets.find(p => p.label === scheduleType)
      if (preset) schedule = preset.value
    }
    const payload = { ...form, schedule, schedule_type: scheduleType }
    try {
      const res = editingTask
        ? await inspectionAPI.updateTask(editingTask.id, payload)
        : await inspectionAPI.createTask(payload)
      if (!res.success) {
        setError(res.error || '保存失败')
        return
      }
      setTaskDialog(false)
      setEditingTask(null)
      setForm({ name: '', description: '', schedule: '', schedule_type: 'manual', timezone: 'Asia/Shanghai', enabled: true, retry_times: 0, cluster_ids: [] })
      loadTasks()
    } catch (err: any) {
      setError(err.message || '保存失败')
    }
  }

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const handleDeleteTask = async (id: number) => {
    setConfirmId(id)
    setConfirmOpen(true)
  }

  const doDeleteTask = async () => {
    if (!confirmId) return
    try {
      await inspectionAPI.deleteTask(confirmId)
      // 直接从本地状态移除，无需重新请求 API，用户体验更即时
      setTasks(prev => prev.filter(t => t.id !== confirmId))
    } catch (err: any) {
      setError(err.message || '删除失败')
    } finally {
      setConfirmOpen(false)
      setConfirmId(null)
    }
  }

  const handleTrigger = async (id: number) => {
    await inspectionAPI.triggerTask(id)
    setActiveTab(1)
    setTimeout(() => loadJobs(), 2000)
  }

  const handleQuickInspect = () => {
    setQuickClusterIds(clusters.map(c => c.id))
    setQuickDialogOpen(true)
  }

  const handleConfirmQuickInspect = async () => {
    setQuickDialogOpen(false)
    setLoading(true)
    try {
      const res = await inspectionAPI.quickInspect({ cluster_ids: quickClusterIds })
      if (res.success) {
        setActiveTab(1)
        setTimeout(() => loadJobs(), 2000)
      } else {
        setError(res.error || '一键巡检失败')
      }
    } catch (err: any) {
      setError(err.message || '一键巡检失败')
    } finally {
      setLoading(false)
    }
  }

  const openReport = async (job: InspectionJob) => {
    const res = await inspectionAPI.getJob(job.id)
    if (res.success && res.data) {
      setSelectedJob(res.data)
      setReportDialog(true)
    }
  }

  const scoreAvg = tasks.length > 0 ? 92 : 100 // MVP 固定展示

  return (
    <Box sx={{ p: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* 概览卡片区 */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ border: '1px solid', borderColor: 'divider' }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">巡检任务</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, mt: 1 }}>{tasks.length}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">今日执行</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, mt: 1 }}>{jobs.filter(j => j.created_at && j.created_at.startsWith(new Date().toISOString().slice(0, 10))).length}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">平均评分</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, mt: 1, color: scoreAvg >= 90 ? 'success.main' : scoreAvg >= 70 ? 'warning.main' : 'error.main' }}>
                {scoreAvg}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ border: '1px solid', borderColor: 'divider' }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">中高风险</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, mt: 1, color: 'error.main' }}>
                {jobs.filter(j => j.risk_level === 'high' || j.risk_level === 'critical').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Card>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ px: 2, pt: 1 }}>
          <Tab label="巡检任务" />
          <Tab label="执行记录" />
        </Tabs>

        <CardContent>
          {activeTab === 0 && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, alignItems: 'center' }}>
                <Typography variant="h6" fontWeight={600}>巡检任务</Typography>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <Button variant="contained" startIcon={<QuickIcon />} onClick={handleQuickInspect} disabled={loading}>
                    一键巡检
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      setEditingTask(null)
                      setForm({ name: '', description: '', schedule: '', schedule_type: 'manual', timezone: 'Asia/Shanghai', enabled: true, retry_times: 0, cluster_ids: [] })
                      setTaskDialog(true)
                    }}
                  >
                    新建任务
                  </Button>
                </Box>
              </Box>

              <TableContainer component={Paper} sx={{ background: 'transparent', boxShadow: 'none' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>任务名</TableCell>
                      <TableCell>定时规则</TableCell>
                      <TableCell>关联集群</TableCell>
                      <TableCell>状态</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tasks.map(task => (
                      <TableRow key={task.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{task.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{task.description || '-'}</Typography>
                        </TableCell>
                        <TableCell>
                          {task.schedule ? (
                            <Chip label={task.schedule} size="small" variant="outlined" />
                          ) : (
                            <Chip label="手动" size="small" color="default" />
                          )}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const names = (task.cluster_ids || [])
                              .map(id => clusters.find(c => c.id === id)?.display_name)
                              .filter(Boolean) as string[]
                            if (names.length === 0) return '全部活跃集群'
                            if (names.length <= 2) return names.join(', ')
                            return `${names.slice(0, 2).join(', ')} 等 ${names.length} 个集群`
                          })()}
                        </TableCell>
                        <TableCell>
                          <Chip label={task.enabled ? '已启用' : '已停用'} color={task.enabled ? 'success' : 'default'} size="small" />
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="立即执行">
                            <IconButton size="small" color="primary" onClick={() => handleTrigger(task.id)}><RunIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          <Tooltip title="编辑">
                            <IconButton size="small" onClick={() => { setEditingTask(task); setForm(task); setTaskDialog(true); }}>
                              <RefreshIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="删除">
                            <IconButton size="small" color="error" onClick={() => handleDeleteTask(task.id)}><DeleteIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                    {tasks.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          暂无巡检任务，点击右上角新建
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}

          {activeTab === 1 && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6" fontWeight={600}>执行记录</Typography>
                <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadJobs}>刷新</Button>
              </Box>

              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
              ) : (
                <>
                  <TableContainer component={Paper} sx={{ background: 'transparent', boxShadow: 'none' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>任务名称</TableCell>
                          <TableCell>触发方式</TableCell>
                          <TableCell>集群数</TableCell>
                          <TableCell>成功/失败</TableCell>
                          <TableCell>评分</TableCell>
                          <TableCell>风险等级</TableCell>
                          <TableCell>执行时间</TableCell>
                          <TableCell align="right">操作</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {jobs.map(job => (
                          <TableRow key={job.id} hover>
                            <TableCell sx={{ fontWeight: 600 }}>{job.task_name || `任务 #${job.task_id}`}</TableCell>
                            <TableCell>
                              <Chip label={job.trigger_type === 'manual' ? '手动' : '定时'} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell>{job.total_clusters}</TableCell>
                            <TableCell>{job.success_count} / {job.failed_count}</TableCell>
                            <TableCell>
                              <Typography fontWeight={600} color={job.score_avg >= 90 ? 'success.main' : job.score_avg >= 70 ? 'warning.main' : 'error.main'}>
                                {job.score_avg}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip label={riskLabels[job.risk_level] || job.risk_level} color={riskColors[job.risk_level] || 'default'} size="small" />
                            </TableCell>
                            <TableCell>
                              {job.created_at ? new Date(job.created_at).toLocaleString() : '-'}
                            </TableCell>
                            <TableCell align="right">
                              <Tooltip title="查看报告">
                                <IconButton size="small" onClick={() => openReport(job)}><ReportIcon fontSize="small" /></IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                        {jobs.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                              暂无执行记录
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                    <Pagination count={Math.max(1, Math.ceil(jobTotal / 10))} page={jobPage} onChange={(_, p) => setJobPage(p)} color="primary" />
                  </Box>
                </>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* 一键巡检集群选择弹窗 */}
      <Dialog open={quickDialogOpen} onClose={() => setQuickDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>选择要巡检的集群</DialogTitle>
        <DialogContent dividers>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>关联集群</InputLabel>
            <Select
              multiple
              value={quickClusterIds}
              label="关联集群"
              onChange={e => setQuickClusterIds(e.target.value as number[])}
              renderValue={selected => (selected as number[]).map(id => clusters.find(c => c.id === id)?.display_name || clusters.find(c => c.id === id)?.name || `集群${id}`).join(', ')}
            >
              {clusters.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  <Checkbox checked={quickClusterIds.includes(c.id)} />
                  <ListItemText primary={c.display_name || c.name} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setQuickDialogOpen(false)} sx={{ textTransform: 'none' }}>取消</Button>
          <Button variant="contained" onClick={handleConfirmQuickInspect}>
            开始巡检
          </Button>
        </DialogActions>
      </Dialog>

      {/* 任务编辑弹窗 */}
      <Dialog open={taskDialog} onClose={() => setTaskDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>{editingTask ? '编辑巡检任务' : '新建巡检任务'}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="任务名称" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} fullWidth required />
            <TextField label="描述" value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} fullWidth multiline rows={2} />

            <FormControl fullWidth>
              <InputLabel>执行方式</InputLabel>
              <Select value={form.schedule_type || 'manual'} label="执行方式" onChange={e => setForm({ ...form, schedule_type: e.target.value as string })}>
                {schedulePresets.map(p => (
                  <MenuItem key={p.label} value={p.label}>{p.label}</MenuItem>
                ))}
                <MenuItem value="custom">自定义 Cron</MenuItem>
              </Select>
            </FormControl>

            {(form.schedule_type === 'custom' || (form.schedule_type && !schedulePresets.some(p => p.label === form.schedule_type))) && (
              <TextField label="Cron 表达式" placeholder="0 0 9 * * *" value={form.schedule || ''} onChange={e => setForm({ ...form, schedule: e.target.value })} fullWidth helperText="秒 分 时 日 月 周（标准 6 位 Cron）" />
            )}

            <FormControl fullWidth>
              <InputLabel>关联集群</InputLabel>
              <Select
                multiple
                value={form.cluster_ids || []}
                label="关联集群"
                onChange={e => setForm({ ...form, cluster_ids: e.target.value as number[] })}
                renderValue={selected => (selected as number[]).map(id => clusters.find(c => c.id === id)?.display_name || clusters.find(c => c.id === id)?.name || '').filter(Boolean).join(', ')}
              >
                {clusters.map(c => (
                  <MenuItem key={c.id} value={c.id}>
                    <Checkbox checked={(form.cluster_ids || []).includes(c.id)} />
                    <ListItemText primary={c.display_name || c.name} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField label="重试次数" type="number" value={form.retry_times ?? 0} onChange={e => setForm({ ...form, retry_times: parseInt(e.target.value) || 0 })} fullWidth />

            <FormControl fullWidth>
              <InputLabel>状态</InputLabel>
              <Select value={form.enabled ? 'true' : 'false'} label="状态" onChange={e => setForm({ ...form, enabled: e.target.value === 'true' })}>
                <MenuItem value="true">启用</MenuItem>
                <MenuItem value="false">停用</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setTaskDialog(false)} sx={{ textTransform: 'none' }}>取消</Button>
          <Button variant="contained" onClick={handleSaveTask}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 报告详情弹窗 */}
      <Dialog open={reportDialog} onClose={() => setReportDialog(false)} maxWidth={false} fullWidth PaperProps={{ sx: { width: '95vw', maxWidth: '1400px' } }}>
        <DialogTitle sx={{ fontWeight: 600 }}>
          巡检报告 #{selectedJob?.job.id}
          {selectedJob && selectedJob.job.status === 'running' && (
            <Chip label="生成中..." size="small" sx={{ ml: 1 }} color="warning" />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {selectedJob ? (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  触发方式: {selectedJob.job.trigger_type === 'manual' ? '手动' : '定时'} 
                  &nbsp;|&nbsp; 集群数: {selectedJob.job.total_clusters} 
                  &nbsp;|&nbsp; 成功: {selectedJob.job.success_count} 
                  &nbsp;|&nbsp; 失败: {selectedJob.job.failed_count}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" variant="outlined" onClick={() => setReportDialog(false)}>关闭</Button>
                </Box>
              </Box>

              {selectedJob.results.length === 0 ? (
                <Alert severity="info" sx={{ mt: 1 }}>
                  报告尚未生成完成，请稍等 3-5 秒后刷新执行记录再试。
                </Alert>
              ) : (
                selectedJob.results.map(r => {
                  const reportRef = React.createRef<HTMLDivElement>()
                  return (
                    <Card key={r.id} sx={{ mb: 2 }}>
                      <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                          <Typography variant="subtitle1" fontWeight={600}>
                            {clusters.find(c => c.id === r.cluster_id)?.display_name || clusters.find(c => c.id === r.cluster_id)?.name || `集群 ${r.cluster_id}`}
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip label={`评分 ${r.score}`} color={r.score >= 90 ? 'success' : r.score >= 70 ? 'warning' : 'error'} size="small" />
                            {r.report_html && (
                              <>
                                <Button size="small" variant="outlined" onClick={() => {
                                  const blob = new Blob([r.report_html!], { type: 'text/html' })
                                  const url = URL.createObjectURL(blob)
                                  const a = document.createElement('a')
                                  a.href = url
                                  a.download = `report-job${selectedJob.job.id}-cluster${r.cluster_id}.html`
                                  a.click()
                                  URL.revokeObjectURL(url)
                                }}>
                                  HTML
                                </Button>
                                <Button size="small" variant="outlined" onClick={async () => {
                                  if (reportRef.current) {
                                    const html2pdf = (await import('html2pdf.js')).default
                                    html2pdf().set({
                                      margin: 10,
                                      filename: `report-job${selectedJob.job.id}-cluster${r.cluster_id}.pdf`,
                                      image: { type: 'jpeg', quality: 0.98 },
                                      html2canvas: { scale: 2, useCORS: true },
                                      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                                    }).from(reportRef.current).save()
                                  }
                                }}>
                                  PDF
                                </Button>
                              </>
                            )}
                            {r.report_markdown && (
                              <Button size="small" variant="outlined" onClick={() => {
                                const blob = new Blob([r.report_markdown!], { type: 'text/markdown' })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement('a')
                                a.href = url
                                a.download = `report-job${selectedJob.job.id}-cluster${r.cluster_id}.md`
                                a.click()
                                URL.revokeObjectURL(url)
                              }}>
                                MD
                              </Button>
                            )}
                          </Box>
                        </Box>
                        {r.error_msg ? (
                          <Alert severity="error" sx={{ mt: 1 }}>{r.error_msg}</Alert>
                        ) : r.report_html ? (
                          <Box
                            ref={reportRef}
                            sx={{
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              p: 2,
                              bgcolor: 'background.paper',
                            }}
                            dangerouslySetInnerHTML={{ __html: r.report_html }}
                          />
                        ) : (
                          <TableContainer component={Paper} sx={{ background: 'transparent', boxShadow: 'none' }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>检查项</TableCell>
                                  <TableCell>状态</TableCell>
                                  <TableCell>实际值</TableCell>
                                  <TableCell>说明</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {(Array.isArray(r.findings) ? r.findings : []).map((f: any, idx: number) => (
                                  <TableRow key={idx}>
                                    <TableCell>{f.name}</TableCell>
                                    <TableCell>
                                      <Chip
                                        label={f.level}
                                        size="small"
                                        color={f.level === 'pass' ? 'success' : f.level === 'warning' ? 'warning' : f.level === 'critical' ? 'error' : 'default'}
                                      />
                                    </TableCell>
                                    <TableCell>{String(f.actual ?? '-')}</TableCell>
                                    <TableCell>{f.message}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                      </CardContent>
                    </Card>
                  )
                })
              )}
            </Box>
          ) : (
            <CircularProgress />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setReportDialog(false)} sx={{ textTransform: 'none' }}>关闭</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="删除巡检任务"
        message="确定删除该巡检任务吗？"
        onClose={() => setConfirmOpen(false)}
        onConfirm={doDeleteTask}
      />
    </Box>
  )
}
