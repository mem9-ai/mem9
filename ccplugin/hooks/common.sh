#!/usr/bin/env bash
# common.sh — Shared helpers for mnemo hooks.
# Sourced by all hook scripts.
#
# Mode detection:
#   MNEMO_DB_HOST set → direct mode (TiDB Serverless HTTP Data API)
#   MNEMO_API_URL set → server mode (mnemo-server REST API)

set -euo pipefail

MNEMO_SPACE_ID="default"

# Detect which mode we're in.
mnemo_mode() {
  if [[ -n "${MNEMO_DB_HOST:-}" ]]; then
    echo "direct"
  elif [[ -n "${MNEMO_API_URL:-}" ]]; then
    echo "server"
  else
    echo "none"
  fi
}

# Validate that at least one mode is configured.
mnemo_check_env() {
  local mode
  mode=$(mnemo_mode)
  if [[ "$mode" == "none" ]]; then
    echo '{"error":"Neither MNEMO_DB_HOST (direct) nor MNEMO_API_URL (server) is set"}' >&2
    return 1
  fi
  if [[ "$mode" == "direct" ]]; then
    if [[ -z "${MNEMO_DB_USER:-}" || -z "${MNEMO_DB_PASS:-}" ]]; then
      echo '{"error":"Direct mode requires MNEMO_DB_HOST, MNEMO_DB_USER, MNEMO_DB_PASS"}' >&2
      return 1
    fi
  fi
  if [[ "$mode" == "server" ]]; then
    if [[ -z "${MNEMO_API_TOKEN:-}" ]]; then
      echo '{"error":"Server mode requires MNEMO_API_URL and MNEMO_API_TOKEN"}' >&2
      return 1
    fi
  fi
}

# ─── Server mode helpers ────────────────────────────────────────────

# mnemo_server_get <path> — GET request to mnemo-server.
mnemo_server_get() {
  local path="$1"
  curl -sf --max-time 8 \
    -H "Authorization: Bearer ${MNEMO_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "${MNEMO_API_URL}${path}"
}

# mnemo_server_post <path> <json_body> — POST request to mnemo-server.
mnemo_server_post() {
  local path="$1"
  local body="$2"
  curl -sf --max-time 8 \
    -H "Authorization: Bearer ${MNEMO_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${body}" \
    "${MNEMO_API_URL}${path}"
}

# ─── Direct mode helpers ────────────────────────────────────────────

# mnemo_sql <sql> [params_json] — Execute SQL against TiDB HTTP Data API.
# params_json is an optional JSON array of parameter values.
mnemo_sql() {
  local sql="$1"
  local params="${2:-null}"
  local db="${MNEMO_DB_NAME:-mnemos}"
  local url="https://http-${MNEMO_DB_HOST}/v1beta/sql"

  local body
  if [[ "$params" == "null" ]]; then
    body=$(python3 -c "
import json, os
print(json.dumps({'database': os.environ['MNEMO_DB'], 'query': os.environ['MNEMO_Q']}))
" 2>/dev/null) || return 1
  else
    body=$(MNEMO_PARAMS="$params" python3 -c "
import json, os
print(json.dumps({
    'database': os.environ['MNEMO_DB'],
    'query': os.environ['MNEMO_Q'],
    'params': json.loads(os.environ['MNEMO_PARAMS'])
}))
" 2>/dev/null) || return 1
  fi

  MNEMO_DB="$db" MNEMO_Q="$sql" curl -sf --max-time 10 \
    -u "${MNEMO_DB_USER}:${MNEMO_DB_PASS}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "$url"
}

# mnemo_direct_init — Auto-create table if not exists (direct mode).
mnemo_direct_init() {
  local dims="${MNEMO_EMBED_DIMS:-1536}"
  mnemo_sql "CREATE TABLE IF NOT EXISTS memories (
    id          VARCHAR(36)       PRIMARY KEY,
    space_id    VARCHAR(36)       NOT NULL,
    content     TEXT              NOT NULL,
    key_name    VARCHAR(255),
    source      VARCHAR(100),
    tags        JSON,
    metadata    JSON,
    embedding   VECTOR(${dims})   NULL,
    version     INT               DEFAULT 1,
    updated_by  VARCHAR(100),
    created_at  TIMESTAMP         DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP         DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_key    (space_id, key_name),
    INDEX idx_space         (space_id),
    INDEX idx_source        (space_id, source),
    INDEX idx_updated       (space_id, updated_at)
  )" >/dev/null 2>&1 || true
}

# ─── Mode-agnostic helpers ──────────────────────────────────────────

# mnemo_get_memories [limit] — Fetch recent memories (works in both modes).
mnemo_get_memories() {
  local limit="${1:-20}"
  local mode
  mode=$(mnemo_mode)

  if [[ "$mode" == "server" ]]; then
    mnemo_server_get "/api/memories?limit=${limit}"
  elif [[ "$mode" == "direct" ]]; then
    mnemo_direct_init
    local result
    result=$(mnemo_sql "SELECT id, content, key_name, source, tags, version, updated_by, created_at, updated_at FROM memories WHERE space_id = '${MNEMO_SPACE_ID}' ORDER BY updated_at DESC LIMIT ${limit}" 2>/dev/null || echo "")
    if [[ -z "$result" ]]; then
      echo '{"memories":[],"total":0}'
      return
    fi
    # Transform TiDB HTTP API response into our standard format.
    echo "$result" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    rows = data.get('rows', [])
    cols = [c['name'] for c in data.get('columns', [])]
    memories = []
    for row in rows:
        m = dict(zip(cols, row))
        if m.get('tags') and isinstance(m['tags'], str):
            try: m['tags'] = json.loads(m['tags'])
            except: m['tags'] = []
        if m.get('key_name'):
            m['key'] = m.pop('key_name')
        else:
            m.pop('key_name', None)
        memories.append(m)
    print(json.dumps({'memories': memories, 'total': len(memories)}))
except Exception:
    print(json.dumps({'memories': [], 'total': 0}))
" 2>/dev/null
  fi
}

# mnemo_post_memory <json_body> — Store a memory (works in both modes).
mnemo_post_memory() {
  local body="$1"
  local mode
  mode=$(mnemo_mode)

  if [[ "$mode" == "server" ]]; then
    mnemo_server_post "/api/memories" "$body"
  elif [[ "$mode" == "direct" ]]; then
    mnemo_direct_init
    # Parse the body and insert directly.
    MNEMO_BODY="$body" python3 -c "
import json, os, uuid, sys

body = json.loads(os.environ['MNEMO_BODY'])
mid = str(uuid.uuid4())
content = body.get('content', '')
key = body.get('key', None)
source = body.get('source', None)
tags = json.dumps(body.get('tags', []))
metadata = json.dumps(body.get('metadata')) if body.get('metadata') else None

# Build INSERT SQL
sql = 'INSERT INTO memories (id, space_id, content, key_name, source, tags, metadata, version, updated_by) VALUES (%s, %s, %s, %s, %s, %s, %s, 1, %s)'
params = [mid, '${MNEMO_SPACE_ID}', content, key, source, tags, metadata, source]

print(json.dumps({'query': sql, 'params': params, 'id': mid}))
" 2>/dev/null | {
      read -r insert_info
      local sql params mid
      sql=$(echo "$insert_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['query'])")
      params=$(echo "$insert_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['params']))")
      mid=$(echo "$insert_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id'])")
      mnemo_sql "$sql" "$params" >/dev/null 2>&1
      echo "{\"id\":\"${mid}\"}"
    }
  fi
}

# mnemo_search <query> [limit] — Search memories (works in both modes).
mnemo_search() {
  local query="$1"
  local limit="${2:-10}"
  local mode
  mode=$(mnemo_mode)

  if [[ "$mode" == "server" ]]; then
    # URL-encode the query
    local encoded_q
    encoded_q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$query'))" 2>/dev/null || echo "$query")
    mnemo_server_get "/api/memories?q=${encoded_q}&limit=${limit}"
  elif [[ "$mode" == "direct" ]]; then
    mnemo_direct_init
    local result
    result=$(mnemo_sql "SELECT id, content, key_name, source, tags, version, updated_by, created_at, updated_at FROM memories WHERE space_id = '${MNEMO_SPACE_ID}' AND content LIKE CONCAT('%', '${query}', '%') ORDER BY updated_at DESC LIMIT ${limit}" 2>/dev/null || echo "")
    if [[ -z "$result" ]]; then
      echo '{"memories":[],"total":0}'
      return
    fi
    echo "$result" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    rows = data.get('rows', [])
    cols = [c['name'] for c in data.get('columns', [])]
    memories = []
    for row in rows:
        m = dict(zip(cols, row))
        if m.get('tags') and isinstance(m['tags'], str):
            try: m['tags'] = json.loads(m['tags'])
            except: m['tags'] = []
        if m.get('key_name'):
            m['key'] = m.pop('key_name')
        else:
            m.pop('key_name', None)
        memories.append(m)
    print(json.dumps({'memories': memories, 'total': len(memories)}))
except Exception:
    print(json.dumps({'memories': [], 'total': 0}))
" 2>/dev/null
  fi
}

# read_stdin — Read stdin (hook input JSON) into $HOOK_INPUT.
read_stdin() {
  HOOK_INPUT="$(cat)"
}
