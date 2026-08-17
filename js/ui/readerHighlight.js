import { E } from "../core/dom.js";
import { getCurrentArticle } from "../library/bookmarks.js";

const STORAGE_KEY = "nd:readerHighlights";
const COLORS_LIGHT = ["#F4D35E", "#7FD8A6", "#72C7E8", "#B69BE8", "#F4A261", "#F08080", "#EFA3B5"];
const COLORS_DARK  = ["#c9a820", "#3a9e6a", "#3a8db5", "#7a5ec0", "#c47a30", "#b84040", "#c56080"];
const CSS_VARS = ["--hl-1", "--hl-2", "--hl-3", "--hl-4", "--hl-5", "--hl-6", "--hl-7"];

let active = false;
let paletteOpen = false;
let selectedIdx = 0;
let articleKey = null;

function isDark() {
  return document.documentElement?.getAttribute("data-theme") === "dark";
}
function resolvedColor(idx) {
  return isDark() ? COLORS_DARK[idx] : COLORS_LIGHT[idx];
}
function cssVarColor(idx) {
  return `var(${CSS_VARS[idx]})`;
}

// ── localStorage ──────────────────────────────────────────
function getStore() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveStore(store) { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }

function articleHash(a) {
  if (!a) return null;
  const raw = (a._id || a.id || "") + "|" + (a.title || "");
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  return "h" + (h >>> 0).toString(36);
}

// ── DOM helpers ───────────────────────────────────────────
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

function hexFromBg(val) {
  if (!val || val === "transparent" || val === "rgba(0, 0, 0, 0)") return null;
  if (val.startsWith("#")) {
    let hex = val.slice(1);
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return "#" + hex.toUpperCase();
  }
  const m = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return "#" + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function colorIndexFromBg(bgRaw) {
  const hex = hexFromBg(bgRaw);
  if (!hex) return 0;
  const idx = COLORS_LIGHT.indexOf(hex);
  return idx !== -1 ? idx : 0;
}

// ── Highlight logic ───────────────────────────────────────
function wrapSelectionInBlock(sel, container, idx) {
  if (sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return false;
  if (range.startContainer === range.endContainer && range.startOffset === range.endOffset) return false;
  const mark = document.createElement("mark");
  mark.className = "reader-highlight";
  mark.style.backgroundColor = cssVarColor(idx);
  mark.dataset.hlColor = idx;
  try {
    range.surroundContents(mark);
    sel.removeAllRanges();
    return true;
  } catch { return false; }
}

function applyHighlights(body, highlights) {
  if (!body || !highlights?.length) return;
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
      mark.style.backgroundColor = cssVarColor(h.color);
      mark.dataset.hlColor = h.color;
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

function reResolveHighlights(body) {
  if (!body) return;
  body.querySelectorAll("mark.reader-highlight").forEach(mark => {
    const bg = mark.style.backgroundColor;
    const idx = colorIndexFromBg(bg);
    mark.style.backgroundColor = cssVarColor(idx);
  });
}

function syncHighlights(body) {
  if (!articleKey || !body) return;
  const marks = [...body.querySelectorAll("mark.reader-highlight")];
  const highlights = marks.map(m => ({
    text: m.textContent,
    color: parseInt(m.dataset.hlColor, 10) || 0,
  }));
  const store = getStore();
  if (highlights.length > 0) store[articleKey] = highlights;
  else delete store[articleKey];
  saveStore(store);
}

// ── Button / palette state ────────────────────────────────
function updateBtnState() {
  const btn = document.getElementById("readerHighlightBtn");
  if (!btn) return;
  btn.classList.toggle("active", active);
  const icon = btn.querySelector("iconify-icon");
  if (icon) icon.style.color = active ? resolvedColor(selectedIdx) : "";
}

function updatePaletteSelection() {
  const pal = document.getElementById("readerHighlightPalette");
  if (!pal) return;
  pal.querySelectorAll(".reader-highlight-swatch").forEach(s => {
    s.classList.toggle("selected", +s.dataset.idx === selectedIdx);
  });
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

function enable() {
  active = true;
  updateBtnState();
  E.readerContent?.classList.add("reader-highlight-mode");
  closePalette();
}

function disable() {
  active = false;
  updateBtnState();
  E.readerContent?.classList.remove("reader-highlight-mode");
  closePalette();
}

function toggle() { active ? disable() : enable(); }

function deactivate() {
  if (!active) return;
  active = false;
  updateBtnState();
  E.readerContent?.classList.remove("reader-highlight-mode");
  closePalette();
}

// ── Palette swatches ──────────────────────────────────────
function buildPalette() {
  const pal = document.getElementById("readerHighlightPalette");
  if (!pal) return;
  pal.innerHTML = "";
  for (let i = 0; i < CSS_VARS.length; i++) {
    const swatch = document.createElement("button");
    swatch.className = "reader-highlight-swatch";
    swatch.dataset.idx = i;
    swatch.style.backgroundColor = `var(${CSS_VARS[i]})`;
    swatch.title = resolvedColor(i);
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedIdx = i;
      updatePaletteSelection();
      const icon = document.querySelector("#readerHighlightBtn iconify-icon");
      if (icon) icon.style.color = resolvedColor(i);
      closePalette();
      if (!active) enable();
    });
    pal.appendChild(swatch);
  }
}

// ── Public API ────────────────────────────────────────────
export function initReaderHighlight() {
  const btn = document.getElementById("readerHighlightBtn");
  const body = E.readerContent;
  if (!btn || !body) return;

  buildPalette();

  // Toggle button — click toggles mode on/off; if palette open, close it instead
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (paletteOpen) { closePalette(); return; }
    if (!active) { openPalette(); updatePaletteSelection(); return; }
    toggle();
  });

  // Highlight / remove on mouseup — only when active
  body.addEventListener("mouseup", (e) => {
    if (!active) return;

    // Remove existing highlight on click
    if (e.target.closest("mark.reader-highlight")) {
      const mark = e.target.closest("mark.reader-highlight");
      removeHighlight(mark);
      syncHighlights(body);
      return;
    }

    // Apply new highlight on text selection
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const text = sel.toString().trim();
      if (!text) return;
      const block = getBlockAncestor(sel.anchorNode) || getBlockAncestor(sel.focusNode) || body;
      if (wrapSelectionInBlock(sel, block, selectedIdx)) syncHighlights(body);
    });
  });

  // Re-apply saved highlights when content is replaced (e.g. new article loaded)
  const observer = new MutationObserver(() => {
    if (!articleKey) return;
    const existing = body.querySelectorAll("mark.reader-highlight");
    if (existing.length === 0) {
      const store = getStore();
      if (store[articleKey]) applyHighlights(body, store[articleKey]);
    }
  });
  observer.observe(body, { childList: true, subtree: true });

  // Theme observer: no-op — CSS variables auto-update the colors
  const themeObserver = new MutationObserver(() => {});
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Deactivate on close
  E.closeReader?.addEventListener("click", deactivate);
  E.readerModal?.addEventListener("click", (e) => { if (e.target === E.readerModal) deactivate(); });
}

export function loadHighlightsForArticle(body) {
  const a = getCurrentArticle();
  articleKey = articleHash(a);
  if (!articleKey || !body) return;
  const store = getStore();
  if (store[articleKey]) applyHighlights(body, store[articleKey]);
}
