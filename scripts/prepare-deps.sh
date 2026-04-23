#!/bin/bash
# =============================================================================
# CloudOps 离线依赖预打包脚本
# 用途：在联网机器上预下载所有系统级依赖，供离线环境安装使用
# 用法：./prepare-deps.sh --os ubuntu|centos [--node-version 22.14.0]
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_DIR="${PROJECT_ROOT}/deps"
NODE_VERSION="22.14.0"
OS_TYPE=""

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
    --os <ubuntu|centos>     目标操作系统类型（必填）
    --output <dir>            输出目录（默认: ./deps）
    --node-version <version>  Node.js 版本（默认: 22.14.0）
    -h, --help               显示帮助

Examples:
    ./prepare-deps.sh --os ubuntu
    ./prepare-deps.sh --os centos --output /tmp/cloudops-deps
EOF
    exit 0
}

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --os)
            OS_TYPE="$2"
            shift 2
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --node-version)
            NODE_VERSION="$2"
            shift 2
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

if [[ -z "$OS_TYPE" ]]; then
    log_error "请指定 --os 参数（ubuntu 或 centos）"
    usage
fi

if [[ "$OS_TYPE" != "ubuntu" && "$OS_TYPE" != "centos" ]]; then
    log_error "不支持的 OS 类型: $OS_TYPE，仅支持 ubuntu 或 centos"
    exit 1
fi

# 检测联网
if ! curl -s --max-time 5 https://www.baidu.com > /dev/null; then
    log_warn "似乎无法访问互联网，请确认网络连接正常"
    read -p "是否继续? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

log_info "开始准备 ${OS_TYPE} 离线依赖包..."
log_info "输出目录: ${OUTPUT_DIR}"
log_info "Node.js 版本: ${NODE_VERSION}"

mkdir -p "${OUTPUT_DIR}"
cd "${OUTPUT_DIR}"

# =============================================================================
# 复制 kubectl 二进制（Web 终端必需）
# =============================================================================
log_info "复制 kubectl 二进制..."
mkdir -p data
if [[ -f "${PROJECT_ROOT}/data/kubectl" ]]; then
    cp "${PROJECT_ROOT}/data/kubectl" data/
    chmod +x data/kubectl
    log_info "kubectl 已复制到 ${OUTPUT_DIR}/data/"
else
    log_warn "未找到 ${PROJECT_ROOT}/data/kubectl，Web 终端功能将不可用"
fi
if [[ -f "${PROJECT_ROOT}/data/kubectl-completion.bash" ]]; then
    cp "${PROJECT_ROOT}/data/kubectl-completion.bash" data/
    log_info "kubectl-completion.bash 已复制"
fi

# =============================================================================
# 下载 Node.js 预编译二进制（通用，不依赖系统包管理器）
# =============================================================================
log_info "下载 Node.js ${NODE_VERSION} 预编译二进制..."
mkdir -p nodejs
cd nodejs

NODE_TARBALL="node-v${NODE_VERSION}-linux-x64.tar.xz"
if [[ -f "$NODE_TARBALL" ]]; then
    log_warn "Node.js  tarball 已存在，跳过下载"
else
    curl -fsSL -o "$NODE_TARBALL" \
        "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}" \
        || curl -fsSL -o "$NODE_TARBALL" \
        "https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${NODE_TARBALL}"
    log_info "Node.js 下载完成: ${NODE_TARBALL}"
fi
cd ..

# =============================================================================
# OS 特定依赖
# =============================================================================
if [[ "$OS_TYPE" == "ubuntu" ]]; then
    log_info "准备 Ubuntu 依赖包 (DEB)..."

    # PostgreSQL 14
    log_info "下载 PostgreSQL 14 依赖..."
    mkdir -p postgresql-14
    cd postgresql-14
    apt-get update > /dev/null 2>&1 || true
    DEBS=$(apt-cache depends --recurse --no-recommends --no-suggests \
        --no-conflicts --no-breaks --no-replaces --no-enhances \
        postgresql-14 postgresql-client-14 libpq5 2>/dev/null \
        | grep "^\w" | sort -u | grep -v "^postgresql-14$")
    for pkg in $DEBS; do
        apt-get download "$pkg" 2>/dev/null || log_warn "跳过: $pkg"
    done
    # 最后下载主包
    apt-get download postgresql-14 postgresql-client-14 2>/dev/null || true
    cd ..

    # Redis
    log_info "下载 Redis 依赖..."
    mkdir -p redis-server
    cd redis-server
    DEBS=$(apt-cache depends --recurse --no-recommends --no-suggests \
        --no-conflicts --no-breaks --no-replaces --no-enhances \
        redis-server redis-tools libjemalloc2 2>/dev/null \
        | grep "^\w" | sort -u | grep -v "^redis-server$")
    for pkg in $DEBS; do
        apt-get download "$pkg" 2>/dev/null || log_warn "跳过: $pkg"
    done
    apt-get download redis-server redis-tools 2>/dev/null || true
    cd ..

    log_info "Ubuntu 依赖准备完成"

elif [[ "$OS_TYPE" == "centos" ]]; then
    log_info "准备 CentOS/RHEL 依赖包 (RPM)..."

    # 检查 yumdownloader
    if ! command -v yumdownloader &> /dev/null; then
        log_warn "yumdownloader 未安装，尝试安装 yum-utils..."
        yum install -y yum-utils 2>/dev/null || dnf install -y yum-utils 2>/dev/null || true
    fi

    # PostgreSQL 15
    log_info "下载 PostgreSQL 15 依赖..."
    mkdir -p postgresql15
    cd postgresql15
    if command -v yumdownloader &> /dev/null; then
        yumdownloader --resolve postgresql15 postgresql15-server postgresql15-contrib 2>/dev/null || true
    else
        log_warn "yumdownloader 不可用，请手动下载 RPM 包"
    fi
    cd ..

    # Redis
    log_info "下载 Redis 依赖..."
    mkdir -p redis
    cd redis
    if command -v yumdownloader &> /dev/null; then
        yumdownloader --resolve redis 2>/dev/null || true
    fi
    cd ..

    log_info "CentOS 依赖准备完成"
fi

# =============================================================================
# 汇总输出
# =============================================================================
cd "${OUTPUT_DIR}"

echo ""
log_info "依赖包准备完成！输出目录结构:"
find . -type f -name "*.deb" -o -name "*.rpm" -o -name "*.tar.xz" | sort | while read f; do
    size=$(du -h "$f" | cut -f1)
    echo "  ${size}  $f"
done

echo ""
log_info "请将以下目录打包，复制到离线服务器:"
echo "  ${OUTPUT_DIR}/"
echo ""
log_info "使用方式:"
echo "  tar czf cloudops-deps-${OS_TYPE}.tar.gz -C ${OUTPUT_DIR} ."
echo "  scp cloudops-deps-${OS_TYPE}.tar.gz root@offline-server:/opt/"
