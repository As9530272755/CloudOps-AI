# CloudOps 离线部署包

## 目录说明

```
.
├── bin/
│   └── cloudops-backend          # Go 后端二进制（已编译，静态链接）
├── frontend/
│   └── dist/                     # 前端构建产物（纯静态文件）
├── agent-runtime/
│   ├── dist/                     # Agent Runtime 编译产物
│   ├── node_modules/             # Node.js 运行时依赖（离线必需）
│   ├── package.json
│   └── package-lock.json
├── config/
│   └── config.yaml               # 配置文件（需按内网环境修改）
├── start-all.sh                  # 一键启动脚本
└── stop-all.sh                   # 一键停止脚本
```

## 环境要求

- OS: CentOS 7/8, Rocky Linux 8/9, Ubuntu 20.04/22.04
- CPU: x86_64
- RAM: ≥ 4GB（建议 8GB）
- 磁盘: ≥ 20GB
- 依赖:
  - PostgreSQL 14+（或 SQLite 轻量模式）
  - Redis 6+（可选）
  - Node.js 18+（运行 Agent Runtime）

## 快速启动

1. 修改 `config/config.yaml` 中的数据库地址和密码
2. 执行启动脚本:

```bash
./start-all.sh
```

3. 浏览器访问 `http://<服务器IP>:18000`
4. 默认账号: `admin / admin`

## 停止服务

```bash
./stop-all.sh
```

## 日志查看

- `backend.log` — 后端日志
- `agent-runtime.log` — Agent Runtime 日志
- `frontend.log` — 前端服务日志
