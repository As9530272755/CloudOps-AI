# 系统架构说明

本文档介绍 CloudOps Platform 的整体架构设计、模块划分以及核心数据流。

---

## 一、总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           用户层 (Browser)                           │
│         React + Vite + Material-UI + TanStack Query                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS
┌───────────────────────────────▼─────────────────────────────────────┐
│                          网关层 (Nginx)                              │
│            反向代理、负载均衡、静态资源托管、WebSocket                │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│                          后端层 (Go + Gin)                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ 认证中心 │ │ 集群管理 │ │ K8s资源 │ │ 巡检中心 │ │ AI 对话 │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│  │ 数据源  │ │ 仪表盘  │ │ 网络追踪 │ │ 日志管理 │                   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘                   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼──────┐     ┌──────────▼──────────┐  ┌────────▼──────┐
│  PostgreSQL  │     │       Redis         │  │  AI Provider  │
│  (主数据库)   │     │    (缓存/任务状态)   │  │ OpenClaw/Ollama│
└──────────────┘     └─────────────────────┘  └───────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Kubernetes API      │
                    │   (Multi-Cluster)     │
                    └───────────────────────┘
```

---

## 二、模块说明

### 2.1 前端 (Frontend)

- **框架**：React 18 + TypeScript + Vite
- **UI 库**：Material-UI (MUI) v5
- **状态管理**：TanStack Query（服务端状态）+ React Hooks（本地状态）
- **路由**：React Router v6
- **图表**：ECharts / Recharts
- **特色**：
  - 暗黑/亮色主题切换
  - 响应式布局（支持移动端侧边栏折叠）
  - AI 聊天支持 Markdown 渲染、代码高亮、图片粘贴上传

### 2.2 后端 (Backend)

- **语言**：Golang 1.21+
- **Web 框架**：Gin
- **ORM**：GORM v2
- **认证**：JWT（Access Token + Refresh Token）
- **架构模式**：Handler → Service → Model/Package

#### Handler 层

负责 HTTP 请求接收、参数校验、响应封装。

#### Service 层

负责业务逻辑处理，调用内部包或外部服务。

#### Package 层

- `pkg/ai`：AI Provider 抽象接口（OpenClaw / Ollama 统一封装）
- `pkg/auth`：JWT 生成与校验
- `pkg/config`：Viper 配置加载
- `pkg/crypto`：AES-256 加密（AI Token 安全存储）
- `pkg/database`：GORM 初始化与自动迁移
- `pkg/redis`：Redis 客户端封装
- `pkg/k8s`：Kubernetes client-go 封装，支持多集群 Informer

### 2.3 数据库

- **PostgreSQL**：主数据库，存储用户、集群、巡检、仪表盘、AI 任务等持久化数据。


### 2.4 缓存

- **Redis**：用于 AI 异步任务状态缓存、热数据加速。
- **sync.Map**：Redis 不可用时作为内存回退缓存。

### 2.5 AI 中台

通过统一接口 `ai.Provider` 屏蔽不同 AI 平台的差异：

```go
type Provider interface {
    Name() string
    ChatCompletion(ctx context.Context, messages []Message) (string, error)
    ChatCompletionStream(ctx context.Context, messages []Message, onChunk func(StreamResponse)) error
    ListModels(ctx context.Context) ([]string, error)
    HealthCheck(ctx context.Context) error
    SetSessionID(id string)
}
```

当前支持：
- **OpenClaw**：OpenAI 兼容 API，支持 session 绑定、多模态图片输入
- **Ollama**：本地大模型部署，低成本私有化

---

## 三、核心数据流

### 3.1 用户认证

```
Browser → POST /api/v1/auth/login
Backend → 校验密码 → 生成 JWT → 返回 access_token + refresh_token
Browser → 后续请求 Header: Authorization: Bearer <token>
Backend → AuthMiddleware → 校验 JWT → 注入 user_id 到 Context
```

### 3.2 AI SSE 流式对话（默认架构）

```
1. User 发送消息（可能带图片）
   Browser → POST /api/v1/ai/chat/stream  (SSE)
   Backend → OpenClaw/Ollama 流式接口
   → 每收到一个 chunk 立即 flush 到前端

2. 前端原生 DOM 增量渲染
   Browser → fetch ReadableStream 解析 data: {...}
   → StreamingMessage 组件通过 marked.parse() 直接写 innerHTML
   → 流结束后一次性写回 React State
```

> 注：后端仍保留 `POST /api/v1/ai/chat/task` + `GET /api/v1/ai/chat/task/:id` 异步任务接口，供需要后台离线分析的场景调用，但 AI 助手默认已改为直接 SSE 流式输出。

### 3.3 K8s 资源查询

```
Browser → GET /api/v1/clusters/:id/resources/pods?namespace=default
Backend → 从 K8sManager 获取对应集群的 ClientSet
        → 调用 K8s API Server → 返回资源列表
```

### 3.4 网络追踪

```
Browser → POST /api/v1/clusters/:id/network/debug
Backend → 在目标节点启动 ephemeral debug container（nicolaka/netshoot）
        → 执行 tcpdump / traceroute / curl 等命令
        → 返回抓包日志
Browser → AI 分析日志 → 得到网络诊断结论
```

---

## 四、扩展设计

### 4.1 新增 AI Provider

1. 在 `internal/pkg/ai/` 下新建文件（如 `custom.go`）
2. 实现 `ai.Provider` 接口
3. 在 `factory.go` 的 `NewProvider()` 中注册

### 4.2 新增业务模块

1. `internal/model/` 定义 GORM 模型
2. `internal/service/` 实现业务逻辑
3. `internal/api/handlers/` 实现 HTTP Handler
4. `internal/api/routes.go` 注册路由
5. `frontend/src/pages/` 新增页面组件
6. `frontend/src/lib/` 新增 API 封装
