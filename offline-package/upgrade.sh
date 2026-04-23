#!/bin/bash
# =============================================================================
# CloudOps 离线升级脚本
# 用途：在已有 CloudOps 部署的服务器上执行增量升级
# 用法：./upgrade.sh [OPTIONS]
# 
# 与 install.sh 的区别：
#   - 不重新安装依赖（nginx/postgresql/redis）
#   - 不覆盖 config.yaml（保留现有数据库配置、JWT secret 等）
#   - 不重新创建数据库
#   - 只替换二进制、前端静态文件、data 目录
#   - 后端启动时自动执行 GORM AutoMigrate，数据库结构自动更新
# =============================================================================

set -e

# 默认配置
INSTALL_DIR="/opt/cloudops"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 自动检测：如果当前目录下就有 bin/ 和 deps/，说明是离线包根目录模式
if [[ -f "${SCRIPT_DIR}/bin/cloudops-backend" && -d "${SCRIPT_DIR}/deps" ]]; then
    PROJECT_ROOT="${SCRIPT_DIR}"
else
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
    --install-dir <dir>       安装目录 (默认: /opt/cloudops)
    -y, --yes                 自动确认，无需交互
    -h, --help                显示帮助

Examples:
    ./upgrade.sh                          # 交互式确认
    ./upgrade.sh --yes                    # 自动确认升级
EOF
    exit 0
}

# 解析参数
AUTO_CONFIRM=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --install-dir)
            INSTALL_DIR="$2"
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

# 检查旧版本是否存在
if [[ ! -d "${INSTALL_DIR}" ]]; then
    log_error "未找到安装目录: ${INSTALL_DIR}"
    log_error "请先运行 install.sh 进行首次安装"
    exit 1
fi

if [[ ! -f "${INSTALL_DIR}/config/config.yaml" ]]; then
    log_error "未找到配置文件: ${INSTALL_DIR}/config/config.yaml"
    log_error "该目录可能不是有效的 CloudOps 安装目录"
    exit 1
fi

# 确认升级
echo ""
echo "========================================"
echo "  CloudOps 增量升级"
echo "========================================"
echo ""
echo "安装目录: ${INSTALL_DIR}"
echo "升级包路径: ${PROJECT_ROOT}"
echo ""
echo "升级内容:"
echo "  ✓ 后端二进制 (bin/cloudops-backend)"
echo "  ✓ 前端静态文件 (frontend/dist)"
echo "  ✓ kubectl 二进制及补全脚本 (data/)"
echo ""
echo "保留不变:"
echo "  ✓ 配置文件 (config/config.yaml)"
echo "  ✓ 数据库 (由后端 AutoMigrate 自动更新表结构)"
echo "  ✓ nginx 配置"
echo "  ✓ systemd 服务配置"
echo ""

if [[ "${AUTO_CONFIRM}" != true ]]; then
    read -p "确认执行升级? [y/N]: " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "已取消升级"
        exit 0
    fi
fi

# =============================================================================
# STEP 1: 停止服务
# =============================================================================
log_step "1/4 停止现有服务..."

if command -v systemctl &> /dev/null; then
    systemctl stop cloudops-backend 2>/dev/null || true
    systemctl stop cloudops-frontend 2>/dev/null || true
    log_info "服务已停止"
else
    # 非 systemd 环境，尝试手动 kill
    pkill -f "cloudops-backend" 2>/dev/null || true
    log_warn "未检测到 systemd，已尝试终止进程"
fi

# =============================================================================
# STEP 2: 备份当前版本
# =============================================================================
log_step "2/4 备份当前版本..."

BACKUP_DIR="${INSTALL_DIR}/backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "${BACKUP_DIR}"

# 备份关键文件
cp "${INSTALL_DIR}/cloudops-backend" "${BACKUP_DIR}/" 2>/dev/null || true
if [[ -d "${INSTALL_DIR}/frontend/dist" ]]; then
    cp -r "${INSTALL_DIR}/frontend/dist" "${BACKUP_DIR}/" 2>/dev/null || true
fi
if [[ -f "${INSTALL_DIR}/config/config.yaml" ]]; then
    cp "${INSTALL_DIR}/config/config.yaml" "${BACKUP_DIR}/" 2>/dev/null || true
fi

log_info "备份已保存: ${BACKUP_DIR}"

# =============================================================================
# STEP 3: 替换文件
# =============================================================================
log_step "3/4 替换新版本文件..."

# 后端二进制
if [[ -f "${PROJECT_ROOT}/bin/cloudops-backend" ]]; then
    cp "${PROJECT_ROOT}/bin/cloudops-backend" "${INSTALL_DIR}/"
    chmod +x "${INSTALL_DIR}/cloudops-backend"
    log_info "后端二进制已更新"
else
    log_error "未找到后端二进制文件: ${PROJECT_ROOT}/bin/cloudops-backend"
    exit 1
fi

# 前端静态文件
if [[ -d "${PROJECT_ROOT}/frontend/dist" ]]; then
    rm -rf "${INSTALL_DIR}/frontend/dist"
    cp -r "${PROJECT_ROOT}/frontend/dist" "${INSTALL_DIR}/frontend/"
    log_info "前端静态文件已更新"
else
    log_warn "未找到前端构建产物"
fi

# data 目录（kubectl + 补全脚本）
if [[ -d "${PROJECT_ROOT}/data" ]]; then
    if [[ -f "${PROJECT_ROOT}/data/kubectl" ]]; then
        cp "${PROJECT_ROOT}/data/kubectl" "${INSTALL_DIR}/data/"
        chmod +x "${INSTALL_DIR}/data/kubectl"
        log_info "kubectl 二进制已更新"
    fi
    if [[ -f "${PROJECT_ROOT}/data/kubectl-completion.bash" ]]; then
        cp "${PROJECT_ROOT}/data/kubectl-completion.bash" "${INSTALL_DIR}/data/"
        log_info "kubectl 补全脚本已更新"
    fi
fi

# 前端静态服务器脚本（已弃用，保留兼容）
if [[ -f "${PROJECT_ROOT}/bin/serve-frontend.js" ]]; then
    mkdir -p "${INSTALL_DIR}/bin"
    cp "${PROJECT_ROOT}/bin/serve-frontend.js" "${INSTALL_DIR}/bin/"
fi

# =============================================================================
# STEP 4: 启动服务
# =============================================================================
log_step "4/4 启动服务..."

if command -v systemctl &> /dev/null; then
    systemctl daemon-reload
    systemctl start cloudops-backend
    sleep 2
    
    # 检查后端状态
    if systemctl is-active --quiet cloudops-backend; then
        log_info "后端服务启动成功"
    else
        log_warn "后端服务可能未正常启动，请检查: journalctl -u cloudops-backend -n 50"
    fi
    
    # 前端：nginx 或 cloudops-frontend
    if command -v nginx &> /dev/null; then
        systemctl reload nginx 2>/dev/null || systemctl start nginx
        log_info "nginx 已重载"
    else
        systemctl start cloudops-frontend 2>/dev/null || true
    fi
else
    # 非 systemd 环境
    log_warn "未检测到 systemd，请手动启动服务"
fi

# =============================================================================
# 完成
# =============================================================================
echo ""
echo "========================================"
echo "  CloudOps 升级完成"
echo "========================================"
echo ""
echo "安装目录: ${INSTALL_DIR}"
echo "备份目录: ${BACKUP_DIR}"
echo ""
echo "服务状态:"
if command -v systemctl &> /dev/null; then
    systemctl status cloudops-backend --no-pager 2>/dev/null || true
fi
echo ""
echo "常用命令:"
echo "  查看后端日志: journalctl -u cloudops-backend -f"
echo "  查看后端状态: systemctl status cloudops-backend"
echo "  回滚: cp ${BACKUP_DIR}/cloudops-backend ${INSTALL_DIR}/ && systemctl restart cloudops-backend"
echo ""
log_info "升级完成！数据库结构将在后端启动时由 AutoMigrate 自动更新。"
