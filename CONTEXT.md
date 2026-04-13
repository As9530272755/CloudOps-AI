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

*最后更新：2026-04-13*
