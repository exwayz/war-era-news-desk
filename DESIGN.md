---
name: War Era News Desk
description: Real-time newsroom dashboard for War Era journalists
colors:
  neutral-bg-dark: "#121212"
  neutral-bg-light: "#f8f8dc"
  neutral-ink-dark: "#e6e6e6"
  neutral-ink-light: "#1C1C1C"
  neutral-dim-dark: "#b0b0b0"
  neutral-dim-light: "#666666"
  neutral-caption-dark: "#8F8F8F"
  neutral-caption-light: "#888888"
  neutral-surface-dark: "#1a1a1a"
  neutral-surface-light: "#f0f0d0"
  neutral-surface-hi-dark: "#242424"
  neutral-surface-hi-light: "#e8e8c8"
  neutral-line-dark: "#303030"
  neutral-line-light: "#E5E5E5"
  accent-dark: "#6a6a6a"
  accent-light: "#4b4b4b"
  red: "#f87171"
  green: "#4ade80"
  blue: "#60a5fa"
  yellow: "#fbbf24"
  purple: "#a78bfa"
  orange: "#fb923c"
  cyan: "#22d3ee"
typography:
  display:
    fontFamily: "Playfair Display, Georgia, 'Times New Roman', serif"
    fontWeight: 700
  body:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontWeight: 400
    lineHeight: 1.6
  article:
    fontFamily: "Atkinson Hyperlegible, Arial, sans-serif"
  mono:
    fontFamily: "JetBrains Mono, 'Courier New', monospace"
  code:
    fontFamily: "Fira Code, 'Courier New', monospace"
rounded:
  none: "0"
spacing:
  xs: "2px"
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
components:
  side-btn:
    backgroundColor: transparent
    textColor: "{colors.neutral-ink-light}"
    padding: "0 12px"
    height: "38px"
  side-btn-active:
    backgroundColor: "{colors.neutral-surface-light}"
    textColor: "{colors.neutral-ink-light}"
  side-btn-hover:
    backgroundColor: "{colors.neutral-surface-light}"
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.neutral-bg-light}"
    padding: "6px 16px"
  market-card:
    backgroundColor: transparent
    border: "1px solid {colors.neutral-line-light}"
    padding: "10px"
---

# Design System: War Era News Desk

## 1. Overview

**Creative North Star: "The Editorial Desk"**

The War Era News Desk reads like a broadsheet newspaper laid out across a monitor — data-dense, typographically hierarchical, and utterly flat. Every element is separated by hairline rules (`1px solid var(--line)`), not shadows or depth. Panels tile edge-to-edge with no gap, like a wire service terminal or a newspaper page. The interface never decorates; it publishes.

This system explicitly rejects: SaaS dashboard tropes (rounded mega-cards, shadow stacks, progress-ring metrics), game-UI aesthetics (themed skins, fantasy flourishes), and any decorative use of color or motion. Color is semantic — red for war/negative, green for economic growth, blue for informational — never cosmetic.

**Key Characteristics:**
- Flat-by-default: zero border-radius, zero box-shadow, zero backdrop-filter
- Newspaper tiling: panels abut with `gap: 0`
- Editorial typography: Playfair Display heads, Literata body, JetBrains Mono for data
- Iconify icons (mdi set) serve as functional markers, not decoration
- Two themes: dark (press room) and light (newsprint)

## 2. Colors

The palette is a restrained neutral system with editorial character. Two themes mirror the newsroom environment: dark mode evokes a dim press room, light mode evokes broadsheet newsprint.

### Dark Theme

- **Press Room** (#121212): Body background. Deep matte black, never pure #000.
- **Body Text** (#e6e6e6): Primary copy. Off-white for comfortable reading.
- **Byline** (#b0b0b0): Secondary copy, meta, timestamps.
- **Caption** (#8F8F8F): Tertiary labels, captions, footnotes.
- **Rule** (#303030): All borders and dividers — 1px solid.
- **Matte Stock** (#1a1a1a): Surface background for hovered/active elements.
- **Highlight Stock** (#242424): Elevated surface for tooltips, modals.
- **Accent** (#6a6a6a): Neutral gray accent for active indicators, selected states.

### Light Theme

- **Newsprint** (#f8f8dc): Body background. Warm off-white, vignette tone.
- **Body Text** (#1C1C1C): Primary copy. Near-black.
- **Byline** (#666666): Secondary copy.
- **Caption** (#888888): Tertiary labels.
- **Rule** (#E5E5E5): All borders and dividers.
- **Paper Stock** (#f0f0d0): Surface background.
- **Highlight Stock** (#e8e8c8): Elevated surface.
- **Accent** (#4b4b4b): Neutral gray accent.

### Semantic Colors

- **Red** (dark #f87171 / light #d32f2f): Combat, war, negative trends, errors.
- **Green** (dark #4ade80 / light #2e7d32): Economic growth, positive trends, healing.
- **Blue** (dark #60a5fa / light #1976d2): Informational, links, neutral indicators.
- **Yellow** (dark #fbbf24 / light #f9a825): Warnings, caution, liquidity indicators.
- **Purple** (dark #a78bfa / light #7c3aed): Rare events, special indicators.
- **Orange** (dark #fb923c / light #e65100): Momentum indicators, rank changes.

### Named Rules

**The Hairline Rule.** All borders are exactly 1px solid var(--line). No 2px+ borders. No colored side-stripes. No borders on three sides leaving the fourth open.

**The Flat Rule.** No border-radius, no box-shadow, no backdrop-filter on any layout element. Buttons, inputs, and cards are rectangles. Separation uses borders and background tints only.

**The Semantic Color Rule.** Color is never cosmetic. Every colored element carries information — red means war/error, green means economy/positive, blue means link/info.

## 3. Typography

**Display Font:** Playfair Display (with Georgia, Times New Roman fallback) — serif, authoritative.
**Body Font:** Literata (with Georgia, Times New Roman fallback) — serif, readable at small sizes.
**Article Font:** Atkinson Hyperlegible (with Arial, sans-serif fallback) — optimized for extended reading.
**Mono Font:** JetBrains Mono (with Courier New fallback) — all numbers, currency, quantities, timestamps.
**Code Font:** Fira Code (with Courier New fallback) — code blocks, tooltips, technical labels.

**Character:** The pairing is editorial-first. Playfair Display gives headings a newspaper gravitas; Literata carries long-form body at small sizes with excellent readability. JetBrains Mono is reserved exclusively for data — prices, quantities, timestamps, IDs — creating a clear typographic signal that "this is a number, not prose."

### Hierarchy

- **Display** (Playfair Display, 700, 1.1rem–1.4rem): Tab titles, panel headings.
- **Headline** (Playfair Display, 600, 1.0rem): Card titles, section headers.
- **Title** (Literata, 600, 0.88rem): Card sub-titles, entity names.
- **Body** (Literata, 400, 0.82rem–0.88rem, 1.6 line-height): Article text, descriptions. Cap line length at 75ch.
- **Label** (Literata, 600, 0.64rem, 0.04em letter-spacing, uppercase): Stat labels, meta text, badges.
- **Mono** (JetBrains Mono, 400–800, 0.7rem–0.88rem): All numbers, prices, IDs, timestamps, quantities.

## 4. Elevation

The system is strictly flat. Depth is not conveyed through shadows or blur — it is conveyed through:
- **Border lines** (`1px solid var(--line)`) that separate adjacent panels
- **Background tints** (`var(--surface)`) that distinguish active/hover states from resting state
- **Text contrast** (var(--ink-dim) vs var(--ink)) that establishes reading hierarchy

There are zero box-shadows, zero backdrop-filters, and zero z-index values above 100 in the entire codebase.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. No shadows on cards, panels, tooltips, or modals. The layout encodes depth exclusively through 1px borders and background tint transitions.

## 5. Components

### Sidebar Buttons

- **Shape:** Rectangular, 0 radius.
- **Default:** Transparent background, 2px transparent left border.
- **Active:** `var(--surface)` background, 2px `var(--accent)` left border.
- **Hover:** `var(--surface)` background.
- **Size:** 38px tall, 48px sidebar width collapsed, 140px on hover.
- **Icons:** 1rem Iconify mdi icons, centered in 24px box.

### Market Cards

- **Shape:** Rectangular, 0 radius, `1px solid var(--line)` full border.
- **Background:** Transparent (parent bg shows through).
- **Title:** Playfair Display 600.
- **Padding:** 10px internal.

### Event / Article / Battle Cards

- **Shape:** Rectangular, 0 radius.
- **Border:** `1px solid var(--line)` on bottom or full border depending on layout context.
- **Background:** Transparent.
- **Content:** Flex-row layouts with label/value pairs.

### Buttons (action)

- **Shape:** Rectangular, 0 radius.
- **Primary:** `var(--accent)` background, `var(--bg)` text.
- **Secondary:** Transparent background, `1px solid var(--line)` border, `var(--ink)` text.
- **Pill/Tab:** Transparent, active state uses `var(--ink)` text + underline or background toggle.
- **Size:** 24–32px tall for inline, 38px for toolbar.

### Inputs / Fields

- **Shape:** Rectangular, 0 radius.
- **Border:** `1px solid var(--line)`.
- **Background:** Transparent.
- **Typography:** Literata 0.82rem.
- **Focus:** No ring, no glow — background shifts to `var(--surface)`.

### Topbar Stats

- **Layout:** Flex row, space-between.
- **Value:** JetBrains Mono 800, 0.88rem.
- **Label:** Literata 600, 0.64rem uppercase.

## 6. Do's and Don'ts

### Do:
- **Do** tile panels with `gap: 0` so they abut like newspaper columns.
- **Do** use `1px solid var(--line)` borders to separate everything.
- **Do** use JetBrains Mono for all numbers, prices, quantities, and timestamps.
- **Do** use Playfair Display for all headings.
- **Do** use color semantically — red for war/negative, green for economy, blue for info.
- **Do** respect prefers-reduced-motion: no essential content gated on animation.

### Don't:
- **Don't** use border-radius anywhere on layout elements — keep all corners square.
- **Don't** use backdrop-filter, box-shadow, or gradient backgrounds.
- **Don't** use game-UI aesthetics — this is a tool, not part of War Era.
- **Don't** use SaaS clichés — no rounded mega-cards, ghost shadows, hero-metric templates, or stacked dashboard pattern.
- **Don't** use decorative color — every colored element must carry information.
- **Don't** use Lucide icons — the project migrated to Iconify (mdi set).
- **Don't** use Inter or system sans-serif for UI text — the font stack is editorial serif-first.
- **Don't** pair two similar fonts — every pairing has contrast (serif headline + serif body is deliberate, but add distinct weights; never two geometric sans-serifs).
