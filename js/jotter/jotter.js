// Article Jotter — War-Era-compatible rich text editor (see docs/warera-editor-reference.md).
// A contenteditable surface + execCommand toolbar, serializing to TipTap HTML via ./serialize.js.

import { serializeEditorHtml } from "./serialize.js";
import { offlineLookups } from "../../data/offlineLookups.js";
import { toast } from "../ui/toast.js";

const LS_DRAFTS = "wa-nd-jotter-drafts";
const LS_IMAGES = "wa-nd-jotter-images";

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

const ENT_TYPES = [
  { type: "user", label: "User" },
  { type: "country", label: "Country" },
  { type: "region", label: "Region" },
  { type: "party", label: "Party" },
  { type: "mu", label: "MU" },
  { type: "alliance", label: "Alliance" },
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
let mention = null;        // {state:'kind'|'search', type, anchorNode, anchorOffset}
let pending = null;        // {span, type, id, name}
let userIndex = null;      // lazy id→name map
let userIndexPromise = null;

const J = {};

export async function initJotter() {
  if (J.done) return;
  J.done = true;

  J.title = document.getElementById("jTitleInput");
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

  document.execCommand("styleWithCSS", false, "true");

  drafts = loadLS(LS_DRAFTS, []);
  images = loadLS(LS_IMAGES, []);
  renderDrafts();
  renderImages();

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
  J.editor.addEventListener("input", () => { updateInfoBar(); syncSelection(); onEditorInput(); });
  J.editor.addEventListener("keydown", (e) => onEditorKeydown(e));
  J.editor.addEventListener("keyup", () => { syncSelection(); updateInfoBar(); });
  J.editor.addEventListener("mouseup", () => { syncSelection(); updateInfoBar(); });
  J.editor.addEventListener("blur", () => { if (mention) hideMention(); });
  J.editor.addEventListener("paste", (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData)?.getData("text/plain") || ""; insertTextSanitized(t); });

  document.addEventListener("selectionchange", () => {
    // No activeElement gate: the editor never "has" focus while a toolbar
    // <select> holds it, yet the DOM range must stay current or toolbar
    // commands keep targeting the last select-driven position.
    const r = window.getSelection();
    if (r.rangeCount && J.editor.contains(r.getRangeAt(0).startContainer)) {
      savedRange = r.getRangeAt(0).cloneRange();
      updateInfoBar();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (e.target.closest?.(".j-img-item, .j-img-del, .j-images")) e.preventDefault();
  }, true);

  // Image library
  J.imageAdd.addEventListener("click", () => addImageFromInput());
  J.imageUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addImageFromInput(); } });

  // Mention popup scaffolding
  J.pop = document.createElement("div");
  J.pop.className = "j-mention-pop";
  J.pop.style.display = "none";
  document.body.appendChild(J.pop);
  J.pop.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
  J.pop.addEventListener("click", (e) => {
    const kind = e.target.closest(".j-mention-kind");
    if (kind) { pickMentionKind(kind.dataset.type); return; }
    const item = e.target.closest(".j-mention-item");
    if (item) { compleMention(item.dataset.id, item.dataset.type); return; }
  });
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
  const tw = document.createTreeWalker(J.editor, NodeFilter.SHOW_TEXT);
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
  fn();
  syncSelection();
  updateInfoBar();
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
  const iter = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const t = node.tagName;
      if (t !== "SPAN" && t !== "FONT") return NodeFilter.FILTER_SKIP;
      if (node.hasAttribute("data-content-link")) return NodeFilter.FILTER_SKIP;
      return fullyInside(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
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
function normFont(s) { return String(s||"").toLowerCase().replace(/["']/g,"").replace(/\s+/g," ").trim(); }
function parseRgb(s) { const m=String(s).match(/rgba?\(([^)]+)\)/); return m ? m[1].split(",").map(x=>Math.round(parseFloat(x))) : [0,0,0]; }
function sameColor(a,b) { const x=parseRgb(a),y=parseRgb(b); return x[0]===y[0]&&x[1]===y[1]&&x[2]===y[2]; }
function hexToRgb(hex) { const v=String(hex).replace(/^#/,""); const n=parseInt(v.length===3?[...v].map(c=>c+c).join(""):v,16); return `rgb(${(n>>16)&255},${(n>>8)&255},${n&255})`; }

function updateToolbarState() {
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
}

function insertImage(url) {
  const parsed = validateImageUrl(url);
  if (!parsed) { toast("Not a recognised image URL. Use imgur, giphy or tenor direct links."); return; }
  apply("insertHTML", `<img class="tiptap-image" src="${esc(parsed.url)}">`);
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
}

function insertTiktok(url) {
  const id = tiktokId(url);
  if (!id) { toast("Not a recognised TikTok URL."); return; }
  apply("insertHTML",
    `<div class="tiptap-tiktok"><iframe src="https://www.tiktok.com/embed/v2/${id}" videoid="${id}" ` +
    `width="325" height="580" allow="encrypted-media; fullscreen" allowfullscreen="true" ` +
    `frameborder="0" scrolling="no"></iframe></div>`);
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
  if (mention && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab" || e.key === "Escape")) {
    e.preventDefault();
    navMention(e.key);
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    apply(e.shiftKey ? "outdent" : "indent");
    return;
  }
  if (e.key === "@") {
    const sel = window.getSelection();
    const r = sel.rangeCount ? sel.getRangeAt(0) : null;
    // Capture the caret before '@' is inserted — this is the mention start.
    mention = { state: "kind", type: null, anchorNode: r?.startContainer, anchorOffset: r?.startOffset ?? 0 };
    setTimeout(() => renderMentionPopup(), 0);
    return;
  }
  if (e.key === " ") {
    if (pending) {
      e.preventDefault();
      if (caretAdjacentToPending()) resolvePending(); else unwrapPending();
      return;
    }
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
  if (e.key === "Backspace" && pending) {
    const block = blockAt(window.getSelection()?.focusNode);
    if (block && block.contains(pending.span)) {
      unwrapPending();
    }
  }
  updateInfoBar();
}

function syncMentionAnchor() {
  const sel = window.getSelection();
  if (mention && sel.rangeCount) {
    mention.anchorNode = sel.getRangeAt(0).startContainer;
    mention.anchorOffset = sel.getRangeAt(0).startOffset;
  }
}

function onEditorInput() {
  // A Space that resolves a pending mention is consumed in keydown before this fires;
  // any other input reaching here while a mention is pending cancels it.
  if (pending) unwrapPending();
  if (mention) renderMentionPopup();
}

function unwrapPending() {
  if (!pending) return;
  const span = pending.span;
  pending = null;
  if (span.isConnected) span.replaceWith(...span.childNodes);
}

function caretAdjacentToPending() {
  if (!pending || !pending.span || !pending.span.isConnected) return true;
  const span = pending.span;
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  const isEndOfSpan = r.startContainer === span && r.startOffset >= span.childNodes.length;
  const isAfterSpan = r.startContainer === span.parentNode &&
    r.startOffset === Array.prototype.indexOf.call(span.parentNode.childNodes, span) + 1;
  const isStartOfNext = span.nextSibling && r.startContainer === span.nextSibling && r.startOffset === 0;
  return isEndOfSpan || isAfterSpan || isStartOfNext;
}

/* ── MENTIONS ──────────────────────────────────────────── */

function mentionText() {
  if (!mention || !mention.anchorNode || !mention.anchorNode.isConnected) return "";
  const sel = window.getSelection();
  if (!sel.rangeCount || !J.editor.contains(sel.getRangeAt(0).startContainer)) return "";
  const r = document.createRange();
  r.setStart(mention.anchorNode, mention.anchorOffset);
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return r.toString();
}

function renderMentionPopup() {
  if (!mention || !J.pop) return;
  J.pop.innerHTML = "";
  const sel = window.getSelection();
  let top = 0, left = 0;
  if (sel.rangeCount) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    top = rect.bottom + 4;
    left = rect.left;
  }
  if (mention.state === "kind") {
    for (const t of ENT_TYPES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "j-mention-kind";
      b.dataset.type = t.type;
      b.textContent = "@" + t.type;
      J.pop.appendChild(b);
    }
    const hint = document.createElement("div");
    hint.className = "j-mention-empty";
    hint.textContent = "Choose entity type";
    J.pop.appendChild(hint);
  } else {
    if (mention.type === "user" && !userIndex && userIndexPromise) {
      userIndexPromise.then(() => { if (mention) renderMentionPopup(); }).catch(() => {});
    }
    const prefix = mentionText().slice(mention.state === "search" ? ("@" + mention.type + ": ").length : 0);
    const items = candidatesFor(mention.type, prefix);
    if (!prefix) {
      const hint = document.createElement("div");
      hint.className = "j-mention-empty";
      hint.textContent = `Keep typing to search @${mention.type}…`;
      J.pop.appendChild(hint);
    } else if (!items.length) {
      const none = document.createElement("div");
      none.className = "j-mention-empty";
      none.textContent = "No matches";
      J.pop.appendChild(none);
    } else {
      for (const it of items.slice(0, 30)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "j-mention-item";
        b.dataset.id = it.id;
        b.dataset.type = it.type;
        const t = document.createElement("span");
        t.className = "j-mi-type";
        t.textContent = it.type;
        const n = document.createElement("span");
        n.className = "j-mi-name";
        n.textContent = it.name;
        b.append(t, n);
        J.pop.appendChild(b);
      }
    }
  }
  J.pop.style.display = "block";
  J.pop.style.top = Math.max(4, Math.min(top, window.innerHeight - J.pop.offsetHeight - 4)) + "px";
  J.pop.style.left = Math.max(4, Math.min(left, window.innerWidth - J.pop.offsetWidth - 4)) + "px";
}

function pickMentionKind(type) {
  if (!mention) return;
  mention.type = type;
  mention.state = "search";
  if (type === "user" && !userIndex) getUserIndexSync();
  document.execCommand("insertText", false, " " + type + ": ");
  renderMentionPopup();
  J.editor.focus({ preventScroll: true });
}

function candidatesFor(type, prefix) {
  const P = (prefix || "").toLowerCase();
  if (!P) return [];
  let map = null;
  if (type === "user") {
    map = userIndex;
    if (!map) return [];
  } else {
    map = offlineLookups[OFFLINE_KEY[type]];
  }
  if (!map) return [];
  const out = [];
  for (const [id, name] of Object.entries(map)) {
    if (String(name).toLowerCase().startsWith(P)) {
      out.push({ id, name: String(name), type });
      if (out.length >= 40) break;
    }
  }
  return out;
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

function navMention(key) {
  if (!J.pop) return;
  const items = [...J.pop.querySelectorAll(".j-mention-item")];
  const kinds = [...J.pop.querySelectorAll(".j-mention-kind")];
  if (mention?.state === "kind") {
    if (key === "ArrowDown" || key === "ArrowUp") {
      const idx = kinds.indexOf(document.activeElement);
      const next = key === "ArrowDown" ? (idx + 1) % kinds.length : (idx - 1 + kinds.length) % kinds.length;
      kinds[next]?.focus();
    }
    if (key === "Enter" || key === "Tab") {
      pickMentionKind(kinds[0]?.dataset?.type || "user");
    }
    if (key === "Escape") {
      hideMention();
    }
    return;
  }
  if (key === "ArrowDown" || key === "ArrowUp") {
    const cur = J.pop.querySelector(".is-active") || items[0];
    const idx = items.indexOf(cur);
    const next = key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items.forEach((i) => i.classList.remove("is-active"));
    items[next]?.classList.add("is-active");
  } else if (key === "Enter" || key === "Tab") {
    const active = J.pop.querySelector(".is-active") || items[0];
    if (active) compleMention(active.dataset.id, active.dataset.type);
  } else if (key === "Escape") {
    hideMention();
  }
}

function compleMention(id, type) {
  if (!mention) return;
  const name = nameFor(type, id);
  if (!name) return;
  const r = document.createRange();
  r.setStart(mention.anchorNode, mention.anchorOffset);
  const sel = window.getSelection();
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  const span = document.createElement("span");
  span.className = "j-mention-pending";
  span.dataset.jtype = type;
  span.dataset.jid = id;
  span.textContent = "@" + type + ": " + name;
  r.deleteContents();
  r.insertNode(span);
  const r2 = document.createRange();
  r2.selectNodeContents(span);
  r2.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r2);
  pending = { span, type, id, name };
  mention = null;
  hideMention();
  J.editor.focus({ preventScroll: true });
}

function nameFor(type, id) {
  let map;
  if (type === "user") map = userIndex;
  else map = offlineLookups[OFFLINE_KEY[type]];
  return map?.[id] || "";
}

function resolvePending() {
  if (!pending) return;
  const { span, type, id, name } = pending;
  pending = null;
  if (!span.isConnected) return;
  const ent = document.createElement("span");
  ent.setAttribute("data-content-link", "");
  ent.setAttribute("data-content-type", type);
  ent.setAttribute("data-content-data", JSON.stringify({ [DATA_KEY[type]]: id, fullMatch: `/${type}/${id}` }));
  ent.setAttribute("data-original-text", `/${type}/${id}`);
  ent.textContent = name || id;
  span.replaceWith(ent);
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(ent);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
  updateInfoBar();
}

function hideMention() {
  if (J.pop) J.pop.style.display = "none";
  mention = null;
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
  updateInfoBar();
  renderDrafts(id);
  toast(`Loaded "${d.title}".`);
}

function renameDraft(id, title) {
  drafts = drafts.map((x) => (x.id === id ? { ...x, title: title.trim() || x.title } : x));
  saveLS(LS_DRAFTS, drafts);
  renderDrafts();
}

function deleteDraft(id) {
  drafts = drafts.filter((x) => x.id !== id);
  saveLS(LS_DRAFTS, drafts);
  renderDrafts();
  toast("Draft deleted.");
}

function shortDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
    const editBtn = makeIconBtn("boxicons:edit-filled", "Rename");
    const delBtn = makeIconBtn("ep:delete", "Delete");
    delBtn.classList.add("danger");
    actions.append(editBtn, delBtn);

    card.append(title, date, actions);

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
}