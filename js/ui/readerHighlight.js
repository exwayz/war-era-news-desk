import { E } from "../core/dom.js";
import { getCurrentArticle } from "../library/bookmarks.js";

const STORAGE_KEY = "nd:readerHighlights";
const COLORS = ["#F4D35E", "#7FD8A6", "#72C7E8", "#B69BE8", "#F4A261", "#F08080", "#EFA3B5"];

let active = false;
let paletteOpen = false;
let selectedColor = null;
let articleKey = null;

function getStore() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveStore(store) { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }

function articleHash(a) {
  if (!a) return null;
  const raw = (a._id || a.id || "") + "|" + (a.title || "");
  let h = 0;
  for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h + raw.charCodeAt(i)) | 0; }
  return "h" + (h >>> 0).toString(36);
}

function isBlock(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "P" || tag === "H1" || tag === "H2" || tag === "H3" ||
      tag === "H4" || tag === "H5" || tag === "H6" ||
      tag === "LI" || tag === "BLOCKQUOTE" || tag === "FIGCAPTION" ||
      tag === "DIV" || tag === "TD" || tag === "TH") return true;
  return getComputedStyle(el).display === "block" || getComputedStyle(el).display === "list-item";
}

function getBlockAncestor(node) {
  let el = node.nodeType === 3 ? node.parentElement : node;
  while (el && !isBlock(el)) el = el.parentElement;
  return el;
}

function wrapSelectionInBlock(sel, container, color) {
  if (sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return false;
  if (range.startContainer === range.endContainer && range.startOffset === range.endOffset) return false;

  const mark = document.createElement("mark");
  mark.className = "reader-highlight";
  mark.style.backgroundColor = color;
  try {
    range.surroundContents(mark);
    sel.removeAllRanges();
    return true;
  } catch {
    return false;
  }
}

function applyHighlights(body, highlights) {
  if (!body || !highlights || !highlights.length) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);

  for (const h of highlights) {
    for (let i = 0; i < texts.length; i++) {
      const node = texts[i];
      if (node.parentElement?.classList?.contains("reader-highlight")) continue;
      const idx = node.textContent.indexOf(h.text);
      if (idx === -1) continue;
      const after = node.splitText(idx);
      after.splitText(h.text.length);
      const mark = document.createElement("mark");
      mark.className = "reader-highlight";
      mark.style.backgroundColor = h.color;
      mark.textContent = after.textContent;
      after.parentNode.replaceChild(mark, after);
      break;
    }
  }
}

function removeHighlight(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  parent.normalize();
}

function syncHighlights(body) {
  if (!articleKey || !body) return;
  const marks = [...body.querySelectorAll("mark.reader-highlight")];
  const highlights = marks.map(m => ({ text: m.textContent, color: m.style.backgroundColor }));
  const store = getStore();
  if (highlights.length > 0) store[articleKey] = highlights;
  else delete store[articleKey];
  saveStore(store);
}

function updateHighlightBtnState() {
  const btn = document.getElementById("readerHighlightBtn");
  if (!btn) return;
  btn.classList.toggle("active", active);
  const icon = btn.querySelector("iconify-icon");
  if (icon) icon.style.color = active && selectedColor ? selectedColor : "";
}

function toggleMode() {
  active = !active;
  updateHighlightBtnState();

  if (active) {
    if (!selectedColor && COLORS.length) {
      selectedColor = COLORS[0];
      updatePaletteSelection();
    }
    E.readerContent?.classList.add("reader-highlight-mode");
    closePalette();
  } else {
    E.readerContent?.classList.remove("reader-highlight-mode");
    closePalette();
  }
}

function openPalette() {
  const pal = document.getElementById("readerHighlightPalette");
  if (pal) pal.classList.add("open");
  paletteOpen = true;
}

function closePalette() {
  const pal = document.getElementById("readerHighlightPalette");
  if (pal) pal.classList.remove("open");
  paletteOpen = false;
}

function updatePaletteSelection() {
  const pal = document.getElementById("readerHighlightPalette");
  if (!pal) return;
  pal.querySelectorAll(".reader-highlight-swatch").forEach(s => {
    s.classList.toggle("selected", s.dataset.color === selectedColor);
  });
}

function buildPalette() {
  const pal = document.getElementById("readerHighlightPalette");
  if (!pal) return;
  pal.innerHTML = "";
  for (const c of COLORS) {
    const swatch = document.createElement("button");
    swatch.className = "reader-highlight-swatch";
    swatch.dataset.color = c;
    swatch.style.backgroundColor = c;
    swatch.title = c;
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedColor = c;
      updatePaletteSelection();
      closePalette();
      if (!active) toggleMode();
    });
    pal.appendChild(swatch);
  }
}

export function initReaderHighlight() {
  const btn = document.getElementById("readerHighlightBtn");
  const body = E.readerContent;
  if (!btn || !body) return;

  buildPalette();

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (paletteOpen && active) { closePalette(); return; }
    if (!active) { if (!selectedColor) selectedColor = COLORS[0]; openPalette(); updatePaletteSelection(); return; }
    closePalette();
  });

  body.addEventListener("mouseup", (e) => {
    if (!active || !selectedColor) return;
    if (e.target.closest("mark.reader-highlight")) {
      const mark = e.target.closest("mark.reader-highlight");
      removeHighlight(mark);
      syncHighlights(body);
      return;
    }
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const text = sel.toString().trim();
      if (!text) return;
      const block = getBlockAncestor(sel.anchorNode) || getBlockAncestor(sel.focusNode) || body;
      if (wrapSelectionInBlock(sel, block, selectedColor)) syncHighlights(body);
    });
  });

  const observer = new MutationObserver(() => {
    if (!articleKey) return;
    const existing = body.querySelectorAll("mark.reader-highlight");
    if (existing.length === 0) {
      const store = getStore();
      if (store[articleKey]) applyHighlights(body, store[articleKey]);
    }
  });
  observer.observe(body, { childList: true, subtree: true });

  E.closeReader?.addEventListener("click", () => {
    active = false;
    updateHighlightBtnState();
    E.readerContent?.classList.remove("reader-highlight-mode");
    closePalette();
  });
  E.readerModal?.addEventListener("click", (e) => {
    if (e.target === E.readerModal) {
      active = false;
      updateHighlightBtnState();
      E.readerContent?.classList.remove("reader-highlight-mode");
      closePalette();
    }
  });
}

export function loadHighlightsForArticle(body) {
  const a = getCurrentArticle();
  articleKey = articleHash(a);
  if (!articleKey || !body) return;
  const store = getStore();
  if (store[articleKey]) applyHighlights(body, store[articleKey]);
}
