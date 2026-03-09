#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---------------------------------------------------------------------------
# Configuration (override via env vars)
# ---------------------------------------------------------------------------
TIDB_ZERO_API="${TIDB_ZERO_API:-https://zero.tidbapi.com/v1alpha1/instances}"
DB_NAME="${MNEMO_DB_NAME:-test}"
MNEMO_SERVER_PORT="${MNEMO_BENCH_PORT:-18081}"
PROFILE_A="mnemos_test_a"
PROFILE_B="mnemos_test_b"
PORT_A=50789
PORT_B=51789
GATEWAY_TOKEN="bench-token-123456"
BENCH_PROMPT_FILE="${BENCH_PROMPT_FILE:-}"
PROMPT_TIMEOUT="${BENCH_PROMPT_TIMEOUT:-600}"

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if [[ -z "${CLAUDE_CODE_TOKEN:-}" ]]; then
  echo "ERROR: CLAUDE_CODE_TOKEN is required but not set."
  echo "  export CLAUDE_CODE_TOKEN='your-api-key'"
  exit 1
fi

if [[ -z "$BENCH_PROMPT_FILE" ]]; then
  echo "ERROR: BENCH_PROMPT_FILE is required but not set."
  echo "  export BENCH_PROMPT_FILE='path/to/prompts.yaml'"
  exit 1
fi

for cmd in jq mysql openclaw python3; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "ERROR: $cmd is required but not installed."
    exit 1
  }
done

python3 -c "import yaml" 2>/dev/null || {
  echo "ERROR: Python pyyaml is required. Install with: pip3 install pyyaml"
  exit 1
}

# ---------------------------------------------------------------------------
# Cleanup handler — only cleans up mnemo-server, NOT gateways
# ---------------------------------------------------------------------------
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    echo "--- Stopping mnemo-server (pid $SERVER_PID)"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Phase 1: Cleanup leftover profiles
# ---------------------------------------------------------------------------
echo "=== Phase 1: Cleanup leftover profiles ==="

for profile in "$PROFILE_A" "$PROFILE_B"; do
  # Stop gateway if running from a previous benchmark
  if openclaw --profile "$profile" health >/dev/null 2>&1; then
    echo "    Stopping leftover gateway for profile: $profile"
    openclaw --profile "$profile" gateway stop 2>/dev/null || true
  fi
  profile_dir="$HOME/.openclaw-${profile}"
  workspace_dir="$HOME/.openclaw/workspace-${profile}"
  if [[ -d "$profile_dir" ]]; then
    echo "    Removing profile dir: $profile_dir"
    rm -rf "$profile_dir"
  fi
  if [[ -d "$workspace_dir" ]]; then
    echo "    Removing workspace dir: $workspace_dir"
    rm -rf "$workspace_dir"
  fi
done

echo "    Cleanup complete."

# ---------------------------------------------------------------------------
# Phase 2: Provision TiDB Zero + mnemo-server
# ---------------------------------------------------------------------------
echo "=== Phase 2: Provision TiDB Zero + mnemo-server ==="

echo "--- Provisioning TiDB Zero cluster"
ZERO_RESP=$(curl -sf --retry 3 -X POST "$TIDB_ZERO_API" \
  -H "Content-Type: application/json" \
  -d '{"tag":"mnemo-bench"}')

DB_HOST=$(echo "$ZERO_RESP" | jq -r '.instance.connection.host')
DB_PORT=$(echo "$ZERO_RESP" | jq -r '.instance.connection.port')
DB_USER=$(echo "$ZERO_RESP" | jq -r '.instance.connection.username')
DB_PASS=$(echo "$ZERO_RESP" | jq -r '.instance.connection.password')
CLUSTER_ID=$(echo "$ZERO_RESP" | jq -r '.instance.id')
CLAIM_URL=$(echo "$ZERO_RESP" | jq -r '.instance.claimInfo.claimUrl')

if [[ -z "$DB_HOST" || "$DB_HOST" == "null" ]]; then
  echo "ERROR: Failed to parse TiDB Zero response:"
  echo "$ZERO_RESP" | jq . 2>/dev/null || echo "$ZERO_RESP"
  exit 1
fi

echo "    Cluster ID: $CLUSTER_ID"
echo "    Host:       $DB_HOST:$DB_PORT"
echo "    Claim URL:  $CLAIM_URL"

DSN="${DB_USER}:${DB_PASS}@tcp(${DB_HOST}:${DB_PORT})/${DB_NAME}?parseTime=true&tls=true"

echo "    Waiting for TiDB at ${DB_HOST}:${DB_PORT}..."
for i in $(seq 1 60); do
  if MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
       --ssl-mode=REQUIRED -e "SELECT 1" >/dev/null 2>&1; then
    echo "    TiDB ready."
    break
  fi
  sleep 2
done

if ! MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
     --ssl-mode=REQUIRED -e "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: TiDB Zero cluster failed to become ready within 120s."
  exit 1
fi

echo "--- Applying schema to ${DB_HOST}:${DB_PORT}/${DB_NAME}"
MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -D "$DB_NAME" \
  --ssl-mode=REQUIRED < "$ROOT/server/schema.sql"
echo "    Schema applied."

echo "--- Building mnemo-server"
cd "$ROOT/server"
go build -o "$ROOT/server/mnemo-server" ./cmd/mnemo-server
cd "$ROOT"

echo "--- Starting mnemo-server on port $MNEMO_SERVER_PORT"
MNEMO_DSN="$DSN" MNEMO_PORT="$MNEMO_SERVER_PORT" "$ROOT/server/mnemo-server" \
  > /tmp/mnemo-bench-server.log 2>&1 &
SERVER_PID=$!

for i in $(seq 1 30); do
  if curl -sf "http://localhost:${MNEMO_SERVER_PORT}/healthz" >/dev/null 2>&1; then
    echo "    Server ready (pid $SERVER_PID)."
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "ERROR: Server exited unexpectedly. Logs:"
    cat /tmp/mnemo-bench-server.log
    exit 1
  fi
  sleep 0.5
done

if ! curl -sf "http://localhost:${MNEMO_SERVER_PORT}/healthz" >/dev/null 2>&1; then
  echo "ERROR: Server failed to start within 15s. Logs:"
  cat /tmp/mnemo-bench-server.log
  exit 1
fi

echo "--- Provisioning tenant"
TENANT_RESP=$(curl -sf -X POST "http://localhost:${MNEMO_SERVER_PORT}/v1alpha1/mem9s")
MNEMO_TENANT_ID=$(echo "$TENANT_RESP" | jq -r '.id')

if [[ -z "$MNEMO_TENANT_ID" || "$MNEMO_TENANT_ID" == "null" ]]; then
  echo "ERROR: Failed to provision tenant:"
  echo "$TENANT_RESP" | jq . 2>/dev/null || echo "$TENANT_RESP"
  exit 1
fi
echo "    Tenant ID: $MNEMO_TENANT_ID"

# ---------------------------------------------------------------------------
# Phase 3: Create profiles
# ---------------------------------------------------------------------------
echo "=== Phase 3: Create OpenClaw profiles ==="

echo "--- Configuring profile A (baseline, port $PORT_A)"
openclaw --profile "$PROFILE_A" config set gateway.mode local
openclaw --profile "$PROFILE_A" config set gateway.port "$PORT_A"
openclaw --profile "$PROFILE_A" config set gateway.auth.token "$GATEWAY_TOKEN"
openclaw --profile "$PROFILE_A" config set agents.defaults.model.primary "anthropic/claude-sonnet-4-6"
echo "ANTHROPIC_API_KEY=${CLAUDE_CODE_TOKEN}" > "$HOME/.openclaw-${PROFILE_A}/.env"
echo "    Wrote API key to $HOME/.openclaw-${PROFILE_A}/.env"

echo "--- Configuring profile B (treatment, port $PORT_B)"
openclaw --profile "$PROFILE_B" config set gateway.mode local
openclaw --profile "$PROFILE_B" config set gateway.port "$PORT_B"
openclaw --profile "$PROFILE_B" config set gateway.auth.token "$GATEWAY_TOKEN"
openclaw --profile "$PROFILE_B" config set agents.defaults.model.primary "anthropic/claude-sonnet-4-6"
echo "ANTHROPIC_API_KEY=${CLAUDE_CODE_TOKEN}" > "$HOME/.openclaw-${PROFILE_B}/.env"
echo "    Wrote API key to $HOME/.openclaw-${PROFILE_B}/.env"
echo "--- Installing mnemo plugin into profile B"
openclaw --profile "$PROFILE_B" plugins install --link "$ROOT/openclaw-plugin"
openclaw --profile "$PROFILE_B" config set plugins.slots.memory mnemo
openclaw --profile "$PROFILE_B" config set plugins.entries.mnemo.enabled true
openclaw --profile "$PROFILE_B" config set plugins.entries.mnemo.config.apiUrl "http://localhost:${MNEMO_SERVER_PORT}"
openclaw --profile "$PROFILE_B" config set plugins.entries.mnemo.config.tenantID "${MNEMO_TENANT_ID}"

# reinstall & restart daemon
openclaw --profile "$PROFILE_A" daemon install
openclaw --profile "$PROFILE_B" daemon install
openclaw --profile "$PROFILE_A" daemon restart
openclaw --profile "$PROFILE_B" daemon restart
openclaw --profile "$PROFILE_A" gateway restart
openclaw --profile "$PROFILE_B" gateway restart

# ---------------------------------------------------------------------------
# Phase 4: Workspace setup
# ---------------------------------------------------------------------------
echo "=== Phase 4: Workspace setup ==="

for profile in "$PROFILE_A" "$PROFILE_B"; do
  ws_dir="$HOME/.openclaw/workspace-${profile}"
  mkdir -p "$ws_dir"
  cp "$ROOT/benchmark/workspace/SOUL.md" "$ws_dir/"
  cp "$ROOT/benchmark/workspace/IDENTITY.md" "$ws_dir/"
  cp "$ROOT/benchmark/workspace/USER.md" "$ws_dir/"
  echo "    Copied workspace files to $ws_dir"
done

# ---------------------------------------------------------------------------
# Phase 5: Start gateways
# ---------------------------------------------------------------------------
echo "=== Phase 5: Start gateways ==="

GW_A_LOG="/tmp/mnemo-bench-gw-a.log"
GW_B_LOG="/tmp/mnemo-bench-gw-b.log"

echo "--- Starting gateway A (baseline) on port $PORT_A"
nohup openclaw --profile "$PROFILE_A" gateway > "$GW_A_LOG" 2>&1 &
GW_A_PID=$!
echo "    Gateway A pid: $GW_A_PID  log: $GW_A_LOG"

echo "--- Starting gateway B (treatment) on port $PORT_B"
nohup openclaw --profile "$PROFILE_B" gateway > "$GW_B_LOG" 2>&1 &
GW_B_PID=$!
echo "    Gateway B pid: $GW_B_PID  log: $GW_B_LOG"

echo "--- Waiting for gateways to be healthy..."
for gw_port in "$PORT_A" "$PORT_B"; do
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:${gw_port}/health" >/dev/null 2>&1; then
      echo "    Gateway on port $gw_port ready."
      break
    fi
    if [[ "$gw_port" == "$PORT_A" ]] && ! kill -0 "$GW_A_PID" 2>/dev/null; then
      echo "ERROR: Gateway A exited unexpectedly. Logs:"; tail -30 "$GW_A_LOG"
      exit 1
    fi
    if [[ "$gw_port" == "$PORT_B" ]] && ! kill -0 "$GW_B_PID" 2>/dev/null; then
      echo "ERROR: Gateway B exited unexpectedly. Logs:"; tail -30 "$GW_B_LOG"
      exit 1
    fi
    sleep 1
  done
  if ! curl -sf "http://localhost:${gw_port}/health" >/dev/null 2>&1; then
    echo "ERROR: Gateway on port $gw_port failed to start within 60s."
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Phase 6: Run benchmark
# ---------------------------------------------------------------------------
echo "=== Phase 6: Run benchmark ==="

RESULTS_DIR="$ROOT/benchmark/results/$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

python3 "$ROOT/benchmark/scripts/drive-session.py" \
  --prompt-file "$BENCH_PROMPT_FILE" \
  --results-dir "$RESULTS_DIR" \
  --profile-a "$PROFILE_A" \
  --profile-b "$PROFILE_B" \
  --timeout "$PROMPT_TIMEOUT"

echo "--- Generating HTML report"
python3 "$ROOT/benchmark/scripts/report.py" \
  "$RESULTS_DIR/benchmark-results.json" > "$RESULTS_DIR/report.html"
echo "    Report written to $RESULTS_DIR/report.html"

# ---------------------------------------------------------------------------
# Phase 7: Summary (leave environment running)
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Benchmark complete!"
echo "============================================================"
echo ""
echo "  Results:       $RESULTS_DIR"
echo "  HTML report:   $RESULTS_DIR/report.html"
echo "  Transcript:    $RESULTS_DIR/transcript.md"
echo "  JSON output:   $RESULTS_DIR/benchmark-results.json"
echo ""
echo "  Running processes:"
echo "    mnemo-server  pid=$SERVER_PID  port=$MNEMO_SERVER_PORT"
echo "    Gateway A     pid=$GW_A_PID   port=$PORT_A (baseline)"
echo "    Gateway B     pid=$GW_B_PID   port=$PORT_B (treatment/mnemo)"
echo ""
echo "  Web UIs:"
echo "    Baseline:   http://localhost:$PORT_A  (password: $GATEWAY_TOKEN)"
echo "    Treatment:  http://localhost:$PORT_B  (password: $GATEWAY_TOKEN)"
echo ""
echo "  To teardown manually:"
echo "    kill $GW_A_PID $GW_B_PID $SERVER_PID"
echo "============================================================"

# Disable the cleanup trap so server stays running
trap - EXIT
