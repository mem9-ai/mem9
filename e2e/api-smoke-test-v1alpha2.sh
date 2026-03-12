#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MNEMO_API_VERSION=v1alpha2 bash "$SCRIPT_DIR/api-smoke-test.sh" "$@"
