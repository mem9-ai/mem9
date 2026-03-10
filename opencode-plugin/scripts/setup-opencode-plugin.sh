#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_ENTRY="$PLUGIN_DIR/plugin.js"
CONFIG_DIR="${HOME}/.config/opencode/plugins"
PLUGIN_LINK="$CONFIG_DIR/mnemo.js"

if [ ! -f "$PLUGIN_ENTRY" ]; then
	echo "mnemo OpenCode plugin entry not found: $PLUGIN_ENTRY" >&2
	exit 1
fi

mkdir -p "$CONFIG_DIR"

if [ ! -d "$PLUGIN_DIR/node_modules/@opencode-ai/plugin" ]; then
	npm install --prefix "$PLUGIN_DIR"
fi

if [ -L "$PLUGIN_LINK" ]; then
	CURRENT_TARGET="$(readlink "$PLUGIN_LINK")"
	if [ "$CURRENT_TARGET" = "$PLUGIN_ENTRY" ]; then
		echo "mnemo OpenCode plugin already linked at $PLUGIN_LINK"
		exit 0
	fi
	rm "$PLUGIN_LINK"
elif [ -e "$PLUGIN_LINK" ]; then
	BACKUP_PATH="$PLUGIN_LINK.bak"
	rm -f "$BACKUP_PATH"
	mv "$PLUGIN_LINK" "$BACKUP_PATH"
	echo "migrated existing plugin loader to $BACKUP_PATH"
fi

ln -s "$PLUGIN_ENTRY" "$PLUGIN_LINK"

echo "linked mnemo OpenCode plugin"
echo "  $PLUGIN_LINK -> $PLUGIN_ENTRY"
echo "next: export MNEMO_API_URL and MNEMO_TENANT_ID, then restart OpenCode"
