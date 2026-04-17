#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export CONFIG_PATH="$SCRIPT_DIR/config/config.yaml"
export JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
export GIN_MODE=release
export GOTOOLCHAIN=auto

echo "=== Starting CloudOps Platform ==="

# 1. Backend
echo "[1/3] Starting Backend..."
nohup ./bin/cloudops-backend > backend.log 2>&1 &
sleep 3
if curl -s http://127.0.0.1:9000/health >/dev/null; then
    echo "      Backend OK (http://127.0.0.1:9000)"
else
    echo "      Backend start failed, check backend.log"
    exit 1
fi

# 2. Agent Runtime
echo "[2/3] Starting Agent Runtime..."
nohup node agent-runtime/dist/server.js --port 19000 > agent-runtime.log 2>&1 &
sleep 1
echo "      Agent Runtime started (http://127.0.0.1:19000)"

# 3. Frontend
echo "[3/3] Starting Frontend..."
nohup npx --yes vite preview --port 18000 --host > frontend.log 2>&1 &
sleep 2
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18000 | grep -q 200; then
    echo "      Frontend OK (http://127.0.0.1:18000)"
else
    echo "      Frontend start delayed, may need a few more seconds"
fi

echo ""
echo "=== All services started ==="
echo "Frontend : http://<server-ip>:18000"
echo "Backend  : http://<server-ip>:9000"
echo "Agent    : http://127.0.0.1:19000"
echo "Default login: admin / admin"
echo ""
echo "Logs:"
echo "  backend.log"
echo "  agent-runtime.log"
echo "  frontend.log"
