# 安装与部署指南

本文档涵盖 CloudOps Platform 的开发环境搭建、生产环境部署以及 Docker/K8s 部署方式。

---

## 一、开发环境部署

### 1.1 依赖清单

| 组件 | 版本 | 说明 |
|------|------|------|
| Go | 1.21+ | 后端编译运行 |
| Node.js | 18+ | 前端构建 |
| PostgreSQL | 15+ | 主数据库（可选，开发可用 SQLite） |
| Redis | 7+ | 缓存与 AI 任务状态（可选） |

### 1.2 后端启动

```bash
# 下载依赖
go mod download

# 编译二进制
go build -o cloudops-backend ./cmd/server

# 启动服务
./cloudops-backend
```

后端默认读取 `config/config.yaml`。你可以通过环境变量覆盖配置项：

```bash
export CONFIG_PATH=/etc/cloudops/config.yaml
export DATABASE__POSTGRES__HOST=127.0.0.1
export DATABASE__REDIS__PASSWORD=secret
export OPENCLAW_URL=http://127.0.0.1:18789
export JWT_SECRET=your-jwt-secret
```

### 1.3 前端启动

```bash
cd frontend
npm install

# 开发服务器（HMR 热更新）
npm run dev

# 生产构建
npm run build

# 生产预览
npm run preview
```

开发服务器代理已配置：`/api` 和 `/ws` 会自动转发到 `http://localhost:9000`。

---

## 二、生产环境部署

### 2.1 使用 systemd 管理后端

创建 `/etc/systemd/system/cloudops-backend.service`：

```ini
[Unit]
Description=CloudOps Backend
After=network.target

[Service]
Type=simple
User=cloudops
Group=cloudops
WorkingDirectory=/opt/cloudops
ExecStart=/opt/cloudops/cloudops-backend
Restart=on-failure
RestartSec=5
Environment="CONFIG_PATH=/opt/cloudops/config/config.yaml"
Environment="GIN_MODE=release"

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudops-backend
sudo systemctl start cloudops-backend
```

### 2.2 使用 Nginx 部署前端

```nginx
server {
    listen 80;
    server_name cloudops.example.com;
    root /opt/cloudops/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:9000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:9000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

> 注意：`/api/` 后面的斜杠要与 `proxy_pass` 对应，防止路径拼接错误。

---

## 三、Docker 部署

### 3.1 构建镜像

```bash
# 后端镜像
docker build -t cloudops-backend:latest -f docker/Dockerfile.backend .

# 前端镜像
docker build -t cloudops-frontend:latest -f docker/Dockerfile.frontend .
```

### 3.2 使用 docker-compose

项目根目录提供 `docker-compose.yml`（如缺失可自行创建）：

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: cloudops
      POSTGRES_USER: cloudops
      POSTGRES_PASSWORD: cloudops123
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine

  backend:
    image: cloudops-backend:latest
    ports:
      - "9000:9000"
    environment:
      - CONFIG_PATH=/app/config/config.yaml
    volumes:
      - ./config/config.yaml:/app/config/config.yaml
    depends_on:
      - postgres
      - redis

  frontend:
    image: cloudops-frontend:latest
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  pgdata:
```

启动：

```bash
docker-compose up -d
```

---

## 四、Kubernetes 部署

参考 `k8s/` 目录下的 YAML 清单：

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml
kubectl apply -f k8s/ingress.yaml
```

---

## 五、数据库迁移

首次启动或升级版本时，后端会自动执行 GORM AutoMigrate：

```go
db.AutoMigrate(
    &model.Tenant{},
    &model.User{},
    &model.Role{},
    &model.Permission{},
    &model.Cluster{},
    &model.ClusterSecret{},
    &model.ClusterMetadata{},
    &model.LoginLog{},
    &model.DataSource{},
    &model.Dashboard{},
    &model.DashboardPanel{},
    &model.InspectionTask{},
    &model.InspectionJob{},
    &model.InspectionResult{},
    &model.InspectionRule{},
    &model.AITask{},
)
```

---

## 六、安全配置建议

1. **修改默认密码**：首次登录后立即修改 `admin` 密码。
2. **JWT Secret**：生产环境务必设置强随机字符串作为 `JWT_SECRET`。
3. **加密密钥**：`ENCRYPTION_KEY` 用于 AES-256 加密 AI Token，需妥善保管。
4. **HTTPS**：生产环境必须启用 HTTPS，防止 Token 泄露。
5. **Redis 密码**：若 Redis 暴露在公网，务必配置强密码。
