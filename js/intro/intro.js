import { S } from "../core/state.js";
import { STORE } from "../core/storage.js";


export function initIntro(onReady) {
  const overlay = document.getElementById("introOverlay");
  if (!overlay) { onReady(); return; }

  const mapCanvas   = document.getElementById("introMapCanvas");
  const titleEl     = document.getElementById("introTitle");
  const eyebrowEl   = document.getElementById("introEyebrow");
  const taglineEl   = document.getElementById("introTagline");
  const apiBox      = document.getElementById("introApiBox");
  const apiInput    = document.getElementById("introApiKeyInput");
  const saveBtn     = document.getElementById("introSaveBtn");
  const infoTip     = document.getElementById("introInfoTip");
  const introStatus = document.getElementById("introStatus");
  const loadingWrap = document.getElementById("introLoading");
  const loadingFill = document.getElementById("introLoadingFill");
  const loadingText = document.getElementById("introLoadingText");

  const ctx = mapCanvas.getContext("2d");
  let mw, mh;
  function resizeMap(){ mw = mapCanvas.width = innerWidth; mh = mapCanvas.height = innerHeight; }
  resizeMap();
  addEventListener("resize", resizeMap);

  const hotspots = Array.from({ length: 9 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.62 + 0.16,
    delay: Math.random() * 3,
  }));

  let mapRunning = true;
  let mapRaf;
  function drawMap(ts) {
    if (!mapRunning) return;
    mapRaf = requestAnimationFrame(drawMap);
    ctx.clearRect(0, 0, mw, mh);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(208,90,64,0.10)";
    for (let i = 0; i <= 20; i++) {
      const x = (mw / 20) * i;
      ctx.beginPath();
      for (let y = 0; y <= mh; y += 12) {
        const xo = x + Math.sin((y / mh) * Math.PI) * 16;
        y === 0 ? ctx.moveTo(xo, y) : ctx.lineTo(xo, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i <= 11; i++) {
      const y = (mh / 11) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mw, y); ctx.stroke();
    }
    const t = (ts || 0) * 0.001;
    for (const h of hotspots) {
      const px = h.x * mw, py = h.y * mh;
      const phase = (t + h.delay) % 3;
      const r = phase * 24;
      const alpha = Math.max(0, 1 - phase / 3);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(208,90,64,${alpha * 0.55})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(208,90,64,0.92)";
      ctx.fill();
    }
  }
  mapRaf = requestAnimationFrame(drawMap);

  function closeOverlay() {
    overlay.classList.add("closing");
    setTimeout(() => {
      mapRunning = false;
      if (mapRaf) cancelAnimationFrame(mapRaf);
      overlay.remove();
    }, 750);
  }

  function pollUntilReady(extraDelay) {
    let dataReady = false;
    let pct = 5;
    loadingFill.style.width = pct + "%";
    const fillTimer = setInterval(() => {
      pct = Math.min(92, pct + (Math.random() * 9 + 3));
      loadingFill.style.width = pct + "%";
    }, 220);
    const poll = setInterval(() => {
      if (S.events.length || S.market.econ || S.jobs.length) dataReady = true;
    }, 200);
    const hardStop = setTimeout(() => { dataReady = true; }, 7000);
    const minTimer = setTimeout(function tryFinish() {
      if (dataReady) {
        clearInterval(poll);
        clearInterval(fillTimer);
        clearTimeout(hardStop);
        loadingFill.style.width = "100%";
        loadingText.textContent = "Wire connected.";
        setTimeout(closeOverlay, 320);
      } else {
        setTimeout(tryFinish, 150);
      }
    }, extraDelay);
  }

  const hasKey = !!(localStorage.getItem(STORE.apiKey) || "").trim();

  overlay.classList.add("show");

  // Auto-start reveal — no click gate needed (intro audio removed)
  setTimeout(() => eyebrowEl.classList.add("in"), 200);
  setTimeout(() => { titleEl.classList.add("in"); }, 500);
  setTimeout(() => taglineEl.classList.add("in"), 1300);

  if (hasKey) {
    onReady();
    setTimeout(() => {
      loadingWrap.hidden = false;
      requestAnimationFrame(() => loadingWrap.classList.add("in"));
      pollUntilReady(2400);
    }, 1700);
  } else {
    setTimeout(() => {
      titleEl.classList.add("shrink");
      eyebrowEl.classList.add("fade-out");
      taglineEl.classList.add("fade-out");
    }, 2400);
    setTimeout(() => {
      apiBox.hidden = false;
      requestAnimationFrame(() => apiBox.classList.add("in"));
    }, 3000);
  }

  // Set up API interactions early (elements exist but are hidden until needed)
  infoTip?.addEventListener("mouseenter", () => infoTip.classList.add("hover"));
  infoTip?.addEventListener("mouseleave", () => infoTip.classList.remove("hover"));

  function glitchPulse() {
    titleEl.classList.add("glitching");
    clearTimeout(apiInput._gt);
    apiInput._gt = setTimeout(() => titleEl.classList.remove("glitching"), 650);
  }
  apiInput?.addEventListener("focus", glitchPulse);
  apiInput?.addEventListener("input", glitchPulse);

  saveBtn?.addEventListener("click", () => {
    const key = (apiInput.value || "").trim();
    if (!key) {
      introStatus.hidden = false;
      introStatus.textContent = "Please paste a valid API key.";
      apiBox.classList.add("shake");
      setTimeout(() => apiBox.classList.remove("shake"), 420);
      return;
    }
    titleEl.classList.remove("glitching");
    apiBox.classList.remove("in");
    apiBox.classList.add("tv-off");
    setTimeout(() => {
      apiBox.hidden = true;
      localStorage.setItem(STORE.apiKey, key);
      onReady();
      loadingWrap.hidden = false;

      requestAnimationFrame(() => loadingWrap.classList.add("in"));
      pollUntilReady(900);
    }, 520);
  });
}
