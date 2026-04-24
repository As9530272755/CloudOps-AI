package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimitMiddleware 简单的 per-IP 限流中间件（60 req/min）
// 用于保护 /clusters/:id/resources/:kind 等高频率接口，
// 防止 23 集群 × 4000 Pod 场景下用户快速刷新导致后端过载。
func RateLimitMiddleware() gin.HandlerFunc {
	type visitor struct {
		count   int
		resetAt time.Time
	}
	var mu sync.Mutex
	visitors := make(map[string]*visitor)

	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()

		mu.Lock()
		v, exists := visitors[ip]
		if !exists || now.After(v.resetAt) {
			v = &visitor{count: 0, resetAt: now.Add(time.Minute)}
			visitors[ip] = v
		}
		v.count++
		count := v.count
		mu.Unlock()

		if count > 60 {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "请求过于频繁，请稍后再试"})
			return
		}
		c.Next()
	}
}
