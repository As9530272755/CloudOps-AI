#!/bin/bash
export CONFIG_PATH=/data/projects/cloudops-v2/config/config.yaml
export JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}
export ENCRYPTION_KEY=${ENCRYPTION_KEY:-$(openssl rand -hex 32)}
export GIN_MODE=release
export GOTOOLCHAIN=auto
export GOPROXY=https://goproxy.cn,direct

cd /data/projects/cloudops-v2
exec ./cloudops-backend
