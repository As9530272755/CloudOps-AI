# CloudOps 离线环境一键安装文档

> 本文档面向需要在**完全无互联网访问**的私有化/内网环境中部署 CloudOps 的运维人员。

---

## 一、方案概述

本方案提供**一键安装脚本**，自动完成以下全部步骤：

- 安装系统依赖（PostgreSQL / Redis / Node.js）
- 初始化数据库（自动创建用户、数据库、授权）
- 部署后端、前端、Agent Runtime
- 生成安全密钥（JWT + AES）
- 创建 systemd 服务（开机自启、故障重启）
- 启动并验证所有服务

**支持两种部署模式**：

| 模式 | 数据库 | 缓存 | 资源要求 | 适用场景 |
|------|--------|------|----------|----------|
| **full（默认）** | PostgreSQL 14+ | Redis 6+ | 4C8G+ | 生产环境 |
| **lite** | SQLite（内置） | 内存 sync.Map | 2C4G+ | POC / 测试 / 小团队 |

---

## 二、环境要求

### 2.1 硬件要求

| 项目 | full 模式 | lite 模式 |
|------|-----------|-----------|
| CPU | x86_64，≥ 4 核 | x86_64，≥ 2 核 |
| 内存 | ≥ 8GB | ≥ 4GB |
| 磁盘 | ≥ 20GB 可用空间 | ≥ 10GB 可用空间 |

### 2.2 操作系统支持

- **Ubuntu 20.04 / 22.04 / 24.04**
- **CentOS 7 / 8**
- **Rocky Linux 8 / 9**
- **RHEL 8 / 9**
- **Debian 11 / 12**

> 当前仅支持 `x86_64` (amd64) 架构。

---

## 三、安装前准备

### 3.1 在联网机器上预打包依赖

在可访问互联网的机器上（与目标服务器 CPU 架构一致），进入项目目录执行：

```bash
cd /data/projects/cloudops-v2

# Ubuntu 系统
./scripts/prepare-deps.sh --os ubuntu

# CentOS/RHEL/Rocky 系统
./scripts/prepare-deps.sh --os centos
```

**`prepare-deps.sh` 会自动下载**：

| 依赖 | 来源 | 说明 |
|------|------|------|
| PostgreSQL | 系统源 (`apt-get download` / `yumdownloader`) | 含所有递归依赖 |
| Redis | 系统源 | 含所有递归依赖 |
| Node.js | nodejs.org 官方预编译二进制 | 跨发行版通用，不依赖 apt/yum |

下载完成后，依赖包存放在 `deps/` 目录下。

### 3.2 编译构建产物

在同一台联网机器上：

```bash
cd /data/projects/cloudops-v2

# 编译后端
export GOTOOLCHAIN=auto
export GOPROXY=https://goproxy.cn,direct
go build -o bin/cloudops-backend ./cmd/server

# 构建前端
cd frontend
npm install --registry=https://registry.npmmirror.com
npm run build
cd ..

# 构建 Agent Runtime
cd agent-runtime
npm install
npm run build
cd ..
```

### 3.3 打包完整离线包

```bash
cd /data/projects/cloudops-v2

tar czf cloudops-offline-package.tar.gz \
  scripts/install.sh \
  scripts/uninstall.sh \
  scripts/prepare-deps.sh \
  bin/cloudops-backend \
  frontend/dist/ \
  agent-runtime/dist/ \
  agent-runtime/node_modules/ \
  agent-runtime/package.json \
  agent-runtime/package-lock.json \
  config/config.yaml.template \
  systemd/ \
  deps/ \
  README-OFFLINE.md \
  docs/install-offline.md
```

> **包大小预估**：约 300~400MB（主要包含 agent-runtime/node_modules ~210MB + 后端二进制 ~56MB）

### 3.4 复制到离线服务器

```bash
scp cloudops-offline-package.tar.gz root@<离线服务器IP>:/opt/
```

---

## 四、离线服务器安装步骤

### 4.1 解压离线包

```bash
ssh root@<离线服务器IP>
cd /opt
tar xzf cloudops-offline-package.tar.gz
cd cloudops-offline-package
chmod +x scripts/*.sh
```

### 4.2 执行一键安装

```bash
# 全功能模式（推荐生产环境）
./scripts/install.sh --mode full --yes

# 或指定数据库密码
./scripts/install.sh --mode full --db-password MySecurePwd123 --yes

# 轻量模式（零外部数据库依赖）
./scripts/install.sh --mode lite --yes
```

#### 安装参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--mode <full\|lite>` | 部署模式 | `full` |
| `--install-dir <dir>` | 安装目录 | `/opt/cloudops` |
| `--db-password <pwd>` | 数据库密码 | 自动生成（16位随机字符串） |
| `--db-host <host>` | PostgreSQL 地址 | `127.0.0.1` |
| `--db-port <port>` | PostgreSQL 端口 | `5432` |
| `--db-name <name>` | 数据库名 | `cloudops` |
| `--db-user <user>` | 数据库用户 | `cloudops` |
| `--redis-host <host>` | Redis 地址 | `127.0.0.1` |
| `--redis-port <port>` | Redis 端口 | `6379` |
| `--jwt-secret <secret>` | JWT 密钥 | 自动生成（64位hex） |
| `--encryption-key <key>` | AES 加密密钥 | 自动生成（64位hex） |
| `--frontend-port <port>` | 前端端口 | `18000` |
| `--backend-port <port>` | 后端端口 | `9000` |
| `-y, --yes` | 自动确认，无需交互 | 否 |

### 4.3 安装过程说明

脚本会依次执行以下 **8 个步骤**：

1. **安装系统依赖**：dpkg/rpm 安装 PostgreSQL、Redis；解压 Node.js 预编译二进制到 `/opt/cloudops/runtime/`
2. **初始化数据库**：创建 `cloudops` 用户和数据库，授权 `ALL PRIVILEGES`
3. **创建运行用户**：`useradd cloudops`（非 root 运行，安全最佳实践）
4. **部署应用文件**：复制后端二进制、前端 dist、Agent Runtime 到安装目录
5. **生成配置文件**：基于模板自动生成 `config.yaml`，填充数据库密码、JWT 密钥、AES 密钥
6. **创建 systemd 服务**：`cloudops-backend`、`cloudops-agent`、`cloudops-frontend`
7. **设置文件权限**：`chown -R cloudops:cloudops /opt/cloudops`
8. **启动服务**：systemctl start，并执行健康检查

### 4.4 安装完成输出示例

```
[INFO] CloudOps 安装完成！
[INFO] ========================================================

访问地址:
  前端页面: http://<服务器IP>:18000
  后端 API: http://<服务器IP>:9000
  健康检查: http://127.0.0.1:9000/health

默认账号:
  用户名: admin
  密码:   admin

数据库信息:
  地址: 127.0.0.1:5432
  数据库: cloudops
  用户: cloudops
  密码: <自动生成的密码>

安装目录: /opt/cloudops
配置文件: /opt/cloudops/config/config.yaml
环境变量: /opt/cloudops/.env

服务管理:
  启动: systemctl start cloudops-backend cloudops-agent cloudops-frontend
  停止: systemctl stop cloudops-backend cloudops-agent cloudops-frontend
  状态: systemctl status cloudops-backend
  日志: journalctl -u cloudops-backend -f

安全提醒:
  1. 首次登录后请立即修改 admin 密码
  2. 请妥善保管 /opt/cloudops/.env 中的密钥信息
  3. 生产环境建议配置 HTTPS 和防火墙规则
```

---

## 五、服务管理

### 5.1 启动 / 停止 / 重启

```bash
# 启动所有服务
systemctl start cloudops-backend cloudops-agent cloudops-frontend

# 停止所有服务
systemctl stop cloudops-backend cloudops-agent cloudops-frontend

# 重启后端
systemctl restart cloudops-backend

# 查看状态
systemctl status cloudops-backend
systemctl status cloudops-agent
systemctl status cloudops-frontend
```

### 5.2 查看日志

```bash
# 实时跟踪后端日志
journalctl -u cloudops-backend -f

# 查看最近 100 行
journalctl -u cloudops-backend -n 100

# 查看前端日志
journalctl -u cloudops-frontend -f

# 查看 Agent 日志
journalctl -u cloudops-agent -f
```

### 5.3 开机自启

安装脚本已自动执行：
```bash
systemctl enable cloudops-backend
systemctl enable cloudops-agent
systemctl enable cloudops-frontend
```

---

## 六、两种模式详解

### 6.1 full 模式（推荐生产环境）

**架构**：PostgreSQL + Redis + CloudOps Backend + Agent Runtime + Frontend

**特点**：
- 数据库使用 PostgreSQL，支持高并发、事务完整
- Redis 缓存 AI 任务状态，提升异步任务性能
- 适合多用户、高并发的生产环境

**端口占用**：
| 服务 | 端口 | 说明 |
|------|------|------|
| CloudOps Backend | 9000 | Go 后端 API |
| CloudOps Frontend | 18000 | 前端页面 |
| Agent Runtime | 19000 | Node.js AI Agent |
| PostgreSQL | 5432 | 主数据库 |
| Redis | 6379 | 缓存 |

### 6.2 lite 模式（轻量快速）

**架构**：SQLite（内置）+ CloudOps Backend + Agent Runtime + Frontend

**特点**：
- 零外部数据库依赖，无需安装 PostgreSQL/Redis
- SQLite 数据库文件位于 `/opt/cloudops/cloudops.db`
- AI 任务状态使用内存 `sync.Map`（重启后丢失未完成任务）
- 适合快速体验、POC 验证、小团队（< 10人）

**端口占用**：
| 服务 | 端口 | 说明 |
|------|------|------|
| CloudOps Backend | 9000 | Go 后端 API |
| CloudOps Frontend | 18000 | 前端页面 |
| Agent Runtime | 19000 | Node.js AI Agent |

---

## 七、卸载

如需完全卸载 CloudOps：

```bash
cd /opt/cloudops-offline-package
./scripts/uninstall.sh
```

卸载脚本会：
1. 停止并禁用所有 systemd 服务
2. 删除安装目录 `/opt/cloudops`
3. 删除日志目录 `/var/log/cloudops`
4. 可选：删除 PostgreSQL 数据库和用户
5. 可选：删除系统用户 `cloudops`

---

## 八、常见问题

### Q1：安装脚本报 "未找到 Node.js 预编译包"

**原因**：`deps/nodejs/` 目录下缺少 Node.js tarball。

**解决**：在联网机器上重新执行 `./scripts/prepare-deps.sh --os <ubuntu|centos>`，确认 `deps/nodejs/` 下存在 `node-v*-linux-x64.tar.xz`。

### Q2：PostgreSQL 安装失败

**原因**：离线包中缺少某些系统依赖。

**解决**：
- 在联网机器上重新执行 `prepare-deps.sh`，确保所有递归依赖都被下载
- 或在目标服务器上临时配置内网 yum/apt 源

### Q3：后端启动报错 "连接数据库失败"

**排查步骤**：
```bash
# 1. 检查 PostgreSQL 是否运行
systemctl status postgresql

# 2. 检查数据库是否存在
sudo -u postgres psql -c "\l" | grep cloudops

# 3. 检查用户权限
sudo -u postgres psql -d cloudops -c "\du" | grep cloudops

# 4. 检查配置文件中的密码
cat /opt/cloudops/config/config.yaml | grep password

# 5. 查看后端日志
journalctl -u cloudops-backend -f
```

### Q4：前端页面空白

**排查步骤**：
```bash
# 1. 检查前端服务是否运行
systemctl status cloudops-frontend
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18000

# 2. 检查前端 dist 目录是否存在
ls -la /opt/cloudops/frontend/dist/

# 3. 查看前端日志
journalctl -u cloudops-frontend -f
```

### Q5：如何修改配置？

```bash
# 编辑配置文件
vim /opt/cloudops/config/config.yaml

# 重启后端使配置生效
systemctl restart cloudops-backend
```

### Q6：如何查看自动生成的密钥？

```bash
# 查看环境变量文件（权限 600）
cat /opt/cloudops/.env
```

> ⚠️ **注意**：`.env` 文件包含敏感信息，请勿泄露。

---

## 九、安全建议

1. **首次登录后立即修改 `admin` 密码**（默认 `admin/admin`）
2. **妥善保管 `/opt/cloudops/.env`** 中的 `JWT_SECRET` 和 `ENCRYPTION_KEY`
3. **配置防火墙**：仅开放必要的端口（18000、9000）
4. **生产环境配置 HTTPS**：可通过 Nginx 反向代理并配置 SSL 证书
5. **定期备份**：
   - full 模式：`pg_dump cloudops > backup-$(date +%F).sql`
   - lite 模式：备份 `/opt/cloudops/cloudops.db` 文件

---

## 十、技术细节

### 10.1 Node.js 跨发行版兼容方案

不通过 `apt`/`yum` 安装 Node.js，而是使用 nodejs.org 官方预编译二进制：
- 下载 `node-v22.14.0-linux-x64.tar.xz`
- 解压到 `/opt/cloudops/runtime/node-v22.14.0-linux-x64/`
- 创建软链接 `/usr/local/bin/node` → 解压后的二进制

**优势**：
- 不受目标服务器系统源限制
- 兼容所有 Linux 发行版
- 无需处理复杂的 RPM/DEB 依赖链

### 10.2 前端托管方式

前端不依赖 Nginx，直接使用 `npx vite preview --port 18000 --host`：
- 由 systemd 管理，开机自启
- 支持 HMR 热更新（开发调试时）
- 零额外软件依赖

如需使用 Nginx（生产环境推荐），可参考 `systemd/cloudops-frontend.service` 自行替换为 Nginx 配置。

### 10.3 运行用户隔离

后端、前端、Agent Runtime 均以专用用户 `cloudops` 运行：
- `useradd -r -s /bin/false cloudops`
- 非 root 权限，降低安全风险
- 沙盒终端功能即使存在逃逸，也无法破坏系统关键文件

---

> 文档版本：v1.0
> 最后更新：2026-04-17
