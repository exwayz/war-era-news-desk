import { E } from "../core/dom.js";
import { sanitizeHtml, readerBylineHtml } from "../core/utils.js";
import { resolveEntityByType, resolveContentLinks } from "../core/resolver.js";
import { apiKey } from "../core/api.js";
import { playRead } from "../audio/audio.js";
import { loadHighlightsForArticle } from "./readerHighlight.js";
import { parseTocFromContent, injectTocIdsIntoDom, showToc, hideToc } from "../pinned/guideArticle.js";

const _stack = [];
const _scrollPositions = [];
let _rootScrollTop = 0;
let _rootArticle = null;

export function getReaderStack() { return _stack; }
export function getRootArticle() { return _rootArticle; }

function renderArticleInReader(a, restoreScrollTop) {
  const stats = a.stats || {};
  E.readerTitle.textContent = a.title || "Untitled";
  E.readerAuthor.innerHTML = readerBylineHtml(a.author, stats);
  E.readerContent.innerHTML = sanitizeHtml(a.content) || "<p>No content available.</p>";
  E.readerContent.querySelectorAll("a").forEach(l => { l.target = "_blank"; l.rel = "noopener noreferrer"; });
  E.readerContent.querySelectorAll("iframe").forEach(f => { f.style.width = "100%"; f.style.aspectRatio = "16/9"; f.style.height = "auto"; });
  const entries = parseTocFromContent(a.content || "");
  if (entries.length) injectTocIdsIntoDom(E.readerContent, entries);
  const openBtn = document.getElementById("openArticleBtn");
  if (openBtn) openBtn.dataset.id = a._id || a.id;
  E.readerContent.scrollTop = restoreScrollTop || 0;
  resolveContentLinks(E.readerContent);
}

export function updateReaderNavUI() {
  const backBtn = document.getElementById("readerBackBtn");
  const closeBtn = document.getElementById("closeReader");
  if (!backBtn || !closeBtn) return;

  if (_stack.length > 0) {
    closeBtn.classList.add("hidden");
    backBtn.classList.remove("hidden");
  } else {
    closeBtn.classList.remove("hidden");
    backBtn.classList.add("hidden");
  }
}

export function openReaderFromMention(articleId) {
  const k = apiKey();
  if (!k || !articleId) return;
  resolveEntityByType("article", articleId, k).then(a => {
    if (!a) return;
    openMentionArticle(a);
  });
}

export function openMentionArticle(a) {
  if (!a) return;

  const currentArticle = _stack.length > 0 ? _stack[_stack.length - 1] : _rootArticle;
  if (currentArticle) {
    const currentId = currentArticle._id || currentArticle.id;
    const newId = a._id || a.id;
    if (currentId === newId) return;
  }

  if (_stack.length > 0) {
    _scrollPositions[_scrollPositions.length - 1] = E.readerContent.scrollTop;
  } else if (_rootArticle) {
    _rootScrollTop = E.readerContent.scrollTop;
  }

  _stack.push(a);
  _scrollPositions.push(0);
  renderArticleInReader(a);
  updateReaderNavUI();
  showToc(a);
  E.readerModal.classList.remove("hidden");
  loadHighlightsForArticle(E.readerContent);
  playRead();
}

export function openRootArticle(a) {
  _stack.length = 0;
  _scrollPositions.length = 0;
  _rootScrollTop = 0;
  _rootArticle = a;
  renderArticleInReader(a);
  updateReaderNavUI();
  showToc(a);
}

export function navigateBack() {
  if (_stack.length === 0) return false;
  _stack.pop();
  const savedScroll = _scrollPositions.pop() || 0;

  if (_stack.length > 0) {
    const prev = _stack[_stack.length - 1];
    renderArticleInReader(prev, savedScroll);
    updateReaderNavUI();
    loadHighlightsForArticle(E.readerContent);
    showToc(prev);
    return true;
  }

  if (_rootArticle) {
    renderArticleInReader(_rootArticle, _rootScrollTop);
    updateReaderNavUI();
    loadHighlightsForArticle(E.readerContent);
    showToc(_rootArticle);
    _rootScrollTop = 0;
    return true;
  }

  updateReaderNavUI();
  return false;
}

export function closeReaderNav() {
  _stack.length = 0;
  _scrollPositions.length = 0;
  _rootScrollTop = 0;
  _rootArticle = null;
  updateReaderNavUI();
  hideToc();
}
