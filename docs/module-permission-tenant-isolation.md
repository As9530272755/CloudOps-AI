# CloudOps 功能模块权限 + 租户数据隔离设计方案

> 基于截图中的侧边栏菜单结构，设计完整的功能模块权限控制和租户数据隔离方案。
>
> 核心问题：
> 1. admin 创建的仪表盘，其他租户用户不该看到（信息泄露）
> 2. 日志管理、巡检任务需要租户隔离
> 3. 集群管理、系统设置等系统级功能不能给普通用户

---

## 一、现状问题分析

### 1.1 当前菜单结构（截图）

```
┌─────────────────────────────────────────┐
│  概览                                   │
│    ├── 仪表盘                           │ ← 所有用户可见，数据未隔离
│                                         │
│  KUBERNETES                             │
│    ├── 集群管理                         │ ← 所有用户可见 ❌
│    ├── 巡检中心                         │ ← 所有用户可见，数据未隔离
│    ├── 网络追踪                         │ ← 所有用户可见
│    ├── 数据管理                         │ ← 所有用户可见
│                                         │
│  运维                                   │
│    ├── 日志管理                         │ ← 所有用户可见，数据未隔离
│    ├── Web终端                          │ ← 所有用户可见 ❌
│                                         │
│  智能                                   │
│    ├── AI助手                           │ ← 所有用户可见
│                                         │
│  系统                                   │
│    ├── 用户管理                         │ ← 所有用户可见 ❌
│    ├── 租户管理                         │ ← 所有用户可见 ❌
│    ├── 系统设置                         │ ← 所有用户可见 ❌
└─────────────────────────────────────────┘
```

### 1.2 当前代码问题

```tsx
// MainLayout.tsx - 菜单硬编码，无任何权限过滤
const menuItems = [
  { path: '/', label: '仪表盘', icon: <DashboardIcon />, group: '概览' },
  { path: '/clusters', label: '集群管理', icon: <ClusterIcon />, group: 'Kubernetes' },
  { path: '/inspection', label: '巡检中心', icon: <InspectionIcon />, group: 'Kubernetes' },
  // ... 全部硬编码
]

// 后端查询没有 tenant_id 过滤
// 任何登录用户都能查全部数据
```

### 1.3 信息泄露场景

```
租户A（电商团队）                    租户B（支付团队）
    │                                    │
    ├── 创建仪表盘"电商核心指标"          ├── 创建仪表盘"支付通道监控"
    ├── 配置日志采集（含用户订单日志）     ├── 配置日志采集（含支付流水日志）
    ├── 创建巡检任务"电商集群巡检"         ├── 创建巡检任务"支付集群巡检"
    │                                    │
    └── 张三登录 → 看到所有数据 ←─────────┘  ❌ 严重泄露！
```

---

## 二、设计方案：双层权限控制

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        双层权限控制模型                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  第一层：功能模块权限（菜单级）                                               │
│  ─────────────────────────────                                              │
│  控制用户能看到哪些菜单/页面                                                  │
│                                                                             │
│    用户张三 (namespace-operator)                                             │
│         │                                                                   │
│         ├── ✅ 仪表盘（能看到菜单）                                           │
│         ├── ❌ 集群管理（菜单隐藏）                                           │
│         ├── ✅ 巡检中心（能看到菜单）                                         │
│         ├── ✅ 网络追踪（能看到菜单）                                         │
│         ├── ✅ 日志管理（能看到菜单）                                         │
│         ├── ❌ Web终端（菜单隐藏）                                            │
│         ├── ✅ AI助手（能看到菜单）                                           │
│         └── ❌ 用户管理（菜单隐藏）                                           │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  第二层：数据范围权限（租户级）                                               │
│  ─────────────────────────────                                              │
│  在同一页面内，控制用户能看到哪些数据                                          │
│                                                                             │
│    用户张三 (租户A)                                                          │
│         │                                                                   │
│         ├── 仪表盘页面 → 只看租户A的仪表盘                                    │
│         ├── 巡检中心页面 → 只看租户A的巡检任务                                │
│         ├── 日志管理页面 → 只看租户A的日志配置                                │
│         └── AI助手页面 → 会话隔离（已有）                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、功能模块权限设计

### 3.1 模块权限标识

```go
// 功能模块权限标识（使用 module: 前缀）
const (
    // ── 概览 ──
    ModuleDashboard       = "module:dashboard"        // 仪表盘
    
    // ── KUBERNETES ──
    ModuleClusterManage   = "module:cluster:manage"   // 集群管理
    ModuleInspection      = "module:inspection"       // 巡检中心
    ModuleNetworkTrace    = "module:network:trace"    // 网络追踪
    ModuleDataManage      = "module:data:manage"      // 数据管理
    
    // ── 运维 ──
    ModuleLogManage       = "module:log:manage"       // 日志管理
    ModuleWebTerminal     = "module:terminal"         // Web终端
    
    // ── 智能 ──
    ModuleAIAssistant     = "module:ai:assistant"     // AI助手
    
    // ── 系统 ──
    ModuleUserManage      = "module:system:user"      // 用户管理
    ModuleTenantManage    = "module:system:tenant"    // 租户管理
    ModuleSystemSettings  = "module:system:settings"  // 系统设置
)
```

### 3.2 各角色默认模块权限

```
┌────────────────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│     功能模块        │platform │ cluster │ ns-admin│ ns-op   │ ns-view │
│                    │ admin   │ admin   │         │         │         │
├────────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ 仪表盘              │    ✅    │    ✅    │    ✅    │    ✅    │    ✅    │
│ 集群管理            │    ✅    │    ✅    │    ❌    │    ❌    │    ❌    │
│ 巡检中心            │    ✅    │    ✅    │    ✅    │    ✅    │    ✅    │
│ 网络追踪            │    ✅    │    ✅    │    ✅    │    ✅    │    ✅    │
│ 数据管理            │    ✅    │    ✅    │    ✅    │    ❌    │    ❌    │
│ 日志管理            │    ✅    │    ✅    │    ✅    │    ✅    │    ✅    │
│ Web终端             │    ✅    │    ✅    │    ✅    │    ✅    │    ❌    │
│ AI助手              │    ✅    │    ✅    │    ✅    │    ✅    │    ✅    │
│ 用户管理            │    ✅    │    ❌    │    ❌    │    ❌    │    ❌    │
│ 租户管理            │    ✅    │    ❌    │    ❌    │    ❌    │    ❌    │
│ 系统设置            │    ✅    │    ❌    │    ❌    │    ❌    │    ❌    │
└────────────────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
```

### 3.3 角色模板中的模块权限（SQL）

```sql
-- 更新角色模板的 permissions 字段，加入模块权限
UPDATE role_templates SET permissions = '[
    "*:*",
    "module:dashboard", "module:cluster:manage", "module:inspection",
    "module:network:trace", "module:data:manage", "module:log:manage",
    "module:terminal", "module:ai:assistant",
    "module:system:user", "module:system:tenant", "module:system:settings",
    "ai:chat", "ai:agent_chat", "ai:platform:manage",
    "terminal:use", "log:read"
]' WHERE name = 'platform-admin';

UPDATE role_templates SET permissions = '[
    "*:*",
    "module:dashboard", "module:cluster:manage", "module:inspection",
    "module:network:trace", "module:data:manage", "module:log:manage",
    "module:terminal", "module:ai:assistant",
    "ai:chat", "ai:agent_chat", "ai:platform:view",
    "terminal:use", "log:read"
]' WHERE name = 'cluster-admin';

UPDATE role_templates SET permissions = '[
    "*:*:read", "log:read", "terminal:use",
    "module:dashboard", "module:inspection",
    "module:network:trace", "module:log:manage", "module:ai:assistant",
    "ai:chat", "ai:agent_chat", "ai:platform:view",
    "ai:tool:list_clusters", "ai:tool:cluster_status"
]' WHERE name = 'cluster-viewer';

UPDATE role_templates SET permissions = '[
    "pod:*", "deployment:*", "service:*", "configmap:*", "secret:*",
    "event:read", "log:read", "terminal:use", "namespace:read",
    "module:dashboard", "module:inspection",
    "module:network:trace", "module:data:manage", "module:log:manage",
    "module:terminal", "module:ai:assistant",
    "ai:chat", "ai:agent_chat", "ai:platform:view",
    "ai:log_analysis", "ai:network_analysis", "ai:inspection_analysis",
    "ai:tool:list_clusters", "ai:tool:cluster_status", "ai:tool:list_pods", "ai:tool:query_logs"
]' WHERE name = 'namespace-admin';

UPDATE role_templates SET permissions = '[
    "pod:read", "pod:write", "pod:delete",
    "deployment:read", "deployment:write",
    "service:read", "service:write",
    "configmap:read", "configmap:write",
    "event:read", "log:read", "terminal:use", "namespace:read",
    "module:dashboard", "module:inspection",
    "module:network:trace", "module:log:manage",
    "module:terminal", "module:ai:assistant",
    "ai:chat", "ai:agent_chat", "ai:platform:view",
    "ai:log_analysis", "ai:network_analysis",
    "ai:tool:list_clusters", "ai:tool:cluster_status", "ai:tool:list_pods"
]' WHERE name = 'namespace-operator';

UPDATE role_templates SET permissions = '[
    "pod:read", "deployment:read", "service:read", "configmap:read",
    "event:read", "log:read", "namespace:read",
    "module:dashboard", "module:inspection",
    "module:network:trace", "module:log:manage", "module:ai:assistant",
    "ai:chat", "ai:image_input", "ai:session_manage",
    "ai:platform:view",
    "ai:tool:list_clusters"
]' WHERE name = 'namespace-viewer';
```

---

## 四、数据范围权限 + 租户隔离

### 4.1 数据范围定义

```go
// DataScope 数据范围
type DataScope string

const (
    DataScopeAll    DataScope = "all"     // 全部数据（platform-admin）
    DataScopeTenant DataScope = "tenant"  // 本租户数据（普通用户）
    DataScopeOwn    DataScope = "own"     // 仅自己的数据
)
```

### 4.2 各角色的数据范围

```
┌────────────────────┬─────────────┬─────────────────────────────────┐
│ 角色               │ 数据范围     │ 说明                            │
├────────────────────┼─────────────┼─────────────────────────────────┤
│ platform-admin     │ all         │ 所有租户的全部数据              │
│ cluster-admin      │ tenant      │ 本租户的全部数据                │
│ cluster-viewer     │ tenant      │ 本租户的全部数据                │
│ namespace-admin    │ tenant      │ 本租户的全部数据                │
│ namespace-operator │ tenant      │ 本租户的全部数据                │
│ namespace-viewer   │ tenant      │ 本租户的全部数据                │
└────────────────────┴─────────────┴─────────────────────────────────┘
```

### 4.3 租户隔离中间件

```go
// internal/api/middleware/tenant.go

package middleware

import (
    "net/http"
    "github.com/gin-gonic/gin"
    "gorm.io/gorm"
)

// TenantScopeMiddleware 租户数据范围中间件
// 自动为查询添加 tenant_id 过滤
func TenantScopeMiddleware(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        userID := c.GetUint("user_id")
        if userID == 0 {
            c.Next()
            return
        }
        
        // 从 Context 获取用户信息（由 JWT 中间件设置）
        tenantID, exists := c.Get("tenant_id")
        if !exists {
            c.Next()
            return
        }
        
        isSuperuser, _ := c.Get("is_superuser")
        
        // superuser 不过滤租户
        if isSuperuser == true {
            c.Set("data_scope", "all")
            c.Next()
            return
        }
        
        // 普通用户只能看到本租户数据
        c.Set("data_scope", "tenant")
        c.Set("current_tenant_id", tenantID)
        c.Next()
    }
}

// ApplyTenantFilter 为 GORM 查询应用租户过滤
func ApplyTenantFilter(db *gorm.DB, c *gin.Context) *gorm.DB {
    scope, _ := c.Get("data_scope")
    if scope == "all" {
        return db
    }
    
    tenantID, exists := c.Get("current_tenant_id")
    if !exists {
        return db
    }
    
    return db.Where("tenant_id = ?", tenantID)
}
```

### 4.4 各模块的租户隔离实现

#### 仪表盘（Dashboard）

```go
// handler
func (h *DashboardHandler) List(c *gin.Context) {
    var dashboards []model.Dashboard
    
    // 应用租户过滤
    query := middleware.ApplyTenantFilter(h.db, c)
    
    if err := query.Find(&dashboards).Error; err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(200, gin.H{"data": dashboards})
}

// 创建时自动注入 tenant_id
func (h *DashboardHandler) Create(c *gin.Context) {
    var req struct {
        Title       string `json:"title"`
        Description string `json:"description"`
        Config      string `json:"config"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": "无效请求"})
        return
    }
    
    tenantID, _ := c.Get("current_tenant_id")
    
    dashboard := model.Dashboard{
        TenantID:    tenantID.(uint),
        Title:       req.Title,
        Description: req.Description,
        Config:      req.Config,
    }
    
    h.db.Create(&dashboard)
    c.JSON(201, gin.H{"data": dashboard})
}
```

#### 巡检任务（InspectionTask）

```go
func (h *InspectionHandler) ListTasks(c *gin.Context) {
    var tasks []model.InspectionTask
    query := middleware.ApplyTenantFilter(h.db, c)
    
    // 额外：NS 级权限过滤
    // 如果用户没有 cluster 级权限，只显示其 NS 相关的巡检任务
    userID := c.GetUint("user_id")
    effectiveRole, _ := h.rbacService.GetEffectiveRole(c.Request.Context(), userID, 0, "")
    if effectiveRole != nil && effectiveRole.Role.Scope == "namespace" {
        // 获取用户有权限的 NS 列表
        allowedNS, _ := h.rbacService.GetAllowedNamespaces(c.Request.Context(), userID, 0)
        nsNames := make([]string, len(allowedNS))
        for i, ns := range allowedNS {
            nsNames[i] = ns.Namespace
        }
        query = query.Where("namespace IN ?", nsNames)
    }
    
    query.Find(&tasks)
    c.JSON(200, gin.H{"data": tasks})
}
```

#### 日志管理（Log）

```go
func (h *LogHandler) List(c *gin.Context) {
    var logs []model.Log
    query := middleware.ApplyTenantFilter(h.db, c)
    query.Find(&logs)
    c.JSON(200, gin.H{"data": logs})
}
```

---

## 五、前端菜单动态过滤

### 5.1 后端 API：获取用户可用菜单

```go
// internal/api/handlers/menu.go

// GetUserMenus 获取当前用户可见的菜单
func (h *MenuHandler) GetUserMenus(c *gin.Context) {
    userID := c.GetUint("user_id")
    
    rbacService := service.NewRBACService(h.db)
    permissions, _ := rbacService.GetAllPermissions(c.Request.Context(), userID)
    
    // 从 permissions 中提取 module: 前缀的权限
    modulePerms := filterModulePermissions(permissions)
    
    // 定义菜单结构
    allMenus := []MenuItem{
        {
            Group: "概览",
            Items: []MenuItem{
                {Path: "/", Label: "仪表盘", Icon: "dashboard", Permission: "module:dashboard"},
            },
        },
        {
            Group: "KUBERNETES",
            Items: []MenuItem{
                {Path: "/clusters", Label: "集群管理", Icon: "cluster", Permission: "module:cluster:manage"},
                {Path: "/inspection", Label: "巡检中心", Icon: "inspection", Permission: "module:inspection"},
                {Path: "/network-trace", Label: "网络追踪", Icon: "network", Permission: "module:network:trace"},
                {Path: "/data", Label: "数据管理", Icon: "data", Permission: "module:data:manage"},
            },
        },
        {
            Group: "运维",
            Items: []MenuItem{
                {Path: "/logs", Label: "日志管理", Icon: "logs", Permission: "module:log:manage"},
                {Path: "/terminal", Label: "Web终端", Icon: "terminal", Permission: "module:terminal"},
            },
        },
        {
            Group: "智能",
            Items: []MenuItem{
                {Path: "/ai", Label: "AI助手", Icon: "ai", Permission: "module:ai:assistant"},
            },
        },
        {
            Group: "系统",
            Items: []MenuItem{
                {Path: "/users", Label: "用户管理", Icon: "users", Permission: "module:system:user"},
                {Path: "/tenants", Label: "租户管理", Icon: "tenants", Permission: "module:system:tenant"},
                {Path: "/settings", Label: "系统设置", Icon: "settings", Permission: "module:system:settings"},
            },
        },
    }
    
    // 过滤出用户有权限的菜单
    var visibleMenus []MenuItem
    for _, group := range allMenus {
        visibleItems := []MenuItem{}
        for _, item := range group.Items {
            if hasPermission(modulePerms, item.Permission) {
                visibleItems = append(visibleItems, item)
            }
        }
        if len(visibleItems) > 0 {
            visibleMenus = append(visibleMenus, MenuItem{
                Group: group.Group,
                Items: visibleItems,
            })
        }
    }
    
    c.JSON(200, gin.H{"data": visibleMenus})
}
```

### 5.2 前端动态菜单

```tsx
// frontend/src/components/layout/MainLayout.tsx

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

// 图标映射
const iconMap: Record<string, React.ReactNode> = {
  dashboard: <DashboardIcon />,
  cluster: <ClusterIcon />,
  inspection: <InspectionIcon />,
  network: <NetworkTraceIcon />,
  data: <DataIcon />,
  logs: <LogsIcon />,
  terminal: <TerminalIcon />,
  ai: <AIIcon />,
  users: <UsersIcon />,
  tenants: <TenantsIcon />,
  settings: <SettingsIcon />,
}

export default function MainLayout() {
  // 获取用户可见菜单
  const { data: menuData } = useQuery({
    queryKey: ['user-menus'],
    queryFn: async () => {
      const res = await api.get('/users/me/menus');
      return res.data.data as MenuGroup[];
    },
  })
  
  // ... 其余代码不变，用 menuData 替换硬编码的 menuItems
}
```

### 5.3 路由守卫（防止直接 URL 访问）

```tsx
// frontend/src/App.tsx - 路由守卫

const ProtectedRoute = ({ requiredPermission, children }: { 
    requiredPermission: string; 
    children: React.ReactNode 
}) => {
    const { hasModule } = usePermission();
    
    if (!hasModule(requiredPermission)) {
        return <Navigate to="/403" replace />;
    }
    
    return <>{children}</>;
};

// 路由配置
<Route path="/clusters" element={
    <ProtectedRoute requiredPermission="module:cluster:manage">
        <Clusters />
    </ProtectedRoute>
} />

<Route path="/users" element={
    <ProtectedRoute requiredPermission="module:system:user">
        <Users />
    </ProtectedRoute>
} />
```

---

## 六、添加用户时的功能模块配置

### 6.1 前端交互设计

```
添加用户 / 编辑用户
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  基本信息                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 用户名: [________]   邮箱: [________]   角色: [▼ namespace-operator]│   │
│  │ 密码: [________]     租户: [▼ 电商团队]    状态: [● 启用 ○ 禁用]   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  功能模块权限（基于角色默认，可单独调整）                                      │
│  ═══════════════════════════════════════════════════════════════════════   │
│                                                                             │
│  概览                                        [恢复默认]                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ 仪表盘                                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  KUBERNETES                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☐ 集群管理           ☑ 巡检中心          ☑ 网络追踪                │   │
│  │ ☑ 数据管理                                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  运维                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ 日志管理           ☑ Web终端                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  智能                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ AI助手                                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  系统（⚠️ 仅平台管理员可配置）                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☐ 用户管理           ☐ 租户管理          ☐ 系统设置                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  命名空间权限（该用户在各集群各 NS 的角色）                                   │
│  ═══════════════════════════════════════════════════════════════════════   │
│  │ ...（之前的 NS 权限矩阵）                                            │   │
│                                                                             │
│              [取消]                                    [保存]              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 七、完整实施计划（最终版）

### Phase 1：基础权限体系（3 周）

| 周 | 任务 | 说明 |
|----|------|------|
| W1 | 数据库改造 | 角色模板表扩展 permissions JSONB、user_module_overrides 表 |
| W1 | RBAC Service | GetEffectiveRole、GetModulePermissions、GetAllPermissions |
| W1 | 租户隔离中间件 | TenantScopeMiddleware、ApplyTenantFilter |
| W2 | API 权限改造 | 所有模块 API 加上权限校验 + 租户过滤 |
| W2 | 菜单 API | GET /users/me/menus 动态返回可见菜单 |
| W2 | 终端权限改造 | 按 NS 级权限校验 + 自动设默认 NS |
| W3 | 前端菜单动态化 | MainLayout 从后端获取菜单、路由守卫 |
| W3 | 前端用户管理页 | 添加/编辑用户（含功能模块配置 + NS 权限配置） |
| W3 | 前端权限 Hook | usePermission（含模块权限 + NS 权限 + AI 权限） |

### Phase 2：数据隔离强化（2 周）

| 周 | 任务 | 说明 |
|----|------|------|
| W4 | Dashboard 租户隔离 | 创建/查询自动加 tenant_id |
| W4 | 日志管理租户隔离 | 日志配置按租户隔离 |
| W4 | 巡检任务租户隔离 | 巡检任务按租户 + NS 双重过滤 |
| W5 | 数据管理租户隔离 | 数据源按租户隔离 |
| W5 | 网络追踪租户隔离 | 网络追踪配置按租户隔离 |

### Phase 3：高级功能（2 周）

| 周 | 任务 | 说明 |
|----|------|------|
| W6 | 用户组 + 批量授权 | 用户组的模块权限 + NS 权限批量授予 |
| W6 | 审计日志 | 记录所有权限变更和数据访问 |
| W7 | LDAP/OIDC | 外部认证接入 |
| W7 | 性能优化 | 权限缓存（Redis）、菜单缓存 |

---

## 八、问题解答

### Q1: 如果用户直接输入 URL 访问未授权的页面怎么办？

**答：双重防护**
1. 前端路由守卫：检测权限，无权限跳 403 页面
2. 后端 API 校验：每个 API 都校验模块权限，无权限返回 403

### Q2: 租户隔离会不会影响 superuser？

**答：不会**
- `is_superuser = true` 的用户数据范围为 `all`，不过滤 tenant_id
- superuser 可以看到所有租户的数据

### Q3: 一个用户能属于多个租户吗？

**答：当前设计一个用户属于一个租户**
- User 表有 `tenant_id` 字段
- 如需跨租户，需重新设计（多对多关系）
- 建议 Phase 3 再考虑此需求

### Q4: 集群管理为什么只有 admin 能看到？

**答：安全考虑**
- 集群管理涉及 kubeconfig 等敏感配置
- 普通用户不需要知道集群的连接信息
- 他们通过 NS 级授权间接使用集群资源即可

---

*方案版本：V1（功能模块权限 + 租户隔离）*
*撰写日期：2026-04-19*
*核心目标：菜单级权限控制 + 租户数据隔离 + NS 级资源权限*
