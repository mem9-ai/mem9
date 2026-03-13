---
title: cli — Standalone Go CLI
---

## Overview

`cli/` is a separate Go module (`github.com/qiffang/mnemos/cli`) used for manual testing of mnemo-server HTTP endpoints. It does not share code with `server/`. Note: the Go module path still uses the old import path for build compatibility.

## Commands

```bash
cd cli && go build -o mnemo .
cd cli && go install .
cd cli && go test ./...
```

## Where to look

| Task | File |
|------|------|
| Command tree and flags | `main.go` |
| Install/config examples | `README.md` |
| Module boundary | `go.mod` |

## Local conventions

- All commands live in one file: `main.go`.
- Global flags map to env vars: `MNEMO_API_URL`, `MNEMO_TENANT_ID`, `MNEMO_AGENT_ID`.
- Request/response structs are duplicated locally; keep them in sync with server behavior manually.
- Treat this as a developer tool, not production runtime code.

## Anti-patterns

- Do NOT assume root `make test` covers this module.
- Do NOT import server internals just to share tiny structs.
- Do NOT add hidden local defaults that make README examples unreproducible.
