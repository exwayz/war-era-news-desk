import { fetchTrpcApi2, unwrap, apiKey } from "../core/api.js";
import { setCurrentArticle } from "../library/bookmarks.js";
import { openRootArticle } from "../ui/readerNav.js";
import { resolveUsers } from "../timeline/filters.js";

const GUIDE_ARTICLE_ID = "6a7f1224f19996f8b4535757";
const GUIDE_CACHE_KEY = "wa-guide-article";

let _guideArticle = null;
let _tocCollapsed = false;

export function getGuideArticle() { return _guideArticle; }
export function isGuideArticle(a) { return (a?._id || a?.id) === GUIDE_ARTICLE_ID; }

export async function fetchGuideArticle(apiKeyValue) {
  try {
    const r = await fetchTrpcApi2("article.getArticleById", { articleId: GUIDE_ARTICLE_ID }, apiKeyValue);
    const data = unwrap(r);
    if (data && data.title) {
      if (data.author) await resolveUsers([data.author], apiKeyValue);
      _guideArticle = data;
      try { localStorage.setItem(GUIDE_CACHE_KEY, JSON.stringify(data)); } catch {}
      return data;
    }
  } catch {}
  try {
    const raw = localStorage.getItem(GUIDE_CACHE_KEY);
    if (raw) _guideArticle = JSON.parse(raw);
  } catch {}
  return _guideArticle;
}

export function renderPinnedCard(container) {
  if (!container || !_guideArticle) return;
  container.innerHTML = "";
  const card = document.createElement("article");
  card.className = "article-card pinned-guide-card";
  card.innerHTML = `<h3 class="ac-title pinned-guide-title">${esc(_guideArticle.title || "News Desk Guide")}</h3>`;
  card.addEventListener("click", () => {
    setCurrentArticle(_guideArticle);
    openRootArticle(_guideArticle);
    document.getElementById("articleReaderModal")?.classList.remove("hidden");
  });
  container.appendChild(card);
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

export function parseTocFromContent(html) {
  if (!html) return [];
  const entries = [];
  const tokenRe = /<(\/?)(details|summary|h([1-6]))(\s[^>]*)?>/gi;
  let match;
  let detailsDepth = 0;
  while ((match = tokenRe.exec(html)) !== null) {
    const isClose = match[1] === "/";
    const element = match[2];
    if (element === "details") {
      detailsDepth = isClose ? Math.max(0, detailsDepth - 1) : detailsDepth + 1;
      continue;
    }
    if (isClose) continue;
    const isHeader = /^h[1-6]$/.test(element);
    const level = isHeader ? parseInt(element.slice(1), 10) : Math.min(detailsDepth, 3);
    if (level < 1 || level > 3) continue;
    const inner = extractElementHtml(html, match.index + match[0].length, element);
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ""));
    if (!text) continue;
    entries.push({ text, level, id: "toc-" + entries.length, collapsible: !isHeader });
  }
  return entries;
}

function extractElementHtml(html, from, tag) {
  const endIndex = html.indexOf(`</${tag}>`, from);
  if (endIndex < 0) return "";
  return html.slice(from, endIndex);
}

export function decorateCollapsibles(container) {
  if (!container) return;
  container.querySelectorAll("summary").forEach(s => {
    s.insertAdjacentHTML("afterbegin",
      `<iconify-icon class="toc-chevron" icon="akar-icons:chevron-right-small"></iconify-icon>`);
  });
}

export function injectTocIdsIntoDom(container, entries) {
  if (!container || !entries.length) return;
  for (const e of entries) {
    const targets = e.collapsible
      ? container.querySelectorAll("summary")
      : container.querySelectorAll(`h${e.level}`);
    for (const h of targets) {
      if (decodeEntities(h.textContent) === e.text && !h.id) {
        h.id = e.id;
        break;
      }
    }
  }
}

export function buildTocHtml(entries) {
  if (!entries.length) return "";
  let html = `<div class="toc-list">`;
  for (const e of entries) {
    const indent = e.level === 1 ? "toc-l1" : e.level === 2 ? "toc-l2" : "toc-l3";
    html += `<button class="toc-item ${indent}" data-toc-id="${e.id}">${esc(e.text)}</button>`;
  }
  html += `</div>`;
  return html;
}

export function showToc(article) {
  const modal = document.getElementById("tocModal");
  const body = document.getElementById("tocModalBody");
  const toggleBtn = document.getElementById("tocToggleBtn");
  if (!modal || !body || !article) return;

  const entries = parseTocFromContent(article.content || "");
  if (!entries.length) { hideToc(); return; }

  _tocCollapsed = true;
  body.innerHTML = buildTocHtml(entries);

  body.querySelectorAll(".toc-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.tocId);
      const readerContent = document.getElementById("readerContent");
      if (target && readerContent) {
        const cRect = readerContent.getBoundingClientRect();
        const tRect = target.getBoundingClientRect();
        const top = tRect.top - cRect.top + readerContent.scrollTop;
        readerContent.scrollTo({ top: Math.max(0, top - 20), behavior: "smooth" });
        target.classList.remove("toc-go-flash");
        void target.offsetWidth;
        target.classList.add("toc-go-flash");
      }
    });
  });

  if (toggleBtn) {
    toggleBtn.innerHTML = _tocCollapsed
      ? `<iconify-icon icon="mdi:chevron-left" class="lu"></iconify-icon>`
      : `<iconify-icon icon="mdi:chevron-right" class="lu"></iconify-icon>`;
    toggleBtn.onclick = () => {
      _tocCollapsed = !_tocCollapsed;
      modal.classList.toggle("toc-collapsed", _tocCollapsed);
      toggleBtn.innerHTML = _tocCollapsed
        ? `<iconify-icon icon="mdi:chevron-left" class="lu"></iconify-icon>`
        : `<iconify-icon icon="mdi:chevron-right" class="lu"></iconify-icon>`;
    };
  }

  modal.classList.remove("hidden");
  modal.classList.toggle("toc-collapsed", _tocCollapsed);
}

export function hideToc() {
  const modal = document.getElementById("tocModal");
  if (modal) modal.classList.add("hidden");
}
