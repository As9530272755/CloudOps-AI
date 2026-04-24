export interface ResourceChangeMessage {
  type: string
  cluster_id: number
  kind?: string
  namespace?: string
  name?: string
  action?: string
  status?: string // for cluster_status_change
}

type MessageHandler = (msg: ResourceChangeMessage) => void
type ConnectionState = 'connected' | 'disconnected' | 'connecting'
type StateHandler = (state: ConnectionState) => void

class WsManager {
  private ws: WebSocket | null = null
  private handlers: Set<MessageHandler> = new Set()
  private stateHandlers: Set<StateHandler> = new Set()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 3000
  private maxReconnectDelay = 30000
  private connectionState: ConnectionState = 'disconnected'

  // 当前订阅参数
  private currentClusterID: number | null = null
  private currentKinds: string[] | null = null

  subscribe(clusterID: number | null, kinds: string[] | null) {
    const needReconnect =
      this.currentClusterID !== clusterID ||
      JSON.stringify(this.currentKinds) !== JSON.stringify(kinds)

    this.currentClusterID = clusterID
    this.currentKinds = kinds

    if (needReconnect) {
      this.disconnect()
      this.connect()
    } else if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect()
    }
  }

  private buildUrl(): string {
    const params = new URLSearchParams()
    if (this.currentClusterID != null) {
      params.set('cluster_id', String(this.currentClusterID))
    }
    if (this.currentKinds != null && this.currentKinds.length > 0) {
      params.set('kinds', this.currentKinds.join(','))
    }
    const qs = params.toString()
    return `ws://${window.location.host}/ws/k8s-events${qs ? '?' + qs : ''}`
  }

  private setState(state: ConnectionState) {
    if (this.connectionState === state) return
    this.connectionState = state
    this.stateHandlers.forEach((h) => h(state))
  }

  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  onConnectionStateChange(handler: StateHandler) {
    this.stateHandlers.add(handler)
    // 立即触发一次当前状态
    handler(this.connectionState)
    return () => {
      this.stateHandlers.delete(handler)
    }
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return

    const url = this.buildUrl()
    if (import.meta.env.DEV) console.log('[WS] connecting to', url)
    this.setState('connecting')

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        if (import.meta.env.DEV) console.log('[WS] connected')
        this.setState('connected')
        this.reconnectDelay = 3000
      }

      this.ws.onmessage = (event) => {
        try {
          const msg: ResourceChangeMessage = JSON.parse(event.data)
          // 支持 resource_change 和 cluster_status_change 等多种消息类型
          this.handlers.forEach((h) => h(msg))
        } catch {
          // ignore invalid message
        }
      }

      this.ws.onclose = () => {
        if (import.meta.env.DEV) console.log('[WS] disconnected, reconnecting...')
        this.setState('disconnected')
        this.scheduleReconnect()
      }

      this.ws.onerror = (err) => {
        if (import.meta.env.DEV) console.error('[WS] error:', err)
        this.ws?.close()
      }
    } catch {
      this.setState('disconnected')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0) {
        this.disconnect()
      }
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.setState('disconnected')
  }
}

export const wsManager = new WsManager()
