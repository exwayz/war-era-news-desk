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
| **Market** | 24h economic overview (wages, payroll, trade volume), commodity prices, recent orders, most-valuable items, executive analytics dashboard with momentum indicators, trend predictions, production cost studio, and a live commodity signal engine. |
| **Jobs** | Job market tracker with wage/skill/slot details, company links, regional concentration maps, and deposit tracking. |
| **Politics** | Country-by-country government, parties, elections, congress, and an AI-assisted political summary generator. |
| **Rankings** | Weekly / user / MU / country / alliance leaderboards with avatars and flags. |
| **Community** | Opt-in community wall backed by a Supabase + Cloudflare Workers backend (posts, upvotes, rate limits). |
| **Library** | Searchable index of War Era articles with a full reader mode. |
| **Writer** | Quill-based article editor with @mention entity search, image library, paste-URL auto-resolution, and drafts. |
| **Table Maker** | Build custom tables from your data. |

### Cross-cutting features

- **Intelligence rendering** — raw payloads are turned into readable sentences instead of dumped as JSON.
- **Entity resolution** — IDs auto-resolve to country/region/user/MU/battle names, with an offline lookup fallback.
- **Reports** — every module has *Copy Report* and PNG capture actions for embedding in articles or Slack.
- **Profile highlighter** — register your character; your username, MU, country, and party get highlighted across rankings, battles, and articles.
- **Audio** — context-sensitive SFX (read, copy, capture, click) with a volume control.
- **Themes** — light/dark toggle plus an optional paper-texture mode.
- **Privacy** — no tracking, no analytics, no third-party scripts (except html2canvas for captures and iconify for icons).

## Tech stack

- Vanilla ES modules, HTML5 templates, CSS custom properties
- [Vite](https://vitejs.dev) for dev server + production build
- War Era TRPC API (`gateway.warerastats.io`, `api2.warera.io`) with multi-endpoint fallback
- html2canvas for PNG report capture
- Quill 1.3.6 for the writer editor
- Supabase (community wall) behind a Cloudflare Worker

## Project layout

```
js/
  core/        api, constants, dom, resolver, state, storage, utils
  timeline/    timeline, articles, events, filters, featured
  battles/     battles, battleDetail, companies
  market/      market, analytics, marketHistory, predictions, signals,
               production, renderStudio, itemHistory
  jobs/        jobs, concentration
  politics/    politics
  rankings/    rankings
  library/     library
  writer/      writer
  tablemaker/  tablemaker
  community/   wall, policy
  user/        profile, profileHighlighter
  ui/          tabs, toast, theme
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
