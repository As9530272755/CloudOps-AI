package main

import (
	"fmt"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/cloudops/platform/internal/pkg/config"
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
		log.Fatalf("加载配置失败: %v", err)
	}

	// 设置运行模式
	if cfg.Server.Backend.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	// 创建路由
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

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

	// 启动服务
	addr := fmt.Sprintf("%s:%d", cfg.Server.Backend.Host, cfg.Server.Backend.Port)
	log.Printf("🚀 CloudOps Backend 启动在 %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("启动失败: %v", err)
	}
}