const WS_URL = `ws://${window.location.host}/ws/k8s-events`

export interface ResourceChangeMessage {
  type: string
  cluster_id: number
  kind: string
  namespace: string
  name: string
  action: string
}

type MessageHandler = (msg: ResourceChangeMessage) => void

class WsManager {
  private ws: WebSocket | null = null
  private handlers: Set<MessageHandler> = new Set()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 3000
  private maxReconnectDelay = 30000

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return

    try {
      this.ws = new WebSocket(WS_URL)

      this.ws.onopen = () => {
        console.log('[WS] connected')
        this.reconnectDelay = 3000
      }

      this.ws.onmessage = (event) => {
        try {
          const msg: ResourceChangeMessage = JSON.parse(event.data)
          if (msg.type === 'resource_change') {
            this.handlers.forEach((h) => h(msg))
          }
        } catch {
          // ignore invalid message
        }
      }

      this.ws.onclose = () => {
        console.log('[WS] disconnected, reconnecting...')
        this.scheduleReconnect()
      }

      this.ws.onerror = (err) => {
        console.error('[WS] error:', err)
        this.ws?.close()
      }
    } catch {
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
    this.connect()
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
  }
}

export const wsManager = new WsManager()
