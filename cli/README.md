# mnemo CLI

Command-line tool for testing mnemo-server REST API endpoints.

## Installation

```bash
cd cli
go build -o mnemo .

# Optionally install to $GOPATH/bin
go install .
```

## Configuration

Set environment variables for convenience:

```bash
export MNEMO_API_URL="http://localhost:8080"
export MNEMO_TENANT_ID="your-tenant-id"
export MNEMO_AGENT_ID="cli-agent"
```

Or use flags:

```bash
mnemo -u http://localhost:8080 -t your-tenant-id -a my-agent <command>
```

## Commands

### Provision a new tenant

```bash
mnemo provision
# Returns: {"id": "uuid", "claim_url": "..."}
```

### Memory Operations

```bash
# Create a memory
mnemo memory create "Project uses PostgreSQL 15" --tags "tech-stack,database"

# Search memories
mnemo memory search -q "database" --limit 10
mnemo memory search --tags "tech-stack" --state "active"

# Get a specific memory
mnemo memory get <memory-id>

# Update a memory
mnemo memory update <memory-id> -c "Updated content" --tags "new-tag"

# Delete a memory
mnemo memory delete <memory-id>

# Bulk create from JSON file
mnemo memory bulk ./memories.json

# Ingest conversation messages
mnemo memory ingest ./messages.json --session-id "session-001"

# Get bootstrap memories for agent startup
mnemo memory bootstrap --limit 20
```

### Task Operations (File Uploads)

```bash
# Upload a memory file
mnemo task create ./memory.json --file-type memory

# Upload a session file
mnemo task create ./sessions/session-001.json --file-type session --session-id session-001

# List all tasks
mnemo task list

# Get task status
mnemo task get <task-id>
```

### Tenant Operations

```bash
# Get tenant info
mnemo tenant info
```

## File Formats

### Bulk Create JSON

```json
[
  {"content": "First memory", "tags": ["tag1"]},
  {"content": "Second memory", "tags": ["tag2"]}
]
```

### Ingest Messages JSON

```json
[
  {"role": "user", "content": "What is React?"},
  {"role": "assistant", "content": "React is a JavaScript library..."}
]
```

## Examples

```bash
# Full workflow example
mnemo provision
# → {"id": "abc123..."}

export MNEMO_TENANT_ID="abc123..."

# Create some memories
mnemo memory create "The project uses React 18 for the frontend" --tags "tech-stack,frontend"
mnemo memory create "PostgreSQL 15 is the primary database" --tags "tech-stack,database"
mnemo memory create "API runs on port 8080" --tags "config"

# Search for tech stack info
mnemo memory search -q "tech stack"

# Upload existing session files
mnemo task create ./sessions/session-001.json --file-type session --session-id session-001

# Check upload status
mnemo task list
```

## Global Flags

| Flag | Short | Env Var | Default | Description |
|------|-------|---------|---------|-------------|
| `--api-url` | `-u` | `MNEMO_API_URL` | `http://localhost:8080` | mnemo-server API URL |
| `--tenant-id` | `-t` | `MNEMO_TENANT_ID` | - | Tenant ID |
| `--agent-id` | `-a` | `MNEMO_AGENT_ID` | `cli-agent` | Agent ID |
| `--timeout` | - | - | `30s` | Request timeout |
