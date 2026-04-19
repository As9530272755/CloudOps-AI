package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/cloudops/platform/internal/model"
	"gorm.io/gorm"
)

var (
	ErrNoPermission          = errors.New("无权限")
	ErrNoResourcePermission  = errors.New("无资源权限")
	ErrCannotGrantHigherRole = errors.New("不能授予比自身更高的权限")
)

// RBACService 权限控制服务
type RBACService struct {
	db *gorm.DB
}

// NewRBACService 创建 RBAC 服务
func NewRBACService(db *gorm.DB) *RBACService {
	return &RBACService{db: db}
}

// EffectiveRole 用户在指定位置的有效角色信息
type EffectiveRole struct {
	Role      *model.Role
	Source    string // "role" | "namespace_grant"
	GrantID   uint
	IsExpired bool
}

// AllowedNamespace 用户有权限的命名空间
type AllowedNamespace struct {
	Namespace string      `json:"namespace"`
	Role      *model.Role `json:"role"`
	Source    string      `json:"source"`
}

// ============================================
// 权限查询
// ============================================

// GetUserRoles 获取用户的所有角色
func (s *RBACService) GetUserRoles(ctx context.Context, userID uint) ([]model.Role, error) {
	var user model.User
	if err := s.db.WithContext(ctx).Preload("Roles").First(&user, userID).Error; err != nil {
		return nil, err
	}
	return user.Roles, nil
}

// GetUserEffectiveRole 获取用户的最高级别有效角色
func (s *RBACService) GetUserEffectiveRole(ctx context.Context, userID uint) (*model.Role, error) {
	roles, err := s.GetUserRoles(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(roles) == 0 {
		return nil, ErrNoPermission
	}

	// 取最高 level 的角色
	var highest *model.Role
	for i := range roles {
		if highest == nil || roles[i].Level > highest.Level {
			highest = &roles[i]
		}
	}
	return highest, nil
}

// GetEffectiveRole 获取用户在指定集群+NS 的有效角色
// 优先级：集群级角色（platform/cluster scope）> NS 级授权
func (s *RBACService) GetEffectiveRole(ctx context.Context, userID, clusterID uint, namespace string) (*EffectiveRole, error) {
	// 第1步：检查用户角色是否为 platform/cluster 级（全局通行证）
	role, err := s.GetUserEffectiveRole(ctx, userID)
	if err != nil {
		return nil, err
	}

	if role.Scope == "platform" || role.Scope == "cluster" {
		return &EffectiveRole{
			Role:   role,
			Source: "role",
		}, nil
	}

	// 第2步：检查 NS 级授权
	if namespace != "" && clusterID > 0 {
		var nsGrant model.NamespaceGrant
		err := s.db.WithContext(ctx).
			Preload("Role").
			Where("user_id = ? AND cluster_id = ? AND namespace = ?", userID, clusterID, namespace).
			First(&nsGrant).Error
		if err == nil {
			if nsGrant.ExpiresAt == nil || nsGrant.ExpiresAt.After(time.Now()) {
				return &EffectiveRole{
					Role:   nsGrant.Role,
					Source: "namespace_grant",
					GrantID: nsGrant.ID,
				}, nil
			}
		}
	}

	// 第3步：用户有 namespace 级角色但无特定 NS 授权
	// 如果角色是 namespace 级，返回角色本身（用于全局 NS 列表等场景）
	if role.Scope == "namespace" {
		return &EffectiveRole{
			Role:   role,
			Source: "role",
		}, nil
	}

	return nil, ErrNoPermission
}

// GetAllowedNamespaces 获取用户在指定集群有权限的所有 NS
func (s *RBACService) GetAllowedNamespaces(ctx context.Context, userID, clusterID uint) ([]AllowedNamespace, error) {
	var result []AllowedNamespace

	// 先查用户角色
	role, err := s.GetUserEffectiveRole(ctx, userID)
	if err != nil {
		return nil, err
	}

	// 平台/集群级角色：可以访问所有 NS（但需要通过 K8s API 获取列表）
	if role.Scope == "platform" || role.Scope == "cluster" {
		// 这里返回一个标记，表示全部 NS
		result = append(result, AllowedNamespace{
			Namespace: "*",
			Role:      role,
			Source:    "role",
		})
		return result, nil
	}

	// NS 级角色：查 namespace_grants
	var nsGrants []model.NamespaceGrant
	err = s.db.WithContext(ctx).
		Preload("Role").
		Where("user_id = ? AND cluster_id = ?", userID, clusterID).
		Find(&nsGrants).Error
	if err != nil {
		return nil, err
	}

	for _, grant := range nsGrants {
		if grant.ExpiresAt != nil && grant.ExpiresAt.Before(time.Now()) {
			continue
		}
		r := grant.Role
		if r == nil {
			r = role
		}
		result = append(result, AllowedNamespace{
			Namespace: grant.Namespace,
			Role:      r,
			Source:    "namespace_grant",
		})
	}

	return result, nil
}

// GetDataScope 获取用户的数据权限范围
// 返回：scope (platform/cluster/namespace), 允许的NS列表, 允许的集群ID列表
// platform/cluster 级返回 allowedNS=["*"], allowedClusters=nil（表示不过滤集群）
// namespace 级返回具体的 namespace 列表和 cluster_id 列表
func (s *RBACService) GetDataScope(ctx context.Context, userID uint) (string, []string, []uint, error) {
	role, err := s.GetUserEffectiveRole(ctx, userID)
	if err != nil {
		return "", nil, nil, err
	}

	// platform 级：全部放行
	if role.Scope == "platform" {
		return "platform", []string{"*"}, nil, nil
	}

	// cluster 级：全部集群，全部 NS
	if role.Scope == "cluster" {
		return "cluster", []string{"*"}, nil, nil
	}

	// namespace 级：查询所有授权记录
	var grants []model.NamespaceGrant
	if err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Find(&grants).Error; err != nil {
		return "", nil, nil, err
	}

	nsSet := make(map[string]bool)
	clusterSet := make(map[uint]bool)
	now := time.Now()

	for _, g := range grants {
		if g.ExpiresAt != nil && g.ExpiresAt.Before(now) {
			continue
		}
		nsSet[g.Namespace] = true
		clusterSet[g.ClusterID] = true
	}

	var allowedNS []string
	for ns := range nsSet {
		allowedNS = append(allowedNS, ns)
	}

	var allowedClusters []uint
	for cid := range clusterSet {
		allowedClusters = append(allowedClusters, cid)
	}

	return "namespace", allowedNS, allowedClusters, nil
}

// ============================================
// 权限检查
// ============================================

// HasPermission 检查用户是否有指定权限
func (s *RBACService) HasPermission(ctx context.Context, userID uint, permission string) bool {
	perms, err := s.GetAllPermissions(ctx, userID)
	if err != nil {
		return false
	}
	return containsPermission(perms, permission)
}

// GetAllPermissions 获取用户的全部权限（角色默认 + 用户覆盖）
func (s *RBACService) GetAllPermissions(ctx context.Context, userID uint) ([]string, error) {
	// 1. 获取用户角色的权限
	role, err := s.GetUserEffectiveRole(ctx, userID)
	if err != nil {
		return nil, err
	}

	basePerms := s.parsePermissionsData(role.PermissionsData)

	// 2. 应用用户级覆盖
	var override model.UserModuleOverride
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&override).Error; err == nil {
		enabled := s.parseJSONList(override.EnabledModules)
		disabled := s.parseJSONList(override.DisabledModules)

		// 添加额外开启的
		for _, p := range enabled {
			if !contains(basePerms, p) {
				basePerms = append(basePerms, p)
			}
		}
		// 移除禁用的
		for _, p := range disabled {
			basePerms = removeString(basePerms, p)
		}
	}

	return basePerms, nil
}

// GetModulePermissions 获取用户的功能模块权限（module: 前缀）
func (s *RBACService) GetModulePermissions(ctx context.Context, userID uint) ([]string, error) {
	perms, err := s.GetAllPermissions(ctx, userID)
	if err != nil {
		return nil, err
	}

	var modules []string
	for _, p := range perms {
		if strings.HasPrefix(p, "module:") {
			modules = append(modules, p)
		}
		// 通配符拥有所有模块权限
		if p == "*:*" {
			return []string{
				"module:dashboard", "module:cluster:manage", "module:inspection",
				"module:network:trace", "module:data:manage", "module:log:manage",
				"module:terminal", "module:ai:assistant",
				"module:system:user", "module:system:tenant", "module:system:settings",
			}, nil
		}
	}
	return modules, nil
}

// GetAIPermissions 获取用户的 AI 权限（ai: 前缀）
func (s *RBACService) GetAIPermissions(ctx context.Context, userID uint) ([]string, error) {
	perms, err := s.GetAllPermissions(ctx, userID)
	if err != nil {
		return nil, err
	}

	var aiPerms []string
	for _, p := range perms {
		if strings.HasPrefix(p, "ai:") {
			aiPerms = append(aiPerms, p)
		}
		if p == "*:*" {
			return []string{
				"ai:chat", "ai:agent_chat", "ai:image_input", "ai:session_manage",
				"ai:platform:view", "ai:platform:manage", "ai:platform:test",
				"ai:log_analysis", "ai:network_analysis", "ai:inspection_analysis",
				"ai:tool:list_clusters", "ai:tool:cluster_status", "ai:tool:list_pods", "ai:tool:query_logs",
			}, nil
		}
	}
	return aiPerms, nil
}

// ============================================
// 授权管理
// ============================================

// GrantNamespaceRequest NS 授权请求
type GrantNamespaceRequest struct {
	UserID    uint
	ClusterID uint
	Namespace string
	RoleID    uint
	OperatorID uint
	ExpiresAt *time.Time
}

// GrantNamespace 授予用户 NS 权限
func (s *RBACService) GrantNamespace(ctx context.Context, req *GrantNamespaceRequest) (*model.NamespaceGrant, error) {
	// 检查操作者权限
	operatorRole, err := s.GetUserEffectiveRole(ctx, req.OperatorID)
	if err != nil {
		return nil, ErrNoPermission
	}

	// 检查目标角色等级
	var targetRole model.Role
	if err := s.db.First(&targetRole, req.RoleID).Error; err != nil {
		return nil, err
	}
	if targetRole.Level > operatorRole.Level {
		return nil, ErrCannotGrantHigherRole
	}

	// 检查是否已存在
	var existing model.NamespaceGrant
	err = s.db.Where("user_id = ? AND cluster_id = ? AND namespace = ?", req.UserID, req.ClusterID, req.Namespace).
		First(&existing).Error

	if err == nil {
		// 已存在，更新角色
		existing.RoleID = req.RoleID
		existing.GrantedBy = &req.OperatorID
		s.db.Save(&existing)
		return &existing, nil
	}

	// 创建新授权
	grant := &model.NamespaceGrant{
		UserID:    req.UserID,
		ClusterID: req.ClusterID,
		Namespace: req.Namespace,
		RoleID:    req.RoleID,
		GrantedBy: &req.OperatorID,
		GrantedAt: time.Now(),
		ExpiresAt: req.ExpiresAt,
	}

	if err := s.db.Create(grant).Error; err != nil {
		return nil, err
	}

	s.db.Preload("Role").Preload("User").Preload("Cluster").First(grant, grant.ID)
	return grant, nil
}

// RevokeNamespace 撤销用户 NS 权限
func (s *RBACService) RevokeNamespace(ctx context.Context, grantID, operatorID uint) error {
	var grant model.NamespaceGrant
	if err := s.db.First(&grant, grantID).Error; err != nil {
		return err
	}

	// 检查操作者是否有权限撤销
	operatorRole, err := s.GetUserEffectiveRole(ctx, operatorID)
	if err != nil {
		return ErrNoPermission
	}

	var grantRole model.Role
	if err := s.db.First(&grantRole, grant.RoleID).Error; err == nil {
		if grantRole.Level > operatorRole.Level {
			return ErrCannotGrantHigherRole
		}
	}

	return s.db.Delete(&grant).Error
}

// ListUserNamespaceGrants 查询用户的所有 NS 授权
func (s *RBACService) ListUserNamespaceGrants(ctx context.Context, userID uint) ([]model.NamespaceGrant, error) {
	var grants []model.NamespaceGrant
	err := s.db.WithContext(ctx).
		Preload("Role").
		Preload("Cluster").
		Where("user_id = ?", userID).
		Find(&grants).Error
	return grants, err
}

// ============================================
// 辅助函数
// ============================================

func (s *RBACService) parsePermissionsData(data string) []string {
	if data == "" {
		return []string{}
	}
	var perms []string
	if err := json.Unmarshal([]byte(data), &perms); err != nil {
		return []string{}
	}
	return perms
}

func (s *RBACService) parseJSONList(data string) []string {
	if data == "" {
		return []string{}
	}
	var list []string
	if err := json.Unmarshal([]byte(data), &list); err != nil {
		return []string{}
	}
	return list
}

func containsPermission(perms []string, target string) bool {
	for _, p := range perms {
		if p == target {
			return true
		}
		// 通配符
		if p == "*:*" {
			return true
		}
		// 资源通配符
		parts := strings.SplitN(target, ":", 2)
		if len(parts) == 2 {
			if p == parts[0]+":*" {
				return true
			}
		}
	}
	return false
}

func contains(list []string, item string) bool {
	for _, s := range list {
		if s == item {
			return true
		}
	}
	return false
}

func removeString(list []string, item string) []string {
	var result []string
	for _, s := range list {
		if s != item {
			result = append(result, s)
		}
	}
	return result
}

// ApplyTenantFilter 为 GORM 查询应用租户过滤
func ApplyTenantFilter(db *gorm.DB, tenantID uint) *gorm.DB {
	return db.Where("tenant_id = ?", tenantID)
}

// ApplyTenantFilterOptional 可选租户过滤（当 tenantID > 0 时应用）
func ApplyTenantFilterOptional(db *gorm.DB, tenantID uint) *gorm.DB {
	if tenantID > 0 {
		return db.Where("tenant_id = ?", tenantID)
	}
	return db
}
