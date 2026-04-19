#!/bin/bash
# 稳定重启 CloudOps Backend（先清理残留的 agent-runtime）

cd "$(dirname "$0")"

echo "🔍 检查旧进程..."
# 杀掉 Go 后端主进程
pkill -f "./cloudops-backend" 2>/dev/null
sleep 1

# 杀掉残留的 agent-runtime (Node.js)
pkill -f "agent-runtime/dist/server.js" 2>/dev/null
sleep 1

# 确认 19000 端口已释放
for i in {1..5}; do
  if ! lsof -i :19000 >/dev/null 2>&1; then
    break
  fi
  echo "⏳ 等待 19000 端口释放..."
  sleep 1
done

echo "🚀 启动后端..."
nohup ./cloudops-backend > backend.log 2>&1 &

sleep 2
PID=$(pgrep -f "./cloudops-backend")
if [ -n "$PID" ]; then
  echo "✅ 后端已启动 (PID: $PID)"
else
  echo "❌ 启动失败，请检查 backend.log"
fi
