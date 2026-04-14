# CloudOps AI 集成项目上下文

> 本文件用于在全新 AI 会话中快速恢复项目上下文。下次启动时，将本文件内容粘贴给 AI 助手即可。

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

---

*最后更新：2026-04-15*
