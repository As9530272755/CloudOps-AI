package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"

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

func init() {
	globalHub = NewHub()
	go globalHub.Run()
}

// NewHub 创建 Hub
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan ResourceChangeMessage, 256),
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
					// 客户端 send 通道满，跳过
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
		send:      make(chan ResourceChangeMessage, 64),
		clusterID: clusterID,
		kinds:     kindsMap,
	}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

// readPump 读取客户端消息（保持连接活跃）
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
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

// writePump 向客户端写入消息
func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()
	for msg := range c.send {
		data, err := json.Marshal(msg)
		if err != nil {
			continue
		}
		if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
			break
		}
	}
}
