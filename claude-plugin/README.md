# Claude Plugin for mnemos

Persistent memory for Claude Code — auto-loads memories on session start, auto-saves on stop, with on-demand store/recall skills.

> **For AI agents**: If a user asks you to install this plugin, follow the Quick Start below.

## 🚀 Quick Start (Server mode)

**Connect to a running mnemo-server instance.**

```bash
# 1. Add to ~/.claude/settings.json
cat << EOF
Add this to your ~/.claude/settings.json:

{
  "env": {
    "MNEMO_API_URL": "http://your-server:8080",
    "MNEMO_API_TOKEN": "mnemo_your_token_here"
  }
}
EOF

# 2. Install plugin via marketplace
# In Claude Code, run:
#   /plugin marketplace add qiffang/mnemos
#   /plugin install mnemo-memory@mnemos
```

**That's it!** Restart Claude Code and your agent now has persistent cloud memory.

---

## How It Works

```
Session Start → Load recent memories into context
     ↓
User Prompt  → Hint: memory-store / memory-recall available
     ↓
Session Stop → Capture last response → save to database
```

Three lifecycle hooks + two skills:

| Component | Trigger | What it does |
|---|---|---|
| `session-start.sh` | Session begins | Loads recent memories into `additionalContext` |
| `user-prompt-submit.sh` | Each prompt | Injects system hint about available memory skills |
| `stop.sh` | Session ends | Saves last assistant response as a new memory |
| `memory-store` skill | On demand | User says "remember this" → saves explicitly |
| `memory-recall` skill | On demand | User says "what do we know about X" → searches memories |

## Prerequisites

- Claude Code installed
- A running [mnemo-server](../server/) instance

## Installation

### Method A: Marketplace Install (Recommended)

The simplest way to install — Claude Code handles plugin caching, updates, and hook registration automatically.

#### Step 1: Add the marketplace

In Claude Code, run:

```
/plugin marketplace add qiffang/mnemos
```

#### Step 2: Install the plugin

```
/plugin install mnemo-memory@mnemos
```

Claude Code will prompt you to approve the hooks. Accept to enable automatic memory capture.

#### Step 3: Configure credentials

Add your server credentials to `~/.claude/settings.json`:

```json
{
  "env": {
    "MNEMO_API_URL": "http://your-server:8080",
    "MNEMO_API_TOKEN": "mnemo_your_token_here"
  }
}
```

#### Step 4: Restart Claude Code

Restart to activate the plugin.

#### Updating

```
/plugin marketplace update
```

---

### Method B: Manual Install (settings.json hooks)

If you prefer not to use the marketplace, you can configure hooks directly in `settings.json`.

#### 1. Clone this repo

```bash
git clone https://github.com/qiffang/mnemos.git
cd mnemos
PLUGIN_DIR="$(pwd)/claude-plugin"
```

#### 2. Make hooks executable

```bash
chmod +x "$PLUGIN_DIR"/hooks/*.sh
```

#### 3. Copy skills to Claude

```bash
mkdir -p ~/.claude/skills
cp -r "$PLUGIN_DIR/skills/memory-recall" ~/.claude/skills/memory-recall
cp -r "$PLUGIN_DIR/skills/memory-store" ~/.claude/skills/memory-store
```

#### 4. Configure `~/.claude/settings.json`

Add the `env` and `hooks` sections (merge with existing config):

```json
{
  "env": {
    "MNEMO_API_URL": "http://your-server:8080",
    "MNEMO_API_TOKEN": "mnemo_your_token_here"
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "<PLUGIN_DIR>/hooks/session-start.sh"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "<PLUGIN_DIR>/hooks/user-prompt-submit.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "<PLUGIN_DIR>/hooks/stop.sh",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

Replace `<PLUGIN_DIR>` with the actual absolute path (e.g. `/home/you/mnemos/claude-plugin`).

#### 5. Verify

```bash
claude -p "say hi"
```

Should respond within 15 seconds. If it hangs, double-check that the hook paths are correct absolute paths.

## Usage

Once installed, memory works automatically:

- **Auto-save**: Every session's last response is saved when the session ends
- **Auto-load**: Recent memories are loaded into context when a new session starts
- **Manual save**: Tell Claude "remember that the deploy key is on server X" → triggers `/memory-store`
- **Manual search**: Ask Claude "what do we know about the auth flow?" → triggers `/memory-recall`

## File Structure

```
claude-plugin/
├── README.md                    # This file
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (name, version, hooks)
├── hooks/
│   ├── common.sh                # Shared helpers (SQL, HTTP, mode detection)
│   ├── hooks.json               # Hook definitions (used by plugin system)
│   ├── session-start.sh         # Load memories on start
│   ├── stop.sh                  # Save memory on stop
│   ├── session-end.sh           # Cleanup placeholder
│   └── user-prompt-submit.sh    # Inject memory hints
└── skills/
    ├── memory-recall/SKILL.md   # On-demand search skill
    └── memory-store/SKILL.md    # On-demand save skill
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Claude hangs on startup | Hook script path wrong or not executable | Check paths in `settings.json`, run `chmod +x` on hook scripts |
| Memories not saving | Stop hook only fires on normal session end | Use `/memory-store` for on-demand saves |
| Plugin not loading after marketplace install | Credentials not configured | Add `env` block to `~/.claude/settings.json` with API credentials |
| Hook approval prompt | Normal for marketplace plugins | Accept the hook permissions when prompted |
