# mem9 Dashboard App

## Setup

```bash
cd dashboard/app
pnpm install
cp .env.local.example .env.local
pnpm dev
```

## Environment Variables

Use `.env.local` for local overrides. Keep the shared `.env` unchanged.

| Variable | Example | Current use | Notes |
|----------|---------|-------------|-------|
| `VITE_USE_MOCK` | `"true"` | active | shared `.env` currently sets `"false"`; `.env.local` should override it for UI-first work |
| `VITE_API_BASE` | `/your-memory/api` | active | use the same relative path in dev and production |
| `VITE_ANALYSIS_API_BASE` | `/your-memory/analysis-api` | active | same-origin proxy for `napi.mem9.ai` in dev and production |
| `VITE_ENABLE_MANUAL_ADD` | `"true"` | planned | add in `src/config/features.ts` before wiring gated UI |
| `VITE_ENABLE_TIME_RANGE` | `"true"` | planned | keep off in real mode until backend params exist |
| `VITE_ENABLE_FACET` | `"true"` | planned | controls facet label visibility |
| `VITE_ENABLE_TOPIC_SUMMARY` | `"true"` | planned | controls topic strip visibility |
| `VITE_ENABLE_ANALYSIS` | `"true"` | active | hidden automatically when `VITE_USE_MOCK="true"` |
| `VITE_ANALYSIS_BATCH_SIZE` | `100` | active | client-side batch size for upload chunks |
| `VITE_ANALYSIS_POLL_MS` | `1500` | active | default poll interval before server overrides |

```bash
# UI-first local work
pnpm dev

# Real API through the Vite proxy
VITE_USE_MOCK=false pnpm dev

# Real API via custom backend
VITE_USE_MOCK=false VITE_API_BASE=http://localhost:8080/v1alpha1/mem9s pnpm dev
```

See `../docs/ui-first-mock-plan.md` and `../docs/ui-first-mock-plan.zh-CN.md` for the planned feature-flag matrix and provider split.

## API Proxy

The frontend never makes cross-origin requests. All API calls go through a same-origin proxy:

| Environment | Proxy | Frontend Path | Backend Target |
|-------------|-------|---------------|----------------|
| Dev | Vite dev server | `/your-memory/api/...` | `https://api.mem9.ai/v1alpha1/mem9s/...` |
| Dev | Vite dev server | `/your-memory/analysis-api/...` | `https://napi.mem9.ai/...` |
| Prod | Netlify rewrite | `/your-memory/api/...` | `https://api.mem9.ai/v1alpha1/mem9s/...` |
| Prod | Netlify rewrite | `/your-memory/analysis-api/...` | `https://napi.mem9.ai/...` |

## Working Rules

- `src/api/client.ts` is the current mixed client. Treat it as transitional code.
- New gated features should go through `src/config/features.ts`.
- Keep user-facing copy in i18n only.
- Keep UI data access inside TanStack Query hooks.
- The current dependency set is enough for the planned UI-first pass. Prefer browser APIs for export and import helpers before adding packages.

## Reference Docs

- `../docs/dashboard-mvp-spec.md`
- `../docs/information-architecture.md`
- `../docs/data-contract.md`
- `../docs/dev-tasks.md`
- `../docs/ui-first-mock-plan.md`

## Project Structure

```
src/
├── main.tsx                — Entry (QueryClient + Router + i18n + theme)
├── router.tsx              — TanStack Router (2 routes)
├── index.css               — Tailwind + CSS variables (light/dark)
├── pages/
│   ├── connect.tsx         — Connect / onboarding page
│   └── space.tsx           — Your Memory main page
├── types/
│   └── memory.ts           — API type definitions
├── api/
│   ├── client.ts           — Current mixed API client, to be split
│   ├── queries.ts          — TanStack Query hooks
│   └── mock-data.ts        — Current mock memories
├── i18n/
│   ├── index.ts            — i18next initialization
│   └── locales/
│       ├── zh-CN.json      — Chinese translations
│       └── en.json         — English translations
├── lib/
│   ├── utils.ts            — cn() for shadcn
│   ├── time.ts             — Relative time formatting
│   ├── session.ts          — Space ID session management
│   └── theme.ts            — Theme management (light/dark/system)
└── components/
    ├── theme-toggle.tsx    — Theme switcher button
    ├── ui/                 — shadcn/ui components (button, input, dialog, tabs)
    └── space/              — Business components
        ├── memory-card.tsx
        ├── detail-panel.tsx
        ├── add-dialog.tsx
        ├── edit-dialog.tsx
        ├── delete-dialog.tsx
        └── empty-state.tsx
```
