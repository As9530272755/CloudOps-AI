package database

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/config"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// InitDB 初始化数据库连接
func InitDB(cfg *config.Config) (*gorm.DB, error) {
	var dsn string
	var dialector gorm.Dialector

	// PostgreSQL
	if cfg.Database.Postgres.Host == "" {
		return nil, fmt.Errorf("数据库配置错误: postgres.host 不能为空")
	}
	dsn = fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Database.Postgres.Host,
		cfg.Database.Postgres.Port,
		cfg.Database.Postgres.Username,
		cfg.Database.Postgres.Password,
		cfg.Database.Postgres.Database,
		cfg.Database.Postgres.SSLMode,
	)
	dialector = postgres.Open(dsn)

	// GORM 配置
	gormConfig := &gorm.Config{}
	if cfg.Server.Backend.Mode == "debug" {
		gormConfig.Logger = logger.Default.LogMode(logger.Info)
	} else {
		gormConfig.Logger = logger.Default.LogMode(logger.Silent)
	}

	// 连接数据库
	db, err := gorm.Open(dialector, gormConfig)
	if err != nil {
		return nil, fmt.Errorf("连接数据库失败: %w", err)
	}

	// 自动迁移
	if err = autoMigrate(db); err != nil {
		return nil, fmt.Errorf("数据库迁移失败: %w", err)
	}

	// 迁移旧版日志后端配置到独立表
	if err = migrateLogBackends(db); err != nil {
		return nil, fmt.Errorf("日志后端数据迁移失败: %w", err)
	}

	// 初始化默认数据
	if err = initDefaultData(db); err != nil {
		return nil, fmt.Errorf("初始化默认数据失败: %w", err)
	}

	// 连接池调优：23 集群 × 4000 Pod 高并发场景下，默认连接池容易打满
	sqlDB, err := db.DB()
	if err == nil {
		sqlDB.SetMaxOpenConns(100)        // 最大打开连接数
		sqlDB.SetMaxIdleConns(20)         // 最大空闲连接数
		sqlDB.SetConnMaxLifetime(30 * time.Minute) // 连接最大生命周期
		log.Println("✅ 数据库连接池已调优 (max_open=100, max_idle=20)")
	}

	DB = db
	log.Println("✅ 数据库初始化完成")
	return db, nil
}

// autoMigrate 自动迁移表结构
func autoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&model.Tenant{},
		&model.User{},
		&model.Role{},
		&model.Permission{},
		&model.Cluster{},
		&model.ClusterSecret{},
		&model.ClusterMetadata{},
		&model.ClusterLogBackend{},
		&model.LoginLog{},
		&model.DataSource{},
		&model.Dashboard{},
		&model.DashboardPanel{},
		&model.InspectionTask{},
		&model.InspectionJob{},
		&model.InspectionResult{},
		&model.InspectionRule{},
		&model.AITask{},
		&model.AIPlatform{},
		&model.AIChatSession{},
		&model.AIChatMessage{},
		&model.SystemSetting{},
		&model.NamespaceGrant{},
		&model.UserModuleOverride{},
	)
}

// initDefaultData 初始化默认数据
func initDefaultData(db *gorm.DB) error {
	// 创建默认租户
	var tenantCount int64
	db.Model(&model.Tenant{}).Count(&tenantCount)
	if tenantCount == 0 {
		tenant := model.Tenant{
			Name:           "default",
			DisplayName:    "默认租户",
			Description:    "系统默认租户",
			IsActive:       true,
			MaxClusters:    20,
			MaxUsers:       100,
			StorageQuotaGB: 100,
		}
		if err := db.Create(&tenant).Error; err != nil {
			return err
		}
		log.Println("✅ 创建默认租户")
	}

	// 创建默认角色
	var roleCount int64
	db.Model(&model.Role{}).Count(&roleCount)
	if roleCount == 0 {
		roles := []model.Role{
			{Name: "platform-admin", DisplayName: "平台管理员", Description: "平台级管理员，拥有所有权限", IsSystem: true, Scope: "platform", Level: 300, PermissionsData: `["*:*","module:dashboard","module:cluster:manage","module:inspection","module:network:trace","module:data:manage","module:log:manage","module:terminal","module:ai:assistant","module:system:user","module:system:tenant","module:system:settings","ai:chat","ai:agent_chat","ai:image_input","ai:session_manage","ai:platform:view","ai:platform:manage","ai:platform:test","ai:log_analysis","ai:network_analysis","ai:inspection_analysis","ai:tool:list_clusters","ai:tool:cluster_status","ai:tool:list_pods","ai:tool:query_logs","pod:*","deployment:*","service:*","configmap:*","secret:*","event:read","log:read","terminal:use","namespace:read"]`},
			{Name: "cluster-admin", DisplayName: "集群管理员", Description: "集群级管理员，可管理集群但不能管理系统配置", IsSystem: true, Scope: "cluster", Level: 200, PermissionsData: `["module:dashboard","module:cluster:manage","module:inspection","module:network:trace","module:data:manage","module:log:manage","module:terminal","module:ai:assistant","ai:chat","ai:agent_chat","ai:image_input","ai:session_manage","ai:platform:view","ai:platform:test","ai:log_analysis","ai:network_analysis","ai:inspection_analysis","ai:tool:list_clusters","ai:tool:cluster_status","ai:tool:list_pods","ai:tool:query_logs","pod:*","deployment:*","service:*","configmap:*","secret:*","event:read","log:read","terminal:use","namespace:read"]`},
			{Name: "cluster-viewer", DisplayName: "集群只读", Description: "集群级只读用户", IsSystem: true, Scope: "cluster", Level: 110, PermissionsData: `["module:dashboard","module:inspection","module:network:trace","module:log:manage","module:ai:assistant","ai:chat","ai:agent_chat","ai:image_input","ai:session_manage","ai:platform:view","ai:log_analysis","ai:network_analysis","ai:inspection_analysis","ai:tool:list_clusters","ai:tool:cluster_status","pod:read","deployment:read","service:read","configmap:read","event:read","log:read","namespace:read"]`},
			{Name: "namespace-admin", DisplayName: "命名空间管理员", Description: "命名空间级管理员", IsSystem: true, Scope: "namespace", Level: 150, PermissionsData: `["module:dashboard","module:inspection","module:network:trace","module:data:manage","module:log:manage","module:terminal","module:ai:assistant","ai:chat","ai:agent_chat","ai:image_input","ai:session_manage","ai:platform:view","ai:platform:test","ai:log_analysis","ai:network_analysis","ai:inspection_analysis","ai:tool:list_clusters","ai:tool:cluster_status","ai:tool:list_pods","ai:tool:query_logs","pod:*","deployment:*","service:*","configmap:*","secret:*","event:read","log:read","terminal:use","namespace:read"]`},
			{Name: "namespace-operator", DisplayName: "命名空间运维", Description: "命名空间级运维人员", IsSystem: true, Scope: "namespace", Level: 120, PermissionsData: `["module:dashboard","module:inspection","module:network:trace","module:log:manage","module:terminal","module:ai:assistant","ai:chat","ai:agent_chat","ai:image_input","ai:session_manage","ai:platform:view","ai:log_analysis","ai:network_analysis","ai:tool:list_clusters","ai:tool:cluster_status","ai:tool:list_pods","pod:read","pod:write","pod:delete","deployment:read","deployment:write","service:read","service:write","configmap:read","configmap:write","event:read","log:read","terminal:use","namespace:read"]`},
			{Name: "namespace-viewer", DisplayName: "命名空间只读", Description: "命名空间级只读用户", IsSystem: true, Scope: "namespace", Level: 100, PermissionsData: `["module:dashboard","module:inspection","module:network:trace","module:log:manage","module:ai:assistant","ai:chat","ai:image_input","ai:session_manage","ai:platform:view","ai:tool:list_clusters","pod:read","deployment:read","service:read","configmap:read","event:read","log:read","namespace:read"]`},
		}
		if err := db.Create(&roles).Error; err != nil {
			return err
		}
		log.Println("✅ 创建默认角色")
	}

	// 创建默认权限
	var permCount int64
	db.Model(&model.Permission{}).Count(&permCount)
	if permCount == 0 {
		permissions := []model.Permission{
			// K8s 资源权限
			{Name: "cluster:read", DisplayName: "查看集群", Resource: "cluster", Action: "read"},
			{Name: "cluster:write", DisplayName: "管理集群", Resource: "cluster", Action: "write"},
			{Name: "node:read", DisplayName: "查看节点", Resource: "node", Action: "read"},
			{Name: "pod:read", DisplayName: "查看Pod", Resource: "pod", Action: "read"},
			{Name: "pod:write", DisplayName: "管理Pod", Resource: "pod", Action: "write"},
			{Name: "terminal:use", DisplayName: "使用终端", Resource: "terminal", Action: "use"},
			{Name: "inspection:read", DisplayName: "查看巡检", Resource: "inspection", Action: "read"},
			{Name: "inspection:write", DisplayName: "执行巡检", Resource: "inspection", Action: "write"},
			// 功能模块权限
			{Name: "module:dashboard", DisplayName: "仪表盘", Resource: "module", Action: "dashboard"},
			{Name: "module:cluster:manage", DisplayName: "集群管理", Resource: "module", Action: "cluster:manage"},
			{Name: "module:inspection", DisplayName: "巡检中心", Resource: "module", Action: "inspection"},
			{Name: "module:network:trace", DisplayName: "网络追踪", Resource: "module", Action: "network:trace"},
			{Name: "module:data:manage", DisplayName: "数据管理", Resource: "module", Action: "data:manage"},
			{Name: "module:log:manage", DisplayName: "日志管理", Resource: "module", Action: "log:manage"},
			{Name: "module:terminal", DisplayName: "Web终端", Resource: "module", Action: "terminal"},
			{Name: "module:ai:assistant", DisplayName: "AI助手", Resource: "module", Action: "ai:assistant"},
			{Name: "module:system:user", DisplayName: "用户管理", Resource: "module", Action: "system:user"},
			{Name: "module:system:tenant", DisplayName: "租户管理", Resource: "module", Action: "system:tenant"},
			{Name: "module:system:settings", DisplayName: "系统设置", Resource: "module", Action: "system:settings"},
			// AI 权限
			{Name: "ai:chat", DisplayName: "AI对话", Resource: "ai", Action: "chat"},
			{Name: "ai:agent_chat", DisplayName: "AI Agent对话", Resource: "ai", Action: "agent_chat"},
			{Name: "ai:image_input", DisplayName: "AI图片输入", Resource: "ai", Action: "image_input"},
			{Name: "ai:session_manage", DisplayName: "AI会话管理", Resource: "ai", Action: "session_manage"},
			{Name: "ai:platform:view", DisplayName: "查看AI平台", Resource: "ai", Action: "platform:view"},
			{Name: "ai:platform:manage", DisplayName: "管理AI平台", Resource: "ai", Action: "platform:manage"},
			{Name: "ai:platform:test", DisplayName: "测试AI平台", Resource: "ai", Action: "platform:test"},
			{Name: "ai:log_analysis", DisplayName: "AI日志分析", Resource: "ai", Action: "log_analysis"},
			{Name: "ai:network_analysis", DisplayName: "AI网络分析", Resource: "ai", Action: "network_analysis"},
			{Name: "ai:inspection_analysis", DisplayName: "AI巡检分析", Resource: "ai", Action: "inspection_analysis"},
			{Name: "ai:tool:list_clusters", DisplayName: "AI工具-列出集群", Resource: "ai", Action: "tool:list_clusters"},
			{Name: "ai:tool:cluster_status", DisplayName: "AI工具-集群状态", Resource: "ai", Action: "tool:cluster_status"},
			{Name: "ai:tool:list_pods", DisplayName: "AI工具-列出Pod", Resource: "ai", Action: "tool:list_pods"},
			{Name: "ai:tool:query_logs", DisplayName: "AI工具-查询日志", Resource: "ai", Action: "tool:query_logs"},
		}
		if err := db.Create(&permissions).Error; err != nil {
			return err
		}
		log.Println("✅ 创建默认权限")
	}

	// 创建默认管理员用户
	var userCount int64
	db.Model(&model.User{}).Count(&userCount)
	if userCount == 0 {
		// 获取默认租户
		var tenant model.Tenant
		if err := db.Where("name = ?", "default").First(&tenant).Error; err != nil {
			return err
		}

		// 获取管理员角色
		var adminRole model.Role
		if err := db.Where("name = ?", "platform-admin").First(&adminRole).Error; err != nil {
			return err
		}

		// 创建管理员用户 (密码: admin)
		user := model.User{
			TenantID:     tenant.ID,
			Username:     "admin",
			Email:        "admin@cloudops.local",
			PasswordHash: HashPassword("admin"),
			IsActive:     true,
			IsSuperuser:  true,
		}
		if err := db.Create(&user).Error; err != nil {
			return err
		}

		// 关联角色
		db.Model(&user).Association("Roles").Append(&adminRole)
		log.Println("✅ 创建默认管理员 (admin/admin)")
	}

	return nil
}

// HashPassword 密码哈希 (简化版，实际应使用 bcrypt)
func HashPassword(password string) string {
	bytes, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes)
}

// CheckPassword 验证密码
func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// migrateLogBackends 把旧版 cluster_metadata.log_backend 迁移到 cluster_log_backends 表
func migrateLogBackends(db *gorm.DB) error {
	var metas []model.ClusterMetadata
	if err := db.Where("log_backend != ? AND log_backend IS NOT NULL", "").Find(&metas).Error; err != nil {
		return err
	}

	for _, meta := range metas {
		var cfg model.LogBackendConfig
		if err := json.Unmarshal([]byte(meta.LogBackend), &cfg); err != nil {
			continue
		}
		if cfg.URL == "" {
			continue
		}

		var count int64
		db.Model(&model.ClusterLogBackend{}).Where("cluster_id = ? AND url = ?", meta.ClusterID, cfg.URL).Count(&count)
		if count > 0 {
			continue // 已迁移
		}

		backend := model.ClusterLogBackend{
			ClusterID: meta.ClusterID,
			Name:      fmt.Sprintf("%s-日志", cfg.Type),
			Type:      cfg.Type,
			URL:       cfg.URL,
		}
		backend.FromConfig(cfg)
		if err := db.Create(&backend).Error; err != nil {
			log.Printf("迁移日志后端失败 cluster_id=%d: %v", meta.ClusterID, err)
		}
	}
	return nil
}