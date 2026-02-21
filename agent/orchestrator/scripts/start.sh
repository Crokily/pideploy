#!/bin/bash
# Start piDeploy Orchestrator
set -e
cd "$(dirname "$0")/.."

# Load env from frontend if available
if [ -f "../frontend/.env.local" ]; then
  export $(grep -v '^#' ../frontend/.env.local | xargs)
fi

echo "Starting piDeploy Orchestrator..."
exec npx tsx src/index.ts
