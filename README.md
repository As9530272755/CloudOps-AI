<p align="center">
  <a href="./README.md">中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a>
</p>

# CloudOps AI v0.1.1

> 云原生智能运维管理平台 —— 基于 Kubernetes 的一站式容器运维与 AI 助手解决方案

[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Gin](https://img.shields.io/badge/Gin-1.9+-008ECF?logo=go)](https://gin-gonic.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7+-DC382D?logo=redis)](https://redis.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 项目简介

CloudOps AI 是一个面向多集群 Kubernetes 环境的云原生运维管理平台，集成集群管理、资源巡检、网络追踪、数据看板、Web 终端以及 AI 智能问答能力，帮助企业降低 K8s 运维复杂度，提升故障排查效率。

### 核心特性

- **多集群管理**：支持 20+ K8s 集群统一纳管，Kubeconfig / Token 双认证方式；实时健康状态监控（正常/不健康/离线/检测中），自动探测权限范围（read-only / read-write / admin）
- **资源全景视图**：节点、Pod、Deployment、Service、Ingress、ConfigMap、Secret、DaemonSet、StatefulSet、Job、CronJob、PersistentVolume / PVC、StorageClass、ServiceAccount、Role / ClusterRole、NetworkPolicy 等 30+ 种资源一站式管理
- **巡检中心**：自动化巡检任务调度（定时/手动），强制关联集群避免误操作；执行记录显示任务名称；同名任务禁止创建；生成报告并支持 PDF / HTML / Markdown 导出与 AI 深度分析
- **网络追踪**：基于 eBPF/Flannel 的流量拓扑可视化，支持 tcpdump 抓包与 AI 诊断
- **AI 智能助手**：对接 OpenClaw / Ollama 多模型平台，支持异步任务轮询、Markdown 实时渲染、图片识别、多会话持久化；基于 `react-virtuoso` 虚拟滚动优化长对话性能
- **日志管理**：一集群多后端架构（支持同时对接 ES / OpenSearch / Loki），场景化日志检索（Ingress / CoreDNS / LB / 全部日志），支持关键字高亮、级别统计、时间分布图与 AI 智能分析
- **全局资源搜索**：跨集群 K8s 资源实时模糊搜索，支持按资源类型、集群、Namespace 多维过滤
- **系统自定义**：支持管理员在系统设置中动态修改平台名称、平台介绍和 Logo，保存后全站热加载生效
- **Web Terminal**：浏览器内直接访问 Pod 容器终端
- **多租户隔离**：基于 RBAC 的用户-角色-权限体系，支持租户级资源隔离

---

## 技术栈

| 层级 | 技术选型 | 版本 |
|------|----------|------|
| 后端 | Golang + Gin | 1.21+ |
| 前端 | React + Vite + TypeScript | 18.x |
| UI 组件库 | Material-UI (MUI) | 5.x |
| 状态管理 | TanStack Query | 5.x |
| K8s 客户端 | client-go / informer | latest |
| 数据库 | PostgreSQL | 15+ |
| 缓存 | Redis | 7+ |
| AI 中台 | OpenClaw / Ollama | OpenAI-compatible |

---

## 目录结构

```
cloudops-v2/
├── cmd/server/              # Go 后端主入口
├── internal/
│   ├── api/handlers/        # HTTP Handler 层
│   ├── api/middleware/      # JWT 认证等中间件
│   ├── api/routes.go        # 路由注册
│   ├── model/               # GORM 数据模型
│   ├── pkg/
│   │   ├── ai/              # AI Provider 抽象（OpenClaw / Ollama）
│   │   ├── auth/            # JWT 认证
│   │   ├── config/          # Viper 配置管理
│   │   ├── crypto/          # AES-256 加密
│   │   ├── database/        # GORM 初始化与迁移
│   │   ├── k8s/             # K8s Client 封装
│   │   └── redis/           # Redis Client 封装
│   └── service/             # 业务逻辑层
├── frontend/                # React 前端项目
│   ├── src/pages/           # 页面组件
│   ├── src/components/      # 公共组件
│   └── src/lib/             # API 请求封装
├── ai-service/              # Python AI 服务（预留扩展）
├── config/
│   └── config.yaml          # 主配置文件
├── systemd/                 # systemd 服务文件
├── data/                    # 运行时数据
├── docs/                    # 项目文档
├── docker/                  # Docker 构建脚本
├── k8s/                     # Kubernetes 部署清单
├── offline-package/         # 离线部署包
└── scripts/                 # 运维脚本
```

---

## 快速开始

### 1. 环境要求

- Go 1.21+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+（可选，AI 任务轮询需要）

### 2. 克隆并初始化

```bash
git clone https://github.com/As9530272755/CloudOps-AI.git
cd CloudOps-AI
```

### 3. 配置数据库

编辑 `config/config.yaml`，配置 PostgreSQL 和 Redis 连接信息：

```yaml
database:
  host: "127.0.0.1"
  port: 5432
  database: "cloudops"
  username: "cloudops"
  password: "cloudops123"

redis:
  host: "127.0.0.1"
  port: 6379
  password: ""
  db: 0
```

### 4. 启动后端

```bash
# 安装 Go 依赖
go mod download

# 编译
go build -o cloudops-backend ./cmd/server

# 方式一：直接启动（开发环境）
./cloudops-backend

```

后端将监听 `http://0.0.0.0:9000`

### 5. 启动前端

```bash
cd frontend
npm install

# 开发模式
npm run dev

# 生产构建
npm run build
```

前端默认访问 `http://0.0.0.0:18000`

### 6. 默认账号

| 用户名 | 密码 |
|--------|------|
| admin  | admin |

---

## 变更日志

### v0.1.1 (2026-04-20)

**巡检中心修复**
- 修复空 `cluster_ids` 默认执行全部活跃集群的问题，强制要求至少选择一个集群
- 执行记录列表从显示 Job ID 改为显示「任务名称」，一键巡检显示「一键巡检」
- 禁止创建同名巡检任务，同一租户内任务名称唯一
- 表单校验错误显示在弹窗内部，不再飘到页面顶部

**集群管理优化**
- 健康状态统一为 4 种：正常 / 不健康 / 离线 / 检测中，废弃 `error`/`warning` 遗留状态
- 权限探测同时检查全局权限和 default namespace 权限，取最严格值
- 全局搜索结果移除标签 Chip 显示，更简洁

**架构清理**
- 移除 6 种 K8s 不支持的资源类型（前后端同步清理）
- 彻底移除 AgentRuntimeProxy 代理服务及所有引用

**基础设施**
- 后端支持 systemd 服务部署，自动重启保障稳定性
- 离线包同步更新

### v0.1.0

- 初始版本发布
- 多集群管理、AI 助手、巡检中心、日志管理、网络追踪等核心功能

---

## 文档导航

| 文档 | 说明 |
|------|------|
| [docs/installation.md](docs/installation.md) | 完整安装与部署指南 |
| [docs/architecture.md](docs/architecture.md) | 系统架构与技术选型 |
| [docs/api.md](docs/api.md) | RESTful API 接口文档 |
| [docs/ai-integration.md](docs/ai-integration.md) | AI 平台对接与配置说明 |
| [docs/install-offline.md](docs/install-offline.md) | 离线安装指南 |

---

## 贡献与反馈

欢迎提交 Issue 和 PR。如有问题，请联系项目维护者。

## License

[MIT](LICENSE)
