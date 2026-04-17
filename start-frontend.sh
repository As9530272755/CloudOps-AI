#!/bin/bash
cd /data/projects/cloudops-v2/frontend
echo "请先确保 frontend/dist/ 已构建"
exec npx vite preview --port 18000 --host
