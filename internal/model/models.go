package model

import (
	"encoding/json"
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
	ID             uint      `gorm:"primaryKey" json:"id"`
	Name           string    `gorm:"size:50;unique;not null" json:"name"`
	DisplayName    string    `gorm:"size:100" json:"display_name"`
	Description    string    `gorm:"size:255" json:"description"`
	IsSystem       bool      `gorm:"default:false" json:"is_system"`
	Scope          string    `gorm:"size:32;default:'namespace'" json:"scope"` // platform/cluster/namespace
	Level          int       `gorm:"default:100" json:"level"`
	PermissionsData string   `gorm:"type:jsonb" json:"permissions_data"` // 扁平化权限列表 JSON ["module:dashboard","ai:chat",...]
	CreatedAt      time.Time `json:"created_at"`
	
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
	ID                uint           `gorm:"primaryKey" json:"id"`
	TenantID          uint           `gorm:"index" json:"tenant_id"`
	Name              string         `gorm:"size:100;unique;not null" json:"name"`
	DisplayName       string         `gorm:"size:100" json:"display_name"`
	Description       string         `gorm:"type:text" json:"description"`
	AuthType          string         `gorm:"size:50;not null" json:"auth_type"` // kubeconfig/token/oidc
	Server            string         `gorm:"size:255" json:"server"`
	ClusterLabelName  string         `gorm:"size:128;default:'cluster'" json:"cluster_label_name"`
	ClusterLabelValue string         `gorm:"size:128" json:"cluster_label_value"`
	IsActive          bool           `gorm:"default:true" json:"is_active"`
	Priority          int            `gorm:"default:0" json:"priority"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	DeletedAt         gorm.DeletedAt `gorm:"index" json:"-"`

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
	EncryptedData string    `gorm:"type:text;not null" json:"-"`         // 明文存储集群凭证
	ExpiresAt     *time.Time `json:"expires_at"`
	CreatedAt     time.Time `json:"created_at"`
}

// TableName 指定表名
func (ClusterSecret) TableName() string {
	return "cluster_secrets"
}

// LogBackendConfig 集群日志后端配置
type LogBackendConfig struct {
	Type          string            `json:"type"` // elasticsearch | loki | sls | unknown
	URL           string            `json:"url"`
	IndexPatterns map[string]string `json:"index_patterns"`
	Headers       map[string]string `json:"headers,omitempty"`
	DetectedAt    *time.Time        `json:"detected_at,omitempty"`
}

// ClusterLogBackend 集群日志后端（支持一个集群多套后端）
type ClusterLogBackend struct {
	ID              uint              `gorm:"primaryKey" json:"id"`
	ClusterID       uint              `gorm:"index;not null" json:"cluster_id"`
	Name            string            `gorm:"size:100;not null" json:"name"` // 用户自定义名称，如 "KS-OS-日志"
	Type            string            `gorm:"size:50;not null" json:"type"`  // elasticsearch | opensearch | loki
	URL             string            `gorm:"size:512;not null" json:"url"`
	IndexPatterns   string            `gorm:"type:text" json:"-"`            // JSON 序列化后的索引模式
	Headers         string            `gorm:"type:text" json:"-"`            // JSON 序列化后的请求头
	Status        string     `gorm:"size:32;default:'unknown'" json:"status"`
	LastCheckedAt *time.Time `json:"last_checked_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	// 以下字段仅在 API 响应中使用
	IndexPatternsMap map[string]string `json:"index_patterns,omitempty" gorm:"-"`
	HeadersMap       map[string]string `json:"headers,omitempty" gorm:"-"`
}

// ToConfig 转换为 LogBackendConfig
func (b ClusterLogBackend) ToConfig() LogBackendConfig {
	cfg := LogBackendConfig{
		Type: b.Type,
		URL:  b.URL,
		IndexPatterns: map[string]string{
			"all":     "k8s-es-logs-*",
			"ingress": "nginx-ingress-*",
			"coredns": "k8s-es-logs-*",
			"lb":      "k8s-es-logs-*",
			"app":     "k8s-es-logs-*",
		},
		Headers: map[string]string{},
	}
	if b.IndexPatterns != "" {
		_ = json.Unmarshal([]byte(b.IndexPatterns), &cfg.IndexPatterns)
	}
	if b.Headers != "" {
		_ = json.Unmarshal([]byte(b.Headers), &cfg.Headers)
	}
	return cfg
}

// FromConfig 从 LogBackendConfig 填充数据
func (b *ClusterLogBackend) FromConfig(cfg LogBackendConfig) {
	b.Type = cfg.Type
	b.URL = cfg.URL
	if cfg.IndexPatterns != nil {
		data, _ := json.Marshal(cfg.IndexPatterns)
		b.IndexPatterns = string(data)
	}
	if cfg.Headers != nil {
		data, _ := json.Marshal(cfg.Headers)
		b.Headers = string(data)
	}
}

// TableName 指定表名
func (ClusterLogBackend) TableName() string {
	return "cluster_log_backends"
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
	LogBackend     string     `gorm:"type:text" json:"log_backend,omitempty"`
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

// DataSource 数据源模型 (Prometheus / InfluxDB / etc.)
type DataSource struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	TenantID    uint           `gorm:"index" json:"tenant_id"`
	ClusterID   *uint          `gorm:"index" json:"cluster_id,omitempty"`
	Name        string         `gorm:"size:100;not null" json:"name"`
	Type        string         `gorm:"size:50;not null" json:"type"`          // prometheus
	URL         string         `gorm:"size:255;not null" json:"url"`
	Config      string         `gorm:"type:text" json:"config"`              // JSON: headers, auth, tls_skip_verify, cluster_label_name
	IsDefault   bool           `gorm:"default:false" json:"is_default"`
	IsActive    bool           `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (DataSource) TableName() string {
	return "data_sources"
}

// Dashboard 仪表盘模型
type Dashboard struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	TenantID    uint           `gorm:"index" json:"tenant_id"`
	Title       string         `gorm:"size:200;not null" json:"title"`
	Description string         `gorm:"type:text" json:"description"`
	Config      string         `gorm:"type:text" json:"config"`               // JSON: layout variables refresh interval
	IsDefault   bool           `gorm:"default:false" json:"is_default"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	Panels []DashboardPanel `gorm:"foreignKey:DashboardID" json:"panels,omitempty"`
}

func (Dashboard) TableName() string {
	return "dashboards"
}

// DashboardPanel 图表面板模型
type DashboardPanel struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	DashboardID  uint      `gorm:"index;not null" json:"dashboard_id"`
	Title        string    `gorm:"size:200" json:"title"`
	Type         string    `gorm:"size:50;not null" json:"type"`           // line / bar / pie / gauge / stat / table
	DataSourceID uint      `gorm:"index;not null" json:"data_source_id"`
	Query        string    `gorm:"type:text" json:"query"`                 // PromQL
	Position     string    `gorm:"type:text" json:"position"`              // JSON: {x, y, w, h}
	Options      string    `gorm:"type:text" json:"options"`               // JSON: legend, thresholds, colors, unit
	SortOrder    int       `gorm:"default:0" json:"sort_order"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (DashboardPanel) TableName() string {
	return "dashboard_panels"
}

// AuditLog 审计日志模型 - 操作审计
 type AuditLog struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	UserID      uint           `gorm:"index" json:"user_id"`
	Username    string         `gorm:"size:50" json:"username"`
	TenantID    uint           `gorm:"index" json:"tenant_id"`
	ClusterID   *uint          `gorm:"index" json:"cluster_id,omitempty"`
	ClusterName string         `gorm:"size:100" json:"cluster_name"`
	Action      string         `gorm:"size:50;not null" json:"action"`      // create/update/delete/view
	Resource    string         `gorm:"size:100;not null" json:"resource"`   // cluster/pod/deployment
	ResourceID  string         `gorm:"size:100" json:"resource_id"`         // 资源ID/名称
	Namespace   string         `gorm:"size:100" json:"namespace"`           // K8s命名空间
	Details     string         `gorm:"type:text" json:"details"`            // 操作详情(JSON)
	Status      string         `gorm:"size:20;default:'success'" json:"status"` // success/failed
	ErrorMsg    string         `gorm:"type:text" json:"error_msg"`          // 错误信息
	IPAddress   string         `gorm:"size:50" json:"ip_address"`
	UserAgent   string         `gorm:"size:255" json:"user_agent"`
	Duration    int64          `json:"duration"`                              // 操作耗时(ms)
	CreatedAt   time.Time      `gorm:"index" json:"created_at"`
}

// TableName 指定表名
func (AuditLog) TableName() string {
	return "audit_logs"
}

// ClusterPermission 集群权限模型 - 用户集群访问控制（保留兼容）
 type ClusterPermission struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	UserID      uint           `gorm:"uniqueIndex:idx_user_cluster;not null" json:"user_id"`
	ClusterID   uint           `gorm:"uniqueIndex:idx_user_cluster;not null" json:"cluster_id"`
	Role        string         `gorm:"size:20;not null" json:"role"`          // admin/viewer/operator
	Namespaces  string         `gorm:"type:text" json:"namespaces"`           // JSON数组["default","kube-system"]
	CanExec     bool           `gorm:"default:false" json:"can_exec"`         // 是否允许exec进容器
	CanEdit     bool           `gorm:"default:false" json:"can_edit"`         // 是否允许编辑资源
	CanDelete   bool           `gorm:"default:false" json:"can_delete"`       // 是否允许删除资源
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	
	// 关联
	User    *User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Cluster *Cluster `gorm:"foreignKey:ClusterID" json:"cluster,omitempty"`
}

// TableName 指定表名
func (ClusterPermission) TableName() string {
	return "cluster_permissions"
}

// NamespaceGrant 命名空间级授权（核心新增）
type NamespaceGrant struct {
	ID             uint      `gorm:"primarykey" json:"id"`
	UserID         uint      `gorm:"not null;index:idx_ns_grant_user_cluster, priority:1" json:"user_id"`
	ClusterID      uint      `gorm:"not null;index:idx_ns_grant_user_cluster, priority:2;index:idx_ns_grant_cluster_ns, priority:1" json:"cluster_id"`
	Namespace      string    `gorm:"not null;size:253;index:idx_ns_grant_cluster_ns, priority:2" json:"namespace"`
	RoleID         uint      `gorm:"not null" json:"role_id"`
	GrantedBy      *uint     `json:"granted_by"`
	GrantedAt      time.Time `json:"granted_at"`
	ExpiresAt      *time.Time `json:"expires_at"`
	
	User    *User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Cluster *Cluster `gorm:"foreignKey:ClusterID" json:"cluster,omitempty"`
	Role    *Role    `gorm:"foreignKey:RoleID" json:"role,omitempty"`
}

func (NamespaceGrant) TableName() string {
	return "namespace_grants"
}

// UserModuleOverride 用户级功能模块权限覆盖
type UserModuleOverride struct {
	ID              uint      `gorm:"primarykey" json:"id"`
	UserID          uint      `gorm:"not null;uniqueIndex" json:"user_id"`
	EnabledModules  string    `gorm:"type:jsonb" json:"enabled_modules"`   // 额外开启 ["module:cluster:manage"]
	DisabledModules string    `gorm:"type:jsonb" json:"disabled_modules"`  // 额外禁用 ["ai:agent_chat"]
	DailyQuota      int       `gorm:"default:0" json:"daily_quota"`        // AI 每日配额 0=不限
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (UserModuleOverride) TableName() string {
	return "user_module_overrides"
}

// ==================== 巡检中心模型 ====================

// InspectionTask 巡检任务定义
type InspectionTask struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	TenantID       uint           `gorm:"index" json:"tenant_id"`
	Name           string         `gorm:"size:128;not null" json:"name"`
	Description    string         `gorm:"size:512" json:"description"`
	Schedule       string         `gorm:"size:64" json:"schedule"`           // Cron 表达式，空表示手动
	ScheduleType   string         `gorm:"size:32" json:"schedule_type"`      // manual / hourly / daily / weekly / custom
	Timezone       string         `gorm:"size:64;default:'Asia/Shanghai'" json:"timezone"`
	Enabled        bool           `gorm:"default:true" json:"enabled"`
	RetryTimes     int            `gorm:"default:0" json:"retry_times"`
	ClusterIDs     string         `gorm:"type:text" json:"cluster_ids"`      // JSON 数组 [1,2,3]
	RulesConfig    string         `gorm:"type:text" json:"rules_config"`     // JSON: 规则开关与阈值覆盖
	NotifyConfig   string         `gorm:"type:text" json:"notify_config"`    // JSON: webhook 等通知配置
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

func (InspectionTask) TableName() string { return "inspection_tasks" }

// InspectionJob 单次巡检执行记录
type InspectionJob struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	TaskID       uint       `gorm:"index" json:"task_id"`
	Status       string     `gorm:"size:32;index" json:"status"`         // pending / running / success / failed / partial
	TriggerType  string     `gorm:"size:32" json:"trigger_type"`         // scheduled / manual
	StartedAt    *time.Time `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at"`
	TotalClusters int       `json:"total_clusters"`
	SuccessCount int       `json:"success_count"`
	FailedCount  int       `json:"failed_count"`
	ScoreAvg     int       `json:"score_avg"`
	RiskLevel    string     `gorm:"size:16" json:"risk_level"`
	CreatedAt    time.Time  `json:"created_at"`
}

func (InspectionJob) TableName() string { return "inspection_jobs" }

// InspectionResult 单集群巡检结果
type InspectionResult struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	JobID          uint      `gorm:"index" json:"job_id"`
	ClusterID      uint      `gorm:"index" json:"cluster_id"`
	Status         string    `gorm:"size:32" json:"status"`               // success / failed
	Score          int       `json:"score"`
	RiskLevel      string    `gorm:"size:16" json:"risk_level"`          // low / medium / high / critical
	Findings       string    `gorm:"type:jsonb" json:"findings"`
	ReportHTML     string    `gorm:"type:text" json:"report_html"`
	ReportMarkdown string    `gorm:"type:text" json:"report_markdown"`
	ErrorMsg       string    `gorm:"type:text" json:"error_msg"`
	CreatedAt      time.Time `json:"created_at"`
}

func (InspectionResult) TableName() string { return "inspection_results" }

// InspectionRule 巡检规则模板
type InspectionRule struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	Name        string `gorm:"size:128" json:"name"`
	Category    string `gorm:"size:64;index" json:"category"`        // node / pod / resource / control_plane / security / config
	SourceType  string `gorm:"size:32" json:"source_type"`           // k8s_api / promql / script
	Expression  string `gorm:"type:text" json:"expression"`
	Thresholds  string `gorm:"type:jsonb" json:"thresholds"`         // {"warning":0.95,"critical":0.90}
	Weight      int    `json:"weight"`
	Suggestion  string `gorm:"type:text" json:"suggestion"`          // 修复建议
	Enabled     bool   `gorm:"default:true" json:"enabled"`
	Builtin     bool   `gorm:"default:false" json:"builtin"`         // 是否内置
	CreatedAt   time.Time `json:"created_at"`
}

func (InspectionRule) TableName() string { return "inspection_rules" }

// SystemSetting 系统配置表
type SystemSetting struct {
	Key       string `gorm:"primaryKey;size:128" json:"key"`
	Value     string `gorm:"type:text" json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SystemSetting) TableName() string { return "system_settings" }