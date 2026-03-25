---
title: dashboard/app — mem9 Dashboard SPA
---

## Overview

React SPA for the mem9 dashboard. Deployed at `mem9.ai/your-memory`. Three pages: Connect (Space ID entry), Your Memory (memory list, search, detail, light management), and Pixel Farm (full-screen Phaser sandbox at `/labs/memory-farm`). Bilingual (zh-CN / en). Dark mode support (light / dark / system).

## Commands

```bash
cd dashboard/app && pnpm dev
cd dashboard/app && pnpm build
cd dashboard/app && pnpm preview
cd dashboard/app && pnpm typecheck
```

## Tech stack

Vite + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui + TanStack Query + TanStack Router + i18next + sonner + Phaser.

## Where to look

| Task | File |
|------|------|
| Vite config (base path, alias, plugins, API proxy) | `vite.config.ts` |
| Router (3 routes in prod, 4 in dev, search params) | `src/router.tsx` |
| Entry point (QueryClient, RouterProvider, i18n, theme) | `src/main.tsx` |
| Global styles + CSS variables (light/dark) | `src/index.css` |
| Connect page | `src/pages/connect.tsx` |
| Your Memory page | `src/pages/space.tsx` |
| Pixel Farm page | `src/pages/pixel-farm.tsx` |
| Pixel Farm editor page (dev only) | `src/pages/pixel-farm-editor.tsx` |
| Pixel Farm Phaser host | `src/components/pixel-farm/phaser-stage.tsx` |
| Feature flags (mock mode, gated features) | `src/config/features.ts` |
| API types (Memory, SpaceInfo, etc.) | `src/types/memory.ts` |
| Time range types and preset-to-params util | `src/types/time-range.ts` |
| Import task types | `src/types/import.ts` |
| DashboardProvider interface (data contract) | `src/api/provider.ts` |
| API client (conditional re-export of mock/http provider) | `src/api/client.ts` |
| Mock provider implementation | `src/api/provider-mock.ts` |
| HTTP provider implementation | `src/api/provider-http.ts` |
| Analysis API client and error mapping | `src/api/analysis-client.ts` |
| Analysis TanStack Query workflow | `src/api/analysis-queries.ts` |
| Analysis panel UI | `src/components/space/analysis-panel.tsx` |
| Pixel Farm stage host | `src/components/pixel-farm/` |
| TanStack Query hooks (useStats, useMemories, mutations, export/import/topics) | `src/api/queries.ts` |
| Mock data (24 realistic memories + import fixtures) | `src/api/mock-data.ts` |
| i18next initialization | `src/i18n/index.ts` |
| Chinese translations | `src/i18n/locales/zh-CN.json` |
| English translations | `src/i18n/locales/en.json` |
| `cn()` utility for shadcn | `src/lib/utils.ts` |
| Pixel Farm Phaser bootstrap | `src/lib/pixel-farm/` |
| Pixel Farm tileset config | `src/lib/pixel-farm/tileset-config.ts` |
| Pixel Farm layer data + tile overrides | `src/lib/pixel-farm/island-mask.ts` |
| Pixel Farm generated terrain + object data (auto-written) | `src/lib/pixel-farm/generated-mask-data.ts` |
| Pixel Farm generated data serializer | `src/lib/pixel-farm/generated-mask-source.ts` |
| Relative time formatting | `src/lib/time.ts` |
| Space ID session management | `src/lib/session.ts` |
| Theme management (light/dark/system) | `src/lib/theme.ts` |
| Theme toggle component | `src/components/theme-toggle.tsx` |
| Memory card component | `src/components/space/memory-card.tsx` |
| Detail panel component | `src/components/space/detail-panel.tsx` |
| Add memory dialog | `src/components/space/add-dialog.tsx` |
| Edit memory dialog | `src/components/space/edit-dialog.tsx` |
| Delete confirmation dialog | `src/components/space/delete-dialog.tsx` |
| Space Tools dropdown (export/import) | `src/components/space/space-tools.tsx` |
| Time range selector (7d/30d/90d/all) | `src/components/space/time-range.tsx` |
| Topic strip (facet chips with counts) | `src/components/space/topic-strip.tsx` |
| Export dialog | `src/components/space/export-dialog.tsx` |
| Import dialog (file upload + validation) | `src/components/space/import-dialog.tsx` |
| Import status dialog (task list) | `src/components/space/import-status.tsx` |
| Empty state component | `src/components/space/empty-state.tsx` |
| shadcn/ui components (auto-generated) | `src/components/ui/` |
| Shared environment defaults | `.env` |
| Local UI-first overrides | `.env.local.example` |
| Standalone Netlify redirects | `public/_redirects` |

## Local conventions

- Package manager is `pnpm`.
- Path alias `@/` resolves to `src/`. Use `@/` in all imports.
- Mock/real API switch currently uses `VITE_USE_MOCK` (`"true"` = mock, anything else = real). Shared `.env` currently sets `"false"`. For UI-first work, copy `.env.local.example` to `.env.local` and override locally instead of editing shared `.env`.
- Feature flags live in `src/config/features.ts`. Currently: `useMock`, `enableManualAdd`, `enableTimeRange`, `enableFacet`, `enableTopicSummary`, `enableAnalysis`. UI components check these flags before rendering gated features.
- API proxy: frontend calls `/your-memory/api/...` and `/your-memory/analysis-api/...` (relative paths). Vite dev server proxies them to `api.mem9.ai` and `napi.mem9.ai`; Netlify rewrites do the same in production. No CORS needed.
- When dashboard is shipped under the main `mem9.ai` site, the production Netlify rewrites live in `site/netlify.toml`. `public/_redirects` remains the standalone-dashboard fallback.
- i18n keys are nested JSON (`connect.title` → `{ "connect": { "title": "..." } }`). Translations live in `src/i18n/locales/`. Production-facing UI text goes through `t()`. The dev-only Pixel Farm mask editor may keep inline copy to reduce i18n churn and merge conflicts.
- API types in `src/types/memory.ts` mirror the backend data contract (`../docs/data-contract.md`). Keep them in sync.
- TanStack Query hooks in `src/api/queries.ts` handle caching and mutation invalidation. Components should use these hooks, not call `api` directly.
- TanStack Router manages `q`, `type`, `range`, and `facet` search params for the Space page. Use `route.useSearch()` and `navigate({ search })` to read/write URL state.
- Session state (Space ID) lives in `sessionStorage` via `src/lib/session.ts`. Language preference lives in `localStorage` via i18next. Theme preference lives in `localStorage` via `src/lib/theme.ts`.
- shadcn/ui components go in `src/components/ui/`. Pull new components with `pnpx shadcn@latest add <name>`.
- Tailwind CSS 4 with `@tailwindcss/vite` plugin. Import via `@import "tailwindcss"` in `src/index.css`. CSS variables define light/dark themes.
- SPA deployed at `/your-memory/`. Vite `base` and Router `basepath` are both set.
- The experimental Pixel Farm route lives at `/your-memory/labs/memory-farm` and is lazy-loaded to avoid pulling Phaser into the default dashboard path.
- The Pixel Farm mask editor route lives at `/your-memory/labs/memory-farm-editor` and is mounted only in development.
- The Pixel Farm editor export button writes `src/lib/pixel-farm/generated-mask-data.ts` through a dev-only Vite middleware endpoint. Treat that file as generated data only.
- Pixel Farm asset filenames in `src/assets/` use lowercase kebab-case. Register any new editor-visible spritesheet in `src/lib/pixel-farm/tileset-config.ts`.
- Pixel Farm rendering is layer-based. Terrain uses `mask + baseTile + override` per layer; object placements reference a `layerId` so they render in the same draw order. No autotile logic remains.
- The Pixel Farm editor palette shows all registered asset sources at once. Keep `layer` for draw order only; do not couple layers 1:1 to image files.
- The Pixel Farm editor has `Terrain`, `Objects`, and `Collision` modes. `Objects` mode is visual-only single-tile placement; static blocking lives only in the dedicated collision layer, exported through the same generated data file.
- Pixel Farm collision data is half-tile-cell based: each collision record blocks one `0.5 x 0.5 tile` cell. The editor paints/erases `2 x 2` sub-cells per tile directly, and runtime collision queries consume the same half-tile grid data.
- Pixel Farm keeps a dedicated top-level `objects` layer. `Objects` mode auto-switches to it, and newly added terrain layers should be inserted before it.
- The Pixel Farm editor can add and delete layers directly. New layers inherit the currently selected tile as their base tile; deleting a layer also removes object placements assigned to it.
- `src/api/client.ts` re-exports the active provider. Mock and real logic are split into `provider-mock.ts` and `provider-http.ts` respectively, both implementing the `DashboardProvider` interface from `provider.ts`.
- The current dependency set is enough for UI-first work. Prefer browser APIs (`Blob`, `URL.createObjectURL`, `FormData`, `File`) before adding new packages.

## Design references

- Product spec: `../docs/dashboard-mvp-spec.md`
- Information architecture: `../docs/information-architecture.md`
- API data contract: `../docs/data-contract.md`
- Development tasks: `../docs/dev-tasks.md`
- UI-first mock plan: `../docs/ui-first-mock-plan.md`

## Anti-patterns

- Do NOT hardcode production-facing text. Ship pages go through `t()`. The dev-only Pixel Farm mask editor is the exception.
- Do NOT call `api.*` directly in components. Use the TanStack Query hooks from `src/api/queries.ts`.
- Do NOT store Space ID in `localStorage` or URL. Use `sessionStorage` only.
- Do NOT add SSR or server-side logic. This is a pure client-side SPA.
- Do NOT import from `@tanstack/react-router` in `src/api/` or `src/lib/`. Keep routing concerns in `src/router.tsx` and `src/pages/`.
- Do NOT modify mock data structure without updating `src/types/memory.ts` to match.
- Do NOT make cross-origin API calls. Use the proxy paths (`/your-memory/api/...`, `/your-memory/analysis-api/...`).
- Do NOT couple the Pixel Farm route to dashboard data or HUD by default. Keep it as a standalone game stage until the game-side requirements are clear.
