# War Era News Editor — Reverse Engineering Reference

> Reverse-engineered from the live app at `app.warera.io/news/write` and
> `app.warera.io/article/...`, plus API introspection. Build ID: `yVRyqtDp5xF7SkNL4MYdm`.

---

## 1. Platform Overview

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js** — static export (`nextExport: true`), fully client-side rendered |
| Rich-text editor | **TipTap** (ProseMirror-based) — mounted after JS hydration |
| Styling | **StyleX / CSS-in-JS** — hashed class names (`_1dnmndy*` prefix) |
| API transport | **tRPC** over HTTP batch link (POST, max batch 50) |
| API servers | 5 load-balanced endpoints (api2–api6 `.warera.io/trpc`) |
| Auth | Cookie-based (sent via `credentials: "include"`) + `x-api-key` header fallback |
| Image hosting | `media.warera.io` (upload endpoint: `POST /images/upload/article-image`) |
| CDN/Protection | Cloudflare |

The editor page (`/news/write`) is a **client-side-only shell** — the server-sent HTML contains only a decorative SVG background and the `#__next` mount point. All editor code is in deferred JS chunks:

```
pages/news/write-ba2ab174151fe249.js   ← editor page bundle
pages/article-3f5d914bc81a01a3.js      ← article viewer page bundle
```

`__NEXT_DATA__` has empty `pageProps: {}` — the article ID is extracted from the URL
client-side via `useRouter()`.

---

## 2. TipTap Editor Extensions

The editor loads these TipTap extensions (identified from the article page renderer bundle):

| Extension | Class / Marker | Purpose |
|-----------|---------------|---------|
| **StarterKit** | `tiptap-block` (paragraph), `tiptap-blockquote`, `tiptap-code` | Core blocks: headings 1–6, paragraph, blockquote, code, lists, hard break |
| **Image** | `tiptap-image` | Image upload (drag/paste), hosted on `media.warera.io` |
| **Youtube** | `tiptap-youtube` | Embedded YouTube (320×240) |
| **TikTok** | *(custom)* | Embedded TikTok (325×580) |
| **Collapsible** | `tiptap-collapsible` (`<details>`) | Collapsible/accordion sections |
| **CollapsibleSummary** | `tiptap-collapsible-summary` (`<summary>`) | Collapsible header |
| **CollapsibleBody** | `tiptap-collapsible-body`, `tiptap-collapsible-body-inner`, `tiptap-collapsible-body-content` | Collapsible body wrapper |
| **ContentLink** | `data-content-link`, `data-content-type`, `data-content-data` | **Entity mention system** (see §3) |
| **Link** | `tiptap-link` | External/internal links |
| **Highlight** | — | Text highlighting (with HTML support) |
| **TextAlign** | — | Text alignment for headings + paragraphs |
| **FontFamily** | — | Font family selector |
| **Color** | — | Text color |
| **TextStyle** | — | Inline text style (needed for Color/FontFamily) |
| **MathFormula** | — | LaTeX math (`$formula$` syntax) |

---

## 3. The ContentLink Entity System (Key Finding)

This is the core mechanism that makes `/user/xxx`, `/article/xxx`, etc. resolve into
rich entity badges inside article content.

### 3.1 Storage Format

Entities are stored as **atomic inline `<span>` elements** inside the TipTap HTML:

```html
<span
  data-content-link=""
  data-content-type="user"
  data-content-data="{&quot;userId&quot;:&quot;69bd432766cd740733175da7&quot;,&quot;fullMatch&quot;:&quot;/user/69bd432766cd740733175da7&quot;}"
  data-original-text="/user/69bd432766cd740733175da7"
></span>
```

| Attribute | Purpose |
|-----------|---------|
| `data-content-link="" | Marker attribute (empty) — tells TipTap this is a ContentLink node |
| `data-content-type` | Entity type (see §3.2) |
| `data-content-data` | JSON-encoded object with entity ID + original match text |
| `data-original-text` | The raw text the user typed (e.g., `/battle/6a88dd3fe1208663ba7e4521`) |

### 3.2 All 14 Entity Types

| # | Type | Regex Pattern | Data Fields | Example |
|---|------|---------------|-------------|---------|
| 1 | `text` | *(plain text)* | `originalText` | Fallback — no link |
| 2 | `image` | `https://[domain]/[path].gif` (klipy.com) | `url` | GIF image preview |
| 3 | `article` | `/article/([a-zA-Z0-9_-]+)` | `articleId`, `fullMatch` | `/article/6a89db0ae3e38ec6655f14a3` |
| 4 | `user` | `/user/([a-f0-9]{24})` or full URL | `userId`, `fullMatch` | `/user/69bd432766cd740733175da7` |
| 5 | `country` | `/country/([a-zA-Z0-9_-]+)` | `countryId`, `fullMatch` | `/country/6813b6d546e731854c7ac829` |
| 6 | `region` | `/region/([a-zA-Z0-9_-]+)` | `regionId`, `fullMatch` | |
| 7 | `battle` | `/battle/([a-zA-Z0-9_-]+)` | `battleId`, `fullMatch` | `/battle/6a88dd3fe1208663ba7e4521` |
| 8 | `alliance` | `/alliance/([a-zA-Z0-9_-]+)` | `allianceId`, `fullMatch` | |
| 9 | `mu` | `/mu/([a-zA-Z0-9_-]+)` | `muId`, `fullMatch` | Military Unit |
| 10 | `party` | `/party/([a-zA-Z0-9_-]+)` | `partyId`, `fullMatch` | |
| 11 | `company` | `/company/([a-zA-Z0-9_-]+)` | `companyId`, `fullMatch` | |
| 12 | `userMention` | `@([a-f0-9]{24} or username)` | `userId`, `fullMatch` | `@roostre` |
| 13 | `channelMention` | `#(channelTag)` | `tag`, `fullMatch` | |
| 14 | `emote` | `:([a-zA-Z0-9_-]+):` | `emoteName`, `fullMatch` | Premium only |

### 3.3 Auto-Detection (Paste/Input)

The editor has a function (module `N`) that **scans all text nodes** on paste/input and
auto-converts URL patterns into ContentLink nodes using the regex table above. Authors
don't need to do anything special — typing `/user/xxx` or pasting
`https://app.warera.io/article/xxx` automatically creates the entity.

### 3.4 Rendering (Read-Only Mode)

When the article is viewed, TipTap runs in **read-only mode**. The ContentLink extension:

1. Finds every `<span data-content-link>` element
2. Parses `data-content-data` JSON → `{type, originalText, data}`
3. Looks up the matching **renderer component** from a renderer map:

| Type | Renderer Component |
|------|-------------------|
| `user` | `<UserLink userId={...} withFlag withAvatar />` — avatar + name + flag |
| `article` | Article link card |
| `country` | Country badge |
| `battle` | Battle component |
| `alliance` | Alliance component |
| `mu` | Military Unit component |
| `company` | Company component |
| `party` | Party component |
| `userMention` | `<UserLink>` if resolved, else plain text |
| `channelMention` | Clickable `#channel` with join dialog |
| `emote` | Emote image (premium only) |
| `image` | GIF preview component |

4. Falls back to plain `<span>{originalText}</span>` if the type isn't recognized

**Key difference from our newsdesk**: The War Era app renders entities as **rich React
components** (avatar badges, cards, etc.) inside TipTap's node view system. Our
`resolveContentLinks` renders them as **simple `<a>` links**.

### 3.5 The "Mentionable URL" Format

The **mentionable URL** is the path slug that, when pasted into the editor, auto-resolves
into an entity:

```
/article/{articleId}     → article mention
/user/{userId}           → user mention
/country/{countryId}     → country mention
/battle/{battleId}       → battle mention
/company/{companyId}     → company mention
/mu/{muId}               → military unit mention
/alliance/{allianceId}   → alliance mention
/party/{partyId}         → party mention
/region/{regionId}       → region mention
```

The full URL (`https://app.warera.io/article/xxx`) also works — the regex captures
the path portion.

---

## 4. Article Storage Format (API)

The `article.getArticleById` endpoint returns:

```json
{
  "_id": "6a89db0ae3e38ec6655f14a3",
  "title": "Bangladesh Gov Letter: Some Thank Yous Are In Order",
  "content": "<p class=\"tiptap-block\" style=\"text-align: left;\">...</p>...",
  "language": "en",
  "category": "other",
  "author": "69bd432766cd740733175da7",
  "isPublished": true,
  "isDeleted": false,
  "isPublic": false,
  "createdAt": "2026-08-22T17:23:22.880Z",
  "updatedAt": "2026-08-31T04:27:59.351Z",
  "publishedAt": "2026-08-23T01:38:12.570Z",
  "slug": "bangladesh-gov-letter-some-thank-yous-are-in-order-5f14a3",
  "stats": {
    "likes": 40,
    "dislikes": 0,
    "score": 40,
    "views": 214,
    "comments": 8,
    "subs": 2,
    "tips": 13,
    "gemTips": 0
  }
}
```

**Critical**: The `content` field stores **TipTap HTML**, not JSON. Entity references are
embedded as `<span data-content-link>` elements within the HTML. This means:

- The HTML can be rendered by any HTML parser (no TipTap needed for display)
- But entity resolution requires parsing the `data-content-*` attributes
- The content includes inline styles (`style="..."`) for alignment, fonts, colors

### Content HTML Patterns

```html
<!-- Paragraph -->
<p class="tiptap-block" style="text-align: left;">...</p>

<!-- Heading with alignment -->
<h2 style="text-align: center;">...</h2>

<!-- Entity mention (battle) -->
<span data-content-link="" data-content-type="battle"
  data-content-data="{&quot;battleId&quot;:&quot;6a88dd3f...&quot;,&quot;fullMatch&quot;:&quot;/battle/6a88dd3f...&quot;}"
  data-original-text="/battle/6a88dd3fe1208663ba7e4521"></span>

<!-- Entity mention (user) -->
<span data-content-link="" data-content-type="user"
  data-content-data="{&quot;userId&quot;:&quot;69bd4327...&quot;,&quot;fullMatch&quot;:&quot;/user/69bd4327...&quot;}"
  data-original-text="/user/69bd432766cd740733175da7"></span>

<!-- Image -->
<img class="tiptap-image" src="https://i.imgur.com/xxx.png">

<!-- Blockquote -->
<blockquote class="tiptap-blockquote">...</blockquote>

<!-- Horizontal rule -->
<hr>

<!-- Collapsible section -->
<details class="tiptap-collapsible" open="open">
  <summary class="tiptap-collapsible-summary">...</summary>
  <div data-collapsible-body="" class="tiptap-collapsible-body">
    <div class="tiptap-collapsible-body-inner">
      <div class="tiptap-collapsible-body-content">...</div>
    </div>
  </div>
</details>

<!-- Inline code -->
<code class="tiptap-code">...</code>

<!-- Link -->
<a href="https://..." class="tiptap-link">...</a>
```

---

## 5. API Endpoints & Data Fetching

### tRPC Setup

- **Transport**: HTTP batch link (POST, max 50 per batch)
- **Base URLs**: Load-balanced across 5 servers (api2–api6)
- **Failover**: Failed server is blacklisted; random server selected from remaining pool
- **Special routing**: `map.*` procedures use `httpLink` (no batching)
- **Custom headers**: `x-vid` (visitor ID), `x-gr` (WebGL renderer info)

### Key Article Procedures

| Procedure | Type | Purpose |
|-----------|------|---------|
| `article.getArticleById` | query | Full article data |
| `article.getArticleLiteById` | query | Lightweight article |
| `article.getArticlesPaginated` | query | Paginated article list |
| `article.deleteArticle` | mutation | Delete article |
| `article.adminChangeCategory` | mutation | Admin: change category |
| `article.adminChangeLanguage` | mutation | Admin: change language |
| `article.pinArticleInCountry` | mutation | Pin article in country |
| `articleInteraction.toggleLike` | mutation | Like/unlike |
| `articleInteraction.toggleDislike` | mutation | Dislike/undislike |
| `articleInteraction.tipArticle` | mutation | Tip article (coins) |
| `articleInteraction.tipArticleGems` | mutation | Tip article (gems) |
| `articleInteraction.toggleSubscription` | mutation | Subscribe/unsubscribe to author |

### Key User Procedures

| Procedure | Type | Purpose |
|-----------|------|---------|
| `user.getUserLite` | query | Lightweight user (name, avatar, level, rankings) |
| `user.getUserById` | query | Full user data |
| `user.getMe` | query | Current authenticated user |

### React Query Cache Invalidation

After mutations, related query keys are invalidated:

```javascript
invalidateQueryKeys: [
  queryKey(["trpc", "articleInteraction", "getMyInteractions"]),
  queryKey(["trpc", "article", "getArticleById", {articleId}]),
  queryKey(["trpc", "article", "getArticlesPaginated"]),
]
```

---

## 6. Our Newsdesk vs. War Era App — Entity Resolution Comparison

| Aspect | War Era App | Our Newsdesk |
|--------|-------------|--------------|
| **Renderer** | TipTap node view (React components) | `resolveContentLinks()` (DOM manipulation) |
| **Richness** | Rich badges (avatars, cards, flags) | Simple `<a>` links with text names |
| **Resolution** | Client-side in TipTap's ProseMirror pipeline | `Promise.all()` fetch → DOM replace |
| **Offline** | None (requires API) | Offline lookup tables (`offlineLookups.js`) |
| **Caching** | React Query + ProseMirror state | `S.lookups` Map cache |
| **Fallback** | Plain text if type unknown | `entityDisplayName()` fallback |
| **Mobile** | Same rendering (React components) | Same rendering (no special mobile code) |

### Why Mobile Entity Resolution Might Fail

The War Era app's entity resolution is **entirely client-side**:

1. **JS hydration delay**: The page is a static export — no SSR for article content.
   On slow mobile connections, the TipTap editor takes time to mount and process
   the content.

2. **React rendering**: Entity badges are React components rendered inside ProseMirror's
   node view system. On low-end mobile devices, this can be slow.

3. **tRPC batch requests**: Entity resolution triggers multiple API calls (one per
   unique entity). On mobile with higher latency, this compounds.

4. **No SSR fallback**: Since `pageProps` is empty, there's no pre-rendered content.
   The user sees a loading spinner until JS boots + API data arrives.

5. **`user-scalable=no`**: The viewport meta tag disables pinch-zoom, which can
   interfere with some mobile accessibility features.

**The endless loading on mobile** is most likely caused by:
- Slow JS bundle loading on mobile networks (the page has ~15 deferred JS chunks)
- tRPC API requests timing out or being rate-limited
- The TipTap editor failing to mount (JS error in hydration)
- Cloudflare challenge blocking mobile users (the page has Cloudflare protection)

---

## 7. Collapsible Section Structure

The collapsible sections use native HTML `<details>/<summary>` with TipTap-specific
classes:

```html
<details class="tiptap-collapsible" open="open">
  <summary class="tiptap-collapsible-summary">
    <span style="font-family: Verdana;"><strong>Header Text</strong></span>
  </summary>
  <div data-collapsible-body="" class="tiptap-collapsible-body">
    <div class="tiptap-collapsible-body-inner">
      <div class="tiptap-collapsible-body-content">
        <!-- Block content (paragraphs, lists, images, etc.) -->
      </div>
    </div>
  </div>
</details>
```

- **Nested collapsibles**: Supported — a `<details>` inside another `<details>`
  creates a sub-section (L2 in our ToC).
- **`open="open"`**: Sections are open by default in the editor; authors can toggle them.
- **Sanitization**: Our `sanitizeHtml()` now allows `<details>` and `<summary>` tags.
- **ToC detection**: Our `parseTocFromContent()` tracks `<details>` nesting depth to
  assign ToC levels (L1 for top-level, L2 for nested, etc.).

---

## 8. Quick Reference: Entity Data Fields

For each entity type, the `data-content-data` JSON contains:

| Type | ID Field | Example Value |
|------|----------|---------------|
| `user` | `userId` | `"69bd432766cd740733175da7"` |
| `article` | `articleId` | `"6a89db0ae3e38ec6655f14a3"` |
| `country` | `countryId` | `"6813b6d546e731854c7ac829"` |
| `region` | `regionId` | |
| `battle` | `battleId` | `"6a88dd3fe1208663ba7e4521"` |
| `alliance` | `allianceId` | |
| `mu` | `muId` | `"69b96383d6725d146ba1ec59"` |
| `company` | `companyId` | |
| `party` | `partyId` | |

All also include `fullMatch` with the original URL/path text.

---

*Generated 2026-09-04 for the War Era News Desk project.*
