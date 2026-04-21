import { apiClient as api } from './api'

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_calls?: any[]
  tool_call_id?: string
}

export interface AgentEvent {
  type: 'text' | 'thinking' | 'tool_start' | 'tool_end' | 'error' | 'done'
  content?: string
  error_code?: string
  tool?: string
  input?: string
  output?: string
  done?: boolean
}

export interface ChatResult {
  success: boolean
  data?: { content: string }
  error?: string
}

export interface TaskStatus {
  id: string
  status: 'running' | 'completed' | 'failed'
  result: string
  error?: string
  updated_at: string
}

export const aiChatAPI = {
  // 非流式对话
  chat: async (messages: Message[], sessionId?: string, platformId?: string) => {
    const response = await api.post('/ai/chat', { messages, session_id: sessionId, platform_id: platformId })
    return response.data as ChatResult
  },

  // 流式对话 (SSE) — 使用 XMLHttpRequest 保证兼容性和可靠性
  chatStream: (messages: Message[], onMessage: (chunk: { content?: string; done?: boolean; error?: string; error_code?: string }) => void, sessionId?: string, platformId?: string) => {
    const token = localStorage.getItem('access_token')

    if (!token) {
      onMessage({ error: '登录状态已过期，请重新登录' })
      return () => {}
    }

    let aborted = false
    let lastProcessedIndex = 0
    let receivedContent = false

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${api.defaults.baseURL}/ai/chat/stream`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    const processChunk = () => {
      if (aborted) return
      const raw = xhr.responseText || ''
      const chunk = raw.slice(lastProcessedIndex)
      lastProcessedIndex = raw.length
      if (!chunk) return

      const lines = chunk.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') {
            onMessage({ done: true })
            continue
          }
          try {
            const parsed = JSON.parse(data)
            if (parsed.content) receivedContent = true
            onMessage(parsed)
          } catch {
            // ignore invalid json
          }
        }
      }
    }

    xhr.onprogress = processChunk

    xhr.onload = () => {
      processChunk()
      if (xhr.status >= 200 && xhr.status < 300) {
        onMessage({ done: true })
      } else {
        if (receivedContent) {
          onMessage({ done: true })
        } else {
          onMessage({ error: `HTTP ${xhr.status}: ${xhr.responseText}` })
        }
      }
    }

    xhr.onerror = () => {
      if (receivedContent) {
        onMessage({ done: true })
      } else {
        onMessage({ error: '网络请求失败' })
      }
    }

    xhr.onabort = () => {}

    xhr.send(JSON.stringify({ messages, session_id: sessionId, platform_id: platformId }))

    return () => {
      aborted = true
      xhr.abort()
    }
  },

  // Agent 流式对话 (SSE)
  agentChatStream: (messages: Message[], onEvent: (ev: AgentEvent) => void, sessionId?: string, platformId?: string) => {
    const token = localStorage.getItem('access_token')

    if (!token) {
      onEvent({ type: 'error', content: '登录状态已过期，请重新登录' })
      return () => {}
    }

    const backendBase = `${window.location.protocol}//${window.location.hostname}:9000/api/v1`
    let aborted = false
    let lastProcessedIndex = 0

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${backendBase}/ai/agent/chat/stream`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    const processChunk = () => {
      if (aborted) return
      const raw = xhr.responseText || ''
      const chunk = raw.slice(lastProcessedIndex)
      lastProcessedIndex = raw.length
      if (!chunk) return

      const lines = chunk.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') {
            onEvent({ type: 'done', done: true })
            continue
          }
          try {
            const parsed = JSON.parse(data) as AgentEvent
            onEvent(parsed)
          } catch {
            // ignore invalid json
          }
        }
      }
    }

    xhr.onprogress = processChunk

    xhr.onload = () => {
      processChunk()
      if (xhr.status >= 200 && xhr.status < 300) {
        onEvent({ type: 'done', done: true })
      } else {
        onEvent({ type: 'error', content: `HTTP ${xhr.status}: ${xhr.responseText}` })
        onEvent({ type: 'done', done: true })
      }
    }

    xhr.onerror = () => {
      onEvent({ type: 'error', content: '网络请求失败' })
      onEvent({ type: 'done', done: true })
    }

    xhr.onabort = () => {}

    xhr.send(JSON.stringify({ messages, session_id: sessionId, platform_id: platformId }))

    return () => {
      aborted = true
      xhr.abort()
    }
  },

  // 异步任务
  createTask: async (messages: Message[], sessionId?: string) => {
    const response = await api.post('/ai/chat/task', { messages, session_id: sessionId })
    return response.data as { success: boolean; data?: { task_id: string; status: string }; error?: string }
  },

  pollTask: async (taskId: string) => {
    const response = await api.get(`/ai/chat/task/${taskId}`)
    return response.data as { success: boolean; data?: TaskStatus; error?: string }
  },
}
