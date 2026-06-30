# Session: UI/UX Overhaul — Newspaper Layout

## Goal
Overhaul News Desk UI/UX to a newspaper-style tiling layout with sidebar nav, no animations, new color scheme/fonts, and add a working free AI provider.

## Status: ✅ COMPLETE

## What Was Done

### Layout
- **Sidebar nav**: Icons with hover-reveal labels (160px on hover, 48px collapsed). 8 tabs (Timeline, Battles, Market, Jobs, Politics, Rankings, Community) + Writer redirect + User/Settings at bottom.
- **Topbar**: Clock (JetBrains Mono, HH:MM:SS, left) | News Desk title (Playfair Display, center) | Market stats (avg wage, top wage, trade vol, top item, right).
- **Infobar**: MVI pills (horizontal scroll, live not weekly, with ▲/▼ trends) + live event toast (slot-machine slide animation — MVI scroll pushes down, toast slides in from top, stays 10s, slides out, MVI scroll returns).
- **All tabs**: Content preserved per original layout; tiling with `gap: 0` on all grids (market, rankings), no floating panels.

### Visual Cleanup
- Removed oscilloscope, ECG, nixie clock — all stubbed/cleaned
- No `backdrop-filter`, `box-shadow`, or `border-radius` anywhere in layout
- Flat `border: 1px solid var(--line)` separation throughout
- No gaps between panels — tiling windows manager style
- Undefined CSS vars (`--line-solid`, `--accent-soft`, `--radius-sm`) replaced

### Colors (variables.css)
| Token | Dark | Light |
|-------|------|-------|
| `--bg` | #121212 | #f8f8dc |
| `--ink` | #e6e6e6 | #1C1C1C |
| `--ink-dim` | #b0b0b0 | #666666 |
| `--ink-caption` | #8F8F8F | #888888 |
| `--line` | #303030 | #E5E5E5 |
| `--link` | #6CA8FF | #0057B8 |
| `--link-hover` | #8CC0FF | #004a99 |
| `--entity` | #fffd8c | #989900 |
| `--hl-user` | #fc5728 | #992c00 |

### Fonts (Google Fonts)
- **UI**: Playfair Display
- **Body**: Literata
- **Article**: Atkinson Hyperlegible Next
- **Numbers**: JetBrains Mono
- **Code/tooltips**: Fira Code

### Writer
- Button redirects to `https://lundgrenwarera.github.io/warera-writer/`
- Old `writer.js`/`writer.css` files kept but not loaded in HTML

### Settings Modal
- API Key input (saves to localStorage, triggers data reload on change)
- AI Key input (Gemini `AIza` or Groq `gsk_`)
- SFX Volume slider (moved from user modal)
- Theme toggle (🌙/☀️)
- ⓘ About modal (spec text verbatim)
- "by rooster" link → `https://app.warera.io/user/69bd432766cd740733175da7`

### AI Provider
- `callOpenAI()` auto-detects `gsk_` keys → `api.groq.com/openai/v1` with `llama-3.3-70b-versatile` (free)
- Gemini fallback for `AIza` keys
- Server proxy fallback for configured setups

### Cleanup (dom.js)
Removed all references to: `apiButton`, `themeButton`, `settingsButton`, `nixieDate`, `nixieTime`, `nixieClock`, `writerBtn`, `writerEditor`, `writerTitleInput`, `writerWordCount`, `writerSaveStatus`, `writerToolbar`, `copyWriterHtmlBtn`, `writerDraftsList`, `addDraftBtn`, `aiKeyInput`

### Analytics (previous sessions)
Server-side accumulator on Belmo, analytics engine with histories/datasets/health score/warnings/assessment, pill-toggle views for Market (Overview / Full Analytics / Predictions).

## Fixes Applied

### Session 2 — Analytics visibility, CSS classes, edge cases
- **Analytics was invisible**: `renderExecutiveDashboard()` was rendering HTML but ~30 CSS classes were missing from `layout.css`. Added: `.exec-summary`, `.exec-summary-row`, `.exec-label`, `.exec-value`, `.exec-chart-wrap`, `.exec-chart-svg`, `.exec-legend`, `.exec-legend-item`, `.exec-legend-dot`, `.analytics-card-body`, `.analytics-card-header`, `.market-card-header`, `.market-card-title`, `.analytics-pct`, `.analytics-interp`, `.analytics-warn`, `.analytics-warn-critical`, `.analytics-warn-warning`, `.analytics-warn-info`, `.analytics-warn-icon`, `.analytics-warn-indicator`, `.analytics-warn-reason`, `.analytics-assess-body`, `.analytics-assess-summary`, `.analytics-assess-item`.
- **`.analytics-warn-info` used `var(--blue)`** which didn't exist in `variables.css` → changed to `var(--ink-dim)`.
- **`.market-card-header` missing** → added with flexbox layout.
- **No undefined CSS vars remain** — full audit confirmed all `var(--X)` have matching `--X` definitions.
- **Intro runtime error** (previous): Removed `#introMapCanvas` canvas rendering loop from `intro.js` (element no longer exists).
- **Infobar toast slot-machine** (previous): Added `.infobar.toasting` CSS class.
- **Settings close handler** (previous): Detects API key changes, triggers data reload.
- **`E.themeButton` dead ref** (previous): Removed from `theme.js`, now uses `#themeToggleBtn`.

### Session 4 — Font fix, icon migration Lucide → Iconify, election removal, UI polish
- **Font family fix**: Changed `--font-article` from "Atkinson Hyperlegible Next" (doesn't exist) to "Atkinson Hyperlegible". Added `--font-code: "Fira Code"` and `code, pre, kbd { font-family:var(--font-code) }` base.css.
- **Icon migration Lucide → Iconify**: Replaced all `<i data-lucide="X" class="lu">` with `<iconify-icon icon="mdi:Y" class="lu">` across `index.html` + 6 JS files. Removed Lucide CDN, added Iconify CDN (`jsdelivr`). Removed all `lucide.createIcons()` calls and MutationObserver.
- **Election injection removed from timeline**: Deleted `injectElectionEvents()` from `timeline.js` and all `electionStarted`/`electionEnded` cases from `events.js` type map, buildTitle, buildSummary, buildDetails.
- **UI polish**: Search inputs 24px height aligned; profile modal enriched (country, MU, subscribers); article reader fixed (image overflow, fonts, layout); clock increased to 1rem flex-column with visible date; all buttons use Literata; accent changed to neutral gray (#6a6a6a/#4b4b4b); entity colors applied to `.entity-link`/`.entity-resolving`/`.ec-type`.
- **MVI ticker**: CSS `@keyframes infobar-ticker` on `.infobar-track` for seamless loop; `updateInfobar()` duplicates pills; updates textContent/className in-place (no DOM rebuild) to preserve animation during refreshes.
- **MVI info text**: Added below MVI list explaining Value Score calculation.

### Session 5 — Company & Deposit Concentration (Jobs tab)
- **Pill buttons**: Added `data-job-view` pills to Jobs tab toolbar: Job Market, Company Concentration, Deposit Concentration.
- **Company Concentration**: New `js/jobs/concentration.js` — `loadCompanyConcentration()` fetches companies via `company.getCompanies` (paginated, up to 5 pages × 40), then batch-fetches details via `company.getById` (concurrency=10). Groups by region, resolves region names via `region.getById`, renders as sortable list with production-type breakdown bars (color-coded by type).
- **Deposit Concentration**: `loadDepositConcentration()` fetches `depositDiscovered` events via `event.getEventsPaginated`, sorted by bonus percent descending. Resolves region names, shows deposit type (capitalized), bonus percent (+X%), and remaining days. Filterable by deposit type via `<select>` dropdown.
- **Deposit filter**: Populated with 9 types (petroleum, wood, iron, limestone, grain, lead, coca, fish, livestock) on tab switch and view switch.
- **CSS**: Added `.conc-container`, `.conc-list`, `.conc-row`, `.conc-row-head`, `.conc-bars`, `.conc-pct`, `.conc-pct-fill`, `.conc-deposit-*` classes with color-coded bar segments (red→yellow→green→blue).
- **initJobViews()**: Exported from `jobs.js`, called from `main.js` `bindAll()` — handles pill toggle, container show/hide, lazy loading on first view switch.

### Session 3 — Load more anchoring, analytics DOM structure
- **Analytics section empty DOM**: The `<div class="analytics-section" hidden>` in `index.html:234` was a bare shell with no inner elements. When `loadMarketView("analytics")` found it existing, it skipped creating the inner structure, and `renderExecutiveDashboard()` could not find `.analytics-exec-body` / `.analytics-cards-grid` → no content rendered. Fixed by adding full inner DOM structure to the HTML template.
- **Load more buttons pushed down**: Changed `.tab-panel` from `overflow-y: auto` to `overflow: hidden` so the panel doesn't scroll — only internal containers (`#articleList`/`#eventList`) scroll. Added `flex-shrink: 0` to all non-scrolling children in `.tl-left`/`.tl-right` and `margin-top: auto` to `.btn-load`, keeping buttons anchored at bottom of columns.
- **Assessment at bottom**: Fixed `renderAnalytics.js` to `srv.appendChild(div)` instead of `cardsGrid.after(div)`, ensuring Economic Intelligence Assessment is always the last child of `.analytics-section` (below warnings).
- **Market grid 2×2 → 1×4**: Changed `.market-grid` from `repeat(2, 1fr)` to `repeat(4, 1fr)` and updated `nth-child(even)` to `nth-child(4n)` so the 4 cells sit in one horizontal row.
- **Hidden big load more buttons**: `#loadMoreArticlesButton`, `#loadMoreButton` set to `display: none !important` — the "More" mini buttons in the filter bars serve the same function.
- **Global Events title centered**: Added `.tl-right .panel-head { justify-content: center; }`.
- **Panel-head padding**: Added `padding: 8px 10px; margin: 0` to `.tl-left .panel-head, .tl-right .panel-head` so the "1100 articles loaded" meta text doesn't overflow the right border.
- **feedMeta right-aligned**: Added `margin-left: auto` to `#feedMeta` so "50 shown — 50 loaded" text is right-aligned in the events column.
- **Lucide icons**: Migrated from emoji icons to Lucide CDN (`unpkg.com/lucide@latest`). Added `.lu` CSS class for sizing, `lucide.createIcons()` + MutationObserver in `main.js` for auto-init of dynamic icons. All button icons in sidebar, topbar, modals, and toolbars replaced with corresponding Lucide icons.
