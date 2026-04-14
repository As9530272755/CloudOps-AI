import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
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
import remarkGfm from 'remark-gfm'
import { marked } from 'marked'
import { aiChatAPI, Message } from '../lib/ai-chat-api'

interface ChatMessage extends Message {
  id: string
  loading?: boolean
  images?: string[]
  timestamp?: number
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
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }: any) {
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
                  m: 0,
                }}
              >
                {children}
              </Box>
            )
          },
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
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
}

// 流式消息：使用原生 DOM 增量追加，避免 React 高频重渲染
// 流式期间用 marked 低频率刷新 innerHTML，保证基本 Markdown 格式可见
const StreamingMessage = forwardRef<{ append: (text: string) => void; finalize: () => void }, { className?: string }>(
  function StreamingMessage(_, ref) {
    const divRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<string>('')
    const rafRef = useRef<number | null>(null)

    const render = () => {
      rafRef.current = null
      if (divRef.current) {
        const html = marked.parse(contentRef.current, { async: false, breaks: true, gfm: true }) as string
        divRef.current.innerHTML = html
        divRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }

    useImperativeHandle(ref, () => ({
      append: (text: string) => {
        contentRef.current += text
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(render)
        }
      },
      finalize: () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        render()
      },
    }))
    return (
      <Box
        ref={divRef}
        component="div"
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
          '& pre': {
            backgroundColor: '#1e1e1e',
            color: '#d4d4d4',
            p: 1.5,
            borderRadius: 1,
            overflowX: 'auto',
            fontFamily: 'monospace',
            fontSize: 13,
            my: 1,
            m: 0,
          },
          '& code': {
            backgroundColor: 'rgba(0,0,0,0.05)',
            padding: '2px 4px',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: '0.9em',
          },
        }}
      />
    )
  }
)

function buildSendMessages(msgs: ChatMessage[]): Message[] {
  const system = msgs.find((m) => m.role === 'system')
  // 只保留最近 10 条非 system 消息，防止上下文过长导致 AI 超时
  const rest = msgs
    .filter((m) => m.role !== 'system')
    .slice(-10)
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
    const saved = localStorage.getItem('cloudops-ai-messages-v2')
    if (saved) {
      try {
        const parsed: ChatMessage[] = JSON.parse(saved)
        // 清理流式输出中断后残留的 loading 消息：
        // 有内容的保留为已完成，空内容的直接过滤掉，避免显示"内容未加载完成"
        return parsed
          .map((m) => {
            if (m.role === 'assistant' && m.loading) {
              return { ...m, loading: false }
            }
            return m
          })
          .filter((m) => !(m.role === 'assistant' && !m.content))
      } catch {
        return []
      }
    }
    return [
      {
        id: generateId(),
        role: 'system',
        content: '请用中文简洁准确地回答用户问题。',
        timestamp: Date.now(),
      },
      {
        id: generateId(),
        role: 'assistant',
        content: '你好！有什么可以帮你的吗？',
        timestamp: Date.now(),
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
  const textFieldRef = useRef<HTMLTextAreaElement>(null)
  const streamingMsgRef = useRef<{ append: (text: string) => void; finalize: () => void } | null>(null)
  const streamingContentRef = useRef<string>('')
  const sendingRef = useRef(false)

  useEffect(() => {
    const toStore = messages.slice(-50).map((m) => ({
      ...m,
      images: undefined,
    }))
    try {
      localStorage.setItem('cloudops-ai-messages-v2', JSON.stringify(toStore))
    } catch {
      // localStorage quota exceeded; silently ignore
    }
  }, [messages])

  useEffect(() => {
    localStorage.setItem('cloudops-ai-session-id', sessionId)
  }, [sessionId])

  // 清理旧版消息缓存
  useEffect(() => {
    localStorage.removeItem('cloudops-ai-messages')
  }, [])

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
    if ((!input.trim() && pendingImages.length === 0) || streaming || sendingRef.current) return
    sendingRef.current = true
    const now = Date.now()
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: input.trim(),
      images: [...pendingImages],
      timestamp: now,
    }
    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: now,
    }
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setPendingImages([])
    setStreaming(true)
    setError('')

    const sendMessages = buildSendMessages([...messages, userMsg])

    streamingContentRef.current = ''
    streamingMsgRef.current = null

    let lastChunkAt = Date.now()

    const safetyTimer = window.setTimeout(() => {
      if (Date.now() - lastChunkAt > 55000) {
        streamingMsgRef.current?.finalize()
        const finalContent = streamingContentRef.current
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: finalContent, loading: false } : m))
        )
        setError('请求超时，请稍后重试')
        setStreaming(false)
        streamingContentRef.current = ''
        streamingMsgRef.current = null
        abort()
      }
    }, 60000)

    let hasEnded = false
    const abort = aiChatAPI.chatStream(sendMessages, (chunk) => {
      if (hasEnded) return
      lastChunkAt = Date.now()
      if (chunk.error) {
        hasEnded = true
        clearTimeout(safetyTimer)
        streamingMsgRef.current?.finalize()
        const finalContent = streamingContentRef.current
        console.error('[AI Stream] error:', chunk.error, 'finalContent length:', finalContent.length)
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: finalContent, loading: false } : m))
        )
        setError(chunk.error)
        setStreaming(false)
        streamingContentRef.current = ''
        streamingMsgRef.current = null
        return
      }
      if (chunk.content) {
        streamingContentRef.current += chunk.content
        streamingMsgRef.current?.append(chunk.content)
      }
      if (chunk.done) {
        hasEnded = true
        clearTimeout(safetyTimer)
        streamingMsgRef.current?.finalize()
        const finalContent = streamingContentRef.current
        console.log('[AI Stream] done. finalContent length:', finalContent.length)
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: finalContent, loading: false } : m))
        )
        setStreaming(false)
        streamingContentRef.current = ''
        streamingMsgRef.current = null
      }
    }, sessionId)

    abortRef.current = () => {
      clearTimeout(safetyTimer)
      abort()
    }

    sendingRef.current = false
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      handleSend()
      return
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const el = textFieldRef.current
      if (!el) return
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      const newValue = input.slice(0, start) + '\n' + input.slice(end)
      setInput(newValue)
      // restore cursor after the inserted newline
      setTimeout(() => {
        el.selectionStart = el.selectionEnd = start + 1
      }, 0)
    }
  }

  const handleClear = () => {
    if (confirm('确定要清空当前对话吗？')) {
      setMessages((prev) => prev.filter((m) => m.role === 'system'))
      localStorage.removeItem('cloudops-ai-messages-v2')
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
                alignItems: 'flex-start',
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
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                }}
              >
                <Box
                  sx={{
                    p: 2,
                    borderRadius: '16px',
                    backgroundColor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                    color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                    border: msg.role === 'user' ? 'none' : '1px solid',
                    borderColor: 'divider',
                    wordBreak: 'break-all',
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
                  ) : msg.role === 'user' ? (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {msg.content}
                    </Typography>
                  ) : msg.loading ? (
                    <StreamingMessage ref={streamingMsgRef} />
                  ) : (
                    <ContentBlock content={msg.content} />
                  )}
                </Box>
                {msg.timestamp && (
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', mt: 0.5, fontSize: 11, px: 0.5 }}
                  >
                    {new Date(msg.timestamp).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </Typography>
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
          inputRef={textFieldRef}
          placeholder="输入问题，Ctrl+Enter / Shift+Enter 换行，Enter 发送；支持 Ctrl+V 粘贴截图..."
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
