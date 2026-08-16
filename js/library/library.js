import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, fetchTrpcApi2, fetchTrpcApi5, unwrap } from "../core/api.js";
import { debounce, fmtDate, fmtNum, escapeHtml, sanitizeHtml, readerBylineHtml, articleCardStatsHtml } from "../core/utils.js";
import { langName } from "../timeline/articles.js";
import { resolveUsers } from "../timeline/filters.js";
import { resolveContentLinks } from "../core/resolver.js";
import { getMeta, saveMeta, loadAll, saveMany, clearStore } from "./libraryStore.js";
import { setCurrentArticle, getBookmarkRecords, isBookmarked, ensureBookmarksLoaded } from "./bookmarks.js";

const CATEGORY_META = {
  news:          { label: "News",          icon: "mdi:newspaper-variant-outline" },
  politics:      { label: "Politics",      icon: "mdi:bank-outline" },
  election:      { label: "Election",      icon: "mdi:ballot-outline" },
  economy:       { label: "Economy",       icon: "mdi:chart-line" },
  military:      { label: "Military",      icon: "mdi:sword-cross" },
  entertainment: { label: "Entertainment", icon: "mdi:movie-open-outline" },
  guide:         { label: "Guides",        icon: "mdi:book-open-page-variant-outline" },
  stats:         { label: "Stats",         icon: "mdi:chart-bar" },
  begging:       { label: "Begging",       icon: "mdi:hand-heart-outline" },
  other:         { label: "Other",         icon: "mdi:archive-outline" },
};

const VISIBLE_STEP = 50;

const L = {
  index: [],
  built: false,
  building: false,
  loadedFromStore: false,
  persistContent: true,
  category: "",
  searchMode: "keyword",
  searchTerm: "",
  searchAuthorId: null,
  searchAuthorName: "",
  sort: "date",
  sortDir: "desc",
  timeFrom: "",
  timeTo: "",
  langs: [],
  visible: VISIBLE_STEP,
};

const seen = new Set();

function status(msg, type) {
  const el = document.getElementById("libraryStatus");
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ""; el.classList.remove("error"); return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle("error", type === "error");
}

function updateMeta() {
  const el = document.getElementById("libraryMeta");
  if (!el) return;
  el.textContent = `${L.index.length} articles indexed`;
}

async function fetchArticlesPage(input, k) {
  // api2 serves article.getArticlesPaginated reliably; gateway postgres is down for it.
  try { return unwrap(await fetchTrpcApi2("article.getArticlesPaginated", input, k)); } catch {}
  try { return unwrap(await fetchTrpc("article.getArticlesPaginated", input, k)); } catch {}
  try { return unwrap(await fetchTrpcApi5("article.getArticlesPaginated", input, k)); } catch {}
  return null;
}

function toRecord(a) {
  const rec = {
    _id: a._id || a.id,
    title: a.title || "Untitled",
    author: a.author || null,
    language: a.language || "",
    category: a.category || "other",
    createdAt: a.createdAt || "",
    publishedAt: a.publishedAt || a.createdAt || "",
    stats: a.stats || {},
    content: a.content || "",
  };
  if (!L.persistContent) delete rec.content;
  return rec;
}

function ingest(items) {
  const fresh = [];
  for (const a of items) {
    const id = a._id || a.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rec = toRecord(a);
    fresh.push(rec);
    L.index.push(rec);
  }
  return fresh;
}

async function persistBatch(records) {
  if (!records.length) return;
  const ok = await saveMany(records);
  if (ok) return;
  if (L.persistContent) {
    L.persistContent = false;
    saveMeta({ persistContent: false });
    await saveMany(records.map(r => { const slim = { ...r }; delete slim.content; return slim; }));
    status("Local storage quota reached — caching metadata only (content loads on demand).");
  }
}

function renderLive(pages) {
  updateMeta();
  status(`Indexing… ${L.index.length} articles (page ${pages})`);
  renderBookshelf();
  populateLangDropdown();
  renderLibrary();
}

function markBuilt() {
  L.built = true;
  saveMeta({ built: true, cursor: null });
}

function finalize() {
  status("");
  updateMeta();
  renderBookshelf();
  renderLibrary();
  populateLangDropdown();
}

function pauseSync(cursor) {
  saveMeta({ cursor });
  const msg = L.index.length
    ? `Library sync paused at ${fmtNum(L.index.length)} articles — API error. Progress is saved; it will resume next time you open the library.`
    : "Library sync paused — API unavailable. It will retry when you open the library.";
  status(msg, "error");
}

async function loadCached() {
  const meta = getMeta();
  L.built = !!meta.built;
  L.persistContent = meta.persistContent !== false;
  const records = await loadAll();
  seen.clear();
  for (const a of records) {
    if (!a || !a._id) continue;
    seen.add(a._id);
    L.index.push(a);
  }
  renderBookshelf();
  renderLibrary();
  populateLangDropdown();
  if (L.index.length) {
    status(`Loaded ${fmtNum(L.index.length)} articles from cache — checking for updates…`);
  }
}

async function syncIndex(k) {
  const meta = getMeta();
  let pages = 0;

  // Phase A — catch up the newest articles (cheap when already caught up).
  let cursor = null;
  while (true) {
    const input = cursor ? { type: "last", limit: 100, cursor } : { type: "last", limit: 100 };
    const data = await fetchArticlesPage(input, k);
    if (!data) { pauseSync(cursor); return; }
    const items = data?.items || [];
    if (!items.length) { markBuilt(); finalize(); return; }
    const fresh = ingest(items);
    if (fresh.length) {
      await persistBatch(fresh);
      pages++;
      renderLive(pages);
      if (!data?.nextCursor) { markBuilt(); finalize(); return; }
      cursor = data.nextCursor;
      saveMeta({ cursor });
    } else {
      // Reached the stored frontier — everything indexed so far is up to date.
      break;
    }
  }

  // Phase B — resume a backfill that never finished in a previous run.
  if (!meta.built) {
    cursor = meta.cursor || cursor;
    while (true) {
      const input = cursor ? { type: "last", limit: 100, cursor } : { type: "last", limit: 100 };
      const data = await fetchArticlesPage(input, k);
      if (!data) { pauseSync(cursor); return; }
      const items = data?.items || [];
      if (!items.length) { markBuilt(); finalize(); return; }
      const fresh = ingest(items);
      if (fresh.length) {
        await persistBatch(fresh);
        pages++;
        renderLive(pages);
      }
      if (!data?.nextCursor) { markBuilt(); finalize(); return; }
      cursor = data.nextCursor;
      saveMeta({ cursor });
    }
  }

  finalize();
}

export async function ensureLibraryIndex() {
  const k = apiKey();
  if (!k || L.building) return;
  L.building = true;
  status("Indexing entire library…");
  try {
    if (!L.loadedFromStore) {
      L.loadedFromStore = true;
      await loadCached();
    }
    await syncIndex(k);
  } catch (e) {
    console.error("library index error:", e);
    status(L.index.length ? `Partial index (${fmtNum(L.index.length)} articles). ${e.message || "API error"}` : "Library indexing failed. " + (e.message || "API error"), "error");
  } finally {
    L.building = false;
  }
}

function categoryCounts() {
  const counts = { all: L.index.length };
  for (const a of L.index) {
    const c = a.category || "other";
    counts[c] = (counts[c] || 0) + 1;
  }
  return counts;
}

export function renderBookshelf() {
  const el = document.getElementById("libraryShelf");
  if (!el) return;
  const counts = categoryCounts();
  const categories = ["all", ...Object.keys(CATEGORY_META)];
  const isActive = (c) => (L.category || "all") === c;
  el.innerHTML = categories.map(c => {
    const meta = c === "all" ? { label: "All", icon: "mdi:bookshelf" } : CATEGORY_META[c];
    const count = counts[c] || 0;
    const label = (c === "all" ? "All Articles" : meta.label) || c;
    return `<button class="lib-book${isActive(c) ? " active" : ""}" data-lib-cat="${c}" title="${escapeHtml(label)} — ${count} articles">
      <iconify-icon icon="${meta.icon}" class="lu"></iconify-icon>
      <span class="lib-book-name">${escapeHtml(label)}</span>
      <span class="lib-book-count">${fmtNum(count)}</span>
    </button>`;
  }).join("");

  const select = document.getElementById("libraryCatFilter");
  if (select) {
    select.innerHTML = categories.map(c => {
      const meta = c === "all" ? { label: "All Articles" } : CATEGORY_META[c];
      const label = (c === "all" ? "All Articles" : meta.label) || c;
      const count = counts[c] || 0;
      return `<option value="${c}"${isActive(c) ? " selected" : ""}>${escapeHtml(label)} (${fmtNum(count)})</option>`;
    }).join("");
  }
}

function renderBookmarksBtn() {
  const btn = document.getElementById("libraryBookmarksBtn");
  if (!btn) return;
  btn.classList.toggle("active", L.category === "bookmarks");
  const count = document.getElementById("libraryBookmarksCount");
  if (count) count.textContent = fmtNum(getBookmarkRecords().length);
}

function getFiltered() {
  let arts;
  if (L.category === "bookmarks") {
    arts = [...getBookmarkRecords()];
  } else {
    arts = L.index;
    if (L.category) arts = arts.filter(a => (a.category || "other") === L.category);
  }
  if (L.langs.length) arts = arts.filter(a => L.langs.includes(a.language));
  const term = L.searchTerm.trim();
  if (term) {
    const t = term.toLowerCase();
    if (L.searchMode === "author") {
      if (L.searchAuthorId) arts = arts.filter(a => a.author === L.searchAuthorId);
      else arts = [];
    } else {
      arts = arts.filter(a =>
        (a.title || "").toLowerCase().includes(t) ||
        (a.content || "").toLowerCase().includes(t)
      );
    }
  }
  if (L.timeFrom || L.timeTo) {
    const fromMs = L.timeFrom ? new Date(L.timeFrom).getTime() : 0;
    const toMs = L.timeTo ? new Date(L.timeTo).getTime() : Infinity;
    arts = arts.filter(a => {
      const ms = new Date(a.createdAt).getTime();
      if (isNaN(ms)) return true;
      return ms >= fromMs && ms <= toMs;
    });
  }
  arts = [...arts];
  const dir = L.sortDir === "asc" ? 1 : -1;
  if (L.sort === "score") arts.sort((a, b) => dir * ((a.stats?.score ?? 0) - (b.stats?.score ?? 0)));
  else arts.sort((a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  return arts;
}

function authorName(id) {
  return (S.lookups.usersById.get(id)?.username || S.lookups.usersById.get(id)?.name) || "Unknown";
}

export function renderLibrary() {
  const listEl = document.getElementById("libraryList");
  const loadMoreBtn = document.getElementById("loadMoreLibraryBtn");
  if (!listEl) return;
  const arts = getFiltered();
  L.visible = Math.max(VISIBLE_STEP, L.visible);
  const shown = arts.slice(0, L.visible);

  const authorIds = [...new Set(shown.map(a => a.author).filter(Boolean))];
  const pendingIds = authorIds.filter(id => !S.lookups.usersById.has(id));
  if (pendingIds.length) {
    resolveUsers(pendingIds, apiKey()).then(() => renderLibrary()).catch(() => {});
  }

  if (!shown.length) {
    const msg = L.category === "bookmarks"
      ? "No bookmarks yet. Open an article and hit the bookmark icon."
      : (L.index.length ? "No articles match the current filters." : "The library is still indexing…");
    listEl.innerHTML = `<p class="library-empty">${msg}</p>`;
  } else {
    listEl.innerHTML = "";
    for (const a of shown) {
      const stats = a.stats || {};
      const card = E.tplArticle.content.firstElementChild.cloneNode(true);
      card.querySelector(".ac-cat").textContent = CATEGORY_META[a.category]?.label || a.category;
      card.querySelector(".ac-title").textContent = a.title || "Untitled";
      card.querySelector(".ac-meta").textContent = `${authorName(a.author)} · ${langName(a.language)} · ${fmtDate(a.createdAt)}`;
      card.querySelector(".ac-stats").innerHTML = articleCardStatsHtml(stats);
      card.querySelector(".ac-open").addEventListener("click", () => {
        window.open(`https://app.warera.io/article/${a._id}`, "_blank", "noopener");
      });
      card.querySelector(".ac-read").addEventListener("click", () => openReader(a));
      listEl.append(card);
    }
  }

  loadMoreBtn.hidden = shown.length >= arts.length;
  const metaEl = document.getElementById("libraryMeta");
  if (metaEl) {
    const suffix = termLabel();
    if (L.category === "bookmarks") {
      metaEl.textContent = `${shown.length} shown (${arts.length} bookmarked${suffix ? " · " + suffix : ""})`;
    } else {
      metaEl.textContent = `${shown.length} shown (${arts.length} match${suffix ? " · " + suffix : ""}) · ${L.index.length} indexed`;
    }
  }
}

function termLabel() {
  if (!L.searchTerm.trim()) return "";
  if (L.searchMode === "author") return `author: ${L.searchTerm.trim()}`;
  return `keyword: ${L.searchTerm.trim()}`;
}

// Copies the details (never the content) of the articles currently rendered in
// the list — the visible slice of the active filters, matching what Load More
// has expanded so far.
export async function copyLibraryArticles() {
  const arts = getFiltered().slice(0, L.visible);
  const lines = arts.map(a => {
    const cat = CATEGORY_META[a.category]?.label || a.category || "Other";
    const author = authorName(a.author);
    return `[${fmtDate(a.createdAt)}] ${cat} — 🌐${langName(a.language)} — 👤${author} — ☆${a.stats?.score ?? 0} — ${a.title || "Untitled"}`;
  });
  await navigator.clipboard.writeText(lines.join("\n"));
}

function openReader(a) {
  const stats = a.stats || {};
  setCurrentArticle(a);
  E.readerTitle.textContent = a.title || "Untitled";
  E.readerAuthor.innerHTML = readerBylineHtml(a.author, stats);
  E.readerContent.innerHTML = sanitizeHtml(a.content) || "<p>No content available.</p>";
  E.readerContent.querySelectorAll("a").forEach(l => { l.target = "_blank"; l.rel = "noopener noreferrer"; });
  E.readerContent.querySelectorAll("iframe").forEach(f => { f.style.width = "100%"; f.style.aspectRatio = "16/9"; f.style.height = "auto"; });
  const openBtn = document.getElementById("openArticleBtn");
  if (openBtn) openBtn.dataset.id = a._id || a.id;
  E.readerModal.classList.remove("hidden");
  resolveContentLinks(E.readerContent);
}

function updateLangTrigger() {
  const cont = document.getElementById("libraryLangFilter");
  if (!cont) return;
  const trigger = cont.querySelector(".lang-dropdown-trigger");
  if (!trigger) return;
  if (L.langs.length === 0) trigger.textContent = "All Languages";
  else if (L.langs.length === 1) trigger.textContent = langName(L.langs[0]);
  else trigger.textContent = `${L.langs.length} selected`;
}

function populateLangDropdown() {
  const langs = new Set();
  for (const a of L.index) { if (a.language) langs.add(a.language); }
  const cont = document.getElementById("libraryLangFilter");
  if (!cont) return;
  const menu = cont.querySelector(".lang-dropdown-menu");
  if (!menu) return;
  let html = `<div class="lang-dropdown-item${L.langs.length === 0 ? " selected" : ""}" data-lang=""><span class="ld-check">${L.langs.length === 0 ? "✓" : "&nbsp;"}</span>All</div>`;
  for (const l of [...langs].sort()) {
    const active = L.langs.includes(l);
    html += `<div class="lang-dropdown-item${active ? " selected" : ""}" data-lang="${l}"><span class="ld-check">${active ? "✓" : "&nbsp;"}</span>${langName(l)}</div>`;
  }
  menu.innerHTML = html;
  updateLangTrigger();
}

async function resolveAuthorTerm(term) {
  const k = apiKey();
  if (!k || !term.trim()) { L.searchAuthorId = null; L.searchAuthorName = ""; renderLibrary(); return; }
  status(`Resolving author “${term.trim()}”…`);
  try {
    const res = await fetchTrpc("search.searchAnything", { searchText: term.trim() }, k);
    const d = unwrap(res);
    const ids = d?.userIds || [];
    if (ids.length) {
      L.searchAuthorId = ids[0];
      L.searchAuthorName = term.trim();
      status("");
    } else {
      L.searchAuthorId = null;
      L.searchAuthorName = "";
      status(`No user found for “${term.trim()}”.`, "error");
    }
  } catch (e) {
    L.searchAuthorId = null;
    L.searchAuthorName = "";
    status("Author lookup failed: " + (e.message || "API error"), "error");
  }
  renderLibrary();
}

export function initLibrary() {
  const searchInput = document.getElementById("librarySearch");
  const shelf = document.getElementById("libraryShelf");
  const loadMoreBtn = document.getElementById("loadMoreLibraryBtn");
  const langCont = document.getElementById("libraryLangFilter");

  const libSortBtns = document.querySelectorAll("[data-lib-sort]");
  function updateLibSortArrows() {
    for (const btn of libSortBtns) {
      const arr = btn.querySelector(".sort-arrow");
      if (!arr) continue;
      const on = btn.classList.contains("active");
      arr.textContent = on && L.sortDir === "asc" ? "▲" : "▼";
      arr.classList.toggle("off", !on);
    }
  }
  for (const btn of libSortBtns) {
    btn.addEventListener("click", () => {
      const wasActive = btn.classList.contains("active");
      libSortBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      if (wasActive) {
        L.sortDir = L.sortDir === "desc" ? "asc" : "desc";
      } else {
        L.sort = btn.dataset.libSort;
        L.sortDir = "desc";
      }
      updateLibSortArrows();
      L.visible = VISIBLE_STEP;
      renderLibrary();
    });
  }
  updateLibSortArrows();

  document.querySelectorAll("[data-lib-search]").forEach(btn => {
    btn.addEventListener("click", () => {
      L.searchMode = btn.dataset.libSearch;
      document.querySelectorAll("[data-lib-search]").forEach(b => b.classList.toggle("active", b === btn));
      if (searchInput) {
        searchInput.placeholder = L.searchMode === "author" ? "Search by author username…" : "Search articles by keyword…";
      }
      if (L.searchMode === "author") {
        if (searchInput && searchInput.value.trim()) resolveAuthorTerm(searchInput.value);
        else { L.searchAuthorId = null; renderLibrary(); }
      } else {
        renderLibrary();
      }
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", debounce(() => {
      L.searchTerm = searchInput.value.trim();
      if (L.searchMode === "author") resolveAuthorTerm(L.searchTerm);
      else { L.searchAuthorId = null; L.visible = VISIBLE_STEP; renderLibrary(); }
    }, 400));
    document.querySelector("[data-clears='librarySearch']")?.addEventListener("click", () => {
      L.searchTerm = "";
      L.searchAuthorId = null;
      L.searchAuthorName = "";
      L.visible = VISIBLE_STEP;
      renderLibrary();
    });
  }

  if (shelf) {
    shelf.addEventListener("click", (e) => {
      const book = e.target.closest(".lib-book");
      if (!book) return;
      L.category = book.dataset.libCat === "all" ? "" : book.dataset.libCat;
      L.visible = VISIBLE_STEP;
      renderBookshelf();
      renderBookmarksBtn();
      renderLibrary();
    });
  }

  const libCatFilter = document.getElementById("libraryCatFilter");
  libCatFilter?.addEventListener("change", () => {
    L.category = libCatFilter.value === "all" ? "" : libCatFilter.value;
    L.visible = VISIBLE_STEP;
    renderBookshelf();
    renderBookmarksBtn();
    renderLibrary();
  });

  document.getElementById("libraryBookmarksBtn")?.addEventListener("click", () => {
    L.category = L.category === "bookmarks" ? "" : "bookmarks";
    L.visible = VISIBLE_STEP;
    renderBookshelf();
    renderBookmarksBtn();
    renderLibrary();
  });

  const tFrom = document.getElementById("libraryTimeFrom");
  const tTo = document.getElementById("libraryTimeTo");
  function syncLibDateToDisabled() {
    if (!tTo) return;
    tTo.disabled = !tFrom || !tFrom.value;
    if (tFrom && !tFrom.value) tTo.value = "";
  }
  function applyLibDate() {
    L.timeFrom = tFrom?.value || "";
    L.timeTo = tTo?.value || "";
    L.visible = VISIBLE_STEP;
    renderLibrary();
  }
  tFrom?.addEventListener("change", () => { syncLibDateToDisabled(); applyLibDate(); });
  tTo?.addEventListener("change", applyLibDate);
  syncLibDateToDisabled();


  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      L.visible += VISIBLE_STEP;
      renderLibrary();
    });
  }

  document.getElementById("libraryRebuildBtn")?.addEventListener("click", async () => {    if (L.building) { status("Library is already syncing — please wait.", "error"); return; }
    await clearStore();
    L.index.length = 0;
    seen.clear();
    L.built = false;
    L.loadedFromStore = false;
    L.persistContent = true;
    L.visible = VISIBLE_STEP;
    L.timeFrom = ""; L.timeTo = "";
    L.sortDir = "desc";
    if (tFrom) tFrom.value = "";
    if (tTo) tTo.value = "";
    syncLibDateToDisabled();
    renderBookshelf();
    renderBookmarksBtn();
    renderLibrary();
    populateLangDropdown();
    status("Cache cleared — re-indexing library…");
    await ensureLibraryIndex();
  });

  if (langCont) {
    const trigger = langCont.querySelector(".lang-dropdown-trigger");
    const menu = langCont.querySelector(".lang-dropdown-menu");
    trigger?.addEventListener("click", (e) => { e.stopPropagation(); menu?.classList.toggle("hidden"); });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#libraryLangFilter")) menu?.classList.add("hidden");
    });
    menu?.addEventListener("click", (e) => {
      const item = e.target.closest(".lang-dropdown-item");
      if (!item) return;
      const lang = item.dataset.lang;
      if (!lang) L.langs = [];
      else if (L.langs.includes(lang)) L.langs = L.langs.filter(l => l !== lang);
      else L.langs = [...L.langs, lang];
      populateLangDropdown();
      renderLibrary();
    });
  }

  renderBookshelf();
  renderBookmarksBtn();
  renderLibrary();
  populateLangDropdown();
  ensureLibraryIndex();
  ensureBookmarksLoaded().then(() => { renderBookshelf(); renderBookmarksBtn(); renderLibrary(); });
  document.addEventListener("nd:bookmarks-changed", () => {
    renderBookshelf();
    renderBookmarksBtn();
    renderLibrary();
  });

  // Mobile: expand/collapse the filter rows (rows 1-3 of the toolbar)
  const filtersToggle = document.getElementById("libraryFiltersToggle");
  const libraryLayoutEl = document.querySelector(".library-layout");
  filtersToggle?.addEventListener("click", () => {
    if (!libraryLayoutEl) return;
    const collapsed = libraryLayoutEl.classList.toggle("filters-collapsed");
    filtersToggle.setAttribute("aria-expanded", String(!collapsed));
  });
}