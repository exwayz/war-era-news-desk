import { S } from "./core/state.js";
import { E } from "./core/dom.js";
import { populateRegionOptions } from "./core/regionClassification.js";
import { STORE } from "./core/storage.js";
import { apiKey, isValidApiKey, resetTxCaches } from "./core/api.js";
import { debounce, parseLocal, fmtDate, fmtNum, escapeHtml, readerBylineText } from "./core/utils.js";
import { populateEventTypes } from "./timeline/filters.js";
import { loadEvents, startAutoRefresh, scheduleEventsRefresh, handleEventAction } from "./timeline/timeline.js";
import { loadArticles, renderArticles, refreshLangDropdown } from "./timeline/articles.js";
import { switchTab } from "./ui/tabs.js";
import { toggleTheme, applyTheme, applyTexture } from "./ui/theme.js";
import { toast, setStatus } from "./ui/toast.js";
import { evtData, evtTime, buildTitle, buildSummary } from "./timeline/events.js";
import { initFeatured, loadFeatured } from "./timeline/featured.js";
import { loadBattles, stopBattlePolling, updateBattleTabPills, resetBattleTypePills, clearBattleDetail, initBattleInfiniteScroll } from "./battles/battles.js";
import { injectBattleSearchBar } from "./battles/companies.js";
import { loadMarketFull, loadMarketStats, copyMarketReport, captureMarketReport, renderMarketOrders, initMarketView } from "./market/market.js";
import { loadJobs, renderJobs, copyJobsReport, captureJobsReport, initJobViews } from "./jobs/jobs.js";
import { copyJobsConcentration, captureJobsConcentration } from "./jobs/concentration.js";
import { initIntro } from "./intro/intro.js";
import { initRankings, copyRankingsReport, captureRankingsReport, refreshRankings } from "./rankings/rankings.js";
import { playClick, playRead, playCopy, playApiSaved, setSfxVolume, getSfxVolume, getSfxEnabled, setSfxEnabled } from "./audio/audio.js";
import { loadProfile, deleteProfile, formatProfileLink, resolveProfile } from "./user/profile.js";
import { POLICY_TEXT } from "./community/policy.js";
import { loadMessages, loadMoreMessages, postMessage, upvoteMessage, renderWallMessages, renderWallCount, getMessageById, hasMoreMessages, getRemainingQuota, prependWallCard, updateUpvoteDisplay, copyCommunityReport } from "./community/wall.js";
import { loadPolitics, initPolitics, copyPoliticsReport, capturePoliticsReport } from "./politics/politics.js";
import { initLibrary, ensureLibraryIndex, copyLibraryArticles } from "./library/library.js";
import { initBookmarkButton, getCurrentArticle } from "./library/bookmarks.js";
import { initTableMaker } from "./tablemaker/tablemaker.js";
import { highlightUserData } from "./core/profileHighlighter.js";
import { initClock, updateInfobar } from "./visuals/clock.js";
import { initReaderZoom } from "./ui/readerZoom.js";
import { initReaderHighlight, loadHighlightsForArticle } from "./ui/readerHighlight.js";
import { openReaderFromMention, navigateBack, closeReaderNav } from "./ui/readerNav.js";
import { initImageViewer } from "./ui/imageViewer.js";
import { initTooltips } from "./ui/tooltip.js";
import { openChangelog, closeChangelog } from "./ui/changelog.js";
import { initStudio, openStudio } from "./studio/studio.js";
import { fetchGuideArticle, renderPinnedCard, hideToc } from "./pinned/guideArticle.js";

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
  const out = document.getElementById("jobWageOutput");
  if (!slider) return;
  const v = Number(slider.value);
  const wrap = slider.closest(".wage-slider");
  if (wrap) {
    wrap.style.setProperty("--val", v);
    const min = Number(slider.min), rng = Number(slider.max) - min;
    const zone = v < min + .25 * rng ? "--c-green" : v < min + .75 * rng ? "--c-mid" : "--c-red";
    wrap.style.setProperty("--thumb-c", `var(${zone})`);
  }
  const txt = v.toFixed(3);
  if (out) out.textContent = txt;
  if (val) val.textContent = txt;
}

function syncEndTimeDisabled() {
  if (!E.startTimeInput || !E.endTimeInput) return;
  E.endTimeInput.disabled = !E.startTimeInput.value;
  if (!E.startTimeInput.value) E.endTimeInput.value = "";
}

function bootData() {
  E.globalEventsTitle.classList.add("live");
  // Boot to the default view: no date range. Browsers can restore the static
  // datetime-local inputs across a reload, and a restored range would trigger
  // the slow full-range feed walk at startup instead of the instant single page.
  if (E.startTimeInput) E.startTimeInput.value = "";
  syncEndTimeDisabled();
  loadEvents(true);
  loadArticles(true);
  startAutoRefresh();
  loadMarketStats();
  loadMarketFull(false);
  loadJobs();
  loadFeatured();
  const k = apiKey();
  if (k) fetchGuideArticle(k).then(a => { if (a) renderPinnedCard(document.getElementById("pinnedGuideCard")); });
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

  // External tools bubble (folder of external tool links)
  const extToolsBtn = document.getElementById("externalToolsBtn");
  const extToolsBubble = document.getElementById("externalToolsBubble");
  const closeExtTools = () => {
    if (extToolsBubble) extToolsBubble.hidden = true;
    extToolsBtn?.setAttribute("aria-expanded", "false");
  };
  extToolsBtn?.addEventListener("click", e => {
    e.stopPropagation();
    if (extToolsBubble) {
      if (extToolsBubble.hidden) {
        const rect = extToolsBtn.getBoundingClientRect();
        extToolsBubble.style.top = Math.max(8, rect.top) + "px";
        extToolsBubble.style.left = (rect.right + 8) + "px";
        extToolsBubble.hidden = false;
        extToolsBtn.setAttribute("aria-expanded", "true");
      } else {
        closeExtTools();
      }
    }
  });
  extToolsBubble?.querySelectorAll("[data-ext-url]").forEach(item => {
    item.addEventListener("click", () => {
      window.open(item.dataset.extUrl, "_blank");
      closeExtTools();
    });
  });
  document.addEventListener("click", e => {
    if (extToolsBubble && !extToolsBubble.hidden &&
      !e.target.closest("#externalToolsBubble") && !e.target.closest("#externalToolsBtn")) closeExtTools();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && extToolsBubble && !extToolsBubble.hidden) closeExtTools();
  });

  E.clearApiKeyBtn?.addEventListener("click",()=>{ E.apiKeyInput.value=""; E.apiKeyInput.focus(); });
  E.apiKeyInput?.addEventListener("input",()=>{ const s=document.getElementById("apiKeyStatus"); if(s) s.hidden=true; });
  document.getElementById("settingsApiKeyInput")?.addEventListener("input",()=>{ const s=document.getElementById("settingsStatus"); if(s) s.hidden=true; });

  // Theme toggle available in settings or via keyboard
  document.getElementById("themeToggleBtn")?.addEventListener("click", toggleTheme);

  function renderProfileDisplay() {
    const profile = loadProfile();
    const regView = document.getElementById("profileRegisterView");
    const dispView = document.getElementById("profileDisplayView");
    if (profile) {
      regView.classList.add("hidden");
      dispView.classList.remove("hidden");
      const refreshBtn = document.getElementById("refreshProfileBtn");
      if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.querySelector("iconify-icon")?.classList.remove("nd-spin"); }
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
  }

  function openProfileModal() {
    renderProfileDisplay();
    document.getElementById("profileModal").classList.remove("hidden");
  }

  function openSettingsModal() {
    document.getElementById("sfxVolumeSlider").value = Math.round(getSfxVolume() * 100);
    document.getElementById("sfxVolumeValue").textContent = Math.round(getSfxVolume() * 100) + "%";
    document.getElementById("settingsApiKeyInput").value = localStorage.getItem(STORE.apiKey) || "";
    document.getElementById("paperTextureToggle").checked = localStorage.getItem(STORE.texture) === "1";
    document.getElementById("audioEnabledToggle").checked = getSfxEnabled();
    document.getElementById("settingsModal").classList.remove("hidden");
  }

  function updateUserButton() {
    const p = loadProfile();
    const icon = document.getElementById("userIcon");
    if (p && p.avatarUrl) {
      icon.innerHTML = `<img src="${escapeHtml(p.avatarUrl)}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover">`;
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
    if (key && !isValidApiKey(key)) {
      const status = document.getElementById("apiKeyStatus");
      if (status) { status.hidden = false; status.textContent = "Invalid format. Key must start with wae_ and contain at least 64 hex characters."; }
      E.apiKeyInput.focus();
      return;
    }
    localStorage.setItem(STORE.apiKey,key);
    E.globalEventsTitle.classList.add("live");
    E.apiKeyModal.classList.add("hidden");
    if(key){ resetTxCaches(); S.lookupsKey=""; loadEvents(true); loadArticles(true); startAutoRefresh(); loadMarketStats(); playApiSaved(); ensureLibraryIndex(); fetchGuideArticle(key).then(a => { if (a) renderPinnedCard(document.getElementById("pinnedGuideCard")); }); }
  });
  E.apiKeyModal?.addEventListener("click",e=>{ if(e.target===E.apiKeyModal) E.apiKeyModal.classList.add("hidden"); });

  // Settings save
  function saveSettings() {
    const prevKey = localStorage.getItem(STORE.apiKey) || "";
    const newKeyValue = document.getElementById("settingsApiKeyInput").value.trim();
    if (newKeyValue && !isValidApiKey(newKeyValue)) {
      const status = document.getElementById("settingsStatus");
      if (status) { status.hidden = false; status.textContent = "Invalid format. Key must start with wae_ and contain at least 64 hex characters."; }
      return;
    }
    localStorage.setItem(STORE.apiKey, newKeyValue);
    document.getElementById("settingsModal").classList.add("hidden");
    const newKey = localStorage.getItem(STORE.apiKey) || "";
    if (newKey && newKey !== prevKey) {
      resetTxCaches();
      S.lookupsKey = "";
      loadEvents(true);
      loadArticles(true);
      startAutoRefresh();
      loadMarketStats();
      ensureLibraryIndex();
    }
  }
  document.getElementById("closeProfileBtn")?.addEventListener("click",()=>{
    document.getElementById("profileModal").classList.add("hidden");
  });
  document.getElementById("refreshProfileBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("refreshProfileBtn");
    const profile = loadProfile();
    if (!profile || btn.disabled) return;
    const apiKey = localStorage.getItem(STORE.apiKey);
    if (!apiKey) {
      toast("Save your API key first to refresh the profile.");
      return;
    }
    btn.disabled = true;
    const iconEl = btn.querySelector("iconify-icon");
    iconEl?.classList.add("nd-spin");
    try {
      const res = await resolveProfile(profile.userId, apiKey);
      if (res.success) {
        updateUserButton();
        renderProfileDisplay();
        toast("Profile refreshed.");
      } else {
        toast(res.error || "Failed to refresh profile.");
      }
    } finally {
      btn.disabled = false;
      iconEl?.classList.remove("nd-spin");
    }
  });
  document.getElementById("profileModal")?.addEventListener("click",e=>{
    if(e.target===document.getElementById("profileModal")) document.getElementById("profileModal").classList.add("hidden");
  });

  document.getElementById("closeSettingsBtn")?.addEventListener("click", saveSettings);
  document.getElementById("settingsModal")?.addEventListener("click",e=>{
    if(e.target===document.getElementById("settingsModal")) saveSettings();
  });
  document.getElementById("paperTextureToggle")?.addEventListener("change", e => applyTexture(e.target.checked));
  document.getElementById("audioEnabledToggle")?.addEventListener("change", e => setSfxEnabled(e.target.checked));

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

  // Changelog modal
  document.getElementById("changelogBtn")?.addEventListener("click", openChangelog);
  document.getElementById("changelogCloseBtn")?.addEventListener("click", closeChangelog);
  document.getElementById("changelogModal")?.addEventListener("click",e=>{
    if(e.target===document.getElementById("changelogModal")) closeChangelog();
  });

  // Rooster link
  document.getElementById("roosterLink")?.addEventListener("click",()=>{
    window.open("https://app.warera.io/article/6a2412d3ab0324053f192413", "_blank");
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
    if (!input) { toast("Enter a username, user ID, or profile URL."); return; }
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

  document.getElementById("openStudioBtn")?.addEventListener("click", async () => {
    const profile = loadProfile();
    if (!profile) { toast("Register a profile first."); return; }
    document.getElementById("profileModal")?.classList.add("hidden");
    openStudio(profile.userId, profile);
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
    syncEndTimeDisabled();
    loadEvents(true);
  });
  E.loadMoreBtn?.addEventListener("click",()=>loadEvents(false));
  E.countryInput?.addEventListener("input", debounce(()=>scheduleEventsRefresh(),350));

  populateRegionOptions(document.getElementById("timelineRegionOptions"));
  const timelineRegionInput = document.getElementById("timelineRegionFilter");
  const timelineRegionClr = document.querySelector("[data-clears='timelineRegionFilter']");
  timelineRegionInput?.addEventListener("input", () => {
    S.timelineRegionFilter = timelineRegionInput.value.replace(/^[^a-zA-Z0-9]*/, "").trim();
    loadEvents(true);
  });
  timelineRegionClr?.addEventListener("click", () => {
    if (timelineRegionInput) { timelineRegionInput.value = ""; S.timelineRegionFilter = ""; loadEvents(true); timelineRegionInput.focus(); }
  });
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
  E.startTimeInput?.addEventListener("change",()=>{ syncEndTimeDisabled(); loadEvents(true); });
  E.endTimeInput?.addEventListener("change",()=>loadEvents(true));
  syncEndTimeDisabled();
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
  const langCont = document.getElementById("articleLangFilter");
  const langTrigger = langCont?.querySelector(".lang-dropdown-trigger");
  const langMenu = langCont?.querySelector(".lang-dropdown-menu");
  langTrigger?.addEventListener("click",(e)=>{
    e.stopPropagation();
    langMenu?.classList.toggle("hidden");
  });
  langMenu?.addEventListener("click",(e)=>{
    const item = e.target.closest(".lang-dropdown-item");
    if (!item) return;
    const code = item.dataset.lang;
    if (code === "") {
      S.articleLangs = [];
    } else {
      const idx = S.articleLangs.indexOf(code);
      if (idx >= 0) S.articleLangs.splice(idx, 1);
      else S.articleLangs.push(code);
    }
    refreshLangDropdown();
    renderArticles();
  });
  document.addEventListener("click",(e)=>{
    if (langCont && !langCont.contains(e.target)) langMenu?.classList.add("hidden");
  });
  document.getElementById("articleCatFilter")?.addEventListener("change", renderArticles);
  document.getElementById("copyLibraryBtn")?.addEventListener("click", async () => {
    playCopy();
    await copyLibraryArticles();
    toast("Articles copied.");
  });
  E.closeReader?.addEventListener("click",()=>{
    if (navigateBack()) return;
    closeReaderNav();
    E.readerModal.classList.add("hidden");
  });
  E.readerModal?.addEventListener("click",e=>{
    if (e.target !== E.readerModal) return;
    if (navigateBack()) return;
    closeReaderNav();
    E.readerModal.classList.add("hidden");
  });

  document.getElementById("readerBackBtn")?.addEventListener("click",()=>{
    if (!navigateBack()) {
      closeReaderNav();
      E.readerModal.classList.add("hidden");
    }
  });

  E.readerContent?.addEventListener("click",e=>{
    const link = e.target.closest(".reader-article-link");
    if (!link) return;
    e.preventDefault();
    const articleId = link.dataset.articleId;
    if (articleId) openReaderFromMention(articleId);
  });

  // Reader copy protection — block copy/cut events on the article body so text
  // can only be taken out via the gated Copy button. Links/images stay usable.
  E.readerContent?.addEventListener("copy", e => {
    if (!window.getSelection()?.toString()) return;
    e.preventDefault();
    e.stopPropagation();
  });
  E.readerContent?.addEventListener("cut", e => e.preventDefault());

  const copyWarningModal = document.getElementById("copyWarningModal");
  const doCopyArticle = () => {
    const a = getCurrentArticle();
    const title = a?.title || E.readerTitle.innerText || "";
    const byline = a ? readerBylineText(a.author, a.stats) : (E.readerAuthor.innerText || "");
    const content = E.readerContent.innerText || "";
    return navigator.clipboard.writeText([title, byline, "", content].filter(Boolean).join("\n")).then(()=>toast("Article copied."));
  };
  E.copyArticleBtn?.addEventListener("click",()=>{
    if (copyWarningModal) copyWarningModal.classList.remove("hidden");
  });
  copyWarningModal?.addEventListener("click",e=>{ if(e.target===copyWarningModal) copyWarningModal.classList.add("hidden"); });
  document.getElementById("copyWarningAccept")?.addEventListener("click",()=>{
    copyWarningModal?.classList.add("hidden");
    playCopy();
    doCopyArticle();
  });
  document.getElementById("copyWarningCancel")?.addEventListener("click",()=>{
    copyWarningModal?.classList.add("hidden");
  });
  initReaderZoom();
  initReaderHighlight();
  const backToTopBtn = document.getElementById("readerBackToTop");
  E.readerContent?.addEventListener("scroll", () => {
    if (!backToTopBtn) return;
    backToTopBtn.classList.toggle("hidden", E.readerContent.scrollTop < 300);
  });
  backToTopBtn?.addEventListener("click", () => {
    E.readerContent?.scrollTo({ top: 0, behavior: "smooth" });
  });
  // Restore article highlights whenever the reader opens
  const readerMo = new MutationObserver(() => {
    if (!E.readerModal?.classList.contains("hidden")) loadHighlightsForArticle(E.readerContent);
  });
  if (E.readerModal) readerMo.observe(E.readerModal, { attributes: true, attributeFilter: ["class"] });
  initImageViewer();
  initTooltips();
  initStudio();
  document.getElementById("openArticleBtn")?.addEventListener("click",()=>{
    const id = document.getElementById("openArticleBtn").dataset.id;
    if (id) window.open(`https://app.warera.io/article/${id}`, "_blank", "noopener");
  });

  E.battleTabLive?.addEventListener("click",()=>{ S.battleMode="live"; S.battleTypeFilter="all"; resetBattleTypePills(); stopBattlePolling(); loadBattles(true); updateBattleTabPills(); });
  E.battleTabHistory?.addEventListener("click",()=>{ S.battleMode="history"; S.battleTypeFilter="all"; resetBattleTypePills(); stopBattlePolling(); loadBattles(true); updateBattleTabPills(); });
  E.battleRefreshBtn?.addEventListener("click",()=>loadBattles(true));
  injectBattleSearchBar();
  initBattleInfiniteScroll();
  E.closeBattleReport?.addEventListener("click", () => clearBattleDetail());
  E.battleReportModal?.addEventListener("click", e => { if (e.target === E.battleReportModal) clearBattleDetail(); });
  E.openBattlePageBtn?.addEventListener("click", () => { const id = E.openBattlePageBtn.dataset.battleId; if (id) window.open(`https://app.warera.io/battle/${id}`, "_blank"); });

  E.marketRefreshBtn?.addEventListener("click",()=>loadMarketFull(true));
  document.getElementById("marketOpenBtn")?.addEventListener("click", () => {window.open("https://app.warera.io/market", "_blank");});
  E.copyMarketReportBtn?.addEventListener("click", copyMarketReport);
  document.getElementById("captureMarketReportBtn")?.addEventListener("click", captureMarketReport);

  E.jobsRefreshBtn?.addEventListener("click",()=>loadJobs(true));
  E.copyJobsReportBtn?.addEventListener("click", copyJobsReport);
  document.getElementById("captureJobsReportBtn")?.addEventListener("click", captureJobsReport);
  E.copyJobsConcentrationBtn?.addEventListener("click", copyJobsConcentration);
  document.getElementById("captureJobsConcentrationBtn")?.addEventListener("click", captureJobsConcentration);
  initJobViews();
  E.copyRankingsReportBtn?.addEventListener("click", copyRankingsReport);
  document.getElementById("captureRankingsReportBtn")?.addEventListener("click", captureRankingsReport);
  E.rankingsRefreshBtn?.addEventListener("click", refreshRankings);
  E.copyPoliticsReportBtn?.addEventListener("click", copyPoliticsReport);
  document.getElementById("capturePoliticsReportBtn")?.addEventListener("click", capturePoliticsReport);
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
    prependWallCard("wallGrid", result.message); renderWallCount("wallCount"); updateWallLoadMore();
  });
  E.copyCommunityReportBtn?.addEventListener("click", copyCommunityReport);
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
    else if (ok?.success) { E.wallReadUpvoteCount.textContent = ok.upvotes; updateUpvoteDisplay("wallGrid", id, ok.upvotes); updateWallLoadMore(); }
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
        else if (ok?.success) { updateUpvoteDisplay("wallGrid", id, ok.upvotes); updateWallLoadMore(); }
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
    if (!E.readerModal?.classList.contains("hidden")) {
      if (navigateBack()) return;
      closeReaderNav();
      E.readerModal.classList.add("hidden");
      return;
    }
    hideToc();
    document.querySelectorAll(".overlay").forEach(m=>m.classList.add("hidden"));
  });

  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("#copyMarketReportBtn, #copyJobsReportBtn, #copyRankingsReportBtn, #copyBattleReportBtn, #copyPoliticsReportBtn, #copyJobsConcentrationBtn, #copyCommunityReportBtn, #copyAllLinksBtn, .ec-copy, .link-copy")) { playCopy(); return; }
    if (t.closest(".ac-read, .wall-read-btn")) { playRead(); return; }
    if (t.closest("button, a, .event-card, .battle-card, .wall-upvote-btn")) { playClick(); }
  });

  document.getElementById("articleLoadMini")?.addEventListener("click", () => { E.loadMoreArticlesBtn?.click(); });

  initRankings();
  initMarketView();
  initPolitics();
  initLibrary();
  initBookmarkButton();
  initTableMaker();

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

function initMobileUI() {
  const app = document.querySelector(".app");
  const menuBtn = document.getElementById("menuBtn");
  const backdrop = document.getElementById("sidebarBackdrop");
  const mq860 = window.matchMedia("(max-width: 860px)");
  const mq760 = window.matchMedia("(max-width: 760px)");

  // ── Sidebar off-canvas drawer ─────────────────────────
  const setDrawer = (open) => {
    app?.classList.toggle("sidebar-open", open);
    backdrop?.classList.toggle("show", open);
  };
  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setDrawer(!app?.classList.contains("sidebar-open"));
  });
  backdrop?.addEventListener("click", () => setDrawer(false));
  document.querySelectorAll(".side-btn[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => setDrawer(false));
  });
  document.querySelectorAll(".tab-bar [data-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  mq860.addEventListener("change", (e) => { if (!e.matches) setDrawer(false); });

  // ── Timeline Events/Articles single-pane toggle ──────
  const tlGrid = document.querySelector(".timeline-grid");
  const tlToggle = document.getElementById("timelineMobileToggle");
  const setTlView = (view) => {
    if (!tlGrid) return;
    if (view === "events" || view === "articles") {
      tlGrid.dataset.tlView = view;
      tlToggle?.querySelectorAll("[data-tl-view]").forEach(b =>
        b.classList.toggle("active", b.dataset.tlView === view));
    } else {
      delete tlGrid.dataset.tlView;
    }
  };
  tlToggle?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tl-view]");
    if (btn) setTlView(btn.dataset.tlView);
  });
  mq760.addEventListener("change", (e) => {
    if (e.matches) {
      if (!tlGrid?.dataset.tlView) setTlView("events");
      applyMarket();
      applyPolitics();
    } else {
      setTlView(null);
    }
  });
  if (mq760.matches) setTlView("events");

  // ── Market overview collapsible cells ─────────────────
  document.addEventListener("click", (e) => {
    const title = e.target.closest(".market-cell > .cell-title");
    if (!title) return;
    if (e.target.closest("button, input, select, a")) return;
    title.parentElement.classList.toggle("open");
  });
  const applyMarket = () => {
    document.querySelectorAll(".market-cell").forEach((c, i) => c.classList.toggle("open", i === 0));
  };
  if (mq760.matches) applyMarket();

  // ── Politics section accordions ───────────────────────
  document.addEventListener("click", (e) => {
    const title = e.target.closest(".pol-section > .pol-section-title");
    if (!title) return;
    if (e.target.closest("button")) return;
    title.parentElement.classList.toggle("closed");
  });
  const applyPolitics = () => {
    document.querySelectorAll(".pol-section").forEach(sec => {
      sec.classList.toggle("closed", !sec.classList.contains("pol-gov"));
    });
  };
  if (mq760.matches) applyPolitics();

  // ── Production accordions (Cost Studio / Worker Yield) ─
  document.addEventListener("click", (e) => {
    const head = e.target.closest(".prod-acc-head");
    if (!head) return;
    head.parentElement.classList.toggle("open");
  });

  // ── Rankings single / dual column toggle ─────────────
  const rkToggle = document.getElementById("rankingsViewToggle");
  rkToggle?.addEventListener("click", () => {
    const grid = document.getElementById("rankingsGrid");
    if (!grid) return;
    const single = grid.classList.toggle("single");
    rkToggle.innerHTML = `<iconify-icon icon="mdi:view-column" class="lu"></iconify-icon> ${single ? "Dual" : "Single"}`;
  });

  // ── Market view nav: icon-only labels on mobile ──────
  const marketNavIcons = {
    overview: "healthicons:market-stall",
    analytics: "icon-park-outline:market-analysis",
    predictions: "hugeicons:market-order",
    signals: "simple-icons:cardmarket",
    production: "carbon:cics-region-target",
  };
  const applyMarketNav = () => {
    const mobile = mq760.matches;
    document.querySelectorAll(".market-toolbar [data-market-view]").forEach(btn => {
      if (mobile) {
        if (btn.dataset._origHtml === undefined) {
          btn.dataset._origHtml = btn.innerHTML;
          btn.title = btn.title || btn.textContent.trim();
        }
        if (!btn.dataset._iconOnly) {
          btn.dataset._iconOnly = "1";
          btn.innerHTML = `<iconify-icon icon="${marketNavIcons[btn.dataset.marketView] || ""}" class="lu"></iconify-icon>`;
        }
      } else if (btn.dataset._iconOnly) {
        btn.innerHTML = btn.dataset._origHtml || "";
        delete btn.dataset._iconOnly;
        delete btn.dataset._origHtml;
      }
    });
  };
  applyMarketNav();
  mq760.addEventListener("change", applyMarketNav);

  // ── Report/action buttons: icon-only on mobile ────────
  // Copy Report / Capture Report in every tab header plus the Market
  // tab's Refresh and Go To Market. Desktop keeps icon + text.
  const iconOnlySelectors = [
    "#marketRefreshBtn", "#marketOpenBtn",
    "#copyMarketReportBtn", "#captureMarketReportBtn",
    "#copyJobsReportBtn", "#captureJobsReportBtn",
    "#copyPoliticsReportBtn", "#capturePoliticsReportBtn",
    "#copyRankingsReportBtn", "#captureRankingsReportBtn",
    "#copyCommunityReportBtn",
  ];
  const applyIconOnly = () => {
    const mobile = mq760.matches;
    iconOnlySelectors.forEach(sel => {
      const btn = document.querySelector(sel);
      if (!btn) return;
      if (mobile) {
        if (btn.dataset._origHtml === undefined) btn.dataset._origHtml = btn.innerHTML;
        const icon = btn.querySelector("iconify-icon");
        if (icon && !btn.dataset._iconOnly) {
          btn.dataset._iconOnly = "1";
          btn.title = btn.title || btn.textContent.trim();
          btn.innerHTML = icon.outerHTML;
        }
      } else if (btn.dataset._iconOnly) {
        btn.innerHTML = btn.dataset._origHtml || "";
        delete btn.dataset._iconOnly;
        delete btn.dataset._origHtml;
      }
    });
  };
  applyIconOnly();
  mq760.addEventListener("change", applyIconOnly);

  // ── Library search-mode toggles: icon-only on mobile ──
  const libSearchIcons = { keyword: "nonicons:keyword-16", author: "wordpress:post-author" };
  const applyLibSearchMode = () => {
    const mobile = mq760.matches;
    document.querySelectorAll("[data-lib-search]").forEach(btn => {
      if (mobile) {
        if (btn.dataset._origLabel === undefined) btn.dataset._origLabel = btn.textContent.trim();
        if (!btn.dataset._iconOnly) {
          btn.dataset._iconOnly = "1";
          btn.title = btn.dataset._origLabel;
          btn.innerHTML = `<iconify-icon icon="${libSearchIcons[btn.dataset.libSearch] || ""}" class="lu"></iconify-icon>`;
        }
      } else if (btn.dataset._iconOnly) {
        btn.innerHTML = btn.dataset._origLabel || "";
        delete btn.dataset._iconOnly;
        delete btn.dataset._origLabel;
      }
    });
  };
  applyLibSearchMode();
  mq760.addEventListener("change", applyLibSearchMode);

  // ── Rankings mobile: compact "Weekly" pill label ─────
  const weeklyPill = document.querySelector('[data-rank-cat="weekly"]');
  const applyRankingsMobile = () => {
    if (!weeklyPill) return;
    if (mq760.matches) {
      if (weeklyPill.dataset._origLabel === undefined) weeklyPill.dataset._origLabel = weeklyPill.textContent;
      weeklyPill.textContent = "Weekly";
    } else if (weeklyPill.dataset._origLabel !== undefined) {
      weeklyPill.textContent = weeklyPill.dataset._origLabel;
      delete weeklyPill.dataset._origLabel;
    }
  };
  applyRankingsMobile();
  mq760.addEventListener("change", applyRankingsMobile);

  // Expose helpers so renderers can re-apply mobile state after re-render.
  window.ndMobile = { applyMarket, applyPolitics };
}

function init() {
  E.apiKeyInput.value = localStorage.getItem(STORE.apiKey) || "";
  applyTheme(localStorage.getItem(STORE.theme) || "dark");
  applyTexture(localStorage.getItem(STORE.texture) === "1");

  populateEventTypes();
  injectJobsCountryFilter();
  bindAll();
  initMobileUI();

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

// PWA: register the service worker so the app can be installed and run offline.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
