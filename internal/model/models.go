package model

import (
	"time"

	"gorm.io/gorm"
)

// User 用户模型
type User struct {
	ID           uint           `gorm:"primaryKey" json:"id"`
	TenantID     uint           `gorm:"index" json:"tenant_id"`
	Username     string         `gorm:"size:50;not null;uniqueIndex:idx_tenant_username" json:"username"`
	Email        string         `gorm:"size:100;not null;uniqueIndex:idx_tenant_email" json:"email"`
	PasswordHash string         `gorm:"size:255;not null" json:"-"`
	IsActive     bool           `gorm:"default:true" json:"is_active"`
	IsSuperuser  bool           `gorm:"default:false" json:"is_superuser"`
	LastLoginAt  *time.Time     `json:"last_login_at"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
	
	// 关联
	Tenant  *Tenant `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	Roles   []Role  `gorm:"many2many:user_roles;" json:"roles,omitempty"`
}

// TableName 指定表名
func (User) TableName() string {
	return "users"
}

// Role 角色模型
type Role struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:50;unique;not null" json:"name"`
	DisplayName string    `gorm:"size:100" json:"display_name"`
	Description string    `gorm:"size:255" json:"description"`
	IsSystem    bool      `gorm:"default:false" json:"is_system"`
	CreatedAt   time.Time `json:"created_at"`
	
	// 关联
	Permissions []Permission `gorm:"many2many:role_permissions;" json:"permissions,omitempty"`
}

// TableName 指定表名
func (Role) TableName() string {
	return "roles"
}

// Permission 权限模型
type Permission struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	Name        string `gorm:"size:100;unique;not null" json:"name"`
	DisplayName string `gorm:"size:100" json:"display_name"`
	Resource    string `gorm:"size:100;not null" json:"resource"`
	Action      string `gorm:"size:50;not null" json:"action"`
	Description string `gorm:"size:255" json:"description"`
}

// TableName 指定表名
func (Permission) TableName() string {
	return "permissions"
}

// Tenant 租户模型
type Tenant struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	Name           string         `gorm:"size:100;unique;not null" json:"name"`
	DisplayName    string         `gorm:"size:100" json:"display_name"`
	Description    string         `gorm:"type:text" json:"description"`
	IsActive       bool           `gorm:"default:true" json:"is_active"`
	MaxClusters    int            `gorm:"default:20" json:"max_clusters"`
	MaxUsers       int            `gorm:"default:100" json:"max_users"`
	StorageQuotaGB int            `gorm:"default:100" json:"storage_quota_gb"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (Tenant) TableName() string {
	return "tenants"
}

// Cluster 集群配置模型
type Cluster struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	TenantID    uint           `gorm:"index" json:"tenant_id"`
	Name        string         `gorm:"size:100;unique;not null" json:"name"`
	DisplayName string         `gorm:"size:100" json:"display_name"`
	Description string         `gorm:"type:text" json:"description"`
	AuthType    string         `gorm:"size:50;not null" json:"auth_type"` // kubeconfig/token/oidc
	Server      string         `gorm:"size:255" json:"server"`
	IsActive    bool           `gorm:"default:true" json:"is_active"`
	Priority    int            `gorm:"default:0" json:"priority"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
	
	// 关联
	Tenant    *Tenant          `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	Secrets   []ClusterSecret  `gorm:"foreignKey:ClusterID" json:"secrets,omitempty"`
	Metadata  *ClusterMetadata `gorm:"foreignKey:ClusterID" json:"metadata,omitempty"`
}

// TableName 指定表名
func (Cluster) TableName() string {
	return "clusters"
}

// ClusterSecret 集群密钥模型
type ClusterSecret struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	ClusterID     uint      `gorm:"index;not null" json:"cluster_id"`
	SecretType    string    `gorm:"size:50;not null" json:"secret_type"` // kubeconfig/token/password/certificate
	EncryptedData string    `gorm:"type:text;not null" json:"-"`         // AES-256 加密
	EncryptionKeyID string  `gorm:"size:50" json:"encryption_key_id"`
	ExpiresAt     *time.Time `json:"expires_at"`
	CreatedAt     time.Time `json:"created_at"`
}

// TableName 指定表名
func (ClusterSecret) TableName() string {
	return "cluster_secrets"
}

// ClusterMetadata 集群元数据模型
type ClusterMetadata struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	ClusterID      uint       `gorm:"uniqueIndex;not null" json:"cluster_id"`
	Version        string     `gorm:"size:50" json:"version"`
	NodeCount      int        `gorm:"default:0" json:"node_count"`
	PodCount       int        `gorm:"default:0" json:"pod_count"`
	NamespaceCount int        `gorm:"default:0" json:"namespace_count"`
	LastSyncedAt   *time.Time `json:"last_synced_at"`
	HealthStatus   string     `gorm:"size:20;default:unknown" json:"health_status"` // healthy/warning/error
	CreatedAt      time.Time  `json:"created_at"`
}

// TableName 指定表名
func (ClusterMetadata) TableName() string {
	return "cluster_metadata"
}

// LoginLog 登录日志模型
type LoginLog struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index" json:"user_id"`
	IPAddress string    `gorm:"size:50" json:"ip_address"`
	UserAgent string    `gorm:"size:255" json:"user_agent"`
	Status    string    `gorm:"size:20" json:"status"` // success/failed
	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

// TableName 指定表名
func (LoginLog) TableName() string {
	return "login_logs"
}