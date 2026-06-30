import { S } from "../core/state.js";
import { STORE } from "../core/storage.js";

export function initIntro(onReady) {
  const overlay = document.getElementById("introOverlay");
  if (!overlay) { onReady(); return; }

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

  function closeOverlay() {
    overlay.classList.add("closing");
    setTimeout(() => overlay.remove(), 750);
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
