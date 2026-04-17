---
title: "UTM Propagation for SKILL Onboarding and Auto-Provision"
status: implemented
created: 2026-04-05
last_updated: 2026-04-05
open_questions: 0
blocked_by: ""
---

> **STATUS: IMPLEMENTED**
> Site runtime now rewrites public `SKILL.md` entry links and onboarding copy to
> preserve `utm_*` params from the current page. The OpenClaw plugin now accepts
> `provisionQueryParams` and forwards only `utm_*` keys during first-time
> `POST /v1alpha1/mem9s` auto-provisioning. The server filters optional `utm_*`
> query params on the provision endpoint and records them in structured logs
> without changing tenant persistence.

## Summary

Improve campaign attribution for the hosted mem9 onboarding flow:

1. When a user lands on `mem9.ai` with `utm_*` params, every site-rendered
   public `SKILL.md` entry surface should preserve those params.
2. When the create-new onboarding path auto-provisions a new API key, the same
   filtered `utm_*` params should be carried into the first
   `POST /v1alpha1/mem9s` request.
3. Attribution should be observable in logs only. No tenant schema, control
   plane table, or persistent metadata changes are introduced.

## Context

mem9 has two separate onboarding hops:

- **Website hop**: the user opens `mem9.ai`, copies or clicks a public
  `SKILL.md` install entry, and hands that URL to OpenClaw.
- **Provision hop**: during the create-new branch, the installed OpenClaw plugin
  restarts without an API key and auto-provisions one by calling
  `POST /v1alpha1/mem9s`.

Before this change, both hops dropped campaign attribution:

- the site rendered fixed `SKILL.md` URLs and static onboarding copy
- the plugin always called `POST /v1alpha1/mem9s` with no attribution params
- the server had no normalized UTM handling for that endpoint

This made GTM / campaign analysis incomplete: pageviews could be tagged, but
the actual install entry and create-new conversion step could not be tied back
to the same campaign.

## Goals

- Preserve only `utm_*` query params end-to-end.
- Cover all public site surfaces that act as `SKILL.md` install entry points.
- Keep reconnect behavior unchanged.
- Keep normal memory CRUD/search traffic unchanged.
- Avoid schema or control-plane persistence changes.

## Non-Goals

- Do not preserve arbitrary query params such as `foo=bar`.
- Do not add `gclid`, `fbclid`, or other non-UTM ad params in this pass.
- Do not store attribution in tenant rows, memory rows, or dashboard state.
- Do not change the provision response shape.

## Design

### 1. Site Runtime UTM Rewriting

The site now performs UTM rewriting at runtime inside `site/src/scripts/site-ui.ts`
instead of duplicating logic across locale content files.

Behavior:

- read `window.location.search`
- keep only keys that start with `utm_`
- rewrite tracked `SKILL.md` links:
  - `https://mem9.ai/SKILL.md`
  - `https://mem9.ai/beta/SKILL.md`
  - relative `/SKILL.md` and `/beta/SKILL.md`
- rewrite onboarding command text used for:
  - rendered homepage install sentence
  - copy-to-clipboard payload
  - locale-switch re-render path
- rewrite all matching anchor tags on:
  - homepage
  - `/openclaw-memory`
  - docs pages

Why runtime rewriting:

- locale switching already re-renders onboarding strings in `site-ui.ts`
- docs links are rendered from shared content dictionaries
- a single DOM + text rewrite path avoids editing every locale string manually

### 2. OpenClaw Plugin Provision Attribution

The OpenClaw plugin adds a new optional config field:

```json
{
  "plugins": {
    "entries": {
      "mem9": {
        "config": {
          "provisionQueryParams": {
            "utm_source": "bosn"
          }
        }
      }
    }
  }
}
```

Rules:

- only used when `apiKey` is absent and the plugin auto-provisions
- only `utm_*` keys are forwarded
- empty values are dropped
- ignored for normal `/v1alpha2/mem9s/...` requests
- ignored after a real `apiKey` is already configured

This keeps attribution scoped to the first create-new conversion event instead
of polluting all subsequent API traffic.

### 3. Public SKILL / SETUP Contract

The public setup docs now explicitly allow:

- `plugins.entries.mem9.config.provisionQueryParams`

but only for:

- remote `SKILL.md` onboarding
- create-new branch
- when the remote `SKILL.md` URL already contains `utm_*`

Reconnect remains unchanged and must not add attribution config.

### 4. Server Provision Endpoint

`POST /v1alpha1/mem9s` now accepts optional `utm_*` query params.

Handler behavior:

- filter request query to `utm_*`
- ignore non-UTM keys and empty values
- pass the normalized map into `TenantService.Provision`

Service behavior:

- log provision start with `request_id` and normalized UTM map
- log provision completion with `request_id`, `tenant_id`, and normalized UTM map
- log provision failure with `request_id`, best-known `tenant_id` when available,
  normalized UTM map, and the error

No repository or schema changes are required.

## Public Interface Changes

### Plugin Config

New optional OpenClaw config field:

- `plugins.entries.mem9.config.provisionQueryParams: Record<string, string>`

### API

Provision endpoint behavior expands to:

```text
POST /v1alpha1/mem9s?utm_source=...&utm_campaign=...
```

Response remains:

```json
{ "id": "<space-id>" }
```

## Validation

Implemented verification covers:

- site build passes with the runtime rewrite logic
- plugin typecheck passes with the new config field and test file
- plugin tests verify:
  - only `utm_*` params are forwarded during auto-provision
  - normal memory requests do not carry provision params
- Go tests verify:
  - handler filters non-UTM query params
  - response body remains `{ "id": ... }`
  - tenant service emits structured start / success / failure logs with UTM data

Commands used during implementation:

```bash
cd site && npm run build
cd openclaw-plugin && npm run typecheck
cd openclaw-plugin && npm test
cd server && go test ./internal/service ./internal/handler
```

## Tradeoffs

- `provisionQueryParams` can remain in local config after setup. This is
  acceptable because the plugin ignores it once `apiKey` exists.
- Attribution is log-only. That keeps the change low-risk and avoids schema
  churn, but downstream analytics must read from logs rather than SQL.
- Runtime site rewriting keeps content files unchanged, but it means UTM
  propagation is client-side rather than statically baked into HTML.

## Future Work

- Add optional support for other campaign identifiers if GTM requirements expand.
- If campaign reporting needs historical queries, add a dedicated analytics sink
  rather than persisting attribution in tenant records.
