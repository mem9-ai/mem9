---
title: site — Astro frontend
---

## Overview

Astro static site for mem9.ai. This subtree is separate from the Go server and plugin packages.

## Commands

```bash
cd site && npm run dev
cd site && npm run build
cd site && npm run build:netlify
cd site && npm run preview
cd site && npx tsc --noEmit
```

## Where to look

| Task | File |
|------|------|
| Astro config | `astro.config.mjs` |
| Package scripts | `package.json` |
| Netlify site config | `netlify.toml` |
| Combined Netlify build script | `scripts/netlify-build.sh` |
| Shared copy / locale data | `src/content/site.ts` |
| Runtime locale/theme behavior | `src/scripts/site-ui.ts` |
| Layout, fonts, early theme script | `src/layouts/Layout.astro` |
| UI components | `src/components/` |
| Stable onboarding docs | `public/SKILL.md` |

## Local conventions

- TypeScript config extends `astro/tsconfigs/strict`.
- Current content model is centralized in `src/content/site.ts`; copy changes usually belong there, not inline in components.
- Output is static (`output: 'static'`).
- Netlify should keep `site/` as the package directory with the base directory unset. `netlify.toml` still lives here, but its build paths resolve from the repo root so it can build both `site/` and `dashboard/app/`, then copy dashboard assets into `site/dist/your-memory/`.
- Locale and theme state use typed string unions and storage keys defined in `src/content/site.ts`.
- Locale switching is runtime-driven via `data-i18n` attributes plus `src/scripts/site-ui.ts`; new locales usually touch `site.ts`, `site-ui.ts`, and `Layout.astro` together.
- `public/SKILL.md` is served verbatim as onboarding documents.

## Anti-patterns

- Do NOT add app-server assumptions here; this is a static Astro site.
- Do NOT scatter product copy across multiple components when a shared content type already exists.
- Do NOT edit generated `.astro/` artifacts.
- Do NOT assume a linter or test runner exists; verification here is build + `npx tsc --noEmit`.
