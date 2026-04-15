import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle, useReducer, memo, useCallback } from 'react'
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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tooltip,
  useTheme,
} from '@mui/material'
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as UserIcon,
  Clear as ClearIcon,
  Image as ImageIcon,
  Close as CloseIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  Edit as EditIcon,
  ArrowDownward as ArrowDownwardIcon,
} from '@mui/icons-material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { marked } from 'marked'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { aiChatAPI, Message } from '../lib/ai-chat-api'
import { aiPlatformAPI, AIPlatform } from '../lib/ai-platform-api'
import { aiSessionAPI, AIChatSession } from '../lib/ai-session-api'

interface ChatMessage extends Message {
  id: string
  loading?: boolean
  images?: string[]
  timestamp?: number
}

function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return
    }
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textArea)
    if (!success) {
      console.error('Copy failed')
    }
  } catch (e) {
    console.error('Copy failed', e)
  }
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

const ContentBlock = memo(function ContentBlock({ content }: { content: string }) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
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
            const codeText = React.Children.toArray(children)
              .map((c: any) => c?.props?.children)
              .join('')
            return (
              <Box sx={{ position: 'relative', my: 1 }}>
                <IconButton
                  size="small"
                  onClick={() => copyToClipboard(codeText)}
                  sx={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    color: isDark ? '#ccc' : '#333',
                    bgcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.7)',
                    '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.9)' },
                    zIndex: 1,
                  }}
                >
                  <CopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <Box
                  component="pre"
                  sx={{
                    backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5',
                    color: isDark ? '#d4d4d4' : '#333',
                    p: 1.5,
                    pr: 4,
                    borderRadius: 1,
                    overflowX: 'auto',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    m: 0,
                  }}
                >
                  {children}
                </Box>
              </Box>
            )
          },
          code({ inline, className, children, ...props }: any) {
            if (inline) {
              return (
                <code
                  style={{
                    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
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
          table({ children }: any) {
            return (
              <Box sx={{ overflowX: 'auto', my: 1 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>{children}</table>
              </Box>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
})

const StreamingMessage = forwardRef<{ append: (text: string) => void; finalize: () => void }, { className?: string }>(
  function StreamingMessage(_, ref) {
    const theme = useTheme()
    const isDark = theme.palette.mode === 'dark'
    const divRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<string>('')
    const textNodeRef = useRef<Text | null>(null)

    useImperativeHandle(ref, () => ({
      append: (text: string) => {
        contentRef.current += text
        if (!divRef.current) return
        if (!textNodeRef.current) {
          divRef.current.innerHTML = ''
          textNodeRef.current = document.createTextNode('')
          divRef.current.appendChild(textNodeRef.current)
        }
        textNodeRef.current.textContent = contentRef.current
        divRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      },
      finalize: () => {
        textNodeRef.current = null
        if (!divRef.current) return
        const html = marked.parse(contentRef.current, { async: false, breaks: true, gfm: true }) as string
        divRef.current.innerHTML = html
        divRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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
            backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5',
            overflowX: 'auto',
            color: isDark ? '#d4d4d4' : '#333',
            p: 1.5,
            borderRadius: 1,
            fontFamily: 'monospace',
            fontSize: 13,
            my: 1,
            m: 0,
          },
          '& code': {
            backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
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

const MessageItem = memo(function MessageItem({ msg, onDelete }: { msg: ChatMessage; onDelete?: (id: string) => void }) {
  return (
    <Box
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
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            p: 2,
            borderRadius: '12px',
            backgroundColor: msg.role === 'user' ? 'secondary.main' : 'background.paper',
            color: msg.role === 'user' ? '#fff' : 'text.primary',
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
            <StreamingMessage />
          ) : (
            <ContentBlock content={msg.content} />
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
          {msg.timestamp && (
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', fontSize: 11, px: 0.5 }}
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
          {msg.role === 'assistant' && !msg.loading && (
            <>
              <Tooltip title="复制">
                <IconButton
                  size="small"
                  onClick={() => copyToClipboard(msg.content)}
                  sx={{ width: 20, height: 20, color: 'text.secondary' }}
                >
                  <CopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除">
                <IconButton
                  size="small"
                  onClick={() => onDelete?.(msg.id)}
                  sx={{ width: 20, height: 20, color: 'text.secondary' }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>
      </Box>
      {msg.role === 'user' && (
        <Avatar sx={{ bgcolor: 'secondary.main', ml: 1, width: 32, height: 32 }}>
          <UserIcon sx={{ fontSize: 18 }} />
        </Avatar>
      )}
    </Box>
  )
})

const ChatInput = memo(function ChatInput({
  disabled,
  onSend,
}: {
  disabled?: boolean
  onSend: (text: string, images: string[]) => void
}) {
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textFieldRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (disabled) return
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
              if (result) setPendingImages((prev) => (prev.length >= 3 ? prev : [...prev, result]))
            }
            reader.readAsDataURL(file)
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [disabled])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        try {
          const compressed = await compressImage(file)
          setPendingImages((prev) => (prev.length >= 3 ? prev : [...prev, compressed]))
        } catch {
          // ignore
        }
      }
    }
    e.target.value = ''
  }

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSend = () => {
    if ((!input.trim() && pendingImages.length === 0) || disabled) return
    onSend(input.trim(), [...pendingImages])
    setInput('')
    setPendingImages([])
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
      setTimeout(() => {
        el.selectionStart = el.selectionEnd = start + 1
      }, 0)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {pendingImages.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
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
          disabled={disabled}
          sx={{
            width: 48,
            height: 48,
            borderRadius: '12px',
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
          disabled={disabled}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '12px',
              backgroundColor: 'background.paper',
            },
          }}
        />
        <IconButton
          color="primary"
          onClick={handleSend}
          disabled={(!input.trim() && pendingImages.length === 0) || disabled}
          sx={{
            width: 48,
            height: 48,
            borderRadius: '12px',
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            '&:hover': {
              bgcolor: 'primary.light',
            },
            '&.Mui-disabled': {
              bgcolor: 'action.disabledBackground',
              color: 'action.disabled',
            },
          }}
        >
          {disabled ? <CircularProgress size={20} sx={{ color: 'white' }} /> : <SendIcon />}
        </IconButton>
      </Box>
    </Box>
  )
})

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
  // 平台与会话状态
  const [platforms, setPlatforms] = useState<AIPlatform[]>([])
  const [sessions, setSessions] = useState<AIChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string>('')
  const [currentPlatformId, setCurrentPlatformId] = useState<string>('')
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editingTitleValue, setEditingTitleValue] = useState('')

  // 消息与输入状态
  const [messages, setMessages] = useState<ChatMessage[]>([
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
  ])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [initLoading, setInitLoading] = useState(true)
  const [atBottom, setAtBottom] = useState(true)

  const abortRef = useRef<(() => void) | null>(null)
  const streamingMsgRef = useRef<{ append: (text: string) => void; finalize: () => void } | null>(null)
  const streamingContentRef = useRef<string>('')
  const sendingRef = useRef(false)
  const currentSessionIdRef = useRef(currentSessionId)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const timerRef = useRef<number | null>(null)
  const pendingRepliesRef = useRef<Record<string, { content: string; loading: boolean; error?: string }>>({})
  const [, forceUpdateSidebar] = useReducer((x: number) => x + 1, 0)

  const savePending = () => {
    sessionStorage.setItem('cloudops-ai-pending-replies', JSON.stringify(pendingRepliesRef.current))
  }
  const loadPending = () => {
    const saved = sessionStorage.getItem('cloudops-ai-pending-replies')
    if (saved) {
      try {
        pendingRepliesRef.current = JSON.parse(saved)
      } catch {
        pendingRepliesRef.current = {}
      }
    }
  }

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  const loadPlatforms = async () => {
    const platRes = await aiPlatformAPI.list()
    const plats = platRes.success && Array.isArray(platRes.data) ? platRes.data : []
    setPlatforms(plats)
    return plats
  }

  const loadSessions = async () => {
    const sessRes = await aiSessionAPI.list()
    const sessList = sessRes.success && Array.isArray(sessRes.data) ? sessRes.data : []
    setSessions(sessList)
    return sessList
  }

  // 初始化：加载平台、会话，并做 localStorage 迁移
  useEffect(() => {
    loadPending()
    const init = async () => {
      setInitLoading(true)
      try {
        const plats = await loadPlatforms()
        const defaultPlat = plats.find((p) => p.is_default) || plats[0]
        if (defaultPlat) {
          setCurrentPlatformId(defaultPlat.id)
        }

        let sessList = await loadSessions()
        let targetSessionId = ''
        let targetPlatformId = defaultPlat?.id || ''

        if (sessList.length === 0 && defaultPlat) {
          const createRes = await aiSessionAPI.create(defaultPlat.id, '新会话')
          if (createRes.success && createRes.data && 'id' in createRes.data) {
            const newSess = createRes.data as AIChatSession
            sessList = await loadSessions()
            targetSessionId = newSess.id
            targetPlatformId = newSess.platform_id

            // 清理旧版本地缓存，不再调用 AI 重新生成
            localStorage.removeItem('cloudops-ai-messages-v2')
            localStorage.removeItem('cloudops-ai-session-id')
          }
        } else if (sessList.length > 0) {
          targetSessionId = sessList[0].id
          targetPlatformId = sessList[0].platform_id
        }

        if (targetSessionId) {
          await switchSession(targetSessionId, targetPlatformId)
        }
      } catch (err: any) {
        console.error('AI init error:', err)
      } finally {
        setInitLoading(false)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切换会话
  const switchSession = async (sessionId: string, platformId?: string) => {
    // 清理当前会话的 timer，但不 abort 后台请求
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    abortRef.current = null
    sendingRef.current = false
    setError('')
    setCurrentSessionId(sessionId)
    if (platformId) {
      setCurrentPlatformId(platformId)
      const plat = platforms.find((p) => p.id === platformId)
      if (plat) {
        setCurrentPlatformId(plat.id)
      }
    } else {
      const session = sessions.find((s) => s.id === sessionId)
      if (session) {
        setCurrentPlatformId(session.platform_id)
      }
    }
    setMessages([
      {
        id: generateId(),
        role: 'system',
        content: '请用中文简洁准确地回答用户问题。',
        timestamp: Date.now(),
      },
    ])
    try {
      const msgRes = await aiSessionAPI.getMessages(sessionId)
      let loaded: ChatMessage[] = [
        {
          id: generateId(),
          role: 'system',
          content: '请用中文简洁准确地回答用户问题。',
          timestamp: Date.now(),
        },
      ]
      if (msgRes.success && Array.isArray(msgRes.data) && msgRes.data.length > 0) {
        loaded = [
          ...loaded,
          ...msgRes.data.map((m) => ({
            id: generateId(),
            role: m.role as ChatMessage['role'],
            content: m.content,
            images: m.images,
            timestamp: Date.now(),
          })),
        ]
        setMessages(loaded)
      } else {
        // 空会话给一个欢迎语
        loaded.push({
          id: generateId(),
          role: 'assistant',
          content: '你好！有什么可以帮你的吗？',
          timestamp: Date.now(),
        })
        setMessages(loaded)
      }

      // 恢复后台仍在生成的 pending 消息
      const pending = pendingRepliesRef.current[sessionId]
      const lastMsg = loaded[loaded.length - 1]

      // 如果服务端已有完整回复，但 pending 还是 loading，说明 pending 已过期
      if (pending && pending.loading && lastMsg?.role === 'assistant' && lastMsg.content) {
        pending.loading = false
        pending.content = lastMsg.content
        pending.error = undefined
        savePending()
        forceUpdateSidebar()
      }

      if (pending && (pending.loading || pending.content || pending.error)) {
        if (!lastMsg || lastMsg.role !== 'assistant') {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content: pending.content,
              loading: pending.loading,
              timestamp: Date.now(),
            },
          ])
        } else if (lastMsg.role === 'assistant' && !lastMsg.content && (pending.content || pending.error)) {
          // 覆盖空欢迎语
          setMessages((prev) => {
            const copy = [...prev]
            copy[copy.length - 1] = { ...copy[copy.length - 1], content: pending.content, loading: pending.loading }
            return copy
          })
        }
        if (pending.loading) {
          setStreaming(true)
          streamingContentRef.current = pending.content
          streamingMsgRef.current = null
        } else if (pending.error) {
          setError(pending.error)
          setStreaming(false)
        } else {
          setStreaming(false)
        }
      } else {
        setStreaming(false)
      }
    } catch (err: any) {
      setError('加载会话消息失败')
    }
  }

  // 新建会话
  const createNewSession = async () => {
    const defaultPlat = platforms.find((p) => p.is_default) || platforms[0]
    const platformId = currentPlatformId || defaultPlat?.id
    if (!platformId) {
      setError('没有可用的 AI 平台，请先在设置中配置')
      return
    }
    try {
      const res = await aiSessionAPI.create(platformId, '新会话')
      if (res.success && res.data && 'id' in res.data) {
        const newSess = res.data as AIChatSession
        await loadSessions()
        await switchSession(newSess.id, newSess.platform_id)
      }
    } catch (err: any) {
      setError('创建会话失败')
    }
  }

  // 编辑会话标题
  const startEditTitle = (s: AIChatSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingTitleId(s.id)
    setEditingTitleValue(s.title || formatSessionTitle(s))
  }
  const saveTitle = async (sessionId: string, e?: React.KeyboardEvent | React.MouseEvent) => {
    if (e && 'key' in e && e.key !== 'Enter') return
    try {
      await aiSessionAPI.updateTitle(sessionId, editingTitleValue)
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: editingTitleValue } : s)))
    } catch (err: any) {
      alert(err.message || '重命名失败')
    }
    setEditingTitleId(null)
    setEditingTitleValue('')
  }

  // 删除会话
  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定要删除此会话吗？')) return
    try {
      await aiSessionAPI.delete(sessionId)
      delete pendingRepliesRef.current[sessionId]
      savePending()
      forceUpdateSidebar()
      const sessList = await loadSessions()
      if (currentSessionId === sessionId) {
        if (sessList.length > 0) {
          await switchSession(sessList[0].id)
        } else {
          await createNewSession()
        }
      }
    } catch (err: any) {
      alert(err.message || '删除失败')
    }
  }

  // 清空当前会话消息
  const handleClearChat = async () => {
    if (!currentSessionId) return
    if (!confirm('确定要清空当前会话的所有消息吗？')) return
    try {
      await aiSessionAPI.clearMessages(currentSessionId)
      setMessages([
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
      ])
    } catch (err: any) {
      setError(err.message || '清空失败')
    }
  }

  // 切换当前会话的平台
  const handlePlatformChange = async (platformId: string) => {
    if (!currentSessionId || platformId === currentPlatformId) return
    setCurrentPlatformId(platformId)
    const plat = platforms.find((p) => p.id === platformId)
    if (plat) {
      // platform changed
    }
    try {
      await aiSessionAPI.updatePlatform(currentSessionId, platformId)
      // 更新本地会话列表中的 platform_id
      setSessions((prev) =>
        prev.map((s) => (s.id === currentSessionId ? { ...s, platform_id: platformId } : s))
      )
    } catch (err: any) {
      setError('切换平台失败: ' + (err.message || '未知错误'))
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      abortRef.current = null
      savePending()
    }
  }, [])

  const handleDeleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const handleSend = async (text: string, images: string[]) => {
    if ((!text.trim() && images.length === 0) || streaming || sendingRef.current) return
    if (!currentPlatformId) {
      setError('没有可用的 AI 平台，请先在设置中配置')
      return
    }
    sendingRef.current = true
    const now = Date.now()
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text.trim(),
      images: [...images],
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
    setStreaming(true)
    setError('')

    // 注册 pending 回复，用于切回时恢复 loading 状态
    pendingRepliesRef.current[currentSessionId] = { content: '', loading: true }
    savePending()
    forceUpdateSidebar()

    const sendMessages = buildSendMessages([...messages, userMsg])

    streamingContentRef.current = ''
    streamingMsgRef.current = null

    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const mySessionId = currentSessionIdRef.current
    const sendStartAt = Date.now()
    let lastContentAt = Date.now()

    const STREAM_MAX_MS = 120_000
    const CONTENT_IDLE_MS = 60_000

    const runWatchdog = () => {
      if (hasEnded) return
      const now = Date.now()
      const idle = now - lastContentAt
      const total = now - sendStartAt
      if (idle > CONTENT_IDLE_MS || total > STREAM_MAX_MS) {
        hasEnded = true
        abort()
        if (timerRef.current) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        if (mySessionId !== currentSessionIdRef.current) {
          const pending = pendingRepliesRef.current[mySessionId]
          if (pending) {
            pending.loading = false
            pending.error = '请求超时，请稍后重试'
            savePending()
            forceUpdateSidebar()
          }
          return
        }
        try {
          streamingMsgRef.current?.finalize()
        } catch (e) {
          // ignore finalize errors
        }
        aiSessionAPI.getMessages(mySessionId).then((res) => {
          if (mySessionId !== currentSessionIdRef.current) return
          if (res.success && Array.isArray(res.data) && res.data.length > 0) {
            const dbMsgs = res.data as any[]
            const lastDbMsg = dbMsgs[dbMsgs.length - 1]
            if (lastDbMsg.role === 'assistant' && lastDbMsg.content) {
              setMessages((prev) => {
                const copy = [...prev]
                const idx = copy.findIndex((m) => m.id === assistantMsg.id)
                if (idx >= 0) {
                  copy[idx] = { ...copy[idx], content: lastDbMsg.content, loading: false }
                } else {
                  copy.push({
                    id: generateId(),
                    role: 'assistant',
                    content: lastDbMsg.content,
                    loading: false,
                    timestamp: Date.now(),
                  })
                }
                return copy
              })
              setStreaming(false)
              streamingContentRef.current = ''
              streamingMsgRef.current = null
              const pending = pendingRepliesRef.current[mySessionId]
              if (pending) {
                pending.loading = false
                pending.content = lastDbMsg.content
                pending.error = undefined
                savePending()
                forceUpdateSidebar()
              }
              return
            }
          }
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: streamingContentRef.current, loading: false } : m))
          )
          setError('请求超时，请稍后重试')
          setStreaming(false)
          streamingContentRef.current = ''
          streamingMsgRef.current = null
          const pending = pendingRepliesRef.current[mySessionId]
          if (pending) {
            pending.loading = false
            pending.error = '请求超时，请稍后重试'
            savePending()
            forceUpdateSidebar()
          }
        })
        return
      }
      timerRef.current = window.setTimeout(runWatchdog, 5000)
    }

    let hasEnded = false
    const abort = aiChatAPI.chatStream(
      sendMessages,
      (chunk) => {
        if (hasEnded) return

        const pending = pendingRepliesRef.current[mySessionId]
        if (pending) {
          if (chunk.error) {
            pending.loading = false
            pending.error = chunk.error
          } else if (chunk.content) {
            pending.content += chunk.content
          } else if (chunk.done) {
            pending.loading = false
          }
          savePending()
          forceUpdateSidebar()
        }

        if (mySessionId !== currentSessionIdRef.current) return

        if (chunk.error) {
          hasEnded = true
          if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
          }
          try {
            streamingMsgRef.current?.finalize()
          } catch (e) {
            // ignore finalize errors
          }
          const finalContent = streamingContentRef.current
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
          lastContentAt = Date.now()
          streamingContentRef.current += chunk.content
          streamingMsgRef.current?.append(chunk.content)
        }
        if (chunk.done) {
          hasEnded = true
          if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
          }
          try {
            streamingMsgRef.current?.finalize()
          } catch (e) {
            // ignore finalize errors
          }
          const finalContent = streamingContentRef.current
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: finalContent, loading: false } : m))
          )
          setStreaming(false)
          streamingContentRef.current = ''
          streamingMsgRef.current = null
        }
      },
      currentSessionId,
      currentPlatformId
    )

    timerRef.current = window.setTimeout(runWatchdog, 5000)
    abortRef.current = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      abort()
    }

    sendingRef.current = false
  }

  const formatSessionTitle = (s: AIChatSession) => {
    if (s.title) return s.title
    const d = new Date(s.updated_at)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <Box sx={{ height: 'calc(100vh - 32px)', display: 'flex', gap: 2, p: 2, overflow: 'hidden' }}>
      {/* 左侧会话列表 */}
      <Paper
        elevation={0}
        sx={{
          width: 260,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<AddIcon />}
            onClick={createNewSession}
            disabled={initLoading || platforms.length === 0}
          >
            新会话
          </Button>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
          {initLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : sessions.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', pt: 4 }}>
              暂无会话
            </Typography>
          ) : (
            sessions.map((s) => (
              <Box
                key={s.id}
                onClick={() => switchSession(s.id)}
                sx={{
                  p: 1.5,
                  mb: 0.5,
                  borderRadius: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: currentSessionId === s.id ? 'action.selected' : 'transparent',
                  '&:hover': { backgroundColor: 'action.hover' },
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  {editingTitleId === s.id ? (
                    <TextField
                      size="small"
                      value={editingTitleValue}
                      onChange={(e) => setEditingTitleValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveTitle(s.id, e)
                        if (e.key === 'Escape') {
                          setEditingTitleId(null)
                          setEditingTitleValue('')
                        }
                      }}
                      onBlur={() => saveTitle(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      sx={{ '& input': { py: 0.3, fontSize: 14 } }}
                    />
                  ) : (
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {formatSessionTitle(s)}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {new Date(s.updated_at).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Typography>
                </Box>
                {(currentSessionId === s.id && streaming) || pendingRepliesRef.current[s.id]?.loading ? (
                  <CircularProgress size={14} sx={{ ml: 1 }} />
                ) : null}
                {editingTitleId !== s.id && (
                  <Tooltip title="重命名">
                    <IconButton
                      size="small"
                      onClick={(e) => startEditTitle(s, e)}
                      sx={{ ml: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title="删除">
                  <IconButton
                    size="small"
                    onClick={(e) => deleteSession(s.id, e)}
                    sx={{ ml: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            ))
          )}
        </Box>
      </Paper>

      {/* 右侧聊天区域 */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* 顶部栏：标题 + 平台选择器 */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', rowGap: 1, pt: 1 }}>
          <Typography variant="h5" fontWeight={600}>
            AI 助手
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>当前平台</InputLabel>
              <Select
                value={currentPlatformId}
                label="当前平台"
                onChange={(e) => handlePlatformChange(e.target.value)}
                disabled={streaming || platforms.length === 0}
              >
                {platforms.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} ({p.provider_type.toUpperCase()})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              startIcon={<ClearIcon />}
              onClick={handleClearChat}
              color="error"
              variant="outlined"
              size="small"
              disabled={!currentSessionId}
            >
              清空会话
            </Button>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Paper
          elevation={0}
          sx={{
            flex: 1,
            overflow: 'hidden',
            p: 2,
            mb: 2,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '12px',
            backgroundColor: (theme) => theme.palette.background.default,
            position: 'relative',
          }}
        >
          <Virtuoso
            ref={virtuosoRef}
            data={messages.filter((m) => m.role !== 'system')}
            itemContent={(_, msg) => <MessageItem msg={msg} onDelete={handleDeleteMessage} />}
            followOutput="auto"
            atBottomStateChange={setAtBottom}
            style={{ height: '100%' }}
          />
          {!atBottom && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1,
              }}
            >
              <Button
                variant="contained"
                size="small"
                startIcon={<ArrowDownwardIcon />}
                onClick={() => {
                  const list = messages.filter((m) => m.role !== 'system')
                  if (list.length === 0) return
                  virtuosoRef.current?.scrollToIndex({
                    index: list.length - 1,
                    align: 'end',
                    behavior: 'smooth',
                  })
                }}
                sx={{
                  borderRadius: 999,
                  px: 2,
                  py: 0.5,
                  boxShadow: 3,
                  textTransform: 'none',
                }}
              >
                回到底部
              </Button>
            </Box>
          )}
        </Paper>

        <ChatInput disabled={streaming || !currentPlatformId} onSend={handleSend} />
      </Box>
    </Box>
  )
}
