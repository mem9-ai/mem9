#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MRNIAH_DIR="$ROOT/benchmark/MR-NIAH"
OUTPUT_DIR="$MRNIAH_DIR/output"
INDEX_FILE="$OUTPUT_DIR/index.jsonl"

# Defaults (prefer CLI flags over environment variables for reproducibility).
BASE_PROFILE="mrniah_local"
MEM_PROFILE="mrniah_mem"
AGENT_NAME="main"
SAMPLE_LIMIT="300"

MEM9_BASE_URL="https://api.mem9.ai"
MEM9_SPACE_ID=""

BASE_CMDS=(openclaw python3 jq curl tee tar)

# Profile config overrides (optional).
MODEL_PRIMARY=""
MODEL_CONTEXT_WINDOW=0
COMPACT_SPEC=""

# OpenClaw plugin wiring settings for the mem profile.
OPENCLAW_PLUGIN_DIR="$ROOT/openclaw-plugin"
# NOTE: We primarily wire the plugin via:
# - plugins.load.paths = ["$OPENCLAW_PLUGIN_DIR"]
# - plugins.allow = ["mem9"]
#
# This flag is kept for backward compatibility / metadata only.
OPENCLAW_PLUGIN_INSTALL_MODE="link" # copy|link (legacy)

# Managed profiles mode (optional): recreate baseline from a template dir, then clone mem profile.
PROFILES_TEMPLATE_DIR=""
PROFILES_ENV_FILE=""
RECREATE_PROFILES_MODE="auto" # auto|1|0
RECREATE_PROFILES=0
RUN_TAG=""
BASE_PROFILE_EXPLICIT=0
MEM_PROFILE_EXPLICIT=0

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
OPENCLAW_TIMEOUT="0"

# Isolation toggles.
CLEAN_SESSIONS="1"
WIPE_AGENT_SESSIONS="1"
WIPE_LOCAL_MEMORY="1"

# Speed vs stability:
# - 0: run baseline then mem sequentially (more stable; lower API pressure).
# - 1 (default): run baseline and mem in parallel (faster; higher API/QPS pressure).
PARALLEL_RUNS="1"

# run_batch.py prints mem9 debug info (writes + recall preview) during the mem run.
MEM9_TRACE_LIMIT="5"
MEM9_TRACE_CHARS="220"
MEM9_TRACE_QUERY_CHARS="800"

# mem9 isolation strategy for the mem-enabled profile:
# - "clear": reuse one tenant and clear memories pre/post each case
# - "tenant": provision a fresh tenant per case (strong isolation; recommended)
MEM9_ISOLATION="tenant"

# How to load session history into mem9 for the mem profile:
# - import-session: v1alpha1 /imports (file_type=session) with task polling
# - line-write: v1alpha2 /memories, write each JSONL message line sequentially
MEM9_LOAD_METHOD="line-write"
MEM9_LINE_WRITE_SLEEP_MS="0"
MEM9_LINE_WRITE_VERIFY_TIMEOUT="20"
MEM9_LINE_WRITE_VERIFY_INTERVAL="0.5"
MEM9_IMPORT_TIMEOUT="3600"
MEM9_IMPORT_POLL_INTERVAL="1.0"

# If set to 1, the mem profile will be regenerated from the base profile before running.
RESET_MEM_PROFILE="0"

# Gateways (required; --local mode does not support /reset or /new properly).
BASE_GATEWAY_PORT_PREFERRED="19011"
MEM_GATEWAY_PORT_PREFERRED="19012"
GATEWAY_TOKEN="mrniah-bench-token"
GATEWAY_TOKEN_EXPLICIT=0

BASE_GATEWAY_PORT=""
MEM_GATEWAY_PORT=""
BASE_GATEWAY_PID=""
MEM_GATEWAY_PID=""

LOG_DIR="$MRNIAH_DIR/results-logs"
LOG_FILE=""
RUN_ID=""
SESSION_DUMP_ROOT=""
ARCHIVE_PATH=""

log() {
  echo "[$(date '+%H:%M:%S')] $*" >&2
}

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") [options]

Notes:
- --reset/--new are mutually exclusive and, when enabled, prefix each question
  with "/reset " or "/new " during run_batch.py.
- --profile runs only that OpenClaw profile (skips baseline-vs-mem comparison).
- --case <id> runs a single sample id (single-profile only; appends into results-\$profile).
- By default, continues on per-case failure and records it. Use --fail-fast to stop immediately.
- --compare skips runs and compares existing results-* directories for BASE_PROFILE/MEM_PROFILE.
- --resume <id> resumes a single-profile run from sample id (requires --profile; keeps benchmark/MR-NIAH/results-<profile>).
- --model <provider/model> sets agents.defaults.model.primary for both profiles.
- --compact <preset|path.json> applies a compaction preset for both profiles (agents.defaults.contextTokens + agents.defaults.compaction).
- --model-context-window <n> (best-effort) updates the selected model's models.providers.*.models[].contextWindow in openclaw.json for both profiles.
- Full compare runs default to managed profiles (equivalent to --recreate-profiles) to avoid accidental reuse of existing profiles.
- In managed profiles mode, if you do not pass --base-profile/--mem-profile, the script appends _<yyyymmddhhmmss> to both profile names.
- By default, uses hosted mem9 at https://api.mem9.ai (override via --mem9-base-url).
- This script starts two OpenClaw gateways (baseline + mem) on separate ports.

Options:
  --profile <name>                 Run only one profile (no compare)
  --base-profile <name>            Baseline OpenClaw profile name (default: ${BASE_PROFILE})
  --mem-profile <name>             Mem OpenClaw profile name (default: ${MEM_PROFILE})
  --agent <name>                   OpenClaw agent id (default: ${AGENT_NAME})
  --limit <n>                      Sample limit (default: ${SAMPLE_LIMIT})
  --output-dir <dir>               Transcript output dir (default: ${OUTPUT_DIR})
  --compare                        Compare existing results without running
  --mem9-base-url <url>            mem9 API base URL (default: ${MEM9_BASE_URL})
  --reset [true|false]             Prefix each question with /reset
  --new [true|false]               Prefix each question with /new
  --case <id>                      Run a single sample id (single-profile only)
  --resume <id>                    Resume from a sample id (single-profile only)
  --fail-fast                      Stop on first failure
  --continue-on-error              Continue on failures (default)

  --model <provider/model>         Override agents.defaults.model.primary (baseline + mem)
  --compact <preset|path.json>     Apply compaction preset (baseline + mem)
  --model-context-window <n>       Patch the chosen model's contextWindow in openclaw.json (baseline + mem)

  --recreate-profiles              Recreate baseline from template dir and re-clone mem from baseline
  --no-recreate-profiles           Disable managed profiles (requires explicit --base-profile and --mem-profile for full compare)
  --profiles-template-dir <dir>    Template dir to copy into ~/.openclaw-<profile>/ (default: benchmark/MR-NIAH/config/openclaw)
  --profiles-env-file <path>       .env file to copy into each recreated profile dir (default: benchmark/MR-NIAH/config/openclaw/.env; opaque; not parsed)

  --openclaw-plugin-dir <dir>      mem profile plugin source dir (default: ${OPENCLAW_PLUGIN_DIR})
  --openclaw-plugin-install-mode copy|link
                                  Legacy (kept for compatibility). Plugin is wired via plugins.load.paths (default: ${OPENCLAW_PLUGIN_INSTALL_MODE})

  --openclaw-timeout <seconds>     Pass --timeout to \`openclaw agent\` via run_batch.py (default: ${OPENCLAW_TIMEOUT})
  --[no-]clean-sessions            Clean bench sessions instead of wiping everything (default: ${CLEAN_SESSIONS})
  --[no-]wipe-agent-sessions       Wipe profile agents/<agent>/sessions (default: ${WIPE_AGENT_SESSIONS})
  --[no-]wipe-local-memory         Wipe profile memory/ before each case (default: ${WIPE_LOCAL_MEMORY})

  --parallel                       Run baseline + mem in parallel (default)
  --sequential                     Run baseline then mem sequentially

  --mem9-isolation tenant|clear    mem9 isolation strategy (default: ${MEM9_ISOLATION})
  --mem9-load-method line-write|import-session
                                  mem9 history load strategy (default: ${MEM9_LOAD_METHOD})
  --mem9-line-write-sleep-ms <n>   Sleep N ms after each /memories write (default: ${MEM9_LINE_WRITE_SLEEP_MS})
  --mem9-line-write-verify-timeout <sec>
                                  Seconds to wait for recall verification (default: ${MEM9_LINE_WRITE_VERIFY_TIMEOUT})
  --mem9-line-write-verify-interval <sec>
                                  Poll interval seconds for recall verification (default: ${MEM9_LINE_WRITE_VERIFY_INTERVAL})
  --mem9-import-timeout <sec>      Timeout seconds per /imports task (default: ${MEM9_IMPORT_TIMEOUT})
  --mem9-import-poll-interval <sec>
                                  Poll interval seconds per /imports task (default: ${MEM9_IMPORT_POLL_INTERVAL})

  --mem9-trace-limit <n>           Trace: max memories per section (default: ${MEM9_TRACE_LIMIT})
  --mem9-trace-chars <n>           Trace: max chars per memory preview (default: ${MEM9_TRACE_CHARS})
  --mem9-trace-query-chars <n>     Trace: max chars for recall preview query (default: ${MEM9_TRACE_QUERY_CHARS})

  --reset-mem-profile              Force re-clone/recreate mem profile from baseline
  --base-gateway-port <n>          Preferred baseline gateway port (default: ${BASE_GATEWAY_PORT_PREFERRED})
  --mem-gateway-port <n>           Preferred mem gateway port (default: ${MEM_GATEWAY_PORT_PREFERRED})
  --gateway-token <token>          Gateway auth token (default: ${GATEWAY_TOKEN})
  --log-dir <dir>                  Log dir (default: ${LOG_DIR})
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
  if [[ "${CLEAN_SESSIONS}" == "0" ]]; then
    return
  fi
  local sessions_dir="$HOME/.openclaw-${profile}/agents/${AGENT_NAME}/sessions"
  local store_path="${sessions_dir}/sessions.json"
  local bench_src_dir="${OUTPUT_DIR}/sessions"
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
Or pass --output-dir to point at an existing output directory.
EOF
    exit 2
  fi
}

normalize_url() {
  local raw="$1"
  raw="${raw%%/}"
  echo "$raw"
}

resolve_path() {
  python3 - "$1" <<'PY'
import sys
from pathlib import Path

p = Path(sys.argv[1]).expanduser()
try:
    print(str(p.resolve()))
except Exception:
    print(str(p.absolute()))
PY
}

json_array_1() {
  python3 - "$1" <<'PY'
import json
import sys
from pathlib import Path

p = Path(sys.argv[1]).expanduser()
try:
    p = p.resolve()
except Exception:
    p = p.absolute()
print(json.dumps([str(p)]))
PY
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
  if [[ "$GATEWAY_TOKEN_EXPLICIT" == "1" ]]; then
    openclaw --profile "$profile" config set gateway.auth.token "$GATEWAY_TOKEN" >/dev/null
    openclaw --profile "$profile" config set gateway.remote.token "$GATEWAY_TOKEN" >/dev/null
  else
    # Respect profile .env secrets. Many OpenClaw setups provide OPENCLAW_GATEWAY_TOKEN via .env,
    # and OpenClaw may treat it as a runtime override. Keeping config tokens as a placeholder avoids
    # mismatches that would otherwise cause "unauthorized ... Falling back to embedded", which
    # changes /new semantics.
    openclaw --profile "$profile" config set gateway.auth.token '${OPENCLAW_GATEWAY_TOKEN}' >/dev/null
    openclaw --profile "$profile" config set gateway.remote.token '${OPENCLAW_GATEWAY_TOKEN}' >/dev/null
  fi
}

start_gateway() {
  local profile="$1"
  local port="$2"
  local log_path="$3"

  configure_gateway_settings "$profile" "$port"

  log "Starting OpenClaw gateway for profile=$profile (port=$port, logs=$log_path)"
  if [[ "$GATEWAY_TOKEN_EXPLICIT" == "1" ]]; then
    # If the user provided --gateway-token, force it for the gateway process to avoid runtime overrides.
    OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" nohup openclaw --profile "$profile" gateway >"$log_path" 2>&1 &
  else
    nohup openclaw --profile "$profile" gateway >"$log_path" 2>&1 &
  fi
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
  if [[ "${WIPE_AGENT_SESSIONS}" == "0" ]]; then
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

ensure_agent_in_profile_json() {
  local profile="$1"
  local cfg_path="$HOME/.openclaw-${profile}/openclaw.json"
  if [[ ! -f "$cfg_path" ]]; then
    echo "ERROR: Missing profile config: $cfg_path" >&2
    exit 2
  fi
  python3 - <<'PY' "$cfg_path" "$AGENT_NAME"
import json
import sys
from pathlib import Path

cfg_path = Path(sys.argv[1])
agent = sys.argv[2]

cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
if not isinstance(cfg, dict):
    raise SystemExit("openclaw.json must be an object")

agents = cfg.get("agents")
if not isinstance(agents, dict):
    agents = {}
    cfg["agents"] = agents

lst = agents.get("list")
if not isinstance(lst, list):
    lst = []
    agents["list"] = lst

found = False
for item in lst:
    if isinstance(item, dict) and item.get("id") == agent:
        found = True
        break
if not found:
    lst.append({"id": agent})
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
}

recreate_profile_from_template() {
  local profile="$1"
  local template_dir="$2"
  local env_file="$3"

  local target_dir="$HOME/.openclaw-${profile}"
  if [[ -z "$template_dir" ]]; then
    echo "ERROR: --profiles-template-dir is required with --recreate-profiles" >&2
    exit 2
  fi
  if [[ ! -d "$template_dir" ]]; then
    echo "ERROR: Template dir not found: $template_dir" >&2
    exit 2
  fi
  if [[ "$template_dir" == "$target_dir" ]]; then
    echo "ERROR: Template dir must differ from target profile dir: $template_dir" >&2
    exit 2
  fi

  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  log "Recreating profile=$profile from template: $template_dir -> $target_dir"
  cp -a "$template_dir/." "$target_dir/"

  if [[ -n "$env_file" ]]; then
    if [[ ! -f "$env_file" ]]; then
      echo "ERROR: env file not found: $env_file" >&2
      exit 2
    fi
    cp -f "$env_file" "$target_dir/.env"
    chmod 600 "$target_dir/.env" 2>/dev/null || true
    log "Copied env file into profile dir: $target_dir/.env"
  fi

  if [[ ! -f "$target_dir/openclaw.json" ]]; then
    echo "ERROR: Template did not provide openclaw.json at: $target_dir/openclaw.json" >&2
    exit 2
  fi

  # Ensure the target agent id exists in the profile config so run_batch.py can write transcripts.
  ensure_agent_in_profile_json "$profile"
}

sync_profile_env_if_requested() {
  local profile="$1"
  if [[ -z "$PROFILES_ENV_FILE" ]]; then
    return
  fi
  local target_dir="$HOME/.openclaw-${profile}"
  if [[ ! -d "$target_dir" ]]; then
    return
  fi
  cp -f "$PROFILES_ENV_FILE" "$target_dir/.env"
  chmod 600 "$target_dir/.env" 2>/dev/null || true
  log "Synced env file into profile dir: $target_dir/.env"
}

resolve_compact_preset_path() {
  local spec="$1"
  if [[ -z "$spec" ]]; then
    return 0
  fi
  if [[ "$spec" == *"/"* || "$spec" == *.json ]]; then
    echo "$spec"
    return 0
  fi
  echo "$MRNIAH_DIR/openclaw/compact/${spec}.json"
}

apply_profile_overrides() {
  local profile="$1"

  if [[ -n "$MODEL_PRIMARY" ]]; then
    log "Setting model for profile=$profile: $MODEL_PRIMARY"
    openclaw --profile "$profile" config set agents.defaults.model.primary "$MODEL_PRIMARY" >/dev/null
  fi

  if [[ -n "$COMPACT_SPEC" ]]; then
    local preset_path
    preset_path="$(resolve_compact_preset_path "$COMPACT_SPEC")"
    if [[ ! -f "$preset_path" ]]; then
      echo "ERROR: compaction preset not found: $preset_path" >&2
      exit 2
    fi
    log "Applying compaction preset for profile=$profile: $preset_path"
    local out
    out="$(python3 - <<'PY' "$preset_path"
import json
import sys
from pathlib import Path

p = Path(sys.argv[1])
data = json.loads(p.read_text(encoding="utf-8"))
if not isinstance(data, dict):
    raise SystemExit("preset must be a JSON object")
context_tokens = data.get("contextTokens")
compaction = data.get("compaction")
if not isinstance(context_tokens, int) or context_tokens <= 0:
    raise SystemExit("preset.contextTokens must be a positive integer")
if not isinstance(compaction, dict) or not compaction:
    raise SystemExit("preset.compaction must be a non-empty object")
print(context_tokens)
print(json.dumps(compaction, ensure_ascii=False, separators=(",", ":")))
PY
)"
    local context_tokens
    local compaction_json
    context_tokens="$(echo "$out" | head -n 1)"
    compaction_json="$(echo "$out" | tail -n 1)"
    openclaw --profile "$profile" config set --strict-json agents.defaults.contextTokens "$context_tokens" >/dev/null
    openclaw --profile "$profile" config set --strict-json agents.defaults.compaction "$compaction_json" >/dev/null
  fi

  if [[ "$MODEL_CONTEXT_WINDOW" -gt 0 && -n "$MODEL_PRIMARY" ]]; then
    local cfg_path="$HOME/.openclaw-${profile}/openclaw.json"
    if [[ -f "$cfg_path" ]]; then
      local patch_script="$MRNIAH_DIR/openclaw/patch_model_context_window.py"
      if [[ -f "$patch_script" ]]; then
        local res
        res="$(python3 "$patch_script" --openclaw-json "$cfg_path" --model "$MODEL_PRIMARY" --context-window "$MODEL_CONTEXT_WINDOW" 2>/dev/null || true)"
        if [[ "$res" == "patched" ]]; then
          log "Patched model contextWindow in $cfg_path (model=$MODEL_PRIMARY contextWindow=$MODEL_CONTEXT_WINDOW)"
        else
          log "NOTE: model contextWindow patch noop for profile=$profile (model=$MODEL_PRIMARY). This is best-effort; ensure your openclaw.json model catalog includes that model id."
        fi
      fi
    fi
  fi
}

setup_workspace() {
  local profile="$1"
  local ws_dir="$HOME/.openclaw-${profile}/workspace"
  rm -rf "$ws_dir"
  mkdir -p "$ws_dir"
  cp -r "$ROOT/benchmark/workspace/." "$ws_dir/"
  # Ensure the OpenClaw profile actually uses the benchmark workspace directory.
  # (Some profiles pin agents.defaults.workspace to ~/.openclaw-<profile>/workspace.)
  # Provide OPENCLAW_WORKSPACE to avoid noisy warnings when the template openclaw.json uses ${OPENCLAW_WORKSPACE}.
  OPENCLAW_WORKSPACE="$ws_dir" openclaw --profile "$profile" config set agents.defaults.workspace "$ws_dir" >/dev/null
  log "Copied workspace files to $ws_dir"
}

clone_mem_profile_if_needed() {
  local base_dir="$HOME/.openclaw-${BASE_PROFILE}"
  local target_dir="$HOME/.openclaw-${MEM_PROFILE}"

  if [[ -d "$target_dir" && "$RESET_MEM_PROFILE" != "1" ]]; then
    log "Mem profile already exists: $target_dir (use --reset-mem-profile to regenerate)"
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

  if [[ "$MEM9_ISOLATION" == "clear" ]]; then
    MEM9_SPACE_ID="$(provision_tenant)"
    log "Provisioned fresh mem9 space ID: $MEM9_SPACE_ID"
  else
    MEM9_SPACE_ID="__per_case__"
    log "mem9 isolation=tenant: provisioning a fresh mem9 space per case (tenantID will be set by run_batch.py)"
  fi

  log "Configuring mem profile: $MEM_PROFILE"
  openclaw --profile "$MEM_PROFILE" config set gateway.mode local >/dev/null

  # Configure mem9 plugin via explicit load paths + allow list.
  # This avoids relying on plugin auto-discovery from the copied workspace and keeps the final config minimal:
  # - plugins.allow = ["mem9"]
  # - plugins.load.paths = ["<OPENCLAW_PLUGIN_DIR>"]
  #
  # Write allow+load in a single config update to avoid transient states (and extra warnings) between writes.
  local plugins_json
  plugins_json="$(python3 - "$OPENCLAW_PLUGIN_DIR" <<'PY'
import json
import sys
from pathlib import Path

plugin_dir = Path(sys.argv[1]).expanduser()
try:
    plugin_dir = plugin_dir.resolve()
except Exception:
    plugin_dir = plugin_dir.absolute()

print(
    json.dumps(
        {
            "allow": ["mem9"],
            "load": {"paths": [str(plugin_dir)]},
        },
        separators=(",", ":"),
    )
)
PY
)"
  openclaw --profile "$MEM_PROFILE" config set --strict-json plugins "$plugins_json" >/dev/null

  # Optional: record an install provenance entry for local-path plugins.
  # This mirrors the shape OpenClaw writes for "source=path" installs and can reduce provenance warnings.
  # Best-effort: do not fail the run if the OpenClaw build does not support this field.
  local plugin_version installed_at
  plugin_version="$(python3 - <<'PY' "$OPENCLAW_PLUGIN_DIR/package.json"
import json, sys
from pathlib import Path

p = Path(sys.argv[1])
obj = json.loads(p.read_text(encoding="utf-8"))
print(obj.get("version", ""))
PY
)"
  installed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -n "$plugin_version" ]]; then
    openclaw --profile "$MEM_PROFILE" config set plugins.installs.mem9.source path >/dev/null 2>&1 || true
    openclaw --profile "$MEM_PROFILE" config set plugins.installs.mem9.sourcePath "$OPENCLAW_PLUGIN_DIR" >/dev/null 2>&1 || true
    openclaw --profile "$MEM_PROFILE" config set plugins.installs.mem9.installPath "$OPENCLAW_PLUGIN_DIR" >/dev/null 2>&1 || true
    openclaw --profile "$MEM_PROFILE" config set plugins.installs.mem9.version "$plugin_version" >/dev/null 2>&1 || true
    openclaw --profile "$MEM_PROFILE" config set plugins.installs.mem9.installedAt "$installed_at" >/dev/null 2>&1 || true
  fi

  openclaw --profile "$MEM_PROFILE" config set plugins.slots.memory mem9 >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.enabled true >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.config.apiUrl "$api_url" >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.config.apiKey "$MEM9_SPACE_ID" >/dev/null
  # Keep tenantID in sync with apiKey (apiKey is the primary v1alpha2 credential; tenantID helps debug/back-compat).
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.config.tenantID "$MEM9_SPACE_ID" >/dev/null

  # Best-effort: ensure built-in memory plugins are disabled explicitly.
  # Do not fail the run if a given built-in plugin id does not exist in the user's OpenClaw build.
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.memory-core.enabled false >/dev/null 2>&1 || true
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.memory-lancedb.enabled false >/dev/null 2>&1 || true
}

run_batch_for_profile() {
  local profile="$1"
  local label="$2"
  local out_dir="$MRNIAH_DIR/results-${profile}"

  log "Running run_batch.py for profile=$profile (label=$label)"
  if [[ "${WIPE_AGENT_SESSIONS}" == "0" ]]; then
    clean_bench_sessions "$profile"
  fi
  if [[ -n "$RESUME_FROM" || -n "$RUN_ONLY_CASE" ]]; then
    log "Keeping results dir: ${out_dir}"
  else
    rm -rf "$out_dir"
  fi
  mkdir -p "$out_dir"
  cat >"${out_dir}/run_info.json" <<EOF
{
  "runId": "${RUN_ID}",
  "profile": "${profile}",
  "label": "${label}",
  "outputDir": "${OUTPUT_DIR}",
  "modelPrimary": "${MODEL_PRIMARY}",
  "modelContextWindow": ${MODEL_CONTEXT_WINDOW},
  "compactSpec": "${COMPACT_SPEC}",
  "profilesRecreated": ${RECREATE_PROFILES},
  "profilesTemplateDir": "${PROFILES_TEMPLATE_DIR}",
  "mem9Isolation": "${MEM9_ISOLATION}",
  "mem9LoadMethod": "${MEM9_LOAD_METHOD}",
  "mem9LineWriteSleepMs": ${MEM9_LINE_WRITE_SLEEP_MS},
  "mem9LineWriteVerifyTimeout": ${MEM9_LINE_WRITE_VERIFY_TIMEOUT},
  "mem9LineWriteVerifyInterval": ${MEM9_LINE_WRITE_VERIFY_INTERVAL},
  "mem9ImportTimeout": ${MEM9_IMPORT_TIMEOUT},
  "mem9ImportPollInterval": ${MEM9_IMPORT_POLL_INTERVAL},
  "mem9TraceLimit": ${MEM9_TRACE_LIMIT},
  "mem9TraceChars": ${MEM9_TRACE_CHARS},
  "mem9TraceQueryChars": ${MEM9_TRACE_QUERY_CHARS},
  "openclawPluginDir": "${OPENCLAW_PLUGIN_DIR}",
  "openclawPluginInstallMode": "${OPENCLAW_PLUGIN_INSTALL_MODE}",
  "openclawTimeout": ${OPENCLAW_TIMEOUT},
  "parallelRuns": ${PARALLEL_RUNS},
  "cleanSessions": ${CLEAN_SESSIONS},
  "wipeAgentSessions": ${WIPE_AGENT_SESSIONS},
  "wipeLocalMemory": ${WIPE_LOCAL_MEMORY},
  "startedAtUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

  # Use -u to avoid Python stdout buffering when output is piped through tee.
  local cmd=(python3 -u run_batch.py --output-dir "$OUTPUT_DIR" --profile "$profile" --agent "$AGENT_NAME" --limit "$SAMPLE_LIMIT" --results-dir "$out_dir")
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
    cmd+=(--mem9-load-method "$MEM9_LOAD_METHOD")
    if [[ "$MEM9_ISOLATION" == "clear" ]]; then
      cmd+=(--mem9-clear-memories --mem9-tenant-id "$MEM9_SPACE_ID")
    elif [[ "$MEM9_ISOLATION" == "tenant" ]]; then
      cmd+=(--mem9-provision-per-case --gateway-port "$MEM_GATEWAY_PORT" --gateway-log "$MEM_GATEWAY_LOG")
    else
      echo "ERROR: Invalid --mem9-isolation=$MEM9_ISOLATION (expected: tenant|clear)" >&2
      exit 2
    fi
    if [[ "$MEM9_LOAD_METHOD" == "line-write" ]]; then
      cmd+=(--mem9-line-write-sleep-ms "$MEM9_LINE_WRITE_SLEEP_MS")
      cmd+=(--mem9-line-write-verify-timeout "$MEM9_LINE_WRITE_VERIFY_TIMEOUT")
      cmd+=(--mem9-line-write-verify-interval "$MEM9_LINE_WRITE_VERIFY_INTERVAL")
    elif [[ "$MEM9_LOAD_METHOD" == "import-session" ]]; then
      cmd+=(--mem9-import-timeout "$MEM9_IMPORT_TIMEOUT")
      cmd+=(--mem9-import-poll-interval "$MEM9_IMPORT_POLL_INTERVAL")
    fi
    cmd+=(--mem9-trace-limit "$MEM9_TRACE_LIMIT")
    cmd+=(--mem9-trace-chars "$MEM9_TRACE_CHARS")
    cmd+=(--mem9-trace-query-chars "$MEM9_TRACE_QUERY_CHARS")
  fi
  if [[ "${OPENCLAW_TIMEOUT}" != "0" ]]; then
    cmd+=(--openclaw-timeout "$OPENCLAW_TIMEOUT")
  fi
  if [[ "$RESET_MODE" == "1" ]]; then
    cmd+=(--reset)
  elif [[ "$NEW_MODE" == "1" ]]; then
    cmd+=(--new)
  fi
  if [[ "${WIPE_LOCAL_MEMORY}" != "0" ]]; then
    cmd+=(--wipe-local-memory)
  fi

  if [[ "$GATEWAY_TOKEN_EXPLICIT" == "1" ]]; then
    if ! (cd "$MRNIAH_DIR" && OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" "${cmd[@]}") >&2; then
      echo "ERROR: run_batch.py failed for profile=$profile" >&2
      exit 2
    fi
  else
    if ! (cd "$MRNIAH_DIR" && "${cmd[@]}") >&2; then
      echo "ERROR: run_batch.py failed for profile=$profile" >&2
      exit 2
    fi
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
  if [[ "${WIPE_AGENT_SESSIONS}" != "0" ]]; then
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

maybe_archive_success() {
  local base_dir="$1"
  local mem_dir="$2"

  # Only archive full baseline-vs-mem comparisons (not single-profile runs, not compare-only, not resume/case).
  if [[ -n "$RUN_ONLY_PROFILE" ]]; then
    return
  fi
  if [[ "$COMPARE_ONLY" == "1" ]]; then
    return
  fi
  if [[ -n "$RESUME_FROM" || -n "$RUN_ONLY_CASE" ]]; then
    return
  fi

  if [[ -z "$base_dir" || -z "$mem_dir" || -z "$LOG_FILE" ]]; then
    return
  fi
  if [[ ! -d "$base_dir" || ! -d "$mem_dir" || ! -f "$LOG_FILE" ]]; then
    return
  fi

  mkdir -p "$LOG_DIR"
  local archive_name="mrniah_compare_${RUN_ID}_${BASE_PROFILE}_vs_${MEM_PROFILE}.tar.gz"
  ARCHIVE_PATH="${LOG_DIR}/${archive_name}"
  log "Archiving artifacts to $ARCHIVE_PATH"

  if ! tar -zcf "$ARCHIVE_PATH" \
    -C "$MRNIAH_DIR" "$(basename "$base_dir")" "$(basename "$mem_dir")" \
    -C "$LOG_DIR" "$(basename "$LOG_FILE")"; then
    log "WARNING: Failed to create archive at $ARCHIVE_PATH (run artifacts are still available on disk)"
    ARCHIVE_PATH=""
    return
  fi
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --base-profile)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --base-profile requires a value" >&2
          exit 2
        fi
        BASE_PROFILE="$2"
        BASE_PROFILE_EXPLICIT=1
        shift 2
        ;;
      --mem-profile)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem-profile requires a value" >&2
          exit 2
        fi
        MEM_PROFILE="$2"
        MEM_PROFILE_EXPLICIT=1
        shift 2
        ;;
      --agent)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --agent requires a value" >&2
          exit 2
        fi
        AGENT_NAME="$2"
        shift 2
        ;;
      --limit)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --limit requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --limit must be an integer; got: $2" >&2
          exit 2
        fi
        SAMPLE_LIMIT="$2"
        shift 2
        ;;
      --output-dir)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --output-dir requires a value" >&2
          exit 2
        fi
        OUTPUT_DIR="$2"
        shift 2
        ;;
      --model)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --model requires a value" >&2
          exit 2
        fi
        MODEL_PRIMARY="$2"
        shift 2
        ;;
      --model-context-window)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --model-context-window requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --model-context-window must be an integer; got: $2" >&2
          exit 2
        fi
        MODEL_CONTEXT_WINDOW="$2"
        shift 2
        ;;
      --compact)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --compact requires a value" >&2
          exit 2
        fi
        COMPACT_SPEC="$2"
        shift 2
        ;;
      --recreate-profiles)
        RECREATE_PROFILES_MODE="1"
        shift
        ;;
      --no-recreate-profiles)
        RECREATE_PROFILES_MODE="0"
        shift
        ;;
      --profiles-template-dir)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --profiles-template-dir requires a value" >&2
          exit 2
        fi
        PROFILES_TEMPLATE_DIR="$2"
        shift 2
        ;;
      --profiles-env-file)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --profiles-env-file requires a value" >&2
          exit 2
        fi
        PROFILES_ENV_FILE="$2"
        shift 2
        ;;
      --openclaw-plugin-dir)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --openclaw-plugin-dir requires a value" >&2
          exit 2
        fi
        OPENCLAW_PLUGIN_DIR="$2"
        shift 2
        ;;
      --openclaw-plugin-install-mode)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --openclaw-plugin-install-mode requires a value" >&2
          exit 2
        fi
        case "$2" in
          copy|link)
            OPENCLAW_PLUGIN_INSTALL_MODE="$2"
            ;;
          *)
            echo "ERROR: --openclaw-plugin-install-mode must be one of: copy, link (legacy); got: $2" >&2
            exit 2
            ;;
        esac
        shift 2
        ;;
      --compare)
        COMPARE_ONLY=1
        shift
        ;;
      --mem9-base-url)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-base-url requires a value" >&2
          exit 2
        fi
        MEM9_BASE_URL="$2"
        shift 2
        ;;
      --openclaw-timeout)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --openclaw-timeout requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --openclaw-timeout must be an integer seconds; got: $2" >&2
          exit 2
        fi
        OPENCLAW_TIMEOUT="$2"
        shift 2
        ;;
      --clean-sessions)
        CLEAN_SESSIONS="1"
        shift
        ;;
      --no-clean-sessions)
        CLEAN_SESSIONS="0"
        shift
        ;;
      --wipe-agent-sessions)
        WIPE_AGENT_SESSIONS="1"
        shift
        ;;
      --no-wipe-agent-sessions)
        WIPE_AGENT_SESSIONS="0"
        shift
        ;;
      --wipe-local-memory)
        WIPE_LOCAL_MEMORY="1"
        shift
        ;;
      --no-wipe-local-memory)
        WIPE_LOCAL_MEMORY="0"
        shift
        ;;
      --parallel)
        PARALLEL_RUNS="1"
        shift
        ;;
      --sequential|--sequential-runs)
        PARALLEL_RUNS="0"
        shift
        ;;
      --mem9-isolation)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-isolation requires a value (tenant|clear)" >&2
          exit 2
        fi
        if [[ "$2" != "tenant" && "$2" != "clear" ]]; then
          echo "ERROR: --mem9-isolation must be tenant|clear; got: $2" >&2
          exit 2
        fi
        MEM9_ISOLATION="$2"
        shift 2
        ;;
      --mem9-load-method)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-load-method requires a value (line-write|import-session)" >&2
          exit 2
        fi
        if [[ "$2" != "line-write" && "$2" != "import-session" ]]; then
          echo "ERROR: --mem9-load-method must be line-write|import-session; got: $2" >&2
          exit 2
        fi
        MEM9_LOAD_METHOD="$2"
        shift 2
        ;;
      --mem9-line-write-sleep-ms)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-line-write-sleep-ms requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --mem9-line-write-sleep-ms must be an integer ms; got: $2" >&2
          exit 2
        fi
        MEM9_LINE_WRITE_SLEEP_MS="$2"
        shift 2
        ;;
      --mem9-line-write-verify-timeout)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-line-write-verify-timeout requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
          echo "ERROR: --mem9-line-write-verify-timeout must be a number; got: $2" >&2
          exit 2
        fi
        MEM9_LINE_WRITE_VERIFY_TIMEOUT="$2"
        shift 2
        ;;
      --mem9-line-write-verify-interval)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-line-write-verify-interval requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
          echo "ERROR: --mem9-line-write-verify-interval must be a number; got: $2" >&2
          exit 2
        fi
        MEM9_LINE_WRITE_VERIFY_INTERVAL="$2"
        shift 2
        ;;
      --mem9-import-timeout)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-import-timeout requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --mem9-import-timeout must be an integer seconds; got: $2" >&2
          exit 2
        fi
        MEM9_IMPORT_TIMEOUT="$2"
        shift 2
        ;;
      --mem9-import-poll-interval)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-import-poll-interval requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
          echo "ERROR: --mem9-import-poll-interval must be a number; got: $2" >&2
          exit 2
        fi
        MEM9_IMPORT_POLL_INTERVAL="$2"
        shift 2
        ;;
      --mem9-trace-limit)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-trace-limit requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --mem9-trace-limit must be an integer; got: $2" >&2
          exit 2
        fi
        MEM9_TRACE_LIMIT="$2"
        shift 2
        ;;
      --mem9-trace-chars)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-trace-chars requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --mem9-trace-chars must be an integer; got: $2" >&2
          exit 2
        fi
        MEM9_TRACE_CHARS="$2"
        shift 2
        ;;
      --mem9-trace-query-chars)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem9-trace-query-chars requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --mem9-trace-query-chars must be an integer; got: $2" >&2
          exit 2
        fi
        MEM9_TRACE_QUERY_CHARS="$2"
        shift 2
        ;;
      --reset-mem-profile)
        RESET_MEM_PROFILE="1"
        shift
        ;;
      --base-gateway-port)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --base-gateway-port requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --base-gateway-port must be an integer; got: $2" >&2
          exit 2
        fi
        BASE_GATEWAY_PORT_PREFERRED="$2"
        shift 2
        ;;
      --mem-gateway-port)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --mem-gateway-port requires a value" >&2
          exit 2
        fi
        if ! [[ "$2" =~ ^[0-9]+$ ]]; then
          echo "ERROR: --mem-gateway-port must be an integer; got: $2" >&2
          exit 2
        fi
        MEM_GATEWAY_PORT_PREFERRED="$2"
        shift 2
        ;;
      --gateway-token)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --gateway-token requires a value" >&2
          exit 2
        fi
        GATEWAY_TOKEN="$2"
        GATEWAY_TOKEN_EXPLICIT=1
        shift 2
        ;;
      --log-dir)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: --log-dir requires a value" >&2
          exit 2
        fi
        LOG_DIR="$2"
        shift 2
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

  # Decide managed profiles mode.
  if [[ "$RECREATE_PROFILES_MODE" == "auto" ]]; then
    # Default to managed profiles only for full baseline-vs-mem compares.
    if [[ -z "$RUN_ONLY_PROFILE" && "$COMPARE_ONLY" != "1" ]]; then
      RECREATE_PROFILES=1
    else
      RECREATE_PROFILES=0
    fi
  else
    RECREATE_PROFILES="$RECREATE_PROFILES_MODE"
  fi

  # Defaults for managed profiles.
  if [[ "$RECREATE_PROFILES" == "1" ]]; then
    if [[ -z "$PROFILES_TEMPLATE_DIR" ]]; then
      PROFILES_TEMPLATE_DIR="$MRNIAH_DIR/config/openclaw"
    fi
    if [[ -z "$PROFILES_ENV_FILE" ]]; then
      PROFILES_ENV_FILE="$MRNIAH_DIR/config/openclaw/.env"
    fi
  fi

  # If managed profiles is enabled and user didn't specify both profiles, auto-suffix to avoid colliding
  # with existing long-running benchmarks.
  if [[ "$RECREATE_PROFILES" == "1" ]]; then
    if [[ "$BASE_PROFILE_EXPLICIT" != "$MEM_PROFILE_EXPLICIT" ]]; then
      echo "ERROR: In managed profiles mode, either specify both --base-profile and --mem-profile, or neither." >&2
      exit 2
    fi
    if [[ "$BASE_PROFILE_EXPLICIT" == "0" ]]; then
      RUN_TAG="$(date -u +%Y%m%d%H%M%S)"
      BASE_PROFILE="${BASE_PROFILE}_${RUN_TAG}"
      MEM_PROFILE="${MEM_PROFILE}_${RUN_TAG}"
    fi
    RESET_MEM_PROFILE="1"
  fi

  if [[ "$RESET_MODE" == "1" && "$NEW_MODE" == "1" ]]; then
    echo "ERROR: --reset and --new are mutually exclusive." >&2
    exit 2
  fi
  # Normalize commonly user-provided paths to avoid provenance mismatches such as /tmp vs /private/tmp.
  OPENCLAW_PLUGIN_DIR="$(resolve_path "$OPENCLAW_PLUGIN_DIR")"
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

  # Safety: if managed profiles is disabled for full compares, require explicit profile names.
  if [[ -z "$RUN_ONLY_PROFILE" && "$COMPARE_ONLY" != "1" && "$RECREATE_PROFILES" != "1" ]]; then
    if [[ "$BASE_PROFILE_EXPLICIT" != "1" || "$MEM_PROFILE_EXPLICIT" != "1" ]]; then
      echo "ERROR: Full compare runs require explicit --base-profile and --mem-profile unless managed profiles is enabled." >&2
      echo "Hint: either enable managed profiles via --recreate-profiles (optionally override template/env paths), or pass both --base-profile/--mem-profile." >&2
      exit 2
    fi
  fi

  if [[ "$BASE_PROFILE" == "$MEM_PROFILE" ]]; then
    echo "ERROR: --base-profile and --mem-profile must differ." >&2
    exit 2
  fi
  if [[ "$RECREATE_PROFILES" == "1" && -z "$PROFILES_TEMPLATE_DIR" ]]; then
    echo "ERROR: managed profiles mode requires --profiles-template-dir <dir>" >&2
    exit 2
  fi
  if [[ -n "$PROFILES_ENV_FILE" && ! -f "$PROFILES_ENV_FILE" ]]; then
    echo "ERROR: --profiles-env-file not found: $PROFILES_ENV_FILE" >&2
    echo "Hint: copy benchmark/MR-NIAH/config/openclaw/example.env -> benchmark/MR-NIAH/config/openclaw/.env and fill your keys." >&2
    exit 2
  fi
  if [[ "$MODEL_CONTEXT_WINDOW" -gt 0 && -z "$MODEL_PRIMARY" ]]; then
    echo "ERROR: --model-context-window requires --model <provider/model>" >&2
    exit 2
  fi

  # Normalize output dir (accept relative paths; interpret relative to MRNIAH_DIR for reproducibility).
  if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$MRNIAH_DIR/output"
  fi
  if [[ "$OUTPUT_DIR" != /* ]]; then
    OUTPUT_DIR="$MRNIAH_DIR/$OUTPUT_DIR"
  fi
  if [[ -d "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
  fi
  INDEX_FILE="$OUTPUT_DIR/index.jsonl"

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
    local mem_label="$MEM_PROFILE"
    if [[ "$MEM9_LOAD_METHOD" != "import-session" ]]; then
      mem_label="${MEM_PROFILE}-${MEM9_LOAD_METHOD}"
    fi
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
    summarize_accuracy "$base_dir" "$BASE_PROFILE" "$mem_dir" "$mem_label"
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
    if [[ "$RUN_ONLY_PROFILE" == "$MEM_PROFILE" ]]; then
      # Mem profile runs depend on baseline as a clone source.
      if [[ "$RECREATE_PROFILES" == "1" ]]; then
        recreate_profile_from_template "$BASE_PROFILE" "$PROFILES_TEMPLATE_DIR" "$PROFILES_ENV_FILE"
      else
        ensure_profile_exists "$BASE_PROFILE"
      fi
      sync_profile_env_if_requested "$BASE_PROFILE"
      setup_workspace "$BASE_PROFILE"
      apply_profile_overrides "$BASE_PROFILE"

      # Force re-clone of mem profile so baseline+mem remain consistent.
      # (clone + mem9 install/config happens later in configure_mem_profile)
      RESET_MEM_PROFILE=1
    else
      if [[ "$RECREATE_PROFILES" == "1" ]]; then
        recreate_profile_from_template "$RUN_ONLY_PROFILE" "$PROFILES_TEMPLATE_DIR" "$PROFILES_ENV_FILE"
      else
        ensure_profile_exists "$RUN_ONLY_PROFILE"
      fi
      sync_profile_env_if_requested "$RUN_ONLY_PROFILE"
      setup_workspace "$RUN_ONLY_PROFILE"
      apply_profile_overrides "$RUN_ONLY_PROFILE"
    fi
  else
    if [[ "$RECREATE_PROFILES" == "1" ]]; then
      recreate_profile_from_template "$BASE_PROFILE" "$PROFILES_TEMPLATE_DIR" "$PROFILES_ENV_FILE"
      # Always re-clone mem profile from baseline in managed mode.
      RESET_MEM_PROFILE=1
    else
      ensure_profile_exists "$BASE_PROFILE"
    fi
    sync_profile_env_if_requested "$BASE_PROFILE"
    setup_workspace "$BASE_PROFILE"
    apply_profile_overrides "$BASE_PROFILE"
    clone_mem_profile_if_needed
    sync_profile_env_if_requested "$MEM_PROFILE"
    apply_profile_overrides "$MEM_PROFILE"
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
  if [[ -z "$RUN_ONLY_PROFILE" ]] || [[ "$RUN_ONLY_PROFILE" == "$MEM_PROFILE" ]]; then
    # Ensure the mem profile sees the same model/compaction overrides as baseline.
    sync_profile_env_if_requested "$MEM_PROFILE"
    apply_profile_overrides "$MEM_PROFILE"
  fi

  # Ensure previous runs (especially /new or /reset) do not pollute the session store.
  if [[ -n "$RUN_ONLY_PROFILE" ]]; then
    wipe_agent_sessions "$RUN_ONLY_PROFILE" "pre-run"
  else
    wipe_agent_sessions "$BASE_PROFILE" "pre-run"
    wipe_agent_sessions "$MEM_PROFILE" "pre-run"
  fi

  BASE_GATEWAY_PORT="$(pick_free_port "$BASE_GATEWAY_PORT_PREFERRED")"
  MEM_GATEWAY_PORT="$(pick_free_port "$MEM_GATEWAY_PORT_PREFERRED")"
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
    local label="$prof"
    local gw_log="${LOG_DIR}/gateway_${prof}_${BASE_GATEWAY_PORT}.log"
    BASE_GATEWAY_LOG="$gw_log"
    if [[ "$prof" == "$MEM_PROFILE" && "$MEM9_ISOLATION" == "tenant" ]]; then
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
    out_dir="$(run_batch_for_profile "$prof" "$label")"

    echo ""
    echo "======== Accuracy Summary ========"
    python3 "$MRNIAH_DIR/score.py" "${out_dir}/predictions.jsonl"

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

    if [[ "$MEM9_ISOLATION" == "tenant" ]]; then
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

    local base_dir
    local mem_dir
    local mem_label="$MEM_PROFILE"
    if [[ "$MEM9_LOAD_METHOD" != "import-session" ]]; then
      mem_label="${MEM_PROFILE}-${MEM9_LOAD_METHOD}"
    fi
    log "=== Baseline run (${BASE_PROFILE}) ==="
    if [[ "${PARALLEL_RUNS}" != "0" ]]; then
      log "=== Parallel run: baseline + mem ==="
      local base_dir_file
      local mem_dir_file
      base_dir_file="$(mktemp)"
      mem_dir_file="$(mktemp)"

      (run_batch_for_profile "$BASE_PROFILE" "$BASE_PROFILE" >"$base_dir_file") &
      local base_job=$!
      (run_batch_for_profile "$MEM_PROFILE" "$mem_label" >"$mem_dir_file") &
      local mem_job=$!

      local base_ok=1
      local mem_ok=1
      if ! wait "$base_job"; then
        base_ok=0
      fi
      if ! wait "$mem_job"; then
        mem_ok=0
      fi
      base_dir="$(cat "$base_dir_file" 2>/dev/null || true)"
      mem_dir="$(cat "$mem_dir_file" 2>/dev/null || true)"
      rm -f "$base_dir_file" "$mem_dir_file" >/dev/null 2>&1 || true

      if [[ "$base_ok" != "1" || "$mem_ok" != "1" ]]; then
        echo "ERROR: parallel run failed (baseline_ok=$base_ok mem_ok=$mem_ok)" >&2
        exit 2
      fi
    else
      base_dir="$(run_batch_for_profile "$BASE_PROFILE" "$BASE_PROFILE")"

      log "=== Mem run (${mem_label}) ==="
      mem_dir="$(run_batch_for_profile "$MEM_PROFILE" "$mem_label")"
    fi

    summarize_accuracy "$base_dir" "$BASE_PROFILE" "$mem_dir" "$mem_label"
    maybe_archive_success "$base_dir" "$mem_dir"

    cat <<EOF

Artifacts:
- Baseline results: $base_dir
- Mem results:     $mem_dir
- Compare log:     $LOG_FILE
- Archive:         ${ARCHIVE_PATH:-<not created>}
- Gateway logs:
  - Baseline: $BASE_GATEWAY_LOG
  - Mem:      $MEM_GATEWAY_LOG
EOF
  fi
}

main "$@"
