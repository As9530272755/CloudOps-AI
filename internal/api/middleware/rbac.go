package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ============================================
// 租户数据范围中间件
// ============================================

// TenantScopeMiddleware 租户数据范围中间件
// 自动为查询添加 tenant_id 过滤条件
func TenantScopeMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// superuser 不过滤租户
		if IsSuperuser(c) {
			c.Set("data_scope", "all")
			c.Next()
			return
		}

		tenantID := GetTenantID(c)
		if tenantID > 0 {
			c.Set("data_scope", "tenant")
			c.Set("current_tenant_id", tenantID)
		}

		c.Next()
	}
}

// GetDataScope 获取当前数据范围
func GetDataScope(c *gin.Context) string {
	if scope, exists := c.Get("data_scope"); exists {
		return scope.(string)
	}
	return "tenant"
}

// GetCurrentTenantID 获取当前租户ID
func GetCurrentTenantID(c *gin.Context) uint {
	if id, exists := c.Get("current_tenant_id"); exists {
		return id.(uint)
	}
	return GetTenantID(c)
}

// ============================================
// 功能模块权限中间件
// ============================================

// ModulePermissionMiddleware 功能模块权限校验中间件
func ModulePermissionMiddleware(db *gorm.DB, requiredModule string) gin.HandlerFunc {
	rbacService := service.NewRBACService(db)
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "未登录"})
			c.Abort()
			return
		}

		if !rbacService.HasPermission(c.Request.Context(), userID, requiredModule) {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"error":   "您没有访问该功能的权限: " + requiredModule,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// RequireSuperuser 需要 superuser
func RequireSuperuser() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !IsSuperuser(c) {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "需要系统管理员权限"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// ============================================
// K8s NS 级权限中间件
// ============================================

// NSPermissionMiddleware K8s 命名空间权限校验
func NSPermissionMiddleware(db *gorm.DB) gin.HandlerFunc {
	rbacService := service.NewRBACService(db)
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "未登录"})
			c.Abort()
			return
		}

		// 提取 cluster_id
		clusterID := extractClusterID(c)
		if clusterID == 0 {
			c.Next()
			return
		}

		// 提取 namespace
		namespace := extractNamespace(c)

		// 获取有效角色
		effectiveRole, err := rbacService.GetEffectiveRole(c.Request.Context(), userID, clusterID, namespace)
		if err != nil {
			if namespace != "" {
				c.JSON(http.StatusForbidden, gin.H{
					"success":   false,
					"error":     "您无权访问命名空间 " + namespace,
					"namespace": namespace,
				})
			} else {
				c.JSON(http.StatusForbidden, gin.H{
					"success":    false,
					"error":      "您无权访问该集群",
					"cluster_id": clusterID,
				})
			}
			c.Abort()
			return
		}

		// 检查具体资源权限
		resource, action := extractResourceAction(c)
		if resource != "" && !roleHasPermission(effectiveRole.Role, resource, action) {
			c.JSON(http.StatusForbidden, gin.H{
				"success":             false,
				"error":               "您没有 " + resource + ":" + action + " 权限",
				"required_permission": resource + ":" + action,
				"your_role":           effectiveRole.Role.Name,
			})
			c.Abort()
			return
		}

		// 将权限信息写入 Context
		c.Set("effective_role", effectiveRole.Role)
		c.Set("effective_role_source", effectiveRole.Source)
		c.Set("credential_level", roleToCredentialLevel(effectiveRole.Role))

		c.Next()
	}
}

// ============================================
// AI 权限中间件
// ============================================

// AIPermissionMiddleware AI 功能权限校验
func AIPermissionMiddleware(db *gorm.DB, requiredPermission string) gin.HandlerFunc {
	rbacService := service.NewRBACService(db)
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "未登录"})
			c.Abort()
			return
		}

		if !rbacService.HasPermission(c.Request.Context(), userID, requiredPermission) {
			c.JSON(http.StatusForbidden, gin.H{
				"success":  false,
				"error":    "您没有使用该 AI 功能的权限",
				"required": requiredPermission,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// ============================================
// 辅助函数
// ============================================

func extractClusterID(c *gin.Context) uint {
	// 从 URL 参数提取
	if id := c.Param("id"); id != "" {
		if n, err := strconv.ParseUint(id, 10, 32); err == nil {
			return uint(n)
		}
	}
	if id := c.Param("cluster_id"); id != "" {
		if n, err := strconv.ParseUint(id, 10, 32); err == nil {
			return uint(n)
		}
	}
	return 0
}

func extractNamespace(c *gin.Context) string {
	// 从查询参数提取
	if ns := c.Query("namespace"); ns != "" {
		return ns
	}
	// 从 URL 路径提取 /namespaces/:namespace/...
	path := c.Request.URL.Path
	parts := strings.Split(path, "/")
	for i, part := range parts {
		if part == "namespaces" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func extractResourceAction(c *gin.Context) (resource, action string) {
	method := c.Request.Method
	path := c.Request.URL.Path

	// 提取资源类型
	parts := strings.Split(path, "/")
	for i, part := range parts {
		if part == "resources" && i+1 < len(parts) {
			resource = parts[i+1]
			break
		}
		// 其他资源路径模式
		if part == "pods" || part == "deployments" || part == "services" ||
			part == "configmaps" || part == "secrets" || part == "events" ||
			part == "nodes" || part == "namespaces" {
			resource = part
		}
	}

	// URL 资源名（复数）→ 权限标识（单数）
	resourceMap := map[string]string{
		"pods":         "pod",
		"deployments":  "deployment",
		"services":     "service",
		"configmaps":   "configmap",
		"secrets":      "secret",
		"events":       "event",
		"nodes":        "node",
		"namespaces":   "namespace",
	}
	if mapped, ok := resourceMap[resource]; ok {
		resource = mapped
	}

	// 映射 HTTP 方法到 action
	switch method {
	case http.MethodGet:
		action = "read"
	case http.MethodPost:
		action = "write"
	case http.MethodPut, http.MethodPatch:
		action = "write"
	case http.MethodDelete:
		action = "delete"
	}

	return resource, action
}

func roleHasPermission(role *model.Role, resource, action string) bool {
	if role == nil {
		return false
	}
	// platform/cluster 级拥有所有权限
	if role.Scope == "platform" || role.Scope == "cluster" {
		return true
	}

	perms := parseJSONList(role.PermissionsData)
	target := resource + ":" + action

	for _, p := range perms {
		if p == target {
			return true
		}
		if p == "*:*" {
			return true
		}
		if p == resource+":*" {
			return true
		}
	}
	return false
}

func roleToCredentialLevel(role *model.Role) string {
	if role == nil {
		return "viewer"
	}
	switch role.Scope {
	case "platform", "cluster":
		return "admin"
	default:
		if role.Level >= 150 {
			return "admin"
		}
		if role.Level >= 120 {
			return "operator"
		}
		return "viewer"
	}
}

func parseJSONList(data string) []string {
	if data == "" {
		return []string{}
	}
	var list []string
	// 简单解析，实际用 json.Unmarshal
	data = strings.Trim(data, "[]")
	if data == "" {
		return []string{}
	}
	parts := strings.Split(data, ",")
	for _, p := range parts {
		p = strings.Trim(p, `" `)
		if p != "" {
			list = append(list, p)
		}
	}
	return list
}
