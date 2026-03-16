#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MRNIAH_DIR="$ROOT/benchmark/MR-NIAH"
INDEX_FILE="$MRNIAH_DIR/output/index.jsonl"

BASE_PROFILE="${MRNIAH_BASE_PROFILE:-${BASE_PROFILE:-mrniah_local}}"
MEM_PROFILE="${MRNIAH_MEM_PROFILE:-${MEM_PROFILE:-mrniah_mem}}"
AGENT_NAME="${MRNIAH_AGENT:-${AGENT:-main}}"
SAMPLE_LIMIT="${MRNIAH_LIMIT:-${SAMPLE_LIMIT:-300}}"

MEM9_BASE_URL="${MEM9_BASE_URL:-${MEM9_API_URL:-${MNEMO_API_URL:-https://api.mem9.ai}}}"
MEM9_SPACE_ID=""

BASE_CMDS=(openclaw python3 jq curl tee)

# --reset / --new flags passed through to run_batch.py (mutually exclusive).
RESET_MODE=0
NEW_MODE=0

# Optional: run only a single OpenClaw profile (skip the compare).
RUN_ONLY_PROFILE=""

# Compare existing results without running OpenClaw.
COMPARE_ONLY=0

# Resume mode (single profile only): resume from a sample id without deleting partial results.
RESUME_FROM=""
RUN_ONLY_CASE=""
CONTINUE_ON_ERROR=1

# Pass-through OpenClaw agent timeout (seconds) to avoid runaway runs.
# 0 = let OpenClaw decide (may be profile-config dependent).
MRNIAH_OPENCLAW_TIMEOUT="${MRNIAH_OPENCLAW_TIMEOUT:-0}"

# Isolation toggles.
MRNIAH_CLEAN_SESSIONS="${MRNIAH_CLEAN_SESSIONS:-1}"
MRNIAH_WIPE_AGENT_SESSIONS="${MRNIAH_WIPE_AGENT_SESSIONS:-1}"
MRNIAH_WIPE_LOCAL_MEMORY="${MRNIAH_WIPE_LOCAL_MEMORY:-1}"

# mem9 isolation strategy for the mem-enabled profile:
# - "clear": reuse one tenant and clear memories pre/post each case
# - "tenant": provision a fresh tenant per case (strong isolation; recommended)
MRNIAH_MEM9_ISOLATION="${MRNIAH_MEM9_ISOLATION:-tenant}"

# If set to 1, the mem profile will be regenerated from the base profile before running.
MRNIAH_RESET_MEM_PROFILE="${MRNIAH_RESET_MEM_PROFILE:-0}"

# Gateways (required; --local mode does not support /reset or /new properly).
MRNIAH_BASE_GATEWAY_PORT="${MRNIAH_BASE_GATEWAY_PORT:-19011}"
MRNIAH_MEM_GATEWAY_PORT="${MRNIAH_MEM_GATEWAY_PORT:-19012}"
MRNIAH_GATEWAY_TOKEN="${MRNIAH_GATEWAY_TOKEN:-mrniah-bench-token}"

BASE_GATEWAY_PORT=""
MEM_GATEWAY_PORT=""
BASE_GATEWAY_PID=""
MEM_GATEWAY_PID=""

LOG_DIR="${MRNIAH_LOG_DIR:-$MRNIAH_DIR/results-logs}"
LOG_FILE=""
RUN_ID=""
SESSION_DUMP_ROOT=""

log() {
  echo "[$(date '+%H:%M:%S')] $*" >&2
}

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") [--reset true|false] [--new true|false] [--profile <name>] [--compare]

Notes:
- --reset/--new are mutually exclusive and, when enabled, prefix each question
  with "/reset " or "/new " during run_batch.py.
- --profile runs only that OpenClaw profile (skips baseline-vs-mem comparison).
- --case <id> runs a single sample id (single-profile only; appends into results-\$profile).
- By default, continues on per-case failure and records it. Use --fail-fast to stop immediately.
- --compare skips runs and compares existing results-* directories for BASE_PROFILE/MEM_PROFILE.
- --resume <id> resumes a single-profile run from sample id (requires --profile; keeps benchmark/MR-NIAH/results-<profile>).
- Set MRNIAH_OPENCLAW_TIMEOUT=<seconds> to force an explicit openclaw agent timeout.
- Set MRNIAH_MEM9_ISOLATION=tenant (default) to provision a fresh mem9 tenant per case.
- Set MRNIAH_MEM9_ISOLATION=clear to reuse one tenant and clear memories per case.
- By default, uses hosted mem9 at https://api.mem9.ai (override via MEM9_BASE_URL).
- This script starts two OpenClaw gateways (baseline + mem) on separate ports.
EOF
}

parse_bool() {
  local raw="$1"
  raw="$(echo "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    1|true|yes|y|on) echo 1 ;;
    0|false|no|n|off) echo 0 ;;
    *) return 1 ;;
  esac
}

clean_bench_sessions() {
  local profile="$1"
  if [[ "${MRNIAH_CLEAN_SESSIONS}" == "0" ]]; then
    return
  fi
  local sessions_dir="$HOME/.openclaw-${profile}/agents/${AGENT_NAME}/sessions"
  local store_path="${sessions_dir}/sessions.json"
  local bench_src_dir="$MRNIAH_DIR/output/sessions"
  if [[ ! -f "$store_path" ]]; then
    return
  fi
  log "Cleaning bench sessions for profile=$profile"
  python3 - <<'PY' "$store_path" "$sessions_dir" "$bench_src_dir"
import signal
import json, sys
from pathlib import Path

store_path = Path(sys.argv[1])
sessions_dir = Path(sys.argv[2]).resolve()
bench_src_dir = Path(sys.argv[3]).resolve()

def _timeout(_signum, _frame):
    raise TimeoutError("clean_bench_sessions timed out")

try:
    signal.signal(signal.SIGALRM, _timeout)
    signal.alarm(30)

    bench_ids = set()
    if bench_src_dir.is_dir():
        for p in bench_src_dir.glob("*.jsonl"):
            bench_ids.add(p.stem)
    data = json.loads(store_path.read_text(encoding="utf-8")) if store_path.exists() else {}
    to_delete = []
    session_files = []
    for k, v in list(data.items()):
        if not isinstance(k, str) or not k.startswith("bench:mrniah:"):
            # Also drop any entries that point to benchmark session IDs (even if the key
            # name isn't bench:mrniah:*), to keep runs independent.
            if isinstance(v, dict) and isinstance(v.get("sessionId"), str) and v.get("sessionId") in bench_ids:
                to_delete.append(k)
                sf = v.get("sessionFile")
                if isinstance(sf, str) and sf:
                    session_files.append(sf)
            continue
        to_delete.append(k)
        if isinstance(v, dict):
            sf = v.get("sessionFile")
            if isinstance(sf, str) and sf:
                session_files.append(sf)
    for k in to_delete:
        data.pop(k, None)
    store_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Only remove files under this profile's sessions dir.
    for sf in session_files:
        try:
            p = Path(sf).expanduser().resolve()
        except Exception:
            continue
        if sessions_dir in p.parents and p.suffix == ".jsonl":
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass

    # Also remove injected benchmark transcripts by filename, even if the store no longer
    # references them (e.g., store got manually edited).
    for sid in bench_ids:
        p = (sessions_dir / f"{sid}.jsonl")
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass
except Exception as e:
    # Best-effort cleanup only; don't fail the whole run.
    print(f"WARNING: clean_bench_sessions failed: {e}", file=sys.stderr)
finally:
    try:
        signal.alarm(0)
    except Exception:
        pass
PY
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

pick_free_port() {
  local preferred="$1"
  python3 - "$preferred" <<'PY'
import socket
import sys

preferred = int(sys.argv[1])
if preferred <= 0:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
    sock.close()
    raise SystemExit(0)

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    sock.bind(("127.0.0.1", preferred))
    print(preferred)
except OSError:
    sock2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock2.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock2.bind(("127.0.0.1", 0))
    print(sock2.getsockname()[1])
    sock2.close()
finally:
    sock.close()
PY
}

wait_gateway_healthy() {
  local port="$1"
  local pid="$2"
  local log_path="$3"
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
      return 0
    fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
      return 1
    fi
    if [[ -f "$log_path" ]]; then
      # If the log contains a known fatal marker, surface it early.
      if tail -50 "$log_path" | grep -E -q "(FATAL|panic|bind: address already in use)"; then
        break
      fi
    fi
    sleep 1
  done
  return 1
}

configure_gateway_settings() {
  local profile="$1"
  local port="$2"
  log "Configuring gateway for profile=$profile port=$port"
  openclaw --profile "$profile" config set gateway.mode local >/dev/null
  openclaw --profile "$profile" config set gateway.port "$port" >/dev/null
  openclaw --profile "$profile" config set gateway.auth.token "$MRNIAH_GATEWAY_TOKEN" >/dev/null
}

start_gateway() {
  local profile="$1"
  local port="$2"
  local log_path="$3"

  configure_gateway_settings "$profile" "$port"

  log "Starting OpenClaw gateway for profile=$profile (port=$port, logs=$log_path)"
  nohup openclaw --profile "$profile" gateway >"$log_path" 2>&1 &
  echo $!
}

stop_gateway_pid() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return
  fi
  kill "$pid" >/dev/null 2>&1 || true
  for i in $(seq 1 20); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return
    fi
    sleep 0.2
  done
  kill -9 "$pid" >/dev/null 2>&1 || true
}

wipe_agent_sessions() {
  local profile="$1"
  local phase="${2:-unknown}"
  if [[ "${MRNIAH_WIPE_AGENT_SESSIONS}" == "0" ]]; then
    return
  fi
  local sessions_dir="$HOME/.openclaw-${profile}/agents/${AGENT_NAME}/sessions"
  if [[ -d "$sessions_dir" ]]; then
    # Archive current session store/transcripts before wiping for reproducibility/debugging.
    if [[ -n "$SESSION_DUMP_ROOT" ]] && [[ "$(ls -A "$sessions_dir" 2>/dev/null | wc -l | tr -d ' ')" != "0" ]]; then
      local dump_dir="$SESSION_DUMP_ROOT/${phase}/${profile}/${AGENT_NAME}"
      mkdir -p "$dump_dir"
      log "Archiving agent sessions dir: $sessions_dir -> $dump_dir"
      cp -a "$sessions_dir/." "$dump_dir/" 2>/dev/null || cp -R "$sessions_dir/." "$dump_dir/" || true
    fi
    log "Wiping agent sessions dir: $sessions_dir"
    rm -rf "$sessions_dir"
  fi
  mkdir -p "$sessions_dir"
}

provision_tenant() {
  local api_url
  api_url="$(normalize_url "$MEM9_BASE_URL")"
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

ensure_profile_exists() {
  local profile="$1"
  local base_dir="$HOME/.openclaw-${profile}"
  if [[ "$BASE_PROFILE" == "$MEM_PROFILE" ]]; then
    echo "ERROR: BASE_PROFILE and MEM_PROFILE must differ." >&2
    exit 2
  fi
  if [[ ! -d "$base_dir" || ! -f "$base_dir/openclaw.json" ]]; then
    cat >&2 <<EOF
ERROR: OpenClaw profile not found: $profile
Expected: $base_dir/openclaw.json

Create it first, e.g.:
  openclaw --profile "$profile" config get >/dev/null
EOF
    exit 2
  fi
}

setup_workspace() {
  local profile="$1"
  local ws_dir="$HOME/.openclaw/workspace-${profile}"
  rm -rf "$ws_dir"
  mkdir -p "$ws_dir"
  cp -r "$ROOT/benchmark/workspace/." "$ws_dir/"
  log "Copied workspace files to $ws_dir"
}

clone_mem_profile_if_needed() {
  local base_dir="$HOME/.openclaw-${BASE_PROFILE}"
  local target_dir="$HOME/.openclaw-${MEM_PROFILE}"

  if [[ -d "$target_dir" && "$MRNIAH_RESET_MEM_PROFILE" != "1" ]]; then
    log "Mem profile already exists: $target_dir (set MRNIAH_RESET_MEM_PROFILE=1 to regenerate)"
    setup_workspace "$MEM_PROFILE"
    return
  fi

  rm -rf "$target_dir"
  log "Creating mem profile dir by copying $base_dir -> $target_dir"
  mkdir -p "$(dirname "$target_dir")"
  cp -a "$base_dir" "$target_dir"

  # Make runs more independent by dropping previously recorded sessions in the cloned profile.
  rm -rf "$target_dir/agents"/*/sessions 2>/dev/null || true

  setup_workspace "$MEM_PROFILE"
}

configure_mem_profile() {
  local api_url
  api_url="$(normalize_url "$MEM9_BASE_URL")"

  if [[ "$MRNIAH_MEM9_ISOLATION" == "clear" ]]; then
    MEM9_SPACE_ID="$(provision_tenant)"
    log "Provisioned fresh mem9 space ID: $MEM9_SPACE_ID"
  else
    MEM9_SPACE_ID="__per_case__"
    log "mem9 isolation=tenant: provisioning a fresh mem9 space per case (tenantID will be set by run_batch.py)"
  fi

  log "Configuring mem profile: $MEM_PROFILE"
  openclaw --profile "$MEM_PROFILE" config set gateway.mode local >/dev/null
  openclaw --profile "$MEM_PROFILE" plugins install --link "$ROOT/openclaw-plugin" >/dev/null
  openclaw --profile "$MEM_PROFILE" config set --strict-json plugins.allow '["mem9"]' >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.slots.memory mem9 >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.enabled true >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.config.apiUrl "$api_url" >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.config.tenantID "$MEM9_SPACE_ID" >/dev/null
}

run_batch_for_profile() {
  local profile="$1"
  local label="$2"
  local out_dir="$MRNIAH_DIR/results-${label}"

  log "Running run_batch.py for profile=$profile (label=$label)"
  if [[ "${MRNIAH_WIPE_AGENT_SESSIONS}" == "0" ]]; then
    clean_bench_sessions "$profile"
  fi
  if [[ -n "$RESUME_FROM" || -n "$RUN_ONLY_CASE" ]]; then
    log "Keeping results dir: ${out_dir}"
  else
    rm -rf "$out_dir"
  fi

  # Use -u to avoid Python stdout buffering when output is piped through tee.
  local cmd=(python3 -u run_batch.py --profile "$profile" --agent "$AGENT_NAME" --limit "$SAMPLE_LIMIT" --results-dir "$out_dir")
  if [[ "$CONTINUE_ON_ERROR" == "1" ]]; then
    cmd+=(--continue-on-error)
  else
    cmd+=(--fail-fast)
  fi
  if [[ -n "$RESUME_FROM" ]]; then
    cmd+=(--resume "$RESUME_FROM")
  fi
  if [[ -n "$RUN_ONLY_CASE" ]]; then
    cmd+=(--case-id "$RUN_ONLY_CASE")
  fi
  if [[ "$profile" == "$MEM_PROFILE" ]]; then
    cmd+=(--import-sessions --mem9-api-url "$MEM9_BASE_URL")
    if [[ "$MRNIAH_MEM9_ISOLATION" == "clear" ]]; then
      cmd+=(--mem9-clear-memories --mem9-tenant-id "$MEM9_SPACE_ID")
    elif [[ "$MRNIAH_MEM9_ISOLATION" == "tenant" ]]; then
      cmd+=(--mem9-provision-per-case --gateway-port "$MEM_GATEWAY_PORT" --gateway-log "$MEM_GATEWAY_LOG")
    else
      echo "ERROR: Invalid MRNIAH_MEM9_ISOLATION=$MRNIAH_MEM9_ISOLATION (expected: tenant|clear)" >&2
      exit 2
    fi
  fi
  if [[ "${MRNIAH_OPENCLAW_TIMEOUT}" != "0" ]]; then
    cmd+=(--openclaw-timeout "$MRNIAH_OPENCLAW_TIMEOUT")
  fi
  if [[ "$RESET_MODE" == "1" ]]; then
    cmd+=(--reset)
  elif [[ "$NEW_MODE" == "1" ]]; then
    cmd+=(--new)
  fi
  if [[ "${MRNIAH_WIPE_LOCAL_MEMORY}" != "0" ]]; then
    cmd+=(--wipe-local-memory)
  fi

  if ! (cd "$MRNIAH_DIR" && "${cmd[@]}") >&2; then
    echo "ERROR: run_batch.py failed for profile=$profile" >&2
    exit 2
  fi

  echo "$out_dir"
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
        return 0.0, 0
    total = 0.0
    failed = 0
    for rec in rows:
        prediction = rec.get("prediction", "") or ""
        ok = rec.get("ok")
        err = rec.get("error")
        if ok is False or (isinstance(err, str) and err.strip()):
            failed += 1
        answer = rec.get("answer", "") or ""
        language = score_mod.detect_language(answer)
        total += score_mod.score_response(prediction, answer, language)
    return total / len(rows), failed

base_path, base_label, mem_path, mem_label = sys.argv[2:6]
base_score, base_failed = mean_score(Path(base_path) / "predictions.jsonl")
mem_score, mem_failed = mean_score(Path(mem_path) / "predictions.jsonl")
delta = mem_score - base_score

print("")
print(f"--- Comparison ---")
print(f"{base_label} mean_score={base_score:.4f}")
print(f"{mem_label} mean_score={mem_score:.4f}")
print(f"{base_label} failed={base_failed}")
print(f"{mem_label} failed={mem_failed}")
print(f"Δ mean_score (mem - base): {delta:+.4f}")
PY
}

cleanup() {
  set +e
  log "Cleaning up..."
  if [[ -n "$BASE_GATEWAY_PID" ]]; then
    stop_gateway_pid "$BASE_GATEWAY_PID"
  fi
  if [[ -n "$MEM_GATEWAY_PID" ]]; then
    stop_gateway_pid "$MEM_GATEWAY_PID"
  fi
  if [[ "${MRNIAH_WIPE_AGENT_SESSIONS}" != "0" ]]; then
    if [[ -n "$RUN_ONLY_PROFILE" ]]; then
      wipe_agent_sessions "$RUN_ONLY_PROFILE" "cleanup"
    else
      wipe_agent_sessions "$BASE_PROFILE" "cleanup"
      wipe_agent_sessions "$MEM_PROFILE" "cleanup"
    fi
  else
    if [[ -n "$RUN_ONLY_PROFILE" ]]; then
      clean_bench_sessions "$RUN_ONLY_PROFILE"
    else
      clean_bench_sessions "$BASE_PROFILE"
      clean_bench_sessions "$MEM_PROFILE"
    fi
  fi
  log "Cleanup done."
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --compare)
        COMPARE_ONLY=1
        shift
        ;;
      --continue-on-error)
        CONTINUE_ON_ERROR=1
        shift
        ;;
      --fail-fast)
        CONTINUE_ON_ERROR=0
        shift
        ;;
      --resume)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --resume requires a value" >&2
          exit 2
        fi
        RESUME_FROM="$2"
        shift 2
        ;;
      --case)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --case requires a value" >&2
          exit 2
        fi
        RUN_ONLY_CASE="$2"
        shift 2
        ;;
      --profile)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --profile requires a value" >&2
          exit 2
        fi
        RUN_ONLY_PROFILE="$2"
        shift 2
        ;;
      --reset)
        if [[ $# -ge 2 ]] && [[ "${2:-}" != --* ]]; then
          if ! RESET_MODE="$(parse_bool "$2")"; then
            echo "ERROR: invalid value for --reset: $2" >&2
            exit 2
          fi
          shift 2
        else
          RESET_MODE=1
          shift
        fi
        ;;
      --new)
        if [[ $# -ge 2 ]] && [[ "${2:-}" != --* ]]; then
          if ! NEW_MODE="$(parse_bool "$2")"; then
            echo "ERROR: invalid value for --new: $2" >&2
            exit 2
          fi
          shift 2
        else
          NEW_MODE=1
          shift
        fi
        ;;
      *)
        echo "ERROR: Unknown argument: $1" >&2
        usage
        exit 2
        ;;
    esac
  done
  if [[ "$RESET_MODE" == "1" && "$NEW_MODE" == "1" ]]; then
    echo "ERROR: --reset and --new are mutually exclusive." >&2
    exit 2
  fi
  if [[ -n "$RESUME_FROM" ]]; then
    if [[ "$COMPARE_ONLY" == "1" ]]; then
      echo "ERROR: --resume is only supported with single-profile runs (do not use with --compare)." >&2
      exit 2
    fi
    if [[ -z "$RUN_ONLY_PROFILE" ]]; then
      echo "ERROR: --resume requires --profile <name>." >&2
      exit 2
    fi
  fi
  if [[ -n "$RUN_ONLY_CASE" ]]; then
    if [[ "$COMPARE_ONLY" == "1" ]]; then
      echo "ERROR: --case is only supported with single-profile runs (do not use with --compare)." >&2
      exit 2
    fi
    if [[ -z "$RUN_ONLY_PROFILE" ]]; then
      echo "ERROR: --case requires --profile <name>." >&2
      exit 2
    fi
    if ! [[ "$RUN_ONLY_CASE" =~ ^[0-9]+$ ]]; then
      echo "ERROR: --case must be an integer sample id; got: $RUN_ONLY_CASE" >&2
      exit 2
    fi
  fi
  if [[ -n "$RUN_ONLY_CASE" && -n "$RESUME_FROM" ]]; then
    echo "ERROR: --case and --resume are mutually exclusive." >&2
    exit 2
  fi

  mkdir -p "$LOG_DIR"
  RUN_ID="$(date -u +%Y%m%d-%H%M%S)"
  LOG_FILE="${LOG_DIR}/mem_compare_${RUN_ID}.log"
  SESSION_DUMP_ROOT="${LOG_DIR}/raw/session-stores-${RUN_ID}"
  # Tee both stdout and stderr to the same log file while preserving stream separation.
  exec > >(tee -a "$LOG_FILE") 2> >(tee -a "$LOG_FILE" >&2)
  log "Logging to $LOG_FILE"

  require_python310
  require_cmds "${BASE_CMDS[@]}"
  if [[ "$COMPARE_ONLY" == "1" ]]; then
    local base_dir="$MRNIAH_DIR/results-${BASE_PROFILE}"
    local mem_dir="$MRNIAH_DIR/results-${MEM_PROFILE}"
    if [[ ! -f "${base_dir}/predictions.jsonl" ]]; then
      echo "ERROR: Missing baseline predictions at ${base_dir}/predictions.jsonl" >&2
      echo "Hint: run baseline first, e.g. ./run_mem_compare.sh --profile ${BASE_PROFILE}" >&2
      exit 2
    fi
    if [[ ! -f "${mem_dir}/predictions.jsonl" ]]; then
      echo "ERROR: Missing mem predictions at ${mem_dir}/predictions.jsonl" >&2
      echo "Hint: run mem first, e.g. ./run_mem_compare.sh --profile ${MEM_PROFILE}" >&2
      exit 2
    fi
    summarize_accuracy "$base_dir" "$BASE_PROFILE" "$mem_dir" "$MEM_PROFILE"
    cat <<EOF

Artifacts:
- Baseline results: $base_dir
- Mem results:     $mem_dir
- Compare log:     $LOG_FILE
EOF
    exit 0
  fi

  trap cleanup EXIT INT TERM

  ensure_dataset
  if [[ -n "$RUN_ONLY_PROFILE" ]]; then
    ensure_profile_exists "$RUN_ONLY_PROFILE"
    setup_workspace "$RUN_ONLY_PROFILE"
  else
    ensure_profile_exists "$BASE_PROFILE"
    setup_workspace "$BASE_PROFILE"
    clone_mem_profile_if_needed
  fi

  log "Using mem9 service: $MEM9_BASE_URL"

  if [[ -z "$RUN_ONLY_PROFILE" ]] || [[ "$RUN_ONLY_PROFILE" == "$MEM_PROFILE" ]]; then
    # Only provision/configure mem9 when the mem-enabled profile is going to run.
    if [[ -z "$RUN_ONLY_PROFILE" ]]; then
      configure_mem_profile
    else
      # In single-profile mode, still ensure the mem profile exists and is configured.
      ensure_profile_exists "$BASE_PROFILE"
      clone_mem_profile_if_needed
      configure_mem_profile
    fi
  fi

  # Ensure previous runs (especially /new or /reset) do not pollute the session store.
  if [[ -n "$RUN_ONLY_PROFILE" ]]; then
    wipe_agent_sessions "$RUN_ONLY_PROFILE" "pre-run"
  else
    wipe_agent_sessions "$BASE_PROFILE" "pre-run"
    wipe_agent_sessions "$MEM_PROFILE" "pre-run"
  fi

  BASE_GATEWAY_PORT="$(pick_free_port "$MRNIAH_BASE_GATEWAY_PORT")"
  MEM_GATEWAY_PORT="$(pick_free_port "$MRNIAH_MEM_GATEWAY_PORT")"
  if [[ "$MEM_GATEWAY_PORT" == "$BASE_GATEWAY_PORT" ]]; then
    MEM_GATEWAY_PORT="$(pick_free_port 0)"
  fi
  if [[ -n "$RUN_ONLY_PROFILE" ]]; then
    log "Gateway port: ${RUN_ONLY_PROFILE}=${BASE_GATEWAY_PORT}"
  else
    log "Gateway ports: base=${BASE_GATEWAY_PORT} mem=${MEM_GATEWAY_PORT}"
  fi

  BASE_GATEWAY_LOG="${LOG_DIR}/gateway_${BASE_PROFILE}_${BASE_GATEWAY_PORT}.log"
  MEM_GATEWAY_LOG="${LOG_DIR}/gateway_${MEM_PROFILE}_${MEM_GATEWAY_PORT}.log"

  if [[ -n "$RUN_ONLY_PROFILE" ]]; then
    local prof="$RUN_ONLY_PROFILE"
    local gw_log="${LOG_DIR}/gateway_${prof}_${BASE_GATEWAY_PORT}.log"
    BASE_GATEWAY_LOG="$gw_log"
    if [[ "$prof" == "$MEM_PROFILE" && "$MRNIAH_MEM9_ISOLATION" == "tenant" ]]; then
      # run_batch.py will restart the gateway per case to pick up the tenantID override.
      configure_gateway_settings "$prof" "$BASE_GATEWAY_PORT"
      MEM_GATEWAY_PORT="$BASE_GATEWAY_PORT"
      MEM_GATEWAY_LOG="$gw_log"
      log "Gateway will be managed per-case by run_batch.py (port=${MEM_GATEWAY_PORT}, log=${MEM_GATEWAY_LOG})"
    else
      BASE_GATEWAY_PID="$(start_gateway "$prof" "$BASE_GATEWAY_PORT" "$gw_log")"
      if ! wait_gateway_healthy "$BASE_GATEWAY_PORT" "$BASE_GATEWAY_PID" "$gw_log"; then
        echo "ERROR: Gateway failed to become healthy. Logs:" >&2
        tail -80 "$gw_log" >&2 || true
        exit 2
      fi
      log "Gateway ready: http://localhost:${BASE_GATEWAY_PORT}"
    fi

    log "=== Single run (${prof}) ==="
    local out_dir
    out_dir="$(run_batch_for_profile "$prof" "$prof")"

    echo ""
    echo "======== Accuracy Summary ========"
    python "$MRNIAH_DIR/score.py" "${out_dir}/predictions.jsonl"

    cat <<EOF

Artifacts:
- Results:    $out_dir
- Run log:    $LOG_FILE
- Gateway log:$gw_log
EOF
  else
    BASE_GATEWAY_PID="$(start_gateway "$BASE_PROFILE" "$BASE_GATEWAY_PORT" "$BASE_GATEWAY_LOG")"
    if ! wait_gateway_healthy "$BASE_GATEWAY_PORT" "$BASE_GATEWAY_PID" "$BASE_GATEWAY_LOG"; then
      echo "ERROR: Baseline gateway failed to become healthy. Logs:" >&2
      tail -80 "$BASE_GATEWAY_LOG" >&2 || true
      exit 2
    fi
    log "Baseline gateway ready: http://localhost:${BASE_GATEWAY_PORT}"

    if [[ "$MRNIAH_MEM9_ISOLATION" == "tenant" ]]; then
      # Configure the mem profile gateway port/token, but let run_batch.py restart it per case.
      log "Configuring mem gateway settings for profile=$MEM_PROFILE port=$MEM_GATEWAY_PORT (run_batch.py will manage restarts)"
      configure_gateway_settings "$MEM_PROFILE" "$MEM_GATEWAY_PORT"
      log "Mem gateway will be managed per-case by run_batch.py: http://localhost:${MEM_GATEWAY_PORT}"
    else
      MEM_GATEWAY_PID="$(start_gateway "$MEM_PROFILE" "$MEM_GATEWAY_PORT" "$MEM_GATEWAY_LOG")"
      if ! wait_gateway_healthy "$MEM_GATEWAY_PORT" "$MEM_GATEWAY_PID" "$MEM_GATEWAY_LOG"; then
        echo "ERROR: Mem gateway failed to become healthy. Logs:" >&2
        tail -80 "$MEM_GATEWAY_LOG" >&2 || true
        exit 2
      fi
      log "Mem gateway ready: http://localhost:${MEM_GATEWAY_PORT}"
    fi

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
- Compare log:     $LOG_FILE
- Gateway logs:
  - Baseline: $BASE_GATEWAY_LOG
  - Mem:      $MEM_GATEWAY_LOG
EOF
  fi
}

main "$@"
