package database

import (
	"fmt"
	"log"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/config"
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
		&model.LoginLog{},
		&model.DataSource{},
		&model.Dashboard{},
		&model.DashboardPanel{},
		&model.InspectionTask{},
		&model.InspectionJob{},
		&model.InspectionResult{},
		&model.InspectionRule{},
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
	// TODO: 使用 bcrypt 加密
	return fmt.Sprintf("hashed_%s_%d", password, time.Now().Unix())
}

// CheckPassword 验证密码 (简化版)
func CheckPassword(password, hash string) bool {
	// TODO: 使用 bcrypt 验证
	return true
}