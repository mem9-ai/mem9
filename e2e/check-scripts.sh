#!/bin/bash
# Offline guardrails for live e2e scripts. This must not call mnemo-server.
set -euo pipefail
shopt -s nullglob

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

say() {
  printf '==> %s\n' "$*"
}

check_shell_scripts() {
  local script
  local scripts=(e2e/*.sh)

  if [ "${#scripts[@]}" -eq 0 ]; then
    printf 'No shell scripts found under e2e/.\n' >&2
    return 1
  fi

  say "Checking shell syntax"
  for script in "${scripts[@]}"; do
    printf '  bash -n %s\n' "$script"
    bash -n "$script"
  done

  say "Checking shell strict mode"
  for script in "${scripts[@]}"; do
    if ! grep -q '^set -euo pipefail$' "$script"; then
      printf '%s must include: set -euo pipefail\n' "$script" >&2
      return 1
    fi
  done
}

check_python_scripts() {
  local scripts=(e2e/*.py)

  if [ "${#scripts[@]}" -eq 0 ]; then
    printf 'No Python scripts found under e2e/.\n' >&2
    return 1
  fi

  say "Checking Python syntax"
  python3 - "${scripts[@]}" <<'PY'
import pathlib
import sys

for filename in sys.argv[1:]:
    path = pathlib.Path(filename)
    compile(path.read_text(encoding="utf-8"), filename, "exec")
    print(f"  compile {filename}")
PY
}

check_wrappers() {
  say "Checking API version wrappers"

  if ! grep -Fq 'MNEMO_API_VERSION=v1alpha2 bash "$SCRIPT_DIR/api-smoke-test.sh" "$@"' \
    e2e/api-smoke-test-v1alpha2.sh; then
    printf 'e2e/api-smoke-test-v1alpha2.sh must wrap api-smoke-test.sh with MNEMO_API_VERSION=v1alpha2.\n' >&2
    return 1
  fi

  if ! grep -Fq 'MNEMO_API_VERSION=v1alpha2 bash "$SCRIPT_DIR/api-smoke-test-round2.sh" "$@"' \
    e2e/api-smoke-test-round2-v1alpha2.sh; then
    printf 'e2e/api-smoke-test-round2-v1alpha2.sh must wrap api-smoke-test-round2.sh with MNEMO_API_VERSION=v1alpha2.\n' >&2
    return 1
  fi
}

check_shell_scripts
check_python_scripts
check_wrappers

say "All e2e script checks passed"
