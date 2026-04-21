package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/cloudops/platform/internal/api/handlers"
	"github.com/cloudops/platform/internal/api/middleware"
	"github.com/cloudops/platform/internal/pkg/auth"
	"github.com/cloudops/platform/internal/pkg/ws"
	"github.com/cloudops/platform/internal/service"
)

// Router API 路由
type Router struct {
	authHandler          *handlers.AuthHandler
	userHandler          *handlers.UserHandler
	clusterHandler       *handlers.ClusterHandler
	clusterService       *service.ClusterService
	k8sHandler           *handlers.K8sHandler
	dsHandler            *handlers.DatasourceHandler
	dashboardHandler     *handlers.DashboardHandler
	inspectionHandler    *handlers.InspectionHandler
	networkTraceHandler  *handlers.NetworkTraceHandler
	aiPlatformHandler    *handlers.AIPlatformHandler
	aiChatSessionHandler *handlers.AIChatSessionHandler
	aiChatHandler        *handlers.AIChatHandler
	aiTaskService        *service.AITaskService
	agentService         *service.AgentService
	agentToolsHandler    *handlers.AgentToolsHandler
	logHandler           *handlers.LogHandler
	settingHandler       *handlers.SettingHandler
	terminalHandler      *handlers.TerminalHandler
	jwtManager           *auth.JWTManager
	db                   *gorm.DB
}

// NewRouter 创建路由
func NewRouter(jwtManager *auth.JWTManager, clusterService *service.ClusterService, k8sService *service.K8sResourceService, dsService *service.DatasourceService, dashboardService *service.DashboardService, inspectionService *service.InspectionService, networkTraceService *service.NetworkTraceService, aiPlatformService *service.AIPlatformService, aiChatSessionService *service.AIChatSessionService, aiService *service.AIService, aiTaskSvc *service.AITaskService, agentService *service.AgentService, logService *service.LogService, settingService *service.SettingService, db *gorm.DB, k8sManager *service.K8sManager) *Router {
	return &Router{
		authHandler:          handlers.NewAuthHandler(jwtManager),
		userHandler:          handlers.NewUserHandler(db),
		clusterHandler:       handlers.NewClusterHandler(clusterService),
		clusterService:       clusterService,
		k8sHandler:           handlers.NewK8sHandler(k8sService, db),
		dsHandler:            handlers.NewDatasourceHandler(dsService),
		dashboardHandler:     handlers.NewDashboardHandler(dashboardService),
		inspectionHandler:    handlers.NewInspectionHandler(inspectionService),
		networkTraceHandler:  handlers.NewNetworkTraceHandler(networkTraceService),
		aiPlatformHandler:    handlers.NewAIPlatformHandler(aiPlatformService),
		aiChatSessionHandler: handlers.NewAIChatSessionHandler(aiChatSessionService),
		aiChatHandler:        handlers.NewAIChatHandler(aiService, aiTaskSvc, aiChatSessionService, agentService),
		agentToolsHandler:    handlers.NewAgentToolsHandler(agentService),
		logHandler:           handlers.NewLogHandler(logService),
		settingHandler:       handlers.NewSettingHandler(settingService),
		terminalHandler:      handlers.NewTerminalHandler(db, k8sManager, jwtManager),
		jwtManager:           jwtManager,
		db:                   db,
	}
}

// RegisterRoutes 注册路由
func (r *Router) RegisterRoutes(engine *gin.Engine) {
	// 静态文件：上传的 logo 等（无需认证，登录页也需要显示）
	engine.Static("/uploads", "./uploads")

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
		protected.Use(middleware.UserExistMiddleware(r.db))
		protected.Use(middleware.TenantScopeMiddleware())
		{
			// 用户信息
			protected.GET("/auth/profile", r.authHandler.GetProfile)

			// 当前用户权限 & 菜单
			protected.GET("/users/me/permissions", r.userHandler.GetMyPermissions)
			protected.GET("/users/me/menus", r.userHandler.GetMyMenus)
			protected.GET("/users/me/namespaces", r.userHandler.GetMyNamespaces)

			// 用户管理（系统级）
			protected.GET("/users", middleware.ModulePermissionMiddleware(r.db, "module:system:user"), r.userHandler.ListUsers)
			protected.POST("/users", middleware.ModulePermissionMiddleware(r.db, "module:system:user"), r.userHandler.CreateUser)
			protected.GET("/users/:id", middleware.ModulePermissionMiddleware(r.db, "module:system:user"), r.userHandler.GetUser)
			protected.PUT("/users/:id", middleware.ModulePermissionMiddleware(r.db, "module:system:user"), r.userHandler.UpdateUser)
			protected.PUT("/users/:id/password", middleware.ModulePermissionMiddleware(r.db, "module:system:user"), r.userHandler.ResetPassword)
			protected.PATCH("/users/:id/status", middleware.ModulePermissionMiddleware(r.db, "module:system:user"), r.userHandler.ToggleUserStatus)
			protected.DELETE("/users/:id", middleware.ModulePermissionMiddleware(r.db, "module:system:user"), r.userHandler.DeleteUser)
			protected.GET("/roles", r.userHandler.ListRoles)

			// NS 授权管理
			protected.POST("/namespace-grants", r.userHandler.GrantNamespace)
			protected.DELETE("/namespace-grants/:grant_id", r.userHandler.RevokeNamespace)

			// 集群管理
			clusters := protected.Group("/clusters")
			clusters.Use(middleware.ModulePermissionMiddleware(r.db, "module:cluster:manage"))
			{
				clusters.POST("", r.clusterHandler.CreateCluster)
				clusters.GET("", r.clusterHandler.ListClusters)
				clusters.GET("/:id", r.clusterHandler.GetCluster)
				clusters.PUT("/:id", r.clusterHandler.UpdateCluster)
				clusters.DELETE("/:id", r.clusterHandler.DeleteCluster)
				clusters.POST("/test-and-probe", r.clusterHandler.TestAndProbeCluster)
			}

			// K8s 资源管理（需要 NS 权限校验 + 集群状态校验）
			k8sCluster := protected.Group("/clusters/:id")
			k8sCluster.Use(middleware.ClusterStateMiddleware(r.clusterService))
			{
				k8sCluster.GET("/namespaces", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.GetNamespaces)
				k8sCluster.GET("/stats", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.GetClusterStats)
				k8sCluster.POST("/refresh", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.RefreshCluster)
				k8sCluster.GET("/resources/:kind", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.ListResources)
				k8sCluster.GET("/resources/:kind/:name/yaml", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.GetResourceYAML)
				k8sCluster.GET("/resources/:kind/:name", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.GetResource)
				k8sCluster.GET("/crds/:name/customresources", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.GetCRDCustomResources)
				k8sCluster.POST("/resources/:kind", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.CreateResource)
				k8sCluster.PUT("/resources/:kind/:name", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.UpdateResource)
				k8sCluster.DELETE("/resources/:kind/:name", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.DeleteResource)

				// 网络追踪（同属集群操作）
				k8sCluster.GET("/network/flows/topology", middleware.ModulePermissionMiddleware(r.db, "module:network:trace"), r.networkTraceHandler.GetTopology)
				k8sCluster.POST("/network/flows/enhance", middleware.ModulePermissionMiddleware(r.db, "module:network:trace"), r.networkTraceHandler.EnhanceTopology)
				k8sCluster.GET("/network/flows/traffic", middleware.ModulePermissionMiddleware(r.db, "module:network:trace"), r.networkTraceHandler.GetPodTraffic)
				k8sCluster.GET("/network/flows/list", middleware.ModulePermissionMiddleware(r.db, "module:network:trace"), r.networkTraceHandler.GetFlowList)
				k8sCluster.GET("/network/flows/timeseries", middleware.ModulePermissionMiddleware(r.db, "module:network:trace"), r.networkTraceHandler.GetTimeseries)
				k8sCluster.POST("/network/debug", middleware.ModulePermissionMiddleware(r.db, "module:network:trace"), r.networkTraceHandler.CreateDebug)
				k8sCluster.GET("/network/debug/logs", middleware.ModulePermissionMiddleware(r.db, "module:network:trace"), r.networkTraceHandler.GetDebugLogs)
			}
			protected.GET("/search/resources", middleware.NSPermissionMiddleware(r.db), r.k8sHandler.SearchResources)

			// 数据源管理
			ds := protected.Group("/datasources")
			ds.Use(middleware.ModulePermissionMiddleware(r.db, "module:data:manage"))
			{
				ds.POST("", r.dsHandler.CreateDataSource)
				ds.GET("", r.dsHandler.ListDataSources)
				ds.GET("/:id", r.dsHandler.GetDataSource)
				ds.PUT("/:id", r.dsHandler.UpdateDataSource)
				ds.DELETE("/:id", r.dsHandler.DeleteDataSource)
				ds.POST("/:id/test", r.dsHandler.TestConnection)
				ds.GET("/:id/metrics", r.dsHandler.GetMetrics)
				ds.POST("/:id/query", r.dsHandler.ProxyQuery)
			}

			// 仪表盘管理
			dashboards := protected.Group("/dashboards")
			dashboards.Use(middleware.ModulePermissionMiddleware(r.db, "module:dashboard"))
			{
				dashboards.POST("", r.dashboardHandler.CreateDashboard)
				dashboards.GET("", r.dashboardHandler.ListDashboards)
				dashboards.GET("/default", r.dashboardHandler.GetDefaultDashboard)
				dashboards.GET("/:id", r.dashboardHandler.GetDashboard)
				dashboards.PUT("/:id", r.dashboardHandler.UpdateDashboard)
				dashboards.DELETE("/:id", r.dashboardHandler.DeleteDashboard)
				// 面板
				dashboards.POST("/:id/panels", r.dashboardHandler.CreatePanel)
				dashboards.GET("/:id/panels", r.dashboardHandler.ListPanels)
				dashboards.PUT("/:id/panels/:panel_id", r.dashboardHandler.UpdatePanel)
				dashboards.DELETE("/:id/panels/:panel_id", r.dashboardHandler.DeletePanel)
			}

			// 巡检中心
			inspection := protected.Group("/inspection")
			inspection.Use(middleware.ModulePermissionMiddleware(r.db, "module:inspection"))
			{
				inspection.GET("/tasks", r.inspectionHandler.ListTasks)
				inspection.POST("/tasks", r.inspectionHandler.CreateTask)
				inspection.GET("/tasks/:id", r.inspectionHandler.GetTask)
				inspection.PUT("/tasks/:id", r.inspectionHandler.UpdateTask)
				inspection.DELETE("/tasks/:id", r.inspectionHandler.DeleteTask)
				inspection.POST("/tasks/:id/trigger", r.inspectionHandler.TriggerTask)
				inspection.POST("/quick", r.inspectionHandler.QuickInspect)

				inspection.GET("/jobs", r.inspectionHandler.ListJobs)
				inspection.GET("/jobs/:id", r.inspectionHandler.GetJob)
				inspection.GET("/jobs/:id/report", r.inspectionHandler.DownloadReport)
				inspection.GET("/results/:id", r.inspectionHandler.GetResult)
			}

			// AI 平台管理
			protected.GET("/ai/platforms/providers", middleware.AIPermissionMiddleware(r.db, "ai:platform:view"), r.aiPlatformHandler.ListProviderTypes)
			protected.GET("/ai/platforms", middleware.AIPermissionMiddleware(r.db, "ai:platform:view"), r.aiPlatformHandler.ListPlatforms)
			protected.POST("/ai/platforms", middleware.AIPermissionMiddleware(r.db, "ai:platform:manage"), r.aiPlatformHandler.CreatePlatform)
			protected.GET("/ai/platforms/:id", middleware.AIPermissionMiddleware(r.db, "ai:platform:view"), r.aiPlatformHandler.GetPlatform)
			protected.PUT("/ai/platforms/:id", middleware.AIPermissionMiddleware(r.db, "ai:platform:manage"), r.aiPlatformHandler.UpdatePlatform)
			protected.DELETE("/ai/platforms/:id", middleware.AIPermissionMiddleware(r.db, "ai:platform:manage"), r.aiPlatformHandler.DeletePlatform)
			protected.POST("/ai/platforms/:id/test", middleware.AIPermissionMiddleware(r.db, "ai:platform:test"), r.aiPlatformHandler.TestPlatformConnection)
			protected.POST("/ai/platforms/:id/default", middleware.AIPermissionMiddleware(r.db, "ai:platform:manage"), r.aiPlatformHandler.SetDefaultPlatform)

			// AI 会话管理
			protected.GET("/ai/sessions", middleware.AIPermissionMiddleware(r.db, "ai:session_manage"), r.aiChatSessionHandler.ListSessions)
			protected.POST("/ai/sessions", middleware.AIPermissionMiddleware(r.db, "ai:session_manage"), r.aiChatSessionHandler.CreateSession)
			protected.GET("/ai/sessions/:id/messages", middleware.AIPermissionMiddleware(r.db, "ai:session_manage"), r.aiChatSessionHandler.GetSessionMessages)
			protected.PUT("/ai/sessions/:id/platform", middleware.AIPermissionMiddleware(r.db, "ai:session_manage"), r.aiChatSessionHandler.UpdateSessionPlatform)
			protected.PUT("/ai/sessions/:id/title", middleware.AIPermissionMiddleware(r.db, "ai:session_manage"), r.aiChatSessionHandler.UpdateSessionTitle)
			protected.DELETE("/ai/sessions/:id/messages", middleware.AIPermissionMiddleware(r.db, "ai:session_manage"), r.aiChatSessionHandler.ClearSessionMessages)
			protected.DELETE("/ai/sessions/:id", middleware.AIPermissionMiddleware(r.db, "ai:session_manage"), r.aiChatSessionHandler.DeleteSession)

			// AI 对话
			protected.POST("/ai/chat", middleware.AIPermissionMiddleware(r.db, "ai:chat"), r.aiChatHandler.Chat)
			protected.POST("/ai/chat/stream", middleware.AIPermissionMiddleware(r.db, "ai:chat"), r.aiChatHandler.ChatStream)
			protected.POST("/ai/agent/chat/stream", middleware.AIPermissionMiddleware(r.db, "ai:chat"), r.aiChatHandler.AgentChatStream)

			protected.POST("/ai/chat/task", middleware.AIPermissionMiddleware(r.db, "ai:chat"), r.aiChatHandler.CreateTask)
			protected.GET("/ai/chat/task/:id", middleware.AIPermissionMiddleware(r.db, "ai:chat"), r.aiChatHandler.GetTask)

			// 网络追踪
			nt := protected.Group("/network-trace")
			nt.Use(middleware.ModulePermissionMiddleware(r.db, "module:network:trace"))
			{
				nt.GET("/config", r.networkTraceHandler.GetConfig)
				nt.PUT("/config", r.networkTraceHandler.UpdateConfig)
			}


			// 日志管理
			logs := protected.Group("/logs")
			logs.Use(middleware.ModulePermissionMiddleware(r.db, "module:log:manage"))
			{
				logs.POST("/query", r.logHandler.QueryLogs)
				logs.POST("/histogram", r.logHandler.QueryHistogram)
				logs.POST("/analyze", r.logHandler.AnalyzeLogs)
			}
			protected.GET("/log-backends", middleware.ModulePermissionMiddleware(r.db, "module:log:manage"), r.logHandler.ListLogBackends)
			protected.POST("/log-backends", middleware.ModulePermissionMiddleware(r.db, "module:log:manage"), r.logHandler.CreateLogBackend)
			protected.GET("/log-backends/:id", middleware.ModulePermissionMiddleware(r.db, "module:log:manage"), r.logHandler.GetLogBackend)
			protected.PUT("/log-backends/:id", middleware.ModulePermissionMiddleware(r.db, "module:log:manage"), r.logHandler.UpdateLogBackend)
			protected.DELETE("/log-backends/:id", middleware.ModulePermissionMiddleware(r.db, "module:log:manage"), r.logHandler.DeleteLogBackend)
			protected.GET("/log-backends/:id/test", middleware.ModulePermissionMiddleware(r.db, "module:log:manage"), r.logHandler.TestLogBackend)

			// 系统设置（需要系统设置权限）
			// 读取站点配置无需认证，登录页需要显示自定义 Logo 和名称
			v1.GET("/settings/site", r.settingHandler.GetSiteConfig)
			protected.PUT("/settings/site", middleware.ModulePermissionMiddleware(r.db, "module:system:settings"), r.settingHandler.UpdateSiteConfig)
			protected.POST("/settings/site/logo", middleware.ModulePermissionMiddleware(r.db, "module:system:settings"), r.settingHandler.UploadLogo)
		}
	}

	// Web Terminal (WebSocket)
	engine.GET("/ws/terminal", r.terminalHandler.Terminal)

	// K8s 资源变化推送 (WebSocket)
	engine.GET("/ws/k8s-events", func(c *gin.Context) {
		ws.ServeWs(c.Writer, c.Request)
	})

	// 内部 Agent 工具执行 API（仅允许本机访问）
	internal := engine.Group("/internal")
	internal.Use(func(c *gin.Context) {
		if c.ClientIP() != "127.0.0.1" && c.ClientIP() != "::1" && c.ClientIP() != "10.0.0.200" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		c.Next()
	})
	internal.POST("/agent/tool-execute", r.agentToolsHandler.ExecuteTool)
}
