package main

import (
	"fmt"
	"log"
	"os"

	"github.com/cloudops/platform/internal/api"
	"github.com/cloudops/platform/internal/pkg/auth"
	"github.com/cloudops/platform/internal/pkg/config"
	"github.com/cloudops/platform/internal/pkg/database"
	"github.com/gin-gonic/gin"
)

// @title CloudOps Platform API
// @version 2.0
// @description 云原生运维管理平台 API
// @host localhost:8000
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
	_, err = database.InitDB(cfg)
	if err != nil {
		log.Fatalf("❌ 数据库初始化失败: %v", err)
	}

	// 创建 JWT 管理器
	jwtManager := auth.NewJWTManager(&cfg.Security)

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
	apiRouter := api.NewRouter(jwtManager)
	apiRouter.RegisterRoutes(router)

	// 启动服务
	addr := fmt.Sprintf("%s:%d", cfg.Server.Backend.Host, cfg.Server.Backend.Port)
	log.Printf("🚀 CloudOps Backend 启动在 %s", addr)
	log.Printf("📖 API 文档: http://%s/docs", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("❌ 启动失败: %v", err)
	}
}