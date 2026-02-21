#!/bin/bash
# Smoke test: start service, wait 5 seconds, check it's still running, then kill it
set -e
cd "$(dirname "$0")/.."

# Load env
if [ -f "../frontend/.env.local" ]; then
  export $(grep -v '^#' ../frontend/.env.local | xargs)
fi

echo "=== Smoke Test: Starting orchestrator ==="
npx tsx src/index.ts &
PID=$!
sleep 5

if kill -0 $PID 2>/dev/null; then
  echo "✅ Service is running (PID $PID)"
  kill $PID
  wait $PID 2>/dev/null || true
  echo "✅ Service stopped gracefully"
  exit 0
else
  echo "❌ Service crashed within 5 seconds"
  exit 1
fi
