package service

import (
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// K8sManager K8s客户端管理器
type K8sManager struct {
	clients map[uint]*K8sClient
	mu      sync.RWMutex
}

// K8sClient 包装K8s客户端
type K8sClient struct {
	Client     *kubernetes.Clientset
	LastUsed   time.Time
	Health     bool
}

// NewK8sManager 创建管理器
func NewK8sManager() *K8sManager {
	return &K8sManager{
		clients: make(map[uint]*K8sClient),
	}
}

// AddClient 添加客户端
func (km *K8sManager) AddClient(clusterID uint, client *kubernetes.Clientset) {
	km.mu.Lock()
	defer km.mu.Unlock()

	km.clients[clusterID] = &K8sClient{
		Client:   client,
		LastUsed: time.Now(),
		Health:   true,
	}
}

// GetClient 获取客户端
func (km *K8sManager) GetClient(clusterID uint) *kubernetes.Clientset {
	km.mu.RLock()
	defer km.mu.RUnlock()

	if client, ok := km.clients[clusterID]; ok {
		client.LastUsed = time.Now()
		return client.Client
	}
	return nil
}

// RemoveClient 移除客户端
func (km *K8sManager) RemoveClient(clusterID uint) {
	km.mu.Lock()
	defer km.mu.Unlock()

	delete(km.clients, clusterID)
}

// HealthCheck 健康检查
func (km *K8sManager) HealthCheck(clusterID uint) bool {
	km.mu.RLock()
	client, ok := km.clients[clusterID]
	km.mu.RUnlock()

	if !ok {
		return false
	}

	// 简单检查 - 实际应该调用API
	return client.Health
}
