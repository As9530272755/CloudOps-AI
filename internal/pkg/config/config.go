package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"
)

// Config 主配置结构
type Config struct {
	Server       ServerConfig       `mapstructure:"server"`
	Database     DatabaseConfig     `mapstructure:"database"`
	Kubernetes   KubernetesConfig   `mapstructure:"kubernetes"`
	AI           AIConfig           `mapstructure:"ai"`
	Security     SecurityConfig     `mapstructure:"security"`
	Tenant       TenantConfig       `mapstructure:"tenant"`
	Logging      LoggingConfig      `mapstructure:"logging"`
	NetworkTrace NetworkTraceConfig `mapstructure:"network_trace"`
}

// NetworkTraceConfig 网络追踪配置
type NetworkTraceConfig struct {
	DebugImage string `mapstructure:"debug_image"`
}

// ServerConfig 服务配置
type ServerConfig struct {
	Backend   BackendConfig   `mapstructure:"backend"`
	Frontend  FrontendConfig  `mapstructure:"frontend"`
	AIService AIServiceConfig `mapstructure:"ai_service"`
}

// BackendConfig 后端配置
type BackendConfig struct {
	Host           string        `mapstructure:"host"`
	Port           int           `mapstructure:"port"`
	Mode           string        `mapstructure:"mode"`
	ReadTimeout    time.Duration `mapstructure:"read_timeout"`
	WriteTimeout   time.Duration `mapstructure:"write_timeout"`
	MaxConnections int           `mapstructure:"max_connections"`
}

// FrontendConfig 前端配置
type FrontendConfig struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
}

// AIServiceConfig AI 服务配置
type AIServiceConfig struct {
	Host    string `mapstructure:"host"`
	Port    int    `mapstructure:"port"`
	Enabled bool   `mapstructure:"enabled"`
}

// DatabaseConfig 数据库配置
type DatabaseConfig struct {
	Postgres PostgresConfig `mapstructure:"postgres"`
	Redis    RedisConfig    `mapstructure:"redis"`
}

// PostgresConfig PostgreSQL 配置
type PostgresConfig struct {
	Host          string `mapstructure:"host"`
	Port          int    `mapstructure:"port"`
	Database      string `mapstructure:"database"`
	Username      string `mapstructure:"username"`
	Password      string `mapstructure:"password"`
	SSLMode       string `mapstructure:"ssl_mode"`
	MaxConnections int   `mapstructure:"max_connections"`
	MaxIdle       int    `mapstructure:"max_idle"`
}

// RedisConfig Redis 配置
type RedisConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
	PoolSize int    `mapstructure:"pool_size"`
}

// KubernetesConfig K8s 配置
type KubernetesConfig struct {
	ConnectionPool ConnectionPoolConfig `mapstructure:"connection_pool"`
	Terminal       TerminalConfig      `mapstructure:"terminal"`
}

// ConnectionPoolConfig 连接池配置
type ConnectionPoolConfig struct {
	MaxSize     int           `mapstructure:"max_size"`
	IdleTimeout time.Duration `mapstructure:"idle_timeout"`
	HealthCheck time.Duration `mapstructure:"health_check"`
}

// TerminalConfig 终端配置
type TerminalConfig struct {
	Enabled          bool     `mapstructure:"enabled"`
	MaxSessions      int      `mapstructure:"max_sessions"`
	SessionTimeout   time.Duration `mapstructure:"session_timeout"`
	RecordingEnabled bool     `mapstructure:"recording_enabled"`
	RecordingPath    string   `mapstructure:"recording_path"`
	AllowedShells    []string `mapstructure:"allowed_shells"`
}

// AIConfig AI 配置
type AIConfig struct {
	OpenClaw     OpenClawConfig     `mapstructure:"openclaw"`
	KnowledgeBase KnowledgeBaseConfig `mapstructure:"knowledge_base"`
}

// OpenClawConfig OpenClaw 配置
type OpenClawConfig struct {
	Enabled   bool          `mapstructure:"enabled"`
	APIUrl    string        `mapstructure:"api_url"`
	APIKey    string        `mapstructure:"api_key"`
	Timeout   time.Duration `mapstructure:"timeout"`
	MaxTokens int           `mapstructure:"max_tokens"`
}

// KnowledgeBaseConfig 知识库配置
type KnowledgeBaseConfig struct {
	Enabled       bool   `mapstructure:"enabled"`
	VectorDB      string `mapstructure:"vector_db"`
	EmbeddingModel string `mapstructure:"embedding_model"`
}

// SecurityConfig 安全配置
type SecurityConfig struct {
	JWT       JWTConfig       `mapstructure:"jwt"`
	Encryption EncryptionConfig `mapstructure:"encryption"`
	RateLimit RateLimitConfig `mapstructure:"rate_limit"`
	Audit     AuditConfig     `mapstructure:"audit"`
}

// JWTConfig JWT 配置
type JWTConfig struct {
	Secret       string        `mapstructure:"secret"`
	AccessExpire time.Duration `mapstructure:"access_expire"`
	RefreshExpire time.Duration `mapstructure:"refresh_expire"`
}

// EncryptionConfig 加密配置
type EncryptionConfig struct {
	Algorithm string `mapstructure:"algorithm"`
	KeyID     string `mapstructure:"key_id"`
	Key       string `mapstructure:"key"`
}

// RateLimitConfig 限流配置
type RateLimitConfig struct {
	Enabled          bool `mapstructure:"enabled"`
	RequestsPerMinute int  `mapstructure:"requests_per_minute"`
	Burst            int  `mapstructure:"burst"`
}

// AuditConfig 审计配置
type AuditConfig struct {
	Enabled      bool   `mapstructure:"enabled"`
	LogPath      string `mapstructure:"log_path"`
	RetentionDays int   `mapstructure:"retention_days"`
}

// TenantConfig 租户配置
type TenantConfig struct {
	Enabled       bool         `mapstructure:"enabled"`
	MaxTenants    int          `mapstructure:"max_tenants"`
	DefaultTenant string       `mapstructure:"default_tenant"`
	Quotas        QuotasConfig `mapstructure:"quotas"`
}

// QuotasConfig 配额配置
type QuotasConfig struct {
	MaxClusters         int `mapstructure:"max_clusters"`
	MaxUsers            int `mapstructure:"max_users"`
	MaxTerminalSessions int `mapstructure:"max_terminal_sessions"`
	StorageQuotaGB      int `mapstructure:"storage_quota_gb"`
}

// LoggingConfig 日志配置
type LoggingConfig struct {
	Level  string     `mapstructure:"level"`
	Format string     `mapstructure:"format"`
	Output string     `mapstructure:"output"`
	File   FileConfig `mapstructure:"file"`
}

// FileConfig 日志文件配置
type FileConfig struct {
	Path       string `mapstructure:"path"`
	MaxSizeMB  int    `mapstructure:"max_size_mb"`
	MaxBackups int    `mapstructure:"max_backups"`
	MaxAgeDays int    `mapstructure:"max_age_days"`
	Compress   bool   `mapstructure:"compress"`
}

// LoadConfig 加载配置
func LoadConfig(configPath string) (*Config, error) {
	v := viper.New()

	// 设置默认值
	setDefaults(v)

	// 读取配置文件
	v.SetConfigFile(configPath)
	v.SetConfigType("yaml")

	// 读取环境变量
	v.AutomaticEnv()
	v.SetEnvPrefix("CLOUDOPS")

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("读取配置文件失败: %w", err)
	}

	var config Config
	if err := v.Unmarshal(&config); err != nil {
		return nil, fmt.Errorf("解析配置失败: %w", err)
	}

	return &config, nil
}

// setDefaults 设置默认值
func setDefaults(v *viper.Viper) {
	// 服务配置
	v.SetDefault("server.backend.host", "0.0.0.0")
	v.SetDefault("server.backend.port", 8000)
	v.SetDefault("server.backend.mode", "debug")
	v.SetDefault("server.backend.read_timeout", "30s")
	v.SetDefault("server.backend.write_timeout", "30s")
	v.SetDefault("server.frontend.port", 3000)
	v.SetDefault("server.ai_service.port", 8001)

	// 数据库配置
	v.SetDefault("database.postgres.host", "localhost")
	v.SetDefault("database.postgres.port", 5432)
	v.SetDefault("database.postgres.database", "cloudops")
	v.SetDefault("database.postgres.ssl_mode", "disable")
	v.SetDefault("database.postgres.max_connections", 100)
	v.SetDefault("database.redis.host", "localhost")
	v.SetDefault("database.redis.port", 6379)
	v.SetDefault("database.redis.pool_size", 100)

	// K8s 配置
	v.SetDefault("kubernetes.connection_pool.max_size", 50)
	v.SetDefault("kubernetes.connection_pool.idle_timeout", "10m")
	v.SetDefault("kubernetes.terminal.max_sessions", 100)
	v.SetDefault("kubernetes.terminal.session_timeout", "30m")
	v.SetDefault("kubernetes.terminal.recording_path", "/var/lib/cloudops/recordings")

	// 租户配置
	v.SetDefault("tenant.max_tenants", 100)
	v.SetDefault("tenant.default_tenant", "default")
	v.SetDefault("tenant.quotas.max_clusters", 20)
	v.SetDefault("tenant.quotas.max_users", 100)

	// 日志配置
	v.SetDefault("logging.level", "info")
	v.SetDefault("logging.format", "json")
	v.SetDefault("logging.output", "stdout")

	// 网络追踪配置
	v.SetDefault("network_trace.debug_image", "nicolaka/netshoot:latest")
}