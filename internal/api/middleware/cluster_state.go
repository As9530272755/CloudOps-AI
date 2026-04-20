package middleware

import (
	"net/http"
	"strconv"

	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
)

// ClusterStateMiddleware 集群状态中间件：offline 集群直接拦截
func ClusterStateMiddleware(clusterService *service.ClusterService) gin.HandlerFunc {
	return func(c *gin.Context) {
		clusterIDStr := c.Param("id")
		if clusterIDStr == "" {
			c.Next()
			return
		}

		clusterID, err := strconv.ParseUint(clusterIDStr, 10, 32)
		if err != nil {
			c.Next()
			return
		}

		if !clusterService.IsClusterHealthy(uint(clusterID)) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "集群连接异常，请检查集群状态后重试",
				"code":  "CLUSTER_OFFLINE",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
