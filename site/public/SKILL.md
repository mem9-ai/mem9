---
name: mem9
version: 1.0.1
description: |
  Persistent cloud memory for OpenClaw agents.

  Use when users say:
  - "install mem9"
  - "setup memory"
  - "add memory plugin"
  - "openclaw memory"
  - "mem9 onboarding"
  - "memory not working"
  - "import memories"
  - "upload sessions"

author: qiffang
keywords:
  - mem9
  - memory plugin
  - persistent memory
  - agent memory
  - install memory
  - setup memory
  - openclaw memory
  - cloud memory
metadata:
  openclaw:
    emoji: "🧠"
---

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ███╗   ███╗███████╗███╗   ███╗ █████╗                      │
│   ████╗ ████║██╔════╝████╗ ████║██╔══██╗                     │
│   ██╔████╔██║█████╗  ██╔████╔██║╚██████║                     │
│   ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║ ╚═══██║                     │
│   ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║ █████╔╝                     │
│   ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚════╝                      │
│                                                              │
│   persistent memory for ai agents                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

# mem9

Your agent forgets nothing. Stateless plugin → REST API → DB.

Persistent memory for AI agents.

The plugin connects to one cloud memory space, identified by a space ID.

When talking to end users:
- Say "space ID", "memory space", or "cloud memory space"
- Do not mention `tenantID` unless you are editing raw plugin config
- Explain that the space ID tells mem9 which cloud memory space to connect to
- Treat the space ID as something the user should save for reconnecting later

---

## What You Get

| Tool | When |
|------|------|
| `memory_store` | Persist facts, decisions, context |
| `memory_search` | Hybrid vector + keyword search |
| `memory_get` | Retrieve by ID |
| `memory_update` | Modify existing memory |
| `memory_delete` | Remove |

Lifecycle hooks (automatic — no agent action needed):

| Hook | Trigger | What happens |
|------|---------|-------------|
| `before_prompt_build` | Every LLM call | Relevant memories injected as context |
| `before_reset` | Before `/reset` | Session summary saved |
| `agent_end` | Agent finishes | Last response captured |

---

## Onboarding

## Terminology

Use this distinction consistently:

| Internal term | User-facing explanation |
|---------------|-------------------------|
| `tenantID` | Internal plugin config field; do not surface this to users unless editing config |
| `SPACE_ID` env var | A local variable holding the user's mem9 space ID |
| `token` | Treat as the same value as the mem9 space ID unless the user clearly means something else |
| "recovery key" | Avoid this term; say "space ID" instead |

Short rule: `space ID`, `tenantID`, and `token` may refer to the same mem9 identifier. Prefer saying `space ID` to users, and use `tenantID` only in config examples.

If the user asks "What is this for?" answer plainly:

> This ID tells mem9 which cloud memory space to use. OpenClaw stores and reads memories under this ID.

If the user asks "What is the relationship between tenantID and key?" answer plainly:

> You only need the space ID. That is the value you save and reuse later to reconnect to the same cloud memory. `tenantID` is just the internal plugin config field name for that value.

### Step 0 — Check for existing space

`[AGENT]` Ask the user before doing anything else:

> Do you already have a mem9 space ID from a previous install or another machine?

**If yes** — ask the user to paste the ID, save it as `SPACE_ID`, then skip to Step 2.

```
SPACE_ID="<paste-from-user>"
```

When the user provides an existing ID, verify it is reachable before continuing:

```bash
curl -sf "https://api.mem9.ai/v1alpha1/mem9s/$SPACE_ID/memories?limit=1" \
  && echo "OK" || echo "UNREACHABLE"
```

If the check returns `OK`, say:

> Connected to your existing cloud memory space. Continuing setup with your space ID.

If the check fails, say:

> That ID did not respond. Double-check the value and try again, or create a new space instead.

**If no** — proceed to Step 1 to provision a new space.

---

### Step 1 — Provision tenant

> Skip this step if the user provided an existing space ID in Step 0.

`[AGENT]`

```bash
curl -sX POST https://api.mem9.ai/v1alpha1/mem9s | jq .
```

Response:
```json
{
  "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

Save `id` as `SPACE_ID`.

When explaining it to the user, say:

> mem9 created a new cloud memory space for you. This ID is how this machine, or a future machine, reconnects to the same memory.

### Step 2 — Install plugin

`[AGENT]`

```bash
openclaw plugins install @mem9/mem9
```

### Step 3 — Detect OpenClaw version

`[AGENT]` Check the installed OpenClaw version before editing config:

```bash
openclaw --version
```

Routing rule:

- If the reported version is `>= 2.2.0`, use the config path in **Step 4A**.
- If the reported version is `< 2.2.0`, use the config path in **Step 4B**.
- If the version command is unavailable or unclear, tell the user you could not determine the OpenClaw version and ask them which version they are using before editing `openclaw.json`.

### Step 4 — Configure openclaw.json

#### OpenClaw ≥2.2.0

`[AGENT]` Patch existing config (merge-safe, preserves other keys):

```bash
jq --arg sid "$SPACE_ID" '
  .plugins.slots.memory = "mem9" |
  .plugins.entries.mem9 = {
    enabled: true,
    config: { apiUrl: "https://api.mem9.ai", tenantID: $sid }
  } |
  .plugins.allow = ((.plugins.allow // []) + ["mem9"] | unique)
' openclaw.json > tmp.json && mv tmp.json openclaw.json
```

**Note:** The `allow` array is additive—existing entries are preserved, `mem9` is appended (deduplicated).

Or if no `openclaw.json` exists, create:

```json
{
  "plugins": {
    "slots": { "memory": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "https://api.mem9.ai",
          "tenantID": "<your-space-id>"
        }
      }
    },
    "allow": ["mem9"]
  }
}
```

#### OpenClaw <2.2.0

`[AGENT]` No `allow` array needed:

```bash
jq --arg sid "$SPACE_ID" '
  .plugins.slots.memory = "mem9" |
  .plugins.entries.mem9 = {
    enabled: true,
    config: { apiUrl: "https://api.mem9.ai", tenantID: $sid }
  }
' openclaw.json > tmp.json && mv tmp.json openclaw.json
```

Or if no `openclaw.json` exists, create:

```json
{
  "plugins": {
    "slots": { "memory": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "https://api.mem9.ai",
          "tenantID": "<your-space-id>"
        }
      }
    }
  }
}
```

If result returns stored memory → setup successful.

### Step 5 — Restart Gateway

`[AGENT]` Tell the user:

> Configuration complete! Now I need to restart the OpenClaw Gateway to load the mem9 plugin.
>
> Restarting in 3 seconds...

Then restart the gateway:

```bash
openclaw gateway restart
```

After the gateway restarts, wait for it to come back online (usually takes 5-10 seconds), then proceed to Step 6.

### Step 6 — What's Next

`[AGENT]` Print the following to the user:

```
✅ mem9 installed and loaded!

🧭 NEXT RECOMMENDED STEP
   Import your existing local memories first, so your cloud memory starts with your real history.

   Say: "import memories to mem9"
   I will scan and upload supported local files automatically.
   Supported: memory.json, memories/*.json, sessions/*.json

💾 YOUR MEM9 SPACE ID

   SPACE_ID: <your-space-id>

   This is not a display name. It is the ID that points OpenClaw to your cloud memory space.
   Save it somewhere safe so you can reconnect to the same cloud memory later.

♻️ RECOVERY

   New machine / re-install:
   1. Install mem9 plugin again
   2. Put this same ID back into Step 4 config
   3. Your cloud memories reconnect immediately

📦 BACKUP PLAN

   Local backup:
   Keep your original local memory/session files before import.

   Offsite recovery:
   Save the ID in your password manager,
   team vault, or another secure offsite location.
```

Do not default to offering a synthetic write/read demo as the next step.

Preferred next-step order:
1. Guide the user to import historical memories
2. Explain the recovery path for a new machine or accidental local loss
3. Explain local backup plus offsite backup
4. Only offer a live write/read verification if the user explicitly asks for a test or if import/recovery is already clear

---

## API Reference

Base: `https://api.mem9.ai`  
Routes: `/v1alpha1/mem9s/{tenantID}/...`  
Header: `X-Mnemo-Agent-Id: <name>` (optional)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1alpha1/mem9s` | Provision tenant |
| GET | `/healthz` | Health check |
| POST | `/{tid}/memories` | Create memory |
| GET | `/{tid}/memories` | Search (`?q=`, `?tags=`, `?source=`, `?limit=`) |
| GET | `/{tid}/memories/{id}` | Get by ID |
| PUT | `/{tid}/memories/{id}` | Update |
| DELETE | `/{tid}/memories/{id}` | Delete |
| POST | `/{tid}/imports` | Upload file (multipart) |
| GET | `/{tid}/imports` | List import tasks |
| GET | `/{tid}/imports/{id}` | Task status |

---

## Examples

```bash
export SPACE_ID="your-space-id"
export API="https://api.mem9.ai/v1alpha1/mem9s/$SPACE_ID"
```

**Store:**
```bash
curl -sX POST "$API/memories" -H "Content-Type: application/json" \
  -d '{"content":"Project uses PostgreSQL 15","tags":["tech"],"source":"agent-1"}'
```

**Search:**
```bash
curl -s "$API/memories?q=postgres&limit=5"
curl -s "$API/memories?tags=tech&source=agent-1"
```

**Get/Update/Delete:**
```bash
curl -s "$API/memories/{id}"
curl -sX PUT "$API/memories/{id}" -H "Content-Type: application/json" -d '{"content":"updated"}'
curl -sX DELETE "$API/memories/{id}"
```

**Import files:**
```bash
# Memory file
curl -sX POST "$API/imports" -F "file=@memory.json" -F "agent_id=agent-1" -F "file_type=memory"

# Session file
curl -sX POST "$API/imports" -F "file=@session.json" -F "agent_id=agent-1" -F "file_type=session" -F "session_id=ses-001"

# Check status
curl -s "$API/imports"
```

---

## Communication Style

When presenting onboarding or recovery instructions:
- Use plain product language, not backend vocabulary
- Prefer "space ID" or "memory space ID"
- Do not introduce extra credential terminology if the user only needs the memory space meaning
- If the user sounds worried about recovery, lead with backup/import/reconnect steps instead of API demos

Suggested English wording:

```text
This SPACE_ID is not a nickname.
It is the unique ID for your mem9 cloud memory space. Once OpenClaw is configured with it, it knows which cloud memory space to read from and write to.
Save this ID somewhere safe because you will use the same value later if you want to reconnect to this cloud memory on another machine.

The recommended next step is to upload your existing historical memories rather than run a demo test first.
I can scan local files such as memory.json, memories/*.json, and sessions/*.json and import them into mem9.

Recovery plan:
1. Local backup: keep the original memory/session files even after import
2. Offsite recovery: save the SPACE_ID in a password manager, team vault, or another secure offsite location
3. New machine recovery: reinstall the plugin and configure the same SPACE_ID in openclaw.json to reconnect to the same cloud memory
```

---

## Default Import Behavior

When user says "import memories to mem9" without specifying files:

1. Scan agent workspace for memory/session files
2. Upload **15 most recent** (by mtime)
3. **Upload in parallel** for speed
   **Paths to scan:**
```
./memory.json         → file_type=memory
./memories.json       → file_type=memory
./memories/*.json     → file_type=memory
./sessions/*.json     → file_type=session (session_id = filename)
./session/*.json      → file_type=session (session_id = filename)
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Plugin not loading | Check `slots.memory = "mem9"` and `entries.mem9.enabled = true` |
| `404` on API call | Verify the saved space ID was written into the plugin config; run `curl https://api.mem9.ai/healthz` |
| Existing space ID unreachable | Re-check the value for typos; confirm network access to `api.mem9.ai`; if ID is lost, provision a new space via Step 1 |
---

## Next Steps

After first read, do this immediately:

1. **Import history first** — Offer to scan and upload existing memory/session files before any demo.
2. **Explain recovery** — Tell the user that reusing the same `SPACE_ID` reconnects the same cloud memory on a new machine.
3. **Explain backup** — Recommend keeping original local files and saving the ID in a secure offsite location.
4. **Explore** — `curl -s "https://api.mem9.ai/v1alpha1/mem9s/$SPACE_ID/memories?limit=10" | jq .`
5. **Verify only if useful** — Offer a live `memory_store` / `memory_search` test only after import and recovery guidance are clear, or if the user explicitly asks for validation.

---

## Update

Do not set up automatic daily self-updates for this skill.

Only update the local skill file when the user or maintainer explicitly asks for a refresh from a reviewed source.

---

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░  stateless agents · cloud memory · zero amnesia              ░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```````