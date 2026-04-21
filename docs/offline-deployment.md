# CloudOps Platform v2.0 离线部署指南

> 本文档面向无互联网访问的私有化/内网环境，说明如何在离线服务器上完成 CloudOps Platform 的全量部署。

---

## 一、部署架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      离线服务器（单台或多台）                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  CloudOps    │  │  PostgreSQL  │  │  Redis（可选）   │  │
│  │  Backend     │  │  15+         │  │  7+              │  │
│  │  :9000       │  │  :5432       │  │  :6379           │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │  Vite/Nginx  │  │  Agent       │                        │
│  │  Frontend    │  │  Runtime     │                        │
│  │  :18000      │  │  :19000      │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

**说明**：
- 后端 `cloudops-backend` 是单一静态二进制，无外部 Go 模块依赖。
- 前端 `frontend/dist/` 是纯静态文件，可用 Nginx/Vite preview/任意 Web Server 托管。
- AI 推理如需完全离线，需在内网部署 **Ollama**；如内网可访问外部 OpenClaw，则只需配置地址。

---

## 二、两种部署模式

| 模式 | 数据库 | 缓存 | 适用场景 | 资源要求 |
|---|---|---|---|---|
| **全功能模式** | PostgreSQL 15+ | Redis 7+ | 生产环境、多用户、AI 任务轮询 | 4C8G+ |

---

## 三、准备离线安装包（在有网的机器上执行）

### 3.1 打包清单

在开发/编译机上准备好以下文件，统一放入 `cloudops-offline-package/` 目录：

```
cloudops-offline-package/
├── bin/
│   └── cloudops-backend              # 编译好的 Linux 二进制（见 3.2）
├── frontend/
│   └── dist/                         # npm run build 产物（见 3.3）
├── config/
│   └── config.yaml                   # 根据离线环境修改后的配置
├── scripts/
│   ├── install.sh                    # 一键安装脚本（可选）
│   ├── start-all.sh
│   └── stop-all.sh
└── dependencies/                     # 操作系统级依赖离线包
    ├── postgresql15-xxx.rpm          # CentOS/RHEL 系
    ├── postgresql15-server-xxx.rpm
    ├── redis-7.xxx.rpm
    └── nodejs-18.xxx.rpm
```

### 3.2 编译后端二进制

**编译机环境**：Go 1.21+，与目标服务器 CPU 架构一致（通常为 `linux/amd64`）

```bash
cd /data/projects/cloudops-v2

# 如编译机与目标机架构不同，设置交叉编译变量
export GOOS=linux
export GOARCH=amd64
export CGO_ENABLED=0

# 编译静态链接二进制
go build -ldflags="-s -w" -o cloudops-backend ./cmd/server

# 验证
cp cloudops-backend cloudops-offline-package/bin/
```

> `CGO_ENABLED=0` 确保二进制不依赖系统 glibc 版本，兼容性更好。

### 3.3 构建前端静态文件

```bash
cd /data/projects/cloudops-v2/frontend
npm install
npm run build

cp -r dist/ ../cloudops-offline-package/frontend/
```

### 3.5 准备数据库与缓存的离线安装包

#### CentOS / RHEL / Rocky Linux（RPM 系）

在有 yum 源的服务器上下载 RPM 包：

```bash
mkdir -p /tmp/offline-deps && cd /tmp/offline-deps

# PostgreSQL 15（以 PGDG 源为例）
yumdownloader --resolve postgresql15 postgresql15-server postgresql15-contrib

# Redis 7
yumdownloader --resolve redis

# Node.js 18（来自 EPEL 或 NodeSource）
yumdownloader --resolve nodejs

cp *.rpm /path/to/cloudops-offline-package/dependencies/
```

#### Ubuntu / Debian（DEB 系）

```bash
mkdir -p /tmp/offline-deps && cd /tmp/offline-deps

# PostgreSQL 15
apt-get download $(apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances postgresql-15 | grep "^\w" | sort -u)

# Redis
apt-get download $(apt-cache depends --recurse --no-recommends redis-server | grep "^\w" | sort -u)

# Node.js 18
apt-get download $(apt-cache depends --recurse --no-recommends nodejs | grep "^\w" | sort -u)

cp *.deb /path/to/cloudops-offline-package/dependencies/
```

### 3.6 准备配置文件模板

复制一份根据离线环境调整好的 `config.yaml` 到安装包中（详见第四节）。

---

## 四、离线环境配置文件修改

编辑 `config/config.yaml` 中的以下关键项：

```yaml
server:
  backend:
    host: "0.0.0.0"
    port: 9000
    mode: "release"          # 生产环境请改为 release
    read_timeout: 60s
    write_timeout: 600s

  frontend:
    host: "0.0.0.0"
    port: 18000

database:
  postgres:
    host: "127.0.0.1"        # 改为内网 PostgreSQL 地址
    port: 5432
    database: "cloudops"
    username: "cloudops"
    password: "${DB_PASSWORD}"  # 建议使用环境变量注入，避免明文
    ssl_mode: "disable"
    max_connections: 100
    max_idle: 10

  redis:
    host: "127.0.0.1"        # 改为内网 Redis 地址；如不用 Redis 可删除或留空
    port: 6379
    password: "${REDIS_PASSWORD}"
    db: 0
    pool_size: 100

ai:
  openclaw:
    enabled: false           # 离线环境如没有 OpenClaw，请关闭

security:
  jwt:
    secret: "${JWT_SECRET}"  # 必须通过环境变量注入，每次部署应不同
    access_expire: 1h
    refresh_expire: 24h

  encryption:
    key: "${ENCRYPTION_KEY}" # 32 字节 AES 密钥，必须通过环境变量注入
```

---

## 五、目标服务器安装步骤

### 5.1 环境要求

- **OS**：CentOS 7/8、Rocky Linux 8/9、Ubuntu 20.04/22.04
- **CPU**：x86_64
- **内存**：全功能模式 ≥ 8GB，轻量模式 ≥ 4GB
- **磁盘**：≥ 20GB 可用空间
- **网络**：内网互通，无需互联网

### 5.2 安装系统依赖

将 `cloudops-offline-package` 复制到目标服务器，例如 `/opt/cloudops/`。

#### RPM 系

```bash
cd /opt/cloudops/dependencies
rpm -ivh *.rpm --nodeps

# 初始化 PostgreSQL
/usr/pgsql-15/bin/postgresql-15-setup initdb
systemctl enable postgresql-15
systemctl start postgresql-15

# 初始化 Redis
systemctl enable redis
systemctl start redis
```

#### DEB 系

```bash
cd /opt/cloudops/dependencies
dpkg -i *.deb || apt-get install -f -y

# 初始化 PostgreSQL
pg_createcluster 15 main --start
systemctl enable postgresql

# 初始化 Redis
systemctl enable redis-server
systemctl start redis-server
```

### 5.3 创建数据库与用户

```bash
# 创建数据库和用户
sudo -u postgres psql <<EOF
CREATE USER cloudops WITH PASSWORD 'YourStrongPassword';
CREATE DATABASE cloudops OWNER cloudops;
GRANT ALL PRIVILEGES ON DATABASE cloudops TO cloudops;
EOF
```

### 5.4 部署应用文件

```bash
mkdir -p /opt/cloudops/app
cp /opt/cloudops/bin/cloudops-backend /opt/cloudops/app/
cp -r /opt/cloudops/frontend/dist /opt/cloudops/app/frontend
cp /opt/cloudops/config/config.yaml /opt/cloudops/app/
```

### 5.5 设置环境变量（建议写入 `/etc/cloudops/env`）

```bash
mkdir -p /etc/cloudops
cat > /etc/cloudops/env << 'EOF'
export CONFIG_PATH=/opt/cloudops/app/config.yaml
export DB_PASSWORD=YourStrongPassword
export REDIS_PASSWORD=YourRedisPassword
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export OPENCLAW_URL=http://127.0.0.1:8080
EOF

chmod 600 /etc/cloudops/env
```

> **安全提醒**：`JWT_SECRET` 和 `ENCRYPTION_KEY` 每次部署必须重新生成，且不可泄露。

---

## 六、启动服务

### 6.1 启动后端

```bash
source /etc/cloudops/env
cd /opt/cloudops/app
nohup ./cloudops-backend > backend.log 2>&1 &
```

验证：

```bash
curl http://127.0.0.1:9000/health
# 预期返回 {"status":"healthy","version":"2.0.0"}
```

### 6.2 启动前端

**方式 A：使用 Vite preview（最简单）**

```bash
cd /opt/cloudops/app/frontend/dist
# 需要 Node.js 已安装
nohup npx vite preview --port 18000 --host > frontend.log 2>&1 &
```

**方式 B：使用 Nginx（推荐生产环境）**

```nginx
server {
    listen 18000;
    server_name localhost;
    root /opt/cloudops/app/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/v1 {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /uploads {
        proxy_pass http://127.0.0.1:9000;
    }
}
```

### 6.4 启动顺序总结

1. PostgreSQL
2. Redis（如使用）
3. CloudOps Backend（:9000）
4. Frontend（:18000）

---

## 七、一键启停脚本（可选）

### `start-all.sh`

```bash
#!/bin/bash
source /etc/cloudops/env

echo "Starting PostgreSQL..."
systemctl start postgresql-15

echo "Starting Redis..."
systemctl start redis

echo "Starting CloudOps Backend..."
cd /opt/cloudops/app
nohup ./cloudops-backend > backend.log 2>&1 &
sleep 2

echo "Starting Frontend..."
cd /opt/cloudops/app/frontend/dist
nohup npx vite preview --port 18000 --host > frontend.log 2>&1 &

echo "All services started."
```

### `stop-all.sh`

```bash
#!/bin/bash
pkill -f "cloudops-backend"
pkill -f "vite preview"
systemctl stop redis
systemctl stop postgresql-15
echo "All services stopped."
```

---

## 八、离线环境 AI 配置

### 8.1 完全离线（内网 Ollama）

在离线服务器或同网段另一台机器上部署 Ollama，加载所需模型：

```bash
# 在有网机器上下载 ollama 安装包和模型权重，再复制到离线环境
# 模型文件默认路径：~/.ollama/models/
```

然后修改 `config.yaml`：

```yaml
ai:
  openclaw:
    enabled: false
```

并在前端「系统设置 → AI 平台」中添加 Ollama 平台：
- 类型：`ollama`
- URL：`http://192.168.x.x:11434`
- 模型：`qwen3.5:397b-cloud`（或你预加载的模型名）

### 8.2 半离线（内网可访问 OpenClaw）

修改 `config.yaml`：

```yaml
ai:
  openclaw:
    enabled: true
    api_url: "http://your-openclaw-internal-ip:8080"
    api_key: "your-internal-key"
```

---

## 九、验证清单

| 检查项 | 验证命令 / 操作 |
|---|---|
| 后端健康 | `curl http://127.0.0.1:9000/health` |
| 前端可访问 | 浏览器打开 `http://<服务器IP>:18000` |
| 登录功能 | 使用 `admin / admin` 登录 |
| 集群列表 | 添加第一个 K8s 集群，确认能拉取 Namespace |
| 全局资源搜索 | 在「集群管理」页面输入关键词，能看到跨集群资源 |
| 日志查询 | 配置日志后端后，确认能查询到日志 |
| AI 对话 | 发送一条消息，确认模型有返回 |

---

## 十、常见问题

### Q1：启动后端报错 `连接数据库失败`
- 检查 PostgreSQL 是否已启动
- 检查 `config.yaml` 中的 `host/port/password` 是否正确
- 检查防火墙是否放行了 5432 端口

### Q2：前端页面空白，只有标题
- 确认 `frontend/dist/` 目录存在且包含 `index.html`
- 确认前端服务端口 18000 未被占用
- 如用 Nginx，检查 `try_files` 配置是否正确

### Q4：如何升级到新版本？
1. 停止所有服务
2. 备份 `config.yaml` 和数据库
3. 替换新的 `cloudops-backend`、`frontend/dist`
4. 如数据库模型有变更，后端启动时会自动 `AutoMigrate`
5. 重新启动服务


