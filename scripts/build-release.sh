#!/bin/bash
# =============================================================================
# CloudOps 发布构建脚本
# 用途：确保离线包永远包含最新的前后端构建产物
# 用法：./scripts/build-release.sh
# =============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "========================================"
echo "CloudOps 发布构建"
echo "========================================"

# 1. 记录源码最后修改时间
SRC_MTIME=$(stat -c "%Y" frontend/src/pages/ClusterDetail.tsx)
echo "源码最后修改: $(date -d @$SRC_MTIME '+%Y-%m-%d %H:%M:%S')"

# 2. 构建后端
echo ""
echo "[1/5] 构建后端..."
go build -o cloudops-backend ./cmd/server
echo "✅ 后端构建完成: cloudops-backend"

# 3. 清除前端缓存 + 构建
echo ""
echo "[2/5] 清除前端缓存并构建..."
rm -rf frontend/dist frontend/node_modules/.vite
cd frontend
npm run build
cd ..
echo "✅ 前端构建完成"

# 4. 验证：确保构建产物时间晚于源码修改时间
BUILD_MTIME=$(stat -c "%Y" frontend/dist/assets/index-*.js | sort -n | tail -1)
echo ""
echo "构建产物时间: $(date -d @$BUILD_MTIME '+%Y-%m-%d %H:%M:%S')"

if [ "$BUILD_MTIME" -lt "$SRC_MTIME" ]; then
    echo "❌ ERROR: 构建产物时间早于源码修改时间！缓存未清除干净！"
    exit 1
fi
echo "✅ 构建产物时间验证通过"

# 5. 复制到离线包目录
echo ""
echo "[3/5] 复制构建产物到 offline-package..."
rm -rf offline-package/frontend/dist
cp -r frontend/dist offline-package/frontend/dist
cp cloudops-backend offline-package/bin/cloudops-backend
echo "✅ 复制完成"

# 6. 二次验证：检查关键修复是否在离线包中
echo ""
echo "[4/5] 验证离线包中的关键修复..."

# 检查 nsInitializedRef 修复（如果源码中有）
if grep -q "nsInitializedRef" frontend/src/pages/ClusterDetail.tsx 2>/dev/null; then
    if grep -q "nsInitializedRef\|\.current.*!0.*data\.length" offline-package/frontend/dist/assets/index-*.js 2>/dev/null; then
        echo "✅ nsInitializedRef 修复已打入离线包"
    else
        echo "❌ ERROR: 源码包含 nsInitializedRef 但离线包中缺失！"
        exit 1
    fi
fi

# 检查 AbortController 修复（如果源码中有）
if grep -q "AbortController" frontend/src/pages/ClusterDetail.tsx 2>/dev/null; then
    if grep -q "AbortController" offline-package/frontend/dist/assets/index-*.js 2>/dev/null; then
        echo "✅ AbortController 修复已打入离线包"
    else
        echo "❌ ERROR: 源码包含 AbortController 但离线包中缺失！"
        exit 1
    fi
fi

# 7. 生成 tar.gz
echo ""
echo "[5/5] 生成离线包..."
TIMESTAMP=$(date +%Y%m%d-%H%M)
rm -f cloudops-offline-ubuntu22-*.tar.gz
tar czf "cloudops-offline-ubuntu22-${TIMESTAMP}.tar.gz" --exclude='*.tar.gz' --exclude='.git' offline-package/
PKG_SIZE=$(du -h "cloudops-offline-ubuntu22-${TIMESTAMP}.tar.gz" | cut -f1)
echo "✅ 离线包生成完成: cloudops-offline-ubuntu22-${TIMESTAMP}.tar.gz (${PKG_SIZE})"

echo ""
echo "========================================"
echo "构建成功！"
echo "========================================"
echo ""
echo "下一步:"
echo "  1. 测试本地服务: curl http://localhost:9000/health"
echo "  2. Git commit + push"
echo "  3. 将离线包分发给用户: scp cloudops-offline-ubuntu22-${TIMESTAMP}.tar.gz <服务器>"
echo ""
