# Site SEO/GEO Design

## Goal

Improve discoverability for `mem9.ai` without turning the site into thin-content SEO spam.

## Chosen approach

Use the approved `B` path:

1. Strengthen technical SEO and GEO primitives.
2. Expand the homepage with semantic sections that match real search intent.
3. Keep the implementation maintainable inside the current Astro single-page site.

## Problems found

1. The site only exposes basic `title`, `description`, canonical, and Open Graph tags.
2. There is no structured data, sitemap, robots policy, or LLM-oriented site summary.
3. The homepage copy is strong for branded traffic, but it does not clearly capture broader intent such as:
   - `AI agent memory`
   - `Claude Code memory`
   - `OpenClaw memory`
   - `persistent memory for agents`
   - `long-term memory for coding agents`
   - `context engineering`
   - `MCP memory backend`
4. The current homepage does not explain product positioning well enough for search engines or LLM summarizers.

## Design

### Technical SEO/GEO

- Extend `<head>` with stronger metadata:
  - robots directives
  - Twitter cards
  - Open Graph image
  - keywords
  - `llms.txt` discovery link
- Add JSON-LD for:
  - `Organization`
  - `WebSite`
  - `SoftwareApplication`
  - `FAQPage`
- Add `robots.txt` and `sitemap.xml`.
- Add `llms.txt` and `llms-full.txt` for LLM-oriented summarization and retrieval.

### Homepage semantic expansion

Add three compact sections:

1. `Positioning`
   - Clearly states what mem9 is.
   - Includes machine-readable fact bullets.
   - Includes exact search phrases users commonly use.

2. `Use cases`
   - Maps product capability to high-intent queries:
     - Claude Code memory
     - OpenClaw memory
     - OpenCode memory
     - shared multi-agent memory
     - MCP/custom tool backend
     - context engineering workflows

3. `FAQ`
   - Answers search-style questions directly.
   - Reused for visible content and FAQ JSON-LD.

### Content model

- Keep existing site copy model intact.
- Add a dedicated `discoverability` content file so new SEO/GEO copy does not bloat the main site dictionary further.
- Update client-side i18n lookup so new sections still respond to locale switching.

## Non-goals

- No content farm with many thin landing pages.
- No fake compatibility claims.
- No dependency additions for SEO wrappers.

## Verification

- `cd site && npm run build`
- `cd site && npx tsc --noEmit`
