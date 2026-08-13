const MIN = 5;
const MAX = 500;

let modal, stage, imgEl, slider, pct, outBtn, inBtn, resetBtn, nameEl;
let zoom = 100;
let dragging = false;
let startX = 0, startY = 0, startScrollL = 0, startScrollT = 0;

function clamp(v) {
  return Math.min(MAX, Math.max(MIN, v));
}

function apply() {
  imgEl.style.transform = `scale(${zoom / 100})`;
  slider.value = zoom;
  if (pct) pct.textContent = `${zoom}%`;
  if (outBtn) outBtn.disabled = zoom <= MIN;
  if (inBtn) inBtn.disabled = zoom >= MAX;
}

// Scale around an arbitrary viewport point (cx, cy within the stage), keeping
// the content under that point stationary while the scrollable area expands.
function zoomAround(cx, cy, target) {
  const z1 = clamp(target);
  if (z1 === zoom) return;
  const px = (stage.scrollLeft + cx) / (zoom / 100);
  const py = (stage.scrollTop + cy) / (zoom / 100);
  zoom = z1;
  apply();
  stage.scrollLeft = px * (zoom / 100) - cx;
  stage.scrollTop = py * (zoom / 100) - cy;
}

function stagePoint(clientX, clientY) {
  const r = stage.getBoundingClientRect();
  return [clientX - r.left, clientY - r.top];
}

function zoomCenter(target) {
  zoomAround(stage.clientWidth / 2, stage.clientHeight / 2, target);
}

export function openImageViewer(src, alt) {
  if (!modal) return;
  imgEl.src = src || "";
  imgEl.alt = alt || "";
  nameEl.textContent = alt || (src ? decodeURIComponent(String(src).split("/").pop() || "") : "") || "Image";
  zoom = 100;
  apply();
  stage.scrollLeft = 0;
  stage.scrollTop = 0;
  modal.classList.remove("hidden");
}

export function initImageViewer() {
  modal = document.getElementById("imageViewerModal");
  stage = document.getElementById("imageViewerStage");
  imgEl = document.getElementById("imageViewerImg");
  slider = document.getElementById("imgZoomSlider");
  pct = document.getElementById("imgZoomPct");
  outBtn = document.getElementById("imgZoomOut");
  inBtn = document.getElementById("imgZoomIn");
  resetBtn = document.getElementById("imgZoomReset");
  nameEl = document.getElementById("imageViewerName");
  if (!modal || !stage || !imgEl || !slider) return;

  slider.addEventListener("input", () => zoomCenter(Number(slider.value)));
  outBtn?.addEventListener("click", () => zoomCenter(zoom / 1.2));
  inBtn?.addEventListener("click", () => zoomCenter(zoom * 1.2));
  resetBtn?.addEventListener("click", () => zoomCenter(100));

  document.getElementById("imgViewerClose")?.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [cx, cy] = stagePoint(e.clientX, e.clientY);
    zoomAround(cx, cy, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });

  stage.addEventListener("dblclick", (e) => {
    const [cx, cy] = stagePoint(e.clientX, e.clientY);
    zoomAround(cx, cy, zoom <= 100 ? 250 : 100);
  });

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    stage.classList.add("dragging");
    stage.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    startScrollL = stage.scrollLeft;
    startScrollT = stage.scrollTop;
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    stage.scrollLeft = startScrollL - (e.clientX - startX);
    stage.scrollTop = startScrollT - (e.clientY - startY);
  });
  stage.addEventListener("pointerup", (e) => {
    dragging = false;
    stage.classList.remove("dragging");
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  });

  // Images inside article bodies become clickable to open this viewer.
  document.getElementById("readerContent")?.addEventListener("click", (e) => {
    const img = e.target.closest("img");
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    openImageViewer(img.currentSrc || img.src, img.alt);
  });
}
