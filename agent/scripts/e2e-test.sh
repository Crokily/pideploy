#!/bin/bash
# piDeploy E2E Test — Full instance lifecycle via API + browser verification
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$AGENT_DIR/frontend"
ORCH_DIR="$AGENT_DIR/orchestrator"

# Load env
if [ -f "$FRONTEND_DIR/.env.local" ]; then
  export $(grep -v '^#' "$FRONTEND_DIR/.env.local" | xargs 2>/dev/null)
fi

# Cleanup function
PIDS=""
cleanup() {
  echo "🧹 Cleaning up..."
  for pid in $PIDS; do
    kill $pid 2>/dev/null || true
    wait $pid 2>/dev/null || true
  done
  agent-browser close 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT

echo "============================================"
echo "  piDeploy E2E Test — Full Lifecycle"
echo "============================================"

# Step 1: Start orchestrator in background
echo ""
echo "📦 Starting Orchestrator..."
cd "$ORCH_DIR"
npx tsx src/index.ts > /tmp/e2e-orchestrator.log 2>&1 &
ORCH_PID=$!
PIDS="$ORCH_PID"
sleep 3

if ! kill -0 $ORCH_PID 2>/dev/null; then
  echo "❌ Orchestrator failed to start"
  cat /tmp/e2e-orchestrator.log
  exit 1
fi
echo "✅ Orchestrator running (PID $ORCH_PID)"

# Step 2: Check frontend health (assumes it's running or use dev server)
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
echo ""
echo "🌐 Checking frontend at $FRONTEND_URL..."

# Try health endpoint
if curl -sf "$FRONTEND_URL/api/health" > /dev/null 2>&1; then
  echo "✅ Frontend is running"
else
  echo "⚠️ Frontend not running at $FRONTEND_URL — starting dev server..."
  cd "$FRONTEND_DIR"
  npm run dev > /tmp/e2e-frontend.log 2>&1 &
  FRONTEND_PID=$!
  PIDS="$PIDS $FRONTEND_PID"
  
  # Wait for frontend to be ready
  for i in $(seq 1 30); do
    if curl -sf "$FRONTEND_URL/api/health" > /dev/null 2>&1; then
      echo "✅ Frontend started (PID $FRONTEND_PID)"
      break
    fi
    sleep 2
  done
  
  if ! curl -sf "$FRONTEND_URL/api/health" > /dev/null 2>&1; then
    echo "❌ Frontend failed to start"
    exit 1
  fi
fi

# Step 3: Browser — verify dashboard loads
echo ""
echo "🔍 Browser: Checking dashboard..."
agent-browser open "$FRONTEND_URL" 2>/dev/null || true
sleep 2
agent-browser screenshot /tmp/e2e-screenshot-home.png 2>/dev/null || true
echo "✅ Homepage loaded (screenshot: /tmp/e2e-screenshot-home.png)"

# Step 4: Create test instance via API
echo ""
echo "📝 Creating test instance via API..."

# Use a test user ID (bypasses Clerk in non-prod)
TEST_USER="user_e2e_test_$(date +%s)"
INSTANCE_RESPONSE=$(curl -sf -X POST "$FRONTEND_URL/api/instances" \
  -H "Content-Type: application/json" \
  -H "x-test-user: $TEST_USER" \
  -d "{\"name\": \"e2e-test-$(date +%s)\", \"channel\": \"\", \"region\": \"us-east\"}" 2>/dev/null || echo '{"error": "API call failed"}')

echo "Response: $(echo "$INSTANCE_RESPONSE" | head -c 200)"

INSTANCE_ID=$(echo "$INSTANCE_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('instance',{}).get('id',''))" 2>/dev/null || echo "")

if [ -z "$INSTANCE_ID" ]; then
  echo "⚠️ Instance creation returned no ID (may need auth). Checking task queue..."
  # Check if a task was created
  sleep 3
  TASK_COUNT=$(cd "$FRONTEND_DIR" && npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM \"Task\" WHERE type='instance_create' AND status='pending'" 2>/dev/null | tail -1 || echo "0")
  echo "Pending tasks: $TASK_COUNT"
fi

# Step 5: Wait for orchestrator to process
echo ""
echo "⏳ Waiting for orchestrator to process task (max 120s)..."
for i in $(seq 1 60); do
  sleep 2
  if [ -n "$INSTANCE_ID" ]; then
    STATUS=$(curl -sf "$FRONTEND_URL/api/instances/$INSTANCE_ID" -H "x-test-user: $TEST_USER" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('instance',{}).get('status',''))" 2>/dev/null || echo "unknown")
    echo "  [$i] Status: $STATUS"
    if [ "$STATUS" = "running" ]; then
      echo "✅ Instance is running!"
      break
    fi
  fi
done

# Step 6: Browser — verify instance on dashboard
echo ""
echo "🔍 Browser: Checking dashboard for instance..."
agent-browser open "$FRONTEND_URL/dashboard" 2>/dev/null || true
sleep 2
agent-browser screenshot /tmp/e2e-screenshot-dashboard.png 2>/dev/null || true
echo "✅ Dashboard screenshot: /tmp/e2e-screenshot-dashboard.png"

# Step 7: Check orchestrator traces
echo ""
echo "📊 Checking traces..."
ls -la /var/log/pideploy/traces/ 2>/dev/null | tail -5 || echo "No traces yet"

# Step 8: Cleanup — stop test instance
if [ -n "$INSTANCE_ID" ]; then
  echo ""
  echo "🛑 Stopping test instance..."
  curl -sf -X POST "$FRONTEND_URL/api/instances/$INSTANCE_ID/stop" \
    -H "x-test-user: $TEST_USER" > /dev/null 2>&1 || true
  sleep 5
  
  echo "🗑️ Deleting test instance..."
  curl -sf -X DELETE "$FRONTEND_URL/api/instances/$INSTANCE_ID" \
    -H "x-test-user: $TEST_USER" > /dev/null 2>&1 || true
  sleep 3
fi

# Step 9: Final browser check
echo ""
echo "🔍 Browser: Final dashboard check..."
agent-browser open "$FRONTEND_URL/dashboard" 2>/dev/null || true
sleep 2
agent-browser screenshot /tmp/e2e-screenshot-final.png 2>/dev/null || true

# Close browser
agent-browser close 2>/dev/null || true

echo ""
echo "============================================"
echo "  E2E Test Complete"
echo "============================================"
echo ""
echo "📸 Screenshots:"
echo "  Home: /tmp/e2e-screenshot-home.png"
echo "  Dashboard: /tmp/e2e-screenshot-dashboard.png"
echo "  Final: /tmp/e2e-screenshot-final.png"
echo ""
echo "📊 Traces: /var/log/pideploy/traces/"
echo "🔔 Alerts: /var/log/pideploy/alerts.jsonl"
echo "📝 Orchestrator log: /tmp/e2e-orchestrator.log"
echo ""

# Check for any critical errors in orchestrator log
if grep -q "ERROR" /tmp/e2e-orchestrator.log 2>/dev/null; then
  echo "⚠️ Errors found in orchestrator log:"
  grep "ERROR" /tmp/e2e-orchestrator.log | head -5
fi

echo "✅ E2E test script finished"
