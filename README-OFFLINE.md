# CloudOps 离线一键部署指南

> 适用于完全无互联网访问的私有化/内网环境

---

## 目录结构

```
cloudops-offline-package/
├── install.sh                    # 主安装脚本（一键执行）
├── uninstall.sh                  # 卸载脚本
├── prepare-deps.sh               # 依赖预打包脚本（联网机器执行）
├── bin/
│   └── cloudops-backend          # Go 静态二进制
├── frontend/
│   └── dist/                     # 前端构建产物
│   ├── dist/                     # Agent 编译产物
│   ├── node_modules/             # Node 运行时依赖
│   ├── package.json
│   └── package-lock.json
├── config/
│   └── config.yaml.template      # 配置模板
├── systemd/
│   ├── cloudops-backend.service
│   └── cloudops-frontend.service
└── deps/                         # 系统级离线依赖（需预打包）
    ├── ubuntu/
    │   ├── postgresql-14/
    │   ├── redis-server/
    │   └── nodejs/
    └── centos/
        ├── postgresql15/
        ├── redis/
        └── nodejs/
```

---

## 第一步：预打包依赖（联网机器执行）

在有互联网的机器上，进入项目目录执行：

### Ubuntu 22.04

```bash
cd /data/projects/cloudops-v2
./scripts/prepare-deps.sh --os ubuntu
```

### CentOS/RHEL 8/9

```bash
cd /data/projects/cloudops-v2
./scripts/prepare-deps.sh --os centos
```

**输出**：`deps/` 目录下会生成所有离线依赖包，包括：
- PostgreSQL DEB/RPM 包
- Redis DEB/RPM 包
- Node.js 预编译二进制 (`node-v22.x.x-linux-x64.tar.xz`)

---

## 第二步：打包完整离线包

```bash
cd /data/projects/cloudops-v2

# 确保后端已编译
go build -o bin/cloudops-backend ./cmd/server

# 确保前端已构建
cd frontend && npm run build && cd ..

# 打包整个离线包
tar czf cloudops-offline-package.tar.gz \
  scripts/ bin/ frontend/dist/ \
  config/ systemd/ deps/
```

---

## 第三步：离线服务器安装

将 `cloudops-offline-package.tar.gz` 复制到离线服务器，解压后执行安装：

```bash
# 解压
tar xzf cloudops-offline-package.tar.gz
cd cloudops-offline-package

# 赋予执行权限
chmod +x scripts/*.sh

# 全功能模式（PostgreSQL + Redis）
./scripts/install.sh --mode full --yes

# 或：指定数据库密码
./scripts/install.sh --mode full --db-password MySecurePwd123 --yes

```

### 安装参数

| 参数 | 说明 | 默认值 |
|------|------|--------|

| `--install-dir` | 安装目录 | `/opt/cloudops` |
| `--db-password` | 数据库密码 | 自动生成 |
| `--db-host` | 数据库地址 | `127.0.0.1` |
| `--frontend-port` | 前端端口 | `18000` |
| `--backend-port` | 后端端口 | `9000` |
| `-y, --yes` | 自动确认 | 否 |

---

## 第四步：验证安装

```bash
# 查看服务状态
systemctl status cloudops-backend
systemctl status cloudops-frontend

# 健康检查
curl http://127.0.0.1:9000/health

# 查看日志
journalctl -u cloudops-backend -f
```

---

## 服务管理

```bash
# 启动所有服务
systemctl start cloudops-backend cloudops-frontend

# 停止所有服务
systemctl stop cloudops-backend cloudops-frontend

# 重启后端
systemctl restart cloudops-backend

# 查看状态
systemctl status cloudops-backend
```

---

## 访问方式

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端页面 | `http://<服务器IP>:18000` | 浏览器访问 |
| 后端 API | `http://<服务器IP>:9000` | 健康检查 `/health` |
| 默认账号 | `admin / admin` | 首次登录后请立即修改密码 |

---

## 卸载

```bash
cd /opt/cloudops-offline-package
./scripts/uninstall.sh
```

---

## 两种部署模式对比

| 模式 | 数据库 | 缓存 | 系统依赖 | 资源要求 | 适用场景 |
|------|--------|------|----------|----------|----------|
| **full** | PostgreSQL 14+ | Redis 6+ | postgresql, redis, nodejs | 4C8G+ | 生产环境 |

---

## 安全建议

1. **首次登录后立即修改 `admin` 密码**
2. **妥善保管 `.env` 文件** 中的 `JWT_SECRET` 和 `ENCRYPTION_KEY`
3. **生产环境建议配置 HTTPS**：可用 Nginx 反向代理并配置 SSL 证书
4. **防火墙**：仅开放必要的端口（18000, 9000）
5. **定期备份**：
   - full 模式：`pg_dump cloudops > backup.sql`

---

## 常见问题

### Q: 安装脚本报 "未找到 Node.js 预编译包"
A: 请确保在联网机器上执行了 `prepare-deps.sh`，且 `deps/nodejs/` 目录存在 `.tar.xz` 文件。

### Q: PostgreSQL 安装失败
A: 离线包中可能缺少某些依赖。尝试在联网机器上重新执行 `prepare-deps.sh`，或使用系统自带的包管理器在线安装。

### Q: 后端启动报错 "连接数据库失败"
A: 检查 PostgreSQL 是否已启动：`systemctl status postgresql`。检查 `config.yaml` 中的密码是否正确。

### Q: 前端页面空白
A: 确认 `frontend/dist/` 目录存在且包含 `index.html`。检查前端服务日志：`journalctl -u cloudops-frontend -f`。

### Q: 如何修改配置？
A: 编辑 `/opt/cloudops/config/config.yaml`，然后执行 `systemctl restart cloudops-backend`。
