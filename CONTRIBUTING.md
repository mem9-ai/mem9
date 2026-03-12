# Contributing to mnemos

Thanks for your interest in contributing!

## Development Setup

### Server (Go)

```bash
# Prerequisites: Go 1.22+, a MySQL-compatible database (TiDB or MySQL 8.0+)

# Clone and build
git clone https://github.com/mem9-ai/mem9.git
cd mem9/server
go mod download
go build ./cmd/mnemo-server

# Apply schema
mysql -h <host> -P <port> -u <user> -p < schema.sql

# Run
export MNEMO_DSN="user:pass@tcp(host:port)/mnemos?parseTime=true"
go run ./cmd/mnemo-server
```

### Claude Code Plugin

The claude-plugin is pure bash + curl with zero dependencies. To test locally:

```bash
export MNEMO_API_URL="http://localhost:8080"
export MNEMO_API_TOKEN="mnemo_xxx"

# Test a hook script directly
echo '{}' | ./claude-plugin/hooks/session-start.sh
```

### Agent Plugins (OpenClaw)

```bash
cd openclaw-plugin
npm install
```

This section is for the OpenClaw integration specifically; mnemos supports multiple agent platforms.

## Making Changes

1. Fork the repo and create a feature branch
2. Make your changes
3. Run `cd server && go vet ./...` to check for issues
4. Submit a pull request

## Code Style

- **Go**: `gofmt` is the standard. No additional linters required.
- **Shell**: Follow the patterns in `claude-plugin/hooks/common.sh`. Use `set -euo pipefail`.
- **TypeScript**: Follow existing patterns in agent plugin packages (`openclaw-plugin/`, `opencode-plugin/`).

## Architecture

The codebase follows a clean layered architecture:

```
HTTP Request → Handler → Service → Repository → Database
```

- **Domain types** (`internal/domain/`) are imported by all layers
- **Repository interfaces** (`internal/repository/repository.go`) define the contract
- **TiDB implementations** (`internal/repository/tidb/`) are the only SQL-aware code
- **Services** contain business logic (upsert, conflict resolution, validation)
- **Handlers** map HTTP ↔ service calls, nothing more

When adding a new feature, start from the domain types and work outward.

## Reporting Issues

Please use [GitHub Issues](https://github.com/mem9-ai/mem9/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- Server version and database type
