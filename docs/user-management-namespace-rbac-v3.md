# CloudOps Namespace 级别 RBAC 设计方案 V3

> **多维权限模型**：用户 × 集群 × 命名空间 × 角色，每个维度独立组合。
>
> **示例场景**：
> - 用户张三 在 **Cluster-A** 的 **NS-B** 是 **admin**
> - 用户张三 在 **Cluster-C** 的 **NS-A** 是 **viewer**
> - 用户张三 在 **Cluster-C** 的 **NS-C** 是 **viewer**
> - 用户李四 在 **Cluster-A** 的所有 NS 是 **cluster-admin**
> - 用户王五 在 **Cluster-B** 的 **NS-D** 是 **operator**

---

## 一、需求全景图

### 1.1 权限矩阵示例

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                         集  群  维  度                        │
                    ├───────────────┬───────────────┬───────────────┬─────────────┤
                    │   Cluster-A   │   Cluster-B   │   Cluster-C   │  Cluster-D  │
┌──────────┬────────┼───────┬───────┼───────┬───────┼───────┬───────┼──────┬──────┤
│          │        │ NS-A  │ NS-B  │ NS-A  │ NS-D  │ NS-A  │ NS-C  │ NS-X │ NS-Y │
├──────────┼────────┼───────┼───────┼───────┼───────┼───────┼───────┼──────┼──────┤
│          │ 张三   │  —    │ admin │  —    │  —    │ viewer│ viewer│  —   │  —   │
│  用户    ├────────┼───────┼───────┼───────┼───────┼───────┼───────┼──────┼──────┤
│  维度    │ 李四   │admin★ │admin★ │admin★ │admin★ │admin★ │admin★ │admin★│admin★│
│          ├────────┼───────┼───────┼───────┼───────┼───────┼───────┼──────┼──────┤
│          │ 王五   │  —    │  —    │  —    │operator│  —   │  —    │  —   │  —   │
│          ├────────┼───────┼───────┼───────┼───────┼───────┼───────┼──────┼──────┤
│          │ 赵六   │viewer │viewer │viewer │viewer │viewer │viewer │viewer│viewer│
└──────────┴────────┴───────┴───────┴───────┴───────┴───────┴───────┴──────┴──────┘

图例：
  —      = 未授权（该用户看不到此 NS）
  admin  = 命名空间管理员（该 NS 内所有权限）
  admin★ = 集群管理员（所有 NS 所有权限）
  viewer = 只读权限
  operator = 运维权限（可读+部分写，不能删 NS/改配额）
```

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **最小权限** | 用户默认无任何权限，逐 NS 授权 |
| **隔离性** | 未授权的 NS 对用户完全不可见（列表/API 双重过滤） |
| **一致性** | 同一用户在不同集群/NS 的权限互相独立，不继承 |
| **可降级** | 凭证按角色自动降级匹配（admin→operator→viewer） |
| **可审计** | 每次授权变更都记录审计日志 |

---

## 二、数据模型（完整版）

### 2.1 实体关系图

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│     users       │       │  role_templates  │       │    clusters     │
├─────────────────┤       ├──────────────────┤       ├─────────────────┤
│ id (PK)         │       │ id (PK)          │       │ id (PK)         │
│ username        │       │ name             │       │ name            │
│ email           │       │ scope            │◄──────┤ kubeconfig_xxx  │
│ password_hash   │       │ level            │       │ status          │
│ status          │       │ permissions []   │       └────────┬────────┘
│ created_at      │       │ description      │                │
└────────┬────────┘       └────────┬─────────┘                │
         │                         │                          │
         │    ┌────────────────────┘                          │
         │    │                                               │
         ▼    ▼                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        namespace_grants (核心表)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ id (PK)              │ 自增主键                                              │
│ user_id (FK)         │ ──► users.id      ON DELETE CASCADE                 │
│ cluster_id (FK)      │ ──► clusters.id   ON DELETE CASCADE                 │
│ namespace (VARCHAR)  │ 命名空间名称                                          │
│ role_template_id(FK) │ ──► role_templates.id                               │
│ granted_by (FK)      │ ──► users.id (谁授权的)                              │
│ granted_at           │ 授权时间                                              │
│ expires_at           │ 过期时间（NULL=永久）                                 │
├──────────────────────┴───────────────────────────────────────────────────────┤
│ UNIQUE(user_id, cluster_id, namespace)                                       │
│ INDEX(user_id, cluster_id)                                                   │
│ INDEX(cluster_id, namespace)                                                 │
└─────────────────────────────────────────────────────────────────────────────┘

         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        cluster_grants (集群级授权，可选)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ id (PK)              │ 自增主键                                              │
│ user_id (FK)         │ ──► users.id                                          │
│ cluster_id (FK)      │ ──► clusters.id                                       │
│ role_template_id(FK) │ ──► role_templates.id (scope=cluster/platform)        │
│ granted_by (FK)      │ ──► users.id                                          │
│ granted_at           │                                                       │
│ expires_at           │                                                       │
├──────────────────────┴───────────────────────────────────────────────────────┤
│ UNIQUE(user_id, cluster_id)                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 表结构（SQL DDL）

```sql
-- ============================================
-- 1. 角色模板表
-- ============================================
CREATE TABLE role_templates (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(64) NOT NULL UNIQUE,      -- "namespace-admin"
    display_name    VARCHAR(128) NOT NULL,            -- "命名空间管理员"
    scope           VARCHAR(32) NOT NULL DEFAULT 'namespace',
                                                    -- 'platform' | 'cluster' | 'namespace'
    level           INT NOT NULL DEFAULT 100,         -- 权限等级：platform=300, cluster-admin=200, operator=150, viewer=100
    permissions     JSONB NOT NULL DEFAULT '[]',      -- ["pod:read", "pod:delete", ...]
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 预置角色
INSERT INTO role_templates (name, display_name, scope, level, permissions) VALUES
('platform-admin',   '平台管理员',     'platform',  300, '["*:*"]'),
('cluster-admin',    '集群管理员',     'cluster',   200, '["*:*"]'),
('cluster-viewer',   '集群只读',       'cluster',   110, '["*:*:read","log:read","terminal:use"]'),
('namespace-admin',  '命名空间管理员', 'namespace', 150, '["pod:*","deployment:*","service:*","configmap:*","secret:*","event:read","log:read","terminal:use","namespace:read"]'),
('namespace-operator','命名空间运维',  'namespace', 120, '["pod:read","pod:write","pod:delete","deployment:read","deployment:write","service:read","service:write","configmap:read","configmap:write","event:read","log:read","terminal:use","namespace:read"]'),
('namespace-viewer', '命名空间只读',   'namespace', 100, '["pod:read","deployment:read","service:read","configmap:read","event:read","log:read","namespace:read"]');

-- ============================================
-- 2. 命名空间授权表（核心）
-- ============================================
CREATE TABLE namespace_grants (
    id              BIGSERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cluster_id      INT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    namespace       VARCHAR(253) NOT NULL,             -- K8s NS 最大 253 字符
    role_template_id INT NOT NULL REFERENCES role_templates(id),
    granted_by      INT REFERENCES users(id),          -- 谁授权的
    granted_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,                        -- NULL = 永久有效
    
    -- 一个用户在一个集群的一个 NS 只能有一个角色
    CONSTRAINT uq_ns_grant UNIQUE (user_id, cluster_id, namespace)
);

CREATE INDEX idx_ns_grant_user        ON namespace_grants(user_id);
CREATE INDEX idx_ns_grant_cluster     ON namespace_grants(cluster_id);
CREATE INDEX idx_ns_grant_cluster_ns  ON namespace_grants(cluster_id, namespace);
CREATE INDEX idx_ns_grant_user_cluster ON namespace_grants(user_id, cluster_id);
CREATE INDEX idx_ns_grant_expires     ON namespace_grants(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- 3. 集群级授权表（可选，用于全局管理员）
-- ============================================
CREATE TABLE cluster_grants (
    id              BIGSERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cluster_id      INT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    role_template_id INT NOT NULL REFERENCES role_templates(id),
    granted_by      INT REFERENCES users(id),
    granted_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    
    CONSTRAINT uq_cluster_grant UNIQUE (user_id, cluster_id),
    CONSTRAINT chk_cluster_scope CHECK (
        role_template_id IN (
            SELECT id FROM role_templates WHERE scope IN ('platform', 'cluster')
        )
    )
);

CREATE INDEX idx_cluster_grant_user ON cluster_grants(user_id);
CREATE INDEX idx_cluster_grant_cluster ON cluster_grants(cluster_id);

-- ============================================
-- 4. 用户组表（Phase 2）
-- ============================================
CREATE TABLE user_groups (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(128) NOT NULL UNIQUE,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE group_users (
    group_id        INT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

-- 用户组的 NS 授权（批量授权）
CREATE TABLE group_namespace_grants (
    id              BIGSERIAL PRIMARY KEY,
    group_id        INT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    cluster_id      INT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    namespace       VARCHAR(253) NOT NULL,
    role_template_id INT NOT NULL REFERENCES role_templates(id),
    granted_by      INT REFERENCES users(id),
    granted_at      TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_group_ns_grant UNIQUE (group_id, cluster_id, namespace)
);

-- ============================================
-- 5. 审计日志表
-- ============================================
CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    action          VARCHAR(32) NOT NULL,              -- GRANT / REVOKE / UPDATE
    resource_type   VARCHAR(32) NOT NULL,              -- "namespace_grant" / "cluster_grant"
    resource_id     BIGINT,
    user_id         INT,                                -- 被操作的用户
    cluster_id      INT,
    namespace       VARCHAR(253),
    old_role        VARCHAR(64),
    new_role        VARCHAR(64),
    operator_id     INT NOT NULL,                       -- 操作人
    operator_ip     INET,
    details         JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_operator ON audit_logs(operator_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
```

### 2.3 GORM 模型定义

```go
// internal/model/rbac.go

package model

import "time"

// RoleTemplate 角色模板
type RoleTemplate struct {
    ID          uint      `gorm:"primarykey" json:"id"`
    Name        string    `gorm:"uniqueIndex;size:64" json:"name"`
    DisplayName string    `gorm:"size:128" json:"display_name"`
    Scope       string    `gorm:"size:32;default:'namespace'" json:"scope"` // platform/cluster/namespace
    Level       int       `gorm:"default:100" json:"level"`
    Permissions JSON      `gorm:"type:jsonb" json:"permissions"`
    Description string    `json:"description"`
    CreatedAt   time.Time `json:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"`
}

// NamespaceGrant 命名空间级授权（核心）
type NamespaceGrant struct {
    ID             uint         `gorm:"primarykey" json:"id"`
    UserID         uint         `gorm:"not null;index" json:"user_id"`
    ClusterID      uint         `gorm:"not null;index" json:"cluster_id"`
    Namespace      string       `gorm:"not null;size:253;index" json:"namespace"`
    RoleTemplateID uint         `gorm:"not null" json:"role_template_id"`
    RoleTemplate   RoleTemplate `gorm:"foreignKey:RoleTemplateID" json:"role_template,omitempty"`
    GrantedBy      *uint        `json:"granted_by"`
    GrantedAt      time.Time    `json:"granted_at"`
    ExpiresAt      *time.Time   `json:"expires_at"`
    
    User    User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
    Cluster Cluster `gorm:"foreignKey:ClusterID" json:"cluster,omitempty"`
}

func (NamespaceGrant) TableName() string {
    return "namespace_grants"
}

// 联合唯一索引
func (n *NamespaceGrant) BeforeCreate(tx *gorm.DB) error {
    // 校验：一个用户在一个集群的一个 NS 只能有一个角色
    var count int64
    tx.Model(&NamespaceGrant{}).
        Where("user_id = ? AND cluster_id = ? AND namespace = ?", n.UserID, n.ClusterID, n.Namespace).
        Count(&count)
    if count > 0 {
        return errors.New("该用户在此集群的该命名空间已存在授权")
    }
    return nil
}

// ClusterGrant 集群级授权
type ClusterGrant struct {
    ID             uint         `gorm:"primarykey" json:"id"`
    UserID         uint         `gorm:"not null" json:"user_id"`
    ClusterID      uint         `gorm:"not null" json:"cluster_id"`
    RoleTemplateID uint         `gorm:"not null" json:"role_template_id"`
    RoleTemplate   RoleTemplate `gorm:"foreignKey:RoleTemplateID" json:"role_template,omitempty"`
    GrantedBy      *uint        `json:"granted_by"`
    GrantedAt      time.Time    `json:"granted_at"`
    ExpiresAt      *time.Time   `json:"expires_at"`
}

func (ClusterGrant) TableName() string {
    return "cluster_grants"
}

// UserGroup 用户组（Phase 2）
type UserGroup struct {
    ID          uint      `gorm:"primarykey" json:"id"`
    Name        string    `gorm:"uniqueIndex;size:128" json:"name"`
    Description string    `json:"description"`
    CreatedAt   time.Time `json:"created_at"`
    Users       []User    `gorm:"many2many:group_users;" json:"users,omitempty"`
}
```

---

## 三、权限校验引擎（完整实现）

### 3.1 核心服务接口

```go
// internal/service/rbac_service.go

package service

type RBACService struct {
    db *gorm.DB
}

func NewRBACService(db *gorm.DB) *RBACService {
    return &RBACService{db: db}
}

// ============================================
// 3.1.1 获取有效角色（核心算法）
// ============================================

// EffectiveRole 用户在指定位置的有效角色信息
type EffectiveRole struct {
    Role          *model.RoleTemplate
    Source        string  // "cluster_grant" | "namespace_grant" | "group_grant" | "default"
    GrantID       uint    // 授权记录 ID
    IsExpired     bool
}

// GetEffectiveRole 获取用户在指定集群+NS 的有效角色
// 优先级：集群级 > NS 级 > 用户组 NS 级
func (s *RBACService) GetEffectiveRole(ctx context.Context, userID, clusterID uint, namespace string) (*EffectiveRole, error) {
    
    // ─────────────────────────────────────────
    // 第 1 步：检查集群级授权（全局通行证）
    // ─────────────────────────────────────────
    var clusterGrant model.ClusterGrant
    err := s.db.WithContext(ctx).
        Preload("RoleTemplate").
        Where("user_id = ? AND cluster_id = ?", userID, clusterID).
        First(&clusterGrant).Error
    
    if err == nil {
        // 检查是否过期
        if clusterGrant.ExpiresAt != nil && clusterGrant.ExpiresAt.Before(time.Now()) {
            // 过期了，继续向下查
        } else {
            return &EffectiveRole{
                Role:      &clusterGrant.RoleTemplate,
                Source:    "cluster_grant",
                GrantID:   clusterGrant.ID,
                IsExpired: false,
            }, nil
        }
    }
    
    // ─────────────────────────────────────────
    // 第 2 步：检查 NS 级个人授权
    // ─────────────────────────────────────────
    if namespace != "" {
        var nsGrant model.NamespaceGrant
        err = s.db.WithContext(ctx).
            Preload("RoleTemplate").
            Where("user_id = ? AND cluster_id = ? AND namespace = ?", userID, clusterID, namespace).
            First(&nsGrant).Error
        
        if err == nil {
            if nsGrant.ExpiresAt != nil && nsGrant.ExpiresAt.Before(time.Now()) {
                // 过期了，继续查用户组
            } else {
                return &EffectiveRole{
                    Role:      &nsGrant.RoleTemplate,
                    Source:    "namespace_grant",
                    GrantID:   nsGrant.ID,
                    IsExpired: false,
                }, nil
            }
        }
    }
    
    // ─────────────────────────────────────────
    // 第 3 步：检查用户组 NS 授权（Phase 2）
    // ─────────────────────────────────────────
    // TODO: 查询用户所在的所有组，取最高权限
    
    // ─────────────────────────────────────────
    // 第 4 步：无任何授权
    // ─────────────────────────────────────────
    return nil, ErrNoPermission
}

// GetEffectiveRoleForResource 获取用户对特定资源的权限
func (s *RBACService) GetEffectiveRoleForResource(ctx context.Context, userID, clusterID uint, namespace, resource, action string) (*EffectiveRole, error) {
    // 先获取基础角色
    effectiveRole, err := s.GetEffectiveRole(ctx, userID, clusterID, namespace)
    if err != nil {
        return nil, err
    }
    
    // 检查具体资源权限
    if !effectiveRole.Role.HasPermission(resource, action) {
        return nil, ErrNoResourcePermission
    }
    
    return effectiveRole, nil
}

// ============================================
// 3.1.2 获取用户有权限的 NS 列表
// ============================================

// AllowedNamespace 用户有权限的命名空间
type AllowedNamespace struct {
    Namespace      string              `json:"namespace"`
    Role           *model.RoleTemplate `json:"role"`
    Source         string              `json:"source"`
}

// GetAllowedNamespaces 获取用户在指定集群有权限的所有 NS
func (s *RBACService) GetAllowedNamespaces(ctx context.Context, userID, clusterID uint) ([]AllowedNamespace, error) {
    var result []AllowedNamespace
    
    // 先查集群级授权
    var clusterGrant model.ClusterGrant
    err := s.db.WithContext(ctx).
        Preload("RoleTemplate").
        Where("user_id = ? AND cluster_id = ?", userID, clusterID).
        First(&clusterGrant).Error
    
    if err == nil && (clusterGrant.ExpiresAt == nil || clusterGrant.ExpiresAt.After(time.Now())) {
        // 集群级授权：返回该集群所有 NS（需要从 K8s 获取）
        // 这里标记为 "全部命名空间"
        allNS, err := s.getClusterAllNamespaces(clusterID)
        if err != nil {
            return nil, err
        }
        for _, ns := range allNS {
            result = append(result, AllowedNamespace{
                Namespace: ns,
                Role:      &clusterGrant.RoleTemplate,
                Source:    "cluster_grant",
            })
        }
        return result, nil
    }
    
    // 查 NS 级授权
    var nsGrants []model.NamespaceGrant
    err = s.db.WithContext(ctx).
        Preload("RoleTemplate").
        Where("user_id = ? AND cluster_id = ?", userID, clusterID).
        Find(&nsGrants).Error
    
    if err != nil {
        return nil, err
    }
    
    for _, grant := range nsGrants {
        if grant.ExpiresAt != nil && grant.ExpiresAt.Before(time.Now()) {
            continue // 跳过过期的
        }
        result = append(result, AllowedNamespace{
            Namespace: grant.Namespace,
            Role:      &grant.RoleTemplate,
            Source:    "namespace_grant",
        })
    }
    
    return result, nil
}

// ============================================
// 3.1.3 授权管理 CRUD
// ============================================

// GrantNamespace 授予用户 NS 权限
func (s *RBACService) GrantNamespace(ctx context.Context, req *GrantNamespaceRequest) (*model.NamespaceGrant, error) {
    // 1. 检查操作者权限
    operatorRole, err := s.GetEffectiveRole(ctx, req.OperatorID, req.ClusterID, req.Namespace)
    if err != nil {
        return nil, ErrNoPermission
    }
    // 只能授予比自己等级低或相等的角色
    targetRole, err := s.getRoleTemplate(req.RoleTemplateID)
    if err != nil {
        return nil, err
    }
    if targetRole.Level > operatorRole.Role.Level {
        return nil, ErrCannotGrantHigherRole
    }
    
    // 2. 检查是否已存在
    var existing model.NamespaceGrant
    err = s.db.Where("user_id = ? AND cluster_id = ? AND namespace = ?", req.UserID, req.ClusterID, req.Namespace).
        First(&existing).Error
    
    if err == nil {
        // 已存在，更新角色
        existing.RoleTemplateID = req.RoleTemplateID
        existing.GrantedBy = &req.OperatorID
        s.db.Save(&existing)
        s.logAudit(ctx, "UPDATE", &existing, req.OperatorID)
        return &existing, nil
    }
    
    // 3. 创建新授权
    grant := &model.NamespaceGrant{
        UserID:         req.UserID,
        ClusterID:      req.ClusterID,
        Namespace:      req.Namespace,
        RoleTemplateID: req.RoleTemplateID,
        GrantedBy:      &req.OperatorID,
        GrantedAt:      time.Now(),
        ExpiresAt:      req.ExpiresAt,
    }
    
    if err := s.db.Create(grant).Error; err != nil {
        return nil, err
    }
    
    s.db.Preload("RoleTemplate").Preload("User").Preload("Cluster").First(grant, grant.ID)
    s.logAudit(ctx, "GRANT", grant, req.OperatorID)
    return grant, nil
}

// RevokeNamespace 撤销用户 NS 权限
func (s *RBACService) RevokeNamespace(ctx context.Context, grantID, operatorID uint) error {
    var grant model.NamespaceGrant
    if err := s.db.First(&grant, grantID).Error; err != nil {
        return err
    }
    
    // 检查操作者是否有权限撤销
    operatorRole, err := s.GetEffectiveRole(ctx, operatorID, grant.ClusterID, grant.Namespace)
    if err != nil {
        return ErrNoPermission
    }
    
    grantRole, _ := s.getRoleTemplate(grant.RoleTemplateID)
    if grantRole.Level > operatorRole.Role.Level {
        return ErrCannotRevokeHigherRole
    }
    
    s.logAudit(ctx, "REVOKE", &grant, operatorID)
    return s.db.Delete(&grant).Error
}

// BatchGrantNamespace 批量授权（Phase 2）
func (s *RBACService) BatchGrantNamespace(ctx context.Context, req *BatchGrantRequest) ([]*model.NamespaceGrant, error) {
    var results []*model.NamespaceGrant
    for _, ns := range req.Namespaces {
        grant, err := s.GrantNamespace(ctx, &GrantNamespaceRequest{
            UserID:         req.UserID,
            ClusterID:      req.ClusterID,
            Namespace:      ns,
            RoleTemplateID: req.RoleTemplateID,
            OperatorID:     req.OperatorID,
            ExpiresAt:      req.ExpiresAt,
        })
        if err != nil {
            return results, err // 部分成功时返回已成功的
        }
        results = append(results, grant)
    }
    return results, nil
}
```

### 3.2 权限检查辅助方法

```go
// internal/model/role_template.go

package model

import "encoding/json"

// Permission 权限项
type Permission struct {
    Resource string `json:"resource"` // "pod", "deployment", "namespace"
    Action   string `json:"action"`   // "read", "write", "delete", "*"
}

// HasPermission 检查角色是否包含特定权限
func (r *RoleTemplate) HasPermission(resource, action string) bool {
    if r.Scope == "platform" || r.Scope == "cluster" {
        return true // 平台/集群管理员拥有所有权限
    }
    
    var permissions []Permission
    if err := json.Unmarshal(r.Permissions, &permissions); err != nil {
        return false
    }
    
    for _, p := range permissions {
        // 通配符匹配
        if p.Resource == "*" && p.Action == "*" {
            return true
        }
        if p.Resource == resource && (p.Action == "*" || p.Action == action) {
            return true
        }
        if p.Resource == resource+":*" && action != "" {
            return true
        }
    }
    return false
}

// GetCredentialLevel 根据角色获取凭证级别
func (r *RoleTemplate) GetCredentialLevel() string {
    switch r.Scope {
    case "platform", "cluster":
        return "admin"
    default:
        switch {
        case r.Level >= 150:
            return "admin"      // namespace-admin
        case r.Level >= 120:
            return "operator"   // namespace-operator
        default:
            return "viewer"     // namespace-viewer
        }
    }
}
```

---

## 四、Gin 中间件（完整版）

### 4.1 权限校验中间件

```go
// internal/api/middleware/rbac.go

package middleware

import (
    "net/http"
    "strconv"
    "strings"
    
    "github.com/gin-gonic/gin"
)

// RBACMiddleware 创建 RBAC 中间件
func RBACMiddleware(rbacService *service.RBACService) gin.HandlerFunc {
    return func(c *gin.Context) {
        userID := c.GetUint("user_id")
        if userID == 0 {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
            c.Abort()
            return
        }
        
        // ─────────────────────────────────────────
        // 1. 从 URL 提取 cluster_id 和 namespace
        // ─────────────────────────────────────────
        clusterID := extractClusterID(c)
        namespace := extractNamespace(c)
        
        // 如果请求不涉及集群资源（如用户管理、系统设置），跳过 NS 检查
        if clusterID == 0 {
            c.Next()
            return
        }
        
        // ─────────────────────────────────────────
        // 2. 获取有效角色
        // ─────────────────────────────────────────
        effectiveRole, err := rbacService.GetEffectiveRole(c.Request.Context(), userID, clusterID, namespace)
        if err != nil {
            if namespace != "" {
                c.JSON(http.StatusForbidden, gin.H{
                    "error": "您无权访问命名空间 " + namespace,
                    "cluster_id": clusterID,
                    "namespace": namespace,
                })
            } else {
                c.JSON(http.StatusForbidden, gin.H{
                    "error": "您无权访问该集群",
                    "cluster_id": clusterID,
                })
            }
            c.Abort()
            return
        }
        
        // ─────────────────────────────────────────
        // 3. 检查具体资源权限
        // ─────────────────────────────────────────
        resource, action := extractResourceAction(c)
        if resource != "" && !effectiveRole.Role.HasPermission(resource, action) {
            c.JSON(http.StatusForbidden, gin.H{
                "error": "您没有 " + resource + ":" + action + " 权限",
                "required_permission": resource + ":" + action,
                "your_role": effectiveRole.Role.Name,
            })
            c.Abort()
            return
        }
        
        // ─────────────────────────────────────────
        // 4. 将权限信息写入 Context，供 Handler 使用
        // ─────────────────────────────────────────
        c.Set("effective_role", effectiveRole.Role)
        c.Set("effective_role_source", effectiveRole.Source)
        c.Set("credential_level", effectiveRole.Role.GetCredentialLevel())
        
        c.Next()
    }
}

// 从 URL 提取 cluster_id
// 支持 /api/v1/clusters/:id/... 和 /api/v1/clusters/:id/namespaces/:ns/...
func extractClusterID(c *gin.Context) uint {
    if id := c.Param("cluster_id"); id != "" {
        if n, err := strconv.ParseUint(id, 10, 32); err == nil {
            return uint(n)
        }
    }
    return 0
}

// 从 URL 提取 namespace
func extractNamespace(c *gin.Context) string {
    // 路径模式：.../namespaces/:namespace/...
    path := c.Request.URL.Path
    parts := strings.Split(path, "/")
    for i, part := range parts {
        if part == "namespaces" && i+1 < len(parts) {
            return parts[i+1]
        }
    }
    return ""
}

// 从方法和路径提取资源与操作
func extractResourceAction(c *gin.Context) (resource, action string) {
    method := c.Request.Method
    path := c.Request.URL.Path
    
    // 提取资源类型
    parts := strings.Split(path, "/")
    for i, part := range parts {
        if part == "namespaces" && i+2 < len(parts) {
            resource = parts[i+2] // pods, deployments, services, etc.
            break
        }
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
```

### 4.2 路由注册示例

```go
// internal/api/router.go

func SetupRouter(r *gin.Engine, db *gorm.DB) {
    // ... 其他中间件
    
    rbacService := service.NewRBACService(db)
    rbacMiddleware := middleware.RBACMiddleware(rbacService)
    
    api := r.Group("/api/v1")
    
    // ── 需要认证的路由 ──
    auth := api.Use(middleware.JWTAuth())
    {
        // 用户管理（需要平台管理员）
        auth.GET("/users", middleware.RequirePlatformAdmin(), userHandler.List)
        auth.POST("/users", middleware.RequirePlatformAdmin(), userHandler.Create)
        
        // 集群资源（需要 RBAC）
        clusters := auth.Group("/clusters/:cluster_id")
        clusters.Use(rbacMiddleware)
        {
            // NS 列表（只返回有权限的）
            clusters.GET("/namespaces", k8sHandler.ListNamespaces)
            
            // NS 内资源
            ns := clusters.Group("/namespaces/:namespace")
            {
                ns.GET("/pods", k8sHandler.ListPods)
                ns.GET("/pods/:name", k8sHandler.GetPod)
                ns.POST("/pods/:name/exec", k8sHandler.ExecPod)      // 需要 terminal:use
                ns.GET("/pods/:name/logs", k8sHandler.GetPodLogs)    // 需要 log:read
                ns.DELETE("/pods/:name", k8sHandler.DeletePod)       // 需要 pod:delete
                
                ns.GET("/deployments", k8sHandler.ListDeployments)
                ns.POST("/deployments", k8sHandler.CreateDeployment) // 需要 deployment:write
                
                ns.GET("/services", k8sHandler.ListServices)
                ns.GET("/configmaps", k8sHandler.ListConfigMaps)
                ns.GET("/secrets", k8sHandler.ListSecrets)
                ns.GET("/events", k8sHandler.ListEvents)
            }
        }
        
        // 授权管理（需要集群/平台管理员）
        auth.GET("/users/:user_id/grants", grantHandler.ListUserGrants)
        auth.POST("/namespace-grants", grantHandler.CreateNamespaceGrant)
        auth.DELETE("/namespace-grants/:id", grantHandler.RevokeNamespaceGrant)
        auth.POST("/namespace-grants/batch", grantHandler.BatchGrant)
        
        // 当前用户权限查询
        auth.GET("/users/me/permissions", grantHandler.GetMyPermissions)
        auth.GET("/users/me/clusters/:cluster_id/namespaces", grantHandler.GetMyNamespaces)
    }
}
```

---

## 五、API 设计（完整版）

### 5.1 授权管理 API

```yaml
# 5.1.1 授予用户命名空间权限
POST /api/v1/namespace-grants
Request:
  {
    "user_id": 3,                    # 被授权用户
    "cluster_id": 5,                 # 集群
    "namespace": "ecommerce-prod",   # 命名空间
    "role_template_id": 5,           # namespace-admin 的角色模板 ID
    "expires_at": "2026-12-31T23:59:59Z"  # 可选，NULL=永久
  }

Response 201:
  {
    "id": 42,
    "user_id": 3,
    "cluster_id": 5,
    "namespace": "ecommerce-prod",
    "role_template": {
      "id": 5,
      "name": "namespace-admin",
      "display_name": "命名空间管理员",
      "scope": "namespace",
      "level": 150,
      "permissions": ["pod:*", "deployment:*", "service:*", ...]
    },
    "granted_by": 1,
    "granted_at": "2026-04-19T10:00:00Z",
    "expires_at": null
  }

Response 403:
  {
    "error": "您不能授予比自身更高的权限",
    "your_level": 150,
    "target_level": 200
  }

---

# 5.1.2 批量授权（同一集群，多个 NS）
POST /api/v1/namespace-grants/batch
Request:
  {
    "user_id": 3,
    "cluster_id": 5,
    "namespaces": ["ecommerce-prod", "payment-prod", "logistics-prod"],
    "role_template_id": 5
  }

Response 201:
  {
    "success": 3,
    "failed": 0,
    "grants": [
      { "id": 42, "namespace": "ecommerce-prod", "status": "created" },
      { "id": 43, "namespace": "payment-prod", "status": "created" },
      { "id": 44, "namespace": "logistics-prod", "status": "created" }
    ]
  }

---

# 5.1.3 撤销授权
DELETE /api/v1/namespace-grants/:id
Response 204: (no content)

Response 403:
  {
    "error": "您不能撤销高于自身权限的授权"
  }

---

# 5.1.4 查询用户的所有授权
GET /api/v1/users/:user_id/grants
Response 200:
  {
    "cluster_grants": [
      {
        "id": 10,
        "cluster_id": 5,
        "cluster_name": "生产集群A",
        "role": { "name": "cluster-admin", ... },
        "granted_at": "..."
      }
    ],
    "namespace_grants": [
      {
        "id": 42,
        "cluster_id": 5,
        "cluster_name": "生产集群A",
        "namespace": "ecommerce-prod",
        "role": { "name": "namespace-admin", ... },
        "granted_at": "..."
      },
      {
        "id": 43,
        "cluster_id": 5,
        "cluster_name": "生产集群A",
        "namespace": "payment-prod",
        "role": { "name": "namespace-viewer", ... },
        "granted_at": "..."
      },
      {
        "id": 50,
        "cluster_id": 8,
        "cluster_name": "预发集群B",
        "namespace": "ecommerce-stg",
        "role": { "name": "namespace-operator", ... },
        "granted_at": "..."
      }
    ]
  }

---

# 5.1.5 查询当前用户权限（前端按钮级权限用）
GET /api/v1/users/me/permissions?cluster=5&namespace=ecommerce-prod
Response 200:
  {
    "user_id": 3,
    "cluster_id": 5,
    "namespace": "ecommerce-prod",
    "role": {
      "name": "namespace-admin",
      "display_name": "命名空间管理员",
      "scope": "namespace",
      "level": 150
    },
    "permissions": {
      "pod": ["read", "write", "delete"],
      "deployment": ["read", "write", "delete"],
      "service": ["read", "write"],
      "configmap": ["read", "write"],
      "secret": ["read", "write"],
      "event": ["read"],
      "log": ["read"],
      "terminal": ["use"],
      "namespace": ["read"]
    },
    "credential_level": "admin",
    "source": "namespace_grant"
  }

---

# 5.1.6 查询当前用户在集群下可访问的 NS
GET /api/v1/users/me/clusters/:cluster_id/namespaces
Response 200:
  [
    {
      "namespace": "ecommerce-prod",
      "role": { "name": "namespace-admin", "display_name": "命名空间管理员" },
      "source": "namespace_grant"
    },
    {
      "namespace": "payment-prod",
      "role": { "name": "namespace-viewer", "display_name": "命名空间只读" },
      "source": "namespace_grant"
    },
    {
      "namespace": "logistics-prod",
      "role": { "name": "namespace-viewer", "display_name": "命名空间只读" },
      "source": "namespace_grant"
    }
    // kube-system 未授权，不返回
  ]
```

### 5.2 K8s 资源 API（权限过滤后）

```yaml
# 5.2.1 获取 NS 列表（已过滤）
GET /api/v1/clusters/:cluster_id/namespaces
Response 200:
  [
    { "name": "ecommerce-prod", "role": "namespace-admin", "status": "active" },
    { "name": "payment-prod", "role": "namespace-viewer", "status": "active" },
    { "name": "logistics-prod", "role": "namespace-viewer", "status": "active" }
  ]

# 5.2.2 获取 Pod 列表
GET /api/v1/clusters/:cluster_id/namespaces/:namespace/pods
# 中间件会检查：用户是否有该 NS 的 pod:read 权限

# 5.2.3 跨 NS 查询（如果用户有 cluster 级权限）
GET /api/v1/clusters/:cluster_id/pods?all_namespaces=true
# 中间件检查 cluster 级权限，然后聚合所有 NS 的结果

# 5.2.4 删除 Pod
DELETE /api/v1/clusters/:cluster_id/namespaces/:namespace/pods/:name
# 中间件检查：用户是否有该 NS 的 pod:delete 权限
```

---

## 六、前端交互设计（完整版）

### 6.1 用户管理 → 授权管理页面

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 用户管理 > 张三                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ [基本信息] [命名空间权限] [集群权限] [操作日志]                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  命名空间权限矩阵                                                           │
│  ═══════════════════════════════════════════════════════════════════════   │
│                                                                             │
│  生产集群 A (ID: 5)  ──────────────────────────────────────────────────    │
│  ┌────────────────┬──────────────┬────────────────┬──────────┐             │
│  │ 命名空间       │ 角色         │ 权限明细       │ 操作     │             │
│  ├────────────────┼──────────────┼────────────────┼──────────┤             │
│  │ ecommerce-prod │ 管理员 🔴    │ 全部权限       │ [编辑] [删除]│          │
│  │ payment-prod   │ 只读 🟢      │ pod读,deploy读 │ [编辑] [删除]│          │
│  │ logistics-prod │ 只读 🟢      │ pod读,deploy读 │ [编辑] [删除]│          │
│  └────────────────┴──────────────┴────────────────┴──────────┘             │
│  [+ 添加命名空间授权]                                                        │
│                                                                             │
│  预发集群 B (ID: 8)  ──────────────────────────────────────────────────    │
│  ┌────────────────┬──────────────┬────────────────┬──────────┐             │
│  │ 命名空间       │ 角色         │ 权限明细       │ 操作     │             │
│  ├────────────────┼──────────────┼────────────────┼──────────┤             │
│  │ ecommerce-stg  │ 运维 🟡      │ pod读写,deploy读│ [编辑] [删除]│         │
│  │ payment-stg    │ 运维 🟡      │ pod读写,deploy读│ [编辑] [删除]│         │
│  └────────────────┴──────────────┴────────────────┴──────────┘             │
│  [+ 添加命名空间授权]                                                        │
│                                                                             │
│  测试集群 C (ID: 12)  ─────────────────────────────────────────────────    │
│  ┌────────────────┬──────────────┬────────────────┬──────────┐             │
│  │ 命名空间       │ 角色         │ 权限明细       │ 操作     │             │
│  ├────────────────┼──────────────┼────────────────┼──────────┤             │
│  │ ecommerce-test │ 只读 🟢      │ 全部只读       │ [编辑] [删除]│          │
│  └────────────────┴──────────────┴────────────────┴──────────┘             │
│  [+ 添加命名空间授权]                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 添加/编辑授权弹窗

```
┌─────────────────────────────────────────────────────────────┐
│ 添加命名空间授权                           [X]              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  选择集群 *                                                  │
│  ┌─────────────────────────────────────┐                   │
│  │ ▼ 生产集群 A (10.0.0.100)           │                   │
│  └─────────────────────────────────────┘                   │
│                                                             │
│  选择命名空间 *（可多选）                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ☑ ecommerce-prod   ☐ kube-system   ☐ default       │   │
│  │ ☑ payment-prod     ☐ ingress-nginx  ☐ monitoring    │   │
│  │ ☑ logistics-prod   ☐ cattle-system  ☐ istio-system  │   │
│  │                                                     │   │
│  │ 系统命名空间已自动隐藏                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  选择角色 *                                                  │
│  ┌─────────────────────────────────────┐                   │
│  │ ○ 命名空间管理员（全部权限）           │                   │
│  │ ● 命名空间只读（只能查看）             │                   │
│  │ ○ 命名空间运维（可读写不能删NS）        │                   │
│  └─────────────────────────────────────┘                   │
│                                                             │
│  过期时间（可选）                                             │
│  ┌─────────────────────────────────────┐                   │
│  │ 永久有效                            │                   │
│  └─────────────────────────────────────┘                   │
│                                                             │
│              [取消]              [确认授权]                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 集群详情 → 用户权限 Tab

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 集群管理 > 生产集群 A > 用户权限                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  按命名空间查看：                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 全部 │ ecommerce-prod │ payment-prod │ logistics-prod │ kube-system │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  当前查看：ecommerce-prod                                                   │
│  ┌──────────┬────────────────┬──────────────┬──────────┐                   │
│  │ 用户名   │ 角色           │ 授权来源     │ 操作     │                   │
│  ├──────────┼────────────────┼──────────────┼──────────┤                   │
│  │ 张三     │ 命名空间管理员 │ 个人授权     │ [编辑] [删除]│               │
│  │ 李四     │ 集群管理员     │ 集群级授权   │ —        │                   │
│  │ 王五     │ 命名空间只读   │ 个人授权     │ [编辑] [删除]│               │
│  │ 赵六     │ 命名空间运维   │ 用户组-运维组│ [编辑] [删除]│               │
│  └──────────┴────────────────┴──────────────┴──────────┘                   │
│  [+ 添加用户到该命名空间]                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.4 前端权限 Hook（React）

```typescript
// frontend/src/hooks/usePermission.ts

import { useQuery } from '@tanstack/react-query';
import { api } from '../utils/api';

export interface NSPermission {
  role: {
    name: string;
    display_name: string;
    scope: string;
    level: number;
  };
  permissions: Record<string, string[]>;
  credential_level: string;
  source: string;
}

export function useNSPermission(clusterID: number, namespace: string) {
  const { data, isLoading } = useQuery<NSPermission>({
    queryKey: ['permission', clusterID, namespace],
    queryFn: async () => {
      const res = await api.get(`/users/me/permissions`, {
        params: { cluster: clusterID, namespace }
      });
      return res.data;
    },
    enabled: !!clusterID && !!namespace,
    staleTime: 5 * 60 * 1000, // 5 分钟缓存
  });

  const hasPermission = (resource: string, action: string): boolean => {
    if (!data) return false;
    if (data.role.scope === 'platform' || data.role.scope === 'cluster') return true;
    const actions = data.permissions[resource] || [];
    return actions.includes('*') || actions.includes(action);
  };

  return {
    permission: data,
    isLoading,
    // 常用权限快捷方法
    canReadPod: hasPermission('pod', 'read'),
    canDeletePod: hasPermission('pod', 'delete'),
    canWriteDeployment: hasPermission('deployment', 'write'),
    canUseTerminal: hasPermission('terminal', 'use'),
    canReadLog: hasPermission('log', 'read'),
    canDeleteNamespace: hasPermission('namespace', 'delete'),
    // 凭证级别
    credentialLevel: data?.credential_level || 'viewer',
    // 是否管理员
    isAdmin: data?.role?.scope === 'platform' || data?.role?.scope === 'cluster',
  };
}

// 使用示例
// PodListPage.tsx
const PodListPage = ({ clusterID, namespace }: { clusterID: number; namespace: string }) => {
  const { canDeletePod, canUseTerminal, isAdmin } = useNSPermission(clusterID, namespace);

  return (
    <Table>
      {pods.map(pod => (
        <TableRow key={pod.name}>
          <TableCell>{pod.name}</TableCell>
          <TableCell>
            {canUseTerminal && (
              <IconButton onClick={() => openTerminal(pod.name)} title="终端">
                <TerminalIcon />
              </IconButton>
            )}
            {canDeletePod && (
              <IconButton onClick={() => deletePod(pod.name)} color="error" title="删除">
                <DeleteIcon />
              </IconButton>
            )}
          </TableCell>
        </TableRow>
      ))}
    </Table>
  );
};
```

---

## 七、边界情况与冲突处理

### 7.1 权限冲突矩阵

```
场景：用户同时有多个授权来源

┌─────────────────────────┬────────────────────────┬────────────────────────┐
│ 集群级授权              │ NS 级授权              │ 有效结果               │
├─────────────────────────┼────────────────────────┼────────────────────────┤
│ cluster-admin (level 200)│ NS-A: viewer (100)    │ cluster-admin ★        │
│ cluster-viewer (level 110)│ NS-A: admin (150)    │ NS-A: admin            │
│ 无                      │ NS-A: viewer (100)     │ NS-A: viewer           │
│ 无                      │ 组授权: admin (150)    │ NS-A: admin            │
│ 无                      │ 个人: viewer + 组: admin│ 取最高: admin          │
│ cluster-admin           │ 组授权: viewer         │ cluster-admin ★        │
└─────────────────────────┴────────────────────────┴────────────────────────┘

规则：
  ★ 集群级授权优先级最高（一旦拥有 cluster 级角色，覆盖所有 NS 级授权）
  个人 NS 授权与用户组 NS 授权冲突时，取 level 最高的
  同 level 时，个人授权优先于组授权
```

### 7.2 过期时间处理

```go
// 每日定时任务（或查询时实时检查）
func (s *RBACService) CleanupExpiredGrants() {
    now := time.Now()
    
    // 删除过期的 NS 授权
    s.db.Where("expires_at IS NOT NULL AND expires_at < ?", now).
        Delete(&model.NamespaceGrant{})
    
    // 删除过期的集群授权
    s.db.Where("expires_at IS NOT NULL AND expires_at < ?", now).
        Delete(&model.ClusterGrant{})
    
    // 记录审计日志
    // ...
}
```

### 7.3 删除 NS / 删除集群时的级联

```sql
-- 命名空间被删除时，自动清理相关授权
-- 由 K8s event watcher 触发
DELETE FROM namespace_grants WHERE cluster_id = ? AND namespace = ?;

-- 集群被删除时，自动清理所有相关授权
-- ON DELETE CASCADE 已配置
```

### 7.4 凭证降级处理

```
用户角色: namespace-admin (需要 admin 凭证)
集群凭证: 只有 viewer 凭证

处理：
  1. 后端 SelectCredential → 最高可用 = viewer
  2. 返回 Warning Header: "X-Permission-Downgrade: admin→viewer"
  3. 前端显示提示：
     "⚠️ 您的角色为命名空间管理员，但该集群未配置 admin 凭证，
      当前操作使用只读凭证，部分功能可能不可用"
```

---

## 八、实施计划（最终版）

### Phase 1：基础 NS 级授权（3 周）

| 周 | 任务 | 交付物 |
|----|------|--------|
| W1 | 数据库表 + GORM 模型 + 角色模板 | migration, model 代码 |
| W1 | RBAC Service 核心算法 | GetEffectiveRole, Grant/Revoke |
| W2 | Gin 中间件 + 权限校验 | rbac.go middleware |
| W2 | 授权管理 API | POST/DELETE /namespace-grants |
| W2 | 用户管理 API 集成 | 用户 CRUD + 密码策略 |
| W3 | 前端：授权管理页面 | 用户详情页 NS 权限矩阵 |
| W3 | 前端：权限 Hook | useNSPermission |
| W3 | 前端：按钮级权限 | Pod/Deployment 列表操作按钮控制 |

### Phase 2：批量授权 + 用户组（2 周）

| 周 | 任务 | 交付物 |
|----|------|--------|
| W4 | 批量授权 API + 前端 | 多选 NS 批量授权 |
| W4 | 用户组 CRUD | group API |
| W4 | 用户组 NS 授权 | group_namespace_grants |
| W5 | 冲突处理 + 过期清理 | cron job |
| W5 | 审计日志 | audit_logs 表 + 查询 API |

### Phase 3：高级功能（2 周）

| 周 | 任务 | 交付物 |
|----|------|--------|
| W6 | LDAP/OIDC 集成 | 外部认证 |
| W6 | K8s RBAC 同步（可选） | 从 RoleBinding 同步 |
| W7 | NS 自动发现 | 新 NS 创建事件监听 |
| W7 | 性能优化 | 权限缓存（Redis） |

---

## 九、与 KubeSphere 的关系

### 9.1 共存策略

```
KubeSphere                          CloudOps
──────────                          ────────
用户管理（企业用户）                  用户管理（独立）
  ↓                                    ↓
K8s RBAC (RoleBinding)              NamespaceGrant
  ↓                                    ↓
通过 kubeconfig 生效                通过 CloudOps 凭证路由生效

两套系统互不干扰：
  • KubeSphere 用户登录 KubeSphere 控制台
  • CloudOps 用户登录 CloudOps 平台
  • 同一个 kubeconfig 可以在两套系统中使用
  • 权限各自管理，可能不一致（设计如此）
```

### 9.2 未来可选：LDAP 统一认证

```
Phase 3 可以接入 LDAP：

  LDAP Server
      │
  ┌───┴───┐
  ▼       ▼
KubeSphere   CloudOps
   │           │
   └── 同一套用户账号 ──┘
   
但权限仍然各自管理（NS 授权不互通）
```

---

*方案版本：V3（NS 级完整方案）*
*撰写日期：2026-04-19*
*适用：用户 × 集群 × 命名空间 × 角色 四维权限模型*
