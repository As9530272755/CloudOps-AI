# CloudOps Namespace 级别 RBAC 设计方案

> 支持同一用户在同一集群的不同命名空间拥有不同权限。
>
> 示例：用户1 在 NS-A 是 admin，在 NS-B/C 是 viewer。

---

## 一、需求分析

### 1.1 场景

| 用户 | 集群 | NS-A | NS-B | NS-C | NS-D |
|------|------|------|------|------|------|
| 用户1 | 生产集群A | **admin** | viewer | viewer | — |
| 用户2 | 生产集群A | viewer | **admin** | viewer | — |
| 用户3 | 生产集群A | — | — | — | **admin** |

### 1.2 关键特征

- **同一集群，不同 NS，不同角色**
- **NS 未授权 = 不可见**（用户看不到该 NS 的资源）
- **支持通配符**：`kube-system` 等系统 NS 默认不授权给业务用户
- **集群级角色 vs NS 级角色**：平台管理员可以管理整个集群的所有 NS

---

## 二、数据模型设计

### 2.1 核心表：ClusterGrant → NamespaceGrant

将原先的 `ClusterGrant` 从"集群级一条记录"拆分为"NS 级多条记录"：

```go
// ClusterGrant 保留为集群级授权（可选，用于全局管理员）
type ClusterGrant struct {
    ID              uint
    UserID          uint
    ClusterID       uint
    RoleTemplateID  uint       // 集群级角色（如 platform-admin, cluster-admin）
    GrantedBy       uint
    GrantedAt       time.Time
    ExpiresAt       *time.Time
}

// NamespaceGrant 命名空间级授权（核心新增）
type NamespaceGrant struct {
    ID              uint
    UserID          uint
    ClusterID       uint
    Namespace       string     // 命名空间名称，如 "ecommerce-prod"
    RoleTemplateID  uint       // 该 NS 内的角色
    
    GrantedBy       uint
    GrantedAt       time.Time
    ExpiresAt       *time.Time
    
    // 联合唯一索引：(user_id, cluster_id, namespace)
}
```

### 2.2 授权规则引擎

```go
// GetEffectiveRole 获取用户在指定集群+NS 的有效角色
func GetEffectiveRole(userID uint, clusterID uint, namespace string) (*RoleTemplate, error) {
    // 规则优先级（从高到低）：
    
    // 1. 先查集群级授权（全局管理员可直接跳过 NS 检查）
    var clusterGrant ClusterGrant
    if err := db.Where("user_id = ? AND cluster_id = ?", userID, clusterID).
        First(&clusterGrant).Error; err == nil {
        role, _ := GetRoleTemplate(clusterGrant.RoleTemplateID)
        // 如果集群级角色是 admin/operator，直接返回
        if role.Scope == "cluster" || role.Scope == "platform" {
            return role, nil
        }
    }
    
    // 2. 查 NS 级授权
    var nsGrant NamespaceGrant
    if err := db.Where("user_id = ? AND cluster_id = ? AND namespace = ?",
        userID, clusterID, namespace).First(&nsGrant).Error; err == nil {
        return GetRoleTemplate(nsGrant.RoleTemplateID)
    }
    
    // 3. 无任何授权
    return nil, ErrNoPermission
}
```

### 2.3 用户组扩展（支持 NS 级批量授权）

```go
type UserGroup struct {
    ID              uint
    Name            string
    Description     string
    RoleTemplateID  uint       // 组默认角色
    
    // 集群级授权
    ClusterGrants   []ClusterGrant
    
    // NS 级授权（新增）
    NamespaceGrants []NamespaceGrant
    
    Users           []User `gorm:"many2many:group_users;"`
}
```

---

## 三、权限校验流程（带 NS 级）

```
请求：GET /api/v1/clusters/5/namespaces/ecommerce-prod/pods
    ↓
[1] JWT 认证 → UserID=1
    ↓
[2] 解析请求参数 → ClusterID=5, Namespace="ecommerce-prod"
    ↓
[3] 权限校验中间件
    ├─ 调用 GetEffectiveRole(userID=1, clusterID=5, namespace="ecommerce-prod")
    ├─ 查到 NamespaceGrant：user=1, cluster=5, ns="ecommerce-prod", role="namespace-admin"
    ├─ 检查 role 是否包含 "pod:read" → ✅ 通过
    └─ 将有效角色写入 gin.Context（供后续 Handler 使用）
    ↓
[4] Handler 执行
    ├─ 从 Context 读取有效角色
    ├─ 选择凭证：role.Level="admin" → 使用 admin-kubeconfig
    └─ 调用 K8s API：GET /api/v1/namespaces/ecommerce-prod/pods
    ↓
[5] 审计日志
    ├─ 记录：用户1 访问了 集群5/NS-A 的 Pod 列表
    ├─ 记录：使用的凭证级别为 admin
    └─ 记录：授权来源为 NamespaceGrant
```

---

## 四、前端交互设计

### 4.1 用户授权页面（NS 级矩阵）

```
用户管理 → 点击"用户1" → "命名空间权限" Tab

生产集群A（已授权 NS）：
┌──────────────┬──────────┬──────────┬──────────┐
│ 命名空间     │ 当前角色 │ 凭证匹配 │ 操作     │
├──────────────┼──────────┼──────────┼──────────┤
│ ecommerce-prod│ admin   ✅│ admin✅  │ 编辑/删除│
│ payment-prod  │ viewer  ✅│ viewer✅ │ 编辑/删除│
│ logistics-prod│ viewer  ✅│ viewer✅ │ 编辑/删除│
│ kube-system   │ —       │ —        │ 添加     │  ← 未授权，不显示
└──────────────┴──────────┴──────────┴──────────┘

[添加命名空间授权] → 弹出选择器
  ├── 步骤1：选择集群（下拉）
  ├── 步骤2：选择命名空间（自动列出该集群所有 NS，多选）
  ├── 步骤3：选择角色（单选：admin / operator / viewer）
  └── 步骤4：保存

预发集群B（已授权 NS）：
┌──────────────┬──────────┬──────────┬──────────┐
│ 命名空间     │ 当前角色 │ 凭证匹配 │ 操作     │
├──────────────┼──────────┼──────────┼──────────┤
│ ecommerce-stg│ operator✅│ operator✅│ 编辑/删除│
│ payment-stg  │ operator✅│ operator✅│ 编辑/删除│
└──────────────┴──────────┴──────────┴──────────┘
```

### 4.2 快速授权模式：批量选择 NS

```
[批量授权] 按钮 → 弹出对话框

集群：生产集群A（单选）
命名空间：
  ☑ ecommerce-prod    ☑ payment-prod    ☑ logistics-prod
  ☐ kube-system       ☐ default         ☐ ingress-nginx

角色：admin / operator / viewer（单选）

[确认授权] → 一次性为选中的 NS 创建 NamespaceGrant
```

### 4.3 集群详情页：NS 权限一览

```
集群管理 → 生产集群A → "用户权限" Tab

按命名空间维度展示：

NS: ecommerce-prod
┌────────┬────────────┬──────────┐
│ 用户名 │ 角色       │ 操作     │
├────────┼────────────┼──────────┤
│ 用户1  │ admin      │ 编辑/删除│
│ 用户2  │ viewer     │ 编辑/删除│
│ 用户5  │ operator   │ 编辑/删除│
└────────┴────────────┴──────────┘

NS: payment-prod
┌────────┬────────────┬──────────┐
│ 用户名 │ 角色       │ 操作     │
├────────┼────────────┼──────────┤
│ 用户1  │ viewer     │ 编辑/删除│
│ 用户3  │ admin      │ 编辑/删除│
└────────┴────────────┴──────────┘

[添加用户到该 NS] → 选择用户 + 角色 → 保存
```

### 4.4 前端按钮级权限（NS 级）

```typescript
// 前端权限 Hook
const useNSPermission = (clusterID: number, namespace: string) => {
  const { user } = useAuth()
  
  // 查询用户在该集群+NS 的有效角色
  const { data: effectiveRole } = useQuery(
    ['ns-permission', clusterID, namespace],
    () => api.get(`/users/me/permissions?cluster=${clusterID}&ns=${namespace}`)
  )
  
  return {
    canDeletePod: effectiveRole?.permissions?.includes('pod:delete'),
    canEditDeployment: effectiveRole?.permissions?.includes('deployment:write'),
    canUseTerminal: effectiveRole?.permissions?.includes('terminal:use'),
    canViewLog: effectiveRole?.permissions?.includes('log:read'),
    // ...
  }
}

// 在 Pod 列表页使用
const PodListPage = ({ clusterID, namespace }) => {
  const { canDeletePod, canUseTerminal } = useNSPermission(clusterID, namespace)
  
  return (
    <Table>
      {pods.map(pod => (
        <TableRow key={pod.name}>
          <TableCell>{pod.name}</TableCell>
          <TableCell>
            {canUseTerminal && <IconButton title="进入终端">Terminal</IconButton>}
            {canDeletePod && <IconButton title="删除" color="error">Delete</IconButton>}
          </TableCell>
        </TableRow>
      ))}
    </Table>
  )
}
```

---

## 五、NS 未授权的处理逻辑

### 5.1 列表页过滤

```go
// ListPods handler
func (h *K8sHandler) ListPods(c *gin.Context) {
    clusterID := c.Param("cluster_id")
    namespace := c.Query("namespace") // 可能为空（全部 NS）
    userID := c.GetUint("user_id")
    
    // 如果指定了 NS，校验权限
    if namespace != "" {
        role, err := GetEffectiveRole(userID, clusterID, namespace)
        if err != nil || !role.HasPermission("pod:read") {
            c.JSON(403, gin.H{"error": "无权访问该命名空间"})
            return
        }
    }
    
    // 如果 namespace 为空（查全部 NS），需要过滤出用户有权限的 NS 列表
    if namespace == "" {
        allowedNS := GetAllowedNamespaces(userID, clusterID, "pod:read")
        // 用 allowedNS 作为过滤条件查询 K8s
        pods, err := h.k8sService.ListPodsMultiNS(clusterID, allowedNS)
        // ...
    }
}
```

### 5.2 NS 下拉框过滤

前端加载集群详情时，后端只返回该用户有权限的 NS 列表：

```
GET /api/v1/clusters/5/namespaces
返回：
[
  { "name": "ecommerce-prod", "role": "admin" },
  { "name": "payment-prod", "role": "viewer" },
  { "name": "logistics-prod", "role": "viewer" }
  // kube-system, default 等未授权的 NS 不返回
]
```

### 5.3 URL 直接访问未授权 NS

```
用户1 直接访问：/clusters/5/namespaces/kube-system/pods

后端检查：GetEffectiveRole(user1, cluster5, "kube-system") → 无授权
返回：403 "您无权访问命名空间 kube-system"
```

---

## 六、特殊场景处理

### 6.1 集群级角色 vs NS 级角色

| 场景 | 处理 |
|------|------|
| 用户有 cluster-admin 角色 | 无视 NS 授权，可访问全部 NS |
| 用户有 cluster-viewer 角色 | 可访问全部 NS，但只能读 |
| 用户无集群级角色，只有 NS 级授权 | 只能看到授权的 NS |
| 用户同时有集群级和 NS 级角色 | 取最高权限（集群级优先） |

### 6.2 新 NS 自动授权

当集群中新增命名空间时：

**策略 A（默认不授权）**：新 NS 创建后，所有用户都看不到，需管理员手动授权。

**策略 B（继承组规则）**：如果用户组配置了通配符规则（如 `ecommerce-*`），新创建的 `ecommerce-new` 自动继承。

**推荐策略 A**，避免意外暴露。

### 6.3 系统 NS 保护

默认保护以下命名空间，不授权给普通用户：

```
kube-system
kube-public
kube-node-lease
ingress-nginx
cattle-system   # Rancher
kubesphere-*    # KubeSphere
```

只有 platform-admin 和 cluster-admin 可以访问系统 NS。

---

## 七、数据库索引设计

```sql
-- NamespaceGrant 表
CREATE TABLE namespace_grants (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cluster_id INT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    namespace VARCHAR(128) NOT NULL,
    role_template_id INT NOT NULL REFERENCES role_templates(id),
    granted_by INT REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    -- 联合唯一索引：一个用户在一个集群的一个 NS 只能有一个角色
    UNIQUE (user_id, cluster_id, namespace),
    
    -- 常用查询索引
    INDEX idx_ns_grant_user (user_id),
    INDEX idx_ns_grant_cluster_ns (cluster_id, namespace),
    INDEX idx_ns_grant_user_cluster (user_id, cluster_id)
);

-- 授权来源追踪（方便审计）
CREATE TABLE namespace_grant_audit (
    id BIGSERIAL PRIMARY KEY,
    grant_id INT,
    action VARCHAR(32) NOT NULL,  -- CREATE / UPDATE / DELETE
    user_id INT,
    cluster_id INT,
    namespace VARCHAR(128),
    old_role VARCHAR(64),
    new_role VARCHAR(64),
    operator_id INT,
    operated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 八、实施建议

### 8.1 实施阶段调整

| 阶段 | 内容 | 周期 |
|------|------|------|
| Phase 1 | 用户管理 + 角色模板 + **NS 级授权基础** | 3 周 |
| Phase 2 | 用户组 + NS 批量授权 + 前端按钮级权限 | 2 周 |
| Phase 3 | 审计日志 + 系统 NS 保护 + LDAP | 2 周 |

### 8.2 为什么 NS 级授权放在 Phase 1？

因为用户的核心诉求就是"同一集群不同 NS 不同权限"，这是基础功能，不是扩展功能。如果先做集群级授权再做 NS 级，等于做两次重构。

**建议**：直接把 NS 级授权作为基础模型，集群级授权作为特例（`namespace=""`）。

---

## 九、与 KubeSphere NS 权限的关系

### 9.1 现状

KubeSphere 已经通过 K8s RBAC 实现了 NS 级别的用户隔离。例如：
- KubeSphere 里用户1 在 `ecommerce-prod` 是 `admin`
- KubeSphere 里用户1 在 `payment-prod` 是 `viewer`

### 9.2 CloudOps 的做法

CloudOps **不读取 KubeSphere 的 RBAC 配置**，而是自建 `NamespaceGrant`：

```
KubeSphere RBAC          CloudOps NamespaceGrant
─────────────────        ────────────────────────
User1 → NS-A → admin     User1 → ClusterA → NS-A → admin
User1 → NS-B → viewer    User1 → ClusterA → NS-B → viewer
```

**同步策略（可选，Phase 3）**：
- 如果未来需要保持一致，可以写一个同步脚本，定期从 K8s API 读取 RoleBinding，同步到 CloudOps
- 但初期建议手动维护，避免过度耦合

---

*方案撰写：2026-04-19*
*适用场景：同一用户在同一集群的不同命名空间需要不同权限*
