import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Typography,
  TextField,
  IconButton,
  Paper,
  Avatar,
  Alert,
  CircularProgress,
  Button,
} from '@mui/material'
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as UserIcon,
  Clear as ClearIcon,
  Image as ImageIcon,
  Close as CloseIcon,
} from '@mui/icons-material'
import ReactMarkdown from 'react-markdown'
import { aiChatAPI, Message } from '../lib/ai-chat-api'

interface ChatMessage extends Message {
  id: string
  loading?: boolean
  images?: string[]
}

function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

function compressImage(file: File, maxWidth = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let width = img.width
      let height = img.height
      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width))
        width = maxWidth
      }
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas context not available'))
        return
      }
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    const reader = new FileReader()
    reader.onload = (e) => {
      img.src = e.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function ContentBlock({ content }: { content: string }) {
  return (
    <Box
      sx={{
        '& p': { m: 0, mb: 1 },
        '& p:last-child': { mb: 0 },
        '& ul, & ol': { pl: 2, m: 0, mb: 1 },
        '& li': { mb: 0.5 },
        '& h1, & h2, & h3, & h4, & h5, & h6': { mt: 1, mb: 1, fontWeight: 600 },
        '& a': { color: 'primary.main' },
        '& blockquote': {
          borderLeft: '4px solid',
          borderColor: 'divider',
          pl: 1,
          ml: 0,
          color: 'text.secondary',
        },
        '& table': { borderCollapse: 'collapse', width: '100%' },
        '& th, & td': { border: '1px solid', borderColor: 'divider', p: 0.5 },
        '& pre': { m: 0 },
      }}
    >
      <ReactMarkdown
        components={{
          code({ inline, className, children, ...props }: any) {
            if (inline) {
              return (
                <code
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.05)',
                    padding: '2px 4px',
                    borderRadius: 4,
                    fontFamily: 'monospace',
                    fontSize: '0.9em',
                  }}
                  className={className}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <Box
                component="pre"
                sx={{
                  backgroundColor: '#1e1e1e',
                  color: '#d4d4d4',
                  p: 1.5,
                  borderRadius: 1,
                  overflowX: 'auto',
                  fontFamily: 'monospace',
                  fontSize: 13,
                  my: 1,
                }}
              >
                <code className={className} {...props}>
                  {children}
                </code>
              </Box>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
}

function buildSendMessages(msgs: ChatMessage[]): Message[] {
  const system = msgs.find((m) => m.role === 'system')
  const rest = msgs
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'user' && m.images && m.images.length > 0) {
        return {
          role: m.role,
          content: m.content,
          images: m.images,
        }
      }
      return { role: m.role, content: m.content }
    })
  return system ? [{ role: 'system', content: system.content }, ...rest] : rest
}

export default function AI() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('cloudops-ai-messages')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {
        return []
      }
    }
    return [
      {
        id: generateId(),
        role: 'system',
        content:
          '你是 CloudOps 平台的 AI 运维助手，精通 Kubernetes、Docker、Prometheus 等云原生技术。请用中文简洁准确地回答用户问题。',
      },
      {
        id: generateId(),
        role: 'assistant',
        content:
          '你好！我是 CloudOps AI 助手，可以帮你解答 Kubernetes 运维、故障排查、配置优化等问题。你想了解什么？',
      },
    ]
  })
  const [sessionId, setSessionId] = useState<string>(() => {
    const saved = localStorage.getItem('cloudops-ai-session-id')
    if (saved) return saved
    const fresh = generateId()
    localStorage.setItem('cloudops-ai-session-id', fresh)
    return fresh
  })
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const abortRef = useRef<(() => void) | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const toStore = messages.slice(-50).map((m) => ({
      ...m,
      images: undefined,
    }))
    try {
      localStorage.setItem('cloudops-ai-messages', JSON.stringify(toStore))
    } catch {
      // localStorage quota exceeded; silently ignore
    }
  }, [messages])

  useEffect(() => {
    localStorage.setItem('cloudops-ai-session-id', sessionId)
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  useEffect(() => {
    return () => {
      abortRef.current?.()
    }
  }, [])

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (streaming) return
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            const reader = new FileReader()
            reader.onload = (ev) => {
              const result = ev.target?.result as string
              if (result) setPendingImages((prev) => [...prev, result])
            }
            reader.readAsDataURL(file)
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [streaming])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        try {
          const compressed = await compressImage(file)
          setPendingImages((prev) => (prev.length >= 3 ? prev : [...prev, compressed]))
        } catch {
          // ignore compression errors
        }
      }
    }
    e.target.value = ''
  }

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || streaming) return
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: input.trim(),
      images: [...pendingImages],
    }
    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      loading: true,
    }
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setPendingImages([])
    setStreaming(true)
    setError('')

    const sendMessages = buildSendMessages([...messages, userMsg])

    // 创建异步任务
    const createRes = await aiChatAPI.createTask(sendMessages, sessionId)
    if (!createRes.success || !createRes.data) {
      setError(createRes.error || '创建任务失败')
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, loading: false } : m))
      )
      setStreaming(false)
      return
    }

    const taskId = createRes.data.task_id

    // 轮询任务状态
    const intervalId = setInterval(async () => {
      try {
        const pollRes = await aiChatAPI.pollTask(taskId)
        if (!pollRes.success || !pollRes.data) {
          clearInterval(intervalId)
          setError(pollRes.error || '轮询任务失败')
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, loading: false } : m))
          )
          setStreaming(false)
          return
        }

        const task = pollRes.data
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsg.id) return m
            return {
              ...m,
              content: task.result,
              loading: task.status === 'running',
            }
          })
        )

        if (task.status === 'completed') {
          clearInterval(intervalId)
          setStreaming(false)
        } else if (task.status === 'failed') {
          clearInterval(intervalId)
          setError(task.error || 'AI 分析失败')
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, loading: false } : m))
          )
          setStreaming(false)
        }
      } catch (err: any) {
        clearInterval(intervalId)
        setError(err.message || '轮询异常')
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, loading: false } : m))
        )
        setStreaming(false)
      }
    }, 2000)

    abortRef.current = () => clearInterval(intervalId)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    if (confirm('确定要清空当前对话吗？')) {
      setMessages((prev) => prev.filter((m) => m.role === 'system'))
      localStorage.removeItem('cloudops-ai-messages')
      const newSession = generateId()
      setSessionId(newSession)
      localStorage.setItem('cloudops-ai-session-id', newSession)
    }
  }

  return (
    <Box sx={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          AI 助手
        </Typography>
        <Button startIcon={<ClearIcon />} onClick={handleClear} color="inherit">
          清空对话
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      <Paper
        elevation={0}
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 2,
          mb: 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '16px',
          backgroundColor: (theme) => theme.palette.background.default,
        }}
      >
        {messages
          .filter((m) => m.role !== 'system')
          .map((msg) => (
            <Box
              key={msg.id}
              sx={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                mb: 2,
              }}
            >
              {msg.role === 'assistant' && (
                <Avatar sx={{ bgcolor: 'primary.main', mr: 1, width: 32, height: 32 }}>
                  <BotIcon sx={{ fontSize: 18 }} />
                </Avatar>
              )}
              <Box
                sx={{
                  maxWidth: '80%',
                  p: 2,
                  borderRadius: '16px',
                  backgroundColor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                  color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                  border: msg.role === 'user' ? 'none' : '1px solid',
                  borderColor: 'divider',
                }}
              >
                {msg.images && msg.images.length > 0 && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1 }}>
                    {msg.images.map((src, idx) => (
                      <Box
                        key={idx}
                        component="img"
                        src={src}
                        sx={{
                          maxWidth: 240,
                          maxHeight: 160,
                          borderRadius: 1,
                          objectFit: 'cover',
                        }}
                      />
                    ))}
                  </Box>
                )}
                {msg.loading && !msg.content ? (
                  <CircularProgress size={20} sx={{ color: 'text.secondary' }} />
                ) : (
                  <ContentBlock content={msg.content} />
                )}
              </Box>
              {msg.role === 'user' && (
                <Avatar sx={{ bgcolor: 'secondary.main', ml: 1, width: 32, height: 32 }}>
                  <UserIcon sx={{ fontSize: 18 }} />
                </Avatar>
              )}
            </Box>
          ))}
        <div ref={bottomRef} />
      </Paper>

      {pendingImages.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          {pendingImages.map((src, idx) => (
            <Box key={idx} sx={{ position: 'relative' }}>
              <Box
                component="img"
                src={src}
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: 1,
                  objectFit: 'cover',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              />
              <IconButton
                size="small"
                onClick={() => removePendingImage(idx)}
                sx={{
                  position: 'absolute',
                  top: -8,
                  right: -8,
                  bgcolor: 'background.paper',
                  boxShadow: 1,
                  width: 20,
                  height: 20,
                }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          ref={fileInputRef}
          onChange={handleFileChange}
        />
        <IconButton
          onClick={() => fileInputRef.current?.click()}
          disabled={streaming}
          sx={{
            width: 48,
            height: 48,
            borderRadius: '14px',
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <ImageIcon />
        </IconButton>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          placeholder="输入问题，Shift+Enter 换行，Enter 发送；支持 Ctrl+V 粘贴截图..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '16px',
              backgroundColor: 'background.paper',
            },
          }}
        />
        <IconButton
          color="primary"
          onClick={handleSend}
          disabled={(!input.trim() && pendingImages.length === 0) || streaming}
          sx={{
            width: 48,
            height: 48,
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
            color: 'white',
            '&:hover': {
              background: 'linear-gradient(135deg, #005BB5 0%, #3BAFDA 100%)',
            },
            '&.Mui-disabled': {
              background: 'rgba(0,0,0,0.12)',
              color: 'rgba(0,0,0,0.26)',
            },
          }}
        >
          {streaming ? <CircularProgress size={20} sx={{ color: 'white' }} /> : <SendIcon />}
        </IconButton>
      </Box>
    </Box>
  )
}
