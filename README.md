# War Era News Desk

A real-time newsroom dashboard for War Era journalists. It monitors the game's global events, wars, battles, economy, politics, jobs, and articles through an intelligent, human-readable interface — built on the War Era API.

Live at **https://exwayz.github.io/war-era-news-desk/**

---

## Why this exists

War Era generates a lot of data: events, battles, market movements, government changes. The raw API is a wall of JSON. This desk turns that firehose into something a journalist can actually read — event summaries written like headlines, battle damage reports, market momentum analytics, and copy/paste-ready briefs.

The whole app is vanilla HTML/CSS/JS with no framework and no build-time dependencies beyond Vite. It runs in your browser and talks directly to the War Era API using your own API key.

## Getting started

1. Open the app (deployed link above, or `npm run dev` locally).
2. Click the key button and paste your War Era API key (`wae_...`).
3. The key is stored only in your browser's `localStorage` — nothing is sent to any third-party server except the War Era API itself (and an opt-in community wall backend).

```
npm install
npm run dev      # local dev server on :8023
npm run build    # production build to dist/
```

## Modules

| Module | What it does |
| --- | --- |
| **Timeline** | Real-time global events feed with auto-refresh, country/type/date filters, and journalist-style summaries (`France declared war on Germany`). |
| **Battles** | Ongoing and ended battle monitoring, attacker/defender rankings (damage + ground points, by user/MU/country), per-round progress, win-score indicator, XLS export. |
| **Market** | 24h economic overview (wages, payroll, trade volume), commodity prices, recent orders, most-valuable items, executive analytics dashboard with momentum indicators, trend predictions, production cost studio, and a live commodity signal engine with fully sortable signals. |
| **Jobs** | Job market tracker with net-wage handling, boss metadata, skill/slot details, company links, regional concentration maps, and deposit tracking. |
| **Politics** | Country-by-country government, parties, elections, congress, and an AI-assisted political summary generator. |
| **Rankings** | Weekly / user / MU / country / alliance leaderboards with avatars and flags. |
| **Community** | Opt-in community wall backed by a Supabase + Cloudflare Workers backend (posts, upvotes, rate limits). |
| **Library** | Searchable index of War Era articles with a full reader mode and bookmarks. |
| **Typewriter** | TipTap-compatible article editor with @mention entity chips, image library, paste-URL auto-resolution, line gutter, custom color picker, and drafts. |
| **Table Maker** | Two tools in one: convert pasted text into a styled table, then fine-tune it visually in the Table Drawer (canvas grid, resize/format toolbar, zoom) before exporting as HTML, Markdown, PNG, or a library image. |

### Cross-cutting features

- **Intelligence rendering** — raw payloads are turned into readable sentences instead of dumped as JSON.
- **Entity resolution** — IDs auto-resolve to country/region/user/MU/battle names, with an offline lookup fallback.
- **Reports** — every module has *Copy Report* and PNG capture actions, backed by a unified capture picker/store with multi-page PNGs and optional Image Library upload.
- **Mentionable links** — profiles, battles, and countries expose one-click *copy mentionable URL* buttons for embedding in articles.
- **Profile highlighter** — register your character; your username, MU, country, and party get highlighted across rankings, battles, and articles.
- **Audio** — context-sensitive SFX (read, copy, capture, click) with a volume control.
- **Themes** — light/dark toggle plus an optional paper-texture mode.
- **Privacy** — no tracking, no analytics, no third-party scripts (except html2canvas for captures, Imgur for image uploads, and iconify for icons).

## Tech stack

- Vanilla ES modules, HTML5 templates, CSS custom properties
- [Vite](https://vitejs.dev) for dev server + production build
- War Era TRPC API (`gateway.warerastats.io`, `api2.warera.io`) with multi-endpoint fallback
- TipTap-compatible rich-text editor (`js/jotter`) with TipTap-compatible serialization
- html2canvas for PNG report capture
- Imgur for editor/image-library image uploads
- Supabase (community wall) behind a Cloudflare Worker

## Project layout

```
js/
  core/        api, captureReport, constants, dom, imageUpload, profileHighlighter,
               regionClassification, resolver, state, storage, utils
  timeline/    timeline, articles, events, filters, featured
  battles/     battles, battleDetail, companies, bounty
  market/      market, analytics, marketHistory, predictions, signals,
               production, renderAnalytics, renderPredictions, renderSignals,
               renderStudio, itemHistory
  jobs/        jobs, concentration
  politics/    politics
  rankings/    rankings
  library/     library, libraryStore, bookmarks
  jotter/      jotter, serialize
  tablemaker/  tablemaker, tableDrawer, exporters
  studio/      studio
  pinned/      guideArticle
  community/   wall, policy
  user/        profile, profileHighlighter
  ui/          changelog, tabs, theme, toast, tooltip, imageViewer,
               readerHighlight, readerNav, readerZoom
  visuals/     clock, oscilloscope
  audio/       audio
  intro/       intro
css/           variables, base, layout, components, visuals, intro, responsive
data/          offlineLookups.js (static name fallbacks)
index.html     single page shell
vite.config.js build config
```

## Documentation

- [CHANGELOG](CHANGELOG) — full version history.
- [LICENSE](LICENSE) — MIT.

## Credits

- Data source: [War Era](https://app.warera.io) API.
- Built for War Era journalists and newsrooms.
