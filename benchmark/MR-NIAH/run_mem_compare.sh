#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MRNIAH_DIR="$ROOT/benchmark/MR-NIAH"
INDEX_FILE="$MRNIAH_DIR/output/index.jsonl"

BASE_PROFILE="${MRNIAH_BASE_PROFILE:-${BASE_PROFILE:-mrniah_local}}"
MEM_PROFILE="${MRNIAH_MEM_PROFILE:-${MEM_PROFILE:-mrniah_mem}}"
AGENT_NAME="${MRNIAH_AGENT:-${AGENT:-main}}"
SAMPLE_LIMIT="${MRNIAH_LIMIT:-300}"
USE_LOCAL="${MRNIAH_LOCAL:-1}"

MNEMO_API_URL="${MNEMO_API_URL:-}"
MNEMO_TENANT_ID="${MNEMO_TENANT_ID:-}"

TIDB_ZERO_API="${TIDB_ZERO_API:-https://zero.tidbapi.com/v1alpha1/instances}"
MNEMO_DB_NAME="${MNEMO_DB_NAME:-test}"
MNEMO_SERVER_PORT="${MNEMO_SERVER_PORT:-18082}"
MNEMO_SCHEMA="${MNEMO_SCHEMA:-$ROOT/server/schema.sql}"
SERVER_LOG="${SERVER_LOG:-/tmp/mrniah-mnemo-server.log}"

BASE_CMDS=(openclaw python3 jq curl)
SERVER_CMDS=(go mysql)

SERVER_PID=""

# Cache tenant IDs to avoid re-provisioning when hitting the same API URL.
STATE_DIR="$MRNIAH_DIR/.cache"
STATE_FILE="$STATE_DIR/mem_compare_state.json"
CACHE_TENANT="${MRNIAH_CACHE_TENANT:-1}"

# Add common Homebrew mysql-client path so non-interactive shells can find `mysql`.
if [[ -d "/opt/homebrew/opt/mysql-client/bin" ]]; then
  PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"
elif [[ -d "/usr/local/opt/mysql-client/bin" ]]; then
  PATH="/usr/local/opt/mysql-client/bin:$PATH"
fi

log() {
  echo "[$(date '+%H:%M:%S')] $*" >&2
}

require_cmds() {
  local cmds=("$@")
  for cmd in "${cmds[@]}"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "ERROR: Missing required command: $cmd" >&2
      exit 2
    fi
  done
}

require_python310() {
  local version
  version="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
  if [[ -z "$version" ]]; then
    echo "ERROR: python3 is not available." >&2
    exit 2
  fi
  local major minor
  major="${version%%.*}"
  minor="${version#*.}"
  if [[ "$major" -lt 3 ]] || { [[ "$major" -eq 3 ]] && [[ "$minor" -lt 10 ]]; }; then
    echo "ERROR: Python >= 3.10 is required (found $version). Please upgrade to Python 3.10 or later." >&2
    echo "Hint: consider running inside a virtual environment with Python >= 3.10 (e.g. conda activate py310)." >&2
    exit 2
  fi
}

ensure_dataset() {
  if [[ ! -f "$INDEX_FILE" ]]; then
    cat >&2 <<EOF
ERROR: $INDEX_FILE not found.
Run "python3 benchmark/MR-NIAH/mr-niah-transcript.py" first to build sessions/index.
EOF
    exit 2
  fi
}

normalize_url() {
  local raw="$1"
  raw="${raw%%/}"
  echo "$raw"
}

read_cached_tenant() {
  local api_url="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo ""
    return
  fi
  python3 - <<'PY' "$STATE_FILE" "$api_url"
import json, sys
from pathlib import Path

path = Path(sys.argv[1])
api = sys.argv[2]
try:
    data = json.loads(path.read_text())
except Exception:
    print("")
    raise SystemExit(0)
tenants = data.get("tenants", {})
print(tenants.get(api, ""))
PY
}

write_cached_tenant() {
  local api_url="$1"
  local tenant_id="$2"
  mkdir -p "$STATE_DIR"
  python3 - <<'PY' "$STATE_FILE" "$api_url" "$tenant_id"
import json, sys
from pathlib import Path

path = Path(sys.argv[1])
api = sys.argv[2]
tenant = sys.argv[3]
data = {}
if path.exists():
    try:
        data = json.loads(path.read_text())
    except Exception:
        data = {}
tenants = data.setdefault("tenants", {})
tenants[api] = tenant
path.write_text(json.dumps(data, indent=2))
PY
}

provision_tenant() {
  local api_url
  api_url="$(normalize_url "$MNEMO_API_URL")"
  log "Provisioning mem9 tenant via ${api_url}/v1alpha1/mem9s"
  local resp
  if ! resp=$(curl -sf -X POST "${api_url}/v1alpha1/mem9s"); then
    echo "ERROR: Failed to provision mem9 tenant from ${api_url}" >&2
    exit 2
  fi
  local tenant_id
  tenant_id="$(echo "$resp" | jq -r '.id')"
  if [[ -z "$tenant_id" || "$tenant_id" == "null" ]]; then
    echo "ERROR: Provision response missing .id:" >&2
    echo "$resp" | jq . >&2 || echo "$resp" >&2
    exit 2
  fi
  echo "$tenant_id"
}

ensure_base_profile() {
  if [[ "$BASE_PROFILE" == "$MEM_PROFILE" ]]; then
    echo "ERROR: BASE_PROFILE and MEM_PROFILE must differ." >&2
    exit 2
  fi
  local base_dir="$HOME/.openclaw-${BASE_PROFILE}"
  if [[ ! -d "$base_dir" ]]; then
    cat >&2 <<EOF
ERROR: Base profile directory not found: $base_dir
Run openclaw at least once with --profile $BASE_PROFILE so openclaw.json exists.
EOF
    exit 2
  fi
}

clone_profile() {
  local base_dir="$HOME/.openclaw-${BASE_PROFILE}"
  local target_dir="$HOME/.openclaw-${MEM_PROFILE}"

  if [[ -d "$target_dir" ]]; then
    if [[ "${MRNIAH_RESET_MEM_PROFILE:-0}" == "1" ]]; then
      log "Resetting existing mem profile dir: $target_dir"
      if ! rm -rf "$target_dir"; then
        echo "ERROR: Failed to remove $target_dir. Remove it manually or unset MRNIAH_RESET_MEM_PROFILE." >&2
        exit 2
      fi
    else
      log "Mem profile already exists: $target_dir (set MRNIAH_RESET_MEM_PROFILE=1 to regenerate)"
      return
    fi
  fi

  log "Creating mem profile dir by copying $base_dir -> $target_dir"
  mkdir -p "$(dirname "$target_dir")"
  cp -a "$base_dir" "$target_dir"
}

cleanup_server() {
  if [[ -n "$SERVER_PID" ]]; then
    log "Stopping mnemo-server (pid $SERVER_PID)"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}

start_local_mnemo_stack() {
  trap cleanup_server EXIT

  log "Provisioning TiDB Zero cluster via $TIDB_ZERO_API"
  local zero_resp
  if ! zero_resp=$(curl -sf --retry 3 -X POST "$TIDB_ZERO_API" \
    -H "Content-Type: application/json" \
    -d '{"tag":"mrniah-mem"}'); then
    echo "ERROR: Failed to provision TiDB Zero cluster" >&2
    exit 2
  fi

  local DB_HOST DB_PORT DB_USER DB_PASS
  DB_HOST=$(echo "$zero_resp" | jq -r '.instance.connection.host')
  DB_PORT=$(echo "$zero_resp" | jq -r '.instance.connection.port')
  DB_USER=$(echo "$zero_resp" | jq -r '.instance.connection.username')
  DB_PASS=$(echo "$zero_resp" | jq -r '.instance.connection.password')
  if [[ -z "$DB_HOST" || "$DB_HOST" == "null" ]]; then
    echo "ERROR: Invalid TiDB Zero response:" >&2
    echo "$zero_resp" | jq . >&2 || echo "$zero_resp" >&2
    exit 2
  fi

  log "Waiting for TiDB to be ready at ${DB_HOST}:${DB_PORT}"
  for _ in $(seq 1 60); do
    if MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
         --ssl-mode=REQUIRED -e "SELECT 1" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if ! MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
       --ssl-mode=REQUIRED -e "SELECT 1" >/dev/null 2>&1; then
    echo "ERROR: TiDB Zero cluster not ready after retries." >&2
    exit 2
  fi

  log "Applying schema $MNEMO_SCHEMA"
  MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -D "$MNEMO_DB_NAME" \
    --ssl-mode=REQUIRED <"$MNEMO_SCHEMA"

  log "Building mnemo-server"
  (cd "$ROOT/server" && go build -o "$ROOT/server/mnemo-server" ./cmd/mnemo-server)

  local dsn="${DB_USER}:${DB_PASS}@tcp(${DB_HOST}:${DB_PORT})/${MNEMO_DB_NAME}?parseTime=true&tls=true"
  log "Starting mnemo-server on port $MNEMO_SERVER_PORT (logs: $SERVER_LOG)"
  MNEMO_DSN="$dsn" MNEMO_PORT="$MNEMO_SERVER_PORT" "$ROOT/server/mnemo-server" \
    >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 30); do
    if curl -sf "http://localhost:${MNEMO_SERVER_PORT}/healthz" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "ERROR: mnemo-server exited unexpectedly. Logs:" >&2
      cat "$SERVER_LOG" >&2
      exit 2
    fi
    sleep 1
  done

  if ! curl -sf "http://localhost:${MNEMO_SERVER_PORT}/healthz" >/dev/null 2>&1; then
    echo "ERROR: mnemo-server failed to start. Logs:" >&2
    cat "$SERVER_LOG" >&2
    exit 2
  fi

  MNEMO_API_URL="http://localhost:${MNEMO_SERVER_PORT}"
  log "mnemo-server ready at $MNEMO_API_URL"
}

configure_mem_profile() {
  local api_url
  api_url="$(normalize_url "$MNEMO_API_URL")"

  if [[ -z "$MNEMO_TENANT_ID" ]]; then
    if [[ "$CACHE_TENANT" != "0" ]]; then
      local cached
      cached="$(read_cached_tenant "$api_url")"
      if [[ -n "$cached" ]]; then
        MNEMO_TENANT_ID="$cached"
        log "Reusing cached tenant ID: $MNEMO_TENANT_ID"
      fi
    fi
    if [[ -z "$MNEMO_TENANT_ID" ]]; then
      MNEMO_TENANT_ID="$(provision_tenant)"
      log "Tenant ID: $MNEMO_TENANT_ID"
      if [[ "$CACHE_TENANT" != "0" ]]; then
        write_cached_tenant "$api_url" "$MNEMO_TENANT_ID"
      fi
    fi
  else
    log "Using existing tenant ID: $MNEMO_TENANT_ID"
  fi

  log "Configuring mem profile: $MEM_PROFILE"
  openclaw --profile "$MEM_PROFILE" config set gateway.mode local >/dev/null
  openclaw --profile "$MEM_PROFILE" plugins install --link "$ROOT/openclaw-plugin" >/dev/null
  openclaw --profile "$MEM_PROFILE" config set --strict-json plugins.allow '["mnemo"]' >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.slots.memory mnemo >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mnemo.enabled true >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mnemo.config.apiUrl "$api_url" >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mnemo.config.tenantID "$MNEMO_TENANT_ID" >/dev/null
}

run_batch_for_profile() {
  local profile="$1"
  local label="$2"

  log "Running run_batch.py for profile=$profile (label=$label)"
  rm -rf "$MRNIAH_DIR/results"

  local cmd=(python3 run_batch.py --profile "$profile" --agent "$AGENT_NAME" --limit "$SAMPLE_LIMIT")
  if [[ "$USE_LOCAL" != "0" ]]; then
    cmd+=(--local)
  fi

  if ! (cd "$MRNIAH_DIR" && "${cmd[@]}") >&2; then
    echo "ERROR: run_batch.py failed for profile=$profile" >&2
    exit 2
  fi

  local dest="$MRNIAH_DIR/results-${label}"
  rm -rf "$dest"
  mv "$MRNIAH_DIR/results" "$dest"
  echo "$dest"
}

summarize_accuracy() {
  local base_path="$1"
  local base_label="$2"
  local mem_path="$3"
  local mem_label="$4"

  local score_script="$MRNIAH_DIR/score.py"

  echo ""
  echo "======== Accuracy Summary ========"
  echo "--- ${base_label} ---"
  python3 "$score_script" "${base_path}/predictions.jsonl"
  echo ""
  echo "--- ${mem_label} ---"
  python3 "$score_script" "${mem_path}/predictions.jsonl"

  # Print delta using score.py's scoring logic
  python3 - <<'PY' "$score_script" "$base_path" "$base_label" "$mem_path" "$mem_label"
import importlib.util, sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("score", sys.argv[1])
score_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(score_mod)

def mean_score(pred_path):
    rows = score_mod.load_predictions(Path(pred_path))
    if not rows:
        return 0.0
    total = 0.0
    for rec in rows:
        prediction = rec.get("prediction", "") or ""
        answer = rec.get("answer", "") or ""
        language = score_mod.detect_language(answer)
        total += score_mod.score_response(prediction, answer, language)
    return total / len(rows)

base_path, base_label, mem_path, mem_label = sys.argv[2:6]
base_score = mean_score(Path(base_path) / "predictions.jsonl")
mem_score = mean_score(Path(mem_path) / "predictions.jsonl")
delta = mem_score - base_score

print("")
print(f"--- Comparison ---")
print(f"{base_label} mean_score={base_score:.4f}")
print(f"{mem_label} mean_score={mem_score:.4f}")
print(f"Δ mean_score (mem - base): {delta:+.4f}")
PY
}

main() {
  require_python310
  require_cmds "${BASE_CMDS[@]}"
  ensure_dataset
  ensure_base_profile
  clone_profile

  if [[ -z "${MNEMO_API_URL:-}" ]]; then
    require_cmds "${SERVER_CMDS[@]}"
    start_local_mnemo_stack
  else
    log "Using existing mnemo-server: $MNEMO_API_URL"
  fi

  configure_mem_profile

  log "=== Baseline run (${BASE_PROFILE}) ==="
  local base_dir
  base_dir="$(run_batch_for_profile "$BASE_PROFILE" "$BASE_PROFILE")"

  log "=== Mem run (${MEM_PROFILE}) ==="
  local mem_dir
  mem_dir="$(run_batch_for_profile "$MEM_PROFILE" "$MEM_PROFILE")"

  summarize_accuracy "$base_dir" "$BASE_PROFILE" "$mem_dir" "$MEM_PROFILE"

  cat <<EOF

Artifacts:
- Baseline results: $base_dir
- Mem results:     $mem_dir
EOF
}

main "$@"
