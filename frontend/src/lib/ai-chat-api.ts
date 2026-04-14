import { apiClient as api } from './api'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
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
  chat: async (messages: Message[], sessionId?: string) => {
    const response = await api.post('/ai/chat', { messages, session_id: sessionId })
    return response.data as ChatResult
  },

  // 流式对话 (SSE)
  chatStream: (messages: Message[], onMessage: (chunk: { content?: string; done?: boolean; error?: string }) => void, sessionId?: string) => {
    const token = localStorage.getItem('access_token')
    const controller = new AbortController()

    if (!token) {
      onMessage({ error: '登录状态已过期，请重新登录' })
      return () => controller.abort()
    }

    fetch(`${api.defaults.baseURL}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ messages, session_id: sessionId }),
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
        if (done) break
        buffer += decoder.decode(value, { stream: true })
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
              onMessage(parsed)
            } catch {
              // ignore invalid json
            }
          }
        }
      }
      // 处理可能残留的最后一行
      if (buffer.trim()) {
        const line = buffer.trim()
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') {
            onMessage({ done: true })
          } else {
            try {
              const parsed = JSON.parse(data)
              onMessage(parsed)
            } catch {
              // ignore invalid json
            }
          }
        }
      }
      onMessage({ done: true })
    }).catch((err) => {
      onMessage({ error: err.message || '请求失败' })
    })

    return () => controller.abort()
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
