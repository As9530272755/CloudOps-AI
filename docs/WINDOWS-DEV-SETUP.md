# Windows VDI 全栈开发部署方案

> 目标：Kimi Code CLI + 代码 + 编译 全部在 Windows VDI 上，数据库连远程 Linux。

---

## 一、能否把 Kimi Code CLI 部署到 Windows？

**可以。** Kimi Code CLI 是跨平台的 Python 工具，支持 Windows。

### 安装步骤（Windows VDI）

```powershell
# 1. 安装 uv（Python 包管理器）
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 2. 关闭并重新打开 PowerShell，然后安装 Kimi CLI
uv tool install kimi-cli

# 3. 验证安装
kimi --version

# 4. 进入项目目录启动
 cd C:\cloudops-v2
kimi code
```

### VS Code 中使用

**方式一：VS Code Terminal（推荐）**
```powershell
# 在 VS Code 底部 Terminal 中直接运行
kimi code
```
效果与当前 Linux 环境完全一致。

**方式二：VS Code + Continue 插件（Web 风格侧边栏）**
如果你更喜欢 Web 聊天界面：
1. VS Code 安装插件 **Continue**
2. 配置 Kimi API Key
3. 在右侧侧边栏与 AI 交互

> ⚠️ **注意**：Continue 插件调用的是 Kimi API（云端模型），不是本地 Kimi Code CLI。
> 如果公司网络限制无法访问 Kimi 云端 API，请使用方式一（本地 CLI）。

---

## 二、Windows 上搭建 Go + Node.js 开发环境

### Go 环境

```powershell
# 1. 下载 Go MSI 安装包（用浏览器从 https://go.dev/dl/ 下载 go1.22.windows-amd64.msi）
# 2. 双击安装
# 3. 验证
go version    # go version go1.22.x windows/amd64
```

### Node.js 环境

```powershell
# 1. 下载 Node.js LTS（从 https://nodejs.org 下载 .msi）
# 2. 双击安装
# 3. 验证
node --version    # v22.x.x
npm --version     # 10.x.x
```

### 项目初始化

```powershell
# 1. 把代码复制到 Windows（git clone 或解压）
cd C:\cloudops-v2

# 2. 安装前端依赖（需要联网下载 npm 包）
cd frontend
npm install

# 3. 验证后端编译
cd C:\cloudops-v2
go build -o cloudops-backend.exe ./cmd/server
```

---

## 三、数据库连远程 Linux

### 修改 config/config.yaml

```yaml
server:
  port: 9000
  mode: release

database:
  host: 192.168.1.100      # ← Linux 服务器 IP
  port: 5432
  user: cloudops
  password: YourPassword
  dbname: cloudops

redis:
  host: 192.168.1.100      # ← Linux 服务器 IP
  port: 6379
  password: ""
  db: 0
```

### Linux 服务器放行配置

```bash
# 1. PostgreSQL 监听所有接口
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/14/main/postgresql.conf

# 2. pg_hba.conf 允许远程连接
sudo bash -c 'echo "host all all 0.0.0.0/0 scram-sha-256" >> /etc/postgresql/14/main/pg_hba.conf'
sudo systemctl restart postgresql

# 3. Redis 监听所有接口
sudo sed -i 's/^bind 127.0.0.1/bind 0.0.0.0/' /etc/redis/redis.conf
sudo systemctl restart redis-server

# 4. 防火墙放行（如有）
sudo ufw allow 5432/tcp
sudo ufw allow 6379/tcp
```

### Windows 测试连通性

```powershell
# PowerShell 中测试
Test-NetConnection -ComputerName 192.168.1.100 -Port 5432
Test-NetConnection -ComputerName 192.168.1.100 -Port 6379
```

---

## 四、Windows 上启动前后端

### 启动后端

```powershell
cd C:\cloudops-v2

# 方式一：直接运行（开发模式）
go run ./cmd/server

# 方式二：编译后运行（推荐）
go build -o cloudops-backend.exe ./cmd/server
.\cloudops-backend.exe
```

后端监听 `localhost:9000`。

### 启动前端

```powershell
cd C:\cloudops-v2\frontend

# 开发模式（热更新）
npm run dev
```

前端监听 `localhost:18000`。

> 由于后端和前端都在同一台 Windows 上，vite.config.ts 中的 proxy 配置 `localhost:9000` **无需修改**。

### 浏览器访问

Windows VDI 上打开浏览器：
- 前端：`http://localhost:18000`
- 后端 API：`http://localhost:9000/health`

---

## 五、关于"Web 页面"

你提到的"开启一个 web 页面"，有两种理解：

### 理解 A：前端开发服务器（CloudOps 前端页面）

**答案：完全可以。**

Windows 上 `npm run dev` 启动后，`http://localhost:18000` 就是 CloudOps 前端页面，与 Linux 上完全一致。

### 理解 B：AI 的 Web 聊天界面

**答案：Kimi Code CLI 本身没有 Web UI，是纯命令行工具。**

但你可以在 VS Code 中获得类似的体验：

| 方式 | 界面 | 说明 |
|------|------|------|
| VS Code Terminal | 命令行 | 运行 `kimi code`，与当前 Linux 完全一致 |
| VS Code + Continue 插件 | Web 侧边栏 | 需要联网访问 Kimi API |

如果你**无法联网访问 Kimi API**，只能使用 Terminal 方式。

---

## 六、开发 → 部署到用户 Linux 服务器

### 步骤 1：Windows 上编译

```powershell
# 后端：交叉编译 Linux 二进制
cd C:\cloudops-v2
$env:GOOS = "linux"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
go build -o cloudops-backend ./cmd/server

# 前端：构建产物
cd frontend
npm run build    # 生成 dist/ 目录
```

### 步骤 2：上传到用户 Linux 服务器

```powershell
# 使用 scp 或 WinSCP 上传
scp C:\cloudops-v2\cloudops-backend root@用户IP:/opt/cloudops/
scp -r C:\cloudops-v2\frontend\dist root@用户IP:/opt/cloudops/frontend/
```

### 步骤 3：用户 Linux 上启动

```bash
# 用户 Linux 服务器上
cd /opt/cloudops

# 启动后端
nohup ./cloudops-backend > backend.log 2>&1 &

# 启动 nginx（前端静态文件）
nginx -t && systemctl restart nginx
```

---

## 七、用户现场部署包（离线）

如果用户环境**完全无法联网**，使用之前做好的离线包：

```bash
# 在联网环境预编译好
tar czf cloudops-offline.tar.gz cloudops-backend frontend/dist offline-package/

# 复制到用户环境解压运行
./install.sh --db-password "xxx" --yes
```

---

## 八、完整架构对比

### 当前模式（Linux 全栈）

```
┌─────────────────┐     ┌──────────────────────────────┐
│   Windows VDI   │     │   Linux 服务器               │
│   浏览器访问     │ ←→ │   代码 + AI + Go + Node.js   │
│                 │     │   Redis + PostgreSQL         │
└─────────────────┘     └──────────────────────────────┘
```

### 目标模式（Windows 全栈开发）

```
┌──────────────────────────────────────────────┐
│   Windows VDI                                │
│   ├── VS Code + Kimi Code CLI（AI）          │
│   ├── Go 编译器                              │
│   ├── Node.js + npm                          │
│   ├── 代码仓库                               │
│   ├── 后端: localhost:9000                   │
│   └── 前端: localhost:18000                  │
└──────────────────────────────────────────────┘
                      │
                      ↓  远程连接
┌──────────────────────────────────────────────┐
│   Linux 服务器（仅数据库）                    │
│   ├── PostgreSQL :5432                       │
│   └── Redis :6379                            │
└──────────────────────────────────────────────┘
```

### 用户现场部署（Linux 运行）

```
┌──────────────────────────────────────────────┐
│   用户 Linux 服务器（离线环境）               │
│   ├── cloudops-backend :9000                 │
│   ├── nginx :18000                           │
│   ├── PostgreSQL :5432                       │
│   └── Redis :6379                            │
└──────────────────────────────────────────────┘
```

---

## 九、关键问题速查

**Q：Windows 上 `go build` 报错找不到包？**
> A：确保 `GOPATH` 和 `GOROOT` 已正确设置。Go 1.18+ 默认启用 module 模式，项目根目录下运行即可。

**Q：Windows 上 `npm install` 很慢或失败？**
> A：配置国内镜像：
> ```powershell
> npm config set registry https://registry.npmmirror.com
> ```

**Q：Windows 上后端连不上 Linux 的 PostgreSQL？**
> A：三步排查：
> 1. `config.yaml` 中 `host` 是否为 Linux IP
> 2. Linux 上 `ss -ntl | grep 5432` 是否监听 `0.0.0.0`
> 3. Linux 防火墙是否放行 5432

**Q：Kimi Code CLI 在 Windows 上安装失败？**
> A：确保 Python 3.10+ 已安装。如果 `uv` 安装失败，用 pip 替代：
> ```powershell
> pip install kimi-cli
> ```
