import { S } from "./core/state.js";
import { E } from "./core/dom.js";
import { STORE } from "./core/storage.js";
import { apiKey } from "./core/api.js";
import { debounce } from "./core/utils.js";
import { initNixie } from "./visuals/clock.js";
import { initOsc } from "./visuals/oscilloscope.js";
import { initEcg } from "./visuals/ecg.js";
import { populateEventTypes } from "./timeline/filters.js";
import { loadEvents, startAutoRefresh, scheduleEventsRefresh, renderTimeline, handleEventAction } from "./timeline/timeline.js";
import { loadArticles, renderArticles } from "./timeline/articles.js";
import { switchTab, isTimelineOpen } from "./ui/tabs.js";
import { toggleTheme, applyTheme } from "./ui/theme.js";
import { toast, setStatus } from "./ui/toast.js";
import { loadBattles, stopBattlePolling, updateBattleTabPills, clearBattleDetail } from "./battles/battles.js";
import { injectBattleSearchBar } from "./battles/companies.js";
import { loadMarketFull, loadMarketStats, copyMarketReport, renderMarketOrders } from "./market/market.js";
import { loadJobs, renderJobs, copyJobsReport } from "./jobs/jobs.js";
import { initIntro } from "./intro/intro.js";
import { initRankings, preloadRankings, copyRankingsReport } from "./rankings/rankings.js";
import { playClick, playRead, playCopy, setSfxVolume, getSfxVolume } from "./audio/audio.js";

function injectJobsCountryFilter() {
  const bar = document.querySelector(".jobs-search-bar");
  if (!bar) return;
  const wrap = document.createElement("div");
  wrap.className = "input-wrap";
  wrap.style.flex = "1";
  wrap.innerHTML = `
<input id="jobCountryFilter" type="text" list="jobCountryOptions" placeholder="Filter by country…">
<button class="clear-btn" data-clears="jobCountryFilter" type="button">✕</button>
<datalist id="jobCountryOptions"></datalist>
`;
  bar.appendChild(wrap);
  E.jobCountryFilter = document.getElementById("jobCountryFilter");
  E.jobCountryOptions = document.getElementById("jobCountryOptions");
  wrap.querySelector("[data-clears]").addEventListener("click", () => {
    E.jobCountryFilter.value = "";
    S.jobCountryFilter = "";
    renderJobs();
    E.jobCountryFilter.focus();
  });
  E.jobCountryFilter.addEventListener("input", () => {
    S.jobCountryFilter = E.jobCountryFilter.value.trim().toLowerCase();
    renderJobs();
  });
}

const wageSlider = document.getElementById("jobWageFilter");
const wageValue = document.getElementById("jobWageValue");

function updateWageSlider() {
  const min = Number(wageSlider.min);
  const max = Number(wageSlider.max);
  const val = Number(wageSlider.value);
  const pct = ((val-min)/(max-min))*100;
  wageSlider.style.background = `linear-gradient(to right,var(--accent) 0%,var(--accent) ${pct}%,var(--surface-hi) ${pct}%,var(--surface-hi) 100%)`;
  wageValue.style.left = `calc(${pct}% - 8px)`;
  wageValue.textContent = val.toFixed(3);
}

function bootData() {
  E.globalEventsTitle.classList.add("live");
  loadEvents(true);
  loadArticles(true);
  startAutoRefresh();
  loadMarketStats();
  loadJobs();
}

function bindAll() {
  document.querySelectorAll(".clear-btn[data-clears]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const el=document.getElementById(btn.dataset.clears);
      if(el){ el.value=""; el.dispatchEvent(new Event("input",{bubbles:true})); el.focus(); }
    });
  });

  E.clearApiKeyBtn?.addEventListener("click",()=>{ E.apiKeyInput.value=""; E.apiKeyInput.focus(); });

  E.tabBtns.forEach(btn=>{ btn.addEventListener("click",()=>switchTab(btn.dataset.tab)); });

  E.themeButton.addEventListener("click", toggleTheme);
  E.settingsButton?.addEventListener("click",()=>{
    E.sfxVolumeSlider.value = Math.round(getSfxVolume() * 100);
    E.sfxVolumeValue.textContent = Math.round(getSfxVolume() * 100) + "%";
    E.settingsModal.classList.remove("hidden");
  });
  E.apiButton.addEventListener("click",()=>{
    E.apiKeyInput.value=localStorage.getItem(STORE.apiKey)||"";
    E.apiKeyModal.classList.remove("hidden");
    E.apiKeyInput.focus();
  });
  E.saveApiKeyButton.addEventListener("click",()=>{
    const key=E.apiKeyInput.value.trim();
    localStorage.setItem(STORE.apiKey,key);
    E.apiButton.classList.remove("needs-attention");
    E.globalEventsTitle.classList.add("live");
    E.apiKeyModal.classList.add("hidden");
    if(key){ S.lookupsKey=""; loadEvents(true); loadArticles(true); startAutoRefresh(); loadMarketStats(); preloadRankings(); }
  });
  E.apiKeyModal.addEventListener("click",e=>{ if(e.target===E.apiKeyModal) E.apiKeyModal.classList.add("hidden"); });

  E.closeSettingsBtn?.addEventListener("click",()=>E.settingsModal.classList.add("hidden"));
  E.settingsModal?.addEventListener("click",e=>{ if(e.target===E.settingsModal) E.settingsModal.classList.add("hidden"); });
  E.sfxVolumeSlider?.addEventListener("input",()=>{
    const v = Number(E.sfxVolumeSlider.value);
    E.sfxVolumeValue.textContent = v + "%";
    setSfxVolume(v / 100);
  });

  E.applyFiltersBtn.addEventListener("click",()=>loadEvents(true));
  E.clearFiltersBtn.addEventListener("click",()=>{
    E.countryInput.value=""; E.eventTypeSelect.value="";
    E.startTimeInput.value=""; E.endTimeInput.value="";
    loadEvents(true);
  });
  E.loadMoreBtn.addEventListener("click",()=>loadEvents(false));
  E.countryInput.addEventListener("input", debounce(()=>scheduleEventsRefresh(),350));
  E.eventTypeSelect.addEventListener("change",()=>scheduleEventsRefresh());
  E.startTimeInput.addEventListener("change", renderTimeline);
  E.endTimeInput.addEventListener("change", renderTimeline);
  E.eventList.addEventListener("click", handleEventAction);

  E.articleSearch.addEventListener("input", renderArticles);
  E.loadMoreArticlesBtn.addEventListener("click",()=>loadArticles(false));
  E.closeReader?.addEventListener("click",()=>E.readerModal.classList.add("hidden"));
  E.readerModal?.addEventListener("click",e=>{ if(e.target===E.readerModal) E.readerModal.classList.add("hidden"); });
  E.copyArticleBtn?.addEventListener("click",()=>{
    navigator.clipboard.writeText(E.readerContent.innerText||"").then(()=>toast("Article copied."));
  });

  E.clearBattleDetailBtn?.addEventListener("click", clearBattleDetail);
  E.battleTabLive?.addEventListener("click",()=>{ S.battleMode="live"; stopBattlePolling(); loadBattles(true); updateBattleTabPills(); });
  E.battleTabHistory?.addEventListener("click",()=>{ S.battleMode="history"; stopBattlePolling(); loadBattles(true); updateBattleTabPills(); });
  E.battleRefreshBtn?.addEventListener("click",()=>loadBattles(true));
  E.loadMoreBattlesBtn?.addEventListener("click",()=>loadBattles(false));
  injectBattleSearchBar();
  E.closeBattleReport?.addEventListener("click",()=>E.battleReportModal.classList.add("hidden"));
  E.battleReportModal?.addEventListener("click",e=>{ if(e.target===E.battleReportModal) E.battleReportModal.classList.add("hidden"); });
  E.copyBattleReportBtn?.addEventListener("click",()=>{
    navigator.clipboard.writeText(E.battleReportContent.innerText||"").then(()=>toast("Battle report copied."));
  });
  E.openBattlePageBtn?.addEventListener("click", () => {
    const battleId = E.openBattlePageBtn.dataset.battleId;
    if (!battleId) return;
    window.open(`https://app.warera.io/battle/${battleId}`, "_blank");
  });

  E.marketRefreshBtn?.addEventListener("click",()=>loadMarketFull(true));
  E.marketOpenBtn?.addEventListener("click", () => {window.open(`https://app.warera.io/market`, "_blank");});
  E.copyMarketReportBtn?.addEventListener("click", copyMarketReport);

  E.jobsRefreshBtn?.addEventListener("click",()=>loadJobs(true));
  E.copyJobsReportBtn?.addEventListener("click", copyJobsReport);
  E.copyRankingsReportBtn?.addEventListener("click", copyRankingsReport);
  E.jobSearch?.addEventListener("input", renderJobs);
  E.loadMoreJobsBtn?.addEventListener("click",()=>loadJobs(false));

  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape") return;
    E.apiKeyModal.classList.add("hidden");
    E.readerModal?.classList.add("hidden");
    E.battleReportModal?.classList.add("hidden");
    E.settingsModal?.classList.add("hidden");
  });

  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("#copyMarketReportBtn, #copyJobsReportBtn, #copyRankingsReportBtn, #copyArticleBtn, #copyBattleReportBtn, .ec-copy")) {
      playCopy(); return;
    }
    if (t.closest(".ac-read, #openFullReportBtn")) {
      playRead(); return;
    }
    if (t.closest("button, a, .event-card, .battle-card")) {
      playClick();
    }
  });

  document.getElementById("articleLoadMini")?.addEventListener("click", () => { E.loadMoreArticlesBtn.click(); });

  const battleMini = document.getElementById("battleLoadMini");
  if (battleMini) { battleMini.addEventListener("click", () => { E.loadMoreBattlesBtn.click(); }); }

  initRankings();

  E.jobWageFilter?.addEventListener("input", () => {
    S.jobWageFilter = Number(E.jobWageFilter.value || 0);
    renderJobs();
  });

  document.getElementById("wageUp")?.addEventListener("click", () => {
    const v = Number(E.jobWageFilter.value || 0);
    E.jobWageFilter.value = (v + 0.01).toFixed(2);
    S.jobWageFilter = Number(E.jobWageFilter.value);
    renderJobs();
  });

  document.getElementById("wageDown")?.addEventListener("click", () => {
    const v = Number(E.jobWageFilter.value || 0);
    E.jobWageFilter.value = Math.max(0, v - 0.01).toFixed(2);
    S.jobWageFilter = Number(E.jobWageFilter.value);
    renderJobs();
  });

  E.commodityOrdersBtn?.addEventListener("click", ()=>{
    S.market.orderView="commodity";
    E.commodityOrdersBtn.classList.add("active");
    E.equipmentOrdersBtn.classList.remove("active");
    S.market.orders=S.market.commodityOrders;
    renderMarketOrders();
  });

  E.equipmentOrdersBtn?.addEventListener("click", ()=>{
    S.market.orderView="equipment";
    E.equipmentOrdersBtn.classList.add("active");
    E.commodityOrdersBtn.classList.remove("active");
    S.market.orders=S.market.equipmentOrders;
    renderMarketOrders();
  });
}

function init() {
  E.apiKeyInput.value = localStorage.getItem(STORE.apiKey) || "";
  applyTheme(localStorage.getItem(STORE.theme) || "dark");
  populateEventTypes();
  injectJobsCountryFilter();
  bindAll();
  isTimelineOpen();

  if (apiKey()) {
    bootData();
  } else {
    E.apiButton.classList.add("needs-attention");
    setStatus("Enter your War Era API key to start the live feed.");
  }
}

// Initialize nixie clock
initNixie();

// Initialize oscilloscope
initOsc();

// Initialize ECG
initEcg();

// Consolidated market refresh: stats + full refresh every 10s
setInterval(()=>{ loadMarketStats(); loadMarketFull(false); }, 10000);

// Initialize wage slider
if (wageSlider && wageValue) {
  updateWageSlider();
  wageSlider.addEventListener("input", updateWageSlider);
}

// Bootstrap with intro overlay
initIntro(init);
