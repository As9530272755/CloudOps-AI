# CloudOps Platform v2.0

> 云原生运维管理平台 - 基于 Kubernetes 的一站式容器运维解决方案

## 项目信息

| 项目 | 说明 |
|------|------|
| **版本** | 2.0.0 |
| **开发语言** | Golang + React + Python |
| **参考项目** | [Headlamp](https://github.com/kubernetes-sigs/headlamp) |
| **支持集群** | 20+ K8s 集群 |

## 核心功能

| 模块 | 功能 | 状态 |
|------|------|------|
| 用户登录体系 | JWT认证、RBAC权限 | 🔄 开发中 |
| 集群配置管理 | 多集群配置、认证管理 | 📋 计划中 |
| 巡检中心 | 自动化巡检、报告生成 | 📋 计划中 |
| 数据管理 | 快照、使用率、容量 | 📋 计划中 |
| Web Terminal | Pod终端操作 | 📋 计划中 |
| AI智能问答 | K8s知识问答、故障诊断 | 📋 计划中 |
| 多租户 | 租户隔离、权限控制 | 📋 计划中 |

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 后端 | Golang | 1.21+ |
| Web框架 | Gin | 1.9+ |
| K8s客户端 | client-go | latest |
| 前端 | React | 18.x |
| UI库 | Material-UI | 5.x |
| 数据库 | PostgreSQL | 15+ |
| 缓存 | Redis | 7+ |
| AI服务 | Python + FastAPI | 3.11+ |

## 目录结构

```
cloudops-v2/
├── cmd/server/           # 后端入口
├── internal/
│   ├── api/             # API层
│   ├── service/         # 服务层
│   ├── model/           # 数据模型
│   └── pkg/             # 公共包
├── frontend/            # 前端项目
├── ai-service/          # AI服务
├── config/              # 配置文件
├── k8s/                 # K8s部署文件
├── docker/              # Docker部署文件
└── docs/                # 文档
```

## 快速开始

### 环境要求

- Go 1.21+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+

### 本地运行

```bash
# 后端
cd cloudops-v2
go mod tidy
go run cmd/server/main.go

# 前端
cd frontend
npm install
npm run dev
```

## 开发计划

| 阶段 | 时间 | 目标 |
|------|------|------|
| Phase 1 | Week 1-2 | 基础架构 |
| Phase 2 | Week 3-4 | 巡检功能 |
| Phase 3 | Week 5-6 | 数据管理 |
| Phase 4 | Week 7-8 | 高级功能 |
| Phase 5 | Week 9-10 | 终端操作 |
| Phase 6 | Week 11-12 | 多租户 |

## 文档

- [完整项目方案](docs/CLOUDOPS_COMPLETE_PROJECT_PLAN.md)
- [API文档](docs/API.md)
- [部署文档](docs/DEPLOYMENT.md)

## License

MIT License