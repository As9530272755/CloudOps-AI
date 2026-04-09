package api

import (
	"github.com/cloudops/platform/internal/api/handlers"
	"github.com/cloudops/platform/internal/api/middleware"
	"github.com/cloudops/platform/internal/pkg/auth"
	"github.com/gin-gonic/gin"
)

// Router API 路由
type Router struct {
	authHandler *handlers.AuthHandler
	jwtManager  *auth.JWTManager
}

// NewRouter 创建路由
func NewRouter(jwtManager *auth.JWTManager) *Router {
	return &Router{
		authHandler: handlers.NewAuthHandler(jwtManager),
		jwtManager:  jwtManager,
	}
}

// RegisterRoutes 注册路由
func (r *Router) RegisterRoutes(engine *gin.Engine) {
	// API v1 路由组
	v1 := engine.Group("/api/v1")
	{
		// 认证路由 (无需认证)
		authGroup := v1.Group("/auth")
		{
			authGroup.POST("/login", r.authHandler.Login)
			authGroup.POST("/logout", r.authHandler.Logout)
		}

		// 需要认证的路由
		protected := v1.Group("")
		protected.Use(middleware.AuthMiddleware(r.jwtManager))
		{
			// 用户信息
			protected.GET("/auth/profile", r.authHandler.GetProfile)

			// TODO: 添加更多路由
			// 集群管理
			// 巡检中心
			// 数据管理
			// 日志管理
			// AI问答
			// 终端
			// 租户管理
		}
	}
}