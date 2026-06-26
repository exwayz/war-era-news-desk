import { S } from "./core/state.js";
import { E } from "./core/dom.js";
import { STORE } from "./core/storage.js";
import { apiKey } from "./core/api.js";
import { debounce, parseLocal, fmtDate } from "./core/utils.js";
import { initNixie } from "./visuals/clock.js";
import { captureHTML, ts } from "./core/captureReport.js";
import { initOsc } from "./visuals/oscilloscope.js";
import { initEcg } from "./visuals/ecg.js";
import { populateEventTypes } from "./timeline/filters.js";
import { loadEvents, startAutoRefresh, scheduleEventsRefresh, renderTimeline, handleEventAction } from "./timeline/timeline.js";
import { loadArticles, renderArticles, copyArticles } from "./timeline/articles.js";
import { switchTab, isTimelineOpen } from "./ui/tabs.js";
import { toggleTheme, applyTheme } from "./ui/theme.js";
import { toast, setStatus } from "./ui/toast.js";
import { evtData, evtTime, buildTitle, buildSummary } from "./timeline/events.js";
import { loadBattles, stopBattlePolling, updateBattleTabPills } from "./battles/battles.js";
import { injectBattleSearchBar } from "./battles/companies.js";
import { loadMarketFull, loadMarketStats, copyMarketReport, captureMarketReport, renderMarketOrders, initMarketView } from "./market/market.js";
import { loadJobs, renderJobs, copyJobsReport, captureJobsReport } from "./jobs/jobs.js";
import { initIntro } from "./intro/intro.js";
import { initRankings, copyRankingsReport, captureRankingsReport, refreshRankings } from "./rankings/rankings.js";
import { playClick, playRead, playCopy, playApiSaved, setSfxVolume, getSfxVolume } from "./audio/audio.js";
import { initWriterToolbar, initDraftLibrary, initImageLibrary, initMentions, initHelperApps, copyWriterHtml, updateWriterWordCount, updateAssistance } from "./writer/writer.js";
import { loadProfile, saveProfile, deleteProfile, isRegistered, formatProfileLink, resolveProfile } from "./user/profile.js";
import { POLICY_TEXT } from "./community/policy.js";
import { loadMessages, loadMoreMessages, postMessage, upvoteMessage, renderWallMessages, renderWallCount, getMessageById, hasMoreMessages } from "./community/wall.js";
import { highlightUserData } from "./core/profileHighlighter.js";

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

function toggleWriter() {
  document.body.classList.toggle("writer-open");
  const isOpen = document.body.classList.contains("writer-open");
  E.writerBtn.textContent = isOpen ? "← News" : "✍🏼 Writer";
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

  function openProfileModal() {
    const profile = loadProfile();
    if (profile) {
      E.profileRegisterView.classList.add("hidden");
      E.profileDisplayView.classList.remove("hidden");
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
      if (profile.partyName) detailsHtml += `<span class="profile-detail"><span class="profile-label">Party</span>${escHtml(profile.partyName)}</span>`;
      if (profile.subscribers != null) detailsHtml += `<span class="profile-detail"><span class="profile-label">▤</span>${escHtml(String(profile.subscribers))}</span>`;
      E.profileDisplay.innerHTML = `
        <div class="profile-avatar-wrap">${avatarHtml}</div>
        ${nameHtml}
        <div class="profile-details">${detailsHtml}</div>
      `;
    } else {
      E.profileRegisterView.classList.remove("hidden");
      E.profileDisplayView.classList.add("hidden");
      E.regUserInput.value = "";
      E.regProfileStatus.classList.add("hidden");
    }
    E.sfxVolumeSlider.value = Math.round(getSfxVolume() * 100);
    E.sfxVolumeValue.textContent = Math.round(getSfxVolume() * 100) + "%";
    E.settingsModal.classList.remove("hidden");
  }

  function updateProfileButton() {
    const p = loadProfile();
    if (p && p.avatarUrl) {
      E.settingsButton.innerHTML = `<img src="${p.avatarUrl}" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover">`;
      E.settingsButton.title = p.username || "Profile";
    } else if (p) {
      E.settingsButton.textContent = (p.username?.charAt(0) || "?").toUpperCase();
      E.settingsButton.title = p.username || "Profile";
    } else {
      E.settingsButton.textContent = "\u{1F464}";
      E.settingsButton.title = "Register Profile";
    }
  }

  E.settingsButton?.addEventListener("click", openProfileModal);
  updateProfileButton();
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
    if(key){ S.lookupsKey=""; loadEvents(true); loadArticles(true); startAutoRefresh(); loadMarketStats(); playApiSaved(); }
  });
  E.apiKeyModal.addEventListener("click",e=>{ if(e.target===E.apiKeyModal) E.apiKeyModal.classList.add("hidden"); });

  E.closeSettingsBtn?.addEventListener("click",()=>E.settingsModal.classList.add("hidden"));
  E.settingsModal?.addEventListener("click",e=>{ if(e.target===E.settingsModal) E.settingsModal.classList.add("hidden"); });
  E.sfxVolumeSlider?.addEventListener("input",()=>{
    const v = Number(E.sfxVolumeSlider.value);
    E.sfxVolumeValue.textContent = v + "%";
    setSfxVolume(v / 100);
  });

  E.resolveProfileBtn?.addEventListener("click",async ()=>{
    const input = E.regUserInput.value.trim();
    if (!input) { toast("Enter a user ID or profile URL."); return; }
    E.regProfileStatus.classList.remove("hidden");
    E.regProfileStatus.textContent = "Resolving...";
    E.regProfileStatus.className = "status-msg";
    const result = await resolveProfile(input, apiKey());
    if (result.error) {
      E.regProfileStatus.textContent = result.error;
      E.regProfileStatus.className = "status-msg error";
      return;
    }
    E.regProfileStatus.classList.add("hidden");
    updateProfileButton();
    toast("Profile saved.");
    openProfileModal();
    setTimeout(highlightUserData, 200);
  });

  E.deleteProfileBtn?.addEventListener("click",()=>{
    if (!confirm("Delete your profile and all stored data?")) return;
    deleteProfile();
    updateProfileButton();
    toast("Profile deleted.");
    openProfileModal();
  });

  E.applyFiltersBtn.addEventListener("click",()=>loadEvents(true));
  E.clearFiltersBtn.addEventListener("click",()=>{
    E.countryInput.value=""; E.eventTypeSelect.value="";
    E.startTimeInput.value=""; E.endTimeInput.value="";
    if (E.eventLimitInput) E.eventLimitInput.value="50";
    loadEvents(true);
  });
  E.loadMoreBtn.addEventListener("click",()=>loadEvents(false));
  E.countryInput.addEventListener("input", debounce(()=>scheduleEventsRefresh(),350));
  E.eventTypeSelect.addEventListener("change",()=>scheduleEventsRefresh());
  E.eventLimitInput?.addEventListener("change",()=>scheduleEventsRefresh());
  document.getElementById("eventLoadMini")?.addEventListener("click",()=>{ E.loadMoreBtn.click(); });
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
  E.startTimeInput.addEventListener("change", renderTimeline);
  E.endTimeInput.addEventListener("change", renderTimeline);
  E.eventList.addEventListener("click", handleEventAction);

  E.articleSearch.addEventListener("input", renderArticles);
  E.loadMoreArticlesBtn.addEventListener("click",()=>loadArticles(false));
  document.querySelectorAll(".article-filter-row [data-art-sort]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".article-filter-row [data-art-sort]").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      S.articleSort=btn.dataset.artSort;
      renderArticles();
    });
  });
  document.getElementById("articleTimeFrom")?.addEventListener("change",()=>{
    S.articleTimeFrom=document.getElementById("articleTimeFrom").value;
    renderArticles();
  });
  document.getElementById("articleTimeTo")?.addEventListener("change",()=>{
    S.articleTimeTo=document.getElementById("articleTimeTo").value;
    renderArticles();
  });
  document.getElementById("copyArticlesBtn")?.addEventListener("click",async()=>{
    playCopy();
    await copyArticles();
    toast("Articles copied.");
  });
  E.closeReader?.addEventListener("click",()=>E.readerModal.classList.add("hidden"));
  E.readerModal?.addEventListener("click",e=>{ if(e.target===E.readerModal) E.readerModal.classList.add("hidden"); });
  E.copyArticleBtn?.addEventListener("click",()=>{
    navigator.clipboard.writeText(E.readerContent.innerText||"").then(()=>toast("Article copied."));
  });

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
  document.getElementById("captureBattleReportBtn")?.addEventListener("click", () => {
    captureHTML(E.battleReportContent.innerHTML, "battle_report_"+ts()+".png");
  });

  E.marketRefreshBtn?.addEventListener("click",()=>loadMarketFull(true));
  E.marketOpenBtn?.addEventListener("click", () => {window.open(`https://app.warera.io/market`, "_blank");});
  E.copyMarketReportBtn?.addEventListener("click", copyMarketReport);
  document.getElementById("captureMarketReportBtn")?.addEventListener("click", captureMarketReport);

  E.jobsRefreshBtn?.addEventListener("click",()=>loadJobs(true));
  E.copyJobsReportBtn?.addEventListener("click", copyJobsReport);
  document.getElementById("captureJobsReportBtn")?.addEventListener("click", captureJobsReport);
  E.copyRankingsReportBtn?.addEventListener("click", copyRankingsReport);
  document.getElementById("captureRankingsReportBtn")?.addEventListener("click", captureRankingsReport);
  E.rankingsRefreshBtn?.addEventListener("click", refreshRankings);

  function updateWallLoadMore() {
    if (E.wallLoadMore) {
      E.wallLoadMore.hidden = !hasMoreMessages();
    }
  }

  E.wallPostBtn?.addEventListener("click",()=>{
    const profile = loadProfile();
    if (profile) E.wallAuthorInput.value = profile.username || "";
    E.wallMessageInput.value = "";
    E.wallCharCount.textContent = "0/500";
    E.wallPostModal.classList.remove("hidden");
    setTimeout(()=>E.wallMessageInput.focus(), 150);
  });
  E.wallCancelBtn?.addEventListener("click",()=>E.wallPostModal.classList.add("hidden"));
  E.wallPostModal?.addEventListener("click",e=>{ if(e.target===E.wallPostModal) E.wallPostModal.classList.add("hidden"); });
  E.wallMessageInput?.addEventListener("input",()=>{
    const len = E.wallMessageInput.value.length;
    E.wallCharCount.textContent = len + "/500";
  });
  E.wallPublishBtn?.addEventListener("click",async ()=>{
    const author = E.wallAuthorInput.value.trim();
    const text = E.wallMessageInput.value.trim();
    if (!author || !text) { toast("Please enter a name and message."); return; }
    const result = await postMessage(author, text);
    if (result.error) {
      toast(result.error);
      return;
    }
    E.wallPostModal.classList.add("hidden");
    toast("Message posted!");
    renderWallMessages("wallGrid");
    renderWallCount("wallCount");
    updateWallLoadMore();
  });
  E.wallPolicyBtn?.addEventListener("click",()=>{
    E.wallPolicyContent.innerHTML = POLICY_TEXT;
    E.wallPolicyModal.classList.remove("hidden");
  });
  E.wallPolicyClose?.addEventListener("click",()=>E.wallPolicyModal.classList.add("hidden"));
  E.wallPolicyModal?.addEventListener("click",e=>{ if(e.target===E.wallPolicyModal) E.wallPolicyModal.classList.add("hidden"); });
  E.wallReadClose?.addEventListener("click",()=>E.wallReadModal.classList.add("hidden"));
  E.wallReadModal?.addEventListener("click",e=>{ if(e.target===E.wallReadModal) E.wallReadModal.classList.add("hidden"); });
  E.wallReadUpvote?.addEventListener("click",async ()=>{
    const id = E.wallReadUpvote.dataset.wallId;
    if (!id) return;
    E.wallReadUpvote.disabled = true;
    const ok = await upvoteMessage(id);
    if (ok === "no-key") {
      toast("Save your API key first (Settings → API Key)");
    } else if (ok === "already") {
      toast("You already upvoted this message");
    } else if (ok) {
      const msg = getMessageById(id);
      if (msg) E.wallReadUpvoteCount.textContent = msg.upvotes;
      renderWallMessages("wallGrid");
      updateWallLoadMore();
    }
    E.wallReadUpvote.disabled = false;
  });

  document.querySelectorAll("[data-wall-sort]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll("[data-wall-sort]").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      S.wallSort = btn.dataset.wallSort;
      loadMessages(S.wallSort).then(result=>{
        renderWallMessages("wallGrid", result.messages);
        renderWallCount("wallCount");
        updateWallLoadMore();
      });
    });
  });

  E.wallGrid?.addEventListener("click",e=>{
    const readBtn = e.target.closest(".wall-read-btn");
    const upvoteBtn = e.target.closest(".wall-upvote-btn");
    if (readBtn) {
      const id = readBtn.dataset.id;
      const msg = getMessageById(id);
      if (!msg) return;
      E.wallReadAuthor.textContent = msg.author;
      E.wallReadTime.textContent = new Date(msg.created_at).toLocaleString();
      E.wallReadMessage.textContent = msg.text;
      E.wallReadUpvoteCount.textContent = msg.upvotes || 0;
      E.wallReadUpvote.dataset.wallId = id;
      E.wallReadModal.classList.remove("hidden");
      return;
    }
    if (upvoteBtn) {
      const id = upvoteBtn.dataset.id;
      upvoteBtn.disabled = true;
      upvoteMessage(id).then(ok=>{
        if (ok === "no-key") {
          toast("Save your API key first (Settings → API Key)");
        } else if (ok === "already") {
          toast("You already upvoted this message");
        } else if (ok) {
          renderWallMessages("wallGrid");
          updateWallLoadMore();
        }
        upvoteBtn.disabled = false;
      });
    }
  });
  E.wallLoadMore?.addEventListener("click",async ()=>{
    E.wallLoadMore.disabled = true;
    const result = await loadMoreMessages();
    if (result.loaded > 0) {
      renderWallMessages("wallGrid", result.messages);
      renderWallCount("wallCount");
    }
    updateWallLoadMore();
    E.wallLoadMore.disabled = false;
  });
  E.jobSearch?.addEventListener("input", renderJobs);
  E.loadMoreJobsBtn?.addEventListener("click",()=>loadJobs(false));

  E.writerBtn?.addEventListener("click", toggleWriter);
  E.copyWriterHtmlBtn?.addEventListener("click", copyWriterHtml);
  document.getElementById("assistToggle")?.addEventListener("change", updateAssistance);

  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape") return;
    E.apiKeyModal.classList.add("hidden");
    E.readerModal?.classList.add("hidden");
    E.battleReportModal?.classList.add("hidden");
    E.settingsModal?.classList.add("hidden");
    E.wallPostModal?.classList.add("hidden");
    E.wallPolicyModal?.classList.add("hidden");
    E.wallReadModal?.classList.add("hidden");
  });

  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("#copyMarketReportBtn, #copyJobsReportBtn, #copyRankingsReportBtn, #copyArticleBtn, #copyBattleReportBtn, .ec-copy")) {
      playCopy(); return;
    }
    if (t.closest(".ac-read, #openFullReportBtn, .wall-read-btn")) {
      playRead(); return;
    }
    if (t.closest("button, a, .event-card, .battle-card, .wall-upvote-btn, .wall-card, #wallPublishBtn, #wallCancelBtn, #resolveProfileBtn, #deleteProfileBtn")) {
      playClick();
    }
  });

  document.getElementById("articleLoadMini")?.addEventListener("click", () => { E.loadMoreArticlesBtn.click(); });

  const battleMini = document.getElementById("battleLoadMini");
  if (battleMini) { battleMini.addEventListener("click", () => { E.loadMoreBattlesBtn.click(); }); }

  initRankings();
  initMarketView();

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
  initWriterToolbar();
  initDraftLibrary();
  initImageLibrary();
  initMentions();
  initHelperApps();
  updateAssistance();
  isTimelineOpen();

  if (apiKey()) {
    bootData();
    setTimeout(highlightUserData, 500);
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
