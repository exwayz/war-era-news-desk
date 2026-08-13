import { E } from "../core/dom.js";

const STORAGE_KEY = "nd:readerZoom";
const MIN = 60;
const MAX = 180;
const STEP = 5;
const DEFAULT = 100;

function clamp(v) {
  return Math.min(MAX, Math.max(MIN, v));
}

// Text-size zoom for the article reader, shown as a floating vertical widget
// in the bottom-right corner (map-style): + / percent (click to reset) / −.
// Also adjustable with Ctrl + mouse wheel over the article body; persisted.
export function initReaderZoom() {
  const content = E.readerContent;
  const pctBtn = document.getElementById("readerZoomPct");
  const inBtn = document.getElementById("readerZoomIn");
  const outBtn = document.getElementById("readerZoomOut");
  if (!content) return;

  let zoom = clamp(Number(localStorage.getItem(STORAGE_KEY) || DEFAULT));

  function apply() {
    content.style.setProperty("--reader-zoom", zoom / 100);
    if (pctBtn) pctBtn.textContent = `${zoom}%`;
    localStorage.setItem(STORAGE_KEY, String(zoom));
  }

  inBtn?.addEventListener("click", () => { zoom = clamp(zoom + STEP); apply(); });
  outBtn?.addEventListener("click", () => { zoom = clamp(zoom - STEP); apply(); });
  pctBtn?.addEventListener("click", () => { zoom = DEFAULT; apply(); });

  content.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoom = clamp(zoom + (e.deltaY < 0 ? STEP : -STEP));
    apply();
  }, { passive: false });

  apply();
}
