# CloudOps 离线部署指南

本文档描述如何在完全离线的 Ubuntu 22.04 服务器上部署 CloudOps。

## 目录结构

```
cloudops-offline/
├── install.sh              # 一键安装脚本
├── uninstall.sh            # 卸载脚本
├── README-DEPLOY.md        # 本文件
├── bin/
│   ├── cloudops-backend    # 后端二进制（Go）
│   └── serve-frontend.js   # 前端静态文件服务器（Node.js 零依赖）
├── config/
│   └── db-commands.sql     # 数据库初始化 SQL（可选）
├── deps/
│   ├── nodejs/             # Node.js 22.14.0 预编译二进制
│   ├── postgresql-14/      # PostgreSQL 14 DEB 依赖包
│   └── redis-server/       # Redis DEB 依赖包
├── frontend/
│   └── dist/               # 前端构建产物（React + Vite）
└── systemd/                # 预留目录（systemd 服务由 install.sh 动态生成）
```

## 系统要求

- **操作系统**: Ubuntu 22.04 LTS (x86_64)
- **内存**: 建议 4GB+
- **磁盘**: 建议 20GB+
- **网络**: 无需外网，仅需内网访问
- **权限**: root 用户

## 快速安装

```bash
# 1. 将离线包复制到目标服务器（文件名含时间戳，如 cloudops-offline-ubuntu22-20260423-0935.tar.gz）
tar xzf cloudops-offline-ubuntu22-*.tar.gz -C /opt/
cd /opt/cloudops-offline

# 2. 执行安装（交互式，推荐首次使用）
./install.sh

# 3. 或使用全自动模式（生产环境推荐）
./install.sh \
  --install-dir /opt/cloudops \
  --db-password "YourStrongPassword" \
  --jwt-secret "$(openssl rand -hex 32)" \
  --yes
```

## 安装选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--install-dir` | 安装目录 | `/opt/cloudops` |
| `--db-host` | PostgreSQL 地址 | `127.0.0.1` |
| `--db-port` | PostgreSQL 端口 | `5432` |
| `--db-password` | 数据库密码 | 自动生成 |
| `--db-name` | 数据库名称 | `cloudops` |
| `--db-user` | 数据库用户 | `cloudops` |
| `--redis-host` | Redis 地址 | `127.0.0.1` |
| `--redis-port` | Redis 端口 | `6379` |
| `--jwt-secret` | JWT 密钥 | 自动生成 |
| `--frontend-port` | 前端端口 | `18000` |
| `--backend-port` | 后端端口 | `9000` |
| `-y, --yes` | 自动确认 | 否 |

## 安装过程说明

`install.sh` 会自动完成以下步骤：

1. **安装系统依赖**: 通过 `dpkg -i` 安装 PostgreSQL 14、Redis、Node.js
2. **初始化数据库**: 创建 `cloudops` 数据库和用户，启动 Redis
3. **创建运行用户**: `cloudops` 系统用户
4. **部署应用文件**: 复制后端二进制、前端 dist、静态服务器脚本
5. **生成配置**: 根据参数生成 `config.yaml` 和 `.env`
6. **创建 systemd 服务**: `cloudops-backend.service` + `cloudops-frontend.service`
7. **设置权限**: 文件属主和访问权限
8. **启动服务**: 自动启动并健康检查

## 升级

如果服务器上已部署旧版本，**不要重新运行 `install.sh`**，因为 `install.sh` 会重新生成 `config.yaml`（覆盖数据库密码、JWT secret 等配置，导致用户登录失效）。

请使用专门的升级脚本：

```bash
# 1. 将新版本离线包复制到服务器（文件名含时间戳）
tar xzf cloudops-offline-ubuntu22-*.tar.gz -C /opt/
cd /opt/cloudops-offline

# 2. 执行升级（交互式确认）
./upgrade.sh

# 3. 或使用自动确认模式
./upgrade.sh --yes
```

### `upgrade.sh` 与 `install.sh` 的区别

| 行为 | `install.sh` | `upgrade.sh` |
|------|-------------|--------------|
| 安装系统依赖 | ✓ | ✗（假设已安装） |
| 初始化数据库 | ✓ | ✗（保留现有数据） |
| 生成 config.yaml | ✓（覆盖） | ✗（保留现有配置） |
| 替换后端二进制 | ✓ | ✓ |
| 替换前端 dist | ✓ | ✓ |
| 更新 kubectl/data | ✓ | ✓ |
| 数据库结构更新 | ✓（AutoMigrate） | ✓（AutoMigrate，后端启动时自动执行） |
| 备份旧版本 | ✗ | ✓（备份到 `backup/YYYYMMDD_HHMMSS/`） |

### 回滚

如果升级后出现问题，可从备份目录回滚：

```bash
BACKUP_DIR="/opt/cloudops/backup/20250101_120000"  # 替换为实际备份目录

# 停止服务
systemctl stop cloudops-backend

# 恢复旧版本
cp "${BACKUP_DIR}/cloudops-backend" /opt/cloudops/
cp -r "${BACKUP_DIR}/dist" /opt/cloudops/frontend/

# 重启服务
systemctl start cloudops-backend
```

## 服务管理

```bash
# 查看状态
systemctl status cloudops-backend
systemctl status cloudops-frontend

# 启停服务
systemctl start cloudops-backend cloudops-frontend
systemctl stop cloudops-backend cloudops-frontend
systemctl restart cloudops-backend

# 查看日志
journalctl -u cloudops-backend -f
journalctl -u cloudops-frontend -f
```

## 访问系统

- **前端页面**: `http://<服务器IP>:18000`
- **后端 API**: `http://<服务器IP>:9000`
- **健康检查**: `http://127.0.0.1:9000/health`

默认账号：
- 用户名: `admin`
- 密码: `admin`

> ⚠️ **安全提醒**: 首次登录后请立即修改默认密码。

## 卸载

```bash
./uninstall.sh --install-dir /opt/cloudops
```

## 常见问题

### Q: dpkg 安装依赖时提示缺少依赖？
`prepare-deps.sh` 已递归下载所有依赖，通常 `dpkg -i *.deb` 可直接安装。如因顺序问题失败，可尝试：
```bash
cd deps/postgresql-14
for deb in *.deb; do dpkg -i "$deb" || true; done
dpkg --configure -a
```

### Q: 前端服务无法启动？
前端使用 `serve-frontend.js`（Node.js 内置 http 模块），无需 npm 依赖。请确保 Node.js 已正确安装：
```bash
node --version
```

### Q: 如何修改端口？
重新运行 `install.sh` 并指定 `--frontend-port` / `--backend-port`，或直接修改 `/opt/cloudops/config/config.yaml` 和 `/etc/systemd/system/cloudops-*.service` 后 `systemctl daemon-reload && systemctl restart`。

### Q: 数据库连接失败？
检查 PostgreSQL 是否启动：
```bash
systemctl status postgresql
sudo -u postgres psql -c "\l"
```

## 文件清单验证

安装完成后，关键文件应存在：

```bash
ls -la /opt/cloudops/cloudops-backend
ls -la /opt/cloudops/config/config.yaml
ls -la /opt/cloudops/frontend/dist/index.html
ls -la /opt/cloudops/bin/serve-frontend.js
ls -la /etc/systemd/system/cloudops-backend.service
ls -la /etc/systemd/system/cloudops-frontend.service
```
