---
title: dashboard/app — mem9 Dashboard SPA
---

## Overview

React SPA for the mem9 dashboard. Deployed at `mem9.ai/your-memory`. Two pages: Connect (Space ID entry) and Your Memory (memory list, search, detail, light management). Bilingual (zh-CN / en). Dark mode support (light / dark / system).

## Commands

```bash
cd dashboard/app && pnpm dev
cd dashboard/app && pnpm build
cd dashboard/app && pnpm preview
cd dashboard/app && pnpm typecheck
```

## Tech stack

Vite + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui + TanStack Query + TanStack Router + i18next + sonner.

## Where to look

| Task | File |
|------|------|
| Vite config (base path, alias, plugins, API proxy) | `vite.config.ts` |
| Router (2 routes, search params) | `src/router.tsx` |
| Entry point (QueryClient, RouterProvider, i18n, theme) | `src/main.tsx` |
| Global styles + CSS variables (light/dark) | `src/index.css` |
| Connect page | `src/pages/connect.tsx` |
| Your Memory page | `src/pages/space.tsx` |
| API types (Memory, SpaceInfo, etc.) | `src/types/memory.ts` |
| API client (mock/real switch via `VITE_USE_MOCK`) | `src/api/client.ts` |
| TanStack Query hooks (useStats, useMemories, mutations) | `src/api/queries.ts` |
| Mock data (20 realistic memories) | `src/api/mock-data.ts` |
| i18next initialization | `src/i18n/index.ts` |
| Chinese translations | `src/i18n/locales/zh-CN.json` |
| English translations | `src/i18n/locales/en.json` |
| `cn()` utility for shadcn | `src/lib/utils.ts` |
| Relative time formatting | `src/lib/time.ts` |
| Space ID session management | `src/lib/session.ts` |
| Theme management (light/dark/system) | `src/lib/theme.ts` |
| Theme toggle component | `src/components/theme-toggle.tsx` |
| Memory card component | `src/components/space/memory-card.tsx` |
| Detail panel component | `src/components/space/detail-panel.tsx` |
| Add memory dialog | `src/components/space/add-dialog.tsx` |
| Edit memory dialog | `src/components/space/edit-dialog.tsx` |
| Delete confirmation dialog | `src/components/space/delete-dialog.tsx` |
| Empty state component | `src/components/space/empty-state.tsx` |
| shadcn/ui components (auto-generated) | `src/components/ui/` |
| Environment variables (dev) | `.env` |
| Environment variables (prod) | `.env.production` |
| Netlify redirects (API proxy + SPA fallback) | `public/_redirects` |

## Local conventions

- Package manager is `pnpm`.
- Path alias `@/` resolves to `src/`. Use `@/` in all imports.
- Mock/real API switch via `VITE_USE_MOCK` env var (`"true"` = mock, anything else = real). Dev defaults to mock (`.env`), production defaults to real (`.env.production`).
- API proxy: frontend calls `/your-memory/api/...` (relative path). Vite dev server proxies to `api.mem9.ai`; Netlify rewrite does the same in production. No CORS needed.
- i18n keys are nested JSON (`connect.title` → `{ "connect": { "title": "..." } }`). Translations live in `src/i18n/locales/`. All user-facing text must go through `t()`, never hardcoded.
- API types in `src/types/memory.ts` mirror the backend data contract (`docs/data-contract.md`). Keep them in sync.
- TanStack Query hooks in `src/api/queries.ts` handle caching and mutation invalidation. Components should use these hooks, not call `api` directly.
- TanStack Router manages search params (`q`, `type`) for the Space page. Use `route.useSearch()` and `navigate({ search })` to read/write URL state.
- Session state (Space ID) lives in `sessionStorage` via `src/lib/session.ts`. Language preference lives in `localStorage` via i18next. Theme preference lives in `localStorage` via `src/lib/theme.ts`.
- shadcn/ui components go in `src/components/ui/`. Pull new components with `pnpx shadcn@latest add <name>`.
- Tailwind CSS 4 with `@tailwindcss/vite` plugin. Import via `@import "tailwindcss"` in `src/index.css`. CSS variables define light/dark themes.
- SPA deployed at `/your-memory/`. Vite `base` and Router `basepath` are both set.

## Design references

- Product spec: `docs/dashboard-mvp-spec.md`
- Information architecture: `docs/information-architecture.md`
- API data contract: `docs/data-contract.md`
- Development tasks: `docs/dev-tasks.md`

## Anti-patterns

- Do NOT hardcode user-facing text. All UI strings go through `t()`.
- Do NOT call `api.*` directly in components. Use the TanStack Query hooks from `src/api/queries.ts`.
- Do NOT store Space ID in `localStorage` or URL. Use `sessionStorage` only.
- Do NOT add SSR or server-side logic. This is a pure client-side SPA.
- Do NOT import from `@tanstack/react-router` in `src/api/` or `src/lib/`. Keep routing concerns in `src/router.tsx` and `src/pages/`.
- Do NOT modify mock data structure without updating `src/types/memory.ts` to match.
- Do NOT make cross-origin API calls. Use the proxy path (`/your-memory/api/...`).
