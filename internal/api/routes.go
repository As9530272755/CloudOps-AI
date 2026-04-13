package api

import (
	"github.com/gin-gonic/gin"

	"github.com/cloudops/platform/internal/api/handlers"
	"github.com/cloudops/platform/internal/api/middleware"
	"github.com/cloudops/platform/internal/pkg/auth"
	"github.com/cloudops/platform/internal/service"
)

// Router API 路由
type Router struct {
	authHandler         *handlers.AuthHandler
	clusterHandler      *handlers.ClusterHandler
	k8sHandler          *handlers.K8sHandler
	dsHandler           *handlers.DatasourceHandler
	dashboardHandler    *handlers.DashboardHandler
	inspectionHandler   *handlers.InspectionHandler
	networkTraceHandler *handlers.NetworkTraceHandler
	jwtManager          *auth.JWTManager
}

// NewRouter 创建路由
func NewRouter(jwtManager *auth.JWTManager, clusterService *service.ClusterService, k8sService *service.K8sResourceService, dsService *service.DatasourceService, dashboardService *service.DashboardService, inspectionService *service.InspectionService, networkTraceService *service.NetworkTraceService) *Router {
	return &Router{
		authHandler:         handlers.NewAuthHandler(jwtManager),
		clusterHandler:      handlers.NewClusterHandler(clusterService),
		k8sHandler:          handlers.NewK8sHandler(k8sService),
		dsHandler:           handlers.NewDatasourceHandler(dsService),
		dashboardHandler:    handlers.NewDashboardHandler(dashboardService),
		inspectionHandler:   handlers.NewInspectionHandler(inspectionService),
		networkTraceHandler: handlers.NewNetworkTraceHandler(networkTraceService),
		jwtManager:          jwtManager,
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

			// 集群管理
			clusters := protected.Group("/clusters")
			{
				clusters.POST("", r.clusterHandler.CreateCluster)
				clusters.GET("", r.clusterHandler.ListClusters)
				clusters.GET("/:id", r.clusterHandler.GetCluster)
				clusters.DELETE("/:id", r.clusterHandler.DeleteCluster)
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

			// TODO: 添加更多路由
			// 日志管理
			// AI问答
			// 终端
			// 租户管理
		}
	}
}
