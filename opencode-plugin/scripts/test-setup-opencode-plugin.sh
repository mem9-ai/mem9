#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT_DIR/opencode-plugin/scripts/setup-opencode-plugin.sh"
TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT

export HOME="$TMP_HOME"

if [ ! -f "$SCRIPT" ]; then
	echo "missing script: $SCRIPT" >&2
	exit 1
fi

mkdir -p "$HOME/.config/opencode/plugins"
printf 'legacy local plugin\n' >"$HOME/.config/opencode/plugins/mnemo.js"

bash "$SCRIPT"

PLUGIN_LINK="$HOME/.config/opencode/plugins/mnemo.js"

if [ ! -L "$PLUGIN_LINK" ]; then
	echo "expected symlink at $PLUGIN_LINK" >&2
	exit 1
fi

TARGET="$(readlink "$PLUGIN_LINK")"
EXPECTED="$ROOT_DIR/opencode-plugin/plugin.js"

if [ "$TARGET" != "$EXPECTED" ]; then
	echo "unexpected symlink target: $TARGET" >&2
	echo "expected: $EXPECTED" >&2
	exit 1
fi

if [ ! -f "$HOME/.config/opencode/plugins/mnemo.js.bak" ]; then
	echo "expected backup file for migrated plugin loader" >&2
	exit 1
fi

if [ ! -d "$ROOT_DIR/opencode-plugin/node_modules/@opencode-ai/plugin" ]; then
	echo "expected @opencode-ai/plugin to be installed" >&2
	exit 1
fi

echo "ok"
