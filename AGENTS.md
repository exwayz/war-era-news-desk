# AGENTS.md — War Era News Desk

## Dev Server
```
npm start          # node server.js on port 8023
```
Static file server only. `file://` blocks CORS — always serve over HTTP.

## Architecture
- **Vanilla JS (ES modules)**, HTML5, CSS3 — no framework, no bundler
- Single-page app: `index.html` → `js/main.js` (type="module")
- CSS load order: `variables.css` → `base.css` → `layout.css` → `intro.css` → `responsive.css` → `rankings.css` → `politics.css`
- Tab-based SPA: 8 tabs (timeline, battles, market, jobs, politics, rankings, community), switched via sidebar `.side-btn[data-tab]` → `js/ui/tabs.js:switchTab()`
- `js/core/state.js`: global mutable singleton `S` (never destructure — passed by ref)
- `js/core/dom.js`: element references in `E` object (queried at module init — DOM must exist first)
- `js/core/storage.js`: localStorage keys in `STORE`
- Templates: `#eventCardTemplate`, `#articleCardTemplate`, `#battleCardTemplate` in index.html, cloned via `<template>.content.firstElementChild.cloneNode(true)`

## API
- **Primary**: `https://gateway.warerastats.io/trpc` — `fetchTrpc()` with 3 retries, `x-api-key` header
- **Fallback**: `https://api2.warera.io/trpc` — `fetchTrpcApi2()`, `X-API-Key` header
- **api2 returns 401 for `transaction.*` endpoints** — do NOT fall back to api2 for tx pagination
- Market data fetches direct from game API (bypasses all server proxies)
- Entity resolution on demand via `js/core/resolver.js`; bulk country/region preload via `js/timeline/filters.js:ensureLookups(k)`

## Stateful Gotchas
- `S.lookupsKey` guards `ensureLookups()` — must reset to `""` before re-fetching on API key change
- `_trueTxFired` guard in `api.js` prevents re-firing TrueAmount (2000-page tx fetch) on periodic refresh
- Market 10s refresh interval calls `loadMarketFull(false)` — cold start re-fetches prices/orders but only fires TrueAmount once
- Battle name falls back to short ID when country/region lookups are stale — call `ensureLookups()` first if names show hex slugs
- `loadEvents()` calls `ensureLookups()` — other tabs may render before lookups populate

## Design Conventions
- **No `border-radius`, `backdrop-filter`, or `box-shadow`** on layout — flat newspaper tiling
- Icons: **Iconify** (`<iconify-icon icon="mdi:X">`) — NOT Lucide (migrated, old CDN removed)
- Fonts: Playfair Display (UI), Literata (body), Atkinson Hyperlegible (articles), JetBrains Mono (numbers), Fira Code (code)
- CSS vars in `variables.css`: `--bg`, `--ink`, `--ink-dim`, `--line`, `--accent`, `--surface` etc.
- Theme: `[data-theme="dark"]` / `[data-theme="light"]` on `<html>`

## Key Files
| File | Purpose |
|------|---------|
| `js/main.js` | Entrypoint, boot, event bindings, refresh intervals |
| `js/core/api.js` | All API calls, retry logic, tiered tx data |
| `js/core/constants.js` | API URLs, Supabase keys, event type list |
| `js/timeline/filters.js` | `ensureLookups(k)` — preloads all countries/regions |
| `js/market/market.js` | `loadMarketFull()` — Group A (prices/orders/MVI), Group B (economic overview) |
| `js/battles/battles.js` | `loadBattles()`, `makeBattleCard()` — uses `nameCountry()`/`nameRegion()` |
| `js/battles/companies.js` | Name resolution fns: `nameCountry()`, `nameRegion()`, `nameUser()` |

## Tab Loading (lazy)
Each tab loads data on first visit via `switchTab()` in `tabs.js`:
- `battles`: if `S.battles.length===0` → `loadBattles(true)`
- `market`: if `!S.market.prices` → `loadMarketFull()`
- `jobs`: if `S.jobs.length===0` → `loadJobs(true)` + `populateDepositFilter()`
- `rankings`: always reloads via `loadCategory()`
- `politics`: always reloads via `loadPolitics()`
- `community`: always reloads via `loadMessages()`

## No Test/Lint/Typecheck
No test runner, linter, or typechecker configured. Verify by running the dev server and checking browser console.
