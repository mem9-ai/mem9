# mem9 Dashboard MVP — Development Task Breakdown

Status: draft  
Date: 2026-03-12

## Prerequisite Documents

- Product Spec: `dashboard-mvp-spec.md`
- Information Architecture: `information-architecture.md`
- Data Contract: `data-contract.md`

## Tech Stack

| Category | Choice | Notes |
|----------|--------|-------|
| Package manager | pnpm | |
| Build | Vite | No SSR needed, SPA only |
| Framework | React 19 + TypeScript | |
| Styling | Tailwind CSS 4 | `@tailwindcss/vite` plugin |
| UI components | shadcn/ui | Radix-based, on-demand install, Tailwind native |
| Data fetching | @tanstack/react-query | Caching, loading/error state, mutation auto-refresh |
| Routing | @tanstack/react-router | type-safe search params, same ecosystem as TanStack Query |
| i18n | i18next + react-i18next | Hook-driven, language switch auto re-render |
| Toast | sonner | shadcn official recommendation |
| className | clsx + tailwind-merge | shadcn standard `cn()` helper |
| Icons | lucide-react | Lightweight, pairs well with shadcn |

No axios needed — TanStack Query + native fetch is sufficient.

## Deployment

Dashboard is deployed under `mem9.ai/your-memory`, coexisting with the Astro site on Netlify:

1. Vite config `base: '/your-memory/'`
2. TanStack Router config `basepath: '/your-memory'`
3. Build output copied into Astro site `dist/your-memory/`
4. Netlify `_redirects` (in `public/_redirects`, copied to dist during build):
   - `/your-memory/api/*` → `https://api.mem9.ai/v1alpha1/mem9s/:splat` (200, API proxy)
   - `/your-memory/*` → `/your-memory/index.html` (200, SPA fallback)

Both projects build independently; deploy artifacts are merged.

### API Proxy

Frontend does not call the backend API directly across origins. Both dev and prod go through a proxy:

- **Dev**: Vite dev server proxy (`vite.config.ts` → `server.proxy`)
- **Prod**: Netlify rewrite (`public/_redirects`, status 200 = server-side proxy)

Frontend `API_BASE` is `/your-memory/api` everywhere, same for dev and prod.

## Project Scaffold (Ready)

These files are already in `dashboard/app/` and can be used as-is:

```
dashboard/app/
├── package.json             — project metadata + scripts
├── vite.config.ts           — Vite config (base + alias + plugins + API proxy)
├── tsconfig.json            — TypeScript project reference
├── tsconfig.app.json        — TypeScript compiler options (includes @/ path alias)
├── index.html               — SPA entry (includes dark mode anti-flash script)
├── components.json          — shadcn/ui config
├── .env                     — dev env vars (VITE_USE_MOCK=true)
├── .env.production          — prod env vars (VITE_USE_MOCK=false)
├── public/
│   ├── _redirects           — Netlify rewrite rules (API proxy + SPA fallback)
│   ├── favicon.svg          — Site favicon
│   ├── mem9-logo.svg        — mem9 wordmark logo
│   ├── mem9-mark.svg        — mem9 mark
│   └── mem9-wordmark.svg    — mem9 wordmark
└── src/
    ├── main.tsx             — Entry (QueryClient + RouterProvider + i18n + theme)
    ├── router.tsx           — TanStack Router (2 routes + type-safe search params)
    ├── index.css            — Tailwind imports + CSS variables (light/dark theme)
    ├── vite-env.d.ts        — Vite env type declarations
    ├── pages/
    │   ├── connect.tsx      — Connect page (i18n + form + routing)
    │   └── space.tsx        — Your Memory page (stats + list + detail panel)
    ├── types/
    │   └── memory.ts        — TypeScript type definitions
    ├── api/
    │   ├── client.ts        — mock/real dual-mode API client
    │   ├── queries.ts       — TanStack Query hooks
    │   └── mock-data.ts     — 20 realistic mock memories
    ├── i18n/
    │   ├── index.ts         — i18next setup
    │   └── locales/
    │       ├── zh-CN.json   — Chinese locale
    │       └── en.json      — English locale
    ├── lib/
    │   ├── utils.ts         — cn() helper
    │   ├── time.ts          — Relative time formatting
    │   ├── session.ts       — Space ID session handling
    │   └── theme.ts         — Theme (light/dark/system)
    └── components/
        ├── theme-toggle.tsx — Theme toggle button
        ├── ui/              — shadcn/ui components (button, input, dialog, tabs)
        └── space/           — Business components
            ├── memory-card.tsx   — Memory card
            ├── detail-panel.tsx  — Detail panel
            ├── add-dialog.tsx    — Add memory dialog
            ├── edit-dialog.tsx   — Edit memory dialog
            ├── delete-dialog.tsx — Delete confirmation dialog
            └── empty-state.tsx   — Empty state
```

### Init Commands

```bash
cd dashboard/app

# Install deps
pnpm add react react-dom \
  @tanstack/react-query @tanstack/react-router \
  i18next react-i18next \
  clsx tailwind-merge \
  sonner lucide-react

pnpm add -D typescript @types/react @types/react-dom \
  vite @vitejs/plugin-react \
  tailwindcss @tailwindcss/vite

# Init shadcn/ui
pnpx shadcn@latest init

# Add MVP shadcn components
pnpx shadcn@latest add button input dialog tabs

# Start dev
pnpm dev
```

### Env Vars and Mock Mode

Env vars live in `.env`:

| File | `VITE_USE_MOCK` | Notes |
|------|-----------------|-------|
| `.env` | `true` | Dev default, uses mock data |
| `.env.production` | `false` | Prod build, uses real API |

```bash
# Default mock (.env sets VITE_USE_MOCK=true)
pnpm dev

# Local with real API (via Vite proxy to api.mem9.ai)
VITE_USE_MOCK=false pnpm dev

# Local with custom API
VITE_USE_MOCK=false VITE_API_BASE=http://localhost:8080/v1alpha1/mem9s pnpm dev
```

Mock mode: when `VITE_USE_MOCK === "true"`, mock is used; any other value hits the real API.

| Variable | Default | Notes |
|----------|---------|-------|
| `VITE_USE_MOCK` | `"true"` (dev) / `"false"` (prod) | Mock toggle |
| `VITE_API_BASE` | `/your-memory/api` | API base path, proxied to backend |

### Routes and Search Params

TanStack Router defines two routes:

- `/` → Connect page
- `/space` → Your Memory page

Your Memory page URL search params (type-safe):

- `q` — Search query
- `type` — Memory type (`pinned` | `insight`)

Usage in components:

```tsx
import { getRouteApi } from "@tanstack/react-router";

const route = getRouteApi("/space");

function MyComponent() {
  const { q, type } = route.useSearch();  // type-safe
  const navigate = useNavigate();

  // Update search params (e.g. tab switch)
  navigate({ to: "/space", search: { type: "pinned" } });
}
```

### TanStack Query hooks

```tsx
const { data: stats } = useStats(spaceId);

const { data, fetchNextPage, hasNextPage } = useMemories(spaceId, { q, memory_type });
const memories = data?.pages.flatMap(p => p.memories) ?? [];

const create = useCreateMemory(spaceId);
create.mutate({ content: "...", tags: ["..."] });

const remove = useDeleteMemory(spaceId);
remove.mutate(memoryId);
```

## Task Breakdown

### Phase 0 — Install Deps + Verify Boot (~30min)

- [ ] Run the `pnpm add` commands above to install all deps
- [ ] Run `pnpx shadcn@latest init` to init shadcn
- [ ] Add shadcn components: `button input dialog tabs`
- [ ] `pnpm dev` to verify app boots and both routes work

### Phase 1 — Connect Page UI Polish (~1-2h)

Skeleton is ready (`pages/connect.tsx`) with full logic. Remaining work:

- [ ] Replace native elements with shadcn Button + Input
- [ ] Visual polish: colors, spacing, subtle animation
- [ ] Error state styling (red outline, shake, etc.)
- [ ] Loading state (button spinner)
- [ ] Safety hint visual treatment
- [ ] "How mem9 works" layout and collapse behavior

Acceptance: Any ≥8-char string enters; short ID shows error; language can switch.

### Phase 2 — Your Memory Page UI Polish (~2-3h)

Skeleton is ready (`pages/space.tsx`) with stats, list, detail panel, search. Remaining work:

- [ ] Replace type switcher with shadcn Tabs
- [ ] Memory card visual design
- [ ] Detail panel styling + collapsible advanced fields
- [ ] Stats bar visual design
- [ ] Skeleton loading state
- [ ] Search bar + Add memory button layout

Acceptance: Mock data loads; Tab switching, search, and detail panel work.

### Phase 3 — Management Actions (~1-2h)

- [ ] Add memory Modal (shadcn Dialog: content + tags + save)
- [ ] Use `useCreateMemory` mutation
- [ ] Delete confirmation Dialog
- [ ] Use `useDeleteMemory` mutation
- [ ] Success toast (sonner)
- [ ] Edit flow (Saved by you 🔖 only, if time permits)

Acceptance: Can create and delete memories; list and stats update immediately.

### Phase 4 — State and Edge Cases (~1h)

- [ ] Empty state (0 memories: guidance + first-memory CTA)
- [ ] Search no-results state
- [ ] API error handling (TanStack Query `error` + toast)
- [ ] Session expiry redirect to Connect (`isSessionExpired` + `touchActivity`)
- [ ] Memory info section (when memories exist, collapse to "ℹ️ Learn about memory types")

### Phase 5 — Responsive + Polish (~1-2h)

- [ ] Desktop two-column layout (≥1024px)
- [ ] Tablet: detail overlay from right (768-1023px)
- [ ] Mobile: detail full-screen overlay + back (<768px)
- [ ] Animations and transitions

### Phase 6 — Real API Integration (~1-2h)

- [ ] `VITE_USE_MOCK=false` + `VITE_API_BASE` integration
- [ ] Verify CORS config
- [ ] Verify `bulkCreateMemories` route is registered
- [ ] If `getTenantInfo` exists, enable Option A validation

## Backend Parallel Tasks

| Priority | Task | Effort |
|----------|------|--------|
| P0 | CORS middleware | ~30min |
| P0 | Register `r.Post("/memories/batch", s.bulkCreateMemories)` | 1 line |
| P1 | Register `r.Get("/info", s.getTenantInfo)` | 1 line |
| P1 | Dedicated stats endpoint (can add later) | ~1-2h |

## Cut Line Reference

If time is very tight, cut in this order:

1. Responsive (Phase 5) → Desktop only first
2. Edit flow → Remove from Phase 3
3. Detail panel → Simplify to card expand
4. Stats bar → Only show total count
5. Type tabs → Remove; use icons to distinguish

Must keep: Connect, memory list, search, add, delete, Saved by you (🔖) / Learned from chats (✨) distinction, bilingual, empty state.
