# CloudOps AI 功能权限设计方案

> 基于 RBAC + NS 级权限体系，为 AI 助手各功能模块增加细粒度权限控制。
>
> 核心需求：添加用户时，可指定该用户能使用哪些 AI 功能模块。

---

## 一、AI 功能模块全景

### 1.1 当前 AI 功能清单

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI 功能模块总览                                 │
├──────────────────┬───────────────────────────────────────┬──────────────────┤
│   模块分类        │              具体功能                  │   风险等级       │
├──────────────────┼───────────────────────────────────────┼──────────────────┤
│ 1. AI 对话        │ 普通对话 / 流式对话                    │ 🟢 低            │
│                  │ Agent 智能体对话（带工具调用）          │ 🟡 中            │
│                  │ 多模态图片输入                         │ 🟢 低            │
│                  │ 会话管理（增删改查自己的会话）          │ 🟢 低            │
├──────────────────┼───────────────────────────────────────┼──────────────────┤
│ 2. AI 平台管理    │ 创建/编辑/删除 AI 平台                 │ 🔴 高            │
│                  │ 测试连通性 / 设置默认平台               │ 🟡 中            │
│                  │ 查看平台列表                           │ 🟢 低            │
├──────────────────┼───────────────────────────────────────┼──────────────────┤
│ 3. 场景化 AI      │ AI 日志分析（Logs 页面）               │ 🟡 中            │
│                  │ AI 网络追踪分析（NetworkTrace 页面）   │ 🟡 中            │
│                  │ AI 巡检报告分析（Inspection 页面）     │ 🟡 中            │
├──────────────────┼───────────────────────────────────────┼──────────────────┤
│ 4. Agent 工具调用 │ list_clusters（列出集群）              │ 🟢 低            │
│                  │ get_cluster_status（集群状态）         │ 🟢 低            │
│                  │ list_pods（列出 Pod）                  │ 🟡 中            │
│                  │ query_logs（查询日志）                 │ 🟡 中            │
└──────────────────┴───────────────────────────────────────┴──────────────────┘
```

### 1.2 当前权限问题

```
现状：所有登录用户都能使用全部 AI 功能

张三 (viewer) ──► AI 聊天 ──✅ 能用
             ──► Agent 工具 ──✅ 能查所有集群 Pod
             ──► AI 平台管理 ──✅ 能删 AI 平台配置
             ──► AI 日志分析 ──✅ 能分析日志

问题：
  1. viewer 用户能删 AI 平台配置（应该只有 admin 能管理）
  2. 普通用户能无限制调用 AI（没有配额控制）
  3. Agent 工具能查询未授权的集群资源（跨 NS 信息泄露风险）
```

---

## 二、设计方案

### 2.1 设计原则

1. **角色模板定义默认权限**：预置角色自带推荐的 AI 权限集合
2. **用户级可覆盖**：添加/编辑用户时，可在角色默认基础上调整 AI 功能模块
3. **NS 级权限与 AI 权限联动**：Agent 工具只能查询用户有权限的 NS
4. **最小权限**：默认关闭高风险功能，按需开启

### 2.2 AI 权限标识设计

```go
// AI 功能权限标识（统一使用 ai:xxx 前缀，融入现有 Permission 体系）
const (
    // ── 基础对话 ──
    AIPermissionChat          = "ai:chat"           // 普通 AI 对话
    AIPermissionAgentChat     = "ai:agent_chat"     // Agent 智能体对话（含工具调用）
    AIPermissionImageInput    = "ai:image_input"    // 图片输入/多模态
    AIPermissionSessionManage = "ai:session_manage" // 会话管理（创建/删除/清空）
    
    // ── 平台管理 ──
    AIPermissionPlatformView   = "ai:platform:view"   // 查看 AI 平台列表
    AIPermissionPlatformManage = "ai:platform:manage" // 管理 AI 平台（增删改）
    AIPermissionPlatformTest   = "ai:platform:test"   // 测试平台连通性
    
    // ── 场景化 AI ──
    AIPermissionLogAnalysis      = "ai:log_analysis"      // 日志 AI 分析
    AIPermissionNetworkAnalysis  = "ai:network_analysis"  // 网络追踪 AI 分析
    AIPermissionInspectionAnalysis = "ai:inspection_analysis" // 巡检报告 AI 分析
    
    // ── Agent 工具（与 K8s 权限联动）──
    AIPermissionToolListClusters    = "ai:tool:list_clusters"     // 列出集群
    AIPermissionToolClusterStatus   = "ai:tool:cluster_status"    // 集群状态
    AIPermissionToolListPods        = "ai:tool:list_pods"         // 列出 Pod
    AIPermissionToolQueryLogs       = "ai:tool:query_logs"        // 查询日志
)
```

### 2.3 角色模板中的 AI 权限配置

```sql
-- 预置角色的 AI 权限
INSERT INTO role_templates (name, display_name, scope, level, permissions) VALUES

-- 平台管理员：全部 AI 权限
('platform-admin', '平台管理员', 'platform', 300, '[
    "*:*",
    "ai:chat", "ai:agent_chat", "ai:image_input", "ai:session_manage",
    "ai:platform:view", "ai:platform:manage", "ai:platform:test",
    "ai:log_analysis", "ai:network_analysis", "ai:inspection_analysis",
    "ai:tool:list_clusters", "ai:tool:cluster_status", "ai:tool:list_pods", "ai:tool:query_logs"
]'),

-- 集群管理员：全部 AI 权限，但不能管理 AI 平台
('cluster-admin', '集群管理员', 'cluster', 200, '[
    "*:*",
    "ai:chat", "ai:agent_chat", "ai:image_input", "ai:session_manage",
    "ai:platform:view", "ai:platform:test",
    "ai:log_analysis", "ai:network_analysis", "ai:inspection_analysis",
    "ai:tool:list_clusters", "ai:tool:cluster_status", "ai:tool:list_pods", "ai:tool:query_logs"
]'),

-- 集群只读：能聊天，能看平台，能场景化分析，Agent 工具只读
('cluster-viewer', '集群只读', 'cluster', 110, '[
    "*:*:read", "log:read", "terminal:use",
    "ai:chat", "ai:agent_chat", "ai:image_input", "ai:session_manage",
    "ai:platform:view",
    "ai:log_analysis", "ai:network_analysis", "ai:inspection_analysis",
    "ai:tool:list_clusters", "ai:tool:cluster_status"
]'),

-- NS 管理员：全部 AI 权限，但不能管理 AI 平台
('namespace-admin', '命名空间管理员', 'namespace', 150, '[
    "pod:*", "deployment:*", "service:*", "configmap:*", "secret:*",
    "event:read", "log:read", "terminal:use", "namespace:read",
    "ai:chat", "ai:agent_chat", "ai:image_input", "ai:session_manage",
    "ai:platform:view", "ai:platform:test",
    "ai:log_analysis", "ai:network_analysis", "ai:inspection_analysis",
    "ai:tool:list_clusters", "ai:tool:cluster_status", "ai:tool:list_pods", "ai:tool:query_logs"
]'),

-- NS 运维：能聊天，能场景化分析，Agent 工具受限
('namespace-operator', '命名空间运维', 'namespace', 120, '[
    "pod:read", "pod:write", "pod:delete",
    "deployment:read", "deployment:write",
    "service:read", "service:write",
    "configmap:read", "configmap:write",
    "event:read", "log:read", "terminal:use", "namespace:read",
    "ai:chat", "ai:agent_chat", "ai:image_input", "ai:session_manage",
    "ai:platform:view",
    "ai:log_analysis", "ai:network_analysis",
    "ai:tool:list_clusters", "ai:tool:cluster_status", "ai:tool:list_pods"
]'),

-- NS 只读：只能基础聊天 + 查看
('namespace-viewer', '命名空间只读', 'namespace', 100, '[
    "pod:read", "deployment:read", "service:read", "configmap:read",
    "event:read", "log:read", "namespace:read",
    "ai:chat", "ai:image_input", "ai:session_manage",
    "ai:platform:view",
    "ai:tool:list_clusters"
]');
```

### 2.4 用户级 AI 权限覆盖

除了角色模板定义的默认权限外，支持用户级别的 AI 功能覆盖：

```go
// 新增表：用户 AI 权限覆盖
type UserAIPermission struct {
    ID          uint      `gorm:"primarykey"`
    UserID      uint      `gorm:"not null;uniqueIndex" json:"user_id"`
    
    // 在角色默认基础上，额外开启的 AI 功能
    EnabledModules  []string `gorm:"type:jsonb" json:"enabled_modules"`
    
    // 在角色默认基础上，额外禁用的 AI 功能
    DisabledModules []string `gorm:"type:jsonb" json:"disabled_modules"`
    
    // 每日 AI 调用配额（0 = 不限）
    DailyQuota  int       `gorm:"default:0" json:"daily_quota"`
    
    UpdatedAt   time.Time `json:"updated_at"`
}
```

**权限计算逻辑**：

```go
func (s *RBACService) GetAIPermissions(ctx context.Context, userID uint) ([]string, error) {
    // 1. 先获取用户的有效角色（取最高级别的角色）
    // 这里简化处理，实际需要从所有授权中取最高 level 的角色
    user, err := s.getUserByID(userID)
    if err != nil {
        return nil, err
    }
    
    // 2. 获取角色默认的 AI 权限
    var role model.RoleTemplate
    if err := s.db.First(&role, user.RoleID).Error; err != nil {
        return nil, err
    }
    
    basePerms := role.GetAIPermissions() // 从 role.permissions 中筛选 ai: 前缀
    
    // 3. 获取用户级覆盖
    var userAI model.UserAIPermission
    if err := s.db.Where("user_id = ?", userID).First(&userAI).Error; err == nil {
        // 添加额外开启的
        for _, m := range userAI.EnabledModules {
            if !contains(basePerms, m) {
                basePerms = append(basePerms, m)
            }
        }
        // 移除额外禁用的
        for _, m := range userAI.DisabledModules {
            basePerms = remove(basePerms, m)
        }
    }
    
    return basePerms, nil
}
```

---

## 三、AI 权限校验中间件

### 3.1 API 级权限控制

```go
// internal/api/middleware/ai_permission.go

package middleware

import (
    "net/http"
    "strings"
    
    "github.com/gin-gonic/gin"
)

// AIPermissionMiddleware AI 功能权限校验
func AIPermissionMiddleware(requiredPermission string) gin.HandlerFunc {
    return func(c *gin.Context) {
        userID := c.GetUint("user_id")
        if userID == 0 {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
            c.Abort()
            return
        }
        
        // 获取用户 AI 权限
        rbacService := c.MustGet("rbac_service").(*service.RBACService)
        aiPerms, err := rbacService.GetAIPermissions(c.Request.Context(), userID)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": "权限查询失败"})
            c.Abort()
            return
        }
        
        // 通配符检查
        if contains(aiPerms, "*:*") || contains(aiPerms, "ai:*") {
            c.Next()
            return
        }
        
        // 精确匹配
        if !contains(aiPerms, requiredPermission) {
            c.JSON(http.StatusForbidden, gin.H{
                "error": "您没有使用该 AI 功能的权限",
                "required": requiredPermission,
            })
            c.Abort()
            return
        }
        
        c.Next()
    }
}

// 路由注册示例
func SetupAIRoutes(r *gin.Engine, rbacService *service.RBACService) {
    ai := r.Group("/api/v1/ai")
    ai.Use(middleware.JWTAuth())
    {
        // 基础对话（所有有 ai:chat 权限的用户）
        ai.POST("/chat", AIPermissionMiddleware("ai:chat"), aiHandler.Chat)
        ai.POST("/chat/stream", AIPermissionMiddleware("ai:chat"), aiHandler.ChatStream)
        
        // Agent 对话（需要 ai:agent_chat 权限）
        ai.POST("/agent/chat/stream", AIPermissionMiddleware("ai:agent_chat"), aiHandler.AgentChatStream)
        
        // 会话管理
        ai.GET("/sessions", AIPermissionMiddleware("ai:session_manage"), aiSessionHandler.List)
        ai.POST("/sessions", AIPermissionMiddleware("ai:session_manage"), aiSessionHandler.Create)
        ai.DELETE("/sessions/:id", AIPermissionMiddleware("ai:session_manage"), aiSessionHandler.Delete)
        
        // 平台管理（分层权限）
        platforms := ai.Group("/platforms")
        {
            platforms.GET("", AIPermissionMiddleware("ai:platform:view"), aiPlatformHandler.List)
            platforms.GET("/:id", AIPermissionMiddleware("ai:platform:view"), aiPlatformHandler.Get)
            platforms.POST("", AIPermissionMiddleware("ai:platform:manage"), aiPlatformHandler.Create)
            platforms.PUT("/:id", AIPermissionMiddleware("ai:platform:manage"), aiPlatformHandler.Update)
            platforms.DELETE("/:id", AIPermissionMiddleware("ai:platform:manage"), aiPlatformHandler.Delete)
            platforms.POST("/:id/test", AIPermissionMiddleware("ai:platform:test"), aiPlatformHandler.Test)
        }
        
        // 异步任务
        ai.POST("/chat/task", AIPermissionMiddleware("ai:chat"), aiHandler.CreateTask)
    }
}
```

### 3.2 Agent 工具调用的 NS 级权限联动

```go
// Agent 工具执行时的权限校验
func (h *AgentToolsHandler) ExecuteTool(c *gin.Context) {
    var req struct {
        Tool      string                 `json:"tool"`
        Arguments map[string]interface{} `json:"arguments"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": "无效请求"})
        return
    }
    
    userID := c.GetUint("user_id")
    
    // 1. 检查用户是否有该工具的 AI 权限
    toolPermission := "ai:tool:" + req.Tool
    rbacService := service.NewRBACService(h.db)
    aiPerms, _ := rbacService.GetAIPermissions(c.Request.Context(), userID)
    if !contains(aiPerms, toolPermission) {
        c.JSON(403, gin.H{
            "error": "您没有使用该 Agent 工具的权限",
            "tool": req.Tool,
        })
        return
    }
    
    // 2. 检查 NS 级权限（涉及具体资源的工具）
    switch req.Tool {
    case "list_pods", "query_logs":
        clusterID := uint(req.Arguments["cluster_id"].(float64))
        namespace := req.Arguments["namespace"].(string)
        
        // 检查用户是否有该集群+NS 的权限
        _, err := rbacService.GetEffectiveRole(c.Request.Context(), userID, clusterID, namespace)
        if err != nil {
            c.JSON(403, gin.H{
                "error": "您无权访问该集群或命名空间",
                "cluster_id": clusterID,
                "namespace": namespace,
            })
            return
        }
    }
    
    // 3. 执行工具
    result, err := h.agentService.ExecuteTool(req.Tool, req.Arguments)
    // ...
}
```

---

## 四、前端展示控制

### 4.1 前端权限 Hook 扩展

```typescript
// frontend/src/hooks/useAIPermission.ts

import { useQuery } from '@tanstack/react-query';
import { api } from '../utils/api';

export function useAIPermission() {
    const { data: permissions, isLoading } = useQuery<string[]>({
        queryKey: ['ai-permissions'],
        queryFn: async () => {
            const res = await api.get('/users/me/ai-permissions');
            return res.data.permissions || [];
        },
        staleTime: 5 * 60 * 1000,
    });

    const has = (perm: string): boolean => {
        if (!permissions) return false;
        if (permissions.includes('*:*') || permissions.includes('ai:*')) return true;
        return permissions.includes(perm);
    };

    return {
        permissions,
        isLoading,
        // 基础对话
        canChat: has('ai:chat'),
        canAgentChat: has('ai:agent_chat'),
        canImageInput: has('ai:image_input'),
        canManageSessions: has('ai:session_manage'),
        
        // 平台管理
        canViewPlatforms: has('ai:platform:view'),
        canManagePlatforms: has('ai:platform:manage'),
        canTestPlatforms: has('ai:platform:test'),
        
        // 场景化 AI
        canLogAnalysis: has('ai:log_analysis'),
        canNetworkAnalysis: has('ai:network_analysis'),
        canInspectionAnalysis: has('ai:inspection_analysis'),
        
        // Agent 工具
        canToolListClusters: has('ai:tool:list_clusters'),
        canToolClusterStatus: has('ai:tool:cluster_status'),
        canToolListPods: has('ai:tool:list_pods'),
        canToolQueryLogs: has('ai:tool:query_logs'),
    };
}
```

### 4.2 AI 助手页面权限控制

```tsx
// frontend/src/pages/AI.tsx

const AI = () => {
    const {
        canChat,
        canAgentChat,
        canImageInput,
        canManageSessions,
        canToolListClusters,
    } = useAIPermission();

    // 如果连 ai:chat 都没有，直接显示无权限
    if (!canChat) {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="h6" color="text.secondary">
                    🔒 您没有使用 AI 助手的权限
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    请联系管理员为您开通 AI 对话权限
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', height: '100vh' }}>
            {/* 左侧会话列表 */}
            <Box sx={{ width: 260, borderRight: 1, borderColor: 'divider' }}>
                {canManageSessions && (
                    <Button 
                        fullWidth 
                        onClick={createSession}
                        startIcon={<AddIcon />}
                    >
                        新建会话
                    </Button>
                )}
                <SessionList />
            </Box>
            
            {/* 右侧聊天区域 */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* 模式切换 */}
                <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
                    <ToggleButtonGroup value={mode} onChange={setMode}>
                        <ToggleButton value="chat">普通对话</ToggleButton>
                        {canAgentChat && (
                            <ToggleButton value="agent">
                                🤖 Agent 模式
                            </ToggleButton>
                        )}
                    </ToggleButtonGroup>
                </Box>
                
                {/* 消息列表 */}
                <MessageList />
                
                {/* 输入区域 */}
                <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
                    {canImageInput && (
                        <IconButton title="上传图片">
                            <ImageIcon />
                        </IconButton>
                    )}
                    <TextField
                        placeholder={canAgentChat 
                            ? "输入问题，Agent 可帮您查询集群..." 
                            : "输入问题..."
                        }
                        // ...
                    />
                </Box>
            </Box>
        </Box>
    );
};
```

### 4.3 其他页面的 AI 功能入口控制

```tsx
// Logs.tsx - AI 日志分析按钮
const Logs = () => {
    const { canLogAnalysis } = useAIPermission();
    
    return (
        <Box>
            <LogTable />
            {canLogAnalysis && (
                <Button 
                    variant="contained" 
                    onClick={analyzeWithAI}
                    startIcon={<AIIcon />}
                >
                    AI 分析选中日志
                </Button>
            )}
        </Box>
    );
};

// Settings.tsx - AI 平台配置 Tab
const Settings = () => {
    const { canViewPlatforms, canManagePlatforms } = useAIPermission();
    
    return (
        <Tabs>
            <Tab label="数据源" />
            {canViewPlatforms && (
                <Tab label="AI 平台" />
            )}
            <Tab label="日志后端" />
        </Tabs>
    );
};
```

---

## 五、用户添加/编辑时的 AI 功能配置

### 5.1 前端交互设计

```
添加用户 / 编辑用户
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  基本信息                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 用户名: [________]   邮箱: [________]   角色: [▼ namespace-operator]│   │
│  │ 密码: [________]     状态: [● 启用 ○ 禁用]                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  AI 功能权限（基于角色默认，可单独调整）                                     │
│  ═══════════════════════════════════════════════════════════════════════   │
│                                                                             │
│  基础对话功能                                    [恢复默认]                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ AI 普通对话              ☑ AI Agent 对话              ☑ 图片输入  │   │
│  │ ☑ 会话管理                                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  AI 平台管理                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ 查看平台列表            ☑ 测试连通性                ☑ 管理平台   │   │
│  │    （增删改 AI 平台配置）                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  场景化 AI 分析                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ AI 日志分析             ☑ AI 网络追踪分析           ☑ AI 巡检分析 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Agent 工具调用（⚠️ 涉及集群资源访问）                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ 列出集群                ☑ 查看集群状态              ☑ 列出 Pod   │   │
│  │ ☑ 查询日志                                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  每日调用配额                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 限制每日 AI 调用次数: [无限 ○]  [● 自定义] [500] 次                │   │
│  │ （用于控制 AI 资源消耗，超出后当日禁用 AI 功能）                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│              [取消]                                    [保存]              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 后端 API

```yaml
# 获取当前用户的 AI 权限
GET /api/v1/users/me/ai-permissions
Response:
  {
    "permissions": [
      "ai:chat", "ai:agent_chat", "ai:image_input", "ai:session_manage",
      "ai:platform:view", "ai:platform:test",
      "ai:log_analysis", "ai:network_analysis",
      "ai:tool:list_clusters", "ai:tool:cluster_status", "ai:tool:list_pods"
    ],
    "role_defaults": ["..."],     # 角色默认权限
    "enabled_overrides": ["..."], # 用户额外开启的
    "disabled_overrides": ["..."],# 用户额外禁用的
    "daily_quota": 0,             # 0 = 不限
    "daily_used": 45              # 今日已用
  }

# 更新用户的 AI 权限（需要 platform:manage 权限）
PUT /api/v1/users/:user_id/ai-permissions
Request:
  {
    "enabled_modules": ["ai:platform:manage"],
    "disabled_modules": ["ai:agent_chat"],
    "daily_quota": 1000
  }
```

---

## 六、AI 调用配额控制

### 6.1 配额机制

```go
// 每日配额检查
func (s *AIService) CheckQuota(ctx context.Context, userID uint) error {
    var userAI model.UserAIPermission
    if err := s.db.Where("user_id = ?", userID).First(&userAI).Error; err != nil {
        return nil // 没有配置 = 不限额
    }
    
    if userAI.DailyQuota <= 0 {
        return nil // 0 = 不限额
    }
    
    // 查询今日调用次数
    today := time.Now().Format("2006-01-02")
    key := fmt.Sprintf("ai:quota:%d:%s", userID, today)
    
    count, _ := s.redis.Get(ctx, key).Int()
    if count >= userAI.DailyQuota {
        return fmt.Errorf("今日 AI 调用配额已用完（%d/%d）", count, userAI.DailyQuota)
    }
    
    // 增加计数
    s.redis.Incr(ctx, key)
    s.redis.Expire(ctx, key, 24*time.Hour)
    
    return nil
}

// 在 AI 对话 handler 中调用
func (h *AIHandler) Chat(c *gin.Context) {
    userID := c.GetUint("user_id")
    
    // 检查配额
    if err := h.aiService.CheckQuota(c.Request.Context(), userID); err != nil {
        c.JSON(429, gin.H{"error": err.Error()})
        return
    }
    
    // 执行对话...
}
```

---

## 七、实施计划（AI 权限纳入 Phase 1）

| 任务 | 内容 | 工作量 |
|------|------|--------|
| 数据库 | `user_ai_permissions` 表 + 角色模板 permissions 扩展 | 0.5 天 |
| 后端 | AI 权限校验中间件 + API 级控制 | 1 天 |
| 后端 | Agent 工具 NS 级权限联动 | 0.5 天 |
| 后端 | AI 调用配额控制 | 0.5 天 |
| 前端 | `useAIPermission` Hook | 0.5 天 |
| 前端 | AI 助手页面权限控制（模式切换/图片/会话） | 0.5 天 |
| 前端 | Logs/NetworkTrace/Settings 页面 AI 入口控制 | 0.5 天 |
| 前端 | 用户添加/编辑页面的 AI 权限配置面板 | 1 天 |
| 测试 | 各角色权限验证 | 0.5 天 |

**总计：约 5 个工作日**

---

## 八、总结

| 问题 | 方案 |
|------|------|
| 如何控制 AI 功能使用？ | 角色模板定义默认 AI 权限 + 用户级可覆盖 |
| viewer 能用 AI 吗？ | 能基础聊天，不能 Agent/场景化分析/平台管理 |
| admin 有什么 AI 权限？ | 全部 |
| operator 有什么 AI 权限？ | 聊天 + 场景化分析 + 部分 Agent 工具，不能管理平台 |
| Agent 工具会不会泄露未授权 NS 数据？ | 工具执行时校验 NS 级权限，无权限返回 403 |
| 如何防止 AI 被滥用？ | 支持每日调用配额控制 |

---

*方案版本：V1*
*撰写日期：2026-04-19*
*适用范围：AI 助手全功能模块的权限控制*
