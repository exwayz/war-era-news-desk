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

// Render any DOM element (table or table wrapper) to a PNG Blob. Shared by the
// Converter and Drawer export paths so both produce identical output.
export async function renderElementPNG(el) {
  if (!el) throw new Error("Nothing to export");
  const html2canvas = await loadHtml2Canvas();
  const tableEl = el.tagName === "TABLE" ? el : (el.querySelector("table") || el);
  const tableW = Math.max(1, Math.round((tableEl || el).getBoundingClientRect().width));
  const clone = el.cloneNode(true);
  clone.style.position = "fixed";
  clone.style.left = "-9999px";
  clone.style.top = "0";
  clone.style.width = tableW + "px";
  clone.style.margin = "0";
  const holder = document.createElement("div");
  holder.style.width = tableW + "px";
  holder.style.background = "#ffffff";
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try {
    const canvas = await html2canvas(holder, { backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false });
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG rendering failed"))), "image/png");
    });
  } finally {
    document.body.removeChild(holder);
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