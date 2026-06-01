# compat

Atomic compatibility harness for mem9 integrations.

## Repo-local entrypoint

Because this repository needs both a `compat/` directory and a runnable entrypoint,
the checked-in command is:

```bash
python3 compat run openclaw.install
python3 compat run hermes.contract --plugin-ref path:/Users/sx/github/mem9/mem9-hermes-plugin
python3 compat run dify.contract --plugin-ref path:/Users/sx/github/mem9/mem9-dify-plugin
python3 compat agent hermes --lane plugin-contract --plugin-ref main
python3 compat agent openclaw --lane host-smoke --host-ref 2026.5.28
python3 compat agent opencode --lane host-smoke --host-ref 1.15.13
python3 compat agent codex --lane host-smoke --host-ref 0.135.0
python3 compat suite openclaw-upgrade --host-channel stable --model-profile primary
python3 compat matrix pr-core
```

## What is implemented in v1

- A manifest-driven runner at [`manifest.yaml`](./manifest.yaml)
- Atomic OpenClaw modules:
  - `openclaw.install`
  - `openclaw.setup`
  - `openclaw.recall`
  - `openclaw.ingest`
  - `openclaw.compact`
  - `openclaw.restart`
  - `openclaw.failsoft`
- Declarative suites:
  - `openclaw-smoke`
  - `openclaw-upgrade`
  - `openclaw-plugin-release`
- Matrix orchestration for `pr-core`, `nightly-full`, and `release-gate`
- A local recorder proxy that forwards to `mnemo-server` and records plugin traffic
- Agent lanes for `plugin-contract`, `host-smoke`, and `full`
- External checkout support for:
  - `mem9-ai/mem9-hermes-plugin`
  - `mem9-ai/mem9-dify-plugin`
- Host upgrade smoke support for:
  - OpenClaw via `openclaw@<host_ref>`
  - Hermes via `NousResearch/hermes-agent@<host_ref>` checkout plus provider smoke
  - Claude Code via `@anthropic-ai/claude-code@<host_ref>`
  - OpenCode via `opencode-ai@<host_ref>`
  - Codex via `@openai/codex@<host_ref>`

## Agent upgrade checks

The repo-owned GitHub Action is `.github/workflows/agent-compat.yml`.
It is manual-first (`workflow_dispatch`) so an agent upgrade can be checked
against a specific branch, tag, or SHA before release:

```text
agent=hermes
plugin_ref=<branch-or-tag-or-sha>
lane=plugin-contract
```

For local development, pass `path:<absolute-path>` to use a sibling checkout:

```bash
python3 compat agent hermes --lane plugin-contract --plugin-ref path:/Users/sx/github/mem9/mem9-hermes-plugin
python3 compat agent dify --lane plugin-contract --plugin-ref path:/Users/sx/github/mem9/mem9-dify-plugin
```

Use `plugin_ref` for plugin upgrades and `host_ref` for host upgrades. When a
ref is omitted, the harness uses the manifest defaults. Stable failures are
blocking. `next` host-channel failures are configured as alert-style checks in
the workflow.

Examples:

```bash
python3 compat agent hermes --lane plugin-contract --plugin-ref release-candidate
python3 compat agent claude --lane host-smoke --host-ref 2.1.159
python3 compat agent opencode --lane host-smoke --host-ref 1.15.13 --plugin-source local
python3 compat agent codex --lane host-smoke --host-ref 0.135.0
python3 compat agent openclaw --lane host-smoke --host-ref 2026.5.28
```

## Required environment

OpenClaw live modules need a reachable mem9 API:

```bash
export MNEMO_BASE_URL="http://127.0.0.1:8080"
```

Agent-driving modules also need a model key that OpenClaw can use:

```bash
export CLAUDE_CODE_TOKEN="..."
# or
export ANTHROPIC_API_KEY="..."
```

Optional host overrides:

```bash
export COMPAT_OPENCLAW_STABLE_BIN="/path/to/openclaw-stable"
export COMPAT_OPENCLAW_NEXT_BIN="/path/to/openclaw-next"
export COMPAT_OPENCLAW_MODEL_PRIMARY="anthropic/claude-sonnet-4-6"
export COMPAT_OPENCLAW_MODEL_SECONDARY="anthropic/claude-3-5-haiku-latest"
```

Optional external repo path overrides:

```bash
export COMPAT_HERMES_REPO_PATH="/Users/sx/github/mem9/mem9-hermes-plugin"
export COMPAT_DIFY_REPO_PATH="/Users/sx/github/mem9/mem9-dify-plugin"
```

## Artifacts

By default, every run writes under:

```text
compat/artifacts/<run-id>/<module>/
```

Each module writes:

- `result.json`
- `details.json`
- module-specific logs such as `gateway.log`, `agent.stdout.json`, `agent.stderr.txt`
