package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/cloudops/platform/internal/api"
	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/auth"
	"github.com/cloudops/platform/internal/pkg/config"
	"github.com/cloudops/platform/internal/pkg/crypto"
	"github.com/cloudops/platform/internal/pkg/database"
	appredis "github.com/cloudops/platform/internal/pkg/redis"
	"github.com/cloudops/platform/internal/service"
	redislib "github.com/redis/go-redis/v9"
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

	// 创建 AI 平台服务（多平台资源池）
	aiPlatformService := service.NewAIPlatformService(db, cfg.Security.JWT.Secret)
	log.Println("✅ AI 平台服务初始化完成")

	// 创建 AI 会话服务
	aiChatSessionService := service.NewAIChatSessionService(db)
	log.Println("✅ AI 会话服务初始化完成")

	// 创建通用 AI 服务
	aiService := service.NewAIService(aiPlatformService, aiChatSessionService)
	log.Println("✅ AI 服务初始化完成")

	// 初始化 Redis（可选，失败只打警告不退出）
	var redisClient *redislib.Client
	if rdb, err := appredis.InitRedis(cfg); err != nil {
		log.Printf("⚠️ Redis 初始化失败（任务轮询将回退到内存）: %v", err)
	} else {
		redisClient = rdb
		log.Println("✅ Redis 连接成功")
	}

	// 创建 AI 异步任务服务
	aiTaskService := service.NewAITaskService(db, redisClient, aiService)
	log.Println("✅ AI 任务服务初始化完成")

	// 启动定时任务：每天凌晨清理 7 天前已完成的 AI 任务
	go func() {
		for {
			now := time.Now()
			next := now.Add(24 * time.Hour)
			next = time.Date(next.Year(), next.Month(), next.Day(), 2, 0, 0, 0, next.Location())
			time.Sleep(next.Sub(now))
			if err := db.Exec("DELETE FROM ai_tasks WHERE created_at < NOW() - INTERVAL '7 days' AND status IN ('completed','failed')").Error; err != nil {
				log.Printf("⚠️ AI 任务清理失败: %v", err)
			} else {
				log.Println("✅ AI 任务清理完成")
			}
		}
	}()

	// 创建网络追踪服务
	networkTraceService := service.NewNetworkTraceService(cfg, k8sManager, dsService, db, aiService)
	log.Println("✅ 网络追踪服务初始化完成")

	// 创建日志查询服务
	logService := service.NewLogService(db, k8sManager)
	log.Println("✅ 日志查询服务初始化完成")

	// 创建系统设置服务
	settingService := service.NewSettingService(db)
	log.Println("✅ 系统设置服务初始化完成")

	// 创建 Agent 服务
	agentService := service.NewAgentService(aiPlatformService, aiChatSessionService, logService, k8sService, db)
	log.Println("✅ Agent 服务初始化完成")

	// 启动 Node.js Agent Runtime
	execPath, _ := os.Executable()
	execDir := filepath.Dir(execPath)
	agentRuntime := exec.CommandContext(context.Background(), "node", "agent-runtime/dist/server.js", "--port", "19000")
	agentRuntime.Stdout = os.Stdout
	agentRuntime.Stderr = os.Stderr
	agentRuntime.Dir = execDir
	if err := agentRuntime.Start(); err != nil {
		log.Printf("⚠️ Agent Runtime 启动失败: %v", err)
	} else {
		log.Println("✅ Agent Runtime (Node.js) 启动在 http://127.0.0.1:19000")
		// 简单等待服务就绪
		time.Sleep(1 * time.Second)
	}

	// 创建 Agent Runtime 代理
	agentRuntimeProxy := service.NewAgentRuntimeProxy(aiPlatformService)
	log.Println("✅ Agent Runtime 代理初始化完成")

	// 启动第三方对接系统健康检查（每 30 秒一次）
	dsService.StartHealthMonitor()
	aiPlatformService.StartHealthMonitor()
	logService.StartHealthMonitor()
	clusterService.StartHealthMonitor()
	log.Println("✅ 第三方系统健康检查 Monitor 启动完成")

	// 注册 API 路由
	apiRouter := api.NewRouter(jwtManager, clusterService, k8sService, dsService, dashboardService, inspectionService, networkTraceService, aiPlatformService, aiChatSessionService, aiService, aiTaskService, agentService, agentRuntimeProxy, logService, settingService, db, k8sManager)

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