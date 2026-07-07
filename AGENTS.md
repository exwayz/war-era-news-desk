# AGENTS.md — War Era News Desk

## Dev Server
```
npm run dev            # Vite dev on port 8023 (HMR, strict port)
npm run build          # Production build to dist/
npm run preview        # Preview production build
node explorer-server.cjs  # Endpoint explorer on port 8021 (separate tool)
```
Node 20 (`.node-version`), Vite 8 (sole dependency). No test runner, linter, or typechecker.

## Deploy (GitHub Pages)
Base path is `/war-era-news-desk/` (set in `vite.config.js`).
Push to `main` → CI (`.github/workflows/deploy.yml`) runs `npm ci && npm run build` and uploads `dist/` to GH Pages.

## Boot Flow
`index.html` → `js/main.js` (type="module")
`initIntro(init)` → splash overlay w/ API key prompt → `init()` → `bootData()`
`bootData()` fires: `loadEvents(true)`, `loadArticles(true)`, `startAutoRefresh()`, `loadMarketStats()`, `loadMarketFull(false)`, `loadJobs()`, `loadFeatured()`

## Refresh Intervals
| Interval | What |
|----------|------|
| 30s | Timeline auto-refresh + infobar stats |
| 10s | Market prices/orders (calls `loadMarketFull(false)`) |
| 5min | Featured articles carousel |

## Architecture
- **Vanilla JS ES modules** — single-page app
- `js/core/state.js`: global mutable singleton `S` (never destructure — passed by ref)
- `js/core/dom.js`: element references in `E` object (queried at module init — DOM must exist)
- `js/core/storage.js`: localStorage keys — `STORE = { apiKey:"wa-nd-apikey", theme:"wa-nd-theme", userProfile:"wa-nd-user-profile" }`
- **7 tabs** (timeline, battles, market, jobs, politics, rankings, community) switched via sidebar `.side-btn[data-tab]` → `js/ui/tabs.js:switchTab()`. A separate `#writerRedirect` button opens an external URL (WarEra Writer).
- Templates: `#eventCardTemplate`, `#articleCardTemplate`, `#battleCardTemplate` in `index.html`, cloned via `<template>.content.firstElementChild.cloneNode(true)`

## CSS Load Order (7 files)
`variables.css` → `base.css` → `layout.css` → `intro.css` → `responsive.css` → `rankings.css` → `politics.css`

## Design Conventions
- **No `border-radius`, `backdrop-filter`, or `box-shadow`** — flat newspaper tiling
- Icons: **Iconify** (`<iconify-icon icon="mdi:X">`) — NOT Lucide
- Fonts: Playfair Display (UI), Literata (body), Atkinson Hyperlegible (articles), JetBrains Mono (numbers), Fira Code (code)
- CSS vars in `variables.css`: `--bg`, `--ink`, `--ink-dim`, `--line`, `--accent`, `--surface` etc.
- Theme: `[data-theme="dark"]` / `[data-theme="light"]` on `<html>`

## API
| Endpoint | Auth header | Function |
|----------|-------------|----------|
| `gateway.warerastats.io/trpc` | `x-api-key` | Primary — `fetchTrpc()`, 3 retries |
| `api2.warera.io/trpc` | `X-API-Key` | Fallback — `fetchTrpcApi2()` |
| `api5.warera.io/trpc` | `Authorization: Bearer` | Alternative — `fetchTrpcApi5()` |
| `newsdesk-server-4942.onbelmo.uk` | — | Market cache proxy — `fetchFromServer()` |
| `market-server.exwayz.deno.net` | — | Direct market data |

- **api2 returns 401 for `transaction.*` endpoints** — do NOT fall back to api2 for tx pagination
- Market data fetches direct from game API (bypasses proxies)
- Community wall talks **Supabase REST API directly** (`bfxyhxjlbrfavuzoljvs.supabase.co/rest/v1/messages`) — no SDK, no backend. Uses `SUPABASE_ANON_KEY` as bearer.
- Entity resolution on demand via `js/core/resolver.js`; bulk country/region preload via `js/timeline/filters.js:ensureLookups(k)`

## Tab Loading (lazy)
Each tab loads data on first visit via `switchTab()` in `tabs.js`:
- `battles`: if `S.battles.length===0` → `loadBattles(true)`
- `market`: if `!S.market.prices` → `loadMarketFull()`
- `jobs`: if `S.jobs.length===0` → `loadJobs(true)` + `populateDepositFilter()`
- `rankings`: always reloads via `loadCategory()`
- `politics`: always reloads via `loadPolitics()`
- `community`: always reloads via `loadMessages()`

## Stateful Gotchas
- `S.lookupsKey` guards `ensureLookups()` — must reset to `""` before re-fetching on API key change
- `_trueTxFired` guard in `api.js` prevents re-firing TrueAmount (2000-page tx fetch) on periodic refresh
- Market 10s refresh interval calls `loadMarketFull(false)` — cold start re-fetches prices/orders but only fires TrueAmount once
- Battle name falls back to short ID when country/region lookups are stale — call `ensureLookups()` first if names show hex slugs
- `loadEvents()` calls `ensureLookups()` — other tabs may render before lookups populate

## Key Files
| File | Purpose |
|------|---------|
| `js/main.js` | Entrypoint, boot, event bindings, refresh intervals |
| `js/core/api.js` | All API calls, retry logic, tiered tx data (true/lite/cold) |
| `js/core/constants.js` | API URLs, Supabase keys, event type list |
| `js/timeline/filters.js` | `ensureLookups(k)` — preloads all countries/regions |
| `js/market/market.js` | `loadMarketFull()` — economics, prices, orders, MVI |
| `js/battles/battles.js` | `loadBattles()`, `makeBattleCard()` |
| `js/battles/companies.js` | Name resolution: `nameCountry()`, `nameRegion()`, `nameUser()` |
| `js/community/wall.js` | Community wall — Supabase REST, post/upvote/paginate |
