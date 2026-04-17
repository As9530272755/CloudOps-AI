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

  // 流式对话 (SSE)
  chatStream: (messages: Message[], onMessage: (chunk: { content?: string; done?: boolean; error?: string }) => void, sessionId?: string, platformId?: string) => {
    const token = localStorage.getItem('access_token')
    const controller = new AbortController()

    if (!token) {
      onMessage({ error: '登录状态已过期，请重新登录' })
      return () => controller.abort()
    }

    let receivedContent = false

    fetch(`${api.defaults.baseURL}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ messages, session_id: sessionId, platform_id: platformId }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const text = await response.text()
        onMessage({ error: `HTTP ${response.status}: ${text}` })
        return
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) {
        onMessage({ error: '无法读取响应流' })
        return
      }

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim()
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
        if (done) break
      }
      buffer += decoder.decode(undefined, { stream: false })
      if (buffer.trim()) {
        const line = buffer.trim()
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') {
            onMessage({ done: true })
          } else {
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
      onMessage({ done: true })
    }).catch((err) => {
      if (err.name === 'AbortError' || (err.message && /aborted/i.test(err.message))) {
        return
      }
      // 如果已经收到内容，则把网络错误降级为正常结束，避免用户看到完整回复的同时顶部还飘错误
      if (receivedContent) {
        onMessage({ done: true })
        return
      }
      onMessage({ error: err.message || '请求失败' })
    })

    return () => controller.abort()
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
