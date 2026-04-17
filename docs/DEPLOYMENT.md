# CloudOps Platform v2.0 完整部署指南

> 本文档面向运维人员和开发者，详细说明 CloudOps 平台的部署步骤、依赖要求、数据库初始化以及安全注意事项。

---

## 目录

1. [项目概述](#一项目概述)
2. [技术栈与依赖清单](#二技术栈与依赖清单)
3. [数据库说明与初始化](#三数据库说明与初始化)
4. [部署前准备](#四部署前准备)
5. [部署方式一：开发环境](#五部署方式一开发环境)
6. [部署方式二：生产环境（systemd + Nginx）](#六部署方式二生产环境systemd--nginx)
7. [部署方式三：Docker 部署](#七部署方式三docker-部署)
8. [部署方式四：离线部署](#八部署方式四离线部署)
9. [Web 终端安全警告（必读）](#九web-终端安全警告必读)
10. [安全配置建议](#十安全配置建议)
11. [常见问题排查](#十一常见问题排查)

---

## 一、项目概述

CloudOps Platform v2.0 是一款面向多集群 Kubernetes 环境的云原生智能运维管理平台，提供以下核心能力：

- **集群管理**：多集群 Kubeconfig / Token 双认证，支持 20+ 集群
- **资源管理**：Namespace、Pod、Node、Deployment 等 K8s 资源可视化操作
- **Web 终端**：基于 WebSocket + PTY 的浏览器终端，直连集群执行 kubectl
- **网络追踪**：Ephemeral Container 抓包、流量拓扑可视化
- **日志管理**：支持 Elasticsearch / OpenSearch / Loki 多后端
- **智能巡检**：定时任务调度，自动化集群巡检
- **AI 助手**：集成 OpenClaw / Ollama，支持 SSE 流式对话

**默认登录账号**：`admin / admin`（首次登录后请立即修改密码）

---

## 二、技术栈与依赖清单

### 2.1 核心技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 后端 | Go | 1.21+ | 项目 go.mod 声明 1.25，建议使用 1.23+ |
| Web 框架 | Gin | v1.9.1 | HTTP API 服务 |
| ORM | GORM | v2 | 支持 PostgreSQL / SQLite |
| 前端 | React + Vite + TypeScript | 18+ | 现代前端架构 |
| UI 组件库 | Material-UI (MUI) | v5.x | 企业级组件 |
| 终端 | xterm.js | v5.x | Web 终端渲染 |
| K8s 客户端 | client-go | v0.29+ | 多集群操作 |
| AI 运行时 | Node.js + Express | 18+ | Agent Runtime 服务 |

### 2.2 必须依赖

以下依赖为系统正常运行的必要条件：

| 依赖 | 版本 | 用途 | 是否必须 |
|------|------|------|----------|
| **Go** | 1.21+ | 编译后端 | 是（生产环境可只用编译好的二进制） |
| **Node.js** | 18+ | 前端构建、Agent Runtime 运行 | 是 |
| **npm** | 9+ | 前端和 Agent 依赖管理 | 是 |
| **PostgreSQL** | 15+ | 主数据库 | **二选一** |
| **SQLite** | 3.x | 轻量模式内置数据库 | **二选一** |

### 2.3 可选依赖

| 依赖 | 版本 | 用途 | 说明 |
|------|------|------|------|
| **Redis** | 7+ | AI 任务缓存 | 可选，不可用时回退到内存模式 |
| **Nginx** | 1.20+ | 前端托管、反向代理 | 生产环境强烈建议 |
| **kubectl** | 1.28+ | K8s 集群管理 | 平台已内置 kubectl 二进制 |
| **Docker** | 24+ | 网络追踪抓包容器 | 用于拉取 `nicolaka/netshoot` |
| **AI 平台** | - | OpenClaw / Ollama | 如需 AI 对话功能则需部署 |

### 2.4 前端依赖（自动安装）

进入 `frontend/` 目录执行 `npm install` 会自动安装：

- `react`, `react-dom`, `react-router-dom`
- `@mui/material`, `@mui/icons-material`, `@mui/x-data-grid`
- `@tanstack/react-query`, `axios`, `dayjs`
- `xterm`, `xterm-addon-fit`, `@monaco-editor/react`
- `echarts`, `recharts`, `react-grid-layout`
- `marked`, `react-markdown`, `remark-gfm`

### 2.5 Agent Runtime 依赖（自动安装）

进入 `agent-runtime/` 目录执行 `npm install` 会自动安装：

- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-ai`
- `express`, `cors`

### 2.6 后端 Go 依赖（自动下载）

执行 `go mod download` 会自动下载所有 Go 模块，主要包括：

- `github.com/gin-gonic/gin` — Web 框架
- `gorm.io/gorm` + `driver/postgres` + `driver/sqlite` — 数据库 ORM
- `github.com/golang-jwt/jwt/v5` — JWT 认证
- `github.com/redis/go-redis/v9` — Redis 客户端
- `k8s.io/client-go` — Kubernetes 客户端
- `github.com/creack/pty` — 伪终端（Web Terminal）
- `github.com/gorilla/websocket` — WebSocket
- `github.com/google/gopacket` — 网络抓包
- `github.com/robfig/cron/v3` — 定时任务

---

## 三、数据库说明与初始化

### 3.1 支持的数据库

CloudOps 支持两种数据库模式：

| 模式 | 数据库 | 适用场景 | 资源要求 |
|------|--------|----------|----------|
| **全功能模式** | PostgreSQL 15+ | 生产环境、多用户、高并发 | 4C8G+ |
| **轻量模式** | SQLite（内置） | 开发测试、小团队、POC | 2C4G+ |

> **生产环境强烈建议使用 PostgreSQL**。SQLite 虽然零配置，但并发性能和数据完整性不如 PostgreSQL。

### 3.2 数据库配置

配置文件位置：`config/config.yaml`

#### PostgreSQL 配置

```yaml
database:
  postgres:
    host: "localhost"        # 数据库地址，留空则自动使用 SQLite
    port: 5432
    database: "cloudops"
    username: "cloudops"
    password: "cloudops123"  # 生产环境请使用强密码并通过环境变量注入
    ssl_mode: "disable"
    max_connections: 100
    max_idle: 10
```

#### SQLite 配置（轻量模式）

只需将 `database.postgres.host` 留空或删除整段：

```yaml
database:
  postgres:
    host: ""   # 留空自动回退到 SQLite
```

程序启动时会在当前目录创建 `cloudops.db` 文件。

### 3.3 数据库初始化流程

**首次启动时，后端会自动完成以下初始化，无需手动执行 SQL 脚本：**

1. **连接数据库**：根据配置选择 PostgreSQL 或 SQLite
2. **自动迁移表结构**（GORM AutoMigrate），共创建以下表：
   - 租户：`tenants`
   - 用户与权限：`users`, `roles`, `permissions`, `cluster_permissions`
   - 集群管理：`clusters`, `cluster_secrets`, `cluster_metadata`, `cluster_log_backends`
   - 数据源与仪表盘：`data_sources`, `dashboards`, `dashboard_panels`
   - 巡检：`inspection_tasks`, `inspection_jobs`, `inspection_results`, `inspection_rules`
   - AI 相关：`ai_platforms`, `ai_chat_sessions`, `ai_chat_messages`, `ai_tasks`
   - 系统：`system_settings`, `login_logs`, `audit_logs`
3. **数据迁移**：将旧版 `cluster_metadata.log_backend` JSON 字段迁移到独立的 `cluster_log_backends` 表
4. **初始化默认数据**：
   - 默认租户：`default`
   - 默认角色：`admin`（管理员）、`operator`（运维）、`viewer`（只读）
   - 默认权限：集群/节点/Pod/终端/巡检等 8 项 RBAC 权限
   - **默认管理员账号**：`admin / admin`

> ⚠️ **安全提醒**：首次登录后请 **立即修改 admin 密码**。默认密码仅为方便初次体验，不可用于生产环境。

### 3.4 手动初始化 PostgreSQL（如需要）

如果后端自动连接失败，或你需要预先创建数据库用户，可执行以下命令：

```bash
# 以 postgres 用户登录
sudo -u postgres psql

# 在 psql 中执行
CREATE USER cloudops WITH PASSWORD 'YourStrongPassword';
CREATE DATABASE cloudops OWNER cloudops;
GRANT ALL PRIVILEGES ON DATABASE cloudops TO cloudops;
\q
```

对于 PostgreSQL 15+，如果遇到权限问题，还需授予 schema 权限：

```bash
sudo -u postgres psql -d cloudops -c "GRANT ALL ON SCHEMA public TO cloudops;"
```

### 3.5 Redis 配置（可选）

```yaml
database:
  redis:
    host: "localhost"
    port: 6379
    password: "${REDIS_PASSWORD}"
    db: 0
    pool_size: 100
```

Redis 仅用于 AI 异步任务状态缓存。**不可用时不影响核心功能**，系统会自动回退到内存 `sync.Map` 模式，但重启后会丢失未完成的 AI 任务状态。

---

## 四、部署前准备

### 4.1 系统环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | CentOS 7/8、Rocky Linux 8/9、Ubuntu 20.04/22.04/24.04 |
| CPU 架构 | x86_64 (amd64) |
| 内存 | 全功能模式 ≥ 8GB，轻量模式 ≥ 4GB |
| 磁盘 | ≥ 20GB 可用空间 |
| 网络 | 内网互通，如需 AI 功能可访问 AI 平台地址 |

### 4.2 端口规划

| 服务 | 端口 | 说明 |
|------|------|------|
| CloudOps Backend | 9000 | Go 后端 API 服务 |
| CloudOps Frontend | 18000 | 前端页面（开发/预览）或 Nginx 80/443 |
| Agent Runtime | 19000 | Node.js AI Agent 服务（由后端自动启动） |
| PostgreSQL | 5432 | 主数据库 |
| Redis | 6379 | 缓存（可选） |

### 4.3 创建运行用户（推荐）

生产环境建议创建专用用户运行服务：

```bash
sudo useradd -r -s /bin/false -d /opt/cloudops -m cloudops
```

> ⚠️ **特别注意**：请勿使用 `root` 用户直接运行后端服务，尤其是 Web 终端功能存在历史安全风险。

---

## 五、部署方式一：开发环境

适合本地开发、快速体验。

### 5.1 安装依赖

```bash
# 安装 Go（如未安装）
# 注意：项目 go.mod 声明 go 1.25.0，但 Go 1.25 可能尚未正式发布
# 若遇到版本不兼容，可将 go.mod 中的 go 版本改为本地可用版本（如 1.23.4）
# 参考 https://go.dev/doc/install

# 安装 Node.js 18+（如未安装）
# 参考 https://nodejs.org/

# 安装 PostgreSQL 15+（可选，开发可用 SQLite）
# Ubuntu: sudo apt-get install postgresql-15
# CentOS: sudo yum install postgresql15-server
```

### 5.2 克隆/解压项目

```bash
cd /data/projects/cloudops-v2
```

### 5.3 启动后端

```bash
# 下载 Go 依赖
go mod download

# 编译
go build -o cloudops-backend ./cmd/server

# 启动（默认读取 config/config.yaml）
./cloudops-backend
```

或使用热重载工具 `air`：

```bash
# 安装 air
go install github.com/cosmtrek/air@latest

# 启动热重载
air
```

### 5.4 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端开发服务器运行在 `http://localhost:18000`，已配置代理将 `/api` 和 `/ws` 转发到 `http://localhost:9000`。

### 5.5 启动 Agent Runtime（可选，后端会自动启动）

```bash
cd agent-runtime
npm install
npm run build
node dist/server.js --port 19000
```

---

## 六、部署方式二：生产环境（systemd + Nginx）

这是推荐的生产部署方式，稳定、可控、易维护。

### 6.1 编译构建

在有网络的构建机上执行：

```bash
cd /data/projects/cloudops-v2

# 后端
go mod download
export CGO_ENABLED=0
export GOOS=linux
export GOARCH=amd64
go build -ldflags="-s -w" -o cloudops-backend ./cmd/server

# 前端
cd frontend
npm install
npm run build

# Agent Runtime
cd ../agent-runtime
npm install
npm run build
```

### 6.2 部署文件到服务器

```bash
# 创建目录
sudo mkdir -p /opt/cloudops/app
sudo mkdir -p /opt/cloudops/app/frontend/dist
sudo mkdir -p /opt/cloudops/app/agent-runtime/dist

# 复制文件
sudo cp cloudops-backend /opt/cloudops/app/
sudo cp -r frontend/dist/* /opt/cloudops/app/frontend/dist/
sudo cp -r agent-runtime/dist /opt/cloudops/app/agent-runtime/
sudo cp -r agent-runtime/node_modules /opt/cloudops/app/agent-runtime/
sudo cp agent-runtime/package.json /opt/cloudops/app/agent-runtime/
sudo cp config/config.yaml /opt/cloudops/app/

# 设置权限
sudo chown -R cloudops:cloudops /opt/cloudops/app
```

### 6.3 配置环境变量

```bash
sudo mkdir -p /etc/cloudops
sudo tee /etc/cloudops/env > /dev/null << 'EOF'
export CONFIG_PATH=/opt/cloudops/app/config.yaml
export DB_PASSWORD=YourStrongPassword
export REDIS_PASSWORD=YourRedisPassword
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export OPENCLAW_URL=http://your-openclaw-ip:8080
EOF

sudo chmod 600 /etc/cloudops/env
```

> **安全提醒**：`JWT_SECRET` 和 `ENCRYPTION_KEY` 每次部署必须重新生成，长度建议 32 字节以上，且不可泄露。

### 6.4 配置 systemd 服务

**后端服务** `/etc/systemd/system/cloudops-backend.service`：

```ini
[Unit]
Description=CloudOps Backend
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=cloudops
Group=cloudops
WorkingDirectory=/opt/cloudops/app
ExecStart=/opt/cloudops/app/cloudops-backend
Restart=on-failure
RestartSec=5
Environment="CONFIG_PATH=/opt/cloudops/app/config.yaml"
Environment="GIN_MODE=release"
Environment="JWT_SECRET=your-jwt-secret-here"
Environment="ENCRYPTION_KEY=your-encryption-key-here"

[Install]
WantedBy=multi-user.target
```

**启用并启动**：

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudops-backend
sudo systemctl start cloudops-backend

# 查看状态
sudo systemctl status cloudops-backend
sudo journalctl -u cloudops-backend -f
```

### 6.5 配置 Nginx

```bash
sudo tee /etc/nginx/conf.d/cloudops.conf > /dev/null << 'EOF'
server {
    listen 80;
    server_name cloudops.example.com;
    root /opt/cloudops/app/frontend/dist;
    index index.html;

    # 前端静态资源
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:9000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }

    # WebSocket 代理（Web Terminal 必需）
    location /ws/ {
        proxy_pass http://127.0.0.1:9000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }

    # 上传文件代理
    location /uploads {
        proxy_pass http://127.0.0.1:9000;
    }
}
EOF

sudo nginx -t
sudo systemctl reload nginx
```

> **WebSocket 配置非常关键**：如果 `/ws/` 代理配置不正确，Web 终端将无法连接。

### 6.6 验证部署

```bash
# 后端健康检查
curl http://127.0.0.1:9000/health
# 预期返回：{"status":"healthy","version":"2.0.0"}

# 前端访问
# 浏览器打开 http://<服务器IP>

# 登录测试
# 账号：admin / admin
```

---

## 七、部署方式三：Docker 部署

### 7.1 构建镜像

创建 `docker/Dockerfile.backend`：

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod download && CGO_ENABLED=0 go build -ldflags="-s -w" -o cloudops-backend ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates bash
WORKDIR /app
COPY --from=builder /app/cloudops-backend .
COPY --from=builder /app/config ./config
COPY --from=builder /app/agent-runtime ./agent-runtime
COPY --from=builder /app/data ./data
EXPOSE 9000
CMD ["./cloudops-backend"]
```

创建 `docker/Dockerfile.frontend`：

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### 7.2 docker-compose 部署

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: cloudops
      POSTGRES_USER: cloudops
      POSTGRES_PASSWORD: ${DB_PASSWORD:-cloudops123}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cloudops -d cloudops"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

  backend:
    build:
      context: .
      dockerfile: docker/Dockerfile.backend
    ports:
      - "9000:9000"
    environment:
      - CONFIG_PATH=/app/config/config.yaml
      - DATABASE__POSTGRES__HOST=postgres
      - DATABASE__REDIS__HOST=redis
      - JWT_SECRET=${JWT_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
    volumes:
      - ./config/config.yaml:/app/config/config.yaml:ro
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped

  frontend:
    build:
      context: .
      dockerfile: docker/Dockerfile.frontend
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  pgdata:
  redisdata:
```

启动：

```bash
docker-compose up -d
```

---

## 八、部署方式四：离线部署

适用于无外网访问的私有化/内网环境。

### 8.1 准备离线包（在有网机器上执行）

```bash
mkdir -p cloudops-offline-package/{bin,frontend,agent-runtime,config,dependencies}

# 编译后端
export CGO_ENABLED=0 GOOS=linux GOARCH=amd64
go build -ldflags="-s -w" -o cloudops-offline-package/bin/cloudops-backend ./cmd/server

# 构建前端
cd frontend && npm install && npm run build
cp -r dist/* ../cloudops-offline-package/frontend/

# 构建 Agent Runtime
cd ../agent-runtime && npm install && npm run build
cp -r dist package.json package-lock.json node_modules ../cloudops-offline-package/agent-runtime/

# 复制配置
cp config/config.yaml cloudops-offline-package/config/
```

### 8.2 目标服务器安装

```bash
# 1. 安装系统依赖（RPM 系示例）
cd cloudops-offline-package/dependencies
rpm -ivh *.rpm --nodeps

# 2. 初始化 PostgreSQL
/usr/pgsql-15/bin/postgresql-15-setup initdb
systemctl enable postgresql-15
systemctl start postgresql-15

# 3. 创建数据库
sudo -u postgres psql <<EOF
CREATE USER cloudops WITH PASSWORD 'YourStrongPassword';
CREATE DATABASE cloudops OWNER cloudops;
GRANT ALL PRIVILEGES ON DATABASE cloudops TO cloudops;
EOF

# 4. 部署应用
sudo mkdir -p /opt/cloudops/app
sudo cp -r cloudops-offline-package/* /opt/cloudops/app/

# 5. 启动
sudo systemctl start cloudops-backend
```

### 8.3 轻量模式（无 PostgreSQL/Redis）

如果环境资源紧张，可使用 SQLite 模式：

```yaml
# config/config.yaml
database:
  postgres:
    host: ""   # 留空即使用 SQLite
```

此模式下只需运行后端二进制和前端静态文件即可。

---

## 九、Web 终端安全警告（必读）

### ⚠️ 严重安全提醒

**Web 终端功能允许用户通过浏览器直接在服务器上执行 shell 命令，历史上曾导致宿主机系统文件损坏。**

### 9.1 已发现的安全问题

在代码审计中，我们发现并修复了以下高危漏洞：

#### 问题 1：chroot 隔离不足导致宿主机文件系统损坏（已修复）

**风险等级**：🔴 高危

**问题描述**：旧版本仅使用 `chroot` 进行沙盒隔离，但：
- 未配合 Linux Namespace 隔离
- 读写挂载了 `/proc`，用户可通过 `/proc/1/root` 直接访问宿主机根文件系统
- 使用 `mknod` 创建设备节点，root 用户可重新创建宿主机磁盘设备并直接读写

**后果**：用户在终端中输入的命令可能直接破坏宿主机的 `/etc`、`/var`、`/usr` 等系统目录。

**修复措施**：
1. 增加了 `CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWUSER | CLONE_NEWIPC` 命名空间隔离
2. 移除了 `/proc` 挂载，消除 `/proc/1/root` 逃逸通道
3. 移除了 `mknod`，改用 bind-mount 已知安全的字符设备
4. 系统目录以 `MS_RDONLY | MS_NOSUID | MS_NODEV` 只读方式挂载

#### 问题 2：沙盒目录命名冲突导致文件误删（已修复）

**风险等级**：🟠 中危

**问题描述**：旧版本使用 `os.Getpid()` 作为沙盒目录后缀，但 Go HTTP 服务器是单进程多 goroutine 模型，多个并发终端会话会共用同一个目录。新连接会删除旧连接正在使用的沙盒，导致 `RemoveAll` 误删正在使用的目录及其挂载点。

**修复措施**：使用 `crypto/rand` + 时间戳生成全局唯一会话 ID 作为目录名。

#### 问题 3：挂载点清理逻辑错误导致资源泄漏（已修复）

**风险等级**：🟠 中危

**问题描述**：`cleanupSandboxMounts` 函数中卸载的路径错误（`home/cloudops` 而非实际挂载点 `root`），导致 bind mount 的 homeDir 永远无法被卸载。多次使用后挂载表累积，可能导致系统 `too many mounts` 错误。

**修复措施**：修正卸载路径，并确保按正确顺序（先子后父）卸载所有挂载点。

#### 问题 4：网络追踪命令注入（已修复）

**风险等级**：🟠 中危

**问题描述**：`CreateDebug` API 直接将用户输入的 `command` 注入到 K8s Pod 的临时容器中执行，未做任何校验。

**修复措施**：添加了 `validateDebugCommand` 函数，实施命令白名单和危险字符过滤。

### 9.2 部署时安全建议

1. **不要用 root 运行后端**：即使修复了代码，仍建议以普通用户 `cloudops` 运行后端服务
2. **限制 Web 终端使用**：仅给受信任的用户分配 `terminal:use` 权限
3. **启用审计日志**：在 `config.yaml` 中开启 `security.audit.enabled`，记录所有终端操作
4. **考虑完全禁用终端**：如果业务不需要，在 `config.yaml` 中设置 `kubernetes.terminal.enabled: false`
5. **定期清理沙盒**：检查 `/var/lib/cloudops-sandbox/` 目录，手动清理残留目录

### 9.3 残留沙盒清理脚本

如果之前的使用已经导致挂载点泄漏，可执行以下脚本清理：

```bash
#!/bin/bash
# 清理所有 cloudops 沙盒挂载点和残留目录

for mount in $(mount | grep cloudops-sandbox | awk '{print $3}'); do
    echo "Unmounting: $mount"
    sudo umount -l "$mount" 2>/dev/null || true
done

if [ -d /var/lib/cloudops-sandbox ]; then
    echo "Removing residual sandbox directories..."
    sudo rm -rf /var/lib/cloudops-sandbox/*
fi

echo "Cleanup done."
```

---

## 十、安全配置建议

### 10.1 必改项

| 配置项 | 当前风险 | 建议操作 |
|--------|----------|----------|
| `admin` 密码 | 默认 `admin/admin` | 首次登录后立即修改 |
| `JWT_SECRET` | 为空则使用默认值 | 设置为 64 位随机字符串 |
| `ENCRYPTION_KEY` | 为空则不安全 | 设置为 32 字节随机密钥 |
| `database.postgres.password` | 默认 `cloudops123` | 使用强密码 + 环境变量注入 |
| 后端运行用户 | root | 改为普通用户 `cloudops` |

### 10.2 生成安全密钥

```bash
# JWT Secret（64 字符）
openssl rand -hex 32

# Encryption Key（32 字节）
openssl rand -hex 16
```

### 10.3 HTTPS 配置

生产环境必须启用 HTTPS，可通过 Nginx 配置：

```nginx
server {
    listen 443 ssl http2;
    server_name cloudops.example.com;
    
    ssl_certificate /etc/nginx/ssl/cloudops.crt;
    ssl_certificate_key /etc/nginx/ssl/cloudops.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    
    # ... 其他配置与 HTTP 模式相同
}

server {
    listen 80;
    server_name cloudops.example.com;
    return 301 https://$server_name$request_uri;
}
```

---

## 十一、常见问题排查

### Q1：后端启动报错 "连接数据库失败"

- 检查 PostgreSQL 是否已启动：`systemctl status postgresql`
- 检查 `config.yaml` 中的 `host/port/password` 是否正确
- 检查防火墙是否放行 5432 端口
- 检查数据库用户是否有权限：`GRANT ALL ON SCHEMA public TO cloudops;`

### Q2：前端页面空白，只有标题

- 确认 `frontend/dist/` 目录存在且包含 `index.html`
- 确认前端服务端口未被占用
- 检查 Nginx `try_files` 配置是否正确
- 浏览器 F12 查看控制台报错

### Q3：Web 终端连接失败或黑屏

- 确认 Nginx `/ws/` 代理配置了 `proxy_http_version 1.1` 和 `upgrade` 头部
- 确认后端 `kubernetes.terminal.enabled: true`
- 检查浏览器控制台 WebSocket 错误
- 查看后端日志是否有权限错误（如无法创建 `/var/lib/cloudops-sandbox`）

### Q4：Agent Runtime 启动失败 "Cannot find module"

- 确认 `agent-runtime/node_modules` 已完整复制到目标服务器
- 确认目标服务器 Node.js 版本 ≥ 18
- 手动执行 `cd agent-runtime && node dist/server.js --port 19000` 查看具体错误

### Q5：SQLite 模式下数据丢失

- SQLite 数据库文件 `cloudops.db` 默认生成在启动目录
- 确保后端始终在固定目录启动，或配置绝对路径
- 如需迁移到 PostgreSQL，可使用 `pgloader` 等工具

### Q6：添加 K8s 集群后无法获取资源

- 确认 Kubeconfig 内容正确且未过期
- 确认后端服务器能访问集群 API Server 地址
- 检查集群证书是否被信任
- 查看后端日志中的 K8s 连接错误

---

## 附录：目录结构说明

```
cloudops-v2/
├── cmd/server/main.go          # 后端主入口
├── cmd/check-logs/             # 日志检查工具
├── config/config.yaml          # 主配置文件
├── internal/
│   ├── api/handlers/           # HTTP Handler
│   ├── api/middleware/         # 中间件（JWT 认证等）
│   ├── api/routes.go           # 路由注册
│   ├── model/                  # GORM 数据模型
│   ├── pkg/
│   │   ├── database/           # 数据库初始化 + AutoMigrate
│   │   ├── auth/               # JWT 管理
│   │   ├── config/             # 配置加载
│   │   ├── crypto/             # AES-256 加密
│   │   ├── k8s/                # K8s 客户端封装
│   │   ├── redis/              # Redis 客户端
│   │   └── log/                # 日志后端适配器
│   └── service/                # 业务逻辑层
├── frontend/                   # React 前端项目
├── agent-runtime/              # Node.js AI Agent 运行时
├── docker/                     # Docker 配置（需自行创建）
├── k8s/                        # K8s YAML 清单（需自行创建）
├── docs/                       # 文档
├── data/
│   └── kubectl                 # 内嵌的 kubectl 二进制
└── uploads/                    # 上传文件目录
```

---

> **文档版本**：v2.0  
> **最后更新**：2026-04-17  
> **维护者**：CloudOps 开发团队
