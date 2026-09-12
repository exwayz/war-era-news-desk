// Article Jotter — War-Era-compatible rich text editor (see docs/warera-editor-reference.md).
// A contenteditable surface + execCommand toolbar, serializing to TipTap HTML via ./serialize.js.

import { serializeEditorHtml } from "./serialize.js";
import { offlineLookups } from "../../data/offlineLookups.js";
import { toast } from "../ui/toast.js";
import { resolveEntityByType } from "../core/resolver.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { debounce, entityDisplayName } from "../core/utils.js";

const LS_DRAFTS = "wa-nd-jotter-drafts";
const LS_IMAGES = "wa-nd-jotter-images";
const LS_TITLE = "wa-nd-jotter-title";
const LS_EDITOR = "wa-nd-jotter-editor";
const LS_JOTTER_ZOOM = "wa-nd-jotter-zoom";
const ZOOM_MIN = 60, ZOOM_MAX = 180, ZOOM_STEP = 5, ZOOM_DEFAULT = 100;

function loadStr(key, fb) { try { const v = localStorage.getItem(key); return v == null ? fb : JSON.parse(v); } catch { return fb; } }
function saveStr(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function clampZoom(v) { return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v)); }

// NodeFilter constants as local consts so the module also runs under Node/jsdom.
const NF = {
  SHOW_ELEMENT: 1, SHOW_TEXT: 4,
  FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3,
};

const FONTS = [
  { label: "Default", value: "" },
  { label: "Times New Roman", value: "\"Times New Roman\", Times, serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Courier New", value: "\"Courier New\", Courier, monospace" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Monospace", value: "monospace" },
  { label: "Caesar Dressing", value: "\"Caesar Dressing\", system-ui" },
  { label: "Kode Mono", value: "\"Kode Mono\", monospace" },
  { label: "Lacquer", value: "\"Lacquer\", system-ui" },
  { label: "Pixelify Sans", value: "\"Pixelify Sans\", sans-serif" },
  { label: "Skranji", value: "\"Skranji\", system-ui" },
  { label: "Texturina", value: "\"Texturina\", serif" },
  { label: "Tiny5", value: "\"Tiny5\", sans-serif" },
];

const COLORS = [
  { label: "Default", value: "" },
  { label: "Red", value: "#ed676a" },
  { label: "Deep Orange", value: "#ec8e84" },
  { label: "Orange", value: "#eb9a7f" },
  { label: "Light Orange", value: "#e8b17f" },
  { label: "Amber", value: "#ddba81" },
  { label: "Yellow", value: "#d5ca7f" },
  { label: "Olive", value: "#bbda80" },
  { label: "Lime", value: "#abc799" },
  { label: "Light Green", value: "#7bc78f" },
  { label: "Green", value: "#29c58d" },
  { label: "Emerald", value: "#4fd6af" },
  { label: "Teal", value: "#39d6c4" },
  { label: "Cyan", value: "#5ac5ce" },
  { label: "Light Blue", value: "#5abced" },
  { label: "Blue", value: "#76a1e3" },
  { label: "Indigo", value: "#998dd7" },
  { label: "Purple", value: "#b192d1" },
  { label: "Violet", value: "#c292cf" },
  { label: "Pink", value: "#da88bb" },
  { label: "Deep Pink", value: "#eb8696" },
  { label: "Brown", value: "#bab0ad" },
  { label: "Sand", value: "#b7b8ad" },
  { label: "Gray", value: "#9abbc4" },
];

const OFFLINE_KEY = { country: "countries", region: "regions", alliance: "alliances", party: "parties", mu: "mus" };
const DATA_KEY = { user: "userId", country: "countryId", region: "regionId", alliance: "allianceId", mu: "muId", party: "partyId" };

const TRUSTED_HOSTS = [
  "imgur.com", "i.imgur.com",
  "giphy.com", "media.giphy.com",
  "media0.giphy.com", "media1.giphy.com", "media2.giphy.com", "media3.giphy.com", "media4.giphy.com",
  "tenor.com", "media.tenor.com", "c.tenor.com",
  "cloudinary.com", "res.cloudinary.com",
  "postimages.org", "i.postimages.org",
  "postimg.cc", "i.postimg.cc",
  "imgbb.com", "ibb.co", "i.ibb.co",
  "imagebam.com", "www.imagebam.com", "thumbs2.imagebam.com",
];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function loadLS(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : fallback; } catch { return fallback; }
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

let drafts = [];
let images = [];
let savedRange = null;
let savedAnchor = -1;      // char-pos fallback so the caret survives node replacement
let savedFocus = -1;
let mention = null;        // {anchorNode, anchorOffset, text, searched, results, active, seq, rect}

let userIndex = null;      // lazy id→name map
let userIndexPromise = null;

let findState = { term: "", matches: [], idx: -1 };

const J = { zoom: ZOOM_DEFAULT };

export async function initJotter() {
  if (J.done) return;
  J.done = true;

  J.title = document.getElementById("jTitleInput");
  J.titleClear = document.getElementById("jTitleClear");
  J.toolbar = document.getElementById("jToolbar");
  J.editor = document.getElementById("jEditor");
  J.infoBar = document.getElementById("jInfoBar");
  J.draftList = document.getElementById("jDraftList");
  J.imageGrid = document.getElementById("jImageGrid");
  J.imageUrl = document.getElementById("jImageUrlInput");
  J.imageAdd = document.getElementById("jImageAddBtn");
  J.blockSelect = document.getElementById("jBlockSelect");
  J.fontSelect = document.getElementById("jFontSelect");
  J.colorSelect = document.getElementById("jColorSelect");

  // Editor sidebar
  J.zoomIn = document.getElementById("jZoomIn");
  J.zoomPct = document.getElementById("jZoomPct");
  J.zoomOut = document.getElementById("jZoomOut");
  J.undoBtn = document.getElementById("jUndoBtn");
  J.redoBtn = document.getElementById("jRedoBtn");
  J.findBtn = document.getElementById("jFindBtn");
  J.spellBtn = document.getElementById("jSpellBtn");
  J.clearBtn = document.getElementById("jClearBtn");

  // Find & replace popup
  J.findPop = document.getElementById("jFindPop");
  J.findInput = document.getElementById("jFindInput");
  J.findCount = document.getElementById("jFindCount");
  J.findClose = document.getElementById("jFindClose");
  J.findNextBtn = document.getElementById("jFindNextBtn");
  J.findReplaceChk = document.getElementById("jFindReplaceChk");
  J.findReplaceBox = document.getElementById("jFindReplaceBox");
  J.replaceInput = document.getElementById("jReplaceInput");
  J.replaceOneBtn = document.getElementById("jReplaceOneBtn");
  J.replaceAllBtn = document.getElementById("jReplaceAllBtn");

  document.execCommand("styleWithCSS", false, "true");

  drafts = loadLS(LS_DRAFTS, []);
  images = loadLS(LS_IMAGES, []);
  renderDrafts();
  renderImages();

  // Restore persisted title & editor content
  const savedTitle = loadStr(LS_TITLE, "");
  if (savedTitle) J.title.value = savedTitle;
  const savedEditor = loadStr(LS_EDITOR, "");
  if (savedEditor) { J.editor.innerHTML = savedEditor; rehydrateEntityNames(); updateInfoBar(); }

  populateSelect(J.fontSelect, FONTS, (o, f) => { o.value = f.value; o.textContent = f.label; if (f.value) o.style.fontFamily = f.value; });
  populateSelect(J.colorSelect, COLORS, (o, c) => { o.value = c.value; o.textContent = c.label; if (c.value) o.style.background = c.value; });
  populateSelect(J.blockSelect, [
    { v: "p", label: "P" }, { v: "h1", label: "H1" }, { v: "h2", label: "H2" }, { v: "h3", label: "H3" },
  ], (o, b) => { o.value = b.v; o.textContent = b.label; });

  // Panel head buttons
  document.getElementById("jSaveDraftBtn").addEventListener("click", () => saveDraft());
  document.getElementById("jCopyHtmlBtn").addEventListener("click", () => copyHtml());
  document.getElementById("jOpenWriterBtn").addEventListener("click", () =>
    window.open("https://app.warera.io/news/write", "_blank", "noopener"));

  // Title persistence
  J.title.addEventListener("input", persistTitle);
  J.titleClear.addEventListener("click", () => { J.title.value = ""; saveStr(LS_TITLE, ""); J.title.focus(); });

  // Toolbar
  J.toolbar.addEventListener("mousedown", (e) => {
    // Keep focus + selection for everything except <select> (its dropdown
    // needs the default mousedown). savedRange protects operations from selects.
    if (!e.target.closest("select")) e.preventDefault();
  });
  J.toolbar.addEventListener("click", (e) => syncSelection());
  J.toolbar.addEventListener("click", (e) => onToolbarClick(e));

  J.blockSelect.addEventListener("change", () => { withSelection(() => fmtBlock(J.blockSelect.value)); });
  J.fontSelect.addEventListener("change", () => {
    const v = J.fontSelect.value;
    withSelection(() => {
      if (v) document.execCommand("fontName", false, v);
      else {
        unstyleInline("font");
        // "Default" must also clear the browser's persistent typing font —
        // execCommand("fontName") on a collapsed caret remembers it for the
        // next keystrokes, which is why a once-picked font kept sticking.
        document.execCommand("fontName", false, getComputedStyle(J.editor).fontFamily);
      }
    });
  });
  J.colorSelect.addEventListener("change", () => {
    const v = J.colorSelect.value;
    withSelection(() => {
      if (v) document.execCommand("foreColor", false, v);
      else {
        unstyleInline("color");
        document.execCommand("foreColor", false, getComputedStyle(J.editor).color);
      }
    });
  });

  // Editor events
  J.editor.addEventListener("input", () => { updateInfoBar(); syncSelection(); onEditorInput(); schedulePersist(); });
  J.editor.addEventListener("keydown", (e) => onEditorKeydown(e));
  J.editor.addEventListener("keyup", () => { syncSelection(); updateInfoBar(); });
  J.editor.addEventListener("mouseup", () => { syncSelection(); updateInfoBar(); });
  J.editor.addEventListener("paste", (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData)?.getData("text/plain") || ""; insertTextSanitized(t); });

  // Sidebar buttons
  J.zoomIn?.addEventListener("click", () => { J.zoom = clampZoom(J.zoom + ZOOM_STEP); applyZoom(); });
  J.zoomOut?.addEventListener("click", () => { J.zoom = clampZoom(J.zoom - ZOOM_STEP); applyZoom(); });
  J.zoomPct?.addEventListener("click", () => { J.zoom = ZOOM_DEFAULT; applyZoom(); });
  J.editor.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    J.zoom = clampZoom(J.zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    applyZoom();
  }, { passive: false });
  J.zoom = clampZoom(Number(localStorage.getItem(LS_JOTTER_ZOOM) || ZOOM_DEFAULT) || ZOOM_DEFAULT);
  applyZoom();

  J.undoBtn?.addEventListener("click", () => apply("undo"));
  J.redoBtn?.addEventListener("click", () => apply("redo"));
  J.spellBtn?.addEventListener("click", () => {
    J.editor.spellcheck = !J.editor.spellcheck;
    J.spellBtn.classList.toggle("is-active", !!J.editor.spellcheck);
    if (J.editor.spellcheck) forceSpellcheckRescan();
    J.editor.focus({ preventScroll: true });
  });
  J.spellBtn?.classList.toggle("is-active", !!J.editor.spellcheck);
  J.clearBtn?.addEventListener("click", () => clearEditor());

  // Find & replace
  J.findBtn?.addEventListener("click", () => { if (J.findPop && J.findPop.hidden) openFind(); else hideFind(); });
  J.findClose?.addEventListener("click", () => hideFind());
  J.findNextBtn?.addEventListener("click", () => findNext());
  J.replaceOneBtn?.addEventListener("click", () => replaceCurrent());
  J.replaceAllBtn?.addEventListener("click", () => replaceAll());
  J.findReplaceChk?.addEventListener("change", () => {
    const on = J.findReplaceChk.checked;
    if (J.findReplaceBox) J.findReplaceBox.hidden = !on;
    if (J.replaceOneBtn) J.replaceOneBtn.hidden = !on;
    if (J.replaceAllBtn) J.replaceAllBtn.hidden = !on;
    if (on) J.replaceInput?.focus();
  });
  J.findInput?.addEventListener("input", () => { findState.matches = []; findState.idx = -1; findState.term = ""; updateFindLabel(); });
  J.findInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); findNext(); }
    if (e.key === "Escape") { e.preventDefault(); hideFind(); }
  });
  J.replaceInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); replaceCurrent(); }
    if (e.key === "Escape") { e.preventDefault(); hideFind(); }
  });
  if (J.findPop) J.findPop.addEventListener("mousedown", (e) => e.preventDefault());

  // Close the find popup when the user clicks elsewhere in the app.
  document.addEventListener("mousedown", (e) => {
    if (J.findPop && !J.findPop.hidden && e.target.closest && !e.target.closest(".j-find-pop") && !e.target.closest("#jFindBtn")) hideFind();
  }, true);

  document.addEventListener("selectionchange", () => {
    // No activeElement gate: the editor never "has" focus while a toolbar
    // <select> holds it, yet the DOM range must stay current or toolbar
    // commands keep targeting the last select-driven position.
    const r = window.getSelection();
    if (r.rangeCount && J.editor.contains(r.getRangeAt(0).startContainer)) {
      savedRange = r.getRangeAt(0).cloneRange();
      if (mention) hideMention();
      updateInfoBar();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (mention && J.pop && !J.pop.contains(e.target)) hideMention();
  }, true);
  document.addEventListener("mousedown", (e) => {
    if (e.target.closest?.(".j-img-item, .j-img-del, .j-images")) e.preventDefault();
  }, true);

  // Image library
  J.imageAdd.addEventListener("click", () => addImageFromInput());
  J.imageUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addImageFromInput(); } });

  // Mention popup scaffolding — a "@" pill input + live suggestion list
  J.pop = document.createElement("div");
  J.pop.className = "j-mention-pop";
  J.pop.style.display = "none";
  J.pop.innerHTML =
    '<div class="j-mention-pill"><span class="j-mention-at">@</span>' +
    '<input type="text" class="j-mention-input" placeholder="Type to search user, country, region…" autocomplete="off" spellcheck="false" data-lpignore="true">' +
    "</div><div class=\"j-mention-list\"></div>";
  J.popInput = J.pop.querySelector(".j-mention-input");
  J.popList = J.pop.querySelector(".j-mention-list");
  J.popInput.addEventListener("input", onPillInput);
  J.popInput.addEventListener("keydown", onPillKeydown);
  J.popInput.addEventListener("blur", () => { if (mention) hideMention(); });
  J.pop.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
  J.pop.addEventListener("click", (e) => {
    const item = e.target.closest(".j-mention-item");
    if (item) { compleMention(item.dataset.id, item.dataset.type); return; }
  });
  // Anchor the popup inside the editor wrapper (position: relative) so it stays
  // with the caret and never depends on viewport/fixed-position math. The wrap
  // scrolls internally, so reposition on any scroll/resize while mention is open.
  J.popHost = J.editor.closest(".j-editor-wrap") || J.editor.parentElement;
  J.popHost.appendChild(J.pop);
  J.popHost.addEventListener("scroll", () => { if (mention) positionMentionPopup(); }, true);
  window.addEventListener("resize", () => { if (mention) positionMentionPopup(); });
  window.addEventListener("scroll", () => { if (mention) positionMentionPopup(); }, true);

  if ((J.editor.textContent || "").trim()) rehydrateEntityNames();
  updateNavButtons();
}

/* ── SMALL HELPERS ─────────────────────────────────────── */

function populateSelect(sel, list, render) {
  sel.innerHTML = "";
  for (const it of list) {
    const o = document.createElement("option");
    render(o, it);
    sel.appendChild(o);
  }
}

function charPosAt(container, offset) {
  const pre = document.createRange();
  pre.selectNodeContents(J.editor);
  pre.setEnd(container, offset);
  return pre.toString().length;
}

function rangeFromPos(pos) {
  const tw = document.createTreeWalker(J.editor, NF.SHOW_TEXT);
  let acc = 0, node;
  while ((node = tw.nextNode())) {
    const len = node.data.length;
    if (acc + len >= pos) {
      const r = document.createRange();
      r.setStart(node, Math.min(len, pos - acc));
      r.collapse(true);
      return r;
    }
    acc += len;
  }
  const r = document.createRange();
  const last = J.editor.lastChild;
  if (last && last.nodeType === 1) { r.selectNodeContents(last); r.collapse(false); }
  else { r.selectNodeContents(J.editor); r.collapse(true); }
  return r;
}

function syncSelection() {
  const sel = window.getSelection();
  if (sel.rangeCount && J.editor.contains(sel.getRangeAt(0).startContainer)) {
    const range = sel.getRangeAt(0);
    savedRange = range.cloneRange();
    savedAnchor = charPosAt(range.startContainer, range.startOffset);
    savedFocus = charPosAt(range.endContainer, range.endOffset);
  }
}

function restoreSelection() {
  const sel = window.getSelection();
  // Prefer the exact range; when formatBlock or similar replaces elements
  // the captured text node can detach – fall back to the saved character
  // offset so the caret stays where the user put it instead of jumping
  // back to line 1 col 1.
  let r = null;
  if (savedRange?.startContainer?.isConnected && J.editor.contains(savedRange.startContainer)) {
    r = savedRange.cloneRange();
  } else if (savedAnchor >= 0) {
    const a = rangeFromPos(Math.min(savedAnchor, savedFocus));
    const b = rangeFromPos(Math.max(savedAnchor, savedFocus));
    if (a && b) {
      r = document.createRange();
      r.setStart(a.startContainer, a.startOffset);
      r.setEnd(b.endContainer, b.endOffset);
    }
  }
  if (r) {
    sel.removeAllRanges();
    sel.addRange(r);
  }
  J.editor.focus({ preventScroll: true });
}

function withSelection(fn) {
  restoreSelection();
  const restoreEntities = protectEntities();
  try { fn(); } finally { restoreEntities(); }
  syncSelection();
  updateInfoBar();
}

// Chrome's execCommand formatting (justify, indent, lists, formatBlock, fonts…)
// splits paragraphs around inline contenteditable=false spans and can strip the
// span entirely, keeping only its text. Before any toolbar command runs, swap
// every entity chip for an editable inline marker span — formatting then treats
// it as ordinary text and never restructures the paragraph — and put the real
// chips back after. Result: the DOM keeps the entity as a single inline
// paragraph, so Copy HTML stays correct even after styling.
function protectEntities() {
  const ents = [...J.editor.querySelectorAll("span[data-content-link]")];
  if (!ents.length) return () => {};
  const tokens = [];
  for (let i = 0; i < ents.length; i++) {
    const mark = "\u0001j" + i + "\u0002";
    const tok = document.createElement("span");
    tok.setAttribute("data-jtoken", String(i));
    tok.textContent = mark;
    tokens.push({ mark, ent: ents[i], tok });
    ents[i].replaceWith(tok);
  }
  return () => {
    const found = [];
    for (const { mark, ent, tok } of tokens) {
      let host = tok;
      if (!tok.isConnected) host = locateMark(mark);
      if (!host) { found.push(ent); continue; }   // marker lost — re-insert below
      host.replaceWith(ent);
    }
    for (const ent of found) J.editor.appendChild(ent);  // keep data, never drop
  };
}

// The marker element may rarely be absorbed by formatting; fall back to finding
// its text (the marks use control chars so they can't collide with user text).
function locateMark(mark) {
  const tw = document.createTreeWalker(J.editor, NF.SHOW_TEXT);
  let n = null;
  while ((n = tw.nextNode())) {
    const i = n.data.indexOf(mark);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + mark.length);
    try {
      const holder = document.createElement("span");
      r.surroundContents(holder);
      return holder;
    } catch { return null; }
  }
  return null;
}

function apply(cmd, value) {
  withSelection(() => document.execCommand(cmd, false, value ?? null));
}

function setCaretAfter(node) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
  J.editor.focus({ preventScroll: true });
}

function blockAt(node) {
  if (!node) return null;
  return node.nodeType === 1 ? node.closest?.("p,div,h1,h2,h3,h4,h5,h6,li,pre,blockquote,summary,td") : node.parentElement?.closest?.("p,div,h1,h2,h3,h4,h5,h6,li,pre,blockquote,summary,td");
}

function unstyleInline(prop) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const root = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement);
  if (!root || !J.editor.contains(root)) return;
  // Only touch spans/fonts fully contained in the selection so we never
  // restyle text outside it (execCommand("removeFormat") is not used here —
  // it collapses the selection and can restructure the block).
  const fullyInside = (el) => r.comparePoint(el, 0) === 0 && r.comparePoint(el, el.childNodes.length) === 0;
  const els = [];
  const iter = document.createNodeIterator(root, NF.SHOW_ELEMENT, {
    acceptNode(node) {
      const t = node.tagName;
      if (t !== "SPAN" && t !== "FONT") return NF.FILTER_SKIP;
      if (node.hasAttribute("data-content-link")) return NF.FILTER_SKIP;
      return fullyInside(node) ? NF.FILTER_ACCEPT : NF.FILTER_SKIP;
    },
  });
  let n;
  while ((n = iter.nextNode())) els.push(n);
  els.reverse(); // children before parents so unwrapping stays consistent
  for (const el of els) {
    if (prop === "color") { el.style.removeProperty("color"); el.removeAttribute("color"); }
    else { el.style.removeProperty("font-family"); el.removeAttribute("face"); }
    if (!el.getAttribute("style")) el.removeAttribute("style");
    if (el.attributes.length === 0) el.replaceWith(...el.childNodes);
  }
}

function editorText() { return J.editor.textContent || ""; }

/* ── INFO BAR ──────────────────────────────────────────── */

function subText(n) {
  let s = "";
  for (const k of n.childNodes) {
    if (k.nodeType === 3) s += k.data;
    else if (k.nodeType === 1) {
      if (k.tagName === "BR" || k.tagName === "HR") s += "\n";
      else s += subText(k);
    }
  }
  return s;
}

// Line counter model: render the whole editor to a Notepad-style plain string
// where every visual line ends with "\n" (paragraphs, list items, code-block
// lines, <hr>, <br>). Structural wrappers (BLOCKQUOTE/DETAILS/PRE/UL/OL) never
// add lines themselves, so quote/code/collapsible blocks count correctly
// instead of being double counted or lumped into one "line".
const LINE_UNITS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "DD", "DT", "SUMMARY", "PRE"]);

let plainSig = null;
let plainTextCache = "";

function plainText() {
  const sig = J.editor.textContent + "#" + J.editor.querySelectorAll("*").length;
  if (plainSig === sig) return plainTextCache;
  plainSig = sig;
  const parts = [];
  (function walk(node) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { parts.push(c.data); continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === "BR" || t === "HR") { parts.push("\n"); continue; }
      if (LINE_UNITS.has(t)) { parts.push(subText(c)); parts.push("\n"); continue; }
      walk(c);
    }
  })(J.editor);
  let text = parts.join("");
  if (text.endsWith("\n")) text = text.slice(0, -1);
  plainTextCache = text;
  return plainTextCache;
}

function childPlainLen(c) {
  if (c.nodeType === 3) return c.data.length;
  if (c.nodeType !== 1) return 0;
  const t = c.tagName;
  if (t === "BR" || t === "HR") return 1;
  if (LINE_UNITS.has(t)) return subText(c).length + 1;
  let n = 0;
  for (const k of c.childNodes) n += childPlainLen(k);
  return n;
}

function textNodeStart(target) {
  let found = -1, acc = 0;
  (function walk(node) {
    if (found >= 0) return;
    for (const c of node.childNodes) {
      if (found >= 0) return;
      if (c.nodeType === 3) {
        if (c === target) { found = acc; return; }
        acc += c.data.length;
      } else if (c.nodeType === 1) {
        const t = c.tagName;
        if (t === "BR" || t === "HR") { acc += 1; continue; }
        if (LINE_UNITS.has(t)) { acc += subText(c).length + 1; continue; }
        walk(c);
      }
    }
  })(J.editor);
  return found;
}

function caretPlainPos(container, offset) {
  if (container.nodeType === 3) {
    const start = textNodeStart(container);
    return start >= 0 ? start + offset : offset;
  }
  let sum = 0;
  const kids = container.childNodes;
  for (let i = 0; i < offset && i < kids.length; i++) sum += childPlainLen(kids[i]);
  return sum;
}

function caretMetrics() {
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const inEditor = range && J.editor.contains(range.startContainer);
  const plain = plainText();
  let pos = 0;
  if (inEditor) pos = caretPlainPos(range.startContainer, range.startOffset);
  let ln = 1, col = pos + 1;
  if (pos > 0) {
    let nl = 0, lastNL = -1;
    for (let i = 0; i < pos; i++) {
      if (plain.charCodeAt(i) === 10) { nl++; lastNL = i; }
    }
    ln = nl + 1;
    col = lastNL < 0 ? pos + 1 : pos - lastNL;
  }
  const text = editorText();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  let lines = 1;
  for (let i = 0; i < plain.length; i++) if (plain.charCodeAt(i) === 10) lines++;
  return { chars: text.length, words, lines, ln, col, pos };
}

function updateInfoBar() {
  const m = caretMetrics();
  if (!J.infoBar) return;
  J.infoBar.textContent = `${m.chars} chars · ${m.words} words · ${m.lines} ${m.lines === 1 ? "line" : "lines"} · Ln ${m.ln}, Col ${m.col}, Pos ${m.pos}`;
  updateToolbarState();
}

function setActive(cmd, on) {
  J.toolbar?.querySelector(`[data-cmd="${cmd}"]`)?.classList.toggle("is-active", !!on);
}

// Undo/redo only make sense while the browser history has something to give —
// disable the buttons otherwise. Runs on every toolbar-state sync so it flips
// the moment history changes (typing, undo, redo, bulk load/clear).
function updateNavButtons() {
  let canUndo = false, canRedo = false;
  try { canUndo = !!document.queryCommandEnabled("undo"); } catch {}
  try { canRedo = !!document.queryCommandEnabled("redo"); } catch {}
  if (J.undoBtn) J.undoBtn.disabled = !canUndo;
  if (J.redoBtn) J.redoBtn.disabled = !canRedo;
}
function normFont(s) { return String(s||"").toLowerCase().replace(/["']/g,"").replace(/\s+/g," ").trim(); }
function parseRgb(s) { const m=String(s).match(/rgba?\(([^)]+)\)/); return m ? m[1].split(",").map(x=>Math.round(parseFloat(x))) : [0,0,0]; }
function sameColor(a,b) { const x=parseRgb(a),y=parseRgb(b); return x[0]===y[0]&&x[1]===y[1]&&x[2]===y[2]; }
function hexToRgb(hex) { const v=String(hex).replace(/^#/,""); const n=parseInt(v.length===3?[...v].map(c=>c+c).join(""):v,16); return `rgb(${(n>>16)&255},${(n>>8)&255},${n&255})`; }

function updateToolbarState() {
  updateNavButtons();
  const tb = J.toolbar; if (!tb) return;
  const sel = window.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
  if (!range || !J.editor.contains(range.startContainer)) {
    for (const c of ["bold","italic","underline","strike","code","blockquote","codeBlock","collapsible","orderedList","bulletList","justifyLeft","justifyCenter","justifyRight","justifyFull"]) setActive(c,false);
    return;
  }
  const el = range.startContainer.nodeType===1 ? range.startContainer : range.startContainer.parentElement;
  const block = blockAt(range.startContainer);
  const chain = [];
  for (let n = el; n && n !== J.editor; n = n.parentElement) chain.push(n);

  // Block type select
  const bTag = block ? block.tagName : "P";
  const bVal = ["H1","H2","H3","H4","H5","H6"].includes(bTag) ? bTag.toLowerCase() : "p";
  if (J.blockSelect?.value !== bVal) J.blockSelect.value = bVal;

  // Toggles from the ancestor chain
  let bold=false, italic=false, underline=false, strike=false,
      code=false, blockquote=false, pre=false, details=false, ul=false, ol=false;
  for (const n of chain) {
    const t = n.tagName;
    if (t==="B"||t==="STRONG") bold=true;
    if (t==="I"||t==="EM") italic=true;
    if (t==="U") underline=true;
    if (t==="S"||t==="STRIKE"||t==="DEL") strike=true;
    if (t==="CODE") code=true;
    if (t==="BLOCKQUOTE") blockquote=true;
    if (t==="PRE") pre=true;
    if (t==="DETAILS") details=true;
    if (t==="UL") ul=true;
    if (t==="OL") ol=true;
    const cs = getComputedStyle(n);
    if (parseInt(cs.fontWeight,10)>=600||/^(bold|bolder)$/.test(cs.fontWeight)) bold=true;
    if (cs.fontStyle==="italic"||cs.fontStyle==="oblique") italic=true;
    if ((cs.textDecorationLine||"").includes("underline")) underline=true;
    if ((cs.textDecorationLine||"").includes("line-through")) strike=true;
  }
  setActive("bold",bold); setActive("italic",italic);
  setActive("underline",underline); setActive("strike",strike);
  setActive("code",code); setActive("blockquote",blockquote);
  setActive("codeBlock",pre); setActive("collapsible",details);
  setActive("orderedList",ol); setActive("bulletList",ul);

  // Alignment
  const aligns=[["justifyLeft"],["justifyCenter"],["justifyRight"],["justifyFull"]];
  let anyAlign=false;
  for (const [cmd] of aligns) {
    let on=false; try{on=document.queryCommandState(cmd);}catch{}
    if(on) anyAlign=true;
    setActive(cmd,on);
  }
  if (!anyAlign) setActive("justifyLeft",true); // left implicit default

  // Font / color labels
  if (!J.fontSelect && !J.colorSelect) return;
  const cs = getComputedStyle(el);
  const baseFont = normFont(getComputedStyle(J.editor).fontFamily);
  const baseColor = getComputedStyle(J.editor).color;
  if (J.fontSelect) {
    const fam = normFont(cs.fontFamily);
    let fv = "";
    if (fam && fam !== baseFont) {
      for (const f of FONTS) { if (f.value && normFont(f.value)===fam) { fv=f.value; break; } }
    }
    if (J.fontSelect.value !== fv) J.fontSelect.value = fv;
  }
  if (J.colorSelect) {
    const cur = cs.color;
    let cv = "";
    if (!sameColor(cur, baseColor)) {
      for (const c of COLORS) { if (c.value && sameColor(cur, hexToRgb(c.value))) { cv=c.value; break; } }
    }
    if (J.colorSelect.value !== cv) J.colorSelect.value = cv;
  }
}

/* ── TOOLBAR ───────────────────────────────────────────── */

function onToolbarClick(e) {
  const btn = e.target.closest("[data-cmd]");
  if (!btn) return;
  runCommand(btn.dataset.cmd);
}

function runCommand(cmd) {
  switch (cmd) {
    case "bold": apply("bold"); break;
    case "italic": apply("italic"); break;
    case "underline": apply("underline"); break;
    case "strike": apply("strikeThrough"); break;
    case "code": toggleInlineCode(); break;
    case "justifyLeft": apply("justifyLeft"); break;
    case "justifyCenter": apply("justifyCenter"); break;
    case "justifyRight": apply("justifyRight"); break;
    case "justifyFull": apply("justifyFull"); break;
    case "hr": apply("insertHorizontalRule"); break;
    case "orderedList": apply("insertOrderedList"); break;
    case "bulletList": apply("insertUnorderedList"); break;
    case "indent": apply("indent"); break;
    case "outdent": apply("outdent"); break;
    case "blockquote": toggleBlockquote(); break;
    case "codeBlock": toggleCodeBlock(); break;
    case "collapsible": insertCollapsible(); break;
    case "link": promptRow({ label: "Link URL", placeholder: "https://example.com", onSubmit: (v) => insertLink(v) }); break;
    case "image": promptRow({ label: "Image URL", placeholder: "https://i.imgur.com/…", onSubmit: (v) => insertImage(v) }); break;
    case "youtube": promptRow({ label: "YouTube URL", placeholder: "https://www.youtube.com/watch?v=…", onSubmit: (v) => insertYoutube(v) }); break;
    case "tiktok": promptRow({ label: "TikTok URL", placeholder: "https://www.tiktok.com/@user/video/…", onSubmit: (v) => insertTiktok(v) }); break;
  }
}

function fmtBlock(tag) {
  restoreSelection();
  if (tag === "p") document.execCommand("formatBlock", false, "<p>");
  else document.execCommand("formatBlock", false, `<${tag}>`);
  syncSelection();
  updateInfoBar();
}

function toggleInlineCode() {
  withSelection(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const code = r.startContainer.nodeType === 1 ? r.startContainer.closest("code") : r.startContainer.parentElement?.closest?.("code");
    if (code) { code.replaceWith(...code.childNodes); return; }
    const text = r.toString();
    if (!text) { document.execCommand("insertHTML", false, "<code><br></code>"); return; }
    r.deleteContents();
    const c = document.createElement("code");
    c.textContent = text;
    r.insertNode(c);
    setCaretAfter(c);
  });
}

function unwrapOrWrap(tag, className, onWrap) {
  withSelection(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const block = blockAt(r.startContainer);
    if (block && block.tagName === tag) {
      block.replaceWith(...block.childNodes);
      return;
    }
    const html = r.toString();
    if (!html) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      el.textContent = "";
      r.insertNode(el);
      setCaretAfter(el);
      return;
    }
    const wrapper = document.createElement(tag);
    if (className) wrapper.className = className;
    r.deleteContents();
    wrapper.textContent = html;
    r.insertNode(wrapper);
    setCaretAfter(wrapper);
  });
}

function toggleBlockquote() { unwrapOrWrap("BLOCKQUOTE", "tiptap-blockquote"); }
function toggleCodeBlock() {
  withSelection(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const pre = blockAt(r.startContainer)?.tagName === "PRE" ? blockAt(r.startContainer) : null;
    if (pre) { pre.replaceWith(...pre.childNodes); return; }
    const text = r.toString();
    const preEl = document.createElement("pre");
    preEl.className = "tiptap-code-block";
    const codeEl = document.createElement("code");
    codeEl.textContent = text;
    preEl.appendChild(codeEl);
    if (text) { r.deleteContents(); }
    r.insertNode(preEl);
    setCaretAfter(preEl);
  });
}

function insertCollapsible() {
  withSelection(() => {
    const sel = window.getSelection();
    const summaryText = (sel.toString() || "Collapsible section").trim();
    const html =
      `<details class="tiptap-collapsible" open="open">` +
      `<summary class="tiptap-collapsible-summary"><span class="j-collapse-caret">▸</span>${esc(summaryText)}</summary>` +
      `<div data-collapsible-body="" class="tiptap-collapsible-body"><div class="tiptap-collapsible-body-inner">` +
      `<div class="tiptap-collapsible-body-content"><p class="tiptap-block"><br></p></div></div></div></details>`;
    document.execCommand("insertHTML", false, html);
  });
  schedulePersist();
}

function insertLink(url) {
  if (!url) return;
  apply("createLink", url);
  withSelection(() => {
    for (const a of J.editor.querySelectorAll("a")) {
      if (a.getAttribute("href") === url) {
        a.classList.add("tiptap-link");
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer nofollow");
      }
    }
  });
  schedulePersist();
}

function insertImage(url) {
  const parsed = validateImageUrl(url);
  if (!parsed) { toast("Not a recognised image URL. Use imgur, giphy or tenor direct links."); return; }
  apply("insertHTML", `<img class="tiptap-image" src="${esc(parsed.url)}">`);
  schedulePersist();
}

function validateImageUrl(raw) {
  const url = raw.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const trusted = TRUSTED_HOSTS.some((t) => host === t || host.endsWith("." + t));
  const direct = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
  if (direct && trusted) return { url, kind: "direct" };
  const imgur = url.match(/^https?:\/\/(?:www\.|i\.|m\.)?imgur\.com\/([A-Za-z0-9]+)(?:\.(?:png|jpe?g|gif|webp))?$/i);
  if (imgur) return { url: `https://i.imgur.com/${imgur[1]}.jpg`, kind: "direct" };
  const giphy = url.match(/^https?:\/\/(?:www\.|media\.)?giphy\.com\/(?:gifs|stickers|embed|clips)\/(?:[^/]*-)?([A-Za-z0-9]+)\/?$/i);
  if (giphy) return { url: `https://media.giphy.com/media/${giphy[1]}/giphy.gif`, kind: "direct" };
  return null;
}

/* ── YOUTUBE / TIKTOK EMBEDS ───────────────────────────── */

function youtubeId(input) {
  const s = String(input).trim();
  if (!s) return null;
  let m = s.match(/(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)([A-Za-z0-9_-]{6,})/i);
  if (m) return m[1];
  m = s.match(/(?:https?:\/\/)?(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{6,})/i);
  if (m) return m[1];
  m = s.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{6,}$/.test(s)) return s;
  return null;
}

function tiktokId(input) {
  const s = String(input).trim();
  if (!s) return null;
  let m = s.match(/tiktok\.com\/(?:@[\w.\-]+\/)?video\/(\d+)/i);
  if (m) return m[1];
  m = s.match(/tiktok\.com\/embed\/v2\/(\d+)/i);
  if (m) return m[1];
  if (/^\d{6,20}$/.test(s)) return s;
  return null;
}

function insertYoutube(url) {
  const id = youtubeId(url);
  if (!id) { toast("Not a recognised YouTube URL."); return; }
  apply("insertHTML",
    `<div data-youtube-video=""><iframe class="tiptap-youtube" width="320" height="240" ` +
    `allowfullscreen="true" autoplay="false" disablekbcontrols="false" enableiframeapi="false" ` +
    `endtime="0" ivloadpolicy="0" loop="false" modestbranding="true" origin="" playlist="" rel="1" ` +
    `src="https://www.youtube-nocookie.com/embed/${id}?modestbranding=1&amp;rel=1" start="0"></iframe></div>`);
  schedulePersist();
}

function insertTiktok(url) {
  const id = tiktokId(url);
  if (!id) { toast("Not a recognised TikTok URL."); return; }
  apply("insertHTML",
    `<div class="tiptap-tiktok"><iframe src="https://www.tiktok.com/embed/v2/${id}" videoid="${id}" ` +
    `width="325" height="580" allow="encrypted-media; fullscreen" allowfullscreen="true" ` +
    `frameborder="0" scrolling="no"></iframe></div>`);
  schedulePersist();
}

/* ── PROMPT ROW (link / image) ─────────────────────────── */

function promptRow({ label, placeholder, initial, onSubmit }) {
  const existing = J.toolbar.nextElementSibling;
  if (existing?.classList?.contains("j-prompt-row")) existing.remove();
  const row = document.createElement("div");
  row.className = "j-prompt-row";
  const lbl = document.createElement("span");
  lbl.className = "label";
  lbl.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "j-prompt-input";
  input.placeholder = placeholder;
  input.value = initial || "";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "j-prompt-ok";
  ok.textContent = "OK";
  const x = document.createElement("button");
  x.type = "button";
  x.className = "j-prompt-x";
  x.textContent = "✕";
  x.title = "Cancel";
  row.append(lbl, input, ok, x);

  const finish = (val) => { row.remove(); if (val != null && val !== "") onSubmit(val.trim()); withSelection(() => {}); };
  ok.addEventListener("click", () => finish(input.value));
  x.addEventListener("click", () => finish(null));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(input.value); }
    if (e.key === "Escape") { e.preventDefault(); finish(null); }
  });
  if (J.toolbar.parentNode) J.toolbar.parentNode.insertBefore(row, J.toolbar.nextSibling);
  input.focus();
}

/* ── KEYBOARD SHORTCUTS ────────────────────────────────── */

function onEditorKeydown(e) {
  if ((e.key === "Backspace" || e.key === "Delete") && deleteEntityUnit(e.key === "Backspace" ? "back" : "fwd")) {
    e.preventDefault();
    return;
  }
  if (constrainEntityCaret(e)) return;
  if (e.key === "Tab") {
    e.preventDefault();
    apply(e.shiftKey ? "outdent" : "indent");
    return;
  }
  if (e.key === "@") {
    // Nothing is inserted yet — the "@" lives inside the pill popup until the
    // user confirms a suggestion, which then inserts the entity at the caret.
    e.preventDefault();
    openMention();
    return;
  }
  if (e.key === " ") {
    const block = blockAt(window.getSelection()?.focusNode);
    if (block) {
      const t = (block.innerText || block.textContent).trim();
      if (/^\d+\.$/.test(t) || /^1\.$/.test(t)) { e.preventDefault(); apply("insertOrderedList"); return; }
      if (t === "-" ) { e.preventDefault(); apply("insertUnorderedList"); return; }
    }
    return;
  }
  if (e.key === "Enter") {
    const block = blockAt(window.getSelection()?.focusNode);
    if (block && (block.innerText || block.textContent).trim() === "---") {
      e.preventDefault();
      block.innerHTML = "";
      withSelection(() => document.execCommand("insertHorizontalRule"));
      return;
    }
    if (block && block.tagName === "SUMMARY") {
      e.preventDefault();
      const details = block.closest("details");
      if (details) {
        const p = document.createElement("p");
        p.className = "tiptap-block";
        p.innerHTML = "<br>";
        const body = details.querySelector(".j-collapsible-body-content, [data-collapsible-body] .tiptap-collapsible-body-content, [data-collapsible-body]");
        if (body) body.appendChild(p);
        setCaretAfter(p);
      }
      return;
    }
  }
  updateInfoBar();
}

function onEditorInput() {
  // Text typed in the document while the pill is open means the caret left the
  // "@" anchor — drop the popup (the pill input owns mention typing now).
  if (mention) hideMention();
}

/* ── MENTIONS ──────────────────────────────────────────── */

// Typing "@" opens a pill input anchored at the caret. The user types a name
// inside the pill; each keystroke runs search.searchAnything and the popup
// lists the matching entities. Names resolve instantly from offlineLookups /
// userLookups, or lazily via the article-reader resolver when the local maps
// don't know the ID. Choosing a row (click, Enter or Tab) — or typing the full
// name and pressing Enter before results arrive — inserts the data-content-link
// entity immediately and moves the caret past it.

// Viewport-anchored point for the popup: prefer the caret's first non-empty
// client rect, fall back to the range rect, then to the editor's own box.
function caretAnchorRect() {
  const sel = window.getSelection();
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!r || !J.editor.contains(r.startContainer)) return null;
  let rect = null;
  try { rect = r.getClientRects()[0] || null; } catch {}
  if (!rect || (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0)) {
    try { rect = r.getBoundingClientRect(); } catch { rect = null; }
  }
  if (!rect || (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0)) {
    const er = J.editor.getBoundingClientRect();
    if (er && (er.width || er.height)) return { top: er.top + 24, left: er.left + 4 };
    return null;
  }
  return { top: rect.bottom + 4, left: rect.left };
}

function openMention() {
  const sel = window.getSelection();
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!r || !J.editor.contains(r.startContainer)) return;
  const anchor = caretAnchorRect();
  mention = {
    anchorNode: r.startContainer,
    anchorOffset: r.startOffset,
    rect: anchor,
    text: "",
    searched: "",
    results: [],
    active: -1,
    lastErr: "",
    seq: 0,
  };
  J.popInput.value = "";
  J.popList.innerHTML = "";
  J.pop.style.display = "block";
  renderMentionList();
  getUserIndexSync();
  J.popInput.focus({ preventScroll: true });
  // Re-anchor once the popup + caret layout has settled (focus may scroll/flush).
  setTimeout(() => { if (mention) positionMentionPopup(); }, 0);
}

function positionMentionPopup() {
  const p = J.pop;
  const wrap = J.popHost;
  if (!p || !wrap || p.style.display === "none" || !mention) return;
  let rect = anchorViewportRect();
  if (!rect && mention.rect) {
    rect = { left: mention.rect.left, top: mention.rect.top, bottom: mention.rect.top, width: 0, height: 0 };
  }
  if (!rect) return;
  // Both rects are live viewport coordinates, so the deltas stay correct
  // regardless of page scroll, transforms, or zoom — no offsetParent math.
  const w = wrap.getBoundingClientRect();
  let top = (rect.bottom + 4) - w.top;
  let left = rect.left - w.left;
  const maxTop = Math.max(4, wrap.clientHeight - p.offsetHeight);
  const maxLeft = Math.max(4, wrap.clientWidth - p.offsetWidth);
  p.style.top = Math.max(4, Math.min(top, maxTop)) + "px";
  p.style.left = Math.max(4, Math.min(left, maxLeft)) + "px";
}

// Re-measure the caret from the stored anchor so the popup follows scrolls and
// layout shifts without us having to track scroll offsets.
function anchorViewportRect() {
  const a = mention?.anchorNode;
  if (!a || !a.isConnected) return null;
  const r = document.createRange();
  r.setStart(a, mention.anchorOffset || 0);
  r.collapse(true);
  let rect = null;
  try { rect = r.getClientRects()[0] || null; } catch {}
  if (!rect || (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0)) {
    try { rect = r.getBoundingClientRect(); } catch { rect = null; }
  }
  return rect;
}

function onPillInput() {
  if (!mention) return;
  mention.text = J.popInput.value;
  mention.searched = "";
  mention.results = [];
  mention.active = -1;
  mention.lastErr = "";
  renderMentionList();
  scheduleSearch();
}

function onPillKeydown(e) {
  if (!mention) return;
  const items = J.popList.querySelectorAll(".j-mention-item");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!items.length) return;
    const dir = e.key === "ArrowDown" ? 1 : -1;
    mention.active = mention.active < 0
      ? (dir === 1 ? 0 : items.length - 1)
      : (mention.active + dir + items.length) % items.length;
    renderMentionList();
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    const active = items[mention.active] || items[0];
    if (active) { compleMention(active.dataset.id, active.dataset.type); return; }
    completeByText();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelMention();
  } else if (e.key === "Backspace" && !J.popInput.value) {
    e.preventDefault();
    cancelMention();
  }
}

const scheduleSearch = debounce(runSearch, 120);

function runSearch() {
  if (!mention) return;
  const text = (mention.text || "").trim();
  const k = apiKey();
  if (!text) {
    mention.results = [];
    mention.searched = "";
    mention.active = -1;
    renderMentionList();
    return;
  }
  if (!k) {
    mention.results = [];
    mention.lastErr = "API key missing";
    mention.searched = text;
    renderMentionList();
    return;
  }
  const seq = ++mention.seq;
  fetchTrpc("search.searchAnything", { searchText: text }, k)
    .then((res) => {
      if (!mention || mention.seq !== seq) return;
      const d = unwrap(res) || {};
      const rows = [];
      for (const [type, ids] of [
        ["user", d.userIds], ["country", d.countryIds], ["region", d.regionIds],
        ["party", d.partyIds], ["mu", d.muIds], ["alliance", d.allianceIds],
      ]) {
        for (const id of (ids || [])) rows.push({ type, id, name: "" });
      }
      mention.results = rows.slice(0, 80);
      mention.lastErr = "";
      mention.searched = text;
      mention.active = 0;
      renderMentionList();
      fillNames(rows);
    })
    .catch(() => {
      if (!mention || mention.seq !== seq) return;
      mention.results = [];
      mention.lastErr = "Search failed";
      mention.searched = text;
      renderMentionList();
    });
}

function renderMentionList() {
  if (!mention || !J.popList) return;
  const list = J.popList;
  list.innerHTML = "";
  const hint = (msg) => {
    const div = document.createElement("div");
    div.className = "j-mention-empty";
    div.textContent = msg;
    list.appendChild(div);
  };
  const text = (mention.text || "").trim();
  if (!text) {
    hint("Type to search @user / @country / @region / @party / @mu / @alliance …");
    return;
  }
  if (mention.searched !== text) { hint("Searching…"); return; }
  if (!mention.results.length) { hint(mention.lastErr || "No matches"); return; }
  let i = 0;
  for (const row of mention.results) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "j-mention-item" + (i === mention.active ? " is-active" : "");
    b.dataset.id = row.id;
    b.dataset.type = row.type;
    const t = document.createElement("span");
    t.className = "j-mi-type";
    t.textContent = "@" + row.type;
    const n = document.createElement("span");
    n.className = "j-mi-name";
    n.textContent = row.name || "…";
    b.append(t, n);
    list.appendChild(b);
    i++;
  }
  positionMentionPopup();
}

function localName(type, id) {
  const map = type === "user" ? userIndex : offlineLookups[OFFLINE_KEY[type]];
  return map?.[id] || "";
}

function fillNames(rows) {
  const k = apiKey();
  let waitingUsers = false;
  let filled = false;
  for (const row of rows) {
    if (!row.name) row.name = localName(row.type, row.id);
    if (row.name) filled = true;
    else if (row.type === "user" && userIndexPromise) waitingUsers = true;
  }
  if (filled) renderMentionList();
  if (waitingUsers) {
    userIndexPromise
      .then(() => {
        let changed = false;
        for (const row of rows) if (!row.name && (row.name = localName(row.type, row.id))) changed = true;
        if (changed) renderMentionList();
      })
      .catch(() => {});
  }
  for (const row of rows) {
    if (row.name) continue;
    resolveEntityByType(row.type, row.id, k)
      .then((data) => {
        if (!data) {
          if (!row.name) { row.name = row.id; renderMentionList(); }
          return;
        }
        row.name = entityDisplayName(row.type, row.id, data);
        renderMentionList();
      })
      .catch(() => {
        if (!row.name) { row.name = row.id; renderMentionList(); }
      });
  }
}

function compleMention(id, type) {
  if (!mention) return;
  const anchor = { node: mention.anchorNode, off: mention.anchorOffset };
  const row = mention.results.find((r) => r.type === type && r.id === id);
  const name = row?.name || localName(type, id) || id;
  mention = null;
  J.pop.style.display = "none";
  J.popInput.value = "";
  J.popList.innerHTML = "";
  if (!anchor.node?.isConnected) return;
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(anchor.node, anchor.off);
  r.collapse(true);
  const ent = document.createElement("span");
  ent.setAttribute("data-content-link", "");
  ent.setAttribute("data-content-type", type);
  ent.setAttribute("data-content-data", JSON.stringify({ [DATA_KEY[type]]: id, fullMatch: `/${type}/${id}` }));
  ent.setAttribute("data-original-text", `/${type}/${id}`);
  // Non-editable chip keeps the caret out and reads as one unit; browsers can
  // split paragraphs around an inline contenteditable=false span, so the copy
  // serializer heals that back at export time (see mergeEntityParagraphs).
  ent.setAttribute("contenteditable", "false");
  ent.textContent = name;
  r.insertNode(ent);
  placeCaretAfter(ent);
  updateInfoBar();
  schedulePersist();
}

// Treat a data-content-link entity as one atomic unit: a single Backspace /
// Delete while adjacent to (or inside) the span removes the whole entity with
// one keystroke instead of eating characters one by one.
function deleteEntityUnit(dir) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return false;
  const c = r.startContainer;
  const o = r.startOffset;
  let ent = null;
  const isEnt = (n) => n && n.nodeType === 1 && n.hasAttribute?.("data-content-link");
  if (c.nodeType === 3) {
    const inside = c.parentElement?.closest?.("[data-content-link]");
    if (inside) ent = inside;
    else if (dir === "back" && o === 0 && isEnt(c.previousSibling)) ent = c.previousSibling;
    else if (dir === "fwd" && o === c.length && isEnt(c.nextSibling)) ent = c.nextSibling;
  } else if (c.nodeType === 1) {
    const child = c.childNodes[dir === "back" ? o - 1 : o];
    if (isEnt(child)) ent = child;
  }
  if (!ent) return false;
  const before = document.createRange();
  before.setStartBefore(ent);
  before.collapse(true);
  sel.removeAllRanges();
  sel.addRange(before);
  ent.remove();
  updateInfoBar();
  return true;
}

// The chip behaves like contenteditable=false without the DOM side-effects:
// if the caret ever lands inside a data-content-link span's text, bounce it
// out to just after the span and swallow the key so the name can't be edited
// from inside and following typing stays out of the chip.
function constrainEntityCaret(e) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return false;
  const c = r.startContainer;
  let inside = null;
  if (c.nodeType === 3) inside = c.parentElement?.closest?.("[data-content-link]") || null;
  else if (c.nodeType === 1 && c.hasAttribute?.("data-content-link")) inside = c;
  else if (c.nodeType === 1) {
    const ch = c.childNodes[r.startOffset];
    if (ch?.nodeType === 1 && ch.hasAttribute?.("data-content-link")) inside = ch;
  }
  if (!inside) return false;
  e.preventDefault();
  placeCaretAfter(inside);
  return true;
}

// Move the caret to just after an inline element so further typing stays out of it.
function placeCaretAfter(el) {
  const sel = window.getSelection();
  const parent = el.parentNode;
  if (!parent || !sel) return;
  const idx = Array.prototype.indexOf.call(parent.childNodes, el) + 1;
  J.editor.focus({ preventScroll: true });
  const r = document.createRange();
  r.setStart(parent, idx);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// Enter with no suggestion picked: complete exactly typed names straight from the
// local lookup maps (userLookups / offlineLookups), so a fast "type name + Enter"
// works without waiting for search results.
function completeByText() {
  if (!mention) return;
  const text = J.popInput.value.trim();
  if (!text) return;
  const finish = () => {
    const match = localMatchByText(text);
    if (match) compleMention(match.id, match.type);
  };
  if (userIndex || !userIndexPromise) { finish(); return; }
  userIndexPromise.then(finish).catch(finish);
}

function localMatchByText(text) {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  if (userIndex) {
    for (const [id, name] of Object.entries(userIndex)) {
      if (String(name).toLowerCase() === q) return { type: "user", id };
    }
  }
  for (const [type, key] of Object.entries(OFFLINE_KEY)) {
    const map = offlineLookups[key];
    if (!map) continue;
    for (const [id, name] of Object.entries(map)) {
      if (String(name).toLowerCase() === q) return { type, id };
    }
  }
  return null;
}

function cancelMention() {
  if (!mention) return;
  const anchor = mention.anchorNode;
  const off = mention.anchorOffset;
  mention = null;
  J.pop.style.display = "none";
  J.popInput.value = "";
  J.popList.innerHTML = "";
  if (anchor?.isConnected) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(anchor, off);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  J.editor.focus({ preventScroll: true });
}

function hideMention() {
  if (J.pop) J.pop.style.display = "none";
  mention = null;
}

function getUserIndexSync() {
  if (userIndex) return userIndex;
  if (!userIndexPromise) {
    userIndexPromise = import("../../data/userLookups.js")
      .then((m) => { userIndex = m.userLookups?.users || {}; return userIndex; })
      .catch((err) => { console.warn("userLookups unavailable", err); userIndex = {}; return userIndex; });
  }
  return null;
}

// Entities serialize as empty spans (War Era keeps only the attributes); on
// reload, put the display name back from the local lookup maps so the editor
// shows the chip again.
function rehydrateEntityNames() {
  for (const ent of [...J.editor.querySelectorAll("[data-content-link]")]) {
    if ((ent.textContent || "").trim()) continue;
    let data = null;
    try { data = JSON.parse(ent.getAttribute("data-content-data") || "null"); } catch {}
    const type = ent.getAttribute("data-content-type");
    const key = type && DATA_KEY[type];
    const id = (data && key && data[key]) ||
      (data && data.fullMatch || "").split("/").filter(Boolean).pop() || "";
    const name = (type && id && localName(type, id)) || data?.fullMatch || "";
    if (name) {
      ent.textContent = name;
      if (ent.getAttribute("contenteditable") !== "false") ent.setAttribute("contenteditable", "false");
    }
  }
}

/* ── DRAFTS ────────────────────────────────────────────── */

function currentDraftPayload() {
  return { title: J.title.value.trim(), html: serializeEditorHtml(J.editor), updatedAt: Date.now() };
}

function saveDraft() {
  const saved = currentDraftPayload();
  const id = uid();
  drafts = [{ id, title: saved.title || "Untitled draft", html: saved.html, savedAt: Date.now() }, ...drafts];
  saveLS(LS_DRAFTS, drafts);
  renderDrafts();
  toast("Draft saved.");
}

function loadDraft(id) {
  const d = drafts.find((x) => x.id === id);
  if (!d) return;
  J.title.value = d.title;
  J.editor.innerHTML = d.html;
  rehydrateEntityNames();
  updateInfoBar();
  renderDrafts(id);
  saveStr(LS_TITLE, d.title);
  persistEditor();
  toast(`Loaded "${d.title}".`);
}

function renameDraft(id, title) {
  drafts = drafts.map((x) => (x.id === id ? { ...x, title: title.trim() || x.title } : x));
  saveLS(LS_DRAFTS, drafts);
  renderDrafts();
}

function saveToDraft(id) {
  const payload = currentDraftPayload();
  drafts = drafts.map((x) => (x.id === id
    ? { ...x, title: payload.title || x.title, html: payload.html, savedAt: Date.now() }
    : x));
  saveLS(LS_DRAFTS, drafts);
  renderDrafts(id);
  toast("Saved to draft.");
}

function deleteDraft(id) {
  drafts = drafts.filter((x) => x.id !== id);
  saveLS(LS_DRAFTS, drafts);
  renderDrafts();
  toast("Draft deleted.");
}

function shortDate(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function renderDrafts(activeId) {
  J.draftList.innerHTML = "";
  if (!drafts.length) {
    const none = document.createElement("div");
    none.className = "j-draft-empty";
    none.textContent = "No drafts yet, write something and hit Save draft.";
    J.draftList.appendChild(none);
    return;
  }
  for (const d of drafts) {
    const card = document.createElement("div");
    card.className = "j-draft-card" + (d.id === activeId ? " is-current" : "");
    card.dataset.id = d.id;

    const title = document.createElement("span");
    title.className = "j-draft-title";
    title.textContent = d.title || "Untitled draft";

    const date = document.createElement("span");
    date.className = "j-draft-date";
    date.textContent = shortDate(d.savedAt);

    const actions = document.createElement("div");
    actions.className = "j-draft-actions";
    const saveBtn = makeIconBtn("iconoir:floppy-disk-arrow-in", "Save to this draft");
    const editBtn = makeIconBtn("boxicons:edit-filled", "Rename");
    const delBtn = makeIconBtn("ep:delete", "Delete");
    delBtn.classList.add("danger");
    actions.append(saveBtn, editBtn, delBtn);

    card.append(title, date, actions);

    saveBtn.addEventListener("mouseup", (e) => { e.stopPropagation(); saveToDraft(d.id); });
    editBtn.addEventListener("mouseup", (e) => { e.stopPropagation(); startRename(card, d); });
    delBtn.addEventListener("mouseup", (e) => { e.stopPropagation(); deleteDraft(d.id); });
    card.addEventListener("click", () => { if (!card.classList.contains("is-editing")) loadDraft(d.id); });

    J.draftList.appendChild(card);
  }
}

function makeIconBtn(icon, tip) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "j-draft-btn";
  b.title = tip;
  const ic = document.createElement("iconify-icon");
  ic.icon = icon;
  ic.classList.add("lu");
  b.appendChild(ic);
  return b;
}

function startRename(card, d) {
  card.classList.add("is-editing");
  card.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "j-draft-rename";
  input.value = d.title || "";
  const check = makeIconBtn("akar-icons:check", "Save name");
  const del = makeIconBtn("ep:delete", "Delete");
  del.classList.add("danger");
  const actions = document.createElement("div");
  actions.className = "j-draft-actions";
  actions.append(check, del);
  card.append(input, actions);
  input.focus();
  input.select();
  const finish = () => { renameDraft(d.id, input.value); };
  check.addEventListener("mouseup", (e) => { e.stopPropagation(); finish(); });
  del.addEventListener("mouseup", (e) => { e.stopPropagation(); deleteDraft(d.id); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(); }
    if (e.key === "Escape") { e.preventDefault(); renderDrafts(); }
  });
  card.addEventListener("click", () => {}, { once: true });
}

/* ── IMAGE LIBRARY ─────────────────────────────────────── */

function addImageFromInput() {
  const parsed = validateImageUrl(J.imageUrl.value);
  if (!parsed) { toast("Not a recognised image URL. Use imgur, giphy or tenor direct links."); return; }
  if (images.some((i) => i.url === parsed.url)) { toast("Image already in library."); return; }
  images = [{ id: uid(), url: parsed.url, addedAt: Date.now() }, ...images];
  saveLS(LS_IMAGES, images);
  J.imageUrl.value = "";
  renderImages();
  toast("Image added.");
}

function removeImage(id) {
  images = images.filter((i) => i.id !== id);
  saveLS(LS_IMAGES, images);
  renderImages();
}

function renderImages() {
  J.imageGrid.innerHTML = "";
  if (!images.length) {
    const none = document.createElement("div");
    none.className = "j-img-empty";
    none.textContent = "No images yet, add a direct imgur/giphy link above.";
    J.imageGrid.appendChild(none);
    return;
  }
  for (const im of images) {
    const item = document.createElement("div");
    item.className = "j-img-item";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = im.url;
    img.alt = "";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "j-img-del";
    del.textContent = "✕";
    del.title = "Remove image";
    item.append(img, del);
    del.addEventListener("click", (e) => { e.stopPropagation(); removeImage(im.id); });
    item.addEventListener("click", () => insertImage(im.url));
    J.imageGrid.appendChild(item);
  }
}

/* ── PERSISTENCE (title + editor survive closing newsdesk) ── */

function persistTitle() {
  saveStr(LS_TITLE, J.title.value);
}

function persistEditor() {
  saveStr(LS_EDITOR, serializeEditorHtml(J.editor));
}

// Debounced save on typing; programmatic edits call persistEditor() directly.
const schedulePersist = debounce(() => persistEditor(), 600);

// Flush any pending debounce when the tab closes so the last keystrokes stick.
window.addEventListener("pagehide", () => persistEditor());

/* ── ZOOM (mirrors the reader modal: scales text only) ──── */

function applyZoom() {
  J.editor.closest(".j-editor-wrap")?.style.setProperty("--j-editor-zoom", J.zoom / 100);
  if (J.zoomPct) J.zoomPct.textContent = `${J.zoom}%`;
  localStorage.setItem(LS_JOTTER_ZOOM, String(J.zoom));
}

/* ── CLEAR ─────────────────────────────────────────────── */

// Chrome only spell-checks text typed AFTER the spellcheck flag turns on, so
// pre-existing content stays unmarked. Rebooting the contenteditable attribute
// makes the browser re-scan the whole document (selection is re-applied after).
function forceSpellcheckRescan() {
  const sel = window.getSelection();
  const r = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  J.editor.contentEditable = "false";
  J.editor.contentEditable = "true";
  const restore = () => {
    try {
      if (r && r.startContainer?.isConnected && J.editor.contains(r.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } catch {}
  };
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restore);
  else setTimeout(restore, 0);
}

function clearEditor() {
  J.editor.innerHTML = '<p class="tiptap-block"><br></p>';
  findState.matches = [];
  findState.idx = -1;
  findState.term = "";
  updateFindLabel();
  persistEditor();
  updateInfoBar();
  J.editor.focus({ preventScroll: true });
}

/* ── FIND & REPLACE ────────────────────────────────────── */

function collectFind(term) {
  const t = term.toLowerCase();
  const res = [];
  if (!t) return res;
  const tw = document.createTreeWalker(J.editor, NF.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    if (!n.data) continue;
    const low = n.data.toLowerCase();
    let i = 0;
    while ((i = low.indexOf(t, i)) !== -1) {
      res.push({ node: n, start: i, end: i + t.length });
      i += Math.max(1, t.length);
    }
  }
  return res;
}

function updateFindLabel() {
  if (!J.findCount) return;
  const tot = findState.matches.length;
  const cur = findState.idx >= 0 && findState.idx < tot ? findState.idx + 1 : 0;
  J.findCount.textContent = `${cur}/${tot}`;
  if (J.findNextBtn) J.findNextBtn.classList.toggle("is-disabled", tot === 0);
}

function selectFind(i) {
  const m = findState.matches[i];
  if (!m) return;
  const r = document.createRange();
  r.setStart(m.node, m.start);
  r.setEnd(m.node, m.end);
  const sel = window.getSelection();
  J.editor.focus({ preventScroll: true });
  sel.removeAllRanges();
  sel.addRange(r);
  try { m.node.parentElement?.scrollIntoView?.({ block: "nearest" }); } catch {}
  findState.idx = i;
  updateFindLabel();
}

function findNext() {
  const term = J.findInput?.value || "";
  if (!term) { findState.matches = []; findState.idx = -1; updateFindLabel(); return; }
  findState.term = term;
  findState.matches = collectFind(term);
  if (!findState.matches.length) { findState.idx = -1; updateFindLabel(); return; }
  findState.idx = (findState.idx + 1) % findState.matches.length;
  selectFind(findState.idx);
}

function replaceCurrent() {
  const term = J.findInput?.value || "";
  if (!term) return;
  findState.term = term;
  findState.matches = collectFind(term);
  const sel = window.getSelection();
  const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const onMatch = r && !r.collapsed && J.editor.contains(r.startContainer) && r.toString().toLowerCase() === term.toLowerCase();
  if (onMatch) {
    withSelection(() => document.execCommand("insertText", false, J.replaceInput.value));
    findState.matches = []; findState.idx = -1;
    schedulePersist();
  }
  findNext();
  updateInfoBar();
}

function replaceAll() {
  const term = J.findInput?.value || "";
  const rep = J.replaceInput?.value || "";
  if (!term) return;
  const matches = collectFind(term);
  if (!matches.length) { toast("Nothing to replace."); return; }
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    m.node.replaceData(m.start, m.end - m.start, rep);
  }
  saveStr(LS_EDITOR, serializeEditorHtml(J.editor));
  findState.matches = []; findState.idx = -1; findState.term = "";
  if (J.findInput) J.findInput.value = "";
  updateFindLabel();
  updateInfoBar();
  toast(`${matches.length} replaced.`);
}

function openFind() {
  if (!J.findPop) return;
  J.findPop.hidden = false;
  findState.matches = []; findState.idx = -1; findState.term = "";
  updateFindLabel();
  J.findInput?.focus();
  J.findInput?.select();
}

function hideFind() {
  if (J.findPop) J.findPop.hidden = true;
  findState.matches = []; findState.idx = -1;
  J.editor.focus({ preventScroll: true });
}

/* ── COPY HTML ─────────────────────────────────────────── */

async function copyHtml() {
  const html = serializeEditorHtml(J.editor);
  try {
    await navigator.clipboard.writeText(html);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = html;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
  }
  toast("TipTap HTML copied.");
}

function insertTextSanitized(text) {
  syncSelection();
  const safe = document.createElement("div");
  safe.textContent = text;
  const d = document.createElement("span");
  d.textContent = "";
  document.execCommand("insertHTML", false, esc(safe.textContent).replace(/\n/g, "<br>"));
  syncSelection();
  updateInfoBar();
  schedulePersist();
}