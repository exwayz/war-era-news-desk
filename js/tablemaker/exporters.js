import { uploadImageToImgur, LARGE_IMAGE_BYTES } from "../core/imageUpload.js";
import { addImageToLibrary } from "../jotter/jotter.js";

export const DEFAULT_TABLE_NAME = "war-era-table";

let _html2canvasPromise = null;
function loadHtml2Canvas() {
  if (_html2canvasPromise) return _html2canvasPromise;
  _html2canvasPromise = new Promise((resolve, reject) => {
    if (window.html2canvas) { resolve(window.html2canvas); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => { _html2canvasPromise = null; reject(new Error("Failed to load html2canvas from CDN")); };
    document.head.appendChild(s);
  });
  return _html2canvasPromise;
}

function renderIcons(root) {
  root.querySelectorAll("iconify-icon").forEach((ic) => {
    if (typeof ic.getSVGElement !== "function") return;
    try {
      const svg = ic.getSVGElement({ includeStyle: true });
      if (!svg) return;
      const size = (ic.style && ic.style.fontSize) ? ic.style.fontSize : "1em";
      const s = svg.cloneNode(true);
      s.setAttribute("width", size);
      s.setAttribute("height", size);
      ic.replaceWith(s);
    } catch {}
  });
}

function prepareImages(root) {
  root.querySelectorAll("img").forEach((im) => {
    try { im.crossOrigin = "anonymous"; } catch {}
    const src = im.getAttribute("src") || im.getAttribute("data-src");
    if (src && !/^https?:/i.test(src)) {
      try { im.setAttribute("src", new URL(src, location.href).href); im.removeAttribute("data-src"); } catch {}
    }
  });
}

function awaitImages(root) {
  const imgs = Array.from(root.querySelectorAll("img")).filter((im) => im.src && !(im.complete && im.naturalWidth));
  if (!imgs.length) return Promise.resolve();
  return Promise.all(imgs.map((im) => new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const t = setTimeout(finish, 3000);
    im.addEventListener("load", () => { clearTimeout(t); finish(); });
    im.addEventListener("error", () => { clearTimeout(t); finish(); });
    if (im.complete) finish();
  })));
}

// Render any DOM element (table or table wrapper) to a PNG Blob. Shared by the
// Converter and Drawer export paths so both produce identical output.
export async function renderElementPNG(el) {
  if (!el) throw new Error("Nothing to export");
  const html2canvas = await loadHtml2Canvas();
  const clone = el.cloneNode(true);

  renderIcons(clone);
  prepareImages(clone);

  clone.style.cssText = "position:fixed;left:-9999px;top:0;width:auto;max-width:none;margin:0;height:auto;transform:none;";
  clone.querySelectorAll("*").forEach((n) => {
    n.style.overflow = "visible";
    n.style.maxHeight = "none";
    n.style.animation = "none";
    n.style.transition = "none";
  });

  document.body.appendChild(clone);
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const width = Math.max(1, Math.round(clone.getBoundingClientRect().width || el.getBoundingClientRect().width || 0));
    clone.style.width = width + "px";
    await awaitImages(clone);
    const canvas = await html2canvas(clone, { backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false });
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG rendering failed"))), "image/png");
    });
  } finally {
    clone.remove();
  }
}

// Render an element, upload the PNG to Imgur and add it to the Image Library.
// Returns true when a new entry was added, false when it already existed.
export async function addElementToImageLibrary(el, displayName, baseName, onStatus) {
  onStatus?.("Rendering PNG...");
  const blob = await renderElementPNG(el);
  if (blob.size > LARGE_IMAGE_BYTES) onStatus?.("Table is larger than 1 MB — Imgur may compress it. Proceeding anyway.");
  onStatus?.("Uploading to Imgur...");
  const uploaded = await uploadImageToImgur(blob, `${baseName || "table"}-${Date.now()}.png`);
  return addImageToLibrary({
    ...uploaded,
    name: displayName || `${baseName || "table"}-${Date.now()}.png`,
    source: "table-maker",
  });
}

export { loadHtml2Canvas };