# Claude Plugin for Mem9

Persistent cloud memory for Claude Code — auto-loads memories on session start, auto-saves on stop, with on-demand store/recall skills.

> **For AI agents**: If a user asks you to install this plugin, follow the Quick Start below.

## Quick Start

### Option 1: CoWork Install (one command)

```bash
cowork install mem9-ai/mem9-claude-plugin --plugin
```

Then add your tenant ID to `~/.claude/settings.json`:

```json
{
  "env": {
    "MEM9_TENANT_ID": "your-tenant-uuid"
  }
}
```

Restart Claude Code. Done.

### Option 2: Marketplace Install

```
/plugin marketplace add mem9-ai/mem9
/plugin install mem9@mem9
```

Then add `MEM9_TENANT_ID` to `~/.claude/settings.json` as above, and restart.

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
- A `MEM9_TENANT_ID` (provision one at `https://api.mem9.ai`)
- [CoWork CLI](https://github.com/ZhangHanDong/cowork-skills) (for CoWork install method)

## Installation

### Method A: CoWork Install (Recommended)

One command installs the full plugin — hooks, skills, and registration:

```bash
cowork install mem9-ai/mem9-claude-plugin --plugin
```

This will:
1. Clone the plugin repo
2. Copy it to `~/.claude/mem9-claude-plugin/`
3. Register it in Claude Code's plugin system
4. Enable it in `settings.json`

Then configure your tenant ID:

```json
// ~/.claude/settings.json
{
  "env": {
    "MEM9_TENANT_ID": "your-tenant-uuid"
  }
}
```

Restart Claude Code to activate.

**Update:**
```bash
cowork install mem9-ai/mem9-claude-plugin --plugin --update
```

**Uninstall:**
```bash
cowork install --uninstall mem9-claude-plugin
```

---

### Method B: Marketplace Install

Claude Code's built-in plugin marketplace.

#### Step 1: Add the marketplace

In Claude Code, run:

```
/plugin marketplace add mem9-ai/mem9
```

#### Step 2: Install the plugin

```
/plugin install mem9@mem9
```

Claude Code will prompt you to approve the hooks. Accept to enable automatic memory capture.

#### Step 3: Configure tenant ID

Add your tenant ID to `~/.claude/settings.json`:

```json
{
  "env": {
    "MEM9_TENANT_ID": "your-tenant-uuid"
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

### Method C: Manual Install (settings.json hooks)

If you prefer not to use the marketplace or CoWork, you can configure hooks directly in `settings.json`.

#### 1. Clone this repo

```bash
git clone https://github.com/mem9-ai/mem9.git
cd mem9
PLUGIN_DIR="$(pwd)/claude-plugin"
```

#### 2. Make hooks executable

```bash
chmod +x "$PLUGIN_DIR"/hooks/*.sh
```

#### 3. Copy skills to Claude

```bash
mkdir -p ~/.claude/skills
cp -r "$PLUGIN_DIR/skills/mem9-recall" ~/.claude/skills/mem9-recall
cp -r "$PLUGIN_DIR/skills/mem9-store" ~/.claude/skills/mem9-store
```

#### 4. Configure `~/.claude/settings.json`

Add the `env` and `hooks` sections (merge with existing config):

```json
{
  "env": {
    "MEM9_TENANT_ID": "your-tenant-uuid"
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

Replace `<PLUGIN_DIR>` with the actual absolute path (e.g. `/home/you/mem9/claude-plugin`).

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
│   ├── common.sh                # Shared helpers (HTTP requests, env check)
│   ├── hooks.json               # Hook definitions (used by plugin system)
│   ├── session-start.sh         # Load memories on start
│   ├── stop.sh                  # Save memory on stop
│   ├── session-end.sh           # Cleanup placeholder
│   └── user-prompt-submit.sh    # Inject memory hints
└── skills/
    ├── mem9-recall/SKILL.md     # On-demand search skill
    ├── mem9-store/SKILL.md      # On-demand save skill
    └── mem9-setup/SKILL.md      # Automated installer skill
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Claude hangs on startup | Hook script path wrong or not executable | Check paths in `settings.json`, run `chmod +x` on hook scripts |
| Memories not saving | Stop hook only fires on normal session end | Use `/memory-store` for on-demand saves |
| Plugin not loading after marketplace install | Tenant ID not configured | Add `env` block to `~/.claude/settings.json` with `MEM9_TENANT_ID` |
| Hook approval prompt | Normal for marketplace plugins | Accept the hook permissions when prompted |
