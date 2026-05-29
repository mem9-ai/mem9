# compat

Atomic compatibility harness for mem9 integrations.

## Repo-local entrypoint

Because this repository needs both a `compat/` directory and a runnable entrypoint,
the checked-in command is:

```bash
python3 compat run openclaw.install
python3 compat run hermes.contract --agent-ref path:/Users/sx/github/mem9/mem9-hermes-plugin
python3 compat run dify.contract --agent-ref path:/Users/sx/github/mem9/mem9-dify-plugin
python3 compat agent hermes --lane contract --agent-ref main
python3 compat agent openclaw --lane hosted-smoke --host-channel next
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
- Agent lanes for `contract`, `hosted-smoke`, and `full`
- External checkout support for:
  - `mem9-ai/mem9-hermes-plugin`
  - `mem9-ai/mem9-dify-plugin`

## Agent upgrade checks

The repo-owned GitHub Action is `.github/workflows/agent-compat.yml`.
It is manual-first (`workflow_dispatch`) so an agent upgrade can be checked
against a specific branch, tag, or SHA before release:

```text
agent=hermes
agent_ref=<branch-or-tag-or-sha>
lane=contract
```

For local development, pass `path:<absolute-path>` to use a sibling checkout:

```bash
python3 compat agent hermes --lane contract --agent-ref path:/Users/sx/github/mem9/mem9-hermes-plugin
python3 compat agent dify --lane contract --agent-ref path:/Users/sx/github/mem9/mem9-dify-plugin
```

When `agent_ref` is omitted, the harness uses `agents.<name>.default_ref` from
`manifest.yaml`. Stable failures are blocking. `next` host-channel failures are
configured as alert-style checks in the workflow.

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
