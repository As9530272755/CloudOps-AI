# 快速开始指南

本指南帮助你在 5 分钟内启动 CloudOps Platform 并进行首次体验。

## 前置条件

- Linux/macOS 环境
- 已安装 Go 1.21+、Node.js 18+
- 可选：PostgreSQL、Redis

## 第一步：获取代码

```bash
git clone https://github.com/As9530272755/CloudOps-AI.git
cd CloudOps-AI
```

## 第二步：配置后端

编辑 `config/config.yaml`：

```yaml
database:
  postgres:
    host: "localhost"
    port: 5432
    database: "cloudops"
    username: "cloudops"
    password: "your-password"
    ssl_mode: "disable"
  redis:
    host: "localhost"
    port: 6379
    password: ""
    db: 0

ai:
  openclaw:
    enabled: true
    api_url: "http://localhost:8080"
    api_key: ""
    timeout: 60s
    max_tokens: 4096
```

> 如果没有 PostgreSQL，将 `postgres.host` 留空，系统会自动降级使用 SQLite（`cloudops.db`）。

## 第三步：编译并启动后端

```bash
cd /data/projects/cloudops-v2
go build -o cloudops-backend ./cmd/server
./cloudops-backend
```

当看到以下日志时表示启动成功：

```
✅ 配置加载成功
✅ 数据库连接成功
✅ API 路由注册完成
🚀 CloudOps Backend 启动在 0.0.0.0:9000
```

## 第四步：启动前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:18000`，使用默认账号登录：

- 用户名：`admin`
- 密码：`admin`

## 第五步：配置 AI 助手

1. 进入左侧菜单「系统设置」
2. 选择 AI 平台类型（OpenClaw 或 Ollama）
3. 填写 URL 和 Token/Model
4. 点击「测试连接」通过后保存

## 第六步：体验 AI 助手

进入「AI 助手」页面，输入 Kubernetes 相关问题，或按 `Ctrl+V` 粘贴截图，观察 AI 回复。

---

## 常见问题

### Q: 前端白屏？
A: 按 `Ctrl + F5` 强制刷新，清除浏览器缓存。

### Q: OpenClaw 返回 401？
A: 检查 Token 是否正确，以及 `data/ai_platform_config.json` 中的 Token 是否被正确解密。

### Q: AI 发送图片后超时？
A: 前端已自动对图片进行 Canvas 压缩（最大宽度 1024px，JPEG 质量 0.8），若仍超时请检查 OpenClaw 到上游模型的网络连通性。
