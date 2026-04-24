package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // 开发环境允许所有来源
	},
}

// ResourceChangeMessage 资源变化推送消息
type ResourceChangeMessage struct {
	Type      string `json:"type"`
	ClusterID uint   `json:"cluster_id"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Action    string `json:"action"` // create, update, delete
	Status    string `json:"status,omitempty"` // healthy, unhealthy, offline (for cluster_status_change)
}

// Hub 管理 WebSocket 连接和广播
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan ResourceChangeMessage
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// Client WebSocket 客户端
type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan ResourceChangeMessage
	clusterID uint
	kinds     map[string]bool
}

var globalHub *Hub

const (
	// 最大 WebSocket 连接数（防止连接耗尽）
	maxClients = 10000
	// broadcast 通道缓冲（避免高频事件下阻塞 informer）
	broadcastBufferSize = 4096
	// 单个客户端 send 通道缓冲
	clientSendBufferSize = 256
	// 写超时
	writeWait = 10 * time.Second
	// 心跳周期
	pingPeriod = 30 * time.Second
	// 读超时（pingPeriod 的倍数 + 余量）
	pongWait = 45 * time.Second
)

func init() {
	globalHub = NewHub()
	go globalHub.Run()
}

// NewHub 创建 Hub
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan ResourceChangeMessage, broadcastBufferSize),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// shouldSendToClient 判断消息是否应该发送给指定客户端
func shouldSendToClient(c *Client, msg ResourceChangeMessage) bool {
	if c.clusterID != 0 && c.clusterID != msg.ClusterID {
		return false
	}
	if c.kinds != nil && len(c.kinds) > 0 && !c.kinds[msg.Kind] {
		return false
	}
	return true
}

// clientCount 返回当前连接数
func (h *Hub) clientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// Run 启动 Hub 事件循环
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				if !shouldSendToClient(client, message) {
					continue
				}
				select {
				case client.send <- message:
				default:
					// 客户端 send 通道满，跳过（由 writePump 负责清理慢连接）
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast 广播资源变化消息
func Broadcast(msg ResourceChangeMessage) {
	if globalHub != nil {
		select {
		case globalHub.broadcast <- msg:
		default:
			// 广播通道满，丢弃（避免阻塞写操作）
		}
	}
}

// ServeWs 处理 WebSocket 升级请求
func ServeWs(w http.ResponseWriter, r *http.Request) {
	// 连接数限制
	if globalHub.clientCount() >= maxClients {
		log.Printf("WebSocket rejected: max clients reached (%d)", maxClients)
		http.Error(w, "Too many WebSocket connections", http.StatusServiceUnavailable)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	clusterIDStr := r.URL.Query().Get("cluster_id")
	kindsStr := r.URL.Query().Get("kinds")

	var clusterID uint
	if clusterIDStr != "" {
		if id, err := strconv.ParseUint(clusterIDStr, 10, 64); err == nil {
			clusterID = uint(id)
		}
	}

	var kindsMap map[string]bool
	if kindsStr != "" {
		kindsMap = make(map[string]bool)
		for _, k := range strings.Split(kindsStr, ",") {
			kindsMap[strings.TrimSpace(k)] = true
		}
	}

	client := &Client{
		hub:       globalHub,
		conn:      conn,
		send:      make(chan ResourceChangeMessage, clientSendBufferSize),
		clusterID: clusterID,
		kinds:     kindsMap,
	}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

// readPump 读取客户端消息（保持连接活跃 + 检测断开）
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}
	}
}

// writePump 向客户端写入消息（含心跳）
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				// channel closed
				c.conn.SetWriteDeadline(time.Now().Add(writeWait))
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			data, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
