// Article Jotter — War-Era-compatible rich text editor (see docs/warera-editor-reference.md).
// A contenteditable surface + execCommand toolbar, serializing to TipTap HTML via ./serialize.js.

import { serializeEditorHtml } from "./serialize.js";
import { offlineLookups } from "../../data/offlineLookups.js";
import { toast } from "../ui/toast.js";
import { resolveEntityByType, parseWarEraEntityPath } from "../core/resolver.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { S } from "../core/state.js";
import { debounce, entityDisplayName } from "../core/utils.js";
import { uploadImageToImgur, LARGE_IMAGE_BYTES } from "../core/imageUpload.js";
import { allianceColor } from "../battles/companies.js";

const LS_DRAFTS = "wa-nd-jotter-drafts";
const LS_IMAGES = "wa-nd-jotter-images";
const LS_TITLE = "wa-nd-jotter-title";
const LS_EDITOR = "wa-nd-jotter-editor";
const LS_JOTTER_ZOOM = "wa-nd-jotter-zoom";
const LS_JOTTER_SPELL = "wa-nd-jotter-spell";
const LS_JOTTER_COLORS = "wa-nd-jotter-colors";
const COLOR_HISTORY_MAX = 20;
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

const OFFLINE_KEY = { country: "countries", region: "regions", alliance: "alliances", party: "parties", mu: "mus" };
const DATA_KEY = { user: "userId", country: "countryId", region: "regionId", alliance: "allianceId", mu: "muId", party: "partyId", battle: "battleId", company: "companyId", article: "articleId" };
const CHIP_BADGES = {
  region:  { icon: "ic:sharp-terrain",              color: "#86efac" },
  mu:      { icon: "hugeicons:electric-tower-02",   color: "#fca5a5" },
  party:   { icon: "mdi:lectern",                   color: "#93c5fd" },
  company: { icon: "at-icons:factory",              color: "#fde047" },
  article: { icon: "famicons:newspaper-sharp",      color: "#d1d5db" },
  battle:  { icon: "material-symbols-light:swords", color: "#fb923c" },
};
const CHIP_NEUTRAL = "var(--ink-caption)";

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
  J.placeholder = document.getElementById("jEditorPlaceholder");
  J.infoBar = document.getElementById("jInfoBar");
  J.gutter = document.getElementById("jGutter");
  J.draftList = document.getElementById("jDraftList");
  J.imageGrid = document.getElementById("jImageGrid");
  J.imageUrl = document.getElementById("jImageUrlInput");
  J.imageAdd = document.getElementById("jImageAddBtn");
  J.imageUpload = document.getElementById("jImageUploadInput");
  J.imageUploadBtn = document.getElementById("jImageUploadBtn");
  J.blockSelect = document.getElementById("jBlockSelect");
  J.fontSelect = document.getElementById("jFontSelect");
  J.colorWrap = document.getElementById("jColorWrap");
  J.colorTrigger = document.getElementById("jColorTrigger");
  J.colorIcon = document.getElementById("jColorIcon");
  J.colorPop = document.getElementById("jColorPop");
  J.cpSV = document.getElementById("jCPSV");
  J.cpSVCursor = document.getElementById("jCPSVCursor");
  J.cpHue = document.getElementById("jCPHue");
  J.cpHueCursor = document.getElementById("jCPHueCursor");
  J.cpPreview = document.getElementById("jCPPreview");
  J.cpHex = document.getElementById("jCPHex");
  J.colorRecent = document.getElementById("jColorRecent");
  J.colorReset = document.getElementById("jColorReset");
  J.colorOk = document.getElementById("jColorOk");
  J.helpBtn = document.getElementById("jHelpBtn");
  J.helpModal = document.getElementById("helpModal");
  J.helpCloseBtn = document.getElementById("jHelpCloseBtn");

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
  if (savedEditor) { J.editor.innerHTML = stripCollapseCarets(savedEditor); rehydrateEntityNames(); updateInfoBar(); }

  populateSelect(J.fontSelect, FONTS, (o, f) => { o.value = f.value; o.textContent = f.label; if (f.value) o.style.fontFamily = f.value; });
  renderColorHistory(loadColorHistory());
  setColorIcon("");
  populateSelect(J.blockSelect, [
    { v: "p", label: "P" }, { v: "h1", label: "H1" }, { v: "h2", label: "H2" }, { v: "h3", label: "H3" },
  ], (o, b) => { o.value = b.v; o.textContent = b.label; });

  // Panel head buttons
  document.getElementById("jSaveDraftBtn").addEventListener("click", () => saveDraft());
  document.getElementById("jCopyHtmlBtn").addEventListener("click", () => copyHtml());
  document.getElementById("jOpenWriterBtn").addEventListener("click", () =>
    window.open("https://app.warera.io/news/write", "_blank", "noopener"));
  J.helpBtn?.addEventListener("click", openHelp);
  J.helpCloseBtn?.addEventListener("click", closeHelp);
  J.helpModal?.addEventListener("click", (e) => { if (e.target === J.helpModal) closeHelp(); });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (J.helpModal && !J.helpModal.classList.contains("hidden")) closeHelp();
    else if (J.colorPop && !J.colorPop.classList.contains("hidden")) closeColorPop();
  });

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
  // Color picker: an inline HSV picker (saturation/value square + hue bar) that
  // the user drives directly — no hidden trigger. Every pointermove on the
  // picker previews the hovered color on the editor text live; the picked color
  // is applied AND stored when the user confirms (OK) or simply closes the pop
  // again. The trigger button shows ONLY the palette icon; the icon tints to the
  // text color at the caret, doubling as the color indicator/recognizer.
  J.colorTrigger?.addEventListener("click", () => {
    if (J.colorPop?.classList.contains("hidden")) openColorPop(); else closeColorPop();
  });
  J.cpSV?.addEventListener("pointerdown", (e) => { e.preventDefault(); J.cpSV.setPointerCapture?.(e.pointerId); dragTo(J.cpSV, e); });
  J.cpSV?.addEventListener("pointermove", (e) => { if (J.cpSV.hasPointerCapture?.(e.pointerId)) dragTo(J.cpSV, e); });
  J.cpSV?.addEventListener("pointerup", (e) => { if (J.cpSV.hasPointerCapture?.(e.pointerId)) J.cpSV.releasePointerCapture?.(e.pointerId); });
  J.cpHue?.addEventListener("pointerdown", (e) => { e.preventDefault(); J.cpHue.setPointerCapture?.(e.pointerId); dragTo(J.cpHue, e); });
  J.cpHue?.addEventListener("pointermove", (e) => { if (J.cpHue.hasPointerCapture?.(e.pointerId)) dragTo(J.cpHue, e); });
  J.cpHue?.addEventListener("pointerup", (e) => { if (J.cpHue.hasPointerCapture?.(e.pointerId)) J.cpHue.releasePointerCapture?.(e.pointerId); });
  J.cpHex?.addEventListener("input", () => {
    const v = (J.cpHex.value || "").trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) pickerColorFromHex((v[0] === "#" ? v : "#" + v));
  });
  J.cpHex?.addEventListener("change", () => {
    const v = (J.cpHex.value || "").trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) pickerColorFromHex((v[0] === "#" ? v : "#" + v));
    else J.cpHex.value = hsvToHex(picker);
  });
  J.colorOk?.addEventListener("click", () => { commitPendingColor(); closeColorPop(); });
  J.colorReset?.addEventListener("click", () => { resetColor(); closeColorPop(); });
  document.addEventListener("click", (e) => {
    if (!J.colorPop || J.colorPop.classList.contains("hidden")) return;
    if (!e.target.closest("#jColorWrap")) closeColorPop();
  });

  // Editor events
  J.editor.addEventListener("input", () => { updateInfoBar(); syncSelection(); onEditorInput(); schedulePersist(); syncEditorEmpty(); });
  J.editor.addEventListener("keydown", (e) => onEditorKeydown(e));
  J.editor.addEventListener("keyup", () => { syncSelection(); updateInfoBar(); });
  J.editor.addEventListener("mouseup", () => { syncSelection(); updateInfoBar(); });
  J.editor.addEventListener("paste", (e) => onEditorPaste(e));

  // Drag & drop local images — upload to Imgur and insert the CDN URL.
  let jDragDepth = 0;
  const dragHasImages = (e) => {
    const files = [...((e?.dataTransfer?.files) || [])];
    if (files.length) return files.some((f) => f.type.startsWith("image/"));
    return [...((e?.dataTransfer?.types) || [])].includes("Files");
  };
  J.editor.addEventListener("dragenter", (e) => {
    if (!dragHasImages(e)) return;
    e.preventDefault();
    jDragDepth++;
    J.editor.classList.add("j-drop");
  });
  J.editor.addEventListener("dragover", (e) => {
    if (!dragHasImages(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  J.editor.addEventListener("dragleave", (e) => {
    if (!dragHasImages(e)) return;
    jDragDepth = Math.max(0, jDragDepth - 1);
    if (!jDragDepth) J.editor.classList.remove("j-drop");
  });
  J.editor.addEventListener("drop", (e) => {
    jDragDepth = 0;
    J.editor.classList.remove("j-drop");
    const files = [...((e?.dataTransfer?.files) || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    syncSelection();
    for (const file of files) uploadLocalImage(file, { source: "editor", insert: true });
  });

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
    saveStr(LS_JOTTER_SPELL, J.editor.spellcheck);
    J.spellBtn.classList.toggle("is-active", !!J.editor.spellcheck);
    if (J.editor.spellcheck) forceSpellcheckRescan();
    J.editor.focus({ preventScroll: true });
  });
  J.editor.spellcheck = !!loadStr(LS_JOTTER_SPELL, false);
  J.spellBtn?.classList.toggle("is-active", !!J.editor.spellcheck);
  if (J.editor.spellcheck) forceSpellcheckRescan();
  J.clearBtn?.addEventListener("click", () => clearEditor());

  // Keep the .is-empty class on J.editor in sync with actual editor emptiness so
  // the overlay placeholder ("Start writing…") appears whenever the editor has
  // no meaningful content — after init, clear, undo, draft load, etc. The same
  // mutations (typing, Enter, paste, formatting, undo, loads) also repaint the
  // line-number gutter, since block structure is what drives logical lines.
  if (typeof MutationObserver !== "undefined") {
    const _obs = new MutationObserver(() => { syncEditorEmpty(); scheduleGutter(); });
    _obs.observe(J.editor, { childList: true, characterData: true, attributes: true, subtree: true });
  }
  syncEditorEmpty();

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
  J.imageUploadBtn?.addEventListener("click", () => J.imageUpload?.click());
  J.imageUpload?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (file) {
      J.imageUploadBtn.disabled = true;
      uploadLocalImage(file, { source: "" }).finally(() => { if (J.imageUploadBtn) J.imageUploadBtn.disabled = false; });
    }
  });

  // Mention popup scaffolding — a "@" pill input + live suggestion list
  J.pop = document.createElement("div");
  J.pop.className = "j-mention-pop";
  J.pop.style.display = "none";
  J.pop.innerHTML =
    '<div class="j-mention-pill"><span class="j-mention-at">@</span>' +
    '<input type="text" class="j-mention-input" placeholder="Type to search user, country, region…" autocomplete="one-time-code" spellcheck="false" data-lpignore="true">' +
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

  // Window resizes (sidebar collapse, split dragging, browser reflows) change
  // where the text wraps, so the gutter must re-anchor against the blocks.
  window.addEventListener("resize", () => scheduleGutter());

  if ((J.editor.textContent || "").trim()) rehydrateEntityNames();
  updateNavButtons();
  normalizeEditorBlocks(); // clean any persisted hr/bare-text sharing a container
  layoutGutter(); // initial paint (restored content / empty single line)
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

// The auto-list trigger ("1." / "-") typed at the end of a paragraph must be
// consumed before converting, otherwise the list marker shows up twice ("1. 1.").
// Delete the trigger text up to the caret and leave the caret in the now-empty
// block, then execCommand wraps the empty block into a fresh list item.
function consumeTriggerText(block) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(block);
  if (sel?.rangeCount) r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  else r.collapse(false);
  r.deleteContents();
  r.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(r);
  // Re-sync the command's saved selection so execCommand converts the now-empty
  // block (a stale saved range could otherwise target the wrong paragraph).
  syncSelection();
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
      if (k.tagName === "HR") s += "\n";
      else s += subText(k);
    }
  }
  return s;
}

// ── LOGICAL LINE MODEL ──────────────────────────────────
// One source of truth for Notepad-style logical lines. The SAME walk produces
// the plain-text projection (used for Ln/Col/Pos), the per-text-node offsets
// (caret → line math) and the gutter's numbered lines, so the three can never
// disagree.
//
// The editor document is a tree of block-level boxes. LOGICAL LINES follow the
// block structure, NOT the visual boxes:
//   • P/H1-6/TD/DD/DT/SUMMARY/CAPTION/FIGCAPTION → one line (their content)
//   • an <hr>                                     → its own line, always
//   • a <pre>                                     → one line per source row
//   • <ul>/<ol>                                   → one line per <li>
//   • <li>                                        → one line when it only holds
//     inline content, otherwise every inner paragraph/run of the item counts
//   • generic containers (<div>, <blockquote>, <details>, …) add NO line of
//     their own — they contribute the lines of their descendants. An
//     inline-only container (<div>text</div>) counts as exactly one line.
//   • bare text directly inside a mixed container forms one line per contiguous
//     inline run, so <div><hr>kk</div> → lines: <hr>, then "kk"
//   • <br> soft breaks and visually wrapped rows NEVER create a line
// A logical line is only ever born from block structure — the Enter inside the
// live editor manufactures exactly one of the shapes above, and Chrome's
// back-filled <div> paragraphs each remain one line.
const LEAF_LINE = /^(?:P|H[1-6]|TD|TH|DD|DT|SUMMARY|CAPTION|FIGCAPTION)$/i;
const LIST_TAGS = /^(?:UL|OL)$/i;
const BLOCK_CONTAINER = /^(?:BLOCKQUOTE|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|MAIN|NAV|DL|TABLE|TR|DETAILS|FIGURE|FIELDSET|ADDRESS)$/i;
const BLOCK_TAGS = /^(?:HR|PRE|BLOCKQUOTE|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|MAIN|NAV|UL|OL|LI|DL|TABLE|TR|DETAILS|FIGURE|FIELDSET|ADDRESS|P|H[1-6]|TD|TH|DD|DT|SUMMARY|CAPTION|FIGCAPTION)$/i;
const LINE_UNITS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "DD", "DT", "SUMMARY", "PRE"]);

let docSig = null;
let docModel = null;

function docSignature() {
  return J.editor.textContent + "#" + J.editor.querySelectorAll("*").length;
}

function buildDocModel() {
  docSig = docSignature();
  const lines = [];
  const cellIdx = { v: 0 };

  // Inline text under a block, assembled exactly like subText() — returns the
  // composed string plus each text node's offset WITHIN it (used to place
  // caret math for text living inside units).
  const collect = (el) => {
    const parts = [];
    const map = new Map();
    let o = 0;
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { parts.push(c.data); map.set(c, o); o += c.data.length; }
        else if (c.nodeType === 1 && c.tagName !== "BR") walk(c);
      }
    })(el);
    return { text: parts.join(""), map };
  };

  const pushUnit = (el, allowEmpty) => {
    const empty = !allowEmpty && !hasVisibleContent(el);
    if (empty) {
      // Completely empty blocks still get a line IF they are real blank lines
      // (they hold a caret position) — but a phantom trailing node created by
      // contenteditable must never count. Empty markers marked so the trailing
      // one can be pruned below.
      lines.push({ kind: "unit", node: el, text: "", nodes: new Map(), anchor: null, count: 1, empty: true });
      return;
    }
    const col = collect(el);
    const entry = { kind: "unit", node: el, text: col.text, nodes: col.map, anchor: null, count: 1 };
    entry.ix = cellIdx.v++;
    lines.push(entry);
  };
  const pushHr = (el) => {
    const entry = { kind: "hr", node: el, text: "", nodes: new Map(), anchor: null, count: 1 };
    entry.ix = cellIdx.v++;
    lines.push(entry);
  };
  const pushPre = (el) => {
    // The editor's code block is one <code> row per Enter: count those rows even
    // when there is no literal "\n" between them (e.g. <pre><code>a</code><code>b</code></pre>),
    // so each code line gets its own number and the row offsets stay exact.
    const rowEls = [...el.children].filter(k => /^(?:CODE|DIV|P|PRE)$/i.test(k.tagName));
    if (rowEls.length) {
      const texts = [];
      const map = new Map();
      let base = 0;
      for (const r of rowEls) {
        const col = collect(r);
        texts.push(col.text);
        for (const [n, sub] of col.map) map.set(n, base + sub);
        base += col.text.length + 1;
      }
      const entry = { kind: "pre", node: el, text: texts.join("\n"), nodes: map, anchor: null, count: texts.length };
      entry.ix = cellIdx.v++;
      lines.push(entry);
      return;
    }
    const col = collect(el);
    const entry = { kind: "pre", node: el, text: col.text, nodes: col.map, anchor: null, count: Math.max(1, col.text.split("\n").length) };
    entry.ix = cellIdx.v++;
    lines.push(entry);
  };
  const pushText = (nodes, anchor) => {
    let text = "";
    for (const n of nodes) text += n.data;
    const entry = { kind: "text", text, nodes, anchor, count: 1 };
    entry.ix = cellIdx.v++;
    lines.push(entry);
  };

  // Does this subtree hold only inline content (<br>/entity chips allowed)?
  const isInlineOnly = (el) => {
    for (const c of el.childNodes) {
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1) continue;
      if (c.tagName === "BR") continue;
      if (BLOCK_TAGS.test(c.tagName)) return false;
      if (!isInlineOnly(c)) return false;
    }
    return true;
  };

  // Real content for gutter purposes: any text or an explicit caret/media node.
  // A bare empty <div></div> (no <br>) renders with zero height and is the
  // phantom contenteditable trailing node — it must not take a number.
  const hasVisibleContent = (el) => {
    if (el.textContent.trim()) return true;
    if (el.querySelector("br,img,hr,svg,canvas,iframe,video,audio")) return true;
    return false;
  };

  // Deepest first text node with any non-whitespace content.
  const firstNonWsText = (el) => {
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { if (c.data && !/^\s*$/.test(c.data)) return c; continue; }
      if (c.nodeType !== 1) continue;
      if (c.tagName === "BR") continue;
      if (BLOCK_TAGS.test(c.tagName)) continue;
      const r = firstNonWsText(c);
      if (r) return r;
    }
    return null;
  };

  // Fold every text node of an inline subtree into an open run, in order.
  const appendRun = (cur, el) => {
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { cur.nodes.push(c); continue; }
      if (c.nodeType !== 1) continue;
      if (c.tagName === "BR") continue;
      if (BLOCK_TAGS.test(c.tagName)) continue;
      appendRun(cur, c);
    }
  };

  // One logical line per inline-only <li>; multi-paragraph items are walked so
  // each inner paragraph/run of the item becomes its own line.
  const emitList = (el) => {
    for (const li of el.children) {
      if (li.nodeType !== 1 || li.tagName !== "LI") continue;
      if (isInlineOnly(li)) pushUnit(li); else emit(li);
    }
  };

  // Walk one container: text/run lines at THIS level, blocks each contribute
  // their own lines, containers recurse. Lines never merge across a boundary.
  function emit(el) {
    let cur = null; // open merged-text run (bare inline siblings at this level)
    const finalize = () => {
      if (cur) { pushText(cur.nodes, cur.anchor); cur = null; }
    };
    for (const c of el.childNodes) {
      if (c.nodeType === 3) {
        if (!c.data) continue;
        if (!cur) {
          if (/^\s*$/.test(c.data)) continue; // whitespace alone never opens a line
          cur = { nodes: [], anchor: null };
        }
        if (!cur.anchor) cur.anchor = c; // first non-whitespace text node
        cur.nodes.push(c);
        continue;
      }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName;
      if (tag === "BR") continue;
      if (tag === "HR") { finalize(); pushHr(c); continue; }
      if (tag === "PRE") { finalize(); pushPre(c); continue; }
      if (LEAF_LINE.test(tag)) { finalize(); pushUnit(c); continue; }
      if (LIST_TAGS.test(tag)) { finalize(); emitList(c); continue; }
      if (tag === "LI") { finalize(); if (isInlineOnly(c)) pushUnit(c); else emit(c); continue; }
      if (BLOCK_CONTAINER.test(tag)) {
        finalize();
        if (isInlineOnly(c)) pushUnit(c); else emit(c);
        continue;
      }
      // Inline element → joins/extends the open text run.
      if (!cur) {
        const seed = firstNonWsText(c);
        if (!seed) continue;
        cur = { nodes: [], anchor: seed };
        appendRun(cur, c);
      } else {
        appendRun(cur, c);
      }
    }
    finalize();
  }

  emit(J.editor);
  // The trailing contenteditable block (the always-present empty tail <div>)
  // is not a user logical line — prune trailing empty phantoms so the gutter
  // never shows an un-deletable extra number at the end.
  while (lines.length && lines[lines.length - 1].empty) lines.pop();
  if (!lines.length) pushUnit(J.editor, true); // empty editor still owns one logical line

  // Pass 2: exact plain projection + offsets. One "\n" between adjacent lines,
  // none after the final line, so the newline count always equals the line
  // count and Ln/Col/Pos line up 1:1 with the gutter numbers.
  const parts = [];
  const offsets = new Map();
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (i > 0) { parts.push("\n"); acc += 1; }
    if (ln.kind === "text") {
      for (const n of ln.nodes) { offsets.set(n, acc); parts.push(n.data); acc += n.data.length; }
    } else {
      for (const [n, sub] of ln.nodes) offsets.set(n, acc + sub);
      parts.push(ln.text || "");
      acc += (ln.text || "").length;
    }
  }

  docModel = { plain: parts.join(""), lines, offsets };
  return docModel;
}

function plainText() {
  if (docModel && docSig === docSignature()) return docModel.plain;
  return buildDocModel().plain;
}

function textNodeStart(target) {
  if (!docModel || docSig !== docSignature()) buildDocModel();
  return docModel.offsets.has(target) ? docModel.offsets.get(target) : -1;
}

function childPlainLen(c) {
  if (c.nodeType === 3) return c.data.length;
  if (c.nodeType !== 1) return 0;
  const t = c.tagName;
  if (t === "BR") return 0;
  if (t === "HR") return 1;
  if (LINE_UNITS.has(t)) return subText(c).length + 1;
  let n = 0;
  for (const k of c.childNodes) n += childPlainLen(k);
  return n;
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

// Logical line + column of a plain-text offset: every "\n" is one line break.
// This is THE shared definition — the info bar's Ln and the gutter numbers both
// come from the same plain projection, so they can never disagree.
function caretLineCol(plain, pos) {
  if (pos <= 0) return { ln: 1, col: pos + 1 };
  let nl = 0, lastNL = -1;
  for (let i = 0; i < pos; i++) {
    if (plain.charCodeAt(i) === 10) { nl++; lastNL = i; }
  }
  return { ln: nl + 1, col: lastNL < 0 ? pos + 1 : pos - lastNL };
}

function caretMetrics() {
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const inEditor = range && J.editor.contains(range.startContainer);
  const plain = plainText();
  let pos = 0;
  if (inEditor) pos = caretPlainPos(range.startContainer, range.startOffset);
  const { ln, col } = caretLineCol(plain, pos);
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
  highlightGutterLine(m.ln);
  updateToolbarState();
}

/* ── GUTTER (Notepad-style logical line numbers) ─────────
   One number per LOGICAL line, exactly like the info bar's Ln. The line list
   comes from the shared logical-line model (see buildDocModel), so numbering
   and Ln can never disagree. The gutter is a sibling column next to the editor
   inside one scroll container, so both panes scroll together and cells are
   re-anchored against the blocks on every mutation/resize/zoom. Each line is
   anchored at its OWN spot: blocks at their element, bare text runs at the
   FIRST character of their first text node — measured through a Range so a text
   run sitting next to an <hr> in the same wrapper still gets its true,
   non-overlapping position. */

// Debounced gutter repaint while typing/formatting; cheap enough to run on the
// 80ms cadence of the mutation observer even during fast typing.
const scheduleGutter = debounce(() => layoutGutter(), 80);

// Render one gutter cell and note which logical line it represents.
function appendGutterCell(frag, num, top, lineH) {
  const d = document.createElement("div");
  d.className = "j-gutter-cell";
  d.style.top = `${top}px`;
  d.style.lineHeight = `${lineH}px`;
  d.textContent = num;
  d.__ln = num;
  frag.append(d);
  return d;
}

// Vertical top of a text node's first glyph, in document coordinates.
function measureTextNodeTop(n) {
  try {
    if (!n.data) return 0;
    const r = document.createRange();
    r.setStart(n, 0);
    r.setEnd(n, Math.min(1, n.data.length));
    const cr = r.getBoundingClientRect();
    return cr ? cr.top : 0;
  } catch { return 0; }
}

function lineAnchorTop(line, editorRect) {
  let top;
  if (line.anchor && line.anchor.nodeType === 3) top = measureTextNodeTop(line.anchor);
  else top = line.node.getBoundingClientRect().top;
  return top - editorRect.top;
}

function layoutGutter() {
  if (!J.gutter || !J.editor || !J.editor.isConnected) return;
  if (!docModel || docSig !== docSignature()) buildDocModel();
  const editorRect = J.editor.getBoundingClientRect();

  // Default cell row height must match the editor's line box so numbers sit on
  // the same vertical grid as the (first) line of each block.
  const cs = getComputedStyle(J.editor);
  const fs = parseFloat(cs.fontSize) || 14;
  const rawLh = parseFloat(cs.lineHeight);
  const baseLH = Number.isFinite(rawLh) && rawLh > 0 ? rawLh : fs * 1.6;

  // If a single unbreakable token overflows horizontally, mirror its extra
  // width as right padding so wrapped lines below keep the same x-offset and
  // the re-measured block rects below stay honest.
  const pad = J.editor.scrollWidth - J.editor.clientWidth;
  J.editor.style.paddingRight = pad > 0 ? `${14 + Math.min(pad, 30)}px` : "";

  const frag = document.createDocumentFragment();
  let num = 0;
  let prevTop = -Infinity, prevLH = baseLH;
  for (const ln of docModel.lines) {
    let lh = baseLH;
    if (ln.kind === "pre") {
      const pcs = getComputedStyle(ln.node);
      const pfs = parseFloat(pcs.fontSize) || fs;
      const praw = parseFloat(pcs.lineHeight);
      lh = Number.isFinite(praw) && praw > 0 ? praw : pfs * 1.6;
    }
    let top;
    if (ln.kind === "pre") {
      const base = lineAnchorTop(ln, editorRect);
      for (let i = 0; i < ln.count; i++) {
        let t = base + i * lh;
        if (t <= prevTop) t = prevTop + prevLH; // never let cells stack on each other
        appendGutterCell(frag, ++num, Math.round(t * 1000) / 1000, lh);
        prevTop = t; prevLH = lh;
      }
      continue;
    }
    top = lineAnchorTop(ln, editorRect);
    if (top <= prevTop) top = prevTop + prevLH; // zero-height blocks must still get their own spot
    appendGutterCell(frag, ++num, Math.round(top * 1000) / 1000, lh);
    prevTop = top; prevLH = lh;
  }
  J.gutter.replaceChildren(frag);
}

// Bold the number of whichever logical line the caret is on. Runs on every info
// bar sync so it tracks every caret move, click and keyboard event.
function highlightGutterLine(ln) {
  if (!J.gutter) return;
  for (const d of J.gutter.children) d.classList.toggle("is-caret-line", d.__ln === ln);
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
function rgbToHex(s) {
  const [r,g,b] = parseRgb(s);
  return "#" + [r,g,b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("");
}

/* ── COLOR PICKER (inline HSV picker + 20-slot history) ──
   The popover holds a direct saturation/value square + hue bar — no separate
   trigger, no native <input type="color">. Dragging/clicking it live-previews
   the hovered color on the editor text; the picked color is applied AND stored
   in the 20-slot history when the user confirms (OK) or simply closes the pop
   again. The toolbar trigger is just the palette icon; its tint mirrors the
   text color at the caret (the indicator/recognizer). */

let pendingColor = null;   // color last picked in the open pop (stored on close)
let picker = { h: 0, s: 0, v: 1 };
let foreColorRAF = 0;

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}
function hsvToHex(p) { const [r, g, b] = hsvToRgb(p.h, p.s, p.v); return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join(""); }

function loadColorHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_JOTTER_COLORS) || "[]");
    return Array.isArray(v) ? v.filter(x => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x)).slice(0, COLOR_HISTORY_MAX) : [];
  } catch { return []; }
}
function saveColorHistory(list) { try { localStorage.setItem(LS_JOTTER_COLORS, JSON.stringify(list)); } catch {} }
function renderColorHistory(list) {
  const box = J.colorRecent; if (!box) return;
  box.innerHTML = "";
  for (const hex of list) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "j-color-swatch";
    sw.style.background = hex;
    sw.title = hex;
    sw.style.color = "#fff";
    sw.addEventListener("mousedown", (e) => e.preventDefault());
    sw.addEventListener("click", () => applyForeColor(hex));
    box.appendChild(sw);
  }
}
function pushColorHistory(hex) {
  const want = rgbToHex(hexToRgb(hex));
  if (!want || want === "#000000") return;
  const list = loadColorHistory().filter(x => !sameColor(hexToRgb(x), hexToRgb(want)));
  list.unshift(want);
  saveColorHistory(list.slice(0, COLOR_HISTORY_MAX));
  renderColorHistory(list.slice(0, COLOR_HISTORY_MAX));
}
function setColorIcon(hex) { if (J.colorIcon) J.colorIcon.style.color = hex || ""; }

// Reflect `picker` onto the popover controls (sv square, cursors, preview, hex).
function renderPickerColor() {
  const hx = hsvToHex(picker);
  if (J.cpSV) J.cpSV.style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${Math.round(picker.h)}, 100%, 50%))`;
  if (J.cpSVCursor) { J.cpSVCursor.style.left = (picker.s * 100) + "%"; J.cpSVCursor.style.top = ((1 - picker.v) * 100) + "%"; }
  if (J.cpHueCursor) J.cpHueCursor.style.left = (picker.h / 360 * 100) + "%";
  if (J.cpPreview) J.cpPreview.style.background = hx;
  if (J.cpHex && document.activeElement !== J.cpHex) J.cpHex.value = hx;
}
function pickerColorFromHex(hex) {
  const rgb = parseRgb(hexToRgb(hex));
  picker = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  pendingColor = hsvToHex(picker);
  renderPickerColor();
  applyLiveColor(pendingColor);
}
function dragTo(el, e) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  let x = (e.clientX - r.left) / r.width;
  let y = (e.clientY - r.top) / r.height;
  x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
  if (el === J.cpSV) { picker.s = x; picker.v = 1 - y; }
  else { picker.h = x * 360; }
  pendingColor = hsvToHex(picker);
  renderPickerColor();
  applyLiveColor(pendingColor);
}
// Live preview on the editor, throttled to one apply per frame so a drag
// doesn't flood the undo stack.
function applyLiveColor(hex) {
  setColorIcon(hex);
  if (foreColorRAF) cancelAnimationFrame(foreColorRAF);
  foreColorRAF = requestAnimationFrame(() => {
    foreColorRAF = 0;
    withSelection(() => document.execCommand("foreColor", false, hex));
  });
}
// Finalize whatever color was last picked: apply it for sure, then memorize it.
function commitPendingColor() {
  if (!pendingColor) return;
  const hex = pendingColor;
  pendingColor = null;
  withSelection(() => document.execCommand("foreColor", false, hex));
  pushColorHistory(hex);
  setColorIcon(hex);
}
function openColorPop() {
  if (!J.colorPop) return;
  pendingColor = null;
  const hx = currentCaretColorHex() || rgbToHex(getComputedStyle(J.editor).color);
  const rgb = parseRgb(hexToRgb(hx));
  picker = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  renderPickerColor();
  J.colorPop.classList.remove("hidden");
}
function closeColorPop() {
  if (!J.colorPop) return;
  commitPendingColor();
  J.colorPop.classList.add("hidden");
}
function currentCaretColorHex() {
  const sel = window.getSelection();
  const r = sel?.rangeCount ? sel.getRangeAt(0) : null;
  if (!r || !J.editor?.contains(r.startContainer)) return null;
  const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const cur = getComputedStyle(el).color;
  return sameColor(cur, getComputedStyle(J.editor).color) ? null : rgbToHex(cur);
}
// Recent-swatch shortcut: apply + memorize + close immediately.
function applyForeColor(hex) {
  withSelection(() => document.execCommand("foreColor", false, hex));
  const rgb = parseRgb(hexToRgb(hex));
  picker = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  renderPickerColor();
  pushColorHistory(hex);
  setColorIcon(hex);
  closeColorPop();
}
function resetColor() {
  withSelection(() => {
    unstyleInline("color");
    document.execCommand("foreColor", false, getComputedStyle(J.editor).color);
  });
  pendingColor = null;
  setColorIcon("");
}

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

  // Font label + color icon
  if (!J.fontSelect && !J.colorIcon) return;
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
  // The palette icon mirrors the text color at the caret: tinted when the text
  // is colored, neutral when it's the editor's default color.
  if (J.colorIcon) {
    if (sameColor(cs.color, baseColor)) setColorIcon("");
    else setColorIcon(rgbToHex(cs.color));
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
    case "hr": insertHr(); break;
    case "orderedList": apply("insertOrderedList"); break;
    case "bulletList": apply("insertUnorderedList"); break;
    case "indent": apply("indent"); break;
    case "outdent": apply("outdent"); break;
    case "blockquote": toggleBlockquote(); break;
    case "codeBlock": toggleCodeBlock(); break;
    case "collapsible": insertCollapsible(); break;
    case "link": promptRow({ label: "Link URL", placeholder: "https://example.com", onSubmit: (v) => insertLink(v) }); break;
    case "image": promptRow({ label: "Image URL", placeholder: "https://i.imgur.com/…", onSubmit: (v) => insertImage(v) }); break;
    case "imageUpload": if (J.imageUpload) J.imageUpload.click(); break;
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
      // The summary holds ONLY the user's text — the toggle chevron is pure CSS
      // (summary::before in jotter.css), so it can never leak into copied HTML.
      `<summary class="tiptap-collapsible-summary">${esc(summaryText)}</summary>` +
      `<div data-collapsible-body="" class="tiptap-collapsible-body"><div class="tiptap-collapsible-body-inner">` +
      `<div class="tiptap-collapsible-body-content"><p class="tiptap-block"><br></p></div></div></div></details>`;
    document.execCommand("insertHTML", false, html);
  });
  schedulePersist();
}

// Old drafts can still carry the literal "▸" caret span from earlier versions —
// drop it (and any bare leading "▸" in a summary) the moment content is loaded,
// so the glyph never re-enters storage or the copied HTML.
function stripCollapseCarets(html) {
  return String(html || "")
    .replace(/<span\b[^>]*class=["'][^"']*\bj-collapse-caret\b[^"']*["'][^>]*>\u25B8?<\/span>/gi, "")
    .replace(/(<summary[^>]*>)\s*[\u25B8]/g, "$1");
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
  input.autocomplete = "one-time-code";
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
  if (e.key === "Backspace" && tryMergeListItem(e)) return;
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
      if (/^\d+\.$/.test(t) || /^1\.$/.test(t)) {
        e.preventDefault();
        consumeTriggerText(block);
        apply("insertOrderedList");
        schedulePersist();
        return;
      }
      if (t === "-") {
        e.preventDefault();
        consumeTriggerText(block);
        apply("insertUnorderedList");
        schedulePersist();
        return;
      }
    }
    return;
  }
  if (e.key === "Enter") {
    const block = blockAt(window.getSelection()?.focusNode);
    if (block && (block.innerText || block.textContent).trim() === "---") {
      e.preventDefault();
      block.innerHTML = "";
      insertHr();
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

/* ── LIST MERGE-ON-BACKSPACE ────────────────────────────── */

// Backspace at the very start of a list item (or inside a textless item)
// removes the item's marker the way War Era does: the line merges into the
// line above. A non-first item appends its blocks into the previous item and
// the list stays intact (the numbering simply collapses); the first item is
// lifted out into a paragraph of its own in front of the list.
function tryMergeListItem(e) {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return false;
  const startEl = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const li = startEl?.closest?.("li");
  if (!li || !J.editor.contains(li)) return false;
  const list = li.parentElement;
  if (!list || (list.tagName !== "OL" && list.tagName !== "UL")) return false;

  // Caret must sit before any text in the item (an empty item counts).
  const pre = document.createRange();
  pre.selectNodeContents(li);
  pre.setEnd(r.startContainer, r.startOffset);
  const atStart = !pre.toString().replace(/\u200b/g, "").trim();
  if (!atStart) return false;

  e.preventDefault();
  mergeListItem(list, li);
  updateInfoBar();
  schedulePersist();
  return true;
}

function mergeListItem(list, li) {
  const prev = li.previousElementSibling;
  if (prev && prev.tagName === "LI") mergeIntoItem(prev, li);
  else liftFirstItem(list, li);
}

function mergeIntoItem(prev, li) {
  const list = li.parentElement;
  const kids = [...li.childNodes];
  const nested = kids.filter((n) => n.nodeType === 1 && (n.tagName === "OL" || n.tagName === "UL"));
  const rest = kids.filter((n) => !nested.includes(n));
  li.remove();

  // Append the item's blocks into the previous item, before any trailing
  // nested list that already lives there.
  const tailNested = [...prev.children].filter((n) => n.tagName === "OL" || n.tagName === "UL");
  const anchor = tailNested[0] ?? null;
  const put = (n) => { if (anchor) prev.insertBefore(n, anchor); else prev.appendChild(n); };
  for (const n of rest) put(n);
  for (const n of nested) put(n);
  if (!list.children.length) list.remove();

  // Caret goes to the start of the line that just lost its marker.
  const sel = window.getSelection();
  const r = document.createRange();
  const target = rest[0];
  if (target && target.nodeType === 1) r.selectNodeContents(target);
  else if (target && target.nodeType === 3 && target.data.length) r.setStart(target, 0);
  else { r.selectNodeContents(prev); r.collapse(false); }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function liftFirstItem(list, li) {
  const kids = [...li.childNodes];
  const nested = kids.filter((n) => n.nodeType === 1 && (n.tagName === "OL" || n.tagName === "UL"));
  const rest = kids.filter((n) => !nested.includes(n));
  li.remove();

  const p = document.createElement("p");
  p.className = "tiptap-block";
  for (const n of rest) p.appendChild(n);
  if (!rest.length) p.appendChild(document.createElement("br"));

  list.parentNode.insertBefore(p, list);
  let anchor = p;
  for (const n of nested) {
    list.parentNode.insertBefore(n, anchor.nextSibling);
    anchor = n;
  }
  if (!list.children.length) list.remove();

  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(p);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
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
  const text = mention.text.trim();
  if (text) {
    // Instant IntelliSense-style suggestions: index the typed text against
    // offlineLookups + userLookups and render matches before the API round-trip.
    tryLocalSearch(mention.text);
    if (!mention.results.length) renderMentionList();   // "Searching…" pending the API
    if (userIndexPromise) {
      const q = mention.text.trim();
      userIndexPromise
        .then(() => { if (mention && mention.text.trim() === q) tryLocalSearch(q); })
        .catch(() => {});
    }
  } else {
    renderMentionList();
  }
  scheduleSearch();
}

// Present any offlineLookups/userLookups matches for the typed text immediately,
// so suggestions render in a fraction of a second instead of waiting on the API.
function tryLocalSearch(text) {
  if (!mention) return;
  const rows = localSearchRows(text);
  if (!rows.length) return;
  mention.results = rows;
  mention.searched = mention.text.trim();
  mention.lastErr = "";
  mention.active = 0;
  renderMentionList();
}

// IntelliSense-style ranking over the local maps — exact, then prefix, then
// substring matches, capped at 80 rows. This is the first suggestion source;
// searchAnything then augments with matches the local maps don't cover.
function localSearchRows(text) {
  const q = String(text || "").trim().toLowerCase();
  if (!q) return [];
  const cap = 80;
  const exact = [], prefix = [], contains = [];
  const sources = [["user", userIndex]];
  for (const [type, key] of Object.entries(OFFLINE_KEY)) sources.push([type, offlineLookups[key]]);
  for (const [type, map] of sources) {
    if (!map) continue;
    for (const id in map) {
      if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
      const name = String(map[id] || "");
      if (!name) continue;
      const nl = name.toLowerCase();
      if (nl === q) exact.push({ type, id, name });
      else if (nl.startsWith(q)) prefix.push({ type, id, name });
      else if (nl.includes(q)) contains.push({ type, id, name });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  exact.sort(byName); prefix.sort(byName); contains.sort(byName);
  return exact.concat(prefix, contains).slice(0, cap);
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
      // Local offlineLookups/userLookups matches stay first; the endpoint is the
      // fallback for anything the local maps don't know about yet.
      const merged = mention.results.slice();
      const seen = new Set(merged.map((r) => r.type + ":" + r.id));
      for (const row of rows) {
        const key = row.type + ":" + row.id;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
      mention.results = merged.slice(0, 80);
      mention.lastErr = "";
      mention.searched = text;
      mention.active = 0;
      renderMentionList();
      fillNames(merged);
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

// Chip badges — a tiny em-sized glyph before every recognized entity name so
// chips that share a display name (e.g. an MU vs a user) stay distinguishable.
// User → avatar, country → flag, alliance → handshake in the alliance color
// scheme, the rest → a fixed type icon.
function chipBadgeHtml(type, id) {
  if (type === "user") {
    const u = S.lookups.usersById.get(id);
    const av = u?.avatarUrl || u?.avatar;
    if (av) return `<img class="j-chip-badge j-chip-avatar" src="${esc(av)}" alt="" draggable="false">`;
    return `<iconify-icon icon="mdi:account-circle" class="j-chip-badge" style="color:${CHIP_NEUTRAL}"></iconify-icon>`;
  }
  if (type === "country") {
    const c = S.lookups.countriesById.get(id);
    if (c?.code) return `<img class="j-chip-badge j-chip-avatar j-chip-flag" src="https://media.warera.io/images/flags/${String(c.code).toLowerCase()}.svg" alt="" draggable="false">`;
    return `<iconify-icon icon="mdi:flag-variant" class="j-chip-badge" style="color:${CHIP_NEUTRAL}"></iconify-icon>`;
  }
  if (type === "alliance") {
    const ac = allianceColor(id);
    return `<iconify-icon icon="mdi:handshake" class="j-chip-badge" style="color:${ac || CHIP_NEUTRAL}"></iconify-icon>`;
  }
  const B = CHIP_BADGES[type];
  if (!B) return "";
  return `<iconify-icon icon="${B.icon}" class="j-chip-badge" style="color:${B.color}"></iconify-icon>`;
}

// Fill a chip with its badge + display name. The name text node stays the FIRST
// child (badge appended after it and drawn first via CSS row-reverse) so the
// caret/atomicity logic that targets the chip text node keeps working.
function renderChip(ent, name, type, id) {
  const wrap = document.createElement("span");
  wrap.className = "j-chip-badge-wrap";
  wrap.innerHTML = chipBadgeHtml(type, id);
  ent.textContent = "";
  ent.appendChild(document.createTextNode(name || ""));
  if (wrap.firstChild) ent.appendChild(wrap.firstChild);
}

// Resolve the entity so badges needing API data (user avatar, country flag,
// alliance color) fill in once the lookup map holds the full record.
function upgradeChip(ent, type, id, resolveName = false) {
  const k = apiKey();
  if (!k) return;
  resolveEntityByType(type, id, k)
    .then((data) => {
      if (!data || !ent.isConnected) return;
      const name = entityDisplayName(type, id, data);
      const current = ent.firstChild?.nodeType === 3 ? ent.firstChild.data : "";
      renderChip(ent, resolveName && name && !/^Unknown /.test(name) ? name : current, type, id);
    })
    .catch(() => {});
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
  renderChip(ent, name, type, id);
  r.insertNode(ent);
  placeCaretAfter(ent);
  upgradeChip(ent, type, id);
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
      renderChip(ent, name, type, id);
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
  J.editor.innerHTML = stripCollapseCarets(d.html);
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
  input.autocomplete = "one-time-code";
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

// Structured asset shape stored in the library:
//   { id, url, provider, type, width, height, size, name, source, createdAt }
// Legacy entries only carried { id, url, addedAt } — these are upgraded on load
// through the normalizer below (provider defaults to "imgur", source to "").
const SOURCE_LABELS = { "table-maker": "▦ Table" };

// Layer any library entry onto the shared shape, deduping on url. Exported so
// the Table Maker can push its generated tables straight into the Image Library.
export function addImageToLibrary(entry) {
  const url = String(entry?.url || "").trim();
  if (!url) return null;
  const dup = images.find((i) => i.url === url);
  if (dup) return dup;
  const asset = {
    id: entry.id || uid(),
    url,
    provider: entry.provider || "imgur",
    type: entry.type || "",
    width: entry.width || 0,
    height: entry.height || 0,
    size: entry.size || 0,
    name: entry.name || "",
    source: entry.source || "",
    createdAt: entry.createdAt || entry.addedAt || Date.now(),
  };
  images = [asset, ...images];
  saveLS(LS_IMAGES, images);
  renderImages();
  return asset;
}

function addImageFromInput() {
  const parsed = validateImageUrl(J.imageUrl.value);
  if (!parsed) { toast("Not a recognised image URL. Use imgur, giphy or tenor direct links."); return; }
  if (images.some((i) => i.url === parsed.url)) { toast("Image already in library."); return; }
  addImageToLibrary({ url: parsed.url });
  J.imageUrl.value = "";
  toast("Image added.");
}

// Upload a local file to Imgur, then add it to the library and/or insert it at
// the caret. Every editor entry point — drag/drop, paste, toolbar upload and
// the library's own upload button — funnels through here.
async function uploadLocalImage(file, { insert = false, source = "editor" } = {}) {
  if (!file) return;
  const label = file.name || "image";
  toast(source ? `Uploading ${label} to ${source}…` : `Uploading ${label}…`);
  try {
    if (file.size > LARGE_IMAGE_BYTES) toast("Image is larger than 1 MB — Imgur may compress it.");
    const uploaded = await uploadImageToImgur(file, file.name || "image.png");
    addImageToLibrary({ ...uploaded, name: file.name || "", source, createdAt: Date.now() });
    if (insert) insertImage(uploaded.url);
    toast(insert ? "Image uploaded and inserted." : "Image added to library.");
  } catch (err) {
    toast(err.message || "Upload failed.");
  }
}

// Editor paste: image files win over text; otherwise the usual text flow.
function onEditorPaste(e) {
  const cd = e.clipboardData || window.clipboardData;
  const files = cd ? [...(cd.files || [])].filter((f) => f.type.startsWith("image/")) : [];
  if (files.length) {
    e.preventDefault();
    syncSelection();
    for (const file of files) uploadLocalImage(file, { source: "editor", insert: true });
    return;
  }
  e.preventDefault();
  pasteWithLinks(cd?.getData("text/plain") || "");
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
    none.textContent = "No images yet. Add a direct imgur/giphy link or upload an image.";
    J.imageGrid.appendChild(none);
    return;
  }
  for (const im of images) {
    const item = document.createElement("div");
    item.className = "j-img-item";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = im.url;
    img.alt = im.name || "";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "j-img-del";
    del.textContent = "✕";
    del.title = "Remove image";
    item.append(img, del);
    if (SOURCE_LABELS[im.source]) {
      const badge = document.createElement("span");
      badge.className = "j-img-source";
      badge.textContent = SOURCE_LABELS[im.source];
      badge.title = im.name || im.source;
      item.append(badge);
    }
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
  layoutGutter(); // font size changed → line boxes moved
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
  syncEditorEmpty();
  findState.matches = [];
  findState.idx = -1;
  findState.term = "";
  updateFindLabel();
  persistEditor();
  updateInfoBar();
  J.editor.focus({ preventScroll: true });
  // The sole <p> still holds a trailing <br>, and browsers default the caret
  // AFTER that <br> (i.e. the second line). Pin the caret to the very start of
  // the paragraph so it sits on the first line, right where the "Start
  // writing…" placeholder is — just like a never-touched editor.
  const firstBlock = J.editor.firstElementChild;
  if (firstBlock) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(firstBlock, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

/* ── BLOCK-STRUCTURE NORMALIZATION ─────────────────────
   Contenteditable lets Chrome drop an <hr> and bare text into the SAME div
   (e.g. `<div><div><hr>kk</div></div>`). That shared container is not a shape
   the logical-line model should keep, so generic div containers that mix a
   block-level child with bare/inline siblings are split: each inline run gets
   wrapped in its own <div> and block elements keep their own <div>. Every
   logical line then owns a distinct container again, and <hr> + following text
   are separate blocks by construction. Runs of only whitespace are dropped.
   Semantic wrappers (blockquote/pre/details/li/…) and unknown nesting are never
   restructured. */

const GUTTER_BLOCK_ELEMS = /^(?:HR|P|H[1-6]|PRE|BLOCKQUOTE|UL|OL|DL|TABLE|DETAILS|FIGURE|LI|DIV)$/i;

function isInlineNode(n) {
  if (n.nodeType === 3) return /\S/.test(n.data);
  if (n.nodeType !== 1) return false;
  return !GUTTER_BLOCK_ELEMS.test(n.tagName);
}

function splitMixedContainer(el) {
  const kids = [...el.childNodes];
  if (!kids.some(isInlineNode)) return false;
  if (!kids.some(n => n.nodeType === 1 && GUTTER_BLOCK_ELEMS.test(n.tagName))) return false;
  const out = document.createDocumentFragment();
  let run = [];
  const flush = () => {
    if (run.some(isInlineNode)) {
      const w = document.createElement("div");
      for (const n of run) w.appendChild(n);
      out.appendChild(w);
    } else {
      for (const n of run) if (n.nodeType === 3) out.appendChild(n);
    }
    run = [];
  };
  for (const n of kids) {
    if (n.nodeType === 1 && GUTTER_BLOCK_ELEMS.test(n.tagName)) {
      flush();
      if (n.tagName === "HR") { const w = document.createElement("div"); w.appendChild(n); out.appendChild(w); }
      else out.appendChild(n);
    } else run.push(n);
  }
  flush();
  el.replaceChildren(out);
  return true;
}

function normalizeEditorBlocks() {
  if (!J.editor) return false;
  // Deepest divs first, then the editor root itself — but NEVER pre blockers:
  // generic <div> wrappers are the only containers Chrome back-fills with bare
  // text alongside block-level children.
  const candidates = [...J.editor.querySelectorAll("div")].reverse();
  let changed = false;
  for (const el of candidates) if (splitMixedContainer(el)) changed = true;
  if (splitMixedContainer(J.editor)) changed = true;
  if (changed) { updateInfoBar(); syncEditorEmpty(); layoutGutter(); schedulePersist(); }
  return changed;
}

/* ── HORIZONTAL RULE ──────────────────────────────────── */

// Insert an <hr> and immediately re-balance the block structure so the rule and
// whatever the caret types next live in separate containers (the exact shape
// the logical-line model expects). The caret is then pinned just past the rule.
function insertHr() {
  withSelection(() => {
    document.execCommand("insertHorizontalRule");
    normalizeEditorBlocks();
    layoutGutter();
    pinCaretAfterLastHr();
  });
  syncEditorEmpty();
  schedulePersist();
}

// Place the caret on the first content that follows the newest <hr>, or at the
// end of the document when the rule is the last thing.
function pinCaretAfterLastHr() {
  const hrs = [...J.editor.querySelectorAll("hr")];
  if (!hrs.length) return;
  const hr = hrs[hrs.length - 1];
  const sel = window.getSelection();
  const range = document.createRange();
  const land = () => {
    sel.removeAllRanges();
    sel.addRange(range);
  };

  let next = hr.nextSibling;
  if (!next && hr.parentElement && hr.parentElement !== J.editor) {
    let sib = hr.parentElement.nextSibling;
    while (sib && sib.nodeType === 3 && !/\S/.test(sib.data)) sib = sib.nextSibling;
    next = sib;
  }
  if (next && next.nodeType === 1) { range.selectNodeContents(next); range.collapse(true); land(); return; }
  if (next && next.nodeType === 3) { range.setStart(next, 0); range.collapse(true); land(); return; }

  const last = J.editor.lastChild;
  if (last && last.nodeType === 1) { range.selectNodeContents(last); range.collapse(false); }
  else { range.selectNodeContents(J.editor); range.collapse(true); }
  land();
}

/* ── EMPTY-STATE PLACEHOLDER ──────────────────────────────── */

function editorIsEmpty() {
  if (!J.editor) return true;
  if (/\S/.test(J.editor.textContent || "")) return false;
  return !J.editor.querySelector("img, iframe, video, audio, canvas, hr, table, object, embed, svg");
}

function syncEditorEmpty() {
  const empty = editorIsEmpty();
  if (!J.editor) return;
  J.editor.classList.toggle("is-empty", empty);
  if (J.placeholder) J.placeholder.hidden = !empty;
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

/* ── HELP MODAL ───────────────────────────────────────── */

function openHelp() {
  const m = J.helpModal;
  if (!m) return;
  m.classList.remove("hidden");
  J.helpCloseBtn?.focus();
}

function closeHelp() {
  J.helpModal?.classList.add("hidden");
  J.helpBtn?.focus();
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

/* ── PASTE & AUTO-LINK ─────────────────────────────────── */

// War Era turns pasted URLs into inline <a> links (its TipTap Link paste rule):
//   - a bare URL pasted at the caret becomes an anchor whose text is the URL,
//   - a URL pasted over selected text "manifests" the selection as the link
//     label (the text stays, the clipboard URL becomes its href),
//   - URLs embedded in otherwise-plain pasted text are linked inline too.
// The token regex stops at whitespace/HTML brackets; trailing "conversational"
// punctuation (comma, period, quote…) is peeled off and stays as plain text.

const URL_TOKEN_RE = /https?:\/\/[^\s<>"'`]+/gi;
const URL_TAIL_RE = /[.,;:!?'"\u201C\u201D\u2018\u2019)\]}>]/;

function splitLinkText(text) {
  const parts = [];
  let last = 0;
  let m;
  URL_TOKEN_RE.lastIndex = 0;
  while ((m = URL_TOKEN_RE.exec(text))) {
    let body = m[0];
    let trailing = "";
    while (body.length && URL_TAIL_RE.test(body[body.length - 1])) {
      trailing = body[body.length - 1] + trailing;
      body = body.slice(0, -1);
    }
    if (body) {
      if (m.index > last) parts.push({ text: text.slice(last, m.index) });
      parts.push({ text: body, url: body });
    }
    if (trailing) parts.push({ text: trailing });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function linkAnchorHtml(href, label) {
  return `<a href="${esc(href)}" class="tiptap-link" target="_blank" rel="noopener noreferrer nofollow">${esc(label)}</a>`;
}

function linkifyPlainText(text) {
  const parts = splitLinkText(text);
  if (!parts.some((p) => p.url)) return null;
  return parts.map((p) => (p.url ? linkAnchorHtml(p.url, p.text) : esc(p.text))).join("").replace(/\n/g, "<br>");
}

function singleUrlOf(text) {
  const parts = splitLinkText(String(text || "").trim());
  let url = null;
  for (const p of parts) {
    if (p.url) { if (url) return null; url = p.url; }
    // Only whitespace / "trailing punctuation" may accompany the URL — anything
    // else (real words) means the clipboard holds plain text, not a bare URL.
    else if (/[^\s.,;:!?'"\u201C\u201D\u2018\u2019…)\]}>-]/.test(p.text)) return null;
  }
  return url || null;
}

function pasteWithLinks(text) {
  syncSelection();
  const sel = window.getSelection();
  let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  range = range && J.editor.contains(range.startContainer) ? range : null;

  // War Era entity URL/path → the same entity mention chip a name mention makes.
  // (URL mention is the universal alternative input: any of the nine entity types.)
  const we = parseWarEraEntityPath(text);
  if (we) {
    if (insertEntityChip(we.type, we.id, we.fullMatch, range)) return;
    return; // selection overlapped a chip/media — drop the paste rather than corrupt it
  }

  const url = singleUrlOf(text);

  if (url && range && !range.collapsed) {
    const startBlock = blockAt(range.startContainer);
    const touchesAtomic = [...J.editor.querySelectorAll("[data-content-link], img, iframe, details")].some((n) => {
      if (range.intersectsNode) return range.intersectsNode(n);
      return n.contains(range.startContainer) || n.contains(range.endContainer);
    });
    if (!touchesAtomic) {
      const startA = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const endA = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
      const existingA = startA?.closest?.("a");
      if (existingA && existingA === endA?.closest?.("a")) {
        // Selecting inside an existing link re-points it instead of nesting anchors.
        existingA.setAttribute("href", url);
        syncSelection();
        updateInfoBar();
        schedulePersist();
        return;
      }
      if (startBlock && startBlock === blockAt(range.endContainer)) {
        // Manifest: the selected text becomes the link label, its clipboard URL the href.
        document.execCommand("insertHTML", false, linkAnchorHtml(url, range.toString()));
        syncSelection();
        updateInfoBar();
        schedulePersist();
        return;
      }
    }
  }

  document.execCommand("insertHTML", false, linkifyPlainText(text) || esc(text).replace(/\n/g, "<br>"));
  syncSelection();
  updateInfoBar();
  schedulePersist();
}

// URL mention — a War Era entity URL/path pasted at the caret becomes the exact
// same data-content-link chip a resolved name mention produces (data-content-type,
// data-content-data with "<type>Id"+fullMatch, data-original-text, atomic caret).
// The display name fills in asynchronously through the article-reader resolver
// (resolveEntityByType, cached in S.lookups); until then the chip shows the
// recognized path so the author always sees what was detected. The chip is valid
// even unresolved — War Era resolves ids at render time.
// Returns false when the paste was refused (non-collapsed selection touching a
// chip/images/media) so the caller can bail without corrupting content.
function insertEntityChip(type, id, fullMatch, range) {
  range = range || (window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null);
  range = range && J.editor.contains(range.startContainer) ? range : null;
  if (!range) return false;
  if (!range.collapsed) {
    const touchesAtomic = [...J.editor.querySelectorAll("[data-content-link], img, iframe, details")].some((n) => {
      if (range.intersectsNode) return range.intersectsNode(n);
      return n.contains(range.startContainer) || n.contains(range.endContainer);
    });
    if (touchesAtomic) return false;
  }
  const ent = document.createElement("span");
  ent.setAttribute("data-content-link", "");
  ent.setAttribute("data-content-type", type);
  ent.setAttribute("data-content-data", JSON.stringify({ [DATA_KEY[type]]: id, fullMatch }));
  ent.setAttribute("data-original-text", fullMatch);
  // Locked chip — same atomic behavior as name mentions (backspace/delete whole,
  // caret held out, formatting never touches it).
  ent.setAttribute("contenteditable", "false");
  renderChip(ent, localName(type, id) || fullMatch, type, id);
  if (!range.collapsed) range.deleteContents();
  range.insertNode(ent);
  placeCaretAfter(ent);
  upgradeChip(ent, type, id, true);
  updateInfoBar();
  schedulePersist();
  return true;
}