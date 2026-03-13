#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ---------------------------------------------------------------------------
# Configuration (override via env vars)
# ---------------------------------------------------------------------------
MEM9_BASE_URL="${MEM9_BASE_URL:-https://api.mem9.ai}"
MEM9_BASE_URL="${MEM9_BASE_URL%/}"
MEM9_SPACE_ID=""
PROFILE_A="mem9_test_a"
PROFILE_B="mem9_test_b"
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

for cmd in jq curl openclaw python3; do
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
# Phase 1: Cleanup leftover profiles
# ---------------------------------------------------------------------------
echo "=== Phase 1: Cleanup leftover profiles ==="

for profile in "$PROFILE_A" "$PROFILE_B"; do
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
# Phase 2: Provision fresh mem9 space
# ---------------------------------------------------------------------------
echo "=== Phase 2: Configure mem9 space ==="

echo "--- mem9 base URL: $MEM9_BASE_URL"
echo "--- Provisioning fresh mem9 space"
TENANT_RESP=$(curl -sf -X POST "${MEM9_BASE_URL}/v1alpha1/mem9s")
MEM9_SPACE_ID=$(echo "$TENANT_RESP" | jq -r '.id')

if [[ -z "$MEM9_SPACE_ID" || "$MEM9_SPACE_ID" == "null" ]]; then
  echo "ERROR: Failed to provision mem9 space:"
  echo "$TENANT_RESP" | jq . 2>/dev/null || echo "$TENANT_RESP"
  exit 1
fi

echo "    Fresh space ID: $MEM9_SPACE_ID"

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

echo "--- Installing mem9 plugin into profile B"
openclaw --profile "$PROFILE_B" plugins install --link "$ROOT/openclaw-plugin"
openclaw --profile "$PROFILE_B" config set --strict-json plugins.allow '["mem9"]'
openclaw --profile "$PROFILE_B" config set plugins.slots.memory mem9
openclaw --profile "$PROFILE_B" config set plugins.entries.mem9.enabled true
openclaw --profile "$PROFILE_B" config set plugins.entries.mem9.config.apiUrl "$MEM9_BASE_URL"
openclaw --profile "$PROFILE_B" config set plugins.entries.mem9.config.apiKey "$MEM9_SPACE_ID"

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

GW_A_LOG="/tmp/mem9-bench-gw-a.log"
GW_B_LOG="/tmp/mem9-bench-gw-b.log"

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
# Phase 7: Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Benchmark complete!"
echo "============================================================"
echo ""
echo "  mem9 base URL: $MEM9_BASE_URL"
echo "  Fresh space ID: $MEM9_SPACE_ID"
echo "  Results:       $RESULTS_DIR"
echo "  HTML report:   $RESULTS_DIR/report.html"
echo "  Transcript:    $RESULTS_DIR/transcript.md"
echo "  JSON output:   $RESULTS_DIR/benchmark-results.json"
echo ""
echo "  Running processes:"
echo "    Gateway A     pid=$GW_A_PID   port=$PORT_A (baseline)"
echo "    Gateway B     pid=$GW_B_PID   port=$PORT_B (treatment/mem9)"
echo ""
echo "  Web UIs:"
echo "    Baseline:   http://localhost:$PORT_A  (password: $GATEWAY_TOKEN)"
echo "    Treatment:  http://localhost:$PORT_B  (password: $GATEWAY_TOKEN)"
echo "============================================================"
