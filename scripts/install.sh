#!/bin/bash
# =============================================================================
# CloudOps 离线一键安装脚本
# 用途：在完全离线的环境中自动完成 CloudOps 全量部署
# 用法：./install.sh [OPTIONS]
# =============================================================================

set -e

# 默认配置
INSTALL_DIR="/opt/cloudops"
MODE="full"          # full | lite
DB_HOST="127.0.0.1"
DB_PORT="5432"
DB_NAME="cloudops"
DB_USER="cloudops"
DB_PASSWORD=""
REDIS_HOST="127.0.0.1"
REDIS_PORT="6379"
JWT_SECRET=""
ENCRYPTION_KEY=""
RUN_USER="cloudops"
FRONTEND_PORT="18000"
BACKEND_PORT="9000"


# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPS_DIR="${PROJECT_ROOT}/deps"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
    --mode <full|lite>        部署模式 (默认: full)
                              full:  PostgreSQL + Redis
                              lite:  SQLite (无外部数据库依赖)
    --install-dir <dir>       安装目录 (默认: /opt/cloudops)
    --db-host <host>          PostgreSQL 地址 (默认: 127.0.0.1)
    --db-port <port>          PostgreSQL 端口 (默认: 5432)
    --db-password <password>  数据库密码 (默认: 自动生成)
    --db-name <name>          数据库名称 (默认: cloudops)
    --db-user <user>          数据库用户 (默认: cloudops)
    --redis-host <host>       Redis 地址 (默认: 127.0.0.1)
    --redis-port <port>       Redis 端口 (默认: 6379)
    --jwt-secret <secret>     JWT 密钥 (默认: 自动生成)
    --encryption-key <key>    加密密钥 (默认: 自动生成)
    --frontend-port <port>    前端端口 (默认: 18000)
    --backend-port <port>     后端端口 (默认: 9000)
    --agent-port <port>       Agent Runtime 端口 (默认: 19000)
    -y, --yes                 自动确认，无需交互
    -h, --help                显示帮助

Examples:
    ./install.sh                          # 默认 full 模式，交互式确认
    ./install.sh --mode lite              # 轻量模式（SQLite）
    ./install.sh --mode full --db-password MyPwd123 --yes
EOF
    exit 0
}

# 解析参数
AUTO_CONFIRM=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --mode)
            MODE="$2"
            shift 2
            ;;
        --install-dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --db-host)
            DB_HOST="$2"
            shift 2
            ;;
        --db-port)
            DB_PORT="$2"
            shift 2
            ;;
        --db-password)
            DB_PASSWORD="$2"
            shift 2
            ;;
        --db-name)
            DB_NAME="$2"
            shift 2
            ;;
        --db-user)
            DB_USER="$2"
            shift 2
            ;;
        --redis-host)
            REDIS_HOST="$2"
            shift 2
            ;;
        --redis-port)
            REDIS_PORT="$2"
            shift 2
            ;;
        --jwt-secret)
            JWT_SECRET="$2"
            shift 2
            ;;
        --encryption-key)
            ENCRYPTION_KEY="$2"
            shift 2
            ;;
        --frontend-port)
            FRONTEND_PORT="$2"
            shift 2
            ;;
        --backend-port)
            BACKEND_PORT="$2"
            shift 2
            ;;
        --agent-port)
            AGENT_PORT="$2"
            shift 2
            ;;
        -y|--yes)
            AUTO_CONFIRM=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "未知参数: $1"
            usage
            ;;
    esac
done

# 校验模式
if [[ "$MODE" != "full" && "$MODE" != "lite" ]]; then
    log_error "模式必须是 full 或 lite"
    exit 1
fi

# 检测 root
if [[ $EUID -ne 0 ]]; then
    log_error "请使用 root 用户执行安装脚本"
    exit 1
fi

# 检测架构
ARCH=$(uname -m)
if [[ "$ARCH" != "x86_64" ]]; then
    log_error "当前仅支持 x86_64 架构，检测到: $ARCH"
    exit 1
fi

# 检测 OS
OS_ID=""
OS_VERSION=""
if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    OS_ID="$ID"
    OS_VERSION="$VERSION_ID"
else
    log_error "无法检测操作系统类型"
    exit 1
fi

OS_FAMILY=""
if [[ "$OS_ID" == "ubuntu" || "$OS_ID" == "debian" ]]; then
    OS_FAMILY="debian"
elif [[ "$OS_ID" == "centos" || "$OS_ID" == "rhel" || "$OS_ID" == "rocky" || "$OS_ID" == "almalinux" ]]; then
    OS_FAMILY="rhel"
else
    log_warn "未测试的操作系统: $OS_ID，将尝试通用安装方式"
    OS_FAMILY="unknown"
fi

log_info "================================================"
log_info "CloudOps 离线安装程序"
log_info "================================================"
log_info "部署模式: ${MODE}"
log_info "操作系统: ${OS_ID} ${OS_VERSION} (${OS_FAMILY})"
log_info "安装目录: ${INSTALL_DIR}"
log_info "前端端口: ${FRONTEND_PORT}"
log_info "后端端口: ${BACKEND_PORT}"
if [[ "$MODE" == "full" ]]; then
    log_info "数据库: PostgreSQL @ ${DB_HOST}:${DB_PORT}"
    log_info "缓存: Redis @ ${REDIS_HOST}:${REDIS_PORT}"
else
    log_info "数据库: SQLite (内置)"
    log_info "缓存: 内存模式"
fi
log_info "================================================"

if [[ "$AUTO_CONFIRM" != true ]]; then
    read -p "确认开始安装? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ -n $REPLY ]]; then
        log_info "安装已取消"
        exit 0
    fi
fi

# =============================================================================
# 生成随机密钥
# =============================================================================
generate_secret() {
    openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64
}

if [[ -z "$JWT_SECRET" ]]; then
    JWT_SECRET=$(generate_secret)
    log_info "自动生成 JWT_SECRET"
fi
if [[ -z "$ENCRYPTION_KEY" ]]; then
    ENCRYPTION_KEY=$(generate_secret)
    log_info "自动生成 ENCRYPTION_KEY"
fi
if [[ -z "$DB_PASSWORD" && "$MODE" == "full" ]]; then
    DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 16)
    log_info "自动生成数据库密码: ${DB_PASSWORD}"
    log_warn "请记录此密码，如需查看可访问 ${INSTALL_DIR}/.env"
fi

# =============================================================================
# STEP 1: 安装系统依赖
# =============================================================================
log_step "1/8 安装系统依赖..."

install_nodejs_binary() {
    log_info "安装 Node.js (预编译二进制)..."
    NODE_TARBALL=$(find "${DEPS_DIR}/nodejs" -name "node-v*-linux-x64.tar.xz" | head -1)
    if [[ -z "$NODE_TARBALL" ]]; then
        log_error "未找到 Node.js 预编译包，请确认 deps/nodejs/ 目录存在 tarball"
        exit 1
    fi

    mkdir -p "${INSTALL_DIR}/runtime"
    tar -xf "$NODE_TARBALL" -C "${INSTALL_DIR}/runtime/"

    NODE_BIN_DIR=$(find "${INSTALL_DIR}/runtime" -maxdepth 2 -name "bin" -type d | head -1)
    if [[ -n "$NODE_BIN_DIR" ]]; then
        ln -sf "${NODE_BIN_DIR}/node" /usr/local/bin/node
        ln -sf "${NODE_BIN_DIR}/npm" /usr/local/bin/npm
        ln -sf "${NODE_BIN_DIR}/npx" /usr/local/bin/npx
    fi

    node --version
    log_info "Node.js 安装完成"
}

if [[ "$OS_FAMILY" == "debian" ]]; then
    # Ubuntu/Debian
    if [[ "$MODE" == "full" ]]; then
        log_info "安装 PostgreSQL 14..."
        if [[ -d "${DEPS_DIR}/postgresql-14" ]]; then
            dpkg -i "${DEPS_DIR}"/postgresql-14/*.deb 2>/dev/null || apt-get install -f -y
        else
            log_warn "未找到 PostgreSQL 离线包，尝试在线安装..."
            apt-get update && apt-get install -y postgresql-14 postgresql-client-14
        fi

        log_info "安装 Redis..."
        if [[ -d "${DEPS_DIR}/redis-server" ]]; then
            dpkg -i "${DEPS_DIR}"/redis-server/*.deb 2>/dev/null || apt-get install -f -y
        else
            log_warn "未找到 Redis 离线包，尝试在线安装..."
            apt-get install -y redis-server
        fi
    fi

    install_nodejs_binary

elif [[ "$OS_FAMILY" == "rhel" ]]; then
    # CentOS/RHEL
    if [[ "$MODE" == "full" ]]; then
        log_info "安装 PostgreSQL 15..."
        if [[ -d "${DEPS_DIR}/postgresql15" ]]; then
            rpm -ivh "${DEPS_DIR}"/postgresql15/*.rpm --nodeps 2>/dev/null || true
        else
            log_warn "未找到 PostgreSQL 离线包"
        fi

        log_info "安装 Redis..."
        if [[ -d "${DEPS_DIR}/redis" ]]; then
            rpm -ivh "${DEPS_DIR}"/redis/*.rpm --nodeps 2>/dev/null || true
        else
            log_warn "未找到 Redis 离线包"
        fi
    fi

    install_nodejs_binary
else
    install_nodejs_binary
fi

# =============================================================================
# STEP 2: 初始化数据库 (PostgreSQL 模式)
# =============================================================================
log_step "2/8 初始化数据库..."

if [[ "$MODE" == "full" ]]; then
    # 启动 PostgreSQL
    if command -v systemctl &> /dev/null; then
        systemctl enable postgresql || systemctl enable postgresql-14 || true
        systemctl start postgresql || systemctl start postgresql-14 || true
    fi

    # 等待 PostgreSQL 就绪
    sleep 2
    PG_USER="postgres"
    if ! command -v psql &> /dev/null; then
        PG_USER="postgres"
        PG_BIN="/usr/lib/postgresql/14/bin/psql"
        if [[ ! -x "$PG_BIN" ]]; then
            PG_BIN=$(find /usr -name psql -type f 2>/dev/null | head -1)
        fi
    else
        PG_BIN="psql"
    fi

    # 创建数据库用户和数据库
    log_info "创建数据库用户 ${DB_USER} 和数据库 ${DB_NAME}..."
    sudo -u postgres "${PG_BIN}" -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" 2>/dev/null || log_warn "用户可能已存在"
    sudo -u postgres "${PG_BIN}" -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null || log_warn "数据库可能已存在"
    sudo -u postgres "${PG_BIN}" -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" 2>/dev/null || true
    sudo -u postgres "${PG_BIN}" -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" 2>/dev/null || true

    # 启动 Redis
    if command -v redis-cli &> /dev/null; then
        systemctl enable redis-server 2>/dev/null || systemctl enable redis 2>/dev/null || true
        systemctl start redis-server 2>/dev/null || systemctl start redis 2>/dev/null || true
        log_info "Redis 已启动"
    fi
else
    log_info "Lite 模式: 跳过 PostgreSQL/Redis 安装，使用内置 SQLite"
    DB_HOST=""
    REDIS_HOST=""
fi

# =============================================================================
# STEP 3: 创建运行用户
# =============================================================================
log_step "3/8 创建运行用户..."

if ! id "$RUN_USER" &>/dev/null; then
    useradd -r -s /bin/false -d "$INSTALL_DIR" -M "$RUN_USER"
    log_info "用户 ${RUN_USER} 已创建"
else
    log_warn "用户 ${RUN_USER} 已存在，跳过"
fi

# =============================================================================
# STEP 4: 部署应用文件
# =============================================================================
log_step "4/8 部署应用文件..."

mkdir -p "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/config"
mkdir -p "${INSTALL_DIR}/logs"
mkdir -p "${INSTALL_DIR}/data"
mkdir -p "${INSTALL_DIR}/frontend"
mkdir -p "${INSTALL_DIR}/agent-runtime"

# 后端二进制
if [[ -f "${PROJECT_ROOT}/bin/cloudops-backend" ]]; then
    cp "${PROJECT_ROOT}/bin/cloudops-backend" "${INSTALL_DIR}/"
    chmod +x "${INSTALL_DIR}/cloudops-backend"
    log_info "后端二进制已部署"
else
    log_error "未找到后端二进制文件: ${PROJECT_ROOT}/bin/cloudops-backend"
    exit 1
fi

# 前端静态文件
if [[ -d "${PROJECT_ROOT}/frontend/dist" ]]; then
    cp -r "${PROJECT_ROOT}/frontend/dist" "${INSTALL_DIR}/frontend/"
    log_info "前端静态文件已部署"
else
    log_warn "未找到前端构建产物"
fi

# Agent Runtime
if [[ -d "${PROJECT_ROOT}/agent-runtime/dist" ]]; then
    cp -r "${PROJECT_ROOT}/agent-runtime/dist" "${INSTALL_DIR}/agent-runtime/"
    cp "${PROJECT_ROOT}/agent-runtime/package.json" "${INSTALL_DIR}/agent-runtime/" 2>/dev/null || true
    if [[ -d "${PROJECT_ROOT}/agent-runtime/node_modules" ]]; then
        cp -r "${PROJECT_ROOT}/agent-runtime/node_modules" "${INSTALL_DIR}/agent-runtime/"
    fi
    log_info "Agent Runtime 已部署"
else
    log_warn "未找到 Agent Runtime 构建产物"
fi

# 创建必要的目录
mkdir -p /var/lib/cloudops-sandbox
mkdir -p /var/lib/cloudops/recordings
mkdir -p /var/log/cloudops
chown -R "${RUN_USER}:${RUN_USER}" /var/lib/cloudops-sandbox /var/lib/cloudops /var/log/cloudops

# =============================================================================
# STEP 5: 生成配置文件
# =============================================================================
log_step "5/8 生成配置文件..."

CONFIG_FILE="${INSTALL_DIR}/config/config.yaml"

# 根据模式生成配置
cat > "$CONFIG_FILE" <<EOF
# CloudOps Platform 配置文件
# 生成时间: $(date -Iseconds)
# 部署模式: ${MODE}

server:
  backend:
    host: "0.0.0.0"
    port: ${BACKEND_PORT}
    mode: "release"
    read_timeout: 60s
    write_timeout: 600s
    max_connections: 10000

  frontend:
    host: "0.0.0.0"
    port: ${FRONTEND_PORT}

  ai_service:
    host: "0.0.0.0"
    port: 8001
    enabled: true

database:
EOF

if [[ "$MODE" == "full" ]]; then
    cat >> "$CONFIG_FILE" <<EOF
  postgres:
    host: "${DB_HOST}"
    port: ${DB_PORT}
    database: "${DB_NAME}"
    username: "${DB_USER}"
    password: "${DB_PASSWORD}"
    ssl_mode: "disable"
    max_connections: 100
    max_idle: 10

  redis:
    host: "${REDIS_HOST}"
    port: ${REDIS_PORT}
    db: 0
    pool_size: 100
EOF
else
    cat >> "$CONFIG_FILE" <<EOF
  postgres:
    host: ""       # 留空使用 SQLite

  redis:
    host: ""       # 留空禁用 Redis
EOF
fi

cat >> "$CONFIG_FILE" <<EOF

kubernetes:
  connection_pool:
    max_size: 50
    idle_timeout: 10m
    health_check: 30s

  terminal:
    enabled: true
    max_sessions: 100
    session_timeout: 30m
    recording_enabled: true
    recording_path: "/var/lib/cloudops/recordings"
    allowed_shells:
      - "/bin/sh"
      - "/bin/bash"

security:
  jwt:
    secret: "${JWT_SECRET}"
    access_expire: 1h
    refresh_expire: 24h

  encryption:
    algorithm: "AES-256-GCM"
    key_id: "default"
    key: "${ENCRYPTION_KEY}"

  rate_limit:
    enabled: true
    requests_per_minute: 100
    burst: 20

  audit:
    enabled: true
    log_path: "/var/log/cloudops/audit.log"
    retention_days: 90

tenant:
  enabled: true
  max_tenants: 100
  default_tenant: "default"
  quotas:
    max_clusters: 20
    max_users: 100
    max_terminal_sessions: 50
    storage_quota_gb: 100

logging:
  level: "info"
  format: "json"
  output: "stdout"
  file:
    path: "/var/log/cloudops/app.log"
    max_size_mb: 100
    max_backups: 10
    max_age_days: 30
    compress: true
EOF

chown "${RUN_USER}:${RUN_USER}" "$CONFIG_FILE"
chmod 640 "$CONFIG_FILE"

# 保存环境变量文件（供参考）
ENV_FILE="${INSTALL_DIR}/.env"
cat > "$ENV_FILE" <<EOF
# CloudOps 环境变量
# 此文件仅供参考，实际配置在 config.yaml 中
CONFIG_PATH=${INSTALL_DIR}/config/config.yaml
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
EOF
if [[ "$MODE" == "full" ]]; then
    echo "DB_PASSWORD=${DB_PASSWORD}" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

log_info "配置文件已生成: ${CONFIG_FILE}"

# =============================================================================
# STEP 6: 创建 systemd 服务
# =============================================================================
log_step "6/8 创建 systemd 服务..."

# 后端服务
cat > /etc/systemd/system/cloudops-backend.service <<EOF
[Unit]
Description=CloudOps Backend
After=network.target
EOF

if [[ "$MODE" == "full" ]]; then
    cat >> /etc/systemd/system/cloudops-backend.service <<EOF
After=postgresql.service redis-server.service
EOF
fi

cat >> /etc/systemd/system/cloudops-backend.service <<EOF

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/cloudops-backend
Restart=on-failure
RestartSec=5
Environment="CONFIG_PATH=${INSTALL_DIR}/config/config.yaml"
Environment="GIN_MODE=release"
Environment="JWT_SECRET=${JWT_SECRET}"
Environment="ENCRYPTION_KEY=${ENCRYPTION_KEY}"

[Install]
WantedBy=multi-user.target
EOF

# 前端服务
cat > /etc/systemd/system/cloudops-frontend.service <<EOF
[Unit]
Description=CloudOps Frontend
After=network.target cloudops-backend.service

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}/frontend/dist
ExecStart=/usr/local/bin/npx vite preview --port ${FRONTEND_PORT} --host
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cloudops-backend cloudops-frontend
log_info "systemd 服务已创建并启用"

# =============================================================================
# STEP 7: 设置权限
# =============================================================================
log_step "7/8 设置文件权限..."

chown -R "${RUN_USER}:${RUN_USER}" "${INSTALL_DIR}"
chmod 750 "${INSTALL_DIR}"
chmod +x "${INSTALL_DIR}/cloudops-backend"

# =============================================================================
# STEP 8: 启动服务
# =============================================================================
log_step "8/8 启动服务..."

if [[ "$MODE" == "full" ]]; then
    systemctl start postgresql 2>/dev/null || systemctl start postgresql-14 2>/dev/null || true
    systemctl start redis-server 2>/dev/null || systemctl start redis 2>/dev/null || true
    sleep 2
fi

systemctl start cloudops-backend
sleep 3

# 健康检查
if curl -s "http://127.0.0.1:${BACKEND_PORT}/health" > /dev/null 2>&1; then
    log_info "后端服务启动成功"
else
    log_warn "后端服务可能未就绪，请检查日志: journalctl -u cloudops-backend -f"
fi

systemctl start cloudops-frontend
sleep 2

# =============================================================================
# 安装完成报告
# =============================================================================
echo ""
log_info "================================================"
log_info "CloudOps 安装完成！"
log_info "================================================"
echo ""
echo -e "${GREEN}访问地址:${NC}"
echo "  前端页面: http://<服务器IP>:${FRONTEND_PORT}"
echo "  后端 API: http://<服务器IP>:${BACKEND_PORT}"
echo "  健康检查: http://127.0.0.1:${BACKEND_PORT}/health"
echo ""
echo -e "${GREEN}默认账号:${NC}"
echo "  用户名: admin"
echo "  密码:   admin"
echo ""
if [[ "$MODE" == "full" ]]; then
    echo -e "${GREEN}数据库信息:${NC}"
    echo "  地址: ${DB_HOST}:${DB_PORT}"
    echo "  数据库: ${DB_NAME}"
    echo "  用户: ${DB_USER}"
    echo "  密码: ${DB_PASSWORD}"
    echo ""
fi
echo -e "${GREEN}安装目录:${NC} ${INSTALL_DIR}"
echo -e "${GREEN}配置文件:${NC} ${CONFIG_FILE}"
echo -e "${GREEN}环境变量:${NC} ${ENV_FILE}"
echo ""
echo -e "${GREEN}服务管理:${NC}"
echo "  启动: systemctl start cloudops-backend cloudops-frontend"
echo "  停止: systemctl stop cloudops-backend cloudops-frontend"
echo "  状态: systemctl status cloudops-backend"
echo "  日志: journalctl -u cloudops-backend -f"
echo ""
echo -e "${YELLOW}安全提醒:${NC}"
echo "  1. 首次登录后请立即修改 admin 密码"
echo "  2. 请妥善保管 ${ENV_FILE} 中的密钥信息"
echo "  3. 生产环境建议配置 HTTPS 和防火墙规则"
echo ""
log_info "================================================"
