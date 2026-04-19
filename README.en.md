<p align="center">
  <a href="./README.md">中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a>
</p>

# CloudOps Platform v2.0

> A cloud-native intelligent O&M management platform based on Kubernetes, providing one-stop container operations and AI assistant solutions.

[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Gin](https://img.shields.io/badge/Gin-1.9+-008ECF?logo=go)](https://gin-gonic.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7+-DC382D?logo=redis)](https://redis.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Project Overview

CloudOps Platform is a cloud-native O&M management platform for multi-cluster Kubernetes environments. It integrates cluster management, resource inspection, network tracing, data dashboards, Web terminals, and AI intelligent Q&A capabilities to help enterprises reduce K8s O&M complexity and improve troubleshooting efficiency.

### Key Features

- **Multi-Cluster Management**: Unified management of 20+ K8s clusters with Kubeconfig / Token dual authentication
- **Resource Panoramic View**: One-stop management of nodes, pods, deployments, services, ingresses, storage, RBAC, and more
- **Inspection Center**: Automated inspection task scheduling with report generation and AI deep analysis
- **Network Tracing**: eBPF/Flannel-based traffic topology visualization, supporting tcpdump packet capture and AI diagnosis
- **AI Intelligent Assistant**: Integrated with OpenClaw / Ollama multi-model platforms, supporting SSE streaming conversations, Markdown real-time rendering, image recognition, multi-session persistence, and one-click scroll-to-bottom; long conversation performance optimized with `react-virtuoso` virtual scrolling
- **Log Management**: Multi-backend architecture per cluster (supports ES / OpenSearch / Loki simultaneously), scenario-based log retrieval (Ingress / CoreDNS / LB / All Logs), with keyword highlighting, level statistics, time distribution charts, and AI intelligent analysis
- **Global Resource Search**: Real-time fuzzy search across clusters for K8s resources, supporting multi-dimensional filtering by resource type, cluster, namespace, and labels, with label display in results
- **System Customization**: Administrators can dynamically modify platform name, description, and logo in system settings, with hot reload across the entire site after saving
- **Web Terminal**: Direct browser access to pod container terminals
- **Multi-Tenant Isolation**: User-role-permission system based on RBAC, supporting tenant-level resource isolation

---

## Tech Stack

| Layer | Technology | Version |
|------|----------|------|
| Backend | Golang + Gin | 1.21+ |
| Frontend | React + Vite + TypeScript | 18.x |
| UI Library | Material-UI (MUI) | 5.x |
| State Management | TanStack Query | 5.x |
| K8s Client | client-go / informer | latest |
| Database | PostgreSQL | 15+ |
| Cache | Redis | 7+ |
| AI Platform | OpenClaw / Ollama | OpenAI-compatible |

---

## Directory Structure

```
cloudops-v2/
├── cmd/server/              # Go backend entry point
├── internal/
│   ├── api/handlers/        # HTTP handler layer
│   ├── api/middleware/      # JWT auth and other middleware
│   ├── api/routes.go        # Route registration
│   ├── model/               # GORM data models
│   ├── pkg/
│   │   ├── ai/              # AI provider abstraction (OpenClaw / Ollama)
│   │   ├── auth/            # JWT authentication
│   │   ├── config/          # Viper configuration management
│   │   ├── crypto/          # AES-256 encryption
│   │   ├── database/        # GORM initialization and migration
│   │   ├── k8s/             # K8s client wrapper
│   │   └── redis/           # Redis client wrapper
│   └── service/             # Business logic layer
├── frontend/                # React frontend project
│   ├── src/pages/           # Page components
│   ├── src/components/      # Common components
│   └── src/lib/             # API request wrappers
├── ai-service/              # Python AI service (reserved for extension)
├── config/
│   └── config.yaml          # Main configuration file
├── data/                    # Runtime data (AI config, etc.)
├── docs/                    # Project documentation
├── docker/                  # Docker build scripts
├── k8s/                     # Kubernetes deployment manifests
└── scripts/                 # O&M scripts
```

---

## Quick Start

### 1. Requirements

- Go 1.21+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+ (optional; required for AI task polling)

### 2. Clone & Initialize

```bash
git clone https://github.com/As9530272755/CloudOps-AI.git
cd CloudOps-AI
```

### 3. Start Backend

```bash
# Install Go dependencies
go mod download

# Build
go build -o cloudops-backend ./cmd/server

# Start (reads config/config.yaml by default)
./cloudops-backend
```

Backend will listen on `http://0.0.0.0:9000`

### 4. Start Frontend

```bash
cd frontend
npm install

# Development mode
npm run dev

# Production preview
npm run build
npm run preview
```

Frontend default access: `http://0.0.0.0:18000`

### 5. Default Credentials

| Username | Password |
|--------|------|
| admin  | admin |

---

## Screenshots (Coming Soon)

- Dashboard
- Cluster Management
- AI Assistant (Markdown rendering + image upload)
- Log Analysis
- Network Tracing Topology

---

## Documentation

| Document | Description |
|------|------|
| [docs/installation.md](docs/installation.md) | Complete installation and deployment guide |
| [docs/architecture.md](docs/architecture.md) | System architecture and technology selection |
| [docs/api.md](docs/api.md) | RESTful API documentation |
| [docs/ai-integration.md](docs/ai-integration.md) | AI platform integration and configuration |
| [docs/quickstart.md](docs/quickstart.md) | 5-minute quick start guide |

---

## Contributing & Feedback

Issues and PRs are welcome. For questions, please contact the project maintainers.

## License

[MIT](LICENSE)
