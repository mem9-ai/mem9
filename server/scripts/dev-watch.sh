#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SERVER_DIR/.." && pwd)"
BIN="${MNEMO_DEV_BIN:-$SERVER_DIR/bin/mnemo-server}"
BUILD_TARGET="${MNEMO_DEV_BUILD_TARGET:-build}"
WATCH_INTERVAL="${MNEMO_DEV_WATCH_INTERVAL:-1}"

server_pid=""

fingerprint() {
  (
    cd "$SERVER_DIR"
    find . \
      \( -path './bin' -o -path './coverage' -o -path './.tmp' -o -path './uploads' \) -prune -o \
      \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' -o -name 'schema*.sql' \) -type f -print |
      LC_ALL=C sort |
      while IFS= read -r file; do
        cksum "$file"
      done
  )
}

server_running() {
  [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null
}

stop_server() {
  if ! server_running; then
    server_pid=""
    return
  fi
  echo "[dev] stopping mnemo-server pid=$server_pid"
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  server_pid=""
}

build_server() {
  echo "[dev] building via make $BUILD_TARGET"
  make -C "$REPO_ROOT" "$BUILD_TARGET"
}

start_server() {
  echo "[dev] starting $BIN"
  (
    cd "$SERVER_DIR"
    "$BIN"
  ) &
  server_pid="$!"
  echo "[dev] mnemo-server pid=$server_pid"
}

restart_server() {
  if ! build_server; then
    echo "[dev] build failed; keeping current server process"
    return
  fi
  stop_server
  start_server
}

cleanup() {
  stop_server
}

trap cleanup EXIT
trap 'cleanup; exit 0' INT TERM

echo "[dev] watching server source for changes"
echo "[dev] set MNEMO_DEV_WATCH_INTERVAL to change the ${WATCH_INTERVAL}s poll interval"

last_fingerprint="$(fingerprint)"
restart_server

while true; do
  sleep "$WATCH_INTERVAL"

  if [[ -n "$server_pid" ]] && ! server_running; then
    wait "$server_pid" 2>/dev/null || true
    echo "[dev] mnemo-server exited; waiting for source changes before restarting"
    server_pid=""
  fi

  next_fingerprint="$(fingerprint)"
  if [[ "$next_fingerprint" != "$last_fingerprint" ]]; then
    echo "[dev] change detected"
    last_fingerprint="$next_fingerprint"
    restart_server
  fi
done
