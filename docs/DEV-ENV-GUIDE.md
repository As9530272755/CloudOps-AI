# 内网跨平台开发部署指南

## 场景描述

```
┌─────────────────────┐         ┌──────────────────────────────┐
│   Windows VDI       │  ←──→   │   Linux 服务器               │
│   (开发机)          │  网络通  │   Redis + PostgreSQL         │
│   能连互联网        │         │   (可选: 也放代码+编译)       │
│   不能连外网        │         └──────────────────────────────┘
└─────────────────────┘
```

---

## 问题 1：AI 能在 Windows 上开发吗？

**结论：可以，但需要 Kimi Code CLI 运行在 Windows 上。**

### 方案 A：AI 继续在 Linux 上运行（推荐）

把代码仓库放在 Linux 服务器上，Windows VDI 只做两件事：
1. **SSH 到 Linux** 操作代码（或用 VS Code Remote-SSH）
2. **浏览器访问前端**（Linux IP:18000）

```bash
# Windows VDI 上打开浏览器
http://<linux-ip>:18000    # 前端
http://<linux-ip>:9000     # 后端 API
```

**优点：**
- 无需在 Windows 上安装 Go/Node.js 开发环境
- AI 直接操作 Linux 上的代码（当前模式）
- 前后端编译环境统一（Linux）

### 方案 B：AI 运行在 Windows VDI 上

需要在 Windows VDI 上安装 Kimi Code CLI：

```powershell
# 1. 安装 uv (Python 包管理器)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 2. 安装 Kimi Code CLI
uv tool install kimi-cli

# 3. 进入项目目录运行
kimi code
```

**前提：** Windows VDI 能访问互联网下载安装包。

---

## 问题 2：前端怎么启动？

### 方案 A：前端跑在 Linux 上（推荐）

```bash
# Linux 服务器上
cd /data/projects/cloudops-v2/frontend
npm install        # 首次需要联网下载依赖
npm run dev        # 启动开发服务器，端口 18000
```

vite.config.ts 中已配置 `host: '0.0.0.0'`，所以：
- Linux 本机：`http://localhost:18000`
- Windows VDI：`http://<linux-ip>:18000`

**网络检查：**
```bash
# Linux 上检查端口监听
ss -ntl | grep 18000

# Windows 上测试连通性
curl http://<linux-ip>:18000
```

### 方案 B：前端跑在 Windows VDI 上

```powershell
# Windows VDI 上
cd C:\cloudops-v2\frontend
npm install
npm run dev
```

**注意：** 如果 Windows 不能联网下载 npm 包，需要：
1. 找一台能联网的机器 `npm install`
2. 把整个 `node_modules` 复制到 Windows VDI
3. 或者配置公司内部 npm 镜像

**数据库连接：** 前端 vite.config.ts 中的 proxy 配置默认代理到 `localhost:9000`。如果后端也在 Linux 上，需要修改 proxy 的 target 为 Linux IP：

```typescript
// frontend/vite.config.ts
proxy: {
  '/api': {
    target: 'http://<linux-ip>:9000',   // ← 改这里
    changeOrigin: true,
  },
  '/ws': {
    target: 'ws://<linux-ip>:9000',     // ← 改这里
    ws: true,
  },
}
```

---

## 问题 3：后端数据库配置（Redis/PostgreSQL 在 Linux 上）

```yaml
# config/config.yaml
server:
  port: 9000
  mode: release

database:
  host: <linux-ip>      # ← Redis/PG 所在 Linux IP
  port: 5432
  user: cloudops
  password: xxx
  dbname: cloudops

redis:
  host: <linux-ip>      # ← Redis 所在 Linux IP
  port: 6379
  password: ""
  db: 0
```

**Linux 防火墙放行：**
```bash
# Linux 上确保 PG 和 Redis 监听所有接口
# postgresql.conf
listen_addresses = '*'

# pg_hba.conf
host  all  all  0.0.0.0/0  scram-sha-256

# Redis
# 注释掉 bind 127.0.0.1，或改为 bind 0.0.0.0
```

---

## 问题 4：开发 → 编译 → 部署到 Linux

### 步骤 1：开发环境（任选其一）

| 模式 | 代码位置 | 前端启动 | 后端启动 |
|------|---------|---------|---------|
| Linux 全栈 | Linux | `npm run dev` (Linux) | `./cloudops-backend` (Linux) |
| Windows 开发 | Windows | `npm run dev` (Windows) | `go run` (Windows) |

### 步骤 2：编译构建

**后端（交叉编译到 Linux）：**
```bash
# 在任意环境（Windows/Mac/Linux）上编译 Linux 二进制
set GOOS=linux        # Windows CMD
set GOARCH=amd64
set CGO_ENABLED=0
go build -o cloudops-backend ./cmd/server

# 或 Linux 上直接编译
go build -o cloudops-backend ./cmd/server
```

**前端：**
```bash
cd frontend
npm run build         # 生成 dist/ 目录
```

### 步骤 3：部署到 Linux

```bash
# 1. 上传文件到 Linux
scp cloudops-backend root@<linux-ip>:/opt/cloudops/
scp -r frontend/dist root@<linux-ip>:/opt/cloudops/frontend/

# 2. Linux 上启动
# 方式一：手动启动
cd /opt/cloudops
nohup ./cloudops-backend > backend.log 2>&1 &

# 方式二：systemd 服务
cp systemd/cloudops-backend.service /etc/systemd/system/
systemctl enable cloudops-backend
systemctl start cloudops-backend

# 3. 启动 nginx（离线包 install.sh 自动完成）
# nginx 配置模板在 offline-package/config/nginx-cloudops.conf
```

---

## 推荐的开发流程

```
┌─────────────────────────────────────────────────────────────┐
│  阶段 1：日常开发（Linux 服务器上）                           │
├─────────────────────────────────────────────────────────────┤
│  1. Windows VDI → SSH 到 Linux                              │
│  2. Linux 上：go build + npm run dev                        │
│  3. Windows 浏览器访问 http://<linux-ip>:18000              │
│  4. AI（Kimi CLI）直接操作 Linux 代码                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  阶段 2：功能测试（Windows 浏览器验证）                      │
├─────────────────────────────────────────────────────────────┤
│  1. Windows 浏览器打开 http://<linux-ip>:18000              │
│  2. 测试变量筛选、多集群切换等功能                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  阶段 3：打包部署                                            │
├─────────────────────────────────────────────────────────────┤
│  1. Linux 上：go build + npm run build                      │
│  2. 执行 install.sh 或手动部署到 /opt/cloudops              │
│  3. systemctl restart nginx + cloudops-backend              │
└─────────────────────────────────────────────────────────────┘
```

---

## 网络环境速查

| 检查项 | Windows VDI | Linux 服务器 |
|--------|------------|-------------|
| 能否访问互联网 | ✅ | 无需 |
| 能否访问 npm registry | ✅ | 无需 |
| 能否访问 GitHub | 视公司策略 | 无需 |
| 能否访问 Linux :9000 | `curl http://<linux-ip>:9000/health` | `curl localhost:9000/health` |
| 能否访问 Linux :18000 | `curl http://<linux-ip>:18000` | `curl localhost:18000` |
| 能否访问 Linux :5432 | `psql -h <linux-ip> -U cloudops` | `psql -h localhost -U cloudops` |
| 能否访问 Linux :6379 | `redis-cli -h <linux-ip> ping` | `redis-cli ping` |

---

## 常见问题

**Q：Windows 上无法 `npm install` 怎么办？**
> A：在能联网的机器上 `npm install`，打包 `node_modules` + `package.json` 复制到 Windows。或配置公司内部 npm 镜像：`npm config set registry http://公司内部镜像`。

**Q：后端连不上 Linux 上的 PostgreSQL？**
> A：检查三处：
> 1. `config.yaml` 中 `database.host` 是否为 Linux IP
> 2. Linux 上 `postgresql.conf` 的 `listen_addresses = '*'`
> 3. Linux 上 `pg_hba.conf` 允许 Windows IP 段访问

**Q：前端 proxy 连不上后端？**
> A：修改 `frontend/vite.config.ts` 中 proxy target 为 Linux IP:9000，重启 `npm run dev`。
