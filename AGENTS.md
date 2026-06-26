# Session: Economic Intelligence Platform

## Goal
Transform the Market tab into an Economic Intelligence Platform with a server-side accumulator for accurate pay-as-you-go totals and a multi-card analytical dashboard.

## Progress

### Done (Session 1 — Server + Analytics Engine)
- **Server-side accumulator** on Belmo (`newsdesk-server-4942.onbelmo.uk`): Node.js Express server polls api2.warera.io directly via POST, cursor-loop pagination with 340ms pacing, in-memory cache. Exposes `GET /api/market-stats` and `GET /api/health`.
- **Cursor-based early-stop (v3)**: `fetchTxPages` filters items within the loop using a 24h cutoff (newest-first), breaks when the window is passed. `MAX_SAFETY_PAGES=5000` as guard only.
- **Verified 24h data**: Wages 552–553K BTC (153K txns), Trade ~2.42M BTC (67K txns), cycle ~10.4 min.
- **analytics.js**: `ensureHistories`, `aggregateDatasets`, `calculatePrimary`, `calculateStats`, `calculateDerived`, `classifyEconomy`, `calculateHealthScore`, `generateWarnings`, `generateAssessment`, `updateHistories` (max 48), `getPrevious`.
- **renderAnalytics.js**: `multiChart` (4-series normalized SVG), `renderExecutiveDashboard`, `card` helper, `miniHistory` wrapper.
- **market.js**: Integrates analytics at end of `loadMarketFull`; `copyMarketReport` extended.
- **state.js**: 7 history arrays. **api.js/constants.js**: `fetchFromServer`, `MARKET_SERVER_URL`.
- **CSS**: Full `analytics-*` suite in `components.css`, responsive grid in `responsive.css`.
- **Push to both repos**.

### Done (Session 2 — Bugfixes + Spec Compliance)
- **Bugfix — momentum 0%**: Moved `updateHistories` out of `calculateAnalytics()` so `copyMarketReport()` gets correct previous values. Caller controls history append.
- **Bugfix — server data didn't reach analytics**: `fetchFromServer` callback (fire-and-forget) re-runs `calculateAnalytics()`, `renderExecutiveDashboard()`, `updateHistories()` with server-enhanced data so Economic Overview + analytics cards are consistent.
- **Bugfix — analytics section invisible** (3 fixes):
  1. Insert target changed from inside `.market-grid` (has `overflow: hidden; height: calc(100% - 56px)`) to after it
  2. Added `overflow-y: auto` to `.tab-panel.active`
  3. Removed `content-visibility: auto` from `.tab-panel` (was skipping off-screen children in active panel)
- **Insert target safe guard** added to `renderExecutiveDashboard`.
- **Bugfix — analytics.js crash line 67**: `calculatePrimary` didn't return `topValuable`, so `calculateDerived` called `.reduce()` on `undefined`. Added `topValuable: d.topValuable` to the return. This was the root cause of all analytics data showing N/A.
- **Bugfix — favicon 404**: `captureReport.js` used absolute path `/assets/icons/favicon-32x32.png` (root-relative) instead of relative path, causing 404 when served from a subdirectory.
- **Spec compliance — Formula + Variables**: Every intelligence card now shows its formula (`F: ...`) and variables used (`V: ...`) in compact `.analytics-meta` lines.
- **Spec compliance — Market Intelligence Score**: Relabeled "Health Score" → "Market Intelligence Score" on executive dashboard.
- **Visual — Glasspane styling**: Analytics cards (`.analytics-card`, `.analytics-exec-card`, `.analytics-assess-card`) now match the four original panels — same `backdrop-filter: blur(14px)`, `rgba(18,24,32,0.72)` bg, box-shadow, hover effect, and the 1px repeating-linear-gradient stripe overlay.
- **Visual — Ubuntu Sans**: `.analytics-meta` now uses `Ubuntu Sans` font to differentiate the intelligence metadata from the main Inter body text.
- **Pill-toggle views**: Added `data-market-view` pill buttons ("Overview" / "Full Analytics") matching the rankings tab pattern. Analytics section is lazy-created on first switch to avoid displacing the four original cells. CSS classes `view-overview` / `view-analytics` toggle `display: none` on `.market-grid` / `.analytics-section`.

### Done (Session 3 — Null data root cause + edge-case hardening)
- **Root cause fix — all analytics data showing N/A**: `calculatePrimary` (line 47) didn't return `topValuable`, causing `calculateDerived` (line 67) to call `.reduce()` on `undefined`. This crashed the entire analytics pipeline — momentum, health score, warnings, assessment — cascading all outputs to null/N/A. Fixed by adding `topValuable: d.topValuable` to the return.
- **favicon 404**: `captureReport.js:5` used root-absolute path `/assets/...` instead of relative `assets/...`; fixed.
- **Edge-case audit**: Confirmed all paths are guarded — `aggregateDatasets` provides `|| []` defaults for every data source; `calculatePrimary` returns null for missing econ; `calculateDerived` returns null for null p/stats; `generateAssessment` has null check; `miniHistory`/`multiChart` handle <2 entry arrays; server callback has `.catch(()=>{})` swallow for unreachable server — initial gateway render is never blocked.
- **Assessment/warning thresholds**: Reviewed current thresholds (price mom >5%, HHI >2500, circulation <30%, etc.) — all match standard economic ranges. No changes needed.
- **Pushed** `2cfa54c`.

### Remaining / Next
1. **Hard-refresh page** and verify analytics section now shows real values instead of N/A (manual test)
2. Verify no console errors (manual test needed)
3. Server-side: consider adding fetch timeout to prevent hung requests on Belmo free tier
4. Consider adding cache-busting header to `fetchFromServer` for always-fresh accumulator data

### Architecture Notes
- **Server URL**: `https://newsdesk-server-4942.onbelmo.uk` (Belmo free tier, auto-deploys from GitHub `master` pushes; latest commit `6437057`)
- **Poll cycle**: `doPoll()` runs on server start, schedules next via `setTimeout` — no overlap. `POLL_INTERVAL_MS=300000` (5 min).
- **API key**: `API_KEY` env var (Belmo dashboard). Required for `x-api-key` header to api2.
- **Analytics**: Runs sync on `S.market` data in state — no fetches inside analytics.js. Refresh fires on market update interval.
- **History cap**: 48 entries (~4 hours at 5-min intervals).
- **Fallback chain**: `fetchFromServer` → gateway (if server 503/timed out). Analytics runs on gateway data; server-enhanced totals overwrite econ fields after response.
- **Data mapping**: Server overwrites `S.market.econ.totalPayroll`, `.tradeVol`, `.wageCount`, `.tradeCount`, `.avgWage`, `.wageMin`, `.wageMax`, `.topOffer` after initial gateway load.
- **`updateHistories`** only runs in the server callback (or timeout fallback), never inside `calculateAnalytics()`, ensuring history entries match displayed analytics values.
- **View switching**: Market tab uses `<button data-market-view>` pills to toggle between "Overview" (four original cells) and "Full Analytics" (intelligence cards). CSS classes `view-overview` / `view-analytics` on `#tab-market` toggle `display: none` via sibling selectors. Analytics section is lazy-created on first switch to "analytics" via `loadMarketView()`. `renderExecutiveDashboard()` no longer auto-creates the section — only updates it if it exists. Server callback guards its render call with `if (document.querySelector(".analytics-section"))`.

### Key Files
| File | Purpose |
|------|---------|
| `newsdesk-server/server.js` | Express + accumulator + cursor pagination with 24h early-stop |
| `newsdesk/js/market/analytics.js` | All analysis/calculation functions |
| `newsdesk/js/market/renderAnalytics.js` | Dashboard, cards (with F/V metadata), warnings, assessment |
| `newsdesk/js/market/market.js` | Entry point — fetches data, runs analytics async pipeline, extended report |
| `newsdesk/js/core/state.js` | State shape (7 history arrays) |
| `newsdesk/js/core/api.js` | `fetchFromServer` with Belmo URL |
| `newsdesk/js/core/constants.js` | `MARKET_SERVER_URL` |
| `newsdesk/css/components.css` | Analytics card/dashboard styles |
| `newsdesk/css/responsive.css` | Responsive grid collapse for analytics |
| `newsdesk/css/base.css` | `.tab-panel.active` overflow-y fix, `content-visibility` removal |
