import { useEffect, useState } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material'
import { Psychology as AIIcon } from '@mui/icons-material'
import { clusterAPI } from '../lib/cluster-api'
import { k8sAPI } from '../lib/k8s-api'
import { aiChatAPI } from '../lib/ai-chat-api'

interface Cluster {
  id: number
  name: string
}

interface PodItem {
  metadata: {
    name: string
    namespace: string
  }
}

export default function Logs() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [clusterId, setClusterId] = useState('')
  const [namespace, setNamespace] = useState('default')
  const [pods, setPods] = useState<PodItem[]>([])
  const [podName, setPodName] = useState('')
  const [logs, setLogs] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [loadingPods, setLoadingPods] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    clusterAPI.getClusters().then((res: any) => {
      if (res.success && res.data) {
        const list = Array.isArray(res.data) ? res.data : res.data.clusters || []
        setClusters(list)
        if (list.length > 0) {
          setClusterId(String(list[0].id))
        }
      }
    })
  }, [])

  useEffect(() => {
    if (!clusterId) return
    setLoadingPods(true)
    k8sAPI.getResources(Number(clusterId), 'pods', namespace)
      .then((res: any) => {
        if (res.success && res.data?.items) {
          setPods(res.data.items)
          setPodName(res.data.items[0]?.metadata?.name || '')
        } else {
          setPods([])
          setPodName('')
        }
      })
      .catch(() => {
        setPods([])
        setPodName('')
      })
      .finally(() => setLoadingPods(false))
  }, [clusterId, namespace])

  const handleAnalyze = async () => {
    if (!logs.trim()) {
      setError('请先输入或粘贴日志内容')
      return
    }
    setAnalyzing(true)
    setError('')
    setAnalysis('')

    const messages = [
      {
        role: 'system' as const,
        content: '你是一位 Kubernetes 运维专家。请分析下面的容器日志，给出：1) 整体状态判断；2) 关键错误/告警提取；3) 排查建议。用中文回答。',
      },
      {
        role: 'user' as const,
        content: `请分析以下日志：\n\n${logs.trim()}`,
      },
    ]

    try {
      const res = await aiChatAPI.chat(messages)
      if (res.success && res.data) {
        setAnalysis(res.data.content)
      } else {
        setError(res.error || '分析失败')
      }
    } catch (err: any) {
      setError(err.message || '分析请求失败')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ mb: 3, border: '1px solid', borderColor: 'divider' }}>
        <CardContent>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            日志管理
          </Typography>
          <Typography variant="body2" color="text.secondary">
            选择集群和 Pod，粘贴日志内容，一键进行 AI 智能分析
          </Typography>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel>集群</InputLabel>
          <Select value={clusterId} label="集群" onChange={(e) => setClusterId(e.target.value)}>
            {clusters.filter((c): c is Cluster => !!c && typeof c.id !== 'undefined' && typeof c.name === 'string').map((c) => (
              <MenuItem key={c.id} value={String(c.id)}>{c.name}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="命名空间"
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          sx={{ minWidth: 160 }}
        />

        <FormControl sx={{ minWidth: 240 }}>
          <InputLabel>Pod</InputLabel>
          <Select
            value={podName}
            label="Pod"
            onChange={(e) => setPodName(e.target.value)}
            disabled={loadingPods}
          >
            {pods.filter((p): p is PodItem => !!p && !!p.metadata && typeof p.metadata.name === 'string').map((p) => (
              <MenuItem key={p.metadata.name} value={p.metadata.name}>
                {p.metadata.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '16px',
        }}
      >
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          日志内容
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={10}
          placeholder="在此粘贴容器日志内容..."
          value={logs}
          onChange={(e) => setLogs(e.target.value)}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '12px',
              fontFamily: 'monospace',
              fontSize: 13,
            },
          }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Button
            variant="contained"
            startIcon={analyzing ? <CircularProgress size={18} sx={{ color: 'white' }} /> : <AIIcon />}
            onClick={handleAnalyze}
            disabled={analyzing || !logs.trim()}
            sx={{
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 600,
              background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
            }}
          >
            {analyzing ? 'AI 分析中...' : 'AI 分析日志'}
          </Button>
        </Box>
      </Paper>

      {analysis && (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '16px',
            backgroundColor: (theme) => theme.palette.background.default,
          }}
        >
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
            🤖 AI 分析结果
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.8,
            }}
          >
            {analysis}
          </Typography>
        </Paper>
      )}
    </Box>
  )
}
