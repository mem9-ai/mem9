#!/bin/bash
# Local TiDB smoke for CI/dev. Boots a local TiDB playground, seeds a manual
# tenant, starts mnemo-server on the real tidb backend path, and reuses the
# shared assertions from local-smoke-checks.sh.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TIDB_VERSION="${TIDB_VERSION:-v8.5.1}"
TIDB_HOST="${TIDB_HOST:-127.0.0.1}"
TIDB_PORT="${TIDB_PORT:-4000}"
TIDB_PD_PORT="${TIDB_PD_PORT:-2379}"
TIDB_TAG="${TIDB_TAG:-mem9-local-tidb-smoke}"
MNEMO_DB_NAME="${MNEMO_DB_NAME:-mnemo}"
MNEMO_BASE="${MNEMO_BASE:-http://127.0.0.1:18082}"
MNEMO_PORT="${MNEMO_PORT:-18082}"
MNEMO_SMOKE_TENANT_ID="${MNEMO_SMOKE_TENANT_ID:-ci-local-tidb-smoke}"
SMOKE_LOG_DIR="${SMOKE_LOG_DIR:-/tmp/mem9-local-tidb-smoke}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"
MYSQL_ADMIN_BIN="${MYSQL_ADMIN_BIN:-mysqladmin}"
MYSQL_ARGS=(-h "${TIDB_HOST}" -P "${TIDB_PORT}" -u root)
MYSQL_DSN="root@tcp(${TIDB_HOST}:${TIDB_PORT})/${MNEMO_DB_NAME}?parseTime=true"

export MNEMO_BASE
export MNEMO_PORT
export MNEMO_SMOKE_TENANT_ID
export NO_PROXY='*'
export no_proxy='*'
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy

mkdir -p "${SMOKE_LOG_DIR}"

cleanup() {
  if [ -f "${SMOKE_LOG_DIR}/mnemo-server.pid" ]; then
    kill "$(cat "${SMOKE_LOG_DIR}/mnemo-server.pid")" >/dev/null 2>&1 || true
  fi

  if tiup playground display -T "${TIDB_TAG}" >/dev/null 2>&1; then
    tiup playground display -T "${TIDB_TAG}" \
      | awk 'NR > 2 && $1 ~ /^[0-9]+$/ {print $1}' \
      | xargs -r kill >/dev/null 2>&1 || true
  fi

  rm -rf "${HOME}/.tiup/data/${TIDB_TAG}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "========================================================"
echo "  Mem9 local TiDB smoke"
echo "  TiDB      : ${TIDB_VERSION} @ ${TIDB_HOST}:${TIDB_PORT}"
echo "  Base URL  : ${MNEMO_BASE}"
echo "  Tenant    : ${MNEMO_SMOKE_TENANT_ID}"
echo "  Log dir   : ${SMOKE_LOG_DIR}"
echo "========================================================"

command -v tiup >/dev/null 2>&1 || {
  echo "tiup not found in PATH" >&2
  exit 1
}
command -v "${MYSQL_BIN}" >/dev/null 2>&1 || {
  echo "mysql client not found in PATH" >&2
  exit 1
}
command -v "${MYSQL_ADMIN_BIN}" >/dev/null 2>&1 || {
  echo "mysqladmin client not found in PATH" >&2
  exit 1
}

echo
echo "[1] Start local TiDB playground"
tiup playground "${TIDB_VERSION}" \
  --host "${TIDB_HOST}" \
  --db 1 \
  --pd 1 \
  --kv 1 \
  --tiflash 0 \
  --db.timeout 180 \
  --without-monitor \
  -T "${TIDB_TAG}" \
  > "${SMOKE_LOG_DIR}/tiup-playground.log" 2>&1 &
echo "$!" > "${SMOKE_LOG_DIR}/tiup.pid"

echo
echo "[2] Wait for TiDB SQL endpoint"
for _ in $(seq 1 180); do
  if "${MYSQL_ADMIN_BIN}" "${MYSQL_ARGS[@]}" ping --silent >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

"${MYSQL_ADMIN_BIN}" "${MYSQL_ARGS[@]}" ping --silent >/dev/null 2>&1 || {
  echo "TiDB did not become ready in time" >&2
  cat "${SMOKE_LOG_DIR}/tiup-playground.log" >&2
  exit 1
}

echo
echo "[3] Initialize control-plane and tenant schema"
"${MYSQL_BIN}" "${MYSQL_ARGS[@]}" -e "CREATE DATABASE IF NOT EXISTS \`${MNEMO_DB_NAME}\`;"
"${MYSQL_BIN}" "${MYSQL_ARGS[@]}" "${MNEMO_DB_NAME}" < "${ROOT_DIR}/server/schema.sql"
"${MYSQL_BIN}" "${MYSQL_ARGS[@]}" "${MNEMO_DB_NAME}" <<SQL
INSERT INTO tenants (
  id, name, db_host, db_port, db_user, db_password, db_name, db_tls,
  provider, cluster_id, status, schema_version, created_at, updated_at
) VALUES (
  '${MNEMO_SMOKE_TENANT_ID}', '${MNEMO_SMOKE_TENANT_ID}', '${TIDB_HOST}', ${TIDB_PORT}, 'root',
  '', '${MNEMO_DB_NAME}', 0, 'ci_local_tidb', '${MNEMO_SMOKE_TENANT_ID}',
  'active', 1, NOW(), NOW()
)
ON DUPLICATE KEY UPDATE
  status = 'active',
  updated_at = NOW();
SQL

echo
echo "[4] Start mnemo-server on tidb backend"
(
  cd "${ROOT_DIR}"
  MNEMO_DB_BACKEND=tidb \
  MNEMO_DSN="${MYSQL_DSN}" \
  MNEMO_TIDB_ZERO_ENABLED=false \
  MNEMO_INGEST_MODE=raw \
  MNEMO_PORT="${MNEMO_PORT}" \
  MNEMO_UPLOAD_DIR="${SMOKE_LOG_DIR}/uploads" \
  ./server/bin/mnemo-server > "${SMOKE_LOG_DIR}/mnemo-server.log" 2>&1 &
  echo "$!" > "${SMOKE_LOG_DIR}/mnemo-server.pid"
)

echo
echo "[5] Wait for mnemo-server"
for _ in $(seq 1 60); do
  if curl -fsS "${MNEMO_BASE}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "${MNEMO_BASE}/healthz" >/dev/null 2>&1 || {
  echo "mnemo-server did not become healthy in time" >&2
  cat "${SMOKE_LOG_DIR}/mnemo-server.log" >&2
  exit 1
}

echo
echo "[6] Run local API contract checks on tidb backend"
bash "${ROOT_DIR}/e2e/local-smoke-checks.sh" | tee "${SMOKE_LOG_DIR}/local-tidb-smoke.log"
