// Article Jotter — serializes the contenteditable editor DOM into the TipTap
// HTML dialect used by the War Era article editor (see docs/warera-editor-reference.md).
// The output is ONE condensed line, mirroring War Era's copy exactly:
//   - empty "enter space" blocks between paragraphs are dropped
//   - a spacer that follows an image/embed is absorbed as a leading <br> in the
//     next paragraph (War Era merges them)
//   - the document always ends with one empty <p class="tiptap-block">…<br></p>
//   - a multi-line <pre> keeps its first line in <code>, the rest become paragraphs
//   - inline styles are normalized (font-family first, no system-ui fallback,
//     single-family names unquoted)
//   - raw non-breaking spaces serialize as &nbsp;
// NOTE: cleanInline must never be run on the live editor — it strips classes.

const BLOCK_TAGS = new Set([
  "HR","IMG","BLOCKQUOTE","PRE","DETAILS","TABLE","FIGURE","IFRAME","H1","H2","H3","H4","H5","H6"
]);

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function docFor(root) {
  if (root && root.ownerDocument) return root.ownerDocument;
  if (typeof document !== "undefined") return document;
  return null;
}
function makeDiv(el) { return docFor(el).createElement("div"); }

const LEAF_TAGS = new Set(["IMG", "IFRAME", "HR", "PRE", "DETAILS", "TABLE", "FIGURE"]);
const isEmbedDiv = (el) => el.tagName === "DIV" &&
  (el.hasAttribute?.("data-youtube-video") || el.classList?.contains("tiptap-tiktok"));

/* ── STYLE NORMALIZATION ───────────────────────────────── */

function normFontFamily(v) {
  let parts = String(v).split(",").map((p) => p.trim());
  parts = parts.filter((p) => p.toLowerCase() !== "system-ui");
  if (parts.length === 1) parts = [parts[0].replace(/^["']|["']$/g, "")];
  return parts.join(", ");
}

// Reorder declarations (font-family first, then color) and drop the
// system-ui fallback so output matches War Era's copy exactly.
function normStyle(s) {
  const map = new Map();
  for (const d of String(s).split(";")) {
    const i = d.indexOf(":");
    if (i < 0) continue;
    map.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim());
  }
  const ordered = [];
  if (map.has("font-family")) ordered.push(["font-family", normFontFamily(map.get("font-family"))]);
  if (map.has("color")) ordered.push(["color", map.get("color")]);
  for (const [k, v] of map) {
    if (k !== "font-family" && k !== "color") ordered.push([k, v]);
  }
  return ordered.map(([k, v]) => `${k}: ${v};`).join(" ");
}

/* ── CLEANUP ───────────────────────────────────────────── */

function removeTrailingBr(el) {
  while (el.lastChild && el.lastChild.nodeType === 1 && (el.lastChild.tagName === "BR" || el.lastChild.tagName === "P")) {
    const c = el.lastChild;
    if (c.tagName === "BR") { c.remove(); continue; }
    if (c.tagName === "P" && !c.innerHTML) { c.remove(); continue; }
    break;
  }
}

function cleanInline(root) {
  for (const f of [...root.querySelectorAll("font")]) {
    const span = docFor(root).createElement("span");
    const style = [];
    const face = f.getAttribute("face");
    const color = f.getAttribute("color");
    if (face) style.push(`font-family:${face};`);
    if (color) style.push(`color:${color};`);
    if (style.length) span.setAttribute("style", style.join(" "));
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
  }
  for (const el of [...root.querySelectorAll("*")]) {
    if (el.tagName === "HR") el.removeAttribute("id");
    if ((el.getAttribute("id") || "") === "" || el.getAttribute("id") === "null") el.removeAttribute("id");
    el.removeAttribute("contenteditable");
    el.removeAttribute("spellcheck");
    el.removeAttribute("data-jmention");
    if (el.getAttribute && el.getAttribute("style")) {
      el.setAttribute("style", normStyle(el.getAttribute("style")));
    }
    if (el.tagName === "A") {
      el.classList.add("tiptap-link");
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer nofollow");
      const href = el.getAttribute("href") || "";
      if (href && !/^https?:\/\//i.test(href) && !href.startsWith("#")) {
        el.setAttribute("href", "https://" + href);
      }
    }
    if (el.tagName === "IMG") el.classList.add("tiptap-image");
    if (el.classList?.contains("j-collapse-caret")) {
      if (el.textContent) el.replaceWith(...el.childNodes); else el.remove();
      continue;
    }
    if (el.classList?.contains("j-mention-pending")) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    // Entity mentions store their display name only as transient editor text —
    // War Era keeps the span EMPTY and shows the name from data-content-data.
    if (el.hasAttribute?.("data-content-link")) {
      while (el.firstChild) el.removeChild(el.firstChild);
      continue;
    }
    if (el.classList) {
      for (const c of [...el.classList]) {
        if (c.startsWith("j-")) el.classList.remove(c);
      }
      if (!el.classList.length) el.removeAttribute("class");
    }
  }
  for (const i of [...root.querySelectorAll("iconify-icon")]) i.remove();
  root.querySelectorAll("p,div,span,h1,h2,h3,h4,h5,h6,li,summary,blockquote")
    .forEach(removeTrailingBr);
}

// True when the block (or any nested block) carries content — images, embeds,
// code, text. Pure "<br>"/whitespace elements are "enter space" spacers.
function isEmptyBlock(el) {
  if (LEAF_TAGS.has(el.tagName)) return false;
  for (const c of el.childNodes) {
    if (c.nodeType === 3) { if (c.textContent.replace(/\s/g, "")) return false; continue; }
    if (c.nodeType !== 1) continue;
    if (c.tagName === "BR") continue;
    if (LEAF_TAGS.has(c.tagName) || isEmbedDiv(c)) return false;
    if (!isEmptyBlock(c)) return false;
  }
  return true;
}

/* ── SERIALIZATION PRIMITIVES ──────────────────────────── */

function cloneChildrenInto(container, el) {
  for (const c of [...el.childNodes]) container.appendChild(c.cloneNode(true));
}

// Inner HTML of an element (its children only, cleaned).
function innerHtml(el) {
  const d = makeDiv(el);
  cloneChildrenInto(d, el);
  cleanInline(d);
  return d.innerHTML;
}

// Outer HTML of an element (tag + children, cleaned) — passthrough for
// youtube/tiktok wrappers and inline spans inside list items.
function outerHtml(el) {
  const d = makeDiv(el);
  d.appendChild(el.cloneNode(true));
  cleanInline(d);
  return d.firstElementChild.outerHTML;
}

function alignOf(el) {
  const s = el.getAttribute && el.getAttribute("style") || "";
  const m = s.match(/text-align\s*:\s*([^;]+)/);
  return m ? m[1].trim() : "left";
}

function hasBlockChildren(el) {
  for (const c of el.childNodes) {
    if (c.nodeType === 1 && (BLOCK_TAGS.has(c.tagName) || c.tagName === "P" || c.tagName === "DIV" || c.tagName === "UL" || c.tagName === "OL")) {
      return true;
    }
  }
  return false;
}

function makeBlock(el, opts) {
  const a = opts?.align || alignOf(el);
  const d = makeDiv(el);
  cloneChildrenInto(d, el);
  cleanInline(d);
  let inner = d.innerHTML;
  if (inner === "<br>") inner = "";
  if (opts?.leadingBr) inner = "<br>" + inner;
  return `<p class="tiptap-block" style="text-align: ${a};">${inner}</p>`;
}

function textPara(t, leadingBr) {
  return `<p class="tiptap-block" style="text-align: left;">${leadingBr ? "<br>" : ""}${esc(t)}</p>`;
}

/* ── BLOCK EMITTERS ────────────────────────────────────── */

function emitList(list) {
  const isOl = list.tagName === "OL";
  const outer = [];
  let open = null; // current <li> being built
  const flush = (o) => {
    if (o.buf) { o.inner.push(`<p class="tiptap-block" style="text-align: left;">${o.buf}</p>`); o.buf = ""; }
  };
  for (const child of list.childNodes) {
    if (child.nodeType !== 1) continue;
    const tag = child.tagName;
    if (tag === "LI") {
      if (open) { flush(open); outer.push(`<li>${open.inner.join("")}</li>`);
      }
      open = { inner: [], buf: "" };
      for (const c of child.childNodes) {
        if (c.nodeType === 3) { const t = c.textContent || ""; if (t.replace(/\s/g, "")) open.buf += esc(t); continue; }
        if (c.nodeType !== 1) continue;
        const ct = c.tagName;
        if (ct === "UL" || ct === "OL") { flush(open); open.inner.push(emitList(c)); }
        else if (ct === "P" || ct === "DIV") {
          if (isEmptyBlock(c)) continue;
          if (isEmbedDiv(c)) { flush(open); open.inner.push(outerHtml(c)); }
          else if (hasBlockChildren(c)) { flush(open); open.inner.push(emit(c, false)); }
          else { flush(open); open.inner.push(makeBlock(c)); }
        }
        else if (BLOCK_TAGS.has(ct)) { flush(open); open.inner.push(emitBlock(c)); }
        else if (ct === "BR") { open.buf += "<br>"; }
        else open.buf += outerHtml(c);
      }
    } else if (tag === "UL" || tag === "OL") {
      if (open) { flush(open); open.inner.push(emitList(child)); }
      else outer.push(emitList(child));
    } else if (tag === "BR") {
      if (open) open.buf += "<br>";
    }
  }
  if (open) { flush(open); outer.push(`<li>${open.inner.join("")}</li>`); }
  const tag = isOl ? "ol" : "ul";
  return `<${tag} class="tight" data-tight="true">${outer.join("")}</${tag}>`;
}

function emitBlockquote(el) {
  const inner = [];
  const parts = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) inner.push(`<p class="tiptap-block" style="text-align: left;">${buf}</p>`);
    buf = "";
  };
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      const t = child.textContent || "";
      if (t.replace(/\s/g, "")) buf += esc(t);
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (isEmptyBlock(child)) continue;
    const tag = child.tagName;
    if (tag === "P" || tag === "DIV") { flush(); inner.push(makeBlock(child)); }
    else if (tag === "UL" || tag === "OL") { flush(); inner.push(emitList(child)); }
    else if (BLOCK_TAGS.has(tag)) { flush(); inner.push(emitBlock(child)); }
    else buf += outerHtml(child);
  }
  flush();
  return `<blockquote class="tiptap-blockquote">${inner.join("")}</blockquote>`;
}

// Split a <pre>'s content into visual lines. Browsers store consecutive code
// lines in various shapes: a <div> per line (Chrome, under <pre> or <code>),
// <br>-separated raw text with a stray empty <code> at the end, or raw
// newlines. Cloning the element and converting <br>s into newlines before
// reading textContent covers every case without double-escaping the text.
function preLines(el) {
  const divs = el.querySelectorAll("div");
  if (divs.length) {
    return [...divs].map((l) => (l.textContent || "").replace(/\s+$/, "")).filter((l) => l !== "");
  }
  const d = el.cloneNode(true);
  if (d.querySelectorAll("br").length) {
    for (const br of d.querySelectorAll("br")) br.replaceWith("\n");
    return d.textContent.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l !== "");
  }
  const code = d.querySelector(":scope > code");
  const src = code && code.textContent.trim() ? code : d;
  return src.textContent.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l !== "");
}

// War Era keeps only the first line inside <pre><code>; the rest of the code
// block demotes to regular paragraphs (its TipTap paste behavior).
function emitPreLines(el) {
  const lines = preLines(el);
  const out = [];
  if (lines.length) out.push(`<pre><code>${esc(lines[0])}</code></pre>`);
  for (let i = 1; i < lines.length; i++) out.push(textPara(lines[i]));
  return out;
}

function emitDetails(el) {
  const summary = [...el.children].find((c) => c.tagName === "SUMMARY");
  const body = [...el.children].find((c) =>
    c.className && /collapsible-body/.test(c.className) && c.tagName !== "SUMMARY"
  );
  const sHtml = summary ? innerHtml(summary).trim() : "Collapsible section";
  let bHtml = "";
  if (body) {
    const d = makeDiv(el);
    cloneChildrenInto(d, body);
    bHtml = emit(d, false);
  }
  return (
    `<details class="tiptap-collapsible">` +
    `<summary class="tiptap-collapsible-summary">${sHtml}</summary>` +
    `<div data-collapsible-body="" class="tiptap-collapsible-body">` +
    `<div class="tiptap-collapsible-body-inner">` +
    `<div class="tiptap-collapsible-body-content">${bHtml}</div>` +
    `</div></div></details>`
  );
}

function emitHeading(el) {
  const h = el.tagName.toLowerCase();
  return `<${h} style="text-align: ${alignOf(el)};">${innerHtml(el)}</${h}>`;
}

function emitBlock(el) {
  const tag = el.tagName;
  if (tag === "HR") return "<hr>";
  if (tag === "IMG") {
    const src = escAttr(el.getAttribute("src") || "");
    const alt = el.getAttribute("alt");
    return `<img class="tiptap-image" src="${src}"${alt ? ` alt="${escAttr(alt)}"` : ""}>`;
  }
  if (tag === "BLOCKQUOTE") return emitBlockquote(el);
  if (tag === "DETAILS") return emitDetails(el);
  if (/^H[1-6]$/.test(tag)) return emitHeading(el);
  return outerHtml(el);
}

const LEAF_RE = /^<(img|iframe)\b/;

// Returns the HTML chunk(s) for a single block-level DOM node. `leadPending`
// means a spacer before it should surface as a leading <br> in its first
// paragraph (when the previous block was an image/embed).
function blockChunks(node, leadPending) {
  const tag = node.tagName;
  if (tag === "P" || tag === "DIV" || tag === "LI" || tag === "SUMMARY") {
    if (isEmbedDiv(node)) return [outerHtml(node)];
    if (hasBlockChildren(node)) return [emit(node, false, leadPending)];
    return [makeBlock(node, { leadingBr: leadPending })];
  }
  if (tag === "UL" || tag === "OL") return [emitList(node)];
  if (tag === "BR") return [];
  if (BLOCK_TAGS.has(tag)) {
    if (tag === "PRE") return emitPreLines(node);
    return [emitBlock(node)];
  }
  return [makeBlock(node, { leadingBr: leadPending })];
}

// Condensed, no-whitespace serialization of a (already cloned) container.
// Spacer blocks are skipped; a spacer behind an image/embed becomes a leading
// <br> in the next paragraph; the top-level doc ends with an empty paragraph.
function emit(container, top, leadPending) {
  const out = [];
  let lastLeaf = false;
  const children = [...container.childNodes];
  for (const node of children) {
    if (node.nodeType === 3) {
      const t = node.textContent || "";
      if (t.replace(/\s/g, "")) {
        out.push(textPara(t, leadPending));
        lastLeaf = false;
        leadPending = false;
      }
      continue;
    }
    if (node.nodeType !== 1) continue;
    if (isEmptyBlock(node)) {
      if (lastLeaf) leadPending = true;
      continue;
    }
    const chunks = blockChunks(node, leadPending);
    leadPending = false;
    for (const s of chunks) {
      out.push(s);
      lastLeaf = LEAF_RE.test(s) || s.startsWith("<div data-youtube-video") || s.startsWith('<div class="tiptap-tiktok"');
    }
  }
  if (top) out.push('<p class="tiptap-block" style="text-align: left;"><br></p>');
  return out.join("");
}

// Safety net for Copy HTML: inline contenteditable=false chips make Chrome
// split the surrounding text into separate blocks (e.g.
//   <p>I am&nbsp;</p><p><span data-content-link …></span></p><p>!</p>
// with the entity stranded in its own paragraph). When an entity ends up alone
// in a paragraph, pull that paragraph up into the previous one so the copied
// HTML stays the War Era inline format:
//   <p>I am&nbsp;<span data-content-link …></span></p>
function mergeEntityParagraphs(html) {
  return html.replace(
    /<p class="tiptap-block" style="text-align: left;">([^<]*)<\/p><p class="tiptap-block" style="text-align: left;">(<span data-content-link[^>]*><\/span>)<\/p>/g,
    '<p class="tiptap-block" style="text-align: left;">$1$2</p>'
  );
}

// Chrome does NOT auto-wrap text typed into an empty contenteditable root with
// <p> blocks — inline runs (text, entity spans, links, …) can be direct
// children of the editor, e.g.:
//   "I am&nbsp;" <span data-content-link …>roostre</span> "!"
// Serializing those bare nodes one-by-one would emit a separate paragraph per
// node (and a stray inline span would lose its element). Group each consecutive
// top-level inline run into a single paragraph first, so the output matches the
// War Era block format:
//   <p class="tiptap-block">I am&nbsp;<span data-content-link …></span>!</p>
function wrapTopLevelRuns(container) {
  const nodes = [...container.childNodes];
  let i = 0;
  while (i < nodes.length) {
    const start = i;
    let has = false;
    while (i < nodes.length) {
      const n = nodes[i];
      if (n.nodeType === 3) { if (n.data.replace(/\s/g, "")) has = true; i++; continue; }
      if (n.nodeType !== 1) { i++; continue; }
      const tag = n.tagName;
      if (BLOCK_TAGS.has(tag) || tag === "P" || tag === "DIV" || tag === "LI" || tag === "SUMMARY" || tag === "BR") break;
      has = true;
      i++;
    }
    if (i > start && has) {
      const p = container.ownerDocument.createElement("p");
      p.className = "tiptap-block";
      const after = nodes[i] || null;
      for (let k = start; k < i; k++) p.appendChild(nodes[k]);
      if (after) container.insertBefore(p, after); else container.appendChild(p);
    }
    if (i === start) i++;
  }
}

export function serializeEditorHtml(root) {
  const clone = root.cloneNode(true);
  wrapTopLevelRuns(clone);
  // A raw nbsp in text content must serialize as the &nbsp; entity War Era emits.
  return mergeEntityParagraphs(emit(clone, true).replace(/\u00A0/g, "&nbsp;"));
}