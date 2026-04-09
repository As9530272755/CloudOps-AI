package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/crypto"
)

// ClusterService 集群管理服务
type ClusterService struct {
	db        *gorm.DB
	encryptor *crypto.AES256Encrypt
	k8sManager *K8sManager
}

// NewClusterService 创建集群服务
func NewClusterService(db *gorm.DB, encryptor *crypto.AES256Encrypt) *ClusterService {
	return &ClusterService{
		db:         db,
		encryptor:  encryptor,
		k8sManager: NewK8sManager(),
	}
}

// CreateClusterRequest 创建集群请求
type CreateClusterRequest struct {
	Name        string `json:"name" binding:"required"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
	AuthType    string `json:"auth_type" binding:"required"` // kubeconfig/token
	KubeConfig  string `json:"kubeconfig,omitempty"`
	Token       string `json:"token,omitempty"`
	Server      string `json:"server,omitempty"`
}

// CreateCluster 创建集群
func (s *ClusterService) CreateCluster(ctx context.Context, userID uint, tenantID uint, req *CreateClusterRequest) (*model.Cluster, error) {
	// 1. 验证集群名称唯一性
	var existing model.Cluster
	if err := s.db.Where("name = ? AND tenant_id = ?", req.Name, tenantID).First(&existing).Error; err == nil {
		return nil, fmt.Errorf("cluster name already exists")
	}

	// 2. 解析kubeconfig获取server地址
	var server string
	var encryptedData string
	var err error

	if req.AuthType == "kubeconfig" {
		// 解析kubeconfig
		config, err := clientcmd.Load([]byte(req.KubeConfig))
		if err != nil {
			return nil, fmt.Errorf("invalid kubeconfig: %w", err)
		}
		
		// 获取当前context的server
		currentContext := config.CurrentContext
		if context, ok := config.Contexts[currentContext]; ok {
			if cluster, ok := config.Clusters[context.Cluster]; ok {
				server = cluster.Server
			}
		}
		
		// 加密kubeconfig
		encryptedData, err = s.encryptor.Encrypt(req.KubeConfig)
		if err != nil {
			return nil, fmt.Errorf("encrypt kubeconfig failed: %w", err)
		}
	} else if req.AuthType == "token" {
		server = req.Server
		encryptedData, err = s.encryptor.Encrypt(req.Token)
		if err != nil {
			return nil, fmt.Errorf("encrypt token failed: %w", err)
		}
	}

	// 3. 创建集群记录
	cluster := &model.Cluster{
		TenantID:    tenantID,
		Name:        req.Name,
		DisplayName: req.DisplayName,
		Description: req.Description,
		AuthType:    req.AuthType,
		Server:      server,
		IsActive:    true,
	}

	if err := s.db.Create(cluster).Error; err != nil {
		return nil, fmt.Errorf("create cluster failed: %w", err)
	}

	// 4. 创建密钥记录
	secret := &model.ClusterSecret{
		ClusterID:     cluster.ID,
		SecretType:    req.AuthType,
		EncryptedData: encryptedData,
		EncryptionKeyID: "default",
	}

	if err := s.db.Create(secret).Error; err != nil {
		return nil, fmt.Errorf("create secret failed: %w", err)
	}

	// 5. 创建元数据记录
	metadata := &model.ClusterMetadata{
		ClusterID:    cluster.ID,
		HealthStatus: "pending",
	}
	if err := s.db.Create(metadata).Error; err != nil {
		return nil, fmt.Errorf("create metadata failed: %w", err)
	}

	// 6. 异步测试连接
	go s.testClusterConnection(cluster.ID)

	// 7. 记录审计日志
	s.logAudit(ctx, userID, tenantID, cluster.ID, req.Name, "create", "cluster", 
		fmt.Sprintf("%d", cluster.ID), "", "success", "", 0)

	return cluster, nil
}

// ListClusters 获取集群列表
func (s *ClusterService) ListClusters(ctx context.Context, tenantID uint) ([]model.Cluster, error) {
	var clusters []model.Cluster
	if err := s.db.Preload("Metadata").Where("tenant_id = ?", tenantID).Find(&clusters).Error; err != nil {
		return nil, err
	}
	return clusters, nil
}

// GetCluster 获取集群详情
func (s *ClusterService) GetCluster(ctx context.Context, clusterID uint) (*model.Cluster, error) {
	var cluster model.Cluster
	if err := s.db.Preload("Metadata").Preload("Secrets").First(&cluster, clusterID).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

// DeleteCluster 删除集群
func (s *ClusterService) DeleteCluster(ctx context.Context, userID uint, tenantID uint, clusterID uint) error {
	// 获取集群信息用于审计日志
	var cluster model.Cluster
	if err := s.db.First(&cluster, clusterID).Error; err != nil {
		return err
	}

	// 删除集群（级联删除secrets和metadata）
	if err := s.db.Delete(&model.Cluster{}, clusterID).Error; err != nil {
		return err
	}

	// 从K8s管理器移除
	s.k8sManager.RemoveClient(clusterID)

	// 记录审计日志
	s.logAudit(ctx, userID, tenantID, &clusterID, cluster.Name, "delete", "cluster", 
		fmt.Sprintf("%d", clusterID), "", "success", "", 0)

	return nil
}

// testClusterConnection 测试集群连接
func (s *ClusterService) testClusterConnection(clusterID uint) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	start := time.Now()
	
	// 获取客户端
	client, err := s.GetK8sClient(ctx, clusterID)
	if err != nil {
		s.updateClusterHealth(clusterID, "error", err.Error())
		return
	}

	// 测试连接 - 获取版本
	version, err := client.Discovery().ServerVersion()
	if err != nil {
		s.updateClusterHealth(clusterID, "error", err.Error())
		return
	}

	duration := time.Since(start).Milliseconds()

	// 获取集群信息
	nodes, _ := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	pods, _ := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	namespaces, _ := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})

	// 更新元数据
	metadata := model.ClusterMetadata{
		ClusterID:      clusterID,
		Version:        version.GitVersion,
		NodeCount:      len(nodes.Items),
		PodCount:       len(pods.Items),
		NamespaceCount: len(namespaces.Items),
		HealthStatus:   "healthy",
		LastSyncedAt:   &[]time.Time{time.Now()}[0],
	}

	s.db.Model(&model.ClusterMetadata{}).Where("cluster_id = ?", clusterID).Updates(metadata)

	// 记录审计日志
	s.logAudit(context.Background(), 0, 0, &clusterID, "", "health_check", "cluster", 
		fmt.Sprintf("%d", clusterID), "", "success", "", duration)
}

// updateClusterHealth 更新集群健康状态
func (s *ClusterService) updateClusterHealth(clusterID uint, status string, errorMsg string) {
	s.db.Model(&model.ClusterMetadata{}).Where("cluster_id = ?", clusterID).Update("health_status", status)
}

// GetK8sClient 获取K8s客户端
func (s *ClusterService) GetK8sClient(ctx context.Context, clusterID uint) (*kubernetes.Clientset, error) {
	// 先从管理器获取
	if client := s.k8sManager.GetClient(clusterID); client != nil {
		return client, nil
	}

	// 从数据库获取密钥
	var secret model.ClusterSecret
	if err := s.db.Where("cluster_id = ?", clusterID).First(&secret).Error; err != nil {
		return nil, fmt.Errorf("cluster secret not found")
	}

	// 解密
	decryptedData, err := s.encryptor.Decrypt(secret.EncryptedData)
	if err != nil {
		return nil, fmt.Errorf("decrypt failed: %w", err)
	}

	var config *rest.Config

	if secret.SecretType == "kubeconfig" {
		// 从kubeconfig构建配置
		config, err = clientcmd.RESTConfigFromKubeConfig([]byte(decryptedData))
		if err != nil {
			return nil, fmt.Errorf("parse kubeconfig failed: %w", err)
		}
	} else if secret.SecretType == "token" {
		// 从token构建配置
		var cluster model.Cluster
		s.db.First(&cluster, clusterID)
		
		config = &rest.Config{
			Host:        cluster.Server,
			BearerToken: decryptedData,
			TLSClientConfig: rest.TLSClientConfig{
				Insecure: true, // 生产环境应该验证证书
			},
		}
	}

	// 创建客户端
	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create k8s client failed: %w", err)
	}

	// 缓存客户端
	s.k8sManager.AddClient(clusterID, client)

	return client, nil
}

// logAudit 记录审计日志
func (s *ClusterService) logAudit(ctx context.Context, userID uint, tenantID uint, clusterID *uint, 
	clusterName string, action string, resource string, resourceID string, namespace string, 
	status string, errorMsg string, duration int64) {
	
	// 获取用户信息
	var username string
	if userID > 0 {
		var user model.User
		s.db.Select("username").First(&user, userID)
		username = user.Username
	}

	log := &model.AuditLog{
		UserID:      userID,
		Username:    username,
		TenantID:    tenantID,
		ClusterID:   clusterID,
		ClusterName: clusterName,
		Action:      action,
		Resource:    resource,
		ResourceID:  resourceID,
		Namespace:   namespace,
		Status:      status,
		ErrorMsg:    errorMsg,
		Duration:    duration,
	}

	s.db.Create(log)
}