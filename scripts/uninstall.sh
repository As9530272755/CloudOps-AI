#!/bin/bash
# =============================================================================
# CloudOps 卸载脚本
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="/opt/cloudops"
RUN_USER="cloudops"
DB_NAME="cloudops"
DB_USER="cloudops"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "================================================"
echo "CloudOps 卸载程序"
echo "================================================"
echo ""
echo "以下操作将执行："
echo "  1. 停止并禁用 cloudops 相关 systemd 服务"
echo "  2. 删除安装目录: ${INSTALL_DIR}"
echo "  3. 删除 systemd 服务配置"
echo "  4. 可选：删除 PostgreSQL 数据库和用户"
echo "  5. 可选：删除运行用户 ${RUN_USER}"
echo ""

read -p "确认卸载? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "卸载已取消"
    exit 0
fi

# 停止服务
log_info "停止服务..."
systemctl stop cloudops-backend cloudops-agent cloudops-frontend 2>/dev/null || true
systemctl disable cloudops-backend cloudops-agent cloudops-frontend 2>/dev/null || true

# 删除 systemd 配置
log_info "删除 systemd 服务配置..."
rm -f /etc/systemd/system/cloudops-backend.service
rm -f /etc/systemd/system/cloudops-agent.service
rm -f /etc/systemd/system/cloudops-frontend.service
systemctl daemon-reload

# 删除安装目录
if [[ -d "$INSTALL_DIR" ]]; then
    log_info "删除安装目录: ${INSTALL_DIR}"
    rm -rf "$INSTALL_DIR"
fi

# 删除日志目录
rm -rf /var/log/cloudops
rm -rf /var/lib/cloudops
rm -rf /var/lib/cloudops-sandbox

# 询问是否删除数据库
read -p "是否删除 PostgreSQL 数据库 ${DB_NAME} 和用户 ${DB_USER}? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v psql &> /dev/null; then
        sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" 2>/dev/null || true
        sudo -u postgres psql -c "DROP USER IF EXISTS ${DB_USER};" 2>/dev/null || true
        log_info "数据库已删除"
    else
        log_warn "未找到 psql，请手动删除数据库"
    fi
fi

# 询问是否删除用户
read -p "是否删除系统用户 ${RUN_USER}? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    userdel "$RUN_USER" 2>/dev/null || true
    log_info "用户 ${RUN_USER} 已删除"
fi

log_info "卸载完成"
