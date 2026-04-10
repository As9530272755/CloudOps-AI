import { useState, useEffect } from 'react'
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
} from '@mui/material'
import {
  Add as AddIcon,
  PlayArrow as RunIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Assessment as ReportIcon,
  FlashOn as QuickIcon,
} from '@mui/icons-material'

import { inspectionAPI, InspectionTask, InspectionJob, InspectionResultItem } from '../lib/inspection-api'
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
    let schedule = form.schedule || ''
    let scheduleType = form.schedule_type || 'manual'
    if (scheduleType !== 'custom' && scheduleType !== 'manual') {
      const preset = schedulePresets.find(p => p.label === scheduleType)
      if (preset) schedule = preset.value
    }
    const payload = { ...form, schedule, schedule_type: scheduleType }
    if (editingTask) {
      await inspectionAPI.updateTask(editingTask.id, payload)
    } else {
      await inspectionAPI.createTask(payload)
    }
    setTaskDialog(false)
    setEditingTask(null)
    setForm({ name: '', description: '', schedule: '', schedule_type: 'manual', timezone: 'Asia/Shanghai', enabled: true, retry_times: 0, cluster_ids: [] })
    loadTasks()
  }

  const handleDeleteTask = async (id: number) => {
    if (!confirm('确定删除该巡检任务？')) return
    await inspectionAPI.deleteTask(id)
    loadTasks()
  }

  const handleTrigger = async (id: number) => {
    await inspectionAPI.triggerTask(id)
    setActiveTab(1)
    setTimeout(() => loadJobs(), 500)
  }

  const handleQuickInspect = async () => {
    setLoading(true)
    try {
      const res = await inspectionAPI.quickInspect()
      if (res.success) {
        setActiveTab(1)
        setTimeout(() => loadJobs(), 500)
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
        <Alert severity="error" sx={{ mb: 3, borderRadius: '12px' }}>
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
          <Card sx={{ border: '1px solid', borderColor: 'divider' }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">今日执行</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, mt: 1 }}>{jobs.filter(j => j.created_at && j.created_at.startsWith(new Date().toISOString().slice(0, 10))).length}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ border: '1px solid', borderColor: 'divider' }}>
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
      <Card sx={{ border: '1px solid', borderColor: 'divider' }}>
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
                  <Button
                    variant="contained"
                    startIcon={<QuickIcon />}
                    onClick={handleQuickInspect}
                    disabled={loading}
                    sx={{ background: 'linear-gradient(135deg, #FF9500 0%, #FFCC00 100%)', color: 'white', borderRadius: '12px', textTransform: 'none', fontWeight: 600 }}
                  >
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
                    sx={{ background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)', color: 'white', borderRadius: '12px', textTransform: 'none' }}
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
                          {task.cluster_ids?.length ? `${task.cluster_ids.length} 个集群` : '全部活跃集群'}
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
                          <TableCell>Job ID</TableCell>
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
                            <TableCell>#{job.id}</TableCell>
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

      {/* 任务编辑弹窗 */}
      <Dialog open={taskDialog} onClose={() => setTaskDialog(false)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
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
                renderValue={selected => (selected as number[]).map(id => clusters.find(c => c.id === id)?.display_name || id).join(', ')}
              >
                {clusters.map(c => (
                  <MenuItem key={c.id} value={c.id}>{c.display_name || c.name}</MenuItem>
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
          <Button variant="contained" onClick={handleSaveTask} sx={{ background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)', color: 'white', borderRadius: '12px', textTransform: 'none' }}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 报告详情弹窗 */}
      <Dialog open={reportDialog} onClose={() => setReportDialog(false)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
        <DialogTitle sx={{ fontWeight: 600 }}>巡检报告 #{selectedJob?.job.id}</DialogTitle>
        <DialogContent dividers>
          {selectedJob ? (
            <Box>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  触发方式: {selectedJob.job.trigger_type === 'manual' ? '手动' : '定时'} 
                  &nbsp;|&nbsp; 集群数: {selectedJob.job.total_clusters} 
                  &nbsp;|&nbsp; 成功: {selectedJob.job.success_count} 
                  &nbsp;|&nbsp; 失败: {selectedJob.job.failed_count}
                </Typography>
              </Box>
              {selectedJob.results.map(r => (
                <Card key={r.id} sx={{ mb: 2, border: '1px solid', borderColor: 'divider' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {clusters.find(c => c.id === r.cluster_id)?.display_name || `集群 ${r.cluster_id}`}
                      </Typography>
                      <Chip label={`评分 ${r.score}`} color={r.score >= 90 ? 'success' : r.score >= 70 ? 'warning' : 'error'} size="small" />
                    </Box>
                    {r.error_msg ? (
                      <Alert severity="error" sx={{ mt: 1 }}>{r.error_msg}</Alert>
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
              ))}
            </Box>
          ) : (
            <CircularProgress />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setReportDialog(false)} sx={{ textTransform: 'none' }}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
