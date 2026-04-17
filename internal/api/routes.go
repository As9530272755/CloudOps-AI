package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/cloudops/platform/internal/api/handlers"
	"github.com/cloudops/platform/internal/api/middleware"
	"github.com/cloudops/platform/internal/pkg/auth"
	"github.com/cloudops/platform/internal/service"
)

// Router API 路由
type Router struct {
	authHandler          *handlers.AuthHandler
	clusterHandler       *handlers.ClusterHandler
	k8sHandler           *handlers.K8sHandler
	dsHandler            *handlers.DatasourceHandler
	dashboardHandler     *handlers.DashboardHandler
	inspectionHandler    *handlers.InspectionHandler
	networkTraceHandler  *handlers.NetworkTraceHandler
	aiConfigHandler      *handlers.AIConfigHandler
	aiPlatformHandler    *handlers.AIPlatformHandler
	aiChatSessionHandler *handlers.AIChatSessionHandler
	aiChatHandler        *handlers.AIChatHandler
	aiTaskService        *service.AITaskService
	agentService         *service.AgentService
	agentRuntimeProxy    *service.AgentRuntimeProxy
	agentToolsHandler    *handlers.AgentToolsHandler
	logHandler           *handlers.LogHandler
	settingHandler       *handlers.SettingHandler
	jwtManager           *auth.JWTManager
}

// NewRouter 创建路由
func NewRouter(jwtManager *auth.JWTManager, clusterService *service.ClusterService, k8sService *service.K8sResourceService, dsService *service.DatasourceService, dashboardService *service.DashboardService, inspectionService *service.InspectionService, networkTraceService *service.NetworkTraceService, aiConfigService *service.AIConfigService, aiPlatformService *service.AIPlatformService, aiChatSessionService *service.AIChatSessionService, aiService *service.AIService, aiTaskSvc *service.AITaskService, agentService *service.AgentService, agentRuntimeProxy *service.AgentRuntimeProxy, logService *service.LogService, settingService *service.SettingService) *Router {
	return &Router{
		authHandler:          handlers.NewAuthHandler(jwtManager),
		clusterHandler:       handlers.NewClusterHandler(clusterService),
		k8sHandler:           handlers.NewK8sHandler(k8sService),
		dsHandler:            handlers.NewDatasourceHandler(dsService),
		dashboardHandler:     handlers.NewDashboardHandler(dashboardService),
		inspectionHandler:    handlers.NewInspectionHandler(inspectionService),
		networkTraceHandler:  handlers.NewNetworkTraceHandler(networkTraceService),
		aiConfigHandler:      handlers.NewAIConfigHandler(aiConfigService, aiPlatformService),
		aiPlatformHandler:    handlers.NewAIPlatformHandler(aiPlatformService),
		aiChatSessionHandler: handlers.NewAIChatSessionHandler(aiChatSessionService),
		aiChatHandler:        handlers.NewAIChatHandler(aiService, aiTaskSvc, aiChatSessionService, agentService, agentRuntimeProxy),
		agentToolsHandler:    handlers.NewAgentToolsHandler(agentService),
		logHandler:           handlers.NewLogHandler(logService),
		settingHandler:       handlers.NewSettingHandler(settingService),
		jwtManager:           jwtManager,
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
		{
			// 用户信息
			protected.GET("/auth/profile", r.authHandler.GetProfile)

			// 集群管理
			clusters := protected.Group("/clusters")
			{
				clusters.POST("", r.clusterHandler.CreateCluster)
				clusters.GET("", r.clusterHandler.ListClusters)
				clusters.GET("/:id", r.clusterHandler.GetCluster)
				clusters.PUT("/:id", r.clusterHandler.UpdateCluster)
				clusters.DELETE("/:id", r.clusterHandler.DeleteCluster)
				clusters.POST("/test-and-probe", r.clusterHandler.TestAndProbeCluster)
			}

			// K8s 资源管理
			protected.GET("/clusters/:id/namespaces", r.k8sHandler.GetNamespaces)
			protected.GET("/clusters/:id/stats", r.k8sHandler.GetClusterStats)
			protected.POST("/clusters/:id/refresh", r.k8sHandler.RefreshCluster)
			protected.GET("/search/resources", r.k8sHandler.SearchResources)
			protected.GET("/clusters/:id/resources/:kind", r.k8sHandler.ListResources)
			protected.GET("/clusters/:id/resources/:kind/:name/yaml", r.k8sHandler.GetResourceYAML)
			protected.GET("/clusters/:id/resources/:kind/:name", r.k8sHandler.GetResource)

			// 数据源管理
			ds := protected.Group("/datasources")
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

			// AI 平台配置（旧版兼容）
			protected.GET("/settings/ai", r.aiConfigHandler.GetConfig)
			protected.PUT("/settings/ai", r.aiConfigHandler.UpdateConfig)
			protected.POST("/settings/ai/test", r.aiConfigHandler.TestConnection)
			protected.GET("/settings/ai/models", r.aiConfigHandler.GetModels)

			// AI 平台管理（新版）
			protected.GET("/ai/platforms", r.aiPlatformHandler.ListPlatforms)
			protected.POST("/ai/platforms", r.aiPlatformHandler.CreatePlatform)
			protected.GET("/ai/platforms/:id", r.aiPlatformHandler.GetPlatform)
			protected.PUT("/ai/platforms/:id", r.aiPlatformHandler.UpdatePlatform)
			protected.DELETE("/ai/platforms/:id", r.aiPlatformHandler.DeletePlatform)
			protected.POST("/ai/platforms/:id/test", r.aiPlatformHandler.TestPlatformConnection)
			protected.POST("/ai/platforms/:id/default", r.aiPlatformHandler.SetDefaultPlatform)

			// AI 会话管理
			protected.GET("/ai/sessions", r.aiChatSessionHandler.ListSessions)
			protected.POST("/ai/sessions", r.aiChatSessionHandler.CreateSession)
			protected.GET("/ai/sessions/:id/messages", r.aiChatSessionHandler.GetSessionMessages)
			protected.PUT("/ai/sessions/:id/platform", r.aiChatSessionHandler.UpdateSessionPlatform)
			protected.PUT("/ai/sessions/:id/title", r.aiChatSessionHandler.UpdateSessionTitle)
			protected.DELETE("/ai/sessions/:id/messages", r.aiChatSessionHandler.ClearSessionMessages)
			protected.DELETE("/ai/sessions/:id", r.aiChatSessionHandler.DeleteSession)

			// AI 对话
			protected.POST("/ai/chat", r.aiChatHandler.Chat)
			protected.POST("/ai/chat/stream", r.aiChatHandler.ChatStream)
			protected.POST("/ai/agent/chat/stream", r.aiChatHandler.AgentChatStream)

			protected.POST("/ai/chat/task", r.aiChatHandler.CreateTask)
			protected.GET("/ai/chat/task/:id", r.aiChatHandler.GetTask)
			// 网络追踪
			protected.GET("/network-trace/config", r.networkTraceHandler.GetConfig)
			protected.PUT("/network-trace/config", r.networkTraceHandler.UpdateConfig)
			protected.GET("/clusters/:id/network/flows/topology", r.networkTraceHandler.GetTopology)
			protected.POST("/clusters/:id/network/flows/enhance", r.networkTraceHandler.EnhanceTopology)
			protected.GET("/clusters/:id/network/flows/traffic", r.networkTraceHandler.GetPodTraffic)
			protected.GET("/clusters/:id/network/flows/list", r.networkTraceHandler.GetFlowList)
			protected.GET("/clusters/:id/network/flows/timeseries", r.networkTraceHandler.GetTimeseries)
			protected.POST("/clusters/:id/network/debug", r.networkTraceHandler.CreateDebug)
			protected.GET("/clusters/:id/network/debug/logs", r.networkTraceHandler.GetDebugLogs)

				// 日志管理
				protected.POST("/logs/query", r.logHandler.QueryLogs)
				protected.POST("/logs/histogram", r.logHandler.QueryHistogram)
				protected.POST("/logs/analyze", r.logHandler.AnalyzeLogs)
				protected.GET("/log-backends", r.logHandler.ListLogBackends)
				protected.POST("/log-backends", r.logHandler.CreateLogBackend)
				protected.GET("/log-backends/:id", r.logHandler.GetLogBackend)
				protected.PUT("/log-backends/:id", r.logHandler.UpdateLogBackend)
				protected.DELETE("/log-backends/:id", r.logHandler.DeleteLogBackend)
				protected.GET("/log-backends/:id/test", r.logHandler.TestLogBackend)

				// 系统设置
				protected.GET("/settings/site", r.settingHandler.GetSiteConfig)
				protected.PUT("/settings/site", r.settingHandler.UpdateSiteConfig)
				protected.POST("/settings/site/logo", r.settingHandler.UploadLogo)

				// TODO: 添加更多路由
				// AI问答
				// 终端
				// 租户管理
		}
	}

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
