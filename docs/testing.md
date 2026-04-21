# Testing

This document tracks the automated test lanes for the `mem9` repository. The
first gate is intentionally narrow: it gives pull requests quick feedback on the
server and agent integration packages without requiring secrets, a live mem9
environment, or external model providers.

## PR fast gate

Workflow: `.github/workflows/pr-fast-gate.yml`

Triggers:

- `pull_request` to `main` when server, plugin, workflow, Makefile, or this
  document changes.
- `push` to `main` for the same paths.
- Manual `workflow_dispatch`.

Jobs:

- `server-test` runs `make vet` and `make test-cover`.
- `plugin-typecheck` runs OpenClaw plugin typecheck, OpenCode plugin typecheck,
  and Claude plugin shell / JavaScript syntax checks.

The gate does not use repository secrets and does not deploy anything. The
existing dev deployment workflow remains responsible for pushing the server to
the dev cluster after changes land on `main`.

## Local commands

Run the same server checks used by CI:

```bash
make vet
make test-cover
```

Run the plugin checks used by CI:

```bash
cd openclaw-plugin
npm install --no-audit --no-fund
npm run typecheck
```

```bash
cd opencode-plugin
npm install --no-audit --no-fund
npm run typecheck
```

```bash
cd claude-plugin
bash -n hooks/common.sh hooks/pre-compact.sh hooks/session-end.sh hooks/session-start.sh hooks/stop.sh hooks/user-prompt-submit.sh
node --check hooks/lib/hook-json.mjs
node --check hooks/lib/memories-formatter.mjs
node --check hooks/lib/transcript-parser.mjs
```

## Coverage artifacts

`make test-cover` writes server coverage files under `server/coverage/`:

- `coverage.out`: machine-readable Go coverage profile.
- `coverage.txt`: human-readable function coverage summary.

CI uploads both files as the `server-coverage` artifact. The first gate records
the coverage baseline but does not enforce a percentage threshold yet. Thresholds
should be introduced package-by-package after the baseline is stable.

## Not covered by the first gate

The first gate does not run dashboard tests, live API smoke tests, `mem9-tester`
provider matrices, or `locomo` benchmark runs.

Planned follow-ups:

- Add dashboard verification once package manager and build time expectations are
  agreed.
- Convert live API smoke scripts under `e2e/` into an on-demand or nightly lane.
- Expand `mem9-tester` with reconnect, upgrade, reset, reinstall, and broken
  config recovery scenarios.
- Keep `locomo` as a slow nightly or release validation lane rather than a pull
  request gate.
