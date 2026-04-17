# CloudOps 实际部署操作记录

> 记录时间：2026-04-17
> 部署环境：Ubuntu 22.04 LTS (x86_64)
> 部署目标：内网私有化部署（含离线包制作）
> 执行者：Kimi Code CLI

---

## 一、环境准备

### 1.1 系统信息

```bash
cat /etc/os-release
# PRETTY_NAME="Ubuntu 22.04.5 LTS"
```

### 1.2 安装系统级依赖

```bash
# 更新软件源
apt-get update

# 安装 PostgreSQL（Ubuntu 22.04 默认源为 postgresql-14，与 15 功能兼容）
apt-get install -y postgresql-14 redis-server

# 启动服务
systemctl start postgresql
systemctl start redis-server
```

> **注意**：Ubuntu 22.04 官方源没有 `postgresql-15`，使用 `postgresql-14` 完全兼容本项目。

### 1.3 安装 Go 1.25

```bash
# 检查本地已有 Go（/usr/local/go/bin/go 为 1.23.4）
/usr/local/go/bin/go version

# 通过国内代理自动下载 Go 1.25 toolchain
export GOTOOLCHAIN=auto
export GOPROXY=https://goproxy.cn,direct
/usr/local/go/bin/go version
# 输出：go version go1.25.0 linux/amd64
```

> Go 1.25 尚未正式发布，但通过 `goproxy.cn` 可以正常下载 toolchain。

---

## 二、数据库初始化

### 2.1 创建数据库和用户

```bash
sudo -u postgres psql -c "CREATE USER cloudops WITH PASSWORD 'cloudops123';"
sudo -u postgres psql -c "CREATE DATABASE cloudops OWNER cloudops;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE cloudops TO cloudops;"
sudo -u postgres psql -d cloudops -c "GRANT ALL ON SCHEMA public TO cloudops;"
```

### 2.2 验证数据库

```bash
sudo -u postgres psql -d cloudops -c "\dt"
# 首次后端启动后会自动创建 22+ 张表
```

---

## 三、项目配置修改

### 3.1 修改 `config/config.yaml`

```yaml
database:
  postgres:
    host: "127.0.0.1"      # 改为本地回环地址
    port: 5432
    database: "cloudops"
    username: "cloudops"
    password: "cloudops123"
    ssl_mode: "disable"
  redis:
    host: "127.0.0.1"      # 改为本地回环地址
```

### 3.2 Web 终端安全修复

**修改文件**：`internal/api/handlers/terminal.go`

修复内容：
1. 添加 `crypto/rand` 和 `encoding/hex` 导入
2. 新增 `generateSessionID()` 函数，使用随机数 + 时间戳生成唯一沙盒目录
3. 将 `os.Getpid()` 替换为 `generateSessionID()`，避免同进程多会话冲突
4. 添加 Linux Namespace 隔离：`CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWUSER | CLONE_NEWIPC`
5. 移除 `/proc` 挂载，消除 `/proc/1/root` 逃逸通道
6. 移除 `mknod` 创建设备，改为 bind-mount 已知安全的字符设备
7. 系统目录以 `MS_RDONLY | MS_NOSUID | MS_NODEV` 只读挂载
8. 修复 `cleanupSandboxMounts`，按正确顺序卸载所有挂载点（先子后父）

**修改文件**：`internal/service/network_trace_service.go`

修复内容：
1. 添加 `regexp` 导入
2. 新增 `defaultDebugCommand` 常量
3. 新增 `validateDebugCommand()` 函数：
   - 空命令直接放行（使用后端默认命令）
   - 匹配默认命令直接放行
   - 禁止 `;`、`&&`、`|`、`$()`、`>` 等危险 shell 元字符
   - 白名单机制：只允许 `tcpdump`、`ping`、`curl` 等网络诊断工具
   - 禁止非标准路径下的绝对路径执行
4. `CreateEphemeralDebug` 中调用 `validateDebugCommand()` 进行命令校验

---

## 四、编译构建

### 4.1 后端编译

```bash
# 设置国内代理
export GOTOOLCHAIN=auto
export GOPROXY=https://goproxy.cn,direct

# 修复 go.sum（k8s.io 模块 checksum 不匹配，使用 go mod tidy 重新计算）
go mod tidy

# 编译
# 注意：go.mod 中声明 go 1.25.0，与本地自动下载的 toolchain 一致
go build -o cloudops-backend ./cmd/server
```

**编译输出**：`cloudops-backend`（56MB 静态链接二进制）

### 4.2 Agent Runtime 编译

```bash
cd agent-runtime
npm install
npm run build
```

**输出**：`agent-runtime/dist/server.js`

### 4.3 前端编译

```bash
cd frontend

# 首次 npm install 后 typescript 包异常，vite/tsc 找不到模块
# 解决：删除 node_modules 后使用国内镜像重新安装
rm -rf node_modules package-lock.json
npm install --registry=https://registry.npmmirror.com

# 构建
npm run build
```

**输出**：`frontend/dist/`（包含 index.html 和 assets）

---

## 五、启动服务

### 5.1 启动后端

```bash
cd /data/projects/cloudops-v2

export CONFIG_PATH=/data/projects/cloudops-v2/config/config.yaml
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export GIN_MODE=release

nohup ./cloudops-backend > backend.log 2>&1 &
```

**验证**：
```bash
curl http://127.0.0.1:9000/health
# {"status":"healthy","version":"2.0.0"}
```

**后端启动日志关键节点**：
- ✅ 数据库初始化完成（自动迁移 22+ 张表）
- ✅ 默认租户 `default` 创建
- ✅ 默认管理员 `admin/admin` 创建
- ✅ Redis 连接成功
- ✅ Agent Runtime 自动启动在 http://127.0.0.1:19000

### 5.2 启动 Agent Runtime（也可由后端自动启动）

```bash
cd agent-runtime
nohup node dist/server.js --port 19000 > agent-runtime.log 2>&1 &
```

### 5.3 启动前端

```bash
cd frontend
nohup npx vite preview --port 18000 --host > frontend.log 2>&1 &
```

**验证**：
```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18000
# 200
```

---

## 六、离线部署包制作

### 6.1 打包结构

```bash
mkdir -p offline-package/{bin,frontend,agent-runtime,config}

cp cloudops-backend offline-package/bin/
cp -r frontend/dist offline-package/frontend/
cp -r agent-runtime/dist offline-package/agent-runtime/
cp agent-runtime/package.json offline-package/agent-runtime/
cp agent-runtime/package-lock.json offline-package/agent-runtime/
cp -r agent-runtime/node_modules offline-package/agent-runtime/    # 211MB，离线必需
cp config/config.yaml offline-package/config/
```

### 6.2 添加启动脚本

**`start-all.sh`**：
```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export CONFIG_PATH="$SCRIPT_DIR/config/config.yaml"
export JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
export GIN_MODE=release

nohup ./bin/cloudops-backend > backend.log 2>&1 &
sleep 3
curl -s http://127.0.0.1:9000/health >/dev/null && echo "Backend OK"

nohup node agent-runtime/dist/server.js --port 19000 > agent-runtime.log 2>&1 &

nohup npx --yes vite preview --port 18000 --host > frontend.log 2>&1 &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18000 | grep -q 200 && echo "Frontend OK"
```

**`stop-all.sh`**：
```bash
#!/bin/bash
pkill -f "cloudops-backend" || true
pkill -f "agent-runtime/dist/server.js" || true
pkill -f "vite preview" || true
```

### 6.3 最终包大小

```
offline-package/
├── bin/              56 MB   (cloudops-backend)
├── frontend/         3.9 MB  (dist 静态文件)
├── agent-runtime/    211 MB  (dist + node_modules)
├── config/           8 KB    (config.yaml)
├── start-all.sh      4 KB
├── stop-all.sh       4 KB
└── README-DEPLOY.md  4 KB

总计：270 MB
```

---

## 七、遇到的问题与解决方案

### 问题 1：Go 1.25 toolchain 下载

**现象**：`go build` 报错 `golang.org/toolchain@v0.0.1-go1.25.0.linux-amd64.zip: connection refused`

**原因**：默认代理 `proxy.golang.org` 无法访问

**解决**：设置国内代理 `export GOPROXY=https://goproxy.cn,direct`，Go 自动下载 toolchain

### 问题 2：k8s.io 模块 checksum 不匹配

**现象**：`verifying k8s.io/api@v0.35.3/go.mod: checksum mismatch`

**原因**：之前手动修改过 cache 中的 go.mod，与 go.sum 记录不符

**解决**：
```bash
rm -rf /root/go/pkg/mod/cache/download/k8s.io/*
rm -rf /root/go/pkg/mod/k8s.io/*
git checkout go.sum
go mod tidy
```

### 问题 3：`uint32(os.Getuid())` 类型错误

**现象**：`cannot use uint32(os.Getuid()) (value of type uint32) as int value in struct literal`

**原因**：Go 1.25 中 `syscall.SysProcIDMap.HostID` 类型变为 `int`

**解决**：移除 `uint32()` 转换，直接使用 `os.Getuid()` 和 `os.Getgid()`

### 问题 4：前端 `tsc` 找不到模块

**现象**：`Error: Cannot find module '../lib/tsc.js'`

**原因**：`node_modules/typescript` 软链接损坏或安装不完整

**解决**：
```bash
rm -rf node_modules package-lock.json
npm install --registry=https://registry.npmmirror.com
```

### 问题 5：vite 找不到模块

**现象**：`Cannot find module '../lib/tsc.js' imported from node_modules/.bin/vite`

**原因**：vite 的 bin 链接指向错误

**解决**：重新完整安装 `node_modules`

---

## 八、服务访问地址

| 服务 | URL | 说明 |
|------|-----|------|
| 前端 | http://<服务器IP>:18000 | 浏览器直接访问 |
| 后端 API | http://<服务器IP>:9000 | 健康检查 /health |
| Agent | http://127.0.0.1:19000 | 仅本地访问 |

**默认账号**：`admin / admin`

**首次登录后务必**：
1. 修改 admin 密码
2. 配置 JWT_SECRET 和 ENCRYPTION_KEY 为强随机字符串
3. 添加第一个 K8s 集群

---

## 九、后续开发建议

1. **不要用 root 运行后端**，创建普通用户 `cloudops`
2. **Web 终端** 即使已修复，仍建议仅给受信任用户分配 `terminal:use` 权限
3. **生产环境** 使用 Nginx 反代前端，配置 HTTPS
4. **AI 功能** 如需离线使用，内网部署 Ollama 并修改 `config.yaml` 关闭 OpenClaw
5. **数据库备份**：定期 `pg_dump cloudops > backup.sql`

---

## 十、文件修改清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `docs/DEPLOYMENT.md` | 新增 | 通用部署指南（26KB） |
| `docs/DEPLOYMENT-RECORD.md` | 新增 | 本文件，实操记录 |
| `internal/api/handlers/terminal.go` | 安全修复 | namespace 隔离、唯一会话 ID、移除 proc/mknod、修复清理 |
| `internal/service/network_trace_service.go` | 安全修复 | 命令注入防护 `validateDebugCommand()` |
| `config/config.yaml` | 配置修改 | host 改为 127.0.0.1 |
| `go.mod` | 版本调整 | go 1.25.0（使用 goproxy.cn 自动下载） |
| `go.sum` | 自动更新 | `go mod tidy` 重新计算 |

---

> 文档版本：v1.0
> 最后更新：2026-04-17
