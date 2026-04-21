package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/cloudops/platform/internal/service"
	"gorm.io/gorm"
)

// WriteResourceRequest 写操作请求体
type WriteResourceRequest struct {
	Manifest  map[string]interface{} `json:"manifest" binding:"required"`
	Namespace string                 `json:"namespace"`
}

// K8sHandler K8s资源处理器
type K8sHandler struct {
	k8sService  *service.K8sResourceService
	rbacService *service.RBACService
}

// NewK8sHandler 创建K8s处理器
func NewK8sHandler(k8sService *service.K8sResourceService, db *gorm.DB) *K8sHandler {
	return &K8sHandler{
		k8sService:  k8sService,
		rbacService: service.NewRBACService(db),
	}
}

// ListResources 统一资源列表接口（含权限过滤）
// GET /api/v1/clusters/:id/resources/:kind
func (h *K8sHandler) ListResources(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	kind := c.Param("kind")
	namespace := c.DefaultQuery("namespace", "")
	keyword := c.DefaultQuery("keyword", "")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 500 {
		limit = 500
	}

	// namespace 级用户权限校验
	userID := c.GetUint("user_id")
	role, _ := h.rbacService.GetUserEffectiveRole(c.Request.Context(), userID)
	isNsScoped := role != nil && role.Scope == "namespace"

	allowed, _ := h.rbacService.GetAllowedNamespaces(c.Request.Context(), userID, uint(clusterID))
	allowedSet := make(map[string]bool)
	for _, a := range allowed {
		allowedSet[a.Namespace] = true
	}

	if isNsScoped {
		// cluster-level 资源：直接拒绝
		clusterKinds := map[string]bool{
			"nodes": true, "namespaces": true, "persistentvolumes": true,
			"storageclasses": true, "clusterroles": true, "clusterrolebindings": true,
			"customresourcedefinitions": true,
		}
		if clusterKinds[kind] {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "权限不足"})
			return
		}

		// 没有任何 NS 授权：返回空结果
		if len(allowed) == 0 {
			c.JSON(http.StatusOK, gin.H{
				"success": true,
				"data": gin.H{"items": []interface{}{}, "total": 0, "page": page, "limit": limit},
			})
			return
		}

		// namespaced 资源：校验 namespace 参数
		if namespace != "" && namespace != "all" && !allowedSet[namespace] {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "无权限访问该命名空间"})
			return
		}
		if namespace == "" || namespace == "all" {
			namespace = allowed[0].Namespace
		}
	}

	items, total, err := h.k8sService.ListResources(c.Request.Context(), uint(clusterID), kind, namespace, keyword, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	// namespace 级用户查询 namespaces 资源时，过滤结果
	if isNsScoped && kind == "namespaces" {
		var filtered []map[string]interface{}
		for _, item := range items {
			if name, ok := item["name"].(string); ok && allowedSet[name] {
				filtered = append(filtered, item)
			}
		}
		items = filtered
		total = len(filtered)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items": items,
			"total": total,
			"page":  page,
			"limit": limit,
		},
	})
}

// GetResourceYAML 获取资源YAML
// GET /api/v1/clusters/:id/resources/:kind/:name/yaml
func (h *K8sHandler) GetResourceYAML(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	kind := c.Param("kind")
	name := c.Param("name")
	namespace := c.Query("namespace")

	yamlStr, err := h.k8sService.GetResourceYAML(c.Request.Context(), uint(clusterID), kind, namespace, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    yamlStr,
	})
}

// SearchResources 全局资源搜索
// GET /api/v1/search/resources?keyword=xxx&limit=20&kind=&namespace=&cluster_id=&label_selector=
func (h *K8sHandler) SearchResources(c *gin.Context) {
	keyword := c.Query("keyword")
	if keyword == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": []interface{}{}})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	kindFilter := c.Query("kind")
	nsFilter := c.Query("namespace")
	clusterFilter, _ := strconv.ParseUint(c.Query("cluster_id"), 10, 32)
	labelFilter := c.Query("label_selector")

	results, err := h.k8sService.SearchResources(c.Request.Context(), keyword, limit, kindFilter, nsFilter, uint(clusterFilter), labelFilter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    results,
	})
}

// GetResource 获取资源详情
// GET /api/v1/clusters/:id/resources/:kind/:name
// 或 GET /api/v1/clusters/:id/resources/:kind/:namespace/:name
func (h *K8sHandler) GetResource(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	kind := c.Param("kind")
	name := c.Param("name")
	namespace := c.Query("namespace")

	item, err := h.k8sService.GetResource(c.Request.Context(), uint(clusterID), kind, namespace, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    item,
	})
}

// GetCRDCustomResources 获取 CRD 下的 Custom Resource 实例列表
// GET /api/v1/clusters/:id/crds/:name/customresources?namespace=
func (h *K8sHandler) GetCRDCustomResources(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	crdName := c.Param("name")
	namespace := c.Query("namespace")

	items, err := h.k8sService.GetCRDCustomResources(c.Request.Context(), uint(clusterID), crdName, namespace)
	if err != nil {
		if err.Error() == "CRD 未找到" {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    items,
	})
}

// GetNamespaces 获取命名空间列表（按权限过滤）
// GET /api/v1/clusters/:id/namespaces
func (h *K8sHandler) GetNamespaces(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	items, err := h.k8sService.GetNamespaces(c.Request.Context(), uint(clusterID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 数据权限过滤
	userID := c.GetUint("user_id")
	role, _ := h.rbacService.GetUserEffectiveRole(c.Request.Context(), userID)
	isNsScoped := role != nil && role.Scope == "namespace"

	if isNsScoped {
		allowed, _ := h.rbacService.GetAllowedNamespaces(c.Request.Context(), userID, uint(clusterID))
		if len(allowed) == 0 {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "您没有该集群的访问权限"})
			return
		}
		allowedSet := make(map[string]bool)
		for _, a := range allowed {
			allowedSet[a.Namespace] = true
		}
		var filtered []string
		for _, ns := range items {
			if allowedSet[ns] {
				filtered = append(filtered, ns)
			}
		}
		items = filtered
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    items,
	})
}

// RefreshCluster 手动刷新集群缓存
// POST /api/v1/clusters/:id/refresh
func (h *K8sHandler) RefreshCluster(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	if err := h.k8sService.RefreshCluster(c.Request.Context(), uint(clusterID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "cluster cache refreshed",
	})
}

// GetClusterStats 获取集群统计概览
// GET /api/v1/clusters/:id/stats
func (h *K8sHandler) GetClusterStats(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	// 根据用户权限范围获取统计
	userID := c.GetUint("user_id")
	role, _ := h.rbacService.GetUserEffectiveRole(c.Request.Context(), userID)
	isNsScoped := role != nil && role.Scope == "namespace"

	var allowedNS []string
	if isNsScoped {
		allowed, _ := h.rbacService.GetAllowedNamespaces(c.Request.Context(), userID, uint(clusterID))
		if len(allowed) == 0 {
			c.JSON(http.StatusOK, gin.H{
				"success": true,
				"data":    map[string]interface{}{},
			})
			return
		}
		for _, a := range allowed {
			allowedNS = append(allowedNS, a.Namespace)
		}
	} else {
		allowedNS = []string{"*"}
	}

	stats, err := h.k8sService.GetClusterStats(c.Request.Context(), uint(clusterID), allowedNS)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}


// CreateResource 创建 K8s 资源
// POST /api/v1/clusters/:id/resources/:kind
func (h *K8sHandler) CreateResource(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	kind := c.Param("kind")
	var req WriteResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	result, err := h.k8sService.CreateResource(c.Request.Context(), uint(clusterID), kind, req.Namespace, req.Manifest)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// UpdateResource 更新 K8s 资源
// PUT /api/v1/clusters/:id/resources/:kind/:name
func (h *K8sHandler) UpdateResource(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	kind := c.Param("kind")
	name := c.Param("name")
	namespace := c.Query("namespace")
	var req WriteResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	result, err := h.k8sService.UpdateResource(c.Request.Context(), uint(clusterID), kind, namespace, name, req.Manifest)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// DeleteResource 删除 K8s 资源
// DELETE /api/v1/clusters/:id/resources/:kind/:name
func (h *K8sHandler) DeleteResource(c *gin.Context) {
	clusterID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid cluster id"})
		return
	}

	kind := c.Param("kind")
	name := c.Param("name")
	namespace := c.Query("namespace")

	if err := h.k8sService.DeleteResource(c.Request.Context(), uint(clusterID), kind, namespace, name); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "删除成功",
	})
}
