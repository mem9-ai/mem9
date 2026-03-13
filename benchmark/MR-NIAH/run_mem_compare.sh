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

MEM9_BASE_URL="${MEM9_BASE_URL:-${MNEMO_API_URL:-https://api.mem9.ai}}"
MEM9_SPACE_ID=""

BASE_CMDS=(openclaw python3 jq curl)

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

configure_base_profile() {
  if [[ "$BASE_PROFILE" == "$MEM_PROFILE" ]]; then
    echo "ERROR: BASE_PROFILE and MEM_PROFILE must differ." >&2
    exit 2
  fi
  local base_dir="$HOME/.openclaw-${BASE_PROFILE}"
  local base_ws="$HOME/.openclaw/workspace-${BASE_PROFILE}"
  if [[ -d "$base_dir" ]]; then
    log "Resetting existing base profile dir: $base_dir"
    rm -rf "$base_dir"
  fi
  if [[ -d "$base_ws" ]]; then
    log "Resetting existing base workspace dir: $base_ws"
    rm -rf "$base_ws"
  fi

  log "Configuring base profile: $BASE_PROFILE"
  openclaw --profile "$BASE_PROFILE" config set gateway.mode local >/dev/null

  cp -r "$ROOT/benchmark/workspace" "$base_ws"
  log "Copied workspace files to $base_ws"
}

clone_profile() {
  local base_dir="$HOME/.openclaw-${BASE_PROFILE}"
  local target_dir="$HOME/.openclaw-${MEM_PROFILE}"
  local target_ws="$HOME/.openclaw/workspace-${MEM_PROFILE}"

  if [[ -d "$target_dir" ]]; then
    log "Resetting existing mem profile dir: $target_dir"
    rm -rf "$target_dir"
  fi
  if [[ -d "$target_ws" ]]; then
    log "Resetting existing mem workspace dir: $target_ws"
    rm -rf "$target_ws"
  fi

  log "Creating mem profile dir by copying $base_dir -> $target_dir"
  mkdir -p "$(dirname "$target_dir")"
  cp -a "$base_dir" "$target_dir"

  cp -r "$ROOT/benchmark/workspace" "$target_ws"
  log "Copied workspace files to $target_ws"
}

configure_mem_profile() {
  local api_url
  api_url="$(normalize_url "$MEM9_BASE_URL")"

  MEM9_SPACE_ID="$(provision_tenant)"
  log "Provisioned fresh mem9 space ID: $MEM9_SPACE_ID"

  log "Configuring mem profile: $MEM_PROFILE"
  openclaw --profile "$MEM_PROFILE" config set gateway.mode local >/dev/null
  openclaw --profile "$MEM_PROFILE" plugins install --link "$ROOT/openclaw-plugin" >/dev/null
  openclaw --profile "$MEM_PROFILE" config set --strict-json plugins.allow '["mem9"]' >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.slots.memory mem9 >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.enabled true >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.config.apiUrl "$api_url" >/dev/null
  openclaw --profile "$MEM_PROFILE" config set plugins.entries.mem9.config.apiKey "$MEM9_SPACE_ID" >/dev/null
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
  configure_base_profile
  clone_profile

  log "Using mem9 service: $MEM9_BASE_URL"

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
