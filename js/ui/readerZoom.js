import { E } from "../core/dom.js";

const STORAGE_KEY = "nd:readerZoom";
const MIN = 60;
const MAX = 180;
const STEP = 5;
const DEFAULT = 100;

function clamp(v) {
  return Math.min(MAX, Math.max(MIN, v));
}

// Text-size zoom for the article reader. Adjustable via the slider, the +/−
// buttons, or Ctrl + mouse wheel over the article body; persisted locally.
export function initReaderZoom() {
  const content = E.readerContent;
  const slider = document.getElementById("readerZoomSlider");
  if (!content || !slider) return;
  const pct = document.getElementById("readerZoomPct");
  const outBtn = document.getElementById("readerZoomOut");
  const inBtn = document.getElementById("readerZoomIn");
  const resetBtn = document.getElementById("readerZoomReset");

  let zoom = clamp(Number(localStorage.getItem(STORAGE_KEY) || DEFAULT));

  function apply() {
    content.style.setProperty("--reader-zoom", zoom / 100);
    slider.value = zoom;
    if (pct) pct.textContent = `${zoom}%`;
    localStorage.setItem(STORAGE_KEY, String(zoom));
  }

  slider.addEventListener("input", () => { zoom = clamp(Number(slider.value)); apply(); });
  outBtn?.addEventListener("click", () => { zoom = clamp(zoom - STEP); apply(); });
  inBtn?.addEventListener("click", () => { zoom = clamp(zoom + STEP); apply(); });
  resetBtn?.addEventListener("click", () => { zoom = DEFAULT; apply(); });

  content.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoom = clamp(zoom + (e.deltaY < 0 ? STEP : -STEP));
    apply();
  }, { passive: false });

  apply();
}
