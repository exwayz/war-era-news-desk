function cv(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s == null ? "" : s);
  return d.innerHTML;
}

export function ts() {
  const d = new Date();
  return d.getFullYear() +
    String(d.getMonth()+1).padStart(2,"0") +
    String(d.getDate()).padStart(2,"0") + "_" +
    String(d.getHours()).padStart(2,"0") +
    String(d.getMinutes()).padStart(2,"0") +
    String(d.getSeconds()).padStart(2,"0");
}

function buildStyles() {
  const bg = cv("--bg");
  const ink = cv("--ink");
  const inkDim = cv("--ink-dim");
  const line = cv("--line");
  const surface = cv("--surface");
  return {
    container: `font-family:Literata,Georgia,serif;padding:6px 10px;width:780px;background:${bg};color:${ink};line-height:1.4`,
    h1: `color:${ink};font-size:18px;margin:0 0 2px;font-weight:700;font-family:'Playfair Display',Georgia,serif;border-bottom:1px solid ${line};padding-bottom:4px`,
    h2: `color:${ink};font-size:13px;margin:0 0 2px;font-weight:700;font-family:'Playfair Display',Georgia,serif`,
    meta: `font-size:10px;color:${inkDim};margin-bottom:4px;line-height:1.3`,
    th: `background:${surface};color:${ink};padding:2px 5px;text-align:left;font-weight:600;font-size:10px;border:1px solid ${line}`,
    td: `padding:2px 5px;border:1px solid ${line};font-size:10px;color:${inkDim}`,
    tbl: "border-collapse:collapse;width:100%",
  };
}

export const STYLE = new Proxy({}, {
  get(_, prop) { return buildStyles()[prop]; }
});

export function pageOpen(title, subtitle, metaLines) {
  const m = metaLines?.length ? `<div style="${STYLE.meta}">${metaLines.join("<br>")}</div>` : "";
  return `<div style="${STYLE.container}"><div style="${STYLE.h1}">${title}</div>${m}`;
}

export function pageClose() {
  return "</div>";
}

export function section(title, contentHtml) {
  const t = title ? `<div style="${STYLE.h2}">${title}</div>` : "";
  return `<div style="margin-bottom:4px">${t}${contentHtml}</div>`;
}

export function flexRow(childrenHtml) {
  return `<div style="display:flex;gap:6px">${childrenHtml}</div>`;
}

export function flexCol(html) {
  return `<div style="flex:1;min-width:0">${html}</div>`;
}

export function tableBlock(title, headers, rows, maxRows, subheaderHtml) {
  const limited = rows.slice(0, maxRows);
  const th = headers.map(h => `<th style="${STYLE.th}">${h}</th>`).join("");
  const tr = limited.map(row =>
    `<tr>${row.map(c => `<td style="${STYLE.td}">${c}</td>`).join("")}</tr>`
  ).join("");
  const sub = subheaderHtml ? `<tr>${subheaderHtml}</tr>` : "";
  const tbl = `<table style="${STYLE.tbl}"><thead>${sub}<tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  return title ? `<div style="margin-bottom:4px"><div style="${STYLE.h2}">${title}</div>${tbl}</div>` : tbl;
}

// ─────────────────────────────────────────────────────────────────────────────
// html2canvas loader (same CDN pattern as the Table Maker)
let _h2cPromise = null;
function loadH2C() {
  if (_h2cPromise) return _h2cPromise;
  _h2cPromise = new Promise((resolve, reject) => {
    if (window.html2canvas) { resolve(window.html2canvas); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => { _h2cPromise = null; reject(new Error("Failed to load html2canvas from CDN.")); };
    document.head.appendChild(s);
  });
  return _h2cPromise;
}

const PAGE_WIDTH = 800;
const PAGE_HEIGHT = 1200;
const SCALE = 2;

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG rendering failed.")), "image/png"));
}

// Wait until every <img> inside a container has loaded (with a short timeout per
// image) so CORS images don't come out blank on the first capture.
function awaitImages(root) {
  const imgs = Array.from(root.querySelectorAll("img")).filter(im => im.src && !(im.complete && im.naturalWidth));
  if (!imgs.length) return Promise.resolve();
  return Promise.all(imgs.map(im => new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const t = setTimeout(finish, 3000);
    im.addEventListener("load", () => { clearTimeout(t); finish(); });
    im.addEventListener("error", () => { clearTimeout(t); finish(); });
    if (im.complete) finish();
  })));
}

async function renderPages(wrapper, h2c) {
  const totalHeight = wrapper.scrollHeight;
  const pages = Math.max(1, Math.ceil(totalHeight / PAGE_HEIGHT));
  const blobs = [];
  for (let p = 0; p < pages; p++) {
    const y = p * PAGE_HEIGHT;
    const h = Math.min(PAGE_HEIGHT, totalHeight - y);
    wrapper.style.transform = `translateY(-${y}px)`;
    const canvas = await h2c(wrapper, {
      width: PAGE_WIDTH,
      height: h,
      scale: SCALE,
      useCORS: true,
      backgroundColor: cv("--bg"),
      y: 0, x: 0,
      logging: false,
    });
    blobs.push(await canvasToBlob(canvas));
  }
  return blobs;
}

// Render a styled report HTML string into paginated PNG blobs (no download).
export async function renderHTMLBlobs(html) {
  const h2c = await loadH2C();
  const wrapper = document.createElement("div");
  const bg = cv("--bg");
  wrapper.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_WIDTH}px;background:${bg}`;
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  try {
    // Any <img> (flags/avatars) needs absolute URLs for html2canvas's re-fetch.
    wrapper.querySelectorAll("img").forEach(im => {
      try { im.crossOrigin = "anonymous"; } catch {}
      const src = im.getAttribute("src") || im.getAttribute("data-src");
      if (src && !/^https?:/i.test(src)) {
        try { im.setAttribute("src", new URL(src, location.href).href); im.removeAttribute("data-src"); } catch {}
      }
    });
    await awaitImages(wrapper);
    return await renderPages(wrapper, h2c);
  } finally {
    wrapper.remove();
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function pageName(filename, total, i) {
  const base = filename.replace(/\.png$/i, "");
  return total > 1 ? `${base}_p${i + 1}.png` : base + ".png";
}

// Legacy one-shot download flow (multi-page, timestamped). Kept for callers that
// still want "just download" semantics.
export async function captureHTML(html, filename) {
  import("../audio/audio.js").then(m => m.playCapture()).catch(() => {});
  try {
    const blobs = await renderHTMLBlobs(html);
    blobs.forEach((b, i) => downloadBlob(b, pageName(filename, blobs.length, i)));
    import("../ui/toast.js").then(m => m.toast("Report captured."));
  } catch (err) {
    import("../ui/toast.js").then(m => m.toast(err.message || "Capture failed."));
  }
}

// Capture the visual of a live DOM element exactly as rendered on screen:
// cloned offscreen at its natural width, iconify icons inlined into real SVGs,
// cross-origin images re-fetched with CORS, animations frozen.
export async function elementToBlob(el) {
  if (!el) throw new Error("Nothing to capture.");
  const h2c = await loadH2C();
  const clone = el.cloneNode(true);

  const cloneId = "cp-freeze-" + Math.random().toString(36).slice(2, 9);
  clone.setAttribute("data-cp-id", cloneId);

  // Inline iconify icons (their shadow-DOM SVG cannot be read by html2canvas).
  const icons = el.querySelectorAll("iconify-icon");
  const cloneIcons = clone.querySelectorAll("iconify-icon");
  icons.forEach((ic, i) => {
    const target = cloneIcons[i];
    if (!target || typeof ic.getSVGElement !== "function") return;
    try {
      const svg = ic.getSVGElement({ includeStyle: true });
      if (svg) {
        const size = (ic.style && ic.style.fontSize) ? ic.style.fontSize : "1em";
        const s = svg.cloneNode(true);
        s.setAttribute("width", size);
        s.setAttribute("height", size);
        target.replaceWith(s);
      }
    } catch {}
  });

  clone.querySelectorAll("img").forEach(im => {
    try { im.crossOrigin = "anonymous"; } catch {}
    const src = im.getAttribute("src") || im.getAttribute("data-src");
    if (src && !/^https?:/i.test(src)) {
      try { im.setAttribute("src", new URL(src, location.href).href); im.removeAttribute("data-src"); } catch {}
    }
  });

  const width = Math.max(el.scrollWidth || el.getBoundingClientRect().width, 1);
  clone.setAttribute("style", `position:fixed;left:-9999px;top:0;width:${width}px;margin:0;max-width:none;height:auto;transform:none;`);

  // Unclamp inner scroll containers so the full content is captured, not the
  // viewport-clipped region the panel normally shows.
  clone.querySelectorAll('*').forEach(n => {
    n.style.overflow = "visible";
    n.style.maxHeight = "none";
  });

  const freeze = document.createElement("style");
  freeze.textContent = `[data-cp-id="${cloneId}"] *, [data-cp-id="${cloneId}"] { animation:none !important; transition:none !important; }`;
  document.head.appendChild(freeze);
  document.body.appendChild(clone);
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await awaitImages(clone);
    const canvas = await h2c(clone, {
      backgroundColor: cv("--bg"),
      scale: SCALE,
      useCORS: true,
      logging: false,
    });
    return await canvasToBlob(canvas);
  } finally {
    clone.remove();
    freeze.remove();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture modal flow:
//   1. openCapturePicker() lists a tab's capture-able sections (Table/Page each).
//   2. Choosing either opens openCaptureStore() — "where to store the image".
//      Single-section flows (battle/politics) go straight to the store modal,
//      which then also carries the Table/Page choice.
// Store options: save to device, add to Image Library (Imgur → library), or both.

function makeOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "overlay cap-overlay";
  overlay.addEventListener("click", e => { if (e.target === overlay) closeOverlay(overlay); });
  document.body.appendChild(overlay);
  const onKey = e => { if (e.key === "Escape") closeOverlay(overlay); };
  document.addEventListener("keydown", onKey);
  overlay._capOnKey = onKey;
  return overlay;
}

function closeOverlay(overlay) {
  if (overlay._capOnKey) document.removeEventListener("keydown", overlay._capOnKey);
  overlay.remove();
}

// Optional per-section readiness guard. Sections that need to be opened and
// loaded in the app first (signals, rankings boards, country detail, …) can
// provide a `guard` that returns a hint string to block the capture (shown as
// a reminder toast) or null/undefined to let it through. Only Page captures
// consult the guard — the Table builders already render empty-state reports.
async function sectionHint(s) {
  if (!s || typeof s.guard !== "function") return null;
  try { return (await s.guard()) || null; } catch { return null; }
}

async function uploadToLibrary(blob, name) {
  const { uploadImageToImgur } = await import("../core/imageUpload.js");
  const { addImageToLibrary } = await import("../jotter/jotter.js");
  const safeName = name.replace(/[^\w\s-]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 48) || "capture-report";
  const uploaded = await uploadImageToImgur(blob, safeName.replace(/[\s]+/g, "-") + "-" + Math.round(Date.now() / 1000) + ".png");
  const entry = addImageToLibrary({ ...uploaded, name: safeName, source: "capture-report" });
  return !!entry;
}

function storeSummary(target, saved, added) {
  const parts = [];
  if ((target === "device" || target === "both") && saved) parts.push(`${saved} file${saved > 1 ? "s" : ""} saved to device`);
  if ((target === "library" || target === "both") && added) parts.push(`${added} image${added > 1 ? "s" : ""} added to Image Library`);
  return parts.join(" · ") || "Nothing captured.";
}

const ICONS = {
  close: "mdi:close",
  table: "mdi:table",
  page: "ic:sharp-web",
  device: "mdi:download",
  library: "mdi:bookshelf",
  both: "mdi:download-multiple",
};

export function openCaptureStore(config) {
  const {
    title, subtitle = "", sectionLabel = "", filenameBase,
    modes = "both", table, page, cleanup = null, guard = null,
  } = config;
  const mode = modes === "table" ? "table" : (modes === "page" ? "page" : "table");
  const overlay = makeOverlay();
  let statusEl = null;
  let completed = false;

  overlay.innerHTML = `
    <div class="modal-card cap-store-card">
      <button class="modal-corner-btn" data-close title="Close"><iconify-icon icon="${ICONS.close}" class="lu"></iconify-icon></button>
      <h2>${esc(title)}</h2>
      <p>${esc(sectionLabel ? sectionLabel + (subtitle ? " — " + subtitle : "") : subtitle)}</p>
      ${modes === "both" ? `
      <div class="cap-mode-toggle">
        <button class="pill-btn active" data-mode="table"><iconify-icon icon="${ICONS.table}" class="lu"></iconify-icon> Table</button>
        <button class="pill-btn" data-mode="page"><iconify-icon icon="${ICONS.page}" class="lu"></iconify-icon> Page</button>
      </div>` : (modes === "page" ? `<p class="cap-mode-note">Capture type: Page (as seen on screen)</p>` : `<p class="cap-mode-note">Capture type: Table (structured report)</p>`)}
      <div class="cap-store-grid">
        <button class="btn-primary" data-target="device"><iconify-icon icon="${ICONS.device}" class="lu"></iconify-icon> Save to device</button>
        <button class="btn-secondary" data-target="library"><iconify-icon icon="${ICONS.library}" class="lu"></iconify-icon> Add to Image Library</button>
        <button class="btn-secondary" data-target="both"><iconify-icon icon="${ICONS.both}" class="lu"></iconify-icon> Both</button>
      </div>
      <p class="cap-status" hidden></p>
    </div>`;

  let curMode = mode;
  overlay.querySelectorAll("[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      curMode = btn.dataset.mode;
      overlay.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  const closeBtn = overlay.querySelector("[data-close]");
  closeBtn?.addEventListener("click", () => closeOverlay(overlay));

  function setStatus(msg, err) {
    if (!statusEl) statusEl = overlay.querySelector(".cap-status");
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", !!err);
  }

  overlay.querySelectorAll("[data-target]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (completed) return;
      completed = true;
      const target = btn.dataset.target;
      if (curMode === "page" && guard) {
        const hint = await sectionHint({ guard });
        if (hint) {
          completed = false;
          import("../ui/toast.js").then(m => m.toast(hint));
          return;
        }
      }
      overlay.querySelectorAll("button").forEach(b => { b.disabled = true; });
      setStatus("Preparing capture…");
      import("../audio/audio.js").then(m => m.playCapture()).catch(() => {});
      let blobs;
      try {
        if (curMode === "table") {
          blobs = await renderHTMLBlobs(await table());
        } else {
          const el = await page();
          try {
            blobs = [await elementToBlob(el)];
          } finally {
            if (cleanup) await cleanup();
          }
        }
      } catch (err) {
        completed = false;
        overlay.querySelectorAll("button").forEach(b => { b.disabled = false; });
        setStatus(err.message || "Capture failed.", true);
        return;
      }
      const fileBase = `${filenameBase}_${ts()}`;
      const nameBase = sectionLabel || title;
      let saved = 0, added = 0;
      let lastErr = null;
      try {
        for (let i = 0; i < blobs.length; i++) {
          const fname = blobs.length > 1 ? `${fileBase}_p${i + 1}.png` : `${fileBase}.png`;
          if (target === "device" || target === "both") { downloadBlob(blobs[i], fname); saved++; }
          if (target === "library" || target === "both") {
            try {
              const ok = await uploadToLibrary(blobs[i], blobs.length > 1 ? `${nameBase} (${i + 1}/${blobs.length})` : nameBase);
              if (ok) added++;
            } catch (err) { lastErr = err; }
          }
        }
      } finally {
        closeOverlay(overlay);
      }
      if (lastErr) import("../ui/toast.js").then(m => m.toast(lastErr.message || "Upload to Image Library failed."));
      const msg = storeSummary(target, saved, added);
      import("../ui/toast.js").then(m => m.toast(msg));
    });
  });

  return { close: () => closeOverlay(overlay) };
}

export function openCapturePicker({ title, sections }) {
  const overlay = makeOverlay();
  const rows = sections.map((s, idx) => `
    <div class="cap-picker-row">
      <div class="cap-picker-label">
        <span class="cap-picker-name">${esc(s.label)}</span>
        ${s.meta ? `<span class="cap-picker-meta">${esc(s.meta)}</span>` : ""}
      </div>
      <div class="cap-picker-actions">
        <button class="btn-secondary" data-section="${idx}" data-mode="table"><iconify-icon icon="${ICONS.table}" class="lu"></iconify-icon> Table</button>
        <button class="btn-secondary" data-section="${idx}" data-mode="page"><iconify-icon icon="${ICONS.page}" class="lu"></iconify-icon> Page</button>
      </div>
    </div>`).join("");

  overlay.innerHTML = `
    <div class="modal-card cap-picker-card">
      <button class="modal-corner-btn" data-close title="Close"><iconify-icon icon="${ICONS.close}" class="lu"></iconify-icon></button>
      <h2>${esc(title)}</h2>
      <p>Pick a section, then a capture type.</p>
      <div class="cap-picker-list">${rows}</div>
    </div>`;

  overlay.querySelector("[data-close]")?.addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelectorAll("[data-section]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const s = sections[Number(btn.dataset.section)];
      const mode = btn.dataset.mode;
      if (mode === "page") {
        const hint = await sectionHint(s);
        if (hint) { import("../ui/toast.js").then(m => m.toast(hint)); return; }
      }
      closeOverlay(overlay);
      openCaptureStore({
        title,
        sectionLabel: s.label,
        subtitle: s.meta || "",
        filenameBase: s.filenameBase,
        modes: mode === "page" ? "page" : "table",
        table: s.table,
        page: s.page,
        cleanup: s.cleanup,
        guard: s.guard,
      });
    });
  });

  return { close: () => closeOverlay(overlay) };
}