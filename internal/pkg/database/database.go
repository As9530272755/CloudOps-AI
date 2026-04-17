package database

import (
	"encoding/json"
	"fmt"
	"log"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/config"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// InitDB 初始化数据库连接
func InitDB(cfg *config.Config) (*gorm.DB, error) {
	var dsn string
	var dialector gorm.Dialector

	// 根据配置选择数据库
	if cfg.Database.Postgres.Host != "" {
		// PostgreSQL
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
	} else {
		// SQLite (开发模式)
		dsn = "cloudops.db"
		dialector = sqlite.Open(dsn)
	}

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
			{Name: "admin", DisplayName: "管理员", Description: "系统管理员", IsSystem: true},
			{Name: "operator", DisplayName: "运维人员", Description: "负责日常运维", IsSystem: true},
			{Name: "viewer", DisplayName: "只读用户", Description: "只能查看资源", IsSystem: true},
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
			{Name: "cluster:read", DisplayName: "查看集群", Resource: "cluster", Action: "read"},
			{Name: "cluster:write", DisplayName: "管理集群", Resource: "cluster", Action: "write"},
			{Name: "node:read", DisplayName: "查看节点", Resource: "node", Action: "read"},
			{Name: "pod:read", DisplayName: "查看Pod", Resource: "pod", Action: "read"},
			{Name: "pod:write", DisplayName: "管理Pod", Resource: "pod", Action: "write"},
			{Name: "terminal:use", DisplayName: "使用终端", Resource: "terminal", Action: "use"},
			{Name: "inspection:read", DisplayName: "查看巡检", Resource: "inspection", Action: "read"},
			{Name: "inspection:write", DisplayName: "执行巡检", Resource: "inspection", Action: "write"},
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
		if err := db.Where("name = ?", "admin").First(&adminRole).Error; err != nil {
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