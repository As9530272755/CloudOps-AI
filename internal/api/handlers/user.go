package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/database"
	"github.com/cloudops/platform/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"gorm.io/gorm"
)

// UserHandler 用户管理处理器
type UserHandler struct {
	db          *gorm.DB
	rbacService *service.RBACService
}

// NewUserHandler 创建用户管理处理器
func NewUserHandler(db *gorm.DB) *UserHandler {
	return &UserHandler{
		db:          db,
		rbacService: service.NewRBACService(db),
	}
}

// ListUsers 列出用户（支持租户过滤、分页、搜索）
func (h *UserHandler) ListUsers(c *gin.Context) {
	query := h.db.Model(&model.User{})

	// 非 superuser 只能看到本租户用户
	if !c.GetBool("is_superuser") {
		tenantID := c.GetUint("tenant_id")
		query = query.Where("tenant_id = ?", tenantID)
	}

	// 搜索
	keyword := c.Query("keyword")
	if keyword != "" {
		query = query.Where("username ILIKE ? OR email ILIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	// 分页
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 10
	}

	var total int64
	query.Count(&total)

	var users []model.User
	offset := (page - 1) * pageSize
	if err := query.Preload("Roles").Order("id DESC").Offset(offset).Limit(pageSize).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"list":      users,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}

// GetUser 获取用户详情
func (h *UserHandler) GetUser(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var user model.User
	query := h.db.Preload("Roles")

	// 非 superuser 只能查本租户
	if !c.GetBool("is_superuser") {
		tenantID := c.GetUint("tenant_id")
		query = query.Where("tenant_id = ?", tenantID)
	}

	if err := query.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "用户不存在"})
		return
	}

	// 查询 NS 授权
	nsGrants, _ := h.rbacService.ListUserNamespaceGrants(c.Request.Context(), uint(id))

	// 查询模块权限覆盖
	var override model.UserModuleOverride
	h.db.Where("user_id = ?", id).First(&override)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"user":              user,
			"namespace_grants":  nsGrants,
			"module_override":   override,
		},
	})
}

// CreateUserRequest 创建用户请求
type CreateUserRequest struct {
	Username        string   `json:"username" binding:"required"`
	Email           string   `json:"email" binding:"required,email"`
	Password        string   `json:"password" binding:"required,min=6"`
	TenantID        uint     `json:"tenant_id"`
	RoleIDs         []uint   `json:"role_ids"`
	IsActive        bool     `json:"is_active"`
	EnabledModules  []string `json:"enabled_modules"`
	DisabledModules []string `json:"disabled_modules"`
}

// CreateUser 创建用户
func (h *UserHandler) CreateUser(c *gin.Context) {
	var req CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": translateValidationError(err)})
		return
	}

	// 非 superuser 只能在本租户创建用户
	tenantID := req.TenantID
	if !c.GetBool("is_superuser") {
		tenantID = c.GetUint("tenant_id")
	}

	// 使用事务确保原子性
	tx := h.db.Begin()

	user := model.User{
		TenantID:     tenantID,
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: database.HashPassword(req.Password),
		IsActive:     req.IsActive,
	}

	if err := tx.Create(&user).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": translateDBError(err)})
		return
	}

	// 关联角色
	if len(req.RoleIDs) > 0 {
		var roles []model.Role
		tx.Find(&roles, req.RoleIDs)
		tx.Model(&user).Association("Roles").Append(&roles)
	}

	// 创建模块权限覆盖
	if len(req.EnabledModules) > 0 || len(req.DisabledModules) > 0 {
		enabledJSON, _ := json.Marshal(req.EnabledModules)
		disabledJSON, _ := json.Marshal(req.DisabledModules)
		override := model.UserModuleOverride{
			UserID:          user.ID,
			EnabledModules:  string(enabledJSON),
			DisabledModules: string(disabledJSON),
		}
		tx.Create(&override)
	}

	tx.Commit()
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": user})
}

// UpdateUserRequest 更新用户请求
type UpdateUserRequest struct {
	Email           string   `json:"email" binding:"omitempty,email"`
	Password        string   `json:"password"`
	RoleIDs         []uint   `json:"role_ids"`
	IsActive        *bool    `json:"is_active"`
	EnabledModules  []string `json:"enabled_modules"`
	DisabledModules []string `json:"disabled_modules"`
}

// UpdateUser 更新用户
func (h *UserHandler) UpdateUser(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var user model.User
	query := h.db
	if !c.GetBool("is_superuser") {
		tenantID := c.GetUint("tenant_id")
		query = query.Where("tenant_id = ?", tenantID)
	}
	if err := query.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "用户不存在"})
		return
	}

	var req UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": translateValidationError(err)})
		return
	}

	updates := make(map[string]interface{})
	if req.Email != "" {
		updates["email"] = req.Email
	}
	if req.Password != "" {
		updates["password_hash"] = database.HashPassword(req.Password)
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	if len(updates) > 0 {
		h.db.Model(&user).Updates(updates)
	}

	// 更新角色
	if len(req.RoleIDs) > 0 {
		var roles []model.Role
		h.db.Find(&roles, req.RoleIDs)
		h.db.Model(&user).Association("Roles").Replace(&roles)
	}

	// 更新模块权限覆盖
	if len(req.EnabledModules) > 0 || len(req.DisabledModules) > 0 {
		enabledJSON, _ := json.Marshal(req.EnabledModules)
		disabledJSON, _ := json.Marshal(req.DisabledModules)

		var override model.UserModuleOverride
		if err := h.db.Where("user_id = ?", user.ID).First(&override).Error; err != nil {
			// 不存在则创建
			override = model.UserModuleOverride{
				UserID:          user.ID,
				EnabledModules:  string(enabledJSON),
				DisabledModules: string(disabledJSON),
			}
			h.db.Create(&override)
		} else {
			h.db.Model(&override).Updates(map[string]interface{}{
				"enabled_modules":  string(enabledJSON),
				"disabled_modules": string(disabledJSON),
				"updated_at":       time.Now(),
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": user})
}

// ResetPasswordRequest 重置密码请求
type ResetPasswordRequest struct {
	Password string `json:"password" binding:"required,min=6"`
}

// ResetPassword 重置用户密码
func (h *UserHandler) ResetPassword(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	var user model.User
	query := h.db
	if !c.GetBool("is_superuser") {
		tenantID := c.GetUint("tenant_id")
		query = query.Where("tenant_id = ?", tenantID)
	}
	if err := query.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "用户不存在"})
		return
	}

	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": translateValidationError(err)})
		return
	}

	h.db.Model(&user).Update("password_hash", database.HashPassword(req.Password))
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "密码重置成功"})
}

// ToggleUserStatus 快速切换用户启用/禁用状态
func (h *UserHandler) ToggleUserStatus(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	// 不能禁用自己
	if uint(id) == c.GetUint("user_id") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "不能禁用自己"})
		return
	}

	var user model.User
	query := h.db
	if !c.GetBool("is_superuser") {
		tenantID := c.GetUint("tenant_id")
		query = query.Where("tenant_id = ?", tenantID)
	}
	if err := query.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "用户不存在"})
		return
	}

	var req struct {
		IsActive bool `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	h.db.Model(&user).Update("is_active", req.IsActive)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"is_active": req.IsActive}})
}

// DeleteUser 删除用户
func (h *UserHandler) DeleteUser(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 32)

	// 不能删除自己
	if uint(id) == c.GetUint("user_id") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "不能删除自己"})
		return
	}

	var user model.User
	query := h.db
	if !c.GetBool("is_superuser") {
		tenantID := c.GetUint("tenant_id")
		query = query.Where("tenant_id = ?", tenantID)
	}
	if err := query.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "用户不存在"})
		return
	}

	// 物理删除用户（包括关联数据）
	h.db.Unscoped().Where("user_id = ?", user.ID).Delete(&model.UserModuleOverride{})
	h.db.Unscoped().Where("user_id = ?", user.ID).Delete(&model.NamespaceGrant{})
	// 先删除 user_roles 关联（外键约束）
	h.db.Exec("DELETE FROM user_roles WHERE user_id = ?", user.ID)
	// 最后删除用户
	if err := h.db.Unscoped().Delete(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": translateDBError(err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetMyPermissions 获取当前用户权限
func (h *UserHandler) GetMyPermissions(c *gin.Context) {
	userID := c.GetUint("user_id")

	allPerms, err := h.rbacService.GetAllPermissions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	modules, _ := h.rbacService.GetModulePermissions(c.Request.Context(), userID)
	aiPerms, _ := h.rbacService.GetAIPermissions(c.Request.Context(), userID)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"permissions": allPerms,
			"modules":     modules,
			"ai":          aiPerms,
		},
	})
}

// GetMyMenus 获取当前用户可见菜单
func (h *UserHandler) GetMyMenus(c *gin.Context) {
	userID := c.GetUint("user_id")

	modules, err := h.rbacService.GetModulePermissions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	has := func(m string) bool {
		for _, mod := range modules {
			if mod == m {
				return true
			}
		}
		return false
	}

	type MenuItem struct {
		Path  string `json:"path"`
		Label string `json:"label"`
		Icon  string `json:"icon"`
	}

	type MenuGroup struct {
		Group string     `json:"group"`
		Items []MenuItem `json:"items"`
	}

	var menus []MenuGroup

	// 概览
	if has("module:dashboard") {
		menus = append(menus, MenuGroup{
			Group: "概览",
			Items: []MenuItem{{Path: "/", Label: "仪表盘", Icon: "dashboard"}},
		})
	}

	// KUBERNETES
	k8sItems := []MenuItem{}
	if has("module:cluster:manage") {
		k8sItems = append(k8sItems, MenuItem{Path: "/clusters", Label: "集群管理", Icon: "cluster"})
	}
	if has("module:inspection") {
		k8sItems = append(k8sItems, MenuItem{Path: "/inspection", Label: "巡检中心", Icon: "inspection"})
	}
	if has("module:network:trace") {
		k8sItems = append(k8sItems, MenuItem{Path: "/network-trace", Label: "网络追踪", Icon: "network"})
	}
	if has("module:data:manage") {
		k8sItems = append(k8sItems, MenuItem{Path: "/data", Label: "数据管理", Icon: "data"})
	}
	if len(k8sItems) > 0 {
		menus = append(menus, MenuGroup{Group: "Kubernetes", Items: k8sItems})
	}

	// 运维
	opsItems := []MenuItem{}
	if has("module:log:manage") {
		opsItems = append(opsItems, MenuItem{Path: "/logs", Label: "日志管理", Icon: "logs"})
	}
	if has("module:terminal") {
		opsItems = append(opsItems, MenuItem{Path: "/terminal", Label: "Web终端", Icon: "terminal"})
	}
	if len(opsItems) > 0 {
		menus = append(menus, MenuGroup{Group: "运维", Items: opsItems})
	}

	// 智能
	if has("module:ai:assistant") {
		menus = append(menus, MenuGroup{
			Group: "智能",
			Items: []MenuItem{{Path: "/ai", Label: "AI助手", Icon: "ai"}},
		})
	}

	// 系统
	sysItems := []MenuItem{}
	if has("module:system:user") {
		sysItems = append(sysItems, MenuItem{Path: "/users", Label: "用户管理", Icon: "users"})
	}
	if has("module:system:tenant") {
		sysItems = append(sysItems, MenuItem{Path: "/tenants", Label: "租户管理", Icon: "tenants"})
	}
	if has("module:system:settings") {
		sysItems = append(sysItems, MenuItem{Path: "/settings", Label: "系统设置", Icon: "settings"})
	}
	if len(sysItems) > 0 {
		menus = append(menus, MenuGroup{Group: "系统", Items: sysItems})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": menus})
}

// ListRoles 列出所有角色
func (h *UserHandler) ListRoles(c *gin.Context) {
	var roles []model.Role
	if err := h.db.Find(&roles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": roles})
}

// GrantNamespaceRequest NS 授权请求
type GrantNamespaceRequest struct {
	UserID     uint       `json:"user_id" binding:"required"`
	ClusterID  uint       `json:"cluster_id" binding:"required"`
	Namespace  string     `json:"namespace" binding:"required"`
	RoleID     uint       `json:"role_id" binding:"required"`
	ExpiresAt  *time.Time `json:"expires_at"`
}

// GrantNamespace 授予 NS 权限
func (h *UserHandler) GrantNamespace(c *gin.Context) {
	var req GrantNamespaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	operatorID := c.GetUint("user_id")
	grant, err := h.rbacService.GrantNamespace(c.Request.Context(), &service.GrantNamespaceRequest{
		UserID:     req.UserID,
		ClusterID:  req.ClusterID,
		Namespace:  req.Namespace,
		RoleID:     req.RoleID,
		OperatorID: operatorID,
		ExpiresAt:  req.ExpiresAt,
	})
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": grant})
}

// RevokeNamespace 撤销 NS 权限
func (h *UserHandler) RevokeNamespace(c *gin.Context) {
	grantID, _ := strconv.ParseUint(c.Param("grant_id"), 10, 32)
	operatorID := c.GetUint("user_id")

	if err := h.rbacService.RevokeNamespace(c.Request.Context(), uint(grantID), operatorID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetMyNamespaces 获取当前用户在集群下的可访问 NS
func (h *UserHandler) GetMyNamespaces(c *gin.Context) {
	userID := c.GetUint("user_id")
	clusterID, _ := strconv.ParseUint(c.Query("cluster_id"), 10, 32)

	allowed, err := h.rbacService.GetAllowedNamespaces(c.Request.Context(), userID, uint(clusterID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": allowed})
}

// translateValidationError 将 gin 验证错误翻译为中文
func translateValidationError(err error) string {
	if ve, ok := err.(validator.ValidationErrors); ok {
		var msgs []string
		for _, fe := range ve {
			field := fe.Field()
			tag := fe.Tag()
			switch tag {
			case "required":
				msgs = append(msgs, fmt.Sprintf("%s 不能为空", fieldToChinese(field)))
			case "email":
				msgs = append(msgs, fmt.Sprintf("%s 格式不正确", fieldToChinese(field)))
			case "min":
				msgs = append(msgs, fmt.Sprintf("%s 长度不能少于 %s 个字符", fieldToChinese(field), fe.Param()))
			default:
				msgs = append(msgs, fmt.Sprintf("%s 验证失败: %s", fieldToChinese(field), tag))
			}
		}
		return strings.Join(msgs, "；")
	}
	return err.Error()
}

func fieldToChinese(field string) string {
	m := map[string]string{
		"Username":  "用户名",
		"Email":     "邮箱",
		"Password":  "密码",
		"UserID":    "用户ID",
		"ClusterID": "集群ID",
		"Namespace": "命名空间",
		"RoleID":    "角色ID",
	}
	if v, ok := m[field]; ok {
		return v
	}
	return field
}

// translateDBError 将数据库错误翻译为中文
func translateDBError(err error) string {
	errStr := err.Error()
	if strings.Contains(errStr, "idx_tenant_username") {
		return "该用户名已存在"
	}
	if strings.Contains(errStr, "idx_tenant_email") {
		return "该邮箱已被使用"
	}
	if strings.Contains(errStr, "duplicate key") {
		return "数据重复，请检查用户名或邮箱是否已存在"
	}
	return errStr
}
