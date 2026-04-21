#!/bin/bash
pkill -f "cloudops-backend" 2>/dev/null || true
pkill -f "vite preview" 2>/dev/null || true
echo "All CloudOps services stopped."
