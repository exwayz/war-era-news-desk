// Article Jotter — serializes the contenteditable editor DOM into the TipTap
// HTML dialect used by the War Era article editor (see docs/warera-editor-reference.md).

const BLOCK_TAGS = new Set([
  "H1","H2","H3","H4","H5","H6","HR","IMG","BLOCKQUOTE","PRE","DETAILS","TABLE","FIGURE","IFRAME"
]);

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function removeTrailingBr(el) {
  while (
    el.lastChild &&
    el.lastChild.nodeType === 1 &&
    (el.lastChild.tagName === "BR" || el.lastChild.tagName === "P")
  ) {
    const c = el.lastChild;
    if (c.tagName === "BR") { c.remove(); continue; }
    if (c.tagName === "P" && !c.innerHTML) { c.remove(); continue; }
    break;
  }
}

function cleanInline(root) {
  // Font elements become styled spans (TipTap has no <font> node).
  for (const f of [...root.querySelectorAll("font")]) {
    const span = document.createElement("span");
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
    el.removeAttribute("contenteditable");
    el.removeAttribute("spellcheck");
    el.removeAttribute("data-jmention");
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
    if (el.classList?.contains("j-collapse-caret")) { el.remove(); continue; }
    if (el.classList?.contains("j-mention-pending")) {
      el.replaceWith(...el.childNodes);
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

function inlineHtml(el) {
  const d = document.createElement("div");
  d.appendChild(el.cloneNode(true));
  cleanInline(d);
  return d.innerHTML;
}

function passthroughHtml(el) {
  const d = document.createElement("div");
  d.appendChild(el.cloneNode(true));
  cleanInline(d);
  return d.firstElementChild.outerHTML;
}

function hasBlockChildren(el) {
  for (const c of el.childNodes) {
    if (c.nodeType === 1 && (BLOCK_TAGS.has(c.tagName) || c.tagName === "P" || c.tagName === "DIV")) {
      return true;
    }
  }
  return false;
}

function makeBlock(el) {
  const style = el.getAttribute && el.getAttribute("style");
  const styleAttr = style ? ` style="${escAttr(style)}"` : "";
  const d = document.createElement("div");
  d.appendChild(el.cloneNode(true));
  cleanInline(d);
  let inner = d.innerHTML;
  if (inner === "<br>") inner = "";
  return `<p class="tiptap-block"${styleAttr}>${inner}</p>`;
}

function emitList(list) {
  const isOl = list.tagName === "OL";
  const inner = [];
  for (const li of list.children) {
    if (li.tagName !== "LI") continue;
    let pHtml = "";
    const nested = [];
    for (const child of li.childNodes) {
      const tag = child.tagName;
      if (tag === "UL" || tag === "OL") {
        nested.push(emitList(child));
      } else if (tag === "P" || tag === "DIV") {
        if (tag === "DIV" && (child.hasAttribute?.("data-youtube-video") || child.classList?.contains("tiptap-tiktok"))) {
          nested.push(passthroughHtml(child));
        } else {
          pHtml += makeBlock(child);
        }
      } else if (child.nodeType === 3) {
        const t = child.textContent;
        if (t && t.replace(/\s/g, "")) {
          pHtml += `<p class="tiptap-block">${esc(t)}</p>`;
        }
      } else if (child.nodeType === 1 && BLOCK_TAGS.has(child.tagName)) {
        pHtml += makeBlock(child);
      } else if (child.nodeType === 1) {
        pHtml += makeBlock(child);
      }
    }
    if (!pHtml) pHtml = '<p class="tiptap-block"></p>';
    inner.push(`<li>${pHtml}${nested.join("")}</li>`);
  }
  const tag = isOl ? "ol" : "ul";
  return `<${tag} class="tight" data-tight="true">${inner.join("")}</${tag}>`;
}

function emitBlockquote(el) {
  const inner = [];
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      const t = child.textContent;
      if (t && t.replace(/\s/g, "")) inner.push(`<p class="tiptap-block">${esc(t)}</p>`);
    } else if (child.nodeType === 1 && (child.tagName === "P" || child.tagName === "DIV")) {
      inner.push(makeBlock(child));
    } else if (child.nodeType === 1) {
      inner.push(makeBlock(child));
    }
  }
  return `<blockquote class="tiptap-blockquote">${inner.join("")}</blockquote>`;
}

function emitPre(el) {
  const code = el.querySelector(":scope > code");
  let content;
  if (code) {
    const d = document.createElement("div");
    d.appendChild(code.cloneNode(true));
    cleanInline(d);
    content = d.innerHTML;
  } else {
    content = esc((el.innerText || "").replace(/\n+$/, ""));
  }
  return `<pre class="tiptap-code-block"><code>${content}</code></pre>`;
}

function emitDetails(el) {
  const summary = [...el.children].find((c) => c.tagName === "SUMMARY");
  const body = [...el.children].find((c) =>
    c.className && /collapsible-body/.test(c.className) && c.tagName !== "SUMMARY"
  );
  const sHtml = summary ? inlineHtml(summary) : "Collapsible section";
  let bHtml = "";
  if (body) {
    const d = document.createElement("div");
    d.appendChild(body.cloneNode(true));
    bHtml = emit(d);
  }
  return [
    `<details class="tiptap-collapsible" open="open">`,
    `  <summary class="tiptap-collapsible-summary">${sHtml}</summary>`,
    `  <div data-collapsible-body="" class="tiptap-collapsible-body">`,
    `    <div class="tiptap-collapsible-body-inner">`,
    `      <div class="tiptap-collapsible-body-content">`,
    bHtml ? `\n${bHtml}\n` : "",
    `      </div>`,
    `    </div>`,
    `  </div>`,
    `</details>`,
  ].join("\n");
}

function emitBlock(el) {
  const tag = el.tagName;
  if (tag === "HR") return "<hr>";
  if (tag === "IMG") {
    const src = escAttr(el.getAttribute("src") || "");
    const style = el.getAttribute("style");
    const alt = el.getAttribute("alt");
    return `<img class="tiptap-image" src="${src}"${style ? ` style="${escAttr(style)}"` : ""}${alt ? ` alt="${escAttr(alt)}"` : ""}>`;
  }
  if (tag.startsWith("H") && /^H[1-6]$/.test(tag)) {
    const style = el.getAttribute("style");
    const styleAttr = style ? ` style="${escAttr(style)}"` : "";
    return `<${tag.toLowerCase()}${styleAttr}>${inlineHtml(el)}</${tag.toLowerCase()}>`;
  }
  if (tag === "BLOCKQUOTE") return emitBlockquote(el);
  if (tag === "PRE") return emitPre(el);
  if (tag === "DETAILS") return emitDetails(el);
  return passthroughHtml(el);
}

function emit(container) {
  const out = [];
  for (const node of container.childNodes) {
    if (node.nodeType === 3) {
      const t = node.textContent || "";
      if (t.replace(/\s/g, "")) out.push(`<p class="tiptap-block">${esc(t)}</p>`);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName;
    if (tag === "P" || tag === "DIV" || tag === "LI" || tag === "SUMMARY") {
      if (tag === "DIV" && (node.hasAttribute?.("data-youtube-video") || node.classList?.contains("tiptap-tiktok"))) {
        out.push(passthroughHtml(node));
      } else {
        out.push(hasBlockChildren(node) ? emit(node) : makeBlock(node));
      }
    } else if (tag === "UL" || tag === "OL") {
      out.push(emitList(node));
    } else if (BLOCK_TAGS.has(tag)) {
      out.push(emitBlock(node));
    } else {
      out.push(makeBlock(node));
    }
  }
  return out.join("\n");
}

export function serializeEditorHtml(root) {
  const clone = root.cloneNode(true);
  return emit(clone).trim();
}