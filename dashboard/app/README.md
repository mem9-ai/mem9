# mem9 Dashboard App

## Setup

```bash
cd dashboard/app
pnpm install
pnpm dev
```

## Environment Variables

Managed via `.env` files (`.env` for development, `.env.production` for builds):

| Variable | Dev Default | Prod Default | Description |
|----------|-------------|--------------|-------------|
| `VITE_USE_MOCK` | `"true"` | `"false"` | `"true"` enables mock data; anything else uses real API |
| `VITE_API_BASE` | `/your-memory/api` | `/your-memory/api` | API base path (proxied to backend) |

```bash
# Default: mock mode (VITE_USE_MOCK=true from .env)
pnpm dev

# Real API via Vite proxy to api.mem9.ai
VITE_USE_MOCK=false pnpm dev

# Real API via custom backend
VITE_USE_MOCK=false VITE_API_BASE=http://localhost:8080/v1alpha1/mem9s pnpm dev
```

## API Proxy

The frontend never makes cross-origin requests. All API calls go through a same-origin proxy:

| Environment | Proxy | Frontend Path | Backend Target |
|-------------|-------|---------------|----------------|
| Dev | Vite dev server | `/your-memory/api/...` | `https://api.mem9.ai/v1alpha1/mem9s/...` |
| Prod | Netlify rewrite | `/your-memory/api/...` | `https://api.mem9.ai/v1alpha1/mem9s/...` |

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
│   ├── client.ts           — Mock/real API client
│   ├── queries.ts          — TanStack Query hooks
│   └── mock-data.ts        — 20 mock memories
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
