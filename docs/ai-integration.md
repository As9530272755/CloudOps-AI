# AI 平台对接指南

本文档介绍如何在 CloudOps Platform 中配置和对接 AI 平台（OpenClaw / Ollama），以及异步任务轮询架构的说明。

---

## 一、支持的 AI 平台

| 平台 | 接入方式 | 特点 | 适用场景 |
|------|----------|------|----------|
| **OpenClaw** | OpenAI 兼容 HTTP API | 支持多模型 fallback、工具调用、图片识别、session 保持 | 生产环境，需要多模型调度 |
| **Ollama** | Ollama `/api/chat` API | 本地部署、零网络依赖、成本最低 | 私有化部署，内网环境 |

---

## 二、OpenClaw 配置

### 2.1 基础配置

进入「系统设置」→ AI 平台配置，选择 **OpenClaw**：

| 配置项 | 示例值 | 说明 |
|--------|--------|------|
| URL | `http://127.0.0.1:18789` | OpenClaw 服务地址 |
| Token | `sk-xxxxxx` | OpenClaw API Key |
| Model | 隐藏（强制为 `openclaw`） | OpenClaw HTTP API 只接受 `openclaw` 或 `openclaw/<agentId>` |

### 2.2 Session 保持机制

OpenClaw 的 `/v1/chat/completions` 通过请求体中的 `user` 字段绑定会话。

CloudOps 的实现：
- 前端生成 `session_id` 并存入 `localStorage`（`cloudops-ai-session-id`）
- 后端在请求 OpenClaw 时，将 `session_id` 写入 `user` 和 `session_id` 字段
- OpenClaw 返回的 `session_id` 会被自动捕获并同步更新

### 2.3 多模态图片输入

从 v2.0 开始，AI 助手支持用户上传/粘贴图片，由 OpenClaw 进行识别分析。

**实现原理：**
- 前端通过 Canvas 将图片压缩（最大宽度 1024px，JPEG 质量 0.8）
- 图片转为 Base64 DataURL
- 后端按 OpenAI 标准多模态格式构造请求体：

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "图中内容是什么？"},
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,/9j/4AAQ..."}}
  ]
}
```

**注意：** 底层模型（如 Qwen）对输入长度有限制（约 96 万字符），因此前端压缩是必需步骤。

### 2.4 常见问题

#### Q: OpenClaw 返回 401 Unauthorized
A: 检查配置的 Token 是否正确，以及 `data/ai_platform_config.json` 中的 Token 是否经过正确解密。

#### Q: OpenClaw 返回 `All models failed (8): timeout`
A: 这是 OpenClaw 内部所有候选模型都超时了，说明 OpenClaw 到上游模型服务商的网络不通或服务商拥堵。需要检查 OpenClaw 服务器的网络状况。

#### Q: 返回 `InvalidParameter: Range of input length should be [1, 983616]`
A: Base64 图片太大，超过了模型上下文长度限制。前端已做压缩，如果仍出现，请进一步缩小截图区域再发送。

---

## 三、Ollama 配置

### 3.1 基础配置

进入「系统设置」→ AI 平台配置，选择 **Ollama**：

| 配置项 | 示例值 | 说明 |
|--------|--------|------|
| URL | `http://192.168.1.211:11434` | Ollama 服务地址 |
| Model | `gemma3:27b` | 本地已下载的模型名称 |

### 3.2 远程访问配置

默认 Ollama 只监听 `127.0.0.1`，如需远程访问：

```bash
# 在 Ollama 所在服务器上设置环境变量
export OLLAMA_HOST=0.0.0.0
ollama serve
```

同时确保防火墙放行 11434 端口。

### 3.3 模型下载

```bash
ollama pull gemma3:27b
ollama pull qwen2.5:14b
```

---

## 四、异步任务轮询架构

### 4.1 为什么需要异步轮询？

AI 助手早期使用 SSE 长连接直接返回流式结果，但当 OpenClaw/Ollama 执行长耗时任务（如内部工具链 kubectl 分析、网络抓包诊断）时，存在以下问题：

- **Nginx/浏览器超时**：默认 60~120 秒会切断空闲连接
- **网络闪断**：移动网络或 Wi-Fi 不稳定时，SSE 直接中断且无法恢复
- **页面刷新丢失**：刷新后看不到之前的分析进度

### 4.2 异步轮询流程

```
用户发送消息
    ↓
前端 POST /api/v1/ai/chat/task  →  后端立即返回 task_id
    ↓
后端启动 goroutine 调用 AI Provider（流式）
    ↓
每收到一个 chunk  →  更新 Redis（ai:task:<id>）
    ↓
前端每 2 秒 GET /api/v1/ai/chat/task/<id> 轮询
    ↓
任务完成  →  Redis 最终状态  →  PostgreSQL 落盘
```

### 4.3 状态说明

| 状态 | 含义 |
|------|------|
| `running` | 任务执行中，持续轮询 |
| `completed` | 任务成功完成，`result` 为完整回复 |
| `failed` | 任务失败，`error` 为错误信息 |

### 4.4 降级策略

若 Redis 未启动或连接失败，后端会自动降级为 `sync.Map` 内存缓存，保证异步轮询功能仍然可用（但服务重启后任务状态会丢失）。

---

## 五、扩展：新增其他 AI 平台

如果你需要对接除 OpenClaw / Ollama 之外的模型平台（如 Azure OpenAI、通义千问官方 API、Kimi API 等），按以下步骤扩展：

1. **新建 Provider 文件**

```go
// internal/pkg/ai/custom.go
package ai

type CustomProvider struct { ... }

func (p *CustomProvider) Name() string { return "custom" }
func (p *CustomProvider) ChatCompletion(ctx context.Context, messages []Message) (string, error) { ... }
func (p *CustomProvider) ChatCompletionStream(ctx context.Context, messages []Message, onChunk func(StreamResponse)) error { ... }
func (p *CustomProvider) ListModels(ctx context.Context) ([]string, error) { ... }
func (p *CustomProvider) HealthCheck(ctx context.Context) error { ... }
func (p *CustomProvider) SetSessionID(id string) { ... }
```

2. **在 Factory 中注册**

修改 `internal/pkg/ai/factory.go`（或等效创建逻辑），根据配置返回对应的 Provider 实例。

3. **前端配置项扩展**

在 `frontend/src/pages/Settings.tsx` 的 provider select 中增加新选项。

4. **重新编译并部署**

---

## 六、相关文件

| 文件 | 说明 |
|------|------|
| `internal/pkg/ai/provider.go` | AI Provider 统一接口 |
| `internal/pkg/ai/openclaw.go` | OpenClaw 实现 |
| `internal/pkg/ai/ollama.go` | Ollama 实现 |
| `internal/service/ai_task_service.go` | 异步任务服务 |
| `internal/api/handlers/ai_chat.go` | AI 对话 HTTP 接口 |
| `frontend/src/pages/AI.tsx` | AI 助手前端页面 |
| `frontend/src/lib/ai-chat-api.ts` | AI API 请求封装 |
| `data/ai_platform_config.json` | AI 配置持久化文件（AES-256 加密） |
