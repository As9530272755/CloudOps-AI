#!/bin/bash
cd /data/projects/cloudops-v2/agent-runtime
exec node dist/server.js --port 19000
