import { S } from "./core/state.js";
import { E } from "./core/dom.js";
import { STORE } from "./core/storage.js";
import { apiKey } from "./core/api.js";
import { debounce, parseLocal, fmtDate, fmtNum } from "./core/utils.js";
import { captureHTML, ts } from "./core/captureReport.js";
import { populateEventTypes } from "./timeline/filters.js";
import { loadEvents, startAutoRefresh, scheduleEventsRefresh, renderTimeline, handleEventAction } from "./timeline/timeline.js";
import { loadArticles, renderArticles, copyArticles } from "./timeline/articles.js";
import { switchTab, isTimelineOpen } from "./ui/tabs.js";
import { toggleTheme, applyTheme } from "./ui/theme.js";
import { toast, setStatus } from "./ui/toast.js";
import { evtData, evtTime, buildTitle, buildSummary } from "./timeline/events.js";
import { initFeatured, loadFeatured } from "./timeline/featured.js";
import { loadBattles, stopBattlePolling, updateBattleTabPills } from "./battles/battles.js";
import { injectBattleSearchBar } from "./battles/companies.js";
import { loadMarketFull, loadMarketStats, copyMarketReport, captureMarketReport, renderMarketOrders, initMarketView } from "./market/market.js";
import { loadJobs, renderJobs, copyJobsReport, captureJobsReport, initJobViews } from "./jobs/jobs.js";
import { initIntro } from "./intro/intro.js";
import { initRankings, copyRankingsReport, captureRankingsReport, refreshRankings } from "./rankings/rankings.js";
import { playClick, playRead, playCopy, playApiSaved, setSfxVolume, getSfxVolume } from "./audio/audio.js";
import { loadProfile, saveProfile, deleteProfile, isRegistered, formatProfileLink, resolveProfile } from "./user/profile.js";
import { POLICY_TEXT } from "./community/policy.js";
import { loadMessages, loadMoreMessages, postMessage, upvoteMessage, renderWallMessages, renderWallCount, getMessageById, hasMoreMessages, getRemainingQuota } from "./community/wall.js";
import { loadPolitics, initPolitics } from "./politics/politics.js";
import { highlightUserData } from "./core/profileHighlighter.js";
import { initClock, updateInfobar } from "./visuals/clock.js";

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function injectJobsCountryFilter() {
  const bar = document.querySelector(".jobs-search-bar");
  if (!bar) return;
  const wrap = document.createElement("div");
  wrap.className = "input-wrap";
  wrap.style.flex = "1";
  wrap.innerHTML = `
<input id="jobCountryFilter" type="text" list="jobCountryOptions" placeholder="Filter by country…">
<button class="clear-btn" data-clears="jobCountryFilter" type="button"><iconify-icon icon="mdi:close" class="lu"></iconify-icon></button>
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

function updateWageSlider() {
  const slider = document.getElementById("jobWageFilter");
  const val = document.getElementById("jobWageValue");
  if (!slider || !val) return;
  const min = Number(slider.min), max = Number(slider.max);
  const v = Number(slider.value);
  val.textContent = v.toFixed(3);
}

function bootData() {
  E.globalEventsTitle.classList.add("live");
  loadEvents(true);
  loadArticles(true);
  startAutoRefresh();
  loadMarketStats();
  loadMarketFull(false);
  loadJobs();
  loadFeatured();
}

function bindAll() {
  document.querySelectorAll(".clear-btn[data-clears]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const el=document.getElementById(btn.dataset.clears);
      if(el){ el.value=""; el.dispatchEvent(new Event("input",{bubbles:true})); el.focus(); }
    });
  });

  // Sidebar navigation
  document.querySelectorAll(".side-btn[data-tab]").forEach(btn=>{
    btn.addEventListener("click",()=>switchTab(btn.dataset.tab));
  });

  // Writer redirect
  document.getElementById("writerRedirect")?.addEventListener("click",()=>{
    window.open("https://lundgrenwarera.github.io/warera-writer/", "_blank");
  });

  E.clearApiKeyBtn?.addEventListener("click",()=>{ E.apiKeyInput.value=""; E.apiKeyInput.focus(); });

  // Theme toggle available in settings or via keyboard
  document.getElementById("themeToggleBtn")?.addEventListener("click", toggleTheme);

  function openProfileModal() {
    const profile = loadProfile();
    const regView = document.getElementById("profileRegisterView");
    const dispView = document.getElementById("profileDisplayView");
    if (profile) {
      regView.classList.add("hidden");
      dispView.classList.remove("hidden");
      const avatarHtml = profile.avatarUrl
        ? `<img class="profile-avatar" src="${profile.avatarUrl}" alt="" loading="lazy">`
        : `<span class="profile-avatar profile-avatar--initials">${(profile.username?.charAt(0)||"?").toUpperCase()}</span>`;
      const link = formatProfileLink(profile.userId);
      const nameHtml = link
        ? `<a href="${link}" target="_blank" rel="noopener" class="profile-name-link">${escHtml(profile.username)} ↗</a>`
        : `<span class="profile-name">${escHtml(profile.username)}</span>`;
      let detailsHtml = `<span class="profile-detail"><span class="profile-label">ID</span>${escHtml(profile.userId)}</span>`;
      if (profile.level) detailsHtml += `<span class="profile-detail"><span class="profile-label">Level</span>${escHtml(profile.level)}</span>`;
      if (profile.countryName) detailsHtml += `<span class="profile-detail"><span class="profile-label">Country</span>${escHtml(profile.countryName)}</span>`;
      if (profile.muName) detailsHtml += `<span class="profile-detail"><span class="profile-label">MU</span>${escHtml(profile.muName)}</span>`;
      if (profile.subscribers != null) detailsHtml += `<span class="profile-detail"><span class="profile-label">Subs</span><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style="fill:currentColor;vertical-align:middle;margin-right:2px"><path d="M2 10h20v2H2zm0 10h20v2H2zm0-8h2v8H2zm18 0h2v8h-2zM6 6h12v2H6zm2-4h8v2H8zM6 16h2v2H6zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>${fmtNum(profile.subscribers)}</span>`;
      document.getElementById("profileDisplay").innerHTML = `
        <div class="profile-avatar-wrap">${avatarHtml}</div>
        ${nameHtml}
        <div class="profile-details">${detailsHtml}</div>
      `;
      getRemainingQuota().then(quota => {
        const qEl = document.getElementById("profileQuota");
        if (qEl) qEl.textContent = `Wall posts: ${quota.used}/${quota.total} used this week`;
      });
    } else {
      regView.classList.remove("hidden");
      dispView.classList.add("hidden");
      document.getElementById("regUserInput").value = "";
      document.getElementById("regProfileStatus")?.classList.add("hidden");
    }
    document.getElementById("profileModal").classList.remove("hidden");
  }

  function openSettingsModal() {
    document.getElementById("sfxVolumeSlider").value = Math.round(getSfxVolume() * 100);
    document.getElementById("sfxVolumeValue").textContent = Math.round(getSfxVolume() * 100) + "%";
    document.getElementById("settingsApiKeyInput").value = localStorage.getItem(STORE.apiKey) || "";
    document.getElementById("settingsModal").classList.remove("hidden");
  }

  function updateUserButton() {
    const p = loadProfile();
    const icon = document.getElementById("userIcon");
    if (p && p.avatarUrl) {
      icon.innerHTML = `<img src="${p.avatarUrl}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover">`;
    } else if (p) {
      icon.textContent = p.username?.charAt(0) || "?";
    } else {
      icon.innerHTML = `<iconify-icon icon="mdi:account" class="lu"></iconify-icon>`;
    }
  }

  document.getElementById("userBtn")?.addEventListener("click", openProfileModal);
  document.getElementById("settingsBtn")?.addEventListener("click", openSettingsModal);
  updateUserButton();

  // API key modal — save triggers data load
  E.saveApiKeyButton?.addEventListener("click",()=>{
    const key=E.apiKeyInput.value.trim();
    localStorage.setItem(STORE.apiKey,key);
    E.globalEventsTitle.classList.add("live");
    E.apiKeyModal.classList.add("hidden");
    if(key){ S.lookupsKey=""; loadEvents(true); loadArticles(true); startAutoRefresh(); loadMarketStats(); playApiSaved(); }
  });
  E.apiKeyModal?.addEventListener("click",e=>{ if(e.target===E.apiKeyModal) E.apiKeyModal.classList.add("hidden"); });

  // Settings save
  function saveSettings() {
    const prevKey = localStorage.getItem(STORE.apiKey) || "";
    localStorage.setItem(STORE.apiKey, document.getElementById("settingsApiKeyInput").value.trim());
    document.getElementById("settingsModal").classList.add("hidden");
    const newKey = localStorage.getItem(STORE.apiKey) || "";
    if (newKey && newKey !== prevKey) {
      S.lookupsKey = "";
      loadEvents(true);
      loadArticles(true);
      startAutoRefresh();
      loadMarketStats();
    }
  }
  document.getElementById("closeProfileBtn")?.addEventListener("click",()=>{
    document.getElementById("profileModal").classList.add("hidden");
  });
  document.getElementById("profileModal")?.addEventListener("click",e=>{
    if(e.target===document.getElementById("profileModal")) document.getElementById("profileModal").classList.add("hidden");
  });

  document.getElementById("closeSettingsBtn")?.addEventListener("click", saveSettings);
  document.getElementById("settingsModal")?.addEventListener("click",e=>{
    if(e.target===document.getElementById("settingsModal")) saveSettings();
  });

  // About modal
  document.getElementById("aboutBtn")?.addEventListener("click",()=>{
    document.getElementById("aboutModal").classList.remove("hidden");
  });
  document.getElementById("aboutCloseBtn")?.addEventListener("click",()=>{
    document.getElementById("aboutModal").classList.add("hidden");
  });
  document.getElementById("aboutModal")?.addEventListener("click",e=>{
    if(e.target===document.getElementById("aboutModal")) document.getElementById("aboutModal").classList.add("hidden");
  });

  // Rooster link
  document.getElementById("roosterBtn")?.addEventListener("click",()=>{
    window.open("https://app.warera.io/user/69bd432766cd740733175da7", "_blank");
  });

  // SFX volume
  document.getElementById("sfxVolumeSlider")?.addEventListener("input",()=>{
    const v = Number(document.getElementById("sfxVolumeSlider").value);
    document.getElementById("sfxVolumeValue").textContent = v + "%";
    setSfxVolume(v / 100);
  });

  // Profile resolution
  document.getElementById("resolveProfileBtn")?.addEventListener("click",async ()=>{
    const input = document.getElementById("regUserInput").value.trim();
    if (!input) { toast("Enter a user ID or profile URL."); return; }
    const statusEl = document.getElementById("regProfileStatus");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "Resolving...";
    statusEl.className = "status-msg";
    const result = await resolveProfile(input, apiKey());
    if (result.error) {
      statusEl.textContent = result.error;
      statusEl.className = "status-msg error";
      return;
    }
    statusEl.classList.add("hidden");
    updateUserButton();
    toast("Profile saved.");
    openProfileModal();
    setTimeout(highlightUserData, 200);
  });

  document.getElementById("deleteProfileBtn")?.addEventListener("click",()=>{
    if (!confirm("Delete your profile and all stored data?")) return;
    deleteProfile();
    updateUserButton();
    toast("Profile deleted.");
    openProfileModal();
  });

  E.applyFiltersBtn?.addEventListener("click",()=>loadEvents(true));
  E.clearFiltersBtn?.addEventListener("click",()=>{
    E.countryInput.value=""; E.eventTypeSelect.value="";
    E.startTimeInput.value=""; E.endTimeInput.value="";
    if (E.eventLimitInput) E.eventLimitInput.value="50";
    loadEvents(true);
  });
  E.loadMoreBtn?.addEventListener("click",()=>loadEvents(false));
  E.countryInput?.addEventListener("input", debounce(()=>scheduleEventsRefresh(),350));
  E.eventTypeSelect?.addEventListener("change",()=>scheduleEventsRefresh());
  E.eventLimitInput?.addEventListener("change",()=>scheduleEventsRefresh());
  document.getElementById("eventLoadMini")?.addEventListener("click",()=>{ E.loadMoreBtn?.click(); });
  E.copyTimelineBtn?.addEventListener("click",()=>{
    playCopy();
    const start=parseLocal(E.startTimeInput.value);
    const end=parseLocal(E.endTimeInput.value);
    const lines=[];
    for(const e of S.events){
      const ts=evtTime(e); if(!ts) continue;
      const t=new Date(ts).getTime(); if(isNaN(t)) continue;
      if(start&&t<start.getTime()) continue;
      if(end&&t>end.getTime()) continue;
      const ed=evtData(e);
      const type=e.type||e.eventType||ed.type||e.name||"event";
      const title=buildTitle(e,type,ed);
      const summary=buildSummary(e,type,ed);
      lines.push(`[${fmtDate(ts)}] ${title}\n${summary}`);
    }
    navigator.clipboard.writeText(lines.join("\n\n")).then(()=>toast("Timeline copied."));
  });
  E.startTimeInput?.addEventListener("change", renderTimeline);
  E.endTimeInput?.addEventListener("change", renderTimeline);
  E.eventList?.addEventListener("click", handleEventAction);

  E.articleSearch?.addEventListener("input", renderArticles);
  E.loadMoreArticlesBtn?.addEventListener("click",()=>loadArticles(false));
  document.querySelectorAll(".article-filter-row [data-art-sort]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".article-filter-row [data-art-sort]").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      S.articleSort=btn.dataset.artSort;
      renderArticles();
    });
  });
  document.getElementById("articleTimeFrom")?.addEventListener("change",()=>{ S.articleTimeFrom=document.getElementById("articleTimeFrom").value; renderArticles(); });
  document.getElementById("articleTimeTo")?.addEventListener("change",()=>{ S.articleTimeTo=document.getElementById("articleTimeTo").value; renderArticles(); });
  document.getElementById("articleLangFilter")?.addEventListener("change", renderArticles);
  document.getElementById("articleCatFilter")?.addEventListener("change", renderArticles);
  document.getElementById("copyArticlesBtn")?.addEventListener("click",async()=>{ playCopy(); await copyArticles(); toast("Articles copied."); });
  E.closeReader?.addEventListener("click",()=>E.readerModal.classList.add("hidden"));
  E.readerModal?.addEventListener("click",e=>{ if(e.target===E.readerModal) E.readerModal.classList.add("hidden"); });
  E.copyArticleBtn?.addEventListener("click",()=>{ navigator.clipboard.writeText(E.readerContent.innerText||"").then(()=>toast("Article copied.")); });
  document.getElementById("openArticleBtn")?.addEventListener("click",()=>{
    const id = document.getElementById("openArticleBtn").dataset.id;
    if (id) window.open(`https://app.warera.io/article/${id}`, "_blank", "noopener");
  });

  E.battleTabLive?.addEventListener("click",()=>{ S.battleMode="live"; stopBattlePolling(); loadBattles(true); updateBattleTabPills(); });
  E.battleTabHistory?.addEventListener("click",()=>{ S.battleMode="history"; stopBattlePolling(); loadBattles(true); updateBattleTabPills(); });
  E.battleRefreshBtn?.addEventListener("click",()=>loadBattles(true));
  E.loadMoreBattlesBtn?.addEventListener("click",()=>loadBattles(false));
  injectBattleSearchBar();
  E.closeBattleReport?.addEventListener("click",()=>E.battleReportModal.classList.add("hidden"));
  E.battleReportModal?.addEventListener("click",e=>{ if(e.target===E.battleReportModal) E.battleReportModal.classList.add("hidden"); });
  E.copyBattleReportBtn?.addEventListener("click",()=>{ navigator.clipboard.writeText(E.battleReportContent.innerText||"").then(()=>toast("Battle report copied.")); });
  E.openBattlePageBtn?.addEventListener("click", () => { const id = E.openBattlePageBtn.dataset.battleId; if (id) window.open(`https://app.warera.io/battle/${id}`, "_blank"); });
  document.getElementById("captureBattleReportBtn")?.addEventListener("click", () => { captureHTML(E.battleReportContent.innerHTML, "battle_report_"+ts()+".png"); });

  E.marketRefreshBtn?.addEventListener("click",()=>loadMarketFull(true));
  document.getElementById("marketOpenBtn")?.addEventListener("click", () => {window.open("https://app.warera.io/market", "_blank");});
  E.copyMarketReportBtn?.addEventListener("click", copyMarketReport);
  document.getElementById("captureMarketReportBtn")?.addEventListener("click", captureMarketReport);

  E.jobsRefreshBtn?.addEventListener("click",()=>loadJobs(true));
  E.copyJobsReportBtn?.addEventListener("click", copyJobsReport);
  document.getElementById("captureJobsReportBtn")?.addEventListener("click", captureJobsReport);
  initJobViews();
  E.copyRankingsReportBtn?.addEventListener("click", copyRankingsReport);
  document.getElementById("captureRankingsReportBtn")?.addEventListener("click", captureRankingsReport);
  E.rankingsRefreshBtn?.addEventListener("click", refreshRankings);
  document.getElementById("politicsRefreshBtn")?.addEventListener("click", () => loadPolitics(true));

  function updateWallLoadMore() { if (E.wallLoadMore) E.wallLoadMore.hidden = !hasMoreMessages(); }

  E.wallPostBtn?.addEventListener("click",()=>{
    const profile = loadProfile();
    if (profile) E.wallAuthorInput.value = profile.username || "";
    E.wallMessageInput.value = ""; E.wallCharCount.textContent = "0/500";
    E.wallPostModal.classList.remove("hidden");
    setTimeout(()=>E.wallMessageInput.focus(), 150);
  });
  E.wallCancelBtn?.addEventListener("click",()=>E.wallPostModal.classList.add("hidden"));
  E.wallPostModal?.addEventListener("click",e=>{ if(e.target===E.wallPostModal) E.wallPostModal.classList.add("hidden"); });
  E.wallMessageInput?.addEventListener("input",()=>{ E.wallCharCount.textContent = E.wallMessageInput.value.length + "/500"; });
  E.wallPublishBtn?.addEventListener("click",async ()=>{
    const author = E.wallAuthorInput.value.trim(); const text = E.wallMessageInput.value.trim();
    if (!author || !text) { toast("Please enter a name and message."); return; }
    const result = await postMessage(author, text);
    if (result.error) { toast(result.error); return; }
    E.wallPostModal.classList.add("hidden"); toast("Message posted!");
    renderWallMessages("wallGrid"); renderWallCount("wallCount"); updateWallLoadMore();
  });
  E.wallPolicyBtn?.addEventListener("click",()=>{ E.wallPolicyContent.innerHTML = POLICY_TEXT; E.wallPolicyModal.classList.remove("hidden"); });
  E.wallPolicyClose?.addEventListener("click",()=>E.wallPolicyModal.classList.add("hidden"));
  E.wallPolicyModal?.addEventListener("click",e=>{ if(e.target===E.wallPolicyModal) E.wallPolicyModal.classList.add("hidden"); });
  E.wallReadClose?.addEventListener("click",()=>E.wallReadModal.classList.add("hidden"));
  E.wallReadModal?.addEventListener("click",e=>{ if(e.target===E.wallReadModal) E.wallReadModal.classList.add("hidden"); });
  E.wallReadUpvote?.addEventListener("click",async ()=>{
    const id = E.wallReadUpvote.dataset.wallId; if (!id) return;
    E.wallReadUpvote.disabled = true;
    const ok = await upvoteMessage(id);
    if (ok === "no-key") toast("Save your API key first (Settings → API Key)");
    else if (ok === "already") toast("You already upvoted this message");
    else if (ok) { const msg = getMessageById(id); if (msg) E.wallReadUpvoteCount.textContent = msg.upvotes; renderWallMessages("wallGrid"); updateWallLoadMore(); }
    E.wallReadUpvote.disabled = false;
  });

  document.querySelectorAll("[data-wall-sort]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll("[data-wall-sort]").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      S.wallSort = btn.dataset.wallSort;
      loadMessages(S.wallSort).then(result=>{ renderWallMessages("wallGrid", result.messages); renderWallCount("wallCount"); updateWallLoadMore(); });
    });
  });

  E.wallGrid?.addEventListener("click",e=>{
    const readBtn = e.target.closest(".wall-read-btn"); const upvoteBtn = e.target.closest(".wall-upvote-btn");
    if (readBtn) {
      const id = readBtn.dataset.id; const msg = getMessageById(id);
      if (!msg) return; E.wallReadAuthor.textContent = msg.author; E.wallReadTime.textContent = new Date(msg.created_at).toLocaleString();
      E.wallReadMessage.textContent = msg.text; E.wallReadUpvoteCount.textContent = msg.upvotes || 0;
      E.wallReadUpvote.dataset.wallId = id; E.wallReadModal.classList.remove("hidden");
      return;
    }
    if (upvoteBtn) {
      const id = upvoteBtn.dataset.id; upvoteBtn.disabled = true;
      upvoteMessage(id).then(ok=>{
        if (ok === "no-key") toast("Save your API key first (Settings → API Key)");
        else if (ok === "already") toast("You already upvoted this message");
        else if (ok) { renderWallMessages("wallGrid"); updateWallLoadMore(); }
        upvoteBtn.disabled = false;
      });
    }
  });
  E.wallLoadMore?.addEventListener("click",async ()=>{
    E.wallLoadMore.disabled = true;
    const result = await loadMoreMessages();
    if (result.loaded > 0) renderWallMessages("wallGrid", result.messages);
    updateWallLoadMore(); E.wallLoadMore.disabled = false;
  });
  E.jobSearch?.addEventListener("input", renderJobs);
  E.loadMoreJobsBtn?.addEventListener("click",()=>loadJobs(false));
  initFeatured();

  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape") return;
    document.querySelectorAll(".overlay").forEach(m=>m.classList.add("hidden"));
  });

  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("#copyMarketReportBtn, #copyJobsReportBtn, #copyRankingsReportBtn, #copyArticleBtn, #copyBattleReportBtn, .ec-copy")) { playCopy(); return; }
    if (t.closest(".ac-read, #openFullReportBtn, .wall-read-btn")) { playRead(); return; }
    if (t.closest("button, a, .event-card, .battle-card, .wall-upvote-btn")) { playClick(); }
  });

  document.getElementById("articleLoadMini")?.addEventListener("click", () => { E.loadMoreArticlesBtn?.click(); });

  initRankings();
  initMarketView();
  initPolitics();

  document.getElementById("jobWageFilter")?.addEventListener("input", () => {
    S.jobWageFilter = Number(document.getElementById("jobWageFilter").value || 0);
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
  applyTheme(localStorage.getItem(STORE.theme) || "light");

  populateEventTypes();
  injectJobsCountryFilter();
  bindAll();

  if (apiKey()) {
    bootData();
    setTimeout(highlightUserData, 500);
  } else {
    setStatus("Enter your War Era API key to start the live feed.");
  }
}

// Clock
initClock();

// Infobar update (initial + periodic)
updateInfobar();
setInterval(updateInfobar, 30000);

// Featured articles refresh interval
setInterval(loadFeatured, 300000);

// Market refresh interval
let _marketRefreshing = false;
setInterval(() => {
  if (_marketRefreshing) return;
  _marketRefreshing = true;
  loadMarketStats();
  loadMarketFull(false).finally(() => { _marketRefreshing = false; });
}, 10000);

// Wage slider
const ws = document.getElementById("jobWageFilter");
if (ws) {
  updateWageSlider();
  ws.addEventListener("input", updateWageSlider);
}

// Bootstrap
initIntro(init);
