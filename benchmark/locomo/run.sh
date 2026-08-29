#!/usr/bin/env bash
set -euo pipefail

# ── Paths ──────────────────────────────────────────────────────────────
LOCOMO_DIR="$(cd "$(dirname "$0")" && pwd)"
MEM9_DIR="$LOCOMO_DIR/../.."

# ── Prompt for LLM config ────────────────────────────────────────────
read -rp "LLM_BASE_URL: " LLM_BASE_URL
read -rp "LLM_MODEL: " LLM_MODEL
read -rsp "LLM_API_KEY: " LLM_API_KEY
echo

# ── Server config ────────────────────────────────────────────────────
export MNEMO_LLM_BASE_URL="$LLM_BASE_URL"
export MNEMO_LLM_MODEL="$LLM_MODEL"
export MNEMO_LLM_API_KEY="$LLM_API_KEY"
export MNEMO_LLM_TIMEOUT="600s"
export MNEMO_DB_BACKEND="tidb"
export MNEMO_FTS_ENABLED="true"
export MNEMO_EMBED_AUTO_MODEL="tidbcloud_free/amazon/titan-embed-text-v2"
export MNEMO_EMBED_AUTO_DIMS="1024"

# ── Benchmark config ─────────────────────────────────────────────────
export OPENAI_BASE_URL="$LLM_BASE_URL"
export OPENAI_API_KEY="$LLM_API_KEY"
export OPENAI_JUDGE_MODEL="$LLM_MODEL"
export OPENAI_CHAT_MODEL="$LLM_MODEL"
export MEM9_BASE_URL="http://127.0.0.1:8080"

# ── Defaults (override via flags) ────────────────────────────────────
TIDB_PORT=4000
SAMPLE_CONCURRENCY=5
INGEST_MODE=raw
SKIP_TIUP=false

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --skip-tiup              Skip starting tiup (use existing TiDB instance)
  --tidb-port PORT         TiDB port (default: 4000)
  --sample-concurrency N   Parallel samples (default: 5)
  --ingest-mode MODE       raw or messages (default: raw)
  -h, --help               Show this help
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tiup)          SKIP_TIUP=true; shift ;;
    --tidb-port)          TIDB_PORT="$2"; shift 2 ;;
    --sample-concurrency) SAMPLE_CONCURRENCY="$2"; shift 2 ;;
    --ingest-mode)        INGEST_MODE="$2"; shift 2 ;;
    -h|--help)            usage ;;
    *)                    echo "Unknown option: $1"; usage ;;
  esac
done

# Update DSN with chosen port
export MNEMO_DSN="root:@tcp(127.0.0.1:$TIDB_PORT)/test?parseTime=true"

# PIDs to clean up on exit
TIUP_PID=""
SERVER_PID=""
BINARY=""

cleanup() {
  echo ""
  echo "Cleaning up..."
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Stopping mem9 server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$TIUP_PID" ]] && kill -0 "$TIUP_PID" 2>/dev/null; then
    echo "Stopping tiup (PID $TIUP_PID)..."
    kill "$TIUP_PID" 2>/dev/null || true
    wait "$TIUP_PID" 2>/dev/null || true
  fi
  if [[ -n "$BINARY" ]] && [[ -f "$BINARY" ]]; then
    rm -f "$BINARY"
  fi
}
trap cleanup EXIT

# ── Step 0: Download dataset if missing ──────────────────────────────
DATA_FILE="$LOCOMO_DIR/data/locomo10.json"
if [[ ! -f "$DATA_FILE" ]]; then
  echo "==> Downloading locomo10.json..."
  mkdir -p "$LOCOMO_DIR/data"
  curl -fSL -o "$DATA_FILE" \
    "https://raw.githubusercontent.com/snap-research/locomo/refs/heads/main/data/locomo10.json"
  echo "    Downloaded: $DATA_FILE"
fi

# ── Step 1: Build mem9 server ────────────────────────────────────────
echo "==> Building mem9 server..."
BINARY="$(mktemp)"
(cd "$MEM9_DIR/server" && go build -o "$BINARY" ./cmd/mnemo-server)
echo "    Built: $BINARY"

# ── Step 2: Start tiup ──────────────────────────────────────────────
if [[ "$SKIP_TIUP" == "false" ]]; then
  echo "==> Starting tiup playground (port $TIDB_PORT)..."
  tiup playground v8.5.1 --without-monitor --tiflash=0 --db.port="$TIDB_PORT" \
    > /dev/null 2>&1 &
  TIUP_PID=$!
  echo "    tiup PID: $TIUP_PID"

  # Wait for TiDB to become ready
  echo -n "    Waiting for TiDB..."
  for i in $(seq 1 60); do
    if mysql -h 127.0.0.1 -P "$TIDB_PORT" -u root -e "SELECT 1" &>/dev/null; then
      echo " ready (${i}s)"
      break
    fi
    if [[ $i -eq 60 ]]; then
      echo " TIMEOUT"
      echo "ERROR: TiDB did not start within 60s."
      exit 1
    fi
    sleep 1
    echo -n "."
  done

  # Initialize schema
  echo "    Initializing schema..."
  mysql -h 127.0.0.1 -P "$TIDB_PORT" -u root test < "$MEM9_DIR/server/schema.sql"
  echo "    Schema ready"
else
  echo "==> Skipping tiup (--skip-tiup)"
fi

# ── Step 3: Start mem9 server ────────────────────────────────────────
echo "==> Starting mem9 server..."
"$BINARY" > /dev/null 2>&1 &
SERVER_PID=$!
echo "    mem9 PID: $SERVER_PID"

# Wait for server to become ready
echo -n "    Waiting for mem9 server..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8080/healthz &>/dev/null; then
    echo " ready (${i}s)"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo " FAILED (process exited)"
    echo "ERROR: mem9 server exited."
    exit 1
  fi
  if [[ $i -eq 30 ]]; then
    echo " TIMEOUT"
    echo "ERROR: mem9 server did not respond within 30s."
    exit 1
  fi
  sleep 1
  echo -n "."
done

# ── Step 4: Run LoCoMo benchmark ─────────────────────────────────────
echo "==> Running LoCoMo benchmark (sample-concurrency=$SAMPLE_CONCURRENCY, ingest-mode=$INGEST_MODE)..."
echo ""

cd "$LOCOMO_DIR"
npx tsx src/cli.ts \
  --data-file ./data/locomo10.json \
  --ingest-mode "$INGEST_MODE" \
  --sample-concurrency "$SAMPLE_CONCURRENCY" \
  --use-llm-judge

echo ""
echo "==> Done"
