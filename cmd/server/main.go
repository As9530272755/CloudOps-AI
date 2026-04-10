package main

import (
	"fmt"
	"log"
	"os"

	"github.com/gin-gonic/gin"

	"github.com/cloudops/platform/internal/api"
	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/auth"
	"github.com/cloudops/platform/internal/pkg/config"
	"github.com/cloudops/platform/internal/pkg/crypto"
	"github.com/cloudops/platform/internal/pkg/database"
	"github.com/cloudops/platform/internal/service"
)

// @title CloudOps Platform API
// @version 2.0
// @description 云原生运维管理平台 API
// @host localhost:9000
// @BasePath /api/v1
func main() {
	// 加载配置
	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = "config/config.yaml"
	}

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		log.Fatalf("❌ 加载配置失败: %v", err)
	}
	log.Println("✅ 配置加载成功")

	// 初始化数据库
	db, err := database.InitDB(cfg)
	if err != nil {
		log.Fatalf("❌ 数据库初始化失败: %v", err)
	}
	log.Println("✅ 数据库连接成功")

	// 自动迁移新表
	if err := db.AutoMigrate(
		&model.AuditLog{},
		&model.ClusterPermission{},
	); err != nil {
		log.Printf("⚠️ 数据库迁移警告: %v", err)
	}
	log.Println("✅ 数据库迁移完成")

	// 创建 JWT 管理器
	jwtManager := auth.NewJWTManager(&cfg.Security)

	// 创建加密器
	encryptor := crypto.NewAES256Encrypt(cfg.Security.JWT.Secret)

	// 创建 K8s 管理器并初始化所有活跃集群的 Informer
	k8sManager := service.NewK8sManager(db, encryptor)
	go k8sManager.InitClusters()
	log.Println("✅ K8s 管理器初始化完成，正在启动集群 Informer...")

	// 创建集群服务
	clusterService := service.NewClusterService(db, encryptor, k8sManager)
	log.Println("✅ 集群服务初始化完成")

	// 创建 K8s 资源服务
	k8sService := service.NewK8sResourceService(k8sManager)
	log.Println("✅ K8s 资源服务初始化完成")

	// 创建数据源服务
	dsService := service.NewDatasourceService(db)
	log.Println("✅ 数据源服务初始化完成")

	// 创建仪表盘服务
	dashboardService := service.NewDashboardService(db)
	log.Println("✅ 仪表盘服务初始化完成")

	// 创建巡检服务并启动调度器
	inspectionService := service.NewInspectionService(db, k8sManager, dsService)
	if err := inspectionService.StartScheduler(); err != nil {
		log.Printf("⚠️ 巡检调度器启动警告: %v", err)
	} else {
		log.Println("✅ 巡检调度器启动完成")
	}

	// 设置运行模式
	if cfg.Server.Backend.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	// 创建路由
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	// CORS 中间件
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// 健康检查
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "healthy",
			"version": "2.0.0",
		})
	})

	// 根路径
	router.GET("/", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"name":    "CloudOps Platform API",
			"version": "2.0.0",
			"docs":    "/docs",
		})
	})

	// 注册 API 路由
	apiRouter := api.NewRouter(jwtManager, clusterService, k8sService, dsService, dashboardService, inspectionService)
	apiRouter.RegisterRoutes(router)
	log.Println("✅ API 路由注册完成")

	// 启动服务
	addr := fmt.Sprintf("%s:%d", cfg.Server.Backend.Host, cfg.Server.Backend.Port)
	log.Printf("🚀 CloudOps Backend 启动在 %s", addr)
	log.Printf("📖 API 文档: http://%s/docs", addr)
	log.Println("🔗 集群管理 API: /api/v1/clusters")
	if err := router.Run(addr); err != nil {
		log.Fatalf("❌ 启动失败: %v", err)
	}
}