# CloudOps Platform v2.0

> 云原生智能运维管理平台 —— 基于 Kubernetes 的一站式容器运维与 AI 助手解决方案

[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Gin](https://img.shields.io/badge/Gin-1.9+-008ECF?logo=go)](https://gin-gonic.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7+-DC382D?logo=redis)](https://redis.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 项目简介

CloudOps Platform 是一个面向多集群 Kubernetes 环境的云原生运维管理平台，集成集群管理、资源巡检、网络追踪、数据看板、Web 终端以及 AI 智能问答能力，帮助企业降低 K8s 运维复杂度，提升故障排查效率。

### 核心特性

- **多集群管理**：支持 20+ K8s 集群统一纳管，Kubeconfig / Token 双认证方式
- **资源全景视图**：节点、Pod、Deployment、Service、Ingress、Storage、RBAC 等资源一站式管理
- **巡检中心**：自动化巡检任务调度，生成报告并支持 AI 深度分析
- **网络追踪**：基于 eBPF/Flannel 的流量拓扑可视化，支持 tcpdump 抓包与 AI 诊断
- **AI 智能助手**：对接 OpenClaw / Ollama 多模型平台，支持 SSE 流式对话、Markdown 实时渲染、图片识别、时间戳
- **日志管理**：集群 Pod 日志实时查看与 AI 智能分析
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
| 数据库 | PostgreSQL / SQLite | 15+ |
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
├── data/                    # 运行时数据（AI 配置等）
├── docs/                    # 项目文档
├── docker/                  # Docker 构建脚本
├── k8s/                     # Kubernetes 部署清单
└── scripts/                 # 运维脚本
```

---

## 快速开始

### 1. 环境要求

- Go 1.21+
- Node.js 18+
- PostgreSQL 15+（开发模式可降级为 SQLite）
- Redis 7+（可选，AI 任务轮询需要）

### 2. 克隆并初始化

```bash
git clone https://github.com/As9530272755/CloudOps-AI.git
cd CloudOps-AI
```

### 3. 启动后端

```bash
# 安装 Go 依赖
go mod download

# 编译
go build -o cloudops-backend ./cmd/server

# 启动（默认读取 config/config.yaml）
./cloudops-backend
```

后端将监听 `http://0.0.0.0:9000`

### 4. 启动前端

```bash
cd frontend
npm install

# 开发模式
npm run dev

# 生产预览
npm run build
npm run preview
```

前端默认访问 `http://0.0.0.0:18000`

### 5. 默认账号

| 用户名 | 密码 |
|--------|------|
| admin  | admin |

---

## 主要功能截图（即将补充）

- 仪表盘
- 集群管理
- AI 助手（Markdown 渲染 + 图片上传）
- 日志分析
- 网络追踪拓扑

---

## 文档导航

| 文档 | 说明 |
|------|------|
| [docs/installation.md](docs/installation.md) | 完整安装与部署指南 |
| [docs/architecture.md](docs/architecture.md) | 系统架构与技术选型 |
| [docs/api.md](docs/api.md) | RESTful API 接口文档 |
| [docs/ai-integration.md](docs/ai-integration.md) | AI 平台对接与配置说明 |
| [docs/quickstart.md](docs/quickstart.md) | 5 分钟快速体验指南 |

---

## 贡献与反馈

欢迎提交 Issue 和 PR。如有问题，请联系项目维护者。

## License

[MIT](LICENSE)
