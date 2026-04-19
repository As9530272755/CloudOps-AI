# CloudOps 用户管理模块设计方案

> 参考 Rancher、KubeSphere、OpenShift 等开源多集群平台的用户管理实践，结合 CloudOps 20+ 集群 / 10000+ Pod 的运维场景设计。
>
> 状态：方案阶段，待评审后进入开发。

---

## 一、现状分析

### 1.1 已有基础

| 组件 | 状态 | 说明 |
|------|------|------|
| `Tenant` | ✅ 存在 | 租户模型（默认租户 `default`） |
| `User` | ✅ 存在 | 用户模型（bcrypt 密码、JWT 认证） |
| `Role` | ✅ 存在 | 角色模型（admin / operator / viewer） |
| `Permission` | ✅ 存在 | 权限点（cluster:read/write, pod:read 等） |
| `ClusterPermission` | ✅ 存在 | 集群-用户关联表 |
| 默认账号 | ✅ 存在 | `admin / admin` |

### 1.2 当前痛点

- 角色固定为 3 个，无法自定义
- 权限点为硬编码，不支持动态扩展
- 没有"用户组/部门"概念，只能逐个用户授权
- 集群权限只有"有/无"，没有粒度控制（如某用户只能看 A 集群的 Pod，不能操作 Deployment）
- 没有操作审计日志，无法追溯"谁删了 Pod"
- 没有账号生命周期管理（锁定、过期、密码策略）
- 不支持外部认证（LDAP / OIDC / SSO）

---

## 二、开源项目参考分析

### 2.1 Rancher（三层 RBAC）

```
Global Level        → 全局管理员、用户管理、集群接入
    ↓
Cluster Level       → 集群 Owner / Member / ReadOnly
    ↓
Project Level       → 项目 Owner / Member / ReadOnly
```

**核心设计**：
- **RoleTemplate**：角色模板可继承，支持自定义
- **Project**：Namespace 的逻辑分组（等同于 K8s 的命名空间组）
- **ClusterRoleTemplateBinding (CRTB)**：用户 ↔ 集群角色模板绑定
- **ProjectRoleTemplateBinding (PRTB)**：用户 ↔ 项目角色模板绑定
- **外部认证集成**：GitHub、LDAP、Azure AD、SAML 开箱即用

**可借鉴点**：
- 三层权限模型（全局 → 集群 → 项目）与多集群场景天然匹配
- 角色模板继承机制减少重复配置
- 外部认证集成降低账号管理成本

### 2.2 KubeSphere（四层 RBAC）

```
Platform  (平台级)   → 平台管理员、用户管理、集群管理
    ↓
Cluster   (集群级)   → 集群管理员、观察者
    ↓
Workspace (企业空间) → 跨集群共享资源、项目创建
    ↓
Project   (项目级)   → 命名空间内的资源操作
```

**核心设计**：
- **Workspace**：最小租户单元，支持跨集群、跨项目资源共享
- **企业空间角色绑定**：成员通过邀请加入，权限可控
- **资源配额**：Workspace / Project 级别限制 CPU、内存、存储
- **内置角色模板**：viewer / operator / admin 覆盖四个层级

**可借鉴点**：
- Workspace 的"邀请制"适合内部团队协作
- 资源配额与权限绑定，实现真正的多租户隔离
- 前端按钮级权限控制（根据 RoleTemplate 决定是否渲染）

### 2.3 Kubernetes 原生 RBAC

```yaml
# Role（命名空间级）
Role / RoleBinding
# ClusterRole（集群级）
ClusterRole / ClusterRoleBinding
```

**可借鉴点**：
- Role + RoleBinding 组合可实现"定义一次，多处复用"
- 建议显式列出 verbs 和 resources，避免 wildcard

---

## 三、CloudOps 用户管理方案设计

### 3.1 总体架构

采用 **"三层 + 一扩展"** 模型：

```
┌─────────────────────────────────────────────┐
│  Platform Layer    平台层                    │
│  全局管理员 / 平台设置 / 租户管理              │
├─────────────────────────────────────────────┤
│  Cluster Layer     集群层                    │
│  集群管理员 / 集群观察者 / 集群运维            │
├─────────────────────────────────────────────┤
│  Resource Layer    资源层                    │
│  命名空间管理员 / 只读用户 / 自定义角色         │
├─────────────────────────────────────────────┤
│  Extension Layer   扩展层（可选）             │
│  部门/用户组 / 审批流 / 审计日志               │
└─────────────────────────────────────────────┘
```

### 3.2 数据模型设计

#### 3.2.1 用户与认证（User）

```go
type User struct {
    ID              uint      `gorm:"primaryKey"`
    TenantID        uint      // 所属租户
    Username        string    `gorm:"uniqueIndex"`
    Email           string
    PasswordHash    string
    DisplayName     string    // 显示名
    Phone           string
    Avatar          string    // 头像 URL
    
    // 账号生命周期
    Status          string    // active / locked / expired / pending
    LastLoginAt     *time.Time
    PasswordChangedAt time.Time
    LoginFailCount  int       // 连续失败次数
    LockedUntil     *time.Time
    
    // 扩展
    IsSuperuser     bool      // 超管（无视所有权限检查）
    ExternalID      string    // 外部认证系统 ID（LDAP/OIDC）
    Source          string    // local / ldap / oidc / sso
    
    Roles           []Role    `gorm:"many2many:user_roles;"`
    CreatedAt       time.Time
    UpdatedAt       time.Time
}
```

#### 3.2.2 角色模板（RoleTemplate）

> 参考 Rancher RoleTemplate，支持继承和自定义

```go
type RoleTemplate struct {
    ID          uint      `gorm:"primaryKey"`
    Name        string    `gorm:"uniqueIndex"`  // 编码名，如 cluster-admin
    DisplayName string                         // 显示名，如 "集群管理员"
    Description string
    
    // 层级范围
    Scope       string    // platform / cluster / resource
    
    // 权限列表（JSON 数组）
    RulesJSON   string    // [{"resource":"pod","verbs":["get","list"]}, ...]
    
    // 继承
    ParentID    *uint     // 继承自哪个角色模板
    
    // 内置角色不可删除
    IsSystem    bool      
    IsDefault   bool      // 新用户默认授予
    
    CreatedAt   time.Time
}
```

**内置角色模板**：

| 层级 | 角色编码 | 显示名 | 说明 |
|------|---------|--------|------|
| platform | `platform-admin` | 平台管理员 | 全部权限 |
| platform | `platform-auditor` | 平台审计员 | 只读 + 审计日志 |
| cluster | `cluster-admin` | 集群管理员 | 管理指定集群全部资源 |
| cluster | `cluster-operator` | 集群运维 | 查看 + 操作 Pod/Deployment/Service |
| cluster | `cluster-viewer` | 集群观察者 | 只能查看 |
| resource | `namespace-admin` | 命名空间管理员 | 管理指定 NS 内资源 |
| resource | `namespace-operator` | 命名空间运维 | 查看 + 操作指定 NS |
| resource | `namespace-viewer` | 命名空间只读 | 只能查看指定 NS |

#### 3.2.3 权限点（Permission）

> 参考 K8s RBAC 的 resource + verb 模型，改为平台级权限点

```go
type Permission struct {
    ID          uint
    Code        string    `gorm:"uniqueIndex"`  // 编码，如 "pod:read"
    Resource    string                         // 资源类型：cluster / node / pod / deployment / service / event / log / terminal / inspection / ai / dashboard / datasource / setting
    Verbs       string                         // 操作：read / write / delete / execute / admin
    DisplayName string
    Description string
}
```

**权限点矩阵（示例）**：

| 资源 | read | write | delete | execute | admin |
|------|------|-------|--------|---------|-------|
| cluster | 查看集群列表 | 添加/编辑集群 | 删除集群 | — | — |
| node | 查看节点 | — | — | — | — |
| pod | 查看 Pod | — | 删除 Pod | 进入终端 | — |
| deployment | 查看 | 扩缩容/镜像更新 | — | — | — |
| service | 查看 | — | — | — | — |
| event | 查看 | — | — | — | — |
| log | 查看日志 | — | — | — | — |
| terminal | — | — | — | 使用 Web Terminal | — |
| inspection | 查看巡检结果 | 创建/执行巡检 | — | — | — |
| ai | 使用 AI 助手 | — | — | — | — |
| dashboard | 查看面板 | 编辑面板 | 删除面板 | — | — |
| setting | 查看设置 | 修改设置 | — | — | — |
| user | 查看用户 | 添加/编辑用户 | 删除用户 | — | — |
| role | 查看角色 | 添加/编辑角色 | 删除角色 | — | — |

#### 3.2.4 集群授权（ClusterGrant）

> 用户与集群的授权关系，替代现有的 `ClusterPermission`

```go
type ClusterGrant struct {
    ID              uint
    UserID          uint
    ClusterID       uint
    RoleTemplateID  uint      // 使用的角色模板
    
    // 可选：更细粒度的命名空间限制
    NamespaceScope  string    // 空=全部命名空间，否则为逗号分隔的 NS 列表
    
    GrantedBy       uint      // 谁授权的
    GrantedAt       time.Time
    ExpiresAt       *time.Time // 过期时间（可选）
    
    // K8s RBAC 同步状态
    K8sSynced       bool      // 是否已同步到对应集群的 K8s RBAC
    K8sSyncError    string
}
```

#### 3.2.5 用户组/部门（UserGroup）

> 参考 KubeSphere 的企业空间成员管理，支持批量授权

```go
type UserGroup struct {
    ID          uint
    TenantID    uint
    Name        string
    Description string
    Users       []User `gorm:"many2many:group_users;"`
    
    // 组级别的集群授权
    ClusterGrants []ClusterGrant `gorm:"polymorphic:Subject;"` // 或单独 GroupClusterGrant 表
}
```

> ⚠️ **Phase 1 暂不实现用户组**，先支持单个用户授权，后续迭代加入。

#### 3.2.6 审计日志（AuditLog）

```go
type AuditLog struct {
    ID          uint
    UserID      uint
    Username    string
    TenantID    uint
    
    Action      string    // CREATE / UPDATE / DELETE / LOGIN / LOGOUT / EXECUTE
    Resource    string    // cluster / pod / deployment / user / role ...
    ResourceID  string    // 资源 ID
    ResourceName string
    
    // 请求详情
    Method      string    // GET / POST / PUT / DELETE
    Path        string    // API 路径
    ClientIP    string
    UserAgent   string
    
    // 变更内容（JSON）
    BeforeJSON  string    // 变更前
    AfterJSON   string    // 变更后
    
    StatusCode  int       // HTTP 状态码
    Error       string    // 错误信息
    
    Duration    int64     // 请求耗时 ms
    CreatedAt   time.Time
}
```

### 3.3 权限校验流程

```
请求进入
    ↓
[1] JWT 认证 → 获取 UserID
    ↓
[2] 权限检查中间件
    ├─ 路由元数据：required_permission = "pod:delete"
    ├─ 查询用户拥有的所有 RoleTemplate
    ├─ 合并所有 RoleTemplate 的 Rules
    ├─ 检查是否包含 "pod:delete"
    └─ 不包含 → 403 Forbidden
    ↓
[3] 集群/资源级检查（如请求涉及特定集群）
    ├─ 查询 ClusterGrant：用户是否对该集群有权限？
    ├─ 检查命名空间范围（NamespaceScope）
    └─ 无权限 → 403 Forbidden
    ↓
[4] 执行 Handler
    ↓
[5] 审计日志记录（异步写入）
```

### 3.4 与 K8s RBAC 的同步机制

> 参考 Rancher 的 CRTB/PRTB 同步到 K8s RBAC 的设计

CloudOps 本身不替代 K8s RBAC，而是**桥接**到自己的权限模型：

```
CloudOps 权限模型                    K8s 集群
─────────────────                    ───────
User + ClusterGrant + RoleTemplate
        ↓
    同步模块 (Syncer)
        ↓
在目标集群创建：
- ServiceAccount（每个用户一个）
- Role / ClusterRole（根据 RoleTemplate 规则）
- RoleBinding / ClusterRoleBinding
```

**同步触发时机**：
1. 用户被授权新集群时
2. 用户的 ClusterGrant 被修改时
3. RoleTemplate 规则被修改时
4. 定时全量同步（兜底）

**同步失败处理**：
- `ClusterGrant.K8sSynced = false`
- `ClusterGrant.K8sSyncError = 错误信息`
- 前端显示 "K8s 权限同步失败" 提示

> ⚠️ **Phase 1 暂不实现 K8s RBAC 同步**，只在 CloudOps 层做权限控制。后续 Phase 2 再实现桥接，避免引入过多复杂度。

### 3.5 前端交互设计

#### 3.5.1 用户管理页面

```
用户管理
├── 用户列表
│   ├── 搜索（用户名/邮箱/手机号）
│   ├── 状态筛选（全部/正常/锁定/过期）
│   ├── 批量操作（锁定/解锁/删除）
│   └── 操作列（编辑 / 授权集群 / 重置密码 / 查看审计日志）
├── 新增用户
│   ├── 基本信息（用户名/邮箱/手机号/显示名）
│   ├── 初始密码（随机生成 / 手动输入）
│   └── 角色授权（选择 RoleTemplate）
├── 用户详情
│   ├── 基本信息
│   ├── 所属角色
│   ├── 已授权集群（列表 + 角色）
│   └── 最近操作日志
└── 个人设置（当前登录用户）
    ├── 修改密码
    ├── 修改头像/显示名
    └── 登录历史
```

#### 3.5.2 角色管理页面

```
角色管理
├── 角色列表
│   ├── 层级筛选（平台/集群/资源）
│   ├── 系统角色标记（不可删除）
│   └── 操作列（编辑 / 删除 / 查看绑定用户）
├── 新增/编辑角色
│   ├── 基本信息（名称/显示名/描述/层级）
│   ├── 权限矩阵（表格勾选：资源 × 操作）
│   ├── 继承设置（继承自哪个角色）
│   └── 预览（该角色能访问的页面/按钮）
└── 角色详情
    ├── 权限列表
    └── 绑定用户列表
```

#### 3.5.3 集群授权页面

```
集群授权
├── 按集群维度
│   └── 集群列表 → 点击集群 → 已授权用户列表 → 添加用户/修改角色/移除
├── 按用户维度
│   └── 用户列表 → 点击用户 → 已授权集群列表 → 添加集群/修改角色/移除
└── 批量授权
    └── 选择多个用户 + 选择多个集群 + 统一角色 → 一键授权
```

#### 3.5.4 审计日志页面

```
审计日志
├── 日志列表
│   ├── 时间范围筛选
│   ├── 用户筛选
│   ├── 操作类型筛选（CREATE/UPDATE/DELETE/LOGIN/EXECUTE）
│   ├── 资源类型筛选
│   └── 导出 CSV
└── 日志详情弹窗
    ├── 操作人信息
    ├── 请求详情（Method/Path/IP）
    ├── 变更前后对比（JSON diff）
    └── 响应状态
```

### 3.6 API 设计（核心接口）

```
# 用户管理
GET    /api/v1/users                    # 用户列表（分页+筛选）
POST   /api/v1/users                    # 创建用户
GET    /api/v1/users/:id                # 用户详情
PUT    /api/v1/users/:id                # 更新用户
DELETE /api/v1/users/:id                # 删除用户
PUT    /api/v1/users/:id/password       # 重置密码
PUT    /api/v1/users/:id/status         # 修改状态（锁定/解锁）
GET    /api/v1/users/:id/grants         # 用户的集群授权列表
POST   /api/v1/users/:id/grants         # 给用户授权集群
DELETE /api/v1/users/:id/grants/:gid    # 移除集群授权

# 角色管理
GET    /api/v1/role-templates           # 角色模板列表
POST   /api/v1/role-templates           # 创建角色模板
GET    /api/v1/role-templates/:id       # 角色详情
PUT    /api/v1/role-templates/:id       # 更新角色
DELETE /api/v1/role-templates/:id       # 删除角色
GET    /api/v1/permissions              # 权限点列表（用于前端矩阵）

# 审计日志
GET    /api/v1/audit-logs               # 审计日志列表（分页+筛选）
GET    /api/v1/audit-logs/:id           # 日志详情
GET    /api/v1/audit-logs/export        # 导出 CSV

# 个人中心
GET    /api/v1/me                       # 当前用户信息
PUT    /api/v1/me/password              # 修改密码
GET    /api/v1/me/login-history         # 登录历史
GET    /api/v1/me/permissions           # 当前用户权限列表（前端按钮级控制用）
```

### 3.7 密码与账号安全策略

| 策略项 | 建议配置 | 说明 |
|--------|---------|------|
| 密码最小长度 | 8 位 | 可配置 |
| 密码复杂度 | 大小写+数字+特殊字符 | 可配置 |
| 密码有效期 | 90 天 | 可配置，0=永不过期 |
| 历史密码禁止 | 最近 5 次 | 不可重复使用 |
| 连续失败锁定 | 5 次失败锁定 30 分钟 | 可配置 |
| 首次登录改密 | 强制 | 管理员重置密码后首次登录必须修改 |
| 会话超时 | 24 小时无操作自动登出 | 可配置 |
| 并发登录 | 允许多端同时登录 | 可配置 |

---

## 四、实施阶段规划

### Phase 1：基础用户管理（2 周）

**目标**：可创建用户、分配角色、管理密码

- [ ] 重构 `Role` → `RoleTemplate`（支持自定义角色）
- [ ] 权限点矩阵数据初始化（`permissions` 表）
- [ ] 用户 CRUD API + 前端页面
- [ ] 角色管理 API + 前端页面
- [ ] 密码策略（长度、复杂度、历史密码检查）
- [ ] 个人中心（修改密码、登录历史）
- [ ] 前端按钮级权限控制（根据 `/me/permissions` 隐藏无权限按钮）

### Phase 2：集群授权 + 审计（2 周）

**目标**：实现"谁能在哪个集群做什么"

- [ ] `ClusterGrant` 数据模型 + API
- [ ] 集群授权前端页面（按集群维度 + 按用户维度）
- [ ] 权限校验中间件（替换现有硬编码检查）
- [ ] 审计日志中间件（记录所有写操作）
- [ ] 审计日志前端页面

### Phase 3：外部认证 + 高级功能（2 周）

**目标**：对接企业身份体系

- [ ] LDAP 认证集成
- [ ] OIDC / OAuth2 认证集成（可选）
- [ ] 用户组/部门管理（可选）
- [ ] K8s RBAC 同步（可选，Phase 2 之后）
- [ ] 审批流（申请权限 → 审批 → 授权）

---

## 五、关键决策

### 决策 1：是否同步到 K8s RBAC？

**建议：Phase 1/2 不做，Phase 3 评估后决定。**

理由：
- CloudOps 本身通过 kubeconfig 连接集群，已有集群级别的认证
- 在 CloudOps 层做权限控制已能满足 90% 场景
- K8s RBAC 同步会引入大量复杂度（ServiceAccount 生命周期、Role 冲突处理、跨集群同步失败等）

### 决策 2：多租户隔离到什么程度？

**建议：Namespace 级别。**

CloudOps 的场景是"运维平台"而非"容器云"，用户主要是 SRE/运维/开发 Leader。Namespace 级别的隔离已足够：
- 不同团队各自管理自己的 Namespace
- 平台管理员可以看到全部
- 不需要像 KubeSphere 那样做到 Pod 级别的严格隔离

### 决策 3：是否支持用户组？

**建议：Phase 1 不支持，Phase 2 支持。**

先跑通单个用户授权，验证权限模型正确后再引入用户组，降低初期复杂度。

---

## 六、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 权限模型设计过复杂，导致前端难以实现 | 高 | Phase 1 先做简单的"用户+角色+集群授权"，不引入 NamespaceScope 细粒度控制 |
| 老数据迁移问题（现有 admin/operator/viewer 用户） | 中 | 保留现有数据，创建对应的 RoleTemplate，通过迁移脚本自动关联 |
| 权限校验中间件性能问题（每次请求查多次表） | 中 | 用户权限缓存到 Redis（TTL 5 分钟），角色模板变更时主动失效缓存 |
| 审计日志量过大 | 中 | 审计日志单独表 + 按天分区，保留 90 天，超期自动归档到文件 |

---

## 七、附件：数据库变更脚本（预览）

```sql
-- 新增 permissions 表
CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) UNIQUE NOT NULL,
    resource VARCHAR(64) NOT NULL,
    verbs VARCHAR(64) NOT NULL,
    display_name VARCHAR(128),
    description TEXT
);

-- 重构 roles → role_templates
CREATE TABLE role_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(128),
    description TEXT,
    scope VARCHAR(32) NOT NULL, -- platform / cluster / resource
    rules_json JSONB NOT NULL DEFAULT '[]',
    parent_id INT REFERENCES role_templates(id),
    is_system BOOLEAN DEFAULT false,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户-角色多对多
CREATE TABLE user_roles (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    role_template_id INT REFERENCES role_templates(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_template_id)
);

-- 集群授权表（替代 cluster_permissions）
CREATE TABLE cluster_grants (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    cluster_id INT REFERENCES clusters(id) ON DELETE CASCADE,
    role_template_id INT REFERENCES role_templates(id) ON DELETE CASCADE,
    namespace_scope VARCHAR(512), -- 逗号分隔的 NS 列表，空=全部
    granted_by INT REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    k8s_synced BOOLEAN DEFAULT false,
    k8s_sync_error TEXT,
    UNIQUE (user_id, cluster_id)
);

-- 审计日志表（按天分片）
CREATE TABLE audit_logs (
    id BIGSERIAL,
    user_id INT,
    username VARCHAR(64),
    tenant_id INT,
    action VARCHAR(32) NOT NULL,
    resource VARCHAR(64) NOT NULL,
    resource_id VARCHAR(128),
    resource_name VARCHAR(256),
    method VARCHAR(16),
    path TEXT,
    client_ip INET,
    user_agent TEXT,
    before_json JSONB,
    after_json JSONB,
    status_code INT,
    error TEXT,
    duration_ms INT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

---

*方案撰写：2026-04-19*
*参考项目：Rancher、KubeSphere、Kubernetes RBAC、OpenShift*
