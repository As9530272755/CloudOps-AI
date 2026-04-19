# CloudOps AI 集成项目上下文

> 本文件用于在全新 AI 会话中快速恢复项目上下文。下次启动时，将本文件内容粘贴给 AI 助手即可。
>
> ⚠️ **开发规范：每次进行任何模块开发后，必须将本次开发记录追加写入本文件末尾（按日期编号），确保项目上下文持续同步。**

---

## 一、项目概况

- **仓库地址**：https://github.com/As9530272755/CloudOps-AI
- **技术栈**：Golang + Gin + PostgreSQL/SQLite + Redis + React + Vite + TypeScript + Material-UI
- **运行环境**：后端 `10.0.0.200:9000`，前端 `10.0.0.200:18000`
- **AI 中台**：对接 OpenClaw (`127.0.0.1:18789`) 和 Ollama (`192.168.1.211:11434`)

---

## 二、已完成的核心改造（必须知晓）

### 2.1 AI 助手：异步任务轮询架构 ⭐ 重点
由于 OpenClaw/Ollama 执行长耗时任务（工具链、kubectl 分析）时容易超时，已将 AI 对话从 SSE 长连接改造为**异步任务轮询**：

- **新 API**：
  - `POST /api/v1/ai/chat/task` — 创建任务，返回 `task_id`
  - `GET /api/v1/ai/chat/task/:id` — 轮询任务状态
- **实现位置**：
  - 后端：`internal/service/ai_task_service.go` + `internal/api/handlers/ai_chat.go`
  - 前端：`frontend/src/pages/AI.tsx` + `frontend/src/lib/ai-chat-api.ts`
- **数据流**：前端发送消息 → 后端创建任务并启动 goroutine 调用 AI → 每收到 chunk 写入 Redis → 前端每 2 秒轮询 → 任务完成后落盘 PostgreSQL
- **降级**：Redis 不可用时自动回退到 `sync.Map` 内存缓存

### 2.2 AI 助手：Markdown 与图片支持
- **Markdown 渲染**：使用 `react-markdown` + `remark-gfm`，支持表格、代码块、列表、加粗、斜体、引用等
- **图片上传/粘贴**：前端 Canvas 压缩（最大宽度 1024px，JPEG 质量 0.8）后发送；支持点击上传和 `Ctrl+V` 粘贴截图
- **多模态格式**：
  - OpenClaw：按 OpenAI 标准发送 `content` 数组（`text` + `image_url`）
  - Ollama：`images` 字段传纯 Base64（已自动剥离 `data:image/jpeg;base64,` 前缀）

### 2.3 修复 /logs 白屏
- **根因**：`Logs.tsx` 中 `clusterAPI.getClusters()` 返回的是 `{ data: { clusters: [...] } }`，但代码直接调用了 `res.data.map()`，导致 TypeError 崩溃
- **修复**：正确解析 `res.data.clusters || []`，并对 `clusters.map` 和 `pods.map` 增加防御性过滤

### 2.4 超时优化
- 前端 axios 超时：30s → **120s**（`frontend/src/lib/api.ts`）
- Ollama 后端 Provider 超时：60s → **600s**（`internal/service/ai_config_service.go` 中针对 `ollama` 单独设置）
- OpenClaw 后端超时保持 60s

### 2.5 系统提示词去身份化
- 移除了前端 `AI.tsx` 中硬编码的 `"你是 CloudOps 平台的 AI 运维助手..."`
- 当前 system prompt 为：`"请用中文简洁准确地回答用户问题。"`
- 本地缓存 key 已迁移为 `cloudops-ai-messages-v2`，旧缓存会被自动清理

### 2.6 自定义资源定义（CRD）全链路支持
- 后端 `k8s_manager.go` 引入 `apiextensions-apiserver` informer，支持 CRD 列表缓存
- 后端 `k8s_resource_service.go` 新增 `customresourcedefinitions` 到全局搜索和分类统计
- 前端 `ClusterDetail.tsx` 左侧菜单新增「自定义资源」分类，表格展示 name / group / scope / versions / established

### 2.7 集群删除硬修复
- **根因**：`DeleteCluster` 原使用 Gorm 软删除，删除同名集群后无法重新添加（`uni_clusters_name` 唯一索引冲突）
- **修复**：`internal/service/cluster_service.go` 改为 `Unscoped().Delete` 物理删除，并级联删除 `cluster_secrets`、`cluster_metadata`、`cluster_permissions`

### 2.8 资源列表关键字搜索
- 后端 `k8s_manager.go`：所有 `GetNamespacedResourceList` / `GetClusterResourceList` 新增 `keyword` 参数，按资源名称模糊过滤
- 后端 `k8s.go` handler 与前端 `k8s-api.ts` 同步透传 `keyword`
- 前端 `ClusterDetail.tsx` 各资源子页面顶部新增搜索框，300ms debounce

### 2.9 YAML 展示与交互修复
- **格式修复**：`k8s_resource_service.go` 的 `GetResourceYAML` 先将对象转为 `unstructured.Unstructured`，手动注入正确的 `apiVersion`/`kind`，并清理 `managedFields` / `status` 噪音字段，输出与 `kubectl get -o yaml` 一致
- **前端展示**：`ClusterDetail.tsx` 的 YAML 弹窗从 `<pre>` 纯文本升级为 **Monaco Editor**，支持语法高亮、行号、暗色主题
- **复制修复**：在非 HTTPS/localhost 环境下，浏览器安全策略会阻止 Monaco Editor 直接复制。采用"Monaco 负责展示 + 隐藏 `<pre>` 负责复制"的兼容方案，稳定支持 Chrome / Edge / 360 等浏览器
- **下载按钮**：新增独立的「下载 YAML」按钮，可直接导出 `.yaml` 文件

---

## 三、关键文件清单

| 功能 | 后端文件 | 前端文件 |
|------|----------|----------|
| AI Provider 接口 | `internal/pkg/ai/provider.go` | — |
| OpenClaw 实现 | `internal/pkg/ai/openclaw.go` | — |
| Ollama 实现 | `internal/pkg/ai/ollama.go` | — |
| AI 任务服务 | `internal/service/ai_task_service.go` | — |
| AI 配置服务 | `internal/service/ai_config_service.go` | — |
| AI Handler | `internal/api/handlers/ai_chat.go` | — |
| 路由注册 | `internal/api/routes.go` | — |
| Redis 封装 | `internal/pkg/redis/redis.go` | — |
| AITask 模型 | `internal/model/ai_task.go` | — |
| AI 助手页面 | — | `frontend/src/pages/AI.tsx` |
| AI API 封装 | — | `frontend/src/lib/ai-chat-api.ts` |
| 通用 API 封装 | — | `frontend/src/lib/api.ts` |
| 日志页面 | — | `frontend/src/pages/Logs.tsx` |
| CRD / 资源管理 | `internal/service/k8s_manager.go`<br>`internal/service/k8s_resource_service.go`<br>`internal/api/handlers/k8s.go` | `frontend/src/pages/ClusterDetail.tsx`<br>`frontend/src/lib/k8s-api.ts` |
| 集群生命周期 | `internal/service/cluster_service.go` | — |
| YAML 展示组件 | — | `frontend/src/pages/ClusterDetail.tsx` (Monaco Editor) |

---

## 四、已知问题与限制

1. **OpenClaw 图片识别 500 错误**
   - 现象：发送图片后 OpenClaw 返回 `500 Internal Server Error (ref: xxx)`
   - 原因：OpenClaw 内部 Agent 或上游模型可能不支持多模态图片输入
   - 排查：需查看 OpenClaw 服务端日志定位具体 ref ID

2. **Ollama 大模型加载极慢**
   - 配置的 `qwen3.5:397b-cloud` 是 397B 参数超大模型，首次加载到显存可能需要数分钟
   - 如果 10 分钟后仍超时，说明远程服务器显存/内存不足，建议换用更小模型（如 `qwen2.5:14b`、`gemma3:12b`）
   - 远程 Ollama 必须设置 `OLLAMA_HOST=0.0.0.0`

3. **前端构建产物较大**
   - 当前 `index.js` 约 3.3MB（未做代码分割），建议后续引入 `dynamic import` 优化

4. **YAML 复制在 HTTP 内网 IP 下的限制（已兼容）**
   - 原因：Chrome/Edge 等浏览器在非 HTTPS / 非 localhost 环境下会静默拦截剪贴板写入
   - 现状：已通过"Monaco 展示 + 隐藏 `<pre>` 复制"方案解决，并额外提供「下载 YAML」按钮作为备用出口

---

## 五、常用运维命令

```bash
# 编译并启动后端
cd /data/projects/cloudops-v2
GOPROXY=https://goproxy.cn,direct go build -o cloudops-backend ./cmd/server
./cloudops-backend

# 构建并启动前端
cd frontend
npm install
npm run build
npx vite preview --port 18000 --host

# 强制刷新浏览器（用户侧）
Ctrl + F5

# Git 提交（我应主动执行）
git add .
git commit -m "<type>(<scope>): <message>"
git push origin main
```

---

## 六、环境信息

- **OpenClaw**：`http://127.0.0.1:18789`
- **Ollama**：`http://192.168.1.211:11434`
- **PGSQL**：`localhost:5432/cloudops`
- **Redis**：`localhost:6379`
- **默认账号**：`admin / admin`

---

## 七、开发环境热重载配置（2026-04-14 更新）

为解决持续开发时手动重启前后端的问题，已将服务切换为开发模式：

- **后端热重载**：使用 `air` (`github.com/air-verse/air`)
  - 安装位置：`/root/go/bin/air`
  - 配置文件：`.air.toml`（已修正 `cmd = "go build -o ./tmp/main ./cmd/server"`）
  - 效果：保存任何 `.go` 文件后自动编译并重启后端
  - 启动命令：
    ```bash
    cd /data/projects/cloudops-v2
    nohup /root/go/bin/air > air.log 2>&1 &
    ```

- **前端热刷新（HMR）**：使用 `vite` 开发服务器
  - 命令：`npm run dev`（端口 18000）
  - 效果：保存 React/TS 代码后浏览器秒级热刷新
  - 启动命令：
    ```bash
    cd /data/projects/cloudops-v2/frontend
    nohup npm run dev > dev.log 2>&1 &
    ```

> ⚠️ 注意：长期运行的服务必须用 `nohup` 启动，直接后台任务会受 60s 超时限制而被强制终止。

---

*最后更新：2026-04-14*


---

## 八、2026-04-15 开发记录

### 8.1 网络追踪：亮色模式拓扑图文字不可见
- **根因**：`FlowTopologyGraph.tsx` 中节点/边标签使用了硬编码 `#ffffff`（白色），在亮色主题背景上完全不可见
- **修复**：标签颜色改为根据 `theme.palette.mode` 动态切换
  - 暗色：`#ffffff`
  - 亮色：`#1a237e`（深蓝文字）+ `#e0e0e0` 描边

### 8.2 网络追踪：Ephemeral Container 抓包失败
- **根因 1（前端）**：`resolveDebugTarget()` 在选中非 Pod 节点（Service/Ingress/外部 IP）时，会把节点 `name` 直接当成 Pod 名传给后端，导致 Patch Pod 时 `not found`
- **修复 1**：只有 `id.startsWith('pod:')` 的节点才直接使用；其他情况回退到页面顶部当前追踪的目标 Pod
- **根因 2（后端）**：K8s `ephemeralcontainers` 子资源不接受 `StrategicMergePatchType`，返回 500
- **修复 2**：`internal/service/network_trace_service.go` 中将 patch 类型改为 `types.MergePatchType`

### 8.3 网络追踪：拓扑图空白不渲染
- **根因**：`FlowTopologyGraph.tsx` 中 ECharts 初始化与 `setOption` 的生命周期不同步。`buildOption` 的 `useEffect` 在实例创建前已执行完毕，实例创建后该 effect 不再触发
- **修复**：引入 `chartKey` state，在 ECharts 初始化完成后递增 `chartKey`，触发 `setOption` effect 重新执行

### 8.4 AI 助手：上下文过长导致超时
- **根因**：前端把完整对话历史（可能几十上百条）全部发往后端，OpenClaw 内部转发给多模型时处理时间指数增长，最终超时
- **修复**：
  - **前端**：`buildSendMessages` 截断为最近 **10** 条非 system 消息
  - **后端**：`internal/service/ai_service.go` 新增 `truncateMessages`，强制截断为 `system + 最近 10 条`
- **超时调大**：
  - CloudOps：`data/ai_platform_config.json` 中 `openclaw.timeout` 从 `600` 改为 `1800`
  - OpenClaw：`agents.defaults.timeoutSeconds` 从默认值改为 `1800`

### 8.5 AI 助手：控制台 DOM 嵌套警告
- **根因**：`AI.tsx` 中 `ReactMarkdown` 的 `code` 组件在非 inline 时返回了 `<Box component="pre">`，与 ReactMarkdown 默认的 `<pre>` wrapper 嵌套，导致 `<pre>` 出现在 `<p>` 中
- **修复**：拆分为独立的 `pre` 组件和 `code` 组件，渲染结构变为标准 `<pre><code>...</code></pre>`

### 8.6 AI 助手：从轮询改为 SSE 流式
- **背景**：异步轮询每 2 秒刷新一次，长任务期间前端长时间空白
- **修复**：
  - `frontend/src/pages/AI.tsx`：`handleSend` 改为直接调用 `aiChatAPI.chatStream()`
  - 文字逐字实时出现，支持发送中断（`AbortController`）

### 8.7 AI 助手：长 URL / 长文本显示被截断
- **根因**：用户消息气泡也走了 `ContentBlock`（ReactMarkdown），URL 被解析成 `<a>` 链接后颜色与蓝色气泡背景融合，导致“看不见”
- **修复**：
  - user 消息改为 `<Typography>` 纯文本显示
  - 气泡添加 `wordBreak: 'break-all'`，长文本自动换行

### 8.8 AI 助手：输入框换行支持
- **修复**：`Ctrl+Enter` / `Shift+Enter` / `Cmd+Enter` 插入换行；单独按 `Enter` 发送
- 实现：监听 `keydown`，对 `Ctrl/Cmd+Enter` 在 `selectionStart` 处手动插入 `\n`

### 8.9 AI 助手：SSE 流式长内容卡顿 → 原生 DOM 增量更新
- **根因**：SSE 每收到一个 token 就 `setMessages`，触发 `remarkGfm` 全量重解析越来越长的 Markdown，主线程卡死
- **修复**：新增 `StreamingMessage` 组件
  - 流式阶段：使用 `marked.parse()` + `innerHTML` 原生 DOM 增量刷新，零 React re-render，同时保证流式期间 Markdown 格式（表格、代码块、标题）实时可见
  - 流结束：一次性 `setMessages`，由 `ContentBlock`（ReactMarkdown）接管最终渲染

### 8.10 AI 助手：流式结束后内容变空白 / "内容未加载完成"
- **根因 1（重复 `done`）**：`ai-chat-api.ts` 的 SSE 解析在 `[DONE]` 和 `reader.read() EOF` 两处都会触发 `onMessage({ done: true })`。第一次 `done` 把内容保存到 `messages` 后立即清空 `streamingContentRef`，第二次 `done` 用空字符串覆盖了刚刚保存的内容
- **修复 1**：`handleSend` 中引入 `hasEnded` 标记，确保收尾逻辑（保存内容、清空 ref、关闭 loading）**只执行一次**
- **根因 2（快速双击发送）**：`setStreaming(true)` 异步生效前，快速按两次 Enter 会启动两个并发的流，第二个流会把共享的 `streamingContentRef` 重置为空
- **修复 2**：引入 `sendingRef` 物理锁，阻止 `handleSend` 重复进入
- **根因 3（残留空白 loading 消息）**：旧版轮询或流中断后，`localStorage` 里残留了 `loading: true` 且 `content: ''` 的 assistant 消息， reopen 页面时显示 "（内容未加载完成）"
- **修复 3**：`useState` 初始化时自动清理：有内容的 loading 消息标记为已完成，空内容的直接过滤删除

### 8.11 AI 助手：流式阶段不自动滚动
- **根因**：`StreamingMessage` 通过原生 DOM `innerHTML` 追加内容，不触发 React 的 `useEffect`，页面不会跟着内容增长向下滚动
- **修复**：在 `StreamingMessage.render()` 中每次更新后主动调用 `divRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })`
- **附加修复**：去掉了 AI 消息气泡的 `maxHeight: 520px` 限制，长消息可以自然向下展开，带动后续内容整体下滚

### 8.12 AI 助手：消息时间戳
- **需求**：长对话中难以判断各轮消息的先后顺序
- **修复**：
  - `ChatMessage` 新增 `timestamp` 字段
  - 发送消息时记录 `Date.now()`
  - 每条消息气泡下方显示 `M月D日 HH:MM:SS`

### 8.13 AI 助手：Ollama 模型 keep-alive
- **根因**：Ollama 默认 5 分钟后卸载模型，长对话或等待期间模型被卸载，后续请求重新加载耗时数分钟
- **修复**：`internal/pkg/ai/ollama.go` 中所有请求统一添加 `"keep_alive": "30m"`

### 8.14 AI 助手：OpenClaw 下游模型超时（外部问题）
- **现象**：OpenClaw 返回 `All models failed (9): qwen/...: LLM request timed out | kimi/...: This operation was aborted`
- **定性**：这是 **OpenClaw 与其上游模型商之间的网络/配额/服务稳定性问题**，不是 CloudOps 代码 Bug
- **影响**：若 `data/ai_platform_config.json` 中 `provider` 为 `openclaw`，则 AI 助手可能无法获得回复
- **Workaround**：临时将 `provider` 切换为 `ollama`，绕过 OpenClaw 故障

### 8.15 前端 UI：iOS 风格扁平化重设计
- **改造内容**：全站按钮移除渐变、统一 12px 圆角、采用 Inter 字体、去除玻璃拟态效果
- **影响范围**：所有 MUI 组件主题 (`theme.ts`) 及各个页面按钮/卡片样式

### 8.16 系统：Admin 登录修复
- **根因**：`users.password_hash` 中存的是假 hash `hashed_admin_1775702881`，而 `CheckPassword` 已改为真实 `bcrypt.CompareHashAndPassword`
- **修复**：数据库中 `admin` 用户的密码 hash 更新为真实 bcrypt hash，账号 `admin / admin` 可正常登录

### 8.17 AI 助手：页面布局溢出修复
- **根因**：消息气泡无宽度限制、长文本撑开容器，导致顶部栏被推出视口
- **修复**：根容器添加 `overflow: 'hidden'`、`flexWrap`，消息气泡限制 `maxWidth: '80%'`

### 8.18 AI 助手：跨导航 Sidebar Spinner 修复
- **根因**：切到其他页面再回来，SSE 已结束但前端 pending 状态丢失，spinner 一直转
- **修复**：`pendingRepliesRef` 持久化到 `sessionStorage`；`switchSession` 加载消息时自动校验：若最后一条 DB 消息已是 assistant 且内容完整，强制把 pending 置为 `loading: false`

### 8.19 巡检中心：删除集群的巡检结果过滤
- **根因**：集群被删除后，其历史 `inspection_results` 仍留在数据库，`GetJob` 返回了已不存在集群的数据
- **修复**：`internal/api/handlers/inspection.go` 的 `GetJob` 增加 `WHERE cluster_id IN (SELECT id FROM clusters)` 过滤

### 8.20 AI 助手：in-session streaming spinner 卡住修复
- **根因**：SSE `done` 到达后调用 `StreamingMessage.finalize()`，若 `divRef` 已卸载会抛异常，中断后续 `setStreaming(false)`
- **修复**：所有 `finalize()` 调用点（done / error / watchdog 超时）统一加 `try/catch` 保护，确保状态必定被重置

### 8.21 AI 助手：长对话性能优化
- **根因**：
  1. `input` 状态在顶层 `AI()`，每次按键触发整棵树重渲染
  2. 历史消息无 `memo`，`ReactMarkdown` 重复解析
  3. 所有消息真实 DOM 节点只增不减
  4. `StreamingMessage` 流式阶段每 chunk 都 `marked.parse` 全部内容
- **修复**：
  1. 提取独立 `ChatInput` 组件，`input` 状态下沉
  2. `ContentBlock`、`MessageItem` 全部 `React.memo`
  3. 引入 `react-virtuoso` 虚拟滚动，仅渲染可视区域消息
  4. `StreamingMessage.append` 改为纯文本节点追加，零 markdown 解析开销，结束时再统一 `marked.parse`

### 8.22 AI 助手：新增「回到底部」快捷按钮
- **需求**：历史消息较长时，用户上翻查看后需要一键快速回到最新消息
- **实现**：聊天区域底部居中浮动按钮，仅在用户向上滚动离开底部时显示，点击后平滑滚动至最后一条消息

### 8.23 日志中心：一集群多后端架构重构
- **背景**：原 `cluster_metadata.log_backend` 为单条 JSON 字符串，保存即覆盖，无法支持一个集群同时对接多套日志后端（如 ES + OS + Loki）
- **改造**：
  - 新增独立表 `cluster_log_backends`（字段：`id / cluster_id / name / type / url / index_patterns / headers`）
  - 后端 `LogService` 全面改为按 `backend_id` 查询：`ListLogBackends / GetLogBackend / CreateLogBackend / UpdateLogBackend / DeleteLogBackend`
  - 旧配置自动迁移：启动时读取 `cluster_metadata.log_backend` 并写入新表
  - 路由更新：`/log-backends` CRUD + `/log-backends/:id/test`
- **关键文件**：`internal/model/models.go`、`internal/pkg/database/database.go`、`internal/service/log_service.go`、`internal/api/handlers/log.go`、`internal/api/routes.go`

### 8.24 日志中心：Settings 页日志后端配置交互重做
- **改造前**：列出全部集群，无删除按钮，弹窗无测试连接
- **改造后**：
  - 只展示**已配置的后端列表**（名称 / 集群 / 类型 / 地址 / 操作）
  - 顶部统一「添加日志后端」按钮
  - 弹窗必填：集群、自定义名称（如 `KS-OS-01`）、类型、URL、用户名密码、各场景索引模式
  - 弹窗内置**独立「测试连接」按钮**：先保存当前表单，再发起连通性测试
  - 每行支持：编辑、测试、删除
- **关键文件**：`frontend/src/pages/Settings.tsx`、`frontend/src/lib/log-backend-api.ts`

### 8.25 日志中心：查询页面全新设计
- **Tab 扩展**：新增「全部日志」，与「Ingress」「CoreDNS」「LB」并列
- **查询对象变更**：从「集群多选」改为「日志后端多选」，选项格式 `集群名 / 后端名称 (类型)`
- **全局关键字搜索**：支持 `log`、`message`、`host`、`path`、`pod_name`、`namespace_name`、`container_name` 多字段最佳匹配，命中文字**黄色高亮**
- **顶部统计卡片**：总日志数 / Error / Warn / Info / 其他，小白一眼看懂
- **日志流可视化升级**：
  - **级别色条**：左侧颜色条标识 Error（红）、Warn（黄）、Info（蓝）、Debug（灰）
  - **关键字高亮**：全局关键字在日志正文中黄色高亮
  - **结构化展开**：点击 ▼ 展开查看完整 JSON 字段
  - **虚拟滚动**：引入 `react-virtuoso`，千条日志不卡顿
  - **时间分布图**：单后端查询时右侧显示精简柱状图
- **关键文件**：`frontend/src/pages/Logs.tsx`

### 8.26 日志中心：后端查询逻辑修复
- **OpenSearch 适配器缺失**：`internal/pkg/log/factory.go` 未识别 `opensearch`，保存后实际创建 `unknownAdapter`，测试连接报「未配置或未识别日志后端」
  - **修复**：`opensearch` 与 `elasticsearch` 共用 `ESAdapter`
- **硬编码过滤不匹配**：ES adapter 对 Ingress 强制 `namespace=ingress-nginx AND container=controller`，与现场 fluent-bit 全量采集模式不符，导致 0 条结果
  - **修复**：去掉硬编码 `namespace/container` 过滤，所有过滤通过用户输入完成
- **Count 预检过严**：15 分钟全量日志达 1.8 万条，超过 10k 直接被拒
  - **修复**：阈值放宽至 **5 万条**
- **索引模式不匹配**：默认 `nginx-ingress-*` / `logstash-*` 与用户实际索引 `k8s-es-logs-*` / `k8s-os-logs-*` 不符
  - **修复**：更新数据库中已存配置的索引模式；后端 `resolveIndex` 对 `all/app` 优先回退 `app` 配置
- **Histogram 白屏**：无日志时后端省略 `histogram` 字段，前端 `setHistogram(undefined)` 后访问 `undefined.length` 崩溃
  - **修复**：前端 `|| []` 兜底 + 后端初始化空数组
- **cluster_id 丢失**：`QueryLogsMultiBackend` 未将 `b.ClusterID` 写入 `reqCopy`
  - **修复**：正确透传 `ClusterID`，日志条目显示正常集群名

### 8.27 全站删除弹窗 UI 统一
- **背景**：各页面使用浏览器原生 `confirm()`，风格老旧且不一致
- **修复**：
  - 新增通用组件 `frontend/src/components/ConfirmDialog.tsx`（MUI Dialog + Alert 风格）
  - 替换所有 `confirm()`：Settings（数据源 / AI 平台 / 日志后端）、Clusters（集群删除）、AI（会话删除 / 清空消息）、Inspection（巡检任务删除）、Dashboard（面板删除）

### 8.28 日志中心：数据验证结果
- `ks-es`（`http://10.0.0.11:30920`，索引 `k8s-es-logs-*`）15 分钟全量日志约 **1 万+ 条**，查询正常
- `ks-os`（`http://10.0.0.11:30921`，索引 `k8s-os-logs-*`）15 分钟全量日志约 **1 万+ 条**，查询正常
- `yh` 集群地址 `elasticsearch.wordpress.svc:9200` 为集群内部域名，后端无法解析，需用户修改为 NodePort 或外部可访问地址

---

## 九、2026-04-16 开发记录

### 9.1 Agent Runtime：核心链路打通
- **目标**：在 Node.js 侧运行独立的 Agent Runtime，通过 Pi SDK 对接 Ollama 实现多轮工具调用
- **进展**：
  - `agent-runtime/src/agent-handler.ts` 重构为独立导出（`createSession` / `runPrompt` / `disposeSession`）
  - `agent-runtime/src/server.ts` 暴露 REST API：`POST /v1/agent/sessions`、SSE `POST /v1/agent/sessions/:id/prompt`、`DELETE /v1/agent/sessions/:id`
  - 端到端验证通过：`curl` 可直接触发 `list_clusters` → `get_cluster_status` → 中文总结 的完整多轮工具链
- **关键文件**：`agent-runtime/src/agent-handler.ts`、`agent-runtime/src/server.ts`、`agent-runtime/src/ollama-stream.ts`

### 9.2 Ollama 适配器增强
- **上下文扩大**：`num_ctx=65536`，适配 K8s 长日志/大 YAML 场景
- **流式协议**：自定义 NDJSON 解析，支持 `text_delta` / `thinking_delta` 增量输出
- **工具调用**：原生识别 `tool_name` 字段，自动触发 `tool_execution_start` / `tool_execution_end`

### 9.3 Go Tool Bridge
- **新增内部接口**：`POST /internal/agent/tool-execute`（仅允许 127.0.0.1 / 10.0.0.200 访问）
- **实现**：`internal/api/handlers/agent_tools.go` 直接复用现有 `K8sResourceService` 和 `LogService`，无需重复写 K8s 调用逻辑
- **验证**：Agent Runtime 通过 HTTP 调用 Go 后端，kubectl / 日志查询 / 集群状态 等工具正常返回

### 9.4 前端 SSE 渲染问题（已暂停）
- **现象**：`curl` 能实时收到 50+ 条 SSE 事件，但浏览器中 Agent 模式聊天 UI 空白不渲染
- **排查**：
  - 已尝试 `fetch` + `ReadableStream`、`EventSource`、`XMLHttpRequest` 三种方案
  - 切换到生产构建 (`vite preview`) 后问题依旧
  - 排除后端问题，判断为浏览器端跨域/分块传输缓冲行为差异
- **结论**：与用户协商后，**暂时搁置 Agent 模式前端开发**，先隐藏 UI 入口避免误导

### 9.5 诊断页面
- 新增 `frontend/public/agent-debug.html`：纯 HTML 页面，可直接测试后端 SSE 流，用于前后端问题隔离

---

## 十、2026-04-17 开发记录

### 10.1 前端：隐藏 Agent 模式入口
- 为避免用户误触未完成的 Agent 模式，`frontend/src/pages/AI.tsx` 中「Agent 模式」开关被 `{false && (...)}` 条件隐藏，代码保留以便后续恢复

### 10.2 日志中心：修复场景化 Tab 日志混杂问题
- **现象**：「系统组件 (CoreDNS)」Tab 中出现了 `kube-controller-manager` 等其他组件日志；Ingress/LB 也存在类似问题
- **根因**：`internal/pkg/log/es_adapter.go` 使用 `should` + `minimum_should_match: 1`（8 选 1），只要 namespace 匹配 `kube-system` 就会被归入 CoreDNS
- **修复**：将 `ingress`、`coredns`、`lb` 的查询逻辑改为嵌套 `must`：
  - `namespace 必须匹配` **AND** `(pod/container 名称必须匹配 或 存在特定字段)`
  - 去掉了 `log.keyword` / `message.keyword` 的泛化匹配，防止误归类
- **关键文件**：`internal/pkg/log/es_adapter.go`

### 10.3 系统设置：支持自定义 Logo 和平台信息（热加载）
- **新增数据库表**：`system_settings`（key-value 结构）
- **新增后端服务**：
  - `GET /api/v1/settings/site` — 读取站点配置
  - `PUT /api/v1/settings/site` — 更新站点配置
  - `POST /api/v1/settings/site/logo` — 上传 Logo（支持 png/jpg/jpeg/gif/svg/webp）
- **新增前端 Context**：`frontend/src/context/SiteConfigContext.tsx`
  - 应用启动时自动拉取配置
  - 保存后调用 `refresh()`，实现**热加载**
  - 自动同步更新 `document.title`
- **接入页面**：
  - `MainLayout.tsx`：侧边栏 Logo、平台名称、副标题动态读取
  - `Login.tsx`：登录页 Logo、平台名称、副标题动态读取
  - `Settings.tsx`：「通用」Tab 替换为实际表单（Logo 上传/预览/移除、平台名称、平台介绍）
- **静态文件**：后端通过 `engine.Static("/uploads", "./uploads")` 暴露上传目录；`vite.config.ts` 增加 `/uploads` 代理规则
- **关键文件**：`internal/model/models.go`、`internal/service/setting_service.go`、`internal/api/handlers/setting.go`、`frontend/src/context/SiteConfigContext.tsx`、`frontend/src/pages/Settings.tsx`

### 10.4 集群管理：全局资源搜索增强
- **新增标签展示**：
  - 后端 `SearchResult` 新增 `labels` 字段
  - `k8s_manager.go` 中所有资源类型（Pod、Deployment、Service、Node、Event 等）均返回 `labels`
- **下拉列表表头**：Autocomplete 下拉增加 sticky 表头（名称 / 资源 / NS / 集群 / 标签）
- **下拉列表标签渲染**：每条结果右侧显示前 2 个标签 Chip，超出显示 `+N`，悬停可查看完整 `key:value`
- **新增服务端过滤参数**：`kind`、`namespace`、`cluster_id`、`label_selector`
- **新增前端筛选控件**：
  - **资源类型**：下拉选择全部 K8s 资源类型
  - **集群**：下拉选择已接入集群
  - **Namespace**：从当前搜索结果动态提取唯一 NS 列表
  - **标签筛选**：文本框，支持 `app=nginx` 或标签关键字模糊匹配
- **关键文件**：`internal/service/k8s_manager.go`、`internal/service/k8s_resource_service.go`、`internal/api/handlers/k8s.go`、`frontend/src/pages/Clusters.tsx`、`frontend/src/lib/k8s-api.ts`

### 10.5 离线一键部署脚本

为支持用户内网私有化部署，已完成完整的一键离线安装方案：

- **prepare-deps.sh**：联网机器预打包 PostgreSQL/Redis/Node.js 离线依赖
- **install.sh**：离线服务器一键安装，支持 `full`（PostgreSQL+Redis）和 `lite`（SQLite）两种模式
- **uninstall.sh**：完整卸载，可选删除数据库
- **systemd 服务**：`cloudops-backend` / `cloudops-agent` / `cloudops-frontend`，开机自启、故障重启
- **安全设计**：专用 `cloudops` 用户运行、自动随机生成 JWT/加密密钥

**关键决策**：
- Node.js 使用官方预编译二进制（跨发行版兼容，不依赖 apt/yum）
- 前端用 `vite preview` 托管（零 Nginx 依赖）
- lite 模式零外部数据库依赖，适合 POC/测试

**文件位置**：
- 安装文档：`docs/install-offline.md`
- 离线说明：`README-OFFLINE.md`
- 脚本：`scripts/install.sh`、`scripts/prepare-deps.sh`、`scripts/uninstall.sh`
- systemd：`systemd/cloudops-*.service`
- 配置模板：`config/config.yaml.template`

---

### 10.6 日志中心：重构场景化过滤策略（基于 Pod 前缀）
- **现象**：Ingress Tab 中出现 CoreDNS 日志（CoreDNS 解析 `ingress-nginx-controller-admission.ingress-nginx.svc.cluster.local` 时文本匹配到 `ingress`/`nginx`）
- **根因**：原 `should` + 内容关键词策略太宽泛，不同组件日志文本存在交集
- **修复**：将 Ingress/CoreDNS/LB 的识别逻辑改为 **Pod/Container 名称前缀为主 + 精确内容特征为辅**：
  - **Ingress**：`prefix` on `pod_name`/`container_name` for `ingress-nginx`/`nginx-ingress`/`traefik` + `match_phrase` on `HTTP/1.1`/`HTTP/2.0` + JSON `method` 字段
  - **CoreDNS**：`prefix` on `coredns` + `match_phrase` on `"A IN "`/`"AAAA IN "`/`NOERROR`/`Corefile`
  - **LB**：`prefix` on `kube-proxy`/`metallb` + `match_phrase` on `iptables`/`ipvs`/`proxier`/`syncProxyRules`
- **ES 安全**：全程使用 `prefix`/`match_phrase`/`match`，彻底避免 `regexp`/`exists` 等可能触发 `query_shard_exception` 的查询类型
- **关键文件**：`internal/pkg/log/es_adapter.go`

### 10.7 安全加固：Web Terminal
- **移除 `/proc` 挂载**：消除 `/proc/1/root` chroot escape 风险
- **移除 `mknod` 能力**：禁止在沙箱内创建设备节点
- **Linux Namespace 隔离**：`CLONE_NEWNS|CLONE_NEWPID|CLONE_NEWUSER|CLONE_NEWIPC`
- **系统目录只读**：`MS_RDONLY|MS_NOSUID|MS_NODEV`
- **唯一 Session ID**：`crypto/rand` + timestamp，隔离不同用户会话
- **关键文件**：`internal/api/handlers/terminal.go`

### 10.8 安全加固：网络诊断（Network Trace）
- **命令白名单**：只允许 `tcpdump`、`ping`、`traceroute`、`curl`、`nc`、`ss`、`ip`
- **Shell 元字符黑名单**：禁止 `;` `&&` `||` `|` `` ` `` `$()` `${` `>` `<` `&`
- **路径校验**：拒绝非标准路径命令（如 `/tmp/evil`）
- **关键文件**：`internal/service/network_trace_service.go`

### 10.9 K8s 集群修复
- **现象**：kubelet 反复 CrashLoopBackOff，节点 NotReady
- **根因**：swap 未关闭导致 kubelet 启动失败
- **修复**：在 master (10.0.0.11) 和 node (10.0.0.12) 上执行 `swapoff -a` + 注释 `/etc/fstab` swap 条目，集群恢复 Ready

---

---

## 十一、2026-04-18 开发记录

### 11.1 OpenClaw AI 对接报错修复
- **现象**：系统设置 → AI 平台中"默认 OpenClaw"状态为"离线"，连通性测试报错 `invalid character '<' looking for beginning of value`
- **根因 1**：OpenClaw Gateway 默认不启用 OpenAI 兼容 REST API（`POST /v1/chat/completions`、`GET /v1/models`），请求返回 HTML 页面导致 JSON 解析失败
- **根因 2**：CloudOps `data/ai_platform_config.json` 中存储的 token 与 OpenClaw 实际 token 不一致
- **修复**：
  - 修改 `/root/.openclaw/openclaw.json`，在 `gateway` 中增加 `http.endpoints.chatCompletions.enabled: true`
  - 将 CloudOps AI 配置中的 token 更新为 OpenClaw 实际 token
  - 重启 OpenClaw Gateway 和 CloudOps 后端
- **验证**：`curl /v1/models` 和 `curl /v1/chat/completions` 均返回正确 JSON；CloudOps `/api/v1/settings/ai/test` 返回"AI 平台连接成功"

### 11.2 废弃旧 AI 配置系统（JSON 文件模式）
- **背景**：CloudOps 同时存在两套 AI 配置机制：
  - **旧系统**：`AIConfigService` + `data/ai_platform_config.json`（文件存储，启动时加载一次）
  - **新系统**：`AIPlatformService` + `ai_platforms` 表（数据库存储，实时读取，支持多平台）
- **问题**：双轨并存导致配置不同步，旧系统已成为 stale 数据且存在 0644 权限泄露风险
- **清理内容**：
  - 删除 `internal/service/ai_config_service.go`
  - 删除 `internal/api/handlers/ai_config.go`
  - 删除 `data/ai_platform_config.json`
  - 删除旧路由 `/api/v1/settings/ai/*`（`GET/PUT/POST`）
  - 删除 `AIService` 中对 `AIConfigService` 的依赖
  - 删除 `AIPlatformService` 中的 `MigrateFromLegacyConfig()` 和 `fixDoubleEncryptedTokens()` 方法
- **修改文件**：
  - `cmd/server/main.go`：移除 `aiConfigService` 初始化与注入
  - `internal/service/ai_service.go`：移除 `configSvc` 字段和参数
  - `internal/api/routes.go`：移除 `aiConfigHandler` 及相关路由
  - `internal/service/ai_platform_service.go`：清理 imports，移除旧迁移/修复逻辑
- **结果**：所有 AI 配置统一走数据库 `ai_platforms` 表，前端修改 token 即时生效，无需重启后端

### 11.3 第三方系统 30s 周期性健康检查
- **背景**：数据源、AI 平台、日志后端等第三方对接系统仅在用户点击"测试连接"时才更新状态，无法反映真实运行中的故障（如截图中 Prometheus 已 `no route to host` 但状态仍显示"有效"）
- **实现**：为所有第三方对接系统统一添加 `StartHealthMonitor()` 方法，后端启动后每 **30 秒**自动巡检一次
  - **数据源**（`DatasourceService`）：遍历 `data_sources`，调用 `TestConnection` 更新 `is_active`
  - **AI 平台**（`AIPlatformService`）：遍历 `ai_platforms`，调用 `TestConnection` 更新 `status` + `last_checked_at`
  - **日志后端**（`LogService`）：遍历 `cluster_log_backends`，调用 `TestConnection` 更新 `status` + `last_checked_at`（新增字段）
  - **K8s 集群**（`ClusterService`）：遍历 `clusters`，通过 `GetK8sClient` + `ServerVersion()` 探测，更新 `cluster_metadata.health_status`
- **数据库变更**：`cluster_log_backends` 新增 `status`（`size:32;default:'unknown'`）和 `last_checked_at` 字段，Gorm AutoMigrate 自动生效
- **验证**：
  - `data_sources.KS-VM.is_active` 由 `true` 自动变为 `false`
  - `ai_platforms.default.status` 保持 `online`
  - `cluster_log_backends` 状态正常更新

### 11.4 全站原生 `alert()` 弹窗替换为 MUI Snackbar
- **背景**：`Settings.tsx` 数据源测试连接仍使用浏览器原生 `alert()`，样式与全站 iOS 扁平化设计严重不符
- **修复**：
  - `Settings.tsx`：数据源 `handleTest` 由 `alert()` 改为 `showSnack()`（Snackbar + Alert），与日志后端测试保持一致
  - `AI.tsx`：新增 Snackbar state，替换"重命名失败"和"删除失败"的 `alert()`
  - `Dashboard.tsx`：新增 Snackbar state，替换"创建/删除/复制失败"的 `alert()`
  - `ClusterDetail.tsx`：利用已有 Snackbar，替换"缓存刷新任务已启动"的 `alert()`
  - `NetworkTrace.tsx`：利用已有 Snackbar（扩展 `severity` 支持 `info`），替换"导出功能开发中"的 `alert()`
- **关键文件**：`frontend/src/pages/Settings.tsx`、`AI.tsx`、`Dashboard.tsx`、`ClusterDetail.tsx`、`NetworkTrace.tsx`

### 11.5 数据源状态文案修正
- **问题**：`is_active = false` 时前端显示"禁用"，容易误导为用户手动禁用，实际是连接失败
- **修复**：`Settings.tsx` 数据源状态 Chip 文案由 `"禁用"` 改为 `"无效"`，颜色保持 `default`（灰色）
- **关键文件**：`frontend/src/pages/Settings.tsx`

### 11.6 日志后端列表增加状态栏
- **问题**：日志后端（ES/OS/Loki）表格缺少"状态"列，用户无法直观判断后端连通性
- **修复**：
  - `frontend/src/lib/log-backend-api.ts`：`LogBackend` 接口新增 `status` 和 `last_checked_at` 字段
  - `frontend/src/pages/Settings.tsx`：日志后端表格新增"状态"列，用 Chip 展示：
    - `online` → **有效**（绿色 `success`）
    - `offline` → **无效**（红色 `error`）
    - 其他 → **未知**（灰色 `default`）
  - 同步更新 loading/空状态占位符的 `colSpan`（5 → 6）
- **关键文件**：`frontend/src/lib/log-backend-api.ts`、`frontend/src/pages/Settings.tsx`

---

*最后更新：2026-04-18*

## 十二、安装脚本更新（2026-04-18）

### 12.1 背景
- 今天的代码变更移除了旧版 `AIConfigService`，AI 平台配置完全走数据库
- `Agent Runtime` 改为由后端进程（`main.go`）内置启动，不再需要单独的 systemd 服务
- `ai_service` 从可选功能升级为核心功能

### 12.2 主要变更

#### `scripts/install.sh`
1. **启用 AI 服务**：`config.yaml` 生成时 `ai_service.enabled` 由 `false` 改为 `true`
2. **移除旧版 AI 配置**：删除 `ai.openclaw` 配置段（已废弃）
3. **移除 `cloudops-agent.service`**：Agent Runtime 由后端内置启动，无需独立 systemd 服务
   - 删除 `cloudops-agent.service` 的创建逻辑
   - `systemctl enable/start` 中移除 `cloudops-agent`
   - 安装完成报告中移除 agent 服务相关命令
4. **保留 `--agent-port` 参数**：供后续版本通过配置文件控制 Agent Runtime 端口（当前后端仍硬编码 19000）

#### `scripts/uninstall.sh`
1. **同步移除 agent 服务清理**：`systemctl stop/disable` 和 `rm -f` 中移除 `cloudops-agent`

#### `cmd/server/main.go`
1. **修复 Agent Runtime 硬编码路径**：`agentRuntime.Dir` 从 `/data/projects/cloudops-v2`（开发环境绝对路径）改为 `filepath.Dir(os.Executable())`（自动跟随二进制所在目录）
   - 新增 `path/filepath` import
   - 生产环境（`/opt/cloudops`）下不再因路径错误导致 Agent Runtime 启动失败

### 12.3 验证
```bash
# 检查脚本语法
bash -n scripts/install.sh    # OK
bash -n scripts/uninstall.sh  # OK

# 编译测试
go build -o /tmp/cloudops-backend-test ./cmd/server/main.go  # OK
```

---

*最后更新：2026-04-18*


---

## 十三、环境配置规范与数据库声明（2026-04-19）

### 13.1 数据库声明：本项目仅使用 PostgreSQL

> **开发规范：本项目所有数据持久化均走 PostgreSQL，禁止在任何开发对话或文档中提及/推荐使用 SQLite 作为生产或开发数据库。**

- 后端启动时如果 `config.yaml` 中 `database.postgres.host` 为模板占位符（`{{DB_HOST}}`），会导致启动失败
- 当前启动方式：直接修改 `config/config.yaml` 填入真实值后启动（见下方环境信息）
- `cloudops.db` SQLite 文件为历史遗留，与本项目当前运行无关

### 13.2 环境信息（必须记录）

| 组件 | 地址 | 账号/密钥 |
|------|------|----------|
| **PostgreSQL** | `127.0.0.1:5432/cloudops` | 用户名 `cloudops` / 密码 `cloudops123` |
| **Redis** | `127.0.0.1:6379` | 无密码 |
| **后端** | `http://0.0.0.0:9000` | — |
| **前端** | `http://0.0.0.0:18000` | — |
| **JWT Secret** | — | `dev-jwt-secret-key-2024cloudops` |
| **AES Encryption Key** | — | `0123456789abcdef0123456789abcdef` |

### 13.3 已知问题记录

1. **AI 平台配置解密失败**
   - 现象：Settings → AI 平台 中点击"测试连接"报错 `cipher: message authentication failed`
   - 根因：数据库中 `ai_platforms.ConfigJSON` 是用**旧加密密钥**加密的，当前启动使用的 `ENCRYPTION_KEY` 已变更
   - 解决：需在每个 AI 平台编辑页面重新保存配置，让后端用当前密钥重新加密
   - 代码隐患：`TestConnection` 解密失败时直接 `return err`，未更新 `status` 字段；`StartHealthMonitor` 用 `_` 忽略错误，导致状态永远停留在旧值

2. **日志后端数据丢失**
   - 现象：Settings → 日志后端 列表为空
   - 根因：`cluster_log_backends` 表数据在 2026-04-15 至 2026-04-19 之间被清空（具体原因未查明，无备份）
   - 解决：需手动重新添加日志后端配置

### 13.4 安全提醒

`config/config.yaml` 当前已填入真实数据库密码和加密密钥，**请勿将该文件提交到 Git 仓库**。后续建议改为通过环境变量注入敏感配置。

---

*最后更新：2026-04-19*


---

## 十四、去掉 AES-256 字段级加密（2026-04-19）

### 14.1 背景

私有化部署场景下，加密密钥与数据库放在同一台服务器，安全收益有限，但运维复杂度极高。`start-backend.sh` 每次启动随机生成密钥，导致历史加密数据频繁"丢失"，严重影响使用。

### 14.2 决策

**彻底去掉应用层字段级加密**，敏感数据改为明文存储在 PostgreSQL 中，依赖数据库访问控制和服务器权限保护。

### 14.3 修改范围

| 文件 | 修改内容 |
|------|----------|
| `internal/service/ai_platform_service.go` | `ConfigJSON` 不再加密，直接存 JSON 字符串；`NewAIPlatformService` 移除 `secretKey` 参数 |
| `internal/service/cluster_service.go` | `EncryptedData` 不再加密，直接存明文 kubeconfig/token；`NewClusterService` 移除 `encryptor` 参数 |
| `internal/service/k8s_manager.go` | 移除 `encryptor`，`buildConfig` / `GetClusterKubeconfigContent` 直接使用明文 |
| `internal/api/handlers/ai_platform.go` | `GetPlatform` 直接解析 `p.ConfigJSON` 为 JSON，不再调用 `DecryptConfig` |
| `internal/service/agent_runtime_proxy.go` | `resolveModelConfig` 直接解析 `platform.ConfigJSON` |
| `cmd/server/main.go` | 移除 `encryptor` 创建与注入 |
| `internal/model/models.go` | `ClusterSecret` 注释更新为"明文存储集群凭证"，移除 `EncryptionKeyID` 字段说明 |

### 14.4 影响

- **新保存的 AI 平台 / 集群凭证**：明文存储，重启后不再丢失
- **旧数据（已加密的记录）**：仍存在于数据库中，但无法被正常解析，需**手动删除后重新配置**
- `config.yaml` 中的 `security.encryption` 配置段仍保留（不影响运行），但不再被业务代码使用

### 14.5 待清理

- `internal/pkg/crypto/aes.go` 可保留作为工具库，但当前已无业务引用
- `cluster_log_backends` 表数据仍为空，需重新添加日志后端配置

---

*最后更新：2026-04-19*

---

## 十五、删除 SQLite 支持（2026-04-19）

### 15.1 背景

项目已统一使用 PostgreSQL，SQLite 代码成为历史遗留，且导致开源后用户困惑（"是否需要 SQLite？"）。

### 15.2 决策

彻底删除 SQLite 支持，强制要求 PostgreSQL。

### 15.3 修改范围

| 文件 | 修改内容 |
|------|----------|
| `internal/pkg/database/database.go` | 删除 `sqlite` import；删除 SQLite 分支；`postgres.host` 为空时直接报错 |
| `go.mod` / `go.sum` | 移除 `gorm.io/driver/sqlite` 和 `github.com/mattn/go-sqlite3` 依赖，执行 `go mod tidy` |
| `scripts/install.sh` | 删除 `--mode` 参数和 lite 模式分支；只保留 PostgreSQL + Redis 部署逻辑 |
| `README.md` / `README.en.md` / `README.ja.md` / `README.ko.md` | 移除 "PostgreSQL / SQLite" 描述，统一为 PostgreSQL |
| `docs/DEPLOYMENT.md` | 删除 SQLite 配置章节、轻量模式说明、SQLite FAQ |
| `docs/offline-deployment.md` | 删除轻量模式章节、最小化快速部署章节 |
| `docs/install-offline.md` | 删除 lite 模式表格行和说明 |
| `docs/architecture.md` | 删除 SQLite 技术栈描述 |
| `docs/quickstart.md` | 删除 SQLite 降级提示 |
| `docs/installation.md` | 删除 "开发可用 SQLite" 说明 |
| `README-OFFLINE.md` | 移除 SQLite 描述 |
| `offline-package/README-DEPLOY.md` | 移除 SQLite 轻量模式说明 |

### 15.4 影响

- 后端启动时如果 `config.yaml` 中 `postgres.host` 为空，会直接报错退出，不再自动回退到 SQLite
- 安装脚本不再支持 `--mode lite`，只有 `full`（PostgreSQL + Redis）一种模式
- 仓库体积减小（移除了 58MB 的 sqlite3 二进制依赖）

---

*最后更新：2026-04-19*

---

## 开发规范（必须遵守）

> **每次完成开发、优化或修复 BUG 后，必须执行以下两步：**
>
> 1. **将本次开发记录追加写入 `CONTEXT.md`**（按日期编号，记录修改范围、影响、关键文件）
> 2. **提交代码并推送至 GitHub**，确保远程仓库与本地同步
>
> ⚠️ 禁止只改代码不写记录，或写了记录不推送。上下文中断会导致后续开发效率急剧下降。

---

*最后更新：2026-04-19*

---

## 十六、用户管理模块设计方案（2026-04-19）

### 16.1 背景

平台当前对接 20+ 集群、10000+ Pod，需要支持多用户使用。现有用户管理仅有基础模型（User/Role/Permission/Tenant），无法满足多租户、细粒度授权、审计追溯等需求。

### 16.2 参考开源项目

- **Rancher**：三层 RBAC（Global/Cluster/Project）、RoleTemplate 继承、外部认证
- **KubeSphere**：Workspace 企业空间、四层权限、邀请制成员管理
- **Kubernetes RBAC**：Resource + Verb 矩阵、Role + RoleBinding 复用

### 16.3 方案核心

采用 **"三层 + 一扩展"** 权限模型：
- **Platform Layer**：全局管理员、平台设置、租户管理
- **Cluster Layer**：集群管理员、集群观察者、集群运维
- **Resource Layer**：命名空间管理员、只读用户、自定义角色
- **Extension Layer**（后续）：部门/用户组、审批流、审计日志

### 16.4 关键设计

| 设计项 | 内容 |
|--------|------|
| 角色模板（RoleTemplate） | 支持自定义 + 继承，内置 8 个系统角色 |
| 权限矩阵 | Resource（cluster/pod/deployment...）× Verb（read/write/delete/execute/admin） |
| 集群授权（ClusterGrant） | 用户 ↔ 集群 ↔ 角色模板，支持 NamespaceScope 细粒度控制 |
| 审计日志（AuditLog） | 全量操作追踪 + Before/After JSON diff + 按天分片 |
| 密码策略 | 最小长度/复杂度/有效期/连续失败锁定/历史密码检查 |
| K8s RBAC 同步 | Phase 3 评估，前期仅在 CloudOps 层控制 |

### 16.5 实施阶段

| 阶段 | 周期 | 内容 |
|------|------|------|
| Phase 1 | 2 周 | 用户 CRUD、角色管理、密码策略、前端按钮级权限 |
| Phase 2 | 2 周 | 集群授权、权限校验中间件、审计日志 |
| Phase 3 | 2 周 | LDAP/OIDC、用户组、K8s RBAC 同步（可选） |

### 16.6 文档

- 完整方案：`docs/user-management-proposal.md`（632 行）
- 包含：数据模型、API 设计、前端交互、数据库变更脚本、风险应对

---

*最后更新：2026-04-19*

---

## 十七、用户管理模块设计方案 V2（2026-04-19）

### 17.1 背景调整

- 20+ 集群已通过 **KubeSphere** 提供给不同用户使用
- 当前 CloudOps 只对接了**只读 kubeconfig**
- 后续部分集群需要升级为 **admin 读写 kubeconfig**
- 核心诉求：**不改 KubeSphere 现有体系，CloudOps 独立建权，支持渐进扩展**

### 17.2 核心设计：多凭证分级路由

**每个集群支持配置多个凭证（viewer / operator / admin）**，后端根据用户角色自动选择对应凭证：

```
用户A(viewer)  → 用 viewer-kubeconfig  → get/list/watch
用户B(operator)→ 用 operator-kubeconfig → 写 Deployment/Pod
用户C(admin)   → 用 admin-kubeconfig   → 全部操作（Terminal/抓包）
```

**降级策略**：如果集群没有对应级别凭证，自动降级到 viewer，前端明确提示。

### 17.3 与 V1 的主要差异

| 对比项 | V1 方案 | V2 方案 |
|--------|---------|---------|
| 集群凭证 | 每个集群一个 | 每个集群多个（分级） |
| 只读→读写扩展 | 需改代码 | **只需新增凭证** |
| K8s RBAC 同步 | Phase 3 评估 | **不做**，用多凭证替代 |
| 与 KubeSphere 关系 | 未提及 | **明确共存策略** |
| 降级策略 | 无 | 自动降级 + 前端提示 |

### 17.4 关键决策

- **K8s RBAC 同步不做**：改动太大，多凭证方案已能满足需求
- **与 KubeSphere 不打通**：保持 CloudOps 独立性，未来通过 LDAP 统一认证源
- **operator 级别权限范围**：可读全部 + 写工作负载（Pod/Deployment/Service/ConfigMap），不可操作 Namespace/Node/RBAC

### 17.5 文档

- V1 方案：`docs/user-management-proposal.md`（通用场景）
- V2 方案：`docs/user-management-proposal-v2.md`（KubeSphere 共存 + 多凭证分级场景）

---

*最后更新：2026-04-19*

---

## 十八、多用户管理实战方案（2026-04-19）

### 18.1 场景

- 3 个团队，50+ 用户，20+ 集群
- 平台部 5 人、运维部 10 人、业务组 35 人
- 生产集群 8 个（目前只读）、预发 4 个、测试 8 个

### 18.2 三种管理方案

| 方案 | 适用人数 | 隔离粒度 | 实施阶段 |
|------|---------|---------|---------|
| **逐个授权** | < 50 人 | 集群级 | Phase 1 |
| **用户组批量** | 50+ 人 | 集群级 | Phase 2（推荐） |
| **Namespace 隔离** | 任意 | 命名空间级 | Phase 3（按需） |

### 18.3 用户组设计（核心）

```
平台部-admin      → 5 人  → 全部 20 集群 → admin
运维部-operator   → 10 人 → 全部 20 集群 → operator
业务组-viewer     → 35 人 → 仅测试集群   → viewer
```

**效果**：
- 新员工入职 → 加入用户组 → 30 秒完成授权
- 凭证升级 → 无需重新授权用户 → 实时生效
- 调岗 → 从 A 组移除，加入 B 组 → 权限自动切换

### 18.4 关键规则

- **多组冲突**：取最高权限（组A viewer + 组B operator = operator）
- **个人优先**：个人授权覆盖用户组授权
- **降级提示**：前端明确显示凭证降级原因

### 18.5 文档

- `docs/user-management-multi-user-scenarios.md`（完整示例 + 界面示意 + FAQ）

---

*最后更新：2026-04-19*

---

## 2026-04-19 用户管理 + 租户隔离 + 功能模块权限 Phase 1

### 完成内容

1. **数据模型扩展**
   - `Role` 表扩展：新增 `scope` (platform/cluster/namespace)、`level` (100-300)、`permissions_data` (JSONB 扁平化权限列表)
   - 新增 `NamespaceGrant` 表：用户-集群-命名空间-角色 四维授权
   - 新增 `UserModuleOverride` 表：用户级功能模块权限覆盖

2. **预置角色体系（6种）**
   - `platform-admin` (level 300)：全部权限
   - `cluster-admin` (level 200)：除系统管理外的全部
   - `cluster-viewer` (level 110)：只读
   - `namespace-admin` (level 150)：NS 级管理
   - `namespace-operator` (level 120)：NS 级运维
   - `namespace-viewer` (level 100)：NS 级只读

3. **RBAC Service**
   - `GetUserEffectiveRole`：获取用户最高级别角色
   - `GetEffectiveRole`：获取用户在集群+NS 的有效角色
   - `GetAllowedNamespaces`：获取用户有权限的 NS 列表
   - `GetAllPermissions` / `GetModulePermissions` / `GetAIPermissions`：权限查询
   - `GrantNamespace` / `RevokeNamespace`：NS 授权管理

4. **中间件**
   - `TenantScopeMiddleware`：自动为请求添加租户数据范围
   - `ModulePermissionMiddleware`：功能模块权限校验（菜单级）
   - `NSPermissionMiddleware`：K8s 命名空间权限校验
   - `AIPermissionMiddleware`：AI 功能权限校验

5. **后端 API 改造**
   - 所有路由添加 `TenantScopeMiddleware`
   - 各模块路由添加 `ModulePermissionMiddleware`
   - 新增用户管理 API：`/users` CRUD、`/namespace-grants`、`/users/me/permissions`、`/users/me/menus`、`/users/me/namespaces`
   - Inspection handler 添加租户过滤

6. **前端改造**
   - `usePermission` Hook：获取动态菜单和权限
   - `MainLayout.tsx`：从后端 `/users/me/menus` 动态渲染菜单
   - `App.tsx`：`ModuleRoute` 组件，无权限显示 403 页面

7. **权限标识体系**
   - 模块权限：`module:dashboard`, `module:cluster:manage`, `module:inspection`, ...
   - AI 权限：`ai:chat`, `ai:agent_chat`, `ai:platform:manage`, ...
   - K8s 权限：`pod:read`, `pod:write`, `deployment:read`, ...

### 编译状态
- 后端：`go build` ✅
- 前端：`npm run build` ✅

### 文档
- `docs/user-management-namespace-rbac-v3.md` - NS 级 RBAC 方案
- `docs/terminal-permission-analysis.md` - 终端权限分析
- `docs/ai-permission-design.md` - AI 权限方案
- `docs/module-permission-tenant-isolation.md` - 功能模块权限 + 租户隔离方案


## 2026-04-19 续：Phase 1 功能补全

### 完成内容

1. **终端权限改造**
   - `terminal.go` 接入 RBAC Service，替换旧 `ClusterPermission` 检查
   - 支持 `namespace` 查询参数，按 NS 级权限校验 `terminal:use`
   - 终端启动时自动设置默认 kubectl namespace

2. **前端用户管理页面（完整版）**
   - 用户列表表格：ID、用户名、邮箱、角色标签、状态、操作
   - 添加/编辑用户弹窗：
     - Tab 1「基本信息」：用户名、邮箱、密码、角色多选、启用/禁用
     - Tab 2「功能模块权限」：按分组展示 11 个模块，可勾选覆盖角色默认权限
     - Tab 3「命名空间授权」：选择集群 + NS + 角色 → 授权；表格展示当前授权，可撤销
   - 删除用户确认弹窗
   - Snackbar 提示

3. **其他**
   - DataSource handler 已有租户过滤
   - LogBackend List 已有 tenant_id 过滤
   - NetworkTrace 配置为全局配置，不涉及租户隔离

### 编译状态
- 后端 `go build` ✅
- 前端 `npm run build` ✅


## 2026-04-19 续：NS 授权下拉框优化

### 完成内容

1. **NS 授权 Tab 下拉框改造** (`frontend/src/pages/Users.tsx`)
   - **集群选择**：保持 Select 下拉，已正确加载 `/clusters` 列表
   - **命名空间**：从 TextField 改为 `Autocomplete` 下拉选择，支持模糊搜索
     - 选择集群后自动调用 `GET /clusters/:id/namespaces` 获取该集群 NS 列表
     - 未选集群时禁用，提示"请先选择集群"
     - 加载中显示 CircularProgress
   - **角色选择**：保持 Select 下拉，过滤 `scope === 'namespace'` 的角色

### 编译状态
- 后端 `go build` ✅
- 前端 `npm run build` ✅


## 2026-04-19 续：Phase 1 收尾修复

### 完成内容

1. **用户列表分页 + 搜索**
   - 后端 `ListUsers` 添加 `page`, `page_size`, `keyword` 查询参数
   - 返回 `{ list, total, page, page_size }` 分页结构
   - 前端 `Users.tsx` 添加 `TablePagination` 分页组件
   - 前端添加搜索框（按用户名/邮箱 ILIKE 模糊搜索）

2. **独立重置密码功能**
   - 后端新增 `PUT /users/:id/password` — `ResetPassword` handler
   - 前端点击 🔒 锁图标弹出独立弹窗（新密码 + 确认密码）
   - 校验：密码 ≥6 位，两次输入一致

3. **用户状态快速切换**
   - 后端新增 `PATCH /users/:id/status` — `ToggleUserStatus` handler
   - 前端列表页每行添加 `Switch` 开关，点击直接切换启用/禁用
   - 不能禁用自己（前后端双重校验）

4. **模块权限覆盖 UX 改进**
   - Tab 2「功能模块权限」添加「恢复角色默认」按钮
   - 一键清空 `enabled_modules` / `disabled_modules`，回到角色默认权限
   - 无覆盖时按钮禁用

5. **修复日志页面 Namespace 下拉为空**
   - 根因：`Logs.tsx` 中 `backends.find((b) => b.id === selectedBackends[0])` 使用严格相等 `===`
   - MUI Select multiple 模式下 `e.target.value` 实际返回 `string[]`，导致比较失败
   - 修复：改为松散比较 `==`

### 编译状态
- 后端 `go build` ✅
- 前端 `npm run build` ✅


## 2026-04-19 续：禁用用户后 token 仍可用 bugfix

### 问题
- 禁用用户后，已登录用户的 token 仍然有效，可以继续访问系统

### 根因
- `UserExistMiddleware` 只检查了用户是否存在于数据库，未检查 `is_active` 状态

### 修复
- `internal/api/middleware/user_exist.go`：查询用户时同时检查 `is_active`
- 被禁用用户 → 返回 403 `USER_DISABLED`「用户已被禁用，请联系管理员」
- 用户不存在 → 返回 401 `USER_NOT_FOUND`

### 编译状态
- 后端 `go build` ✅


## 2026-04-19 续：创建用户时支持NS授权

### 完成内容
- `frontend/src/pages/Users.tsx`
  - 添加用户弹窗也显示「命名空间授权」Tab
  - 创建用户时，如果填写了 NS 授权配置，创建用户成功后自动调用 `/namespace-grants` 授权
  - 编辑用户的 NS 授权行为保持不变

### 编译状态
- 后端 `go build` ✅
- 前端 `npm run build` ✅


## 2026-04-19 续：Phase 2 Batch 1 — 核心数据权限过滤

### 完成内容

1. **RBAC Service 新增 `GetDataScope`**
   - 返回用户的权限范围（platform/cluster/namespace）
   - namespace 级返回授权的 cluster_id 列表和 namespace 列表

2. **ClusterService.ListClusters + handler**
   - namespace 级用户：只返回有 NS 授权记录的集群
   - platform/cluster 级：保持原有 tenant 过滤不变

3. **K8sHandler.GetNamespaces**
   - namespace 级用户：过滤返回的 NS 列表，只保留授权 NS
   - platform/cluster 级：返回全部 NS

4. **LogService.ListLogBackends + handler**
   - namespace 级用户：只返回授权集群的日志后端

5. **LogService.QueryLogsMultiBackend + handler**
   - namespace 级用户：过滤 backend_ids，只保留授权集群的 backend
   - AgentService 传入 0（AI 工具链不受用户 NS 权限限制）

6. **K8sHandler.ListResources**
   - namespace 级用户查询 namespaced 资源：校验 namespace 参数是否在授权列表
   - 未指定 namespace 时默认用第一个授权 NS
   - 查询 namespaces 资源时过滤结果

### 编译状态
- 后端 `go build` ✅
- 后端已重启 ✅


## 2026-04-19 续：namespace 级用户 NS 下拉框优化

### 问题
- namespace 级用户在工作负载页面看到"全部命名空间"选项，选择后查询返回 403

### 修复
- **前端 `ClusterDetail.tsx`**：
  - 当 `namespaces` 数组只有一个元素时，自动选中该 NS，不显示"全部命名空间"选项
  - 当 `namespaces.length > 1` 时才显示"全部命名空间"
- **后端 `k8s.go` `ListResources`**：
  - `namespace="all"` 也当成未指定 namespace 处理，默认用第一个授权 NS

### 编译状态
- 后端 `go build` ✅
- 前端 `npm run build` ✅
- 后端已重启 ✅

