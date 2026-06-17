/* =======================================================
   WAR ERA NEWS DESK — 
   Full rewrite: scroll fix, journalist summaries for all
   event types, battle detail XLS export, live damage bars,
   working jobs (company name + location + filter), market
   orders, and all journalist copy functions.
   ======================================================= */

const TRPC_BASE = "https://gateway.warerastats.io/trpc";

const EVENT_TYPES = [
"allianceBroken",
"allianceFormed",
"allianceMemberExcluded",
"allianceMemberJoined",
"allianceMemberLeft",
"bankruptcy",
"battleEnded",
"battleOpened",
"countryMoneyTransfer",
"defensivePactBroken",
"defensivePactFormed",
"depositDiscovered",
"financedRevolt",
"newPresident",
"peace_agreement",
"peaceMade",
"regionLiberated",
"regionTransfer",
"resistanceDecreased",
"resistanceIncreased",
"revolutionEnded",
"revolutionStarted",
"strategicResourcesReshuffled",
"systemRevolt",
"warDeclared",
];

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

// ─── STATE ────────────────────────────────────────────
const S = {
  cursor:null, events:[], articleCursor:null, articles:[],
  isLoading:false, lastFilters:{}, filterTimer:null,
  lookups:{
    countriesById:new Map(), countryIdsByName:new Map(),
    regionsById:new Map(), battlesById:new Map(),
    usersById:new Map(), companiesById:new Map(),
    alliancesById:new Map(),
  },
  lookupsKey:"",
  autoRefreshTimer:null,
  articleLimiter:0,
  battles:[], battleCursor:null, battleMode:"history",
  selectedBattleId:null,
  liveBattleTimer:null,
  battleSearch:"",
  market:{ econ:null, prices:null, orders:null, priceHistory:[], wageHistory:[] },
  jobs:[], jobCursor:null,
  jobCountryFilter:"",
  currentTab:"timeline",
};

const STORE = { apiKey:"wa-nd-apikey", theme:"wa-nd-theme" };

// ─── ELEMENTS ─────────────────────────────────────────
const E = {
  apiButton: document.getElementById("apiButton"),
  apiKeyModal: document.getElementById("apiKeyModal"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  clearApiKeyBtn: document.getElementById("clearApiKeyBtn"),
  saveApiKeyButton: document.getElementById("saveApiKeyButton"),
  themeButton: document.getElementById("themeButton"),
  refreshButton: document.getElementById("refreshButton"),
  statAvgWage: document.getElementById("statAvgWage"),
  statTotalWage: document.getElementById("statTotalWage"),
  statTradeVol: document.getElementById("statTradeVol"),
  statTopItem: document.getElementById("statTopItem"),
  nixieDate: document.getElementById("nixieDate"),
  nixieTime: document.getElementById("nixieTime"),
  tabBtns: document.querySelectorAll(".tab-btn"),
  tabPanels: document.querySelectorAll(".tab-panel"),
  countryInput: document.getElementById("countryInput"),
  countryOptions: document.getElementById("countryOptions"),
  eventTypeSelect: document.getElementById("eventTypeSelect"),
  startTimeInput: document.getElementById("startTimeInput"),
  endTimeInput: document.getElementById("endTimeInput"),
  applyFiltersBtn: document.getElementById("applyFiltersButton"),
  clearFiltersBtn: document.getElementById("clearFiltersButton"),
  feedMeta: document.getElementById("feedMeta"),
  statusBox: document.getElementById("statusBox"),
  eventList: document.getElementById("eventList"),
  loadMoreBtn: document.getElementById("loadMoreButton"),
  globalEventsTitle: document.getElementById("globalEventsTitle"),
  articleFeedMeta: document.getElementById("articleFeedMeta"),
  articleStatusBox: document.getElementById("articleStatusBox"),
  articleList: document.getElementById("articleList"),
  articleSearch: document.getElementById("articleSearch"),
  loadMoreArticlesBtn: document.getElementById("loadMoreArticlesButton"),
  readerModal: document.getElementById("articleReaderModal"),
  readerTitle: document.getElementById("readerTitle"),
  readerAuthor: document.getElementById("readerAuthor"),
  readerContent: document.getElementById("readerContent"),
  closeReader: document.getElementById("closeReader"),
  copyArticleBtn: document.getElementById("copyArticleBtn"),
  battleList: document.getElementById("battleList"),
  battleListStatus: document.getElementById("battleListStatus"),
  battleDetailPane: document.getElementById("battleDetailPane"),
  battleRefreshBtn: document.getElementById("battleRefreshBtn"),
  battleTabLive: document.getElementById("battleTabLive"),
  battleTabHistory: document.getElementById("battleTabHistory"),
  loadMoreBattlesBtn: document.getElementById("loadMoreBattlesButton"),
  battleReportModal: document.getElementById("battleReportModal"),
  battleReportTitle: document.getElementById("battleReportTitle"),
  battleReportMeta: document.getElementById("battleReportMeta"),
  battleReportContent: document.getElementById("battleReportContent"),
  copyBattleReportBtn: document.getElementById("copyBattleReportBtn"),
  closeBattleReport: document.getElementById("closeBattleReport"),
  marketRefreshBtn: document.getElementById("marketRefreshBtn"),
  copyMarketReportBtn: document.getElementById("copyMarketReportBtn"),
  marketEconStatus: document.getElementById("marketEconStatus"),
  marketEconData: document.getElementById("marketEconData"),
  marketPricesStatus: document.getElementById("marketPricesStatus"),
  marketPricesData: document.getElementById("marketPricesData"),
  marketOrdersStatus: document.getElementById("marketOrdersStatus"),
  marketOrdersData: document.getElementById("marketOrdersData"),
  jobsRefreshBtn: document.getElementById("jobsRefreshBtn"),
  copyJobsReportBtn: document.getElementById("copyJobsReportBtn"),
  jobsStatus: document.getElementById("jobsStatus"),
  jobsList: document.getElementById("jobsList"),
  jobSearch: document.getElementById("jobSearch"),
  loadMoreJobsBtn: document.getElementById("loadMoreJobsButton"),
  tplEvent: document.getElementById("eventCardTemplate"),
  tplArticle: document.getElementById("articleCardTemplate"),
  tplBattle: document.getElementById("battleCardTemplate"),
};

// ─── NIXIE CLOCK ──────────────────────────────────────
(function initNixie() {
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  function tick() {
    const now = new Date();
    const d = now.getDate().toString().padStart(2,"0");
    const mo = MONTHS[now.getMonth()];
    const y = now.getFullYear();
    const day = DAYS[now.getDay()];
    const h = now.getHours().toString().padStart(2,"0");
    const m = now.getMinutes().toString().padStart(2,"0");
    const s = now.getSeconds().toString().padStart(2,"0");
    if (E.nixieDate) E.nixieDate.textContent = `${day} ${d} ${mo} ${y}`;
    if (E.nixieTime) E.nixieTime.textContent = `${h}:${m}:${s}`;
  }
  tick();
  setInterval(tick, 1000);
})();

// ─── OSCILLOSCOPE ─────────────────────────────────────
(function initOsc() {
  const canvas = document.getElementById("oscilloscopeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;
  const waves = [
    { freq:0.004, amp:0.06, speed:0.012, phase:0,   lw:1.5, alpha:0.45 },
    { freq:0.007, amp:0.035,speed:0.02,  phase:1.2, lw:0.8, alpha:0.25 },
    { freq:0.0028,amp:0.08, speed:0.008, phase:2.5, lw:1.0, alpha:0.20 },
  ];
  function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
  function draw(ts) {
    requestAnimationFrame(draw);
    ctx.clearRect(0,0,W,H);
    const dark = document.documentElement.dataset.theme !== "light";
    const gc = dark ? "rgba(208,90,64,0.04)" : "rgba(163,59,40,0.03)";
    const lc = dark ? "rgba(208,90,64," : "rgba(163,59,40,";
    ctx.save(); ctx.strokeStyle = gc; ctx.lineWidth = 0.5;
    for (let i=1;i<24;i++){ ctx.beginPath();ctx.moveTo(W/24*i,0);ctx.lineTo(W/24*i,H);ctx.stroke(); }
    for (let i=1;i<14;i++){ ctx.beginPath();ctx.moveTo(0,H/14*i);ctx.lineTo(W,H/14*i);ctx.stroke(); }
    ctx.restore();
    const t = ts * 0.001;
    for (const w of waves) {
      const ph = w.phase + t * w.speed;
      ctx.beginPath(); ctx.save();
      ctx.strokeStyle = lc + w.alpha + ")"; ctx.lineWidth = w.lw;
      for (let x=0;x<=W;x+=2) {
        const a = x * w.freq + ph;
        const tri = (2/Math.PI)*Math.asin(Math.sin(a*Math.PI));
        const y = H/2 + (Math.sin(a)*0.3+tri*0.7)*w.amp*H;
        x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }
      ctx.stroke(); ctx.restore();
    }
  }
  resize(); addEventListener("resize", resize);
  if (!matchMedia("(prefers-reduced-motion:reduce)").matches) requestAnimationFrame(draw);
})();

// ─── ECG PULSE ────────────────────────────────────────
(function initEcg() {
  const wrap = document.getElementById("ecgWrap");
  if (!wrap) return;
  const canvas = document.createElement("canvas");
  canvas.id = "ecgCanvas";
  wrap.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let W=0, H=0;
  let drawPos = 0;
  let scanLine = [];
  let pulseQ = [];
  let lastAutoPulse = 0;
  const SPEED = 2.2;
  function resize() {
    W = canvas.width = wrap.offsetWidth || 220;
    H = canvas.height = wrap.offsetHeight || 46;
    scanLine = new Array(W).fill(H/2);
  }
  window.ecgPulse = function(intensity=1) {
    pulseQ.push({ intensity:Math.min(2,Math.max(0.3,intensity)), at:drawPos });
  };
  function getY(x) {
    let y = H/2;
    for (const p of pulseQ) {
      const dist = x - p.at;
      if (dist<0||dist>W*0.35) continue;
      const t = dist/(W*0.12);
      let sh=0;
      if      (t<0.15) sh=0;
      else if (t<0.25) sh= 0.15*Math.sin((t-0.15)/0.1*Math.PI);
      else if (t<0.35) sh=-0.08*Math.sin((t-0.25)/0.1*Math.PI);
      else if (t<0.45) sh= 1.0 *Math.sin((t-0.35)/0.1*Math.PI);
      else if (t<0.55) sh=-0.25*Math.sin((t-0.45)/0.1*Math.PI);
      else if (t<0.75) sh= 0.08*Math.sin((t-0.55)/0.2*Math.PI);
      y -= sh * p.intensity * (H*0.32);
    }
    return Math.max(2, Math.min(H-2, y));
  }
  function draw(ts) {
    requestAnimationFrame(draw);
    if (!W||!H) { resize(); return; }
    if (ts - lastAutoPulse > 5000) { window.ecgPulse(0.45); lastAutoPulse=ts; }
    for (let s=0;s<Math.ceil(SPEED);s++) {
      scanLine[Math.floor(drawPos)%W] = getY(drawPos); drawPos++;
    }
    pulseQ = pulseQ.filter(p=>drawPos-p.at<W*0.4);
    ctx.clearRect(0,0,W,H);
    const dark = document.documentElement.dataset.theme !== "light";
    const c = dark ? "rgba(208,90,64," : "rgba(163,59,40,";
    const head = Math.floor(drawPos)%W;
    ctx.save(); ctx.lineWidth=1.5; ctx.lineJoin="round";
    for (let x=head+2;x<W-1;x++) {
      const age=(W-(x-head))/W;
      ctx.strokeStyle=c+Math.max(0,(1-age)*0.55)+")";
      ctx.beginPath(); ctx.moveTo(x,scanLine[x]); ctx.lineTo(x+1,scanLine[(x+1)%W]); ctx.stroke();
    }
    for (let x=0;x<head-1;x++) {
      const age=(head-x)/W;
      ctx.strokeStyle=c+Math.max(0,(1-age*0.7)*0.8)+")";
      ctx.beginPath(); ctx.moveTo(x,scanLine[x]); ctx.lineTo(x+1,scanLine[x+1]); ctx.stroke();
    }
    const gy=scanLine[head];
    const gr=ctx.createRadialGradient(head,gy,0,head,gy,6);
    gr.addColorStop(0,c+"0.9)"); gr.addColorStop(1,c+"0)");
    ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(head,gy,6,0,Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.clearRect((head+1)%W,0,14,H);
  }
  setTimeout(()=>{ resize(); addEventListener("resize",()=>setTimeout(resize,100)); requestAnimationFrame(draw); },200);
})();

// ─── INIT ─────────────────────────────────────────────
function init() {
  E.apiKeyInput.value = localStorage.getItem(STORE.apiKey) || "";
  applyTheme(localStorage.getItem(STORE.theme) || "dark");
  populateEventTypes();
  injectJobsCountryFilter();
  bindAll();

  if (apiKey()) {
    E.globalEventsTitle.classList.add("live");
    loadEvents(true);
    loadArticles(true);
    startAutoRefresh();
    loadMarketStats();
  } else {
    E.apiButton.classList.add("needs-attention");
    setStatus("Enter your War Era API key to start the live feed.");
  }
}

const apiKey = () => E.apiKeyInput.value.trim() || localStorage.getItem(STORE.apiKey) || "";

// ─── INJECT JOB COUNTRY FILTER ─────────────────────────
function injectJobsCountryFilter() {
  const bar = document.querySelector(".jobs-search-bar");
  if (!bar) return;
  const wrap = document.createElement("div");
  wrap.className = "input-wrap";
  wrap.style.maxWidth = "240px";
  wrap.innerHTML = `<input id="jobCountryFilter" type="text" list="jobCountryOptions" placeholder="Filter by country…">
    <button class="clear-btn" data-clears="jobCountryFilter" type="button">✕</button>
    <datalist id="jobCountryOptions"></datalist>`;
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

// ─── INJECT BATTLE SEARCH BAR ──────────────────────────
function injectBattleSearchBar() {
  const col = document.querySelector(".battle-list-col");
  if (!col) return;
  const panelHead = col.querySelector(".panel-head");
  if (!panelHead) return;
  const wrap = document.createElement("div");
  wrap.className = "input-wrap search-bar";
  wrap.style.cssText = "margin:8px 0 4px;";
  wrap.innerHTML = `<input id="battleSearch" type="text" placeholder="Search by country or region…">
    <button class="clear-btn" id="clearBattleSearch" type="button">✕</button>`;
  panelHead.insertAdjacentElement("afterend", wrap);
  const inp = document.getElementById("battleSearch");
  const clr = document.getElementById("clearBattleSearch");
  inp.addEventListener("input", () => {
    S.battleSearch = inp.value.trim().toLowerCase();
    renderBattleList();
  });
  clr.addEventListener("click", () => {
    inp.value = "";
    S.battleSearch = "";
    renderBattleList();
    inp.focus();
  });
}


function bindAll() {
  document.querySelectorAll(".clear-btn[data-clears]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const el=document.getElementById(btn.dataset.clears);
      if(el){ el.value=""; el.dispatchEvent(new Event("input",{bubbles:true})); el.focus(); }
    });
  });

  E.clearApiKeyBtn?.addEventListener("click",()=>{ E.apiKeyInput.value=""; E.apiKeyInput.focus(); });

  E.tabBtns.forEach(btn=>{
    btn.addEventListener("click",()=>switchTab(btn.dataset.tab));
  });

  E.themeButton.addEventListener("click", toggleTheme);
  E.refreshButton.addEventListener("click",()=>{ loadEvents(true); loadArticles(true); });
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
    if(key){ S.lookupsKey=""; loadEvents(true); loadArticles(true); startAutoRefresh(); loadMarketStats(); }
  });
  E.apiKeyModal.addEventListener("click",e=>{ if(e.target===E.apiKeyModal) E.apiKeyModal.classList.add("hidden"); });

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

  E.marketRefreshBtn?.addEventListener("click",()=>loadMarketFull());
  E.copyMarketReportBtn?.addEventListener("click", copyMarketReport);

  E.jobsRefreshBtn?.addEventListener("click",()=>loadJobs(true));
  E.copyJobsReportBtn?.addEventListener("click", copyJobsReport);
  E.jobSearch?.addEventListener("input", renderJobs);
  E.loadMoreJobsBtn?.addEventListener("click",()=>loadJobs(false));

  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape") return;
    E.apiKeyModal.classList.add("hidden");
    E.readerModal?.classList.add("hidden");
    E.battleReportModal?.classList.add("hidden");
  });
}

function debounce(fn, ms) {
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); };
}

// ─── TAB SWITCHING ────────────────────────────────────
function switchTab(tab) {
  S.currentTab = tab;
  E.tabBtns.forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  E.tabPanels.forEach(p=>p.classList.toggle("active", p.id==="tab-"+tab));
  const k = apiKey();
  if (!k) return;
  if (tab==="battles" && S.battles.length===0) loadBattles(true);
  if (tab==="market" && !S.market.prices) loadMarketFull();
  if (tab==="jobs" && S.jobs.length===0) loadJobs(true);
}

function updateBattleTabPills() {
  E.battleTabLive?.classList.toggle("active", S.battleMode==="live");
  E.battleTabHistory?.classList.toggle("active", S.battleMode==="history");
}

// ─── THEME ────────────────────────────────────────────
function toggleTheme() { applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"); }
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(STORE.theme, t);
  E.themeButton.textContent = t==="dark" ? "Light" : "Dark";
}

// ─── EVENT TYPES ──────────────────────────────────────
function populateEventTypes() {
  const frag = document.createDocumentFragment();
  for (const et of EVENT_TYPES) {
    const o=document.createElement("option"); o.value=et; o.textContent=fmtType(et); frag.append(o);
  }
  E.eventTypeSelect.append(frag);
}

// ─── AUTO REFRESH ─────────────────────────────────────
function startAutoRefresh() {
  clearInterval(S.autoRefreshTimer);
  S.autoRefreshTimer = setInterval(()=>{
    if (S.isLoading || !apiKey()) return;
    silentRefreshEvents();
    if (S.articleLimiter < 10) { S.articleLimiter++; loadArticles(false); }
    else S.articleLimiter = 100;
  }, 5000);
}

async function silentRefreshEvents() {
  try {
    const result = await fetchTrpc("event.getEventsPaginated", {...S.lastFilters, limit:20}, apiKey());
    const fresh = normalizeEvents(result).filter(e=>!S.events.some(x=>(x._id||x.id)===(e._id||e.id)));
    if (!fresh.length) return;
    S.events = [...fresh, ...S.events];
    renderTimeline();
    S.articleLimiter = 0;
    window.ecgPulse?.(1.2);
  } catch {}
}

// ─── EVENTS — LOAD ────────────────────────────────────
function scheduleEventsRefresh() {
  clearTimeout(S.filterTimer);
  S.filterTimer = setTimeout(()=>loadEvents(true), 350);
}

function getFilters() {
  const cval = E.countryInput.value.trim();
  const cid = cval ? (OBJECT_ID_RE.test(cval) ? cval : (S.lookups.countryIdsByName.get(cval.trim().toLowerCase())||"")) : "";
  return {
    limit: 50,
    countryId: cid || undefined,
    eventTypes: E.eventTypeSelect.value ? [E.eventTypeSelect.value] : undefined,
  };
}

async function loadEvents(reset) {
  if (S.isLoading) return;
  const k = apiKey();
  if (!k) { setStatus("Enter your API key first.", "error"); return; }
  localStorage.setItem(STORE.apiKey, k);
  S.isLoading = true;
  setStatus(reset ? "Loading timeline…" : "Loading more…");
  E.applyFiltersBtn.disabled = E.loadMoreBtn.disabled = true;
  if (reset) { S.cursor=null; S.events=[]; E.eventList.textContent=""; }
  try {
    await ensureLookups(k);
    if (reset) S.lastFilters = getFilters();
    const result = await fetchTrpc("event.getEventsPaginated", {...S.lastFilters, cursor:reset?undefined:S.cursor}, k);
	const evts = normalizeEvents(result);
    S.cursor = normalizeCursor(result);
    S.events = reset ? evts : [...S.events, ...evts];
    await resolveBattles(evts, k);
    await resolveUsers(evts.map(e=>evtData(e).user).filter(Boolean), k);
    renderTimeline();
    window.ecgPulse?.(1.0);
  } catch (err) {
    console.error(err);
    setStatus(err.message||"Failed to load events.", "error");
  } finally {
    S.isLoading = false;
    E.applyFiltersBtn.disabled = E.loadMoreBtn.disabled = false;
  }
}

// ─── ARTICLES ─────────────────────────────────────────
async function loadArticles(reset=true) {
  const k = apiKey(); if (!k) return;
  if (reset) { S.articleCursor=null; S.articles=[]; }
  try {
    const result = await fetchTrpc("article.getArticlesPaginated", { type:"last", limit:100, cursor:reset?undefined:S.articleCursor }, k);
    const data = unwrap(result);
    const items = data?.items||[];
    await resolveUsers(items.map(a=>a.author).filter(Boolean), k);
    S.articleCursor = data?.nextCursor||null;
    S.articles = reset ? items : [...S.articles, ...items];
    clearArticleStatus();
    renderArticles();
  } catch (e) {
    setArticleStatus(e.message||"Could not load articles.", "error");
  }
}

// ─── BATTLES ──────────────────────────────────────────
function stopBattlePolling() {
  clearInterval(S.liveBattleTimer); S.liveBattleTimer=null;
}

async function loadBattles(reset=true) {
  const k = apiKey(); if (!k) return;
  stopBattlePolling();
  updateBattleTabPills();
  setBattleStatus("Loading battles…");
  if (reset) { S.battles=[]; S.battleCursor=null; E.battleList.innerHTML=""; }
  try {
    const payload = { limit:20, isActive: S.battleMode==="live", cursor:reset?undefined:S.battleCursor };
    const result = await fetchTrpc("battle.getBattles", payload, k);
    const data = unwrap(result);
    const battles = Array.isArray(data)?data:(data?.items||data?.battles||[]);
    S.battleCursor = data?.nextCursor||null;
    for (const b of battles) {
      const id=battleId(b); if(id) S.lookups.battlesById.set(id,b);
    }
    S.battles = reset ? battles : [...S.battles, ...battles];
    renderBattleList();
    clearBattleStatus();
  } catch (err) {
    setBattleStatus("Could not load battles: "+(err.message||""), "error");
  }
  E.loadMoreBattlesBtn.hidden = !S.battleCursor;
}

function renderBattleList() {
  E.battleList.innerHTML="";
  const kw = S.battleSearch||"";
  let list = S.battles;
  if (kw) {
    list = S.battles.filter(b => {
      const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId).toLowerCase();
      const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId).toLowerCase();
      const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region).toLowerCase();
      const title = (b.title||b.name||"").toLowerCase();
      return atk.includes(kw)||def.includes(kw)||reg.includes(kw)||title.includes(kw);
    });
  }
  if (!list.length) {
    E.battleList.innerHTML=`<p style="color:var(--ink-dim);padding:20px;text-align:center">${kw?"No battles match your search.":"No battles found."}</p>`;
    return;
  }
  const frag=document.createDocumentFragment();
  for (const b of list) frag.append(makeBattleCard(b));
  E.battleList.append(frag);
}

function makeBattleCard(battle) {
  const node = E.tplBattle.content.firstElementChild.cloneNode(true);
  const bid = battleId(battle);
  const isLive = !battle.endedAt || battle.isActive===true || battle.active===true;
  const atk = nameCountry(battle.attacker?.country||battle.attackerCountry||battle.attacker?.countryId);
  const def = nameCountry(battle.defender?.country||battle.defenderCountry||battle.defender?.countryId);
  const reg = nameRegion(battle.defender?.region||battle.defenderRegion||battle.region);

  node.querySelector(".bc-dot").classList.add(isLive?"live":"ended");
  node.querySelector(".bc-label").textContent = isLive ? "🔴 LIVE" : "✅ ENDED";

  const title = (atk&&def) ? `${atk} vs ${def}${reg?" — "+reg:""}` : (battle.title||battle.name||"Battle #"+(bid||"?").slice(-6));
  node.querySelector(".bc-title").textContent = title;

  let meta = (battle.createdAt||battle.startedAt) ? "Started: "+fmtDate(battle.createdAt||battle.startedAt) : "";
  if (battle.endedAt) meta += " · Ended: "+fmtDate(battle.endedAt);
  node.querySelector(".bc-meta").textContent = meta;

  const chips = node.querySelector(".bc-chips");
  const chipsData = [];
  if (battle.participants?.length||battle.participantCount) chipsData.push("👥 "+(battle.participants?.length||battle.participantCount||"?")+" fighters");
  if (battle.totalDamage||battle.damage) chipsData.push("⚔ "+fmtNum(battle.totalDamage||battle.damage)+" DMG");
  for (const txt of chipsData.slice(0,2)) {
    const c=document.createElement("span"); c.className="bc-chip"; c.textContent=txt; chips.append(c);
  }

  const btn = node.querySelector(".bc-select");
  btn.addEventListener("click", async()=>{
    S.selectedBattleId=bid;
    document.querySelectorAll(".battle-card").forEach(c=>c.classList.remove("selected"));
    node.classList.add("selected");
    stopBattlePolling();
    await loadBattleDetail(battle, bid, false);
    if (isLive) {
      S.liveBattleTimer = setInterval(async()=>{
        if (S.selectedBattleId===bid) { await loadBattleDetail(battle,bid,true); window.ecgPulse?.(0.7); }
      }, 8000);
    }
  });

  return node;
}

function getValue(r) {
  return Number(
    r?.value ??
    r?.damage ??
    r?.totalDamage ??
    0
  );
}

function getPoints(r) {
  return Number(
    r?.points ??
    r?.value ??
    0
  );
}

S.lookups.muById = new Map();

async function loadBattleDetail(battle, bid, silent=false) {
  const k = apiKey(); if(!k) return;
  if (!silent) E.battleDetailPane.innerHTML = `<div style="padding:24px;color:var(--ink-dim)">Loading intelligence report…</div>`;
  try {
    // Fetch merged side first, fall back to attacker+defender
    const [rUsrMerged, rMuMerged, rCtyMerged, rGpUsrAtk, rGpUsrDef, rGpMuAtk, rGpMuDef, rGpCtyAtk, rGpCtyDef, rOrdAtk, rOrdDef, rDetail] = await Promise.allSettled([
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"user",side:"merged"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"mu",side:"merged"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"country",side:"merged"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"points",type:"user",side:"attacker"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"points",type:"user",side:"defender"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"points",type:"mu",side:"attacker"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"points",type:"mu",side:"defender"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"points",type:"country",side:"attacker"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"points",type:"country",side:"defender"},k),
      fetchTrpc("battleOrder.getByBattle",{battleId:bid,side:"attacker"},k),
      fetchTrpc("battleOrder.getByBattle",{battleId:bid,side:"defender"},k),
      fetchTrpc("battle.getById",{battleId:bid},k),
    ]);

   const okArr = r => {

  if (r.status !== "fulfilled")
    return [];

  const raw = unwrap(r.value);

  if (Array.isArray(raw))
    return raw;

  if (raw && Array.isArray(raw.items))
    return raw.items;

  if (raw && typeof raw === "object") {

    const merged = [];

    if (Array.isArray(raw.attacker))
      raw.attacker.forEach(x =>
        merged.push({...x,_side:"attacker"})
      );

    if (Array.isArray(raw.defender))
      raw.defender.forEach(x =>
        merged.push({...x,_side:"defender"})
      );

    if (merged.length)
      return merged;
  }

  return [];
};

    const [rUsrAtk, rUsrDef] = await Promise.allSettled([
	
  fetchTrpc(
    "battleRanking.getRanking",
    {
      battleId: bid,
      dataType: "damage",
      type: "user",
      side: "attacker"
    },
    k
  ),
  fetchTrpc(
    "battleRanking.getRanking",
    {
      battleId: bid,
      dataType: "damage",
      type: "user",
      side: "defender"
    },
    k
  )
]);

let atkParticipantCount =
  unwrap(rUsrAtk.value)?.itemCount || 0;

let defParticipantCount =
  unwrap(rUsrDef.value)?.itemCount || 0;
  
	let totalParticipants =
  atkParticipantCount +
  defParticipantCount;
  


const allUsers = [
  ...okArr(rUsrAtk).map(r => ({
    ...r,
    _side: "attacker"
  })),
  ...okArr(rUsrDef).map(r => ({
    ...r,
    _side: "defender"
  }))
];

    const [rMuAtk, rMuDef] = await Promise.allSettled([
  fetchTrpc(
    "battleRanking.getRanking",
    {
      battleId: bid,
      dataType: "damage",
      type: "mu",
      side: "attacker"
    },
    k
  ),
  fetchTrpc(
    "battleRanking.getRanking",
    {
      battleId: bid,
      dataType: "damage",
      type: "mu",
      side: "defender"
    },
    k
  )
]);

const allMu = [
  ...okArr(rMuAtk).map(r => ({
    ...r,
    _side: "attacker"
  })),
  ...okArr(rMuDef).map(r => ({
    ...r,
    _side: "defender"
  }))
];


    const [rCtyAtk, rCtyDef] = await Promise.allSettled([
  fetchTrpc(
    "battleRanking.getRanking",
    {
      battleId: bid,
      dataType: "damage",
      type: "country",
      side: "attacker"
    },
    k
  ),
  fetchTrpc(
    "battleRanking.getRanking",
    {
      battleId: bid,
      dataType: "damage",
      type: "country",
      side: "defender"
    },
    k
  )
]);

const allCountry = [
  ...okArr(rCtyAtk).map(r => ({
    ...r,
    _side: "attacker"
  })),
  ...okArr(rCtyDef).map(r => ({
    ...r,
    _side: "defender"
  }))
];

    if (!allUsers.length) {
      const [rUsrAtk, rUsrDef] = await Promise.allSettled([
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"user",side:"attacker"},k),
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"user",side:"defender"},k),
      ]);
      allUsers = [
        ...okArr(rUsrAtk).map(r=>({...r,_side:"attacker"})),
        ...okArr(rUsrDef).map(r=>({...r,_side:"defender"})),
      ];
    }
    if (!allMu.length) {
      const [rMuAtk, rMuDef] = await Promise.allSettled([
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"mu",side:"attacker"},k),
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"mu",side:"defender"},k),
      ]);
      allMu = [...okArr(rMuAtk).map(r=>({...r,_side:"attacker"})),...okArr(rMuDef).map(r=>({...r,_side:"defender"}))];
    }
    if (!allCountry.length) {
      const [rCtyAtk, rCtyDef] = await Promise.allSettled([
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"country",side:"attacker"},k),
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"country",side:"defender"},k),
      ]);
      allCountry = [...okArr(rCtyAtk).map(r=>({...r,_side:"attacker"})),...okArr(rCtyDef).map(r=>({...r,_side:"defender"}))];
    }

    // GP rankings
    const gpUsers = [
      ...okArr(rGpUsrAtk).map(r=>({...r,_side:"attacker"})),
      ...okArr(rGpUsrDef).map(r=>({...r,_side:"defender"})),
    ];

    const gpMu = [
      ...okArr(rGpMuAtk).map(r=>({...r,_side:"attacker"})),
      ...okArr(rGpMuDef).map(r=>({...r,_side:"defender"})),
    ];
    const gpCountry = [
      ...okArr(rGpCtyAtk).map(r=>({...r,_side:"attacker"})),
      ...okArr(rGpCtyDef).map(r=>({...r,_side:"defender"})),
    ];

    const ordersAtk = okArr(rOrdAtk).map(o=>({...o,_side:"attacker"}));
    const ordersDef = okArr(rOrdDef).map(o=>({...o,_side:"defender"}));
    const allOrders = [...ordersAtk,...ordersDef];
    const bdDetail  = rDetail.status==="fulfilled" ? (unwrap(rDetail.value)||battle) : battle;
	
	

    const unknownUsers = [...new Set([
      ...allUsers.map(r=>r.userId||r.user),
      ...gpUsers.map(r=>r.userId||r.user),
	  ...allOrders.map(o => o.user || o.userId || o.issuedBy),
    ].filter(id=>id&&!S.lookups.usersById.has(id)))];
    if (unknownUsers.length) await Promise.all(unknownUsers.map(async uid=>{
      try {
        const r=await fetchTrpc("user.getUserLite",{userId:uid},k);
        const u=unwrap(r); if(u) S.lookups.usersById.set(uid,u);
      } catch {}
    }));
	
	const unknownMu = [...new Set([
  ...allMu.map(r => r.muId || r.mu),
  ...gpMu.map(r => r.muId || r.mu),
  ...allOrders.map(o => o.mu),
].filter(id => id && !S.lookups.muById.has(id)))];

if (unknownMu.length) {
  await Promise.all(
    unknownMu.map(async mid => {
      try {
        const res = await fetchTrpc(
          "mu.getById",
          { muId: mid },
          k
        );

        const mu = unwrap(res);

        if (mu) {
          S.lookups.muById.set(mid, mu);
        }
      } catch {}
    })
  );
}
console.log("details", bdDetail);
console.log("User GP", gpUsers);

    // ── FETCH ROUND DATA ──────────────────────────────
    // Collect all round IDs from the battle detail
    const allRoundIds = [
      ...(Array.isArray(bdDetail.rounds) ? bdDetail.rounds : []),
      ...(Array.isArray(bdDetail.roundsHistory) ? bdDetail.roundsHistory : []),
    ].filter(Boolean);
	console.log("all rounds ID". allRoundIds);

    // currentRound may be a string ID or object
    const currentRoundId = typeof bdDetail.currentRound === "string"
      ? bdDetail.currentRound
      : bdDetail.currentRound?._id || bdDetail.currentRound?.id || "";
	console.log("current rounds ID". currentRoundId);

    // Merge all unique round IDs (history first, then current active)
    const uniqueRoundIds = [...new Set([...allRoundIds, currentRoundId].filter(Boolean))];

    // Fetch each round's data in parallel
    const roundsData = (await Promise.allSettled(
  uniqueRoundIds.map(rid =>
    fetchTrpc("round.getById", { roundId: rid }, k)
  )
))
.map((res, i) => {
  const rid = uniqueRoundIds[i];

  if (res.status !== "fulfilled") return null;

  const rd = unwrap(res.value);

  return {
    ...rd,
    _id: rd._id || rd.id || rid,
    _isCurrent: rid === currentRoundId,

    pointsAttacker: rd.attacker?.points ?? 0,
    pointsDefender: rd.defender?.points ?? 0
  };
})
.filter(Boolean);
	


    // Fetch per-round GP rankings for attacker and defender countries (points by country)
    // We need the main attacker/defender country GP per round
    const atkCountryId = bdDetail.attacker?.country || bdDetail.attackerCountry || "";
    const defCountryId = bdDetail.defender?.country || bdDetail.defenderCountry || "";

    // For each round, fetch country GP rankings to get attacker/defender points
    const roundGpData = {};
    if (roundsData.length && (atkCountryId || defCountryId)) {
      await Promise.all(roundsData.map(async rd => {
        const roundId = rd._id;
        try {
          const [rGpAtkR, rGpDefR] = await Promise.allSettled([
            fetchTrpc("battleRanking.getRanking", { battleId: bid, roundId, dataType: "points", type: "country", side: "attacker" }, k),
            fetchTrpc("battleRanking.getRanking", { battleId: bid, roundId, dataType: "points", type: "country", side: "defender" }, k),
          ]);
          const atkCountries = okArr(rGpAtkR);
          const defCountries = okArr(rGpDefR);
          const atkEntry = atkCountries.find(r => (r.countryId||r.country) === atkCountryId) || atkCountries[0];
          const defEntry = defCountries.find(r => (r.countryId||r.country) === defCountryId) || defCountries[0];
          roundGpData[roundId] = {
            atkGp: atkEntry ? getPoints(atkEntry) : 0,
            defGp: defEntry ? getPoints(defEntry) : 0,
          };
        } catch { roundGpData[rd._id] = { atkGp: 0, defGp: 0 }; }
      }));
    }
	console.log("round data". roundsData);
	console.log("rounds GP", roundGpData);

    renderBattleDetail(bdDetail, bid, allUsers, allMu, allCountry, gpUsers, gpMu, gpCountry, allOrders, atkParticipantCount, defParticipantCount, roundsData, roundGpData);
  } catch (err) {
    if (!silent) E.battleDetailPane.innerHTML = `<div class="status-msg error">${err.message||"Failed to load battle detail"}</div>`;
  }
}

function getItemCount(result) {

  if (result.status !== "fulfilled")
    return 0;

  const raw = unwrap(result.value);

  return Number(raw?.itemCount || 0);

}

function nameMu(id) {
  if (!id) return "";

  const mu = S.lookups.muById.get(id);

  if (!mu) return "";

  return (
    mu.name ??
    mu.muName ??
    mu.displayName ??
    mu.fullName ??
    ""
  );
}

function orderIssuer(o) {

  if (o.mu) {
    return (
      nameMu(o.mu) ||
      `MU ${String(o.mu).slice(-6)}`
    );
  }

  if (o.country) {
    return (
      nameCountry(o.country) ||
      "Unknown Country"
    );
  }

  if (o.user) {
    return (
      nameUser(o.user) ||
      "Unknown User"
    );
  }

  return "Unknown";
}

function renderBattleDetail(b, bid, rankUsers, rankMu, rankCountry, gpUsers, gpMu, gpCountry, orders, atkPar, defPar, roundsData, roundGpData) {
  const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId);
  const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId);
  const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region);
  const isLive = !b.endedAt || b.isActive===true || b.active===true;
  const started = b.createdAt||b.startedAt||"";
  const ended = b.endedAt||"";
  const winner = b.winner||(b.wonBy==="attacker"?atk:b.wonBy==="defender"?def:null);

let atkDmg = rankUsers
  .filter(r => r._side === "attacker")
  .reduce((s, r) => s + getValue(r), 0);

let defDmg = rankUsers
  .filter(r => r._side === "defender")
  .reduce((s, r) => s + getValue(r), 0);
  
  let totalDmg = atkDmg+defDmg||b.totalDamage||b.damage||0;
let atkGp = gpUsers
  .filter(r => r._side === "attacker")
  .reduce((s, r) => s + getPoints(r), 0);

let defGp = gpUsers
  .filter(r => r._side === "defender")
  .reduce((s, r) => s + getPoints(r), 0);

  let participantsA = atkPar || b.atkPar || 0;
  let participantsD = defPar || b.defPar || 0;
  let participantsT = participantsA+participantsD;

  // ── Round score from battle data ──────────────────
  // b.attacker.wonRoundsCount / b.defender.wonRoundsCount
  const atkRoundsWon = Number(b.attacker?.wonRoundsCount ?? b.attackerRoundsWon ?? 0);
  const defRoundsWon = Number(b.defender?.wonRoundsCount ?? b.defenderRoundsWon ?? 0);
  const roundsToWin  = Number(b.roundsToWin ?? 2);

  let atkPct = totalDmg>0 ? Math.round((atkDmg/totalDmg)*100) : 50;
  let defPct = 100-atkPct;

  let narrative = "";
  if (isLive) {
    narrative = `Active combat ongoing: <strong>${atk||"Attacker"}</strong> vs <strong>${def||"Defender"}</strong>${reg?" in "+reg:""}. Damage split: ${atkPct}% vs ${defPct}%.`;
  } else {
    narrative = winner
      ? `<strong>${winner}</strong> secured victory${reg?" at "+reg:""}. Total damage: ${fmtNum(totalDmg)}. ${participantsT} fighters participated.`
      : `Battle concluded${reg?" at "+reg:""}. Total damage: ${fmtNum(totalDmg)}.`;
  }

  const liveTag = isLive ? ` <span style="color:var(--red);font-size:.68rem;animation:livePulse 1.5s infinite;display:inline-block">● LIVE</span>` : "";

  // ── Build round tabs ──────────────────────────────
  const rounds = roundsData || [];
  // Sort rounds by creation time so Round 1 is first
  const sortedRounds = [...rounds].sort((a,b) => {
    const ta = new Date(a.createdAt||a.startedAt||0).getTime();
    const tb = new Date(b.createdAt||b.startedAt||0).getTime();
    return ta - tb;
  });
  
  // Build round nav tabs HTML
  const roundTabsHtml = sortedRounds.length > 0 ? `
  <div class="br-round-tabs" id="brRoundTabs_${bid}" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px;">
    ${sortedRounds.map((rd,i)=>{
      const isActive = rd.isActive===true || rd._isCurrent===true || !rd.endedAt;
      const rdWinner = rd.wonBy === "attacker" ? (atk||"ATK") : rd.wonBy === "defender" ? (def||"DEF") : null;
      const badge = isActive ? `<span style="color:var(--red);font-size:.6rem;margin-left:3px">●</span>` : rdWinner ? `<span style="font-size:.6rem;margin-left:3px">🏆</span>` : "";
      return `<button class="pill-btn${i===sortedRounds.length-1?" active":""}" data-round-idx="${i}" data-round-tab-bid="${bid}" style="font-size:.72rem">Round ${i+1}${badge}</button>`;
    }).join("")}
    <button class="pill-btn active" data-round-idx="overall" data-round-tab-bid="${bid}" style="font-size:.72rem">Overall</button>
  </div>` : "";

const roundsByNumber = Object.fromEntries(
  roundsData.map(r => [Number(r.number), r])
);

const round1 = roundsByNumber?.[1];
const round2 = roundsByNumber?.[2];

  // Build per-round GP progress bar section
function buildRoundGpBar(rd, roundIdx) {
  if (!rd) return "";

  // -----------------------------
  // SAFE EXTRACTION (LIVE SAFE)
  // -----------------------------
  const atkPts = rd?.pointsAttacker ?? rd?.attacker?.points ?? 0;
  const defPts = rd?.pointsDefender ?? rd?.defender?.points ?? 0;

  const MAX_GP = 300;

  const safeAtk = Math.min(atkPts, MAX_GP);
  const safeDef = Math.min(defPts, MAX_GP);

  const atkBarPct = Math.round((safeAtk / MAX_GP) * 50);
  const defBarPct = Math.round((safeDef / MAX_GP) * 50);

  // -----------------------------
  // WINNER LOGIC (FIXED)
  // -----------------------------
  const rdWinner =
    rd?.wonBy === "attacker"
      ? (atk || "Attacker")
      : rd?.wonBy === "defender"
      ? (def || "Defender")
      : null;

  // -----------------------------
  // STATE DETECTION (LIVE SAFE)
  // -----------------------------
  const isRoundActive =
    rd?.isActive === true ||
    rd?._isCurrent === true ||
    !rd?.endedAt;

  const rdStatus = isRoundActive
    ? `<span style="color:var(--red);font-size:.72rem">🔴 Active</span>`
    : rdWinner
    ? `<span style="color:var(--green);font-size:.72rem">🏆 Won by ${rdWinner}</span>`
    : `<span style="color:var(--ink-dim);font-size:.72rem">Ended</span>`;

  // -----------------------------
  // RENDER
  // -----------------------------
  return `
  <div class="br-section" style="margin-bottom:14px">

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:.78rem;font-weight:800;color:var(--ink-dim);text-transform:uppercase;letter-spacing:.06em">
        Round ${roundIdx + 1} Ground Points
      </span>
      ${rdStatus}
    </div>

    <div style="display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:5px">
      <span style="color:var(--blue);font-weight:800">
        ${atk || "Attacker"} <strong>${fmtNum(atkPts)}</strong> pts
      </span>

      <span style="color:var(--ink-dim);font-size:.68rem">First to 300 wins</span>

      <span style="color:var(--red);font-weight:800">
        <strong>${fmtNum(defPts)}</strong> pts ${def || "Defender"}
      </span>
    </div>

    <div style="position:relative;height:16px;background:var(--line-solid);border-radius:8px;overflow:hidden;display:flex;align-items:center;">

      <div style="
        position:absolute;
        left:0;
        top:0;
        bottom:0;
        width:${atkBarPct}%;
        background:var(--blue);
        border-radius:8px 0 0 8px;
        transition:width .5s ease;
      "></div>

      <div style="
        position:absolute;
        right:0;
        top:0;
        bottom:0;
        width:${defBarPct}%;
        background:var(--red);
        border-radius:0 8px 8px 0;
        transition:width .5s ease;
      "></div>

      <div style="
        position:absolute;
        left:50%;
        top:10%;
        bottom:10%;
        width:2px;
        background:var(--ink-dim);
        opacity:.4;
        transform:translateX(-50%);
      "></div>

    </div>

    <div style="display:flex;justify-content:space-between;font-size:.64rem;color:var(--ink-dim);margin-top:3px">
      <span>0</span>
      <span style="position:relative;left:-4px">150</span>
      <span>300</span>
    </div>

  </div>`;
}

  // Build battle score display (rounds won)
  const battleScoreHtml = `
  <div style="display:flex;justify-content:center;align-items:center;gap:16px;padding:12px;background:var(--surface-hi);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:12px">
    <div style="text-align:center">
      <div style="font-size:2rem;font-weight:900;color:var(--blue);line-height:1">${atkRoundsWon}</div>
      <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;color:var(--ink-dim);margin-top:2px">${atk||"Attacker"}</div>
    </div>
    <div style="text-align:center;color:var(--ink-dim)">
      <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Battle Score</div>
      <div style="font-size:.66rem;margin-top:2px">First to ${roundsToWin} rounds wins</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:2rem;font-weight:900;color:var(--red);line-height:1">${defRoundsWon}</div>
      <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;color:var(--ink-dim);margin-top:2px">${def||"Defender"}</div>
    </div>
  </div>`;

  let html = `
  <div class="br-section">
    <h3 class="br-section-title">Battle Overview${liveTag}</h3>
    ${roundTabsHtml}
    <div class="br-narrative">${narrative}</div>`;

  // Battle score (rounds won) always shown
  html += battleScoreHtml;

  // Per-round GP bars — shown for each round section (will be toggled by JS)
  if (sortedRounds.length > 0) {
    html += `<div id="brRoundGpBars_${bid}">`;
    sortedRounds.forEach((rd, i) => {
      // Default: show only the last (most recent/current) round
      const defaultShow = i === sortedRounds.length - 1;
      html += `<div class="br-round-section" data-round-section="${i}" data-round-bid="${bid}" style="display:${defaultShow?"block":"none"}">${buildRoundGpBar(rd, i)}</div>`;
    });
    // Overall: hidden by default since we show last round first, but toggled
    html += `<div class="br-round-section" data-round-section="overall" data-round-bid="${bid}" style="display:none"></div>`;
    html += `</div>`;
  }

  html += `
    <div class="score-bar-wrap" style="margin-top:8px">
      <div class="score-bar-labels">
        <span style="color:var(--blue);font-weight:800">${atk||"Attacker"} ${atkPct}%</span>
        <span style="color:var(--ink-dim);font-size:.72rem">DAMAGE SHARE</span>
        <span style="color:var(--red);font-weight:800">${defPct}% ${def||"Defender"}</span>
      </div>
      <div class="score-bar" style="display:flex; width:100%; height:10px; overflow:hidden; border-radius:6px;">
  <div style="width:${atkPct}%; background:var(--blue);"></div>
  <div style="width:${defPct}%; background:var(--red);"></div>
</div>
    </div>`;

  html+=`
    <div class="br-stats-grid">
	  ${atk?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.85rem">${atk}</span><span class="br-stat-lbl">Attacker</span></div>`:""}
      <div class="br-stat-box"><span class="br-stat-val">${participantsA||"—"}</span><span class="br-stat-lbl"> Attacker Participants</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${totalDmg?fmtNum(totalDmg):"—"}</span><span class="br-stat-lbl">Total Damage</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${isLive?"🔴 Live":"✅ Ended"}</span><span class="br-stat-lbl">Status</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${(atkGp+defGp)?fmtNum(atkGp+defGp):"—"}</span><span class="br-stat-lbl">Ground Points</span></div>
	  <div class="br-stat-box"><span class="br-stat-val">${participantsD||"—"}</span><span class="br-stat-lbl">Defender Participants</span></div>
      ${def?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.85rem">${def}</span><span class="br-stat-lbl">Defender</span></div>`:""}
      ${reg?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.82rem">${reg}</span><span class="br-stat-lbl">Region</span></div>`:""}
      ${started?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.72rem">${fmtDate(started)}</span><span class="br-stat-lbl">Started</span></div>`:""}
      ${ended?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.72rem">${fmtDate(ended)}</span><span class="br-stat-lbl">Ended</span></div>`:""}
      ${winner?`<div class="br-stat-box" style="border-color:var(--green)"><span class="br-stat-val">🏆 ${winner}</span><span class="br-stat-lbl">Winner</span></div>`:""}
    </div>
  </div>`;
  
  const atkRank = rankUsers
  .filter(r => r._side === "attacker")
  .sort((a,b) => getValue(b) - getValue(a))
  .slice(0,10);

const defRank = rankUsers
  .filter(r => r._side === "defender")
  .sort((a,b) => getValue(b) - getValue(a))
  .slice(0,10);

const maxRows = Math.max(atkRank.length, defRank.length);

  // Top 10 by damage — users
  if (rankUsers.length) {
    const sorted = [...rankUsers]
  .sort((a, b) => getValue(b) - getValue(a))
  .slice(0, 10);
    html+=`
  <div class="br-section">
    <h3 class="br-section-title">⚔ Top 10 Fighters by Damage</h3>
    <table class="rank-table">
      <thead>

<tr>
  <th colspan="3" style="color:var(--blue)">
    ATTACKER
  </th>

  <th colspan="3" style="color:var(--red)">
    DEFENDER
  </th>
</tr>

<tr>
  <th>#</th>
  <th>Fighter</th>
  <th>Damage</th>

  <th>#</th>
  <th>Fighter</th>
  <th>Damage</th>
</tr>

</thead>
      <tbody>
${Array.from({length:maxRows},(_,i)=>{

  const a = atkRank[i];
  const d = defRank[i];

  const atkHtml = a ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${nameUser(a.userId||a.user)||a.username||"Unknown"}</td>
    <td>${fmtNum(getValue(a))}</td>
  ` : `<td></td><td></td><td></td>`;

  const defHtml = d ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${nameUser(d.userId||d.user)||d.username||"Unknown"}</td>
    <td>${fmtNum(getValue(d))}</td>
  ` : `<td></td><td></td><td></td>`;

  return `<tr>${atkHtml}${defHtml}</tr>`;
}).join("")}
</tbody>
    </table>
  </div>`;
  }

  // Top 10 by GP — users
  
  const atkRankGP = gpUsers
  .filter(r => r._side === "attacker")
  .sort((a,b)=>getPoints(b)-getPoints(a))
  .slice(0,10);

const defRankGP = gpUsers
  .filter(r => r._side === "defender")
  .sort((a,b)=>getPoints(b)-getPoints(a))
  .slice(0,10);
  
  if (gpUsers.length) {
    const sorted = [...gpUsers]
  .sort((a, b) => getPoints(b) - getPoints(a))
  .slice(0, 10);
    html+=`
  <div class="br-section">
    <h3 class="br-section-title">🏴 Top 10 Fighters by Ground Points</h3>
    <table class="rank-table">
     <thead>

<tr>
  <th colspan="3" style="color:var(--blue)">
    ATTACKER
  </th>

  <th colspan="3" style="color:var(--red)">
    DEFENDER
  </th>
</tr>

<tr>
  <th>#</th>
  <th>Fighter</th>
  <th>Ground Points</th>

  <th>#</th>
  <th>Fighter</th>
  <th>Ground Points</th>
</tr>

</thead>
      <tbody>
${Array.from({length:maxRows},(_,i)=>{

  const a = atkRankGP[i];
  const d = defRankGP[i];

  const atkHtml = a ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${nameUser(a.userId||a.user)||a.username||"Unknown"}</td>
    <td>${fmtNum(getPoints(a))}</td>
  ` : `<td></td><td></td><td></td>`;

  const defHtml = d ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${nameUser(d.userId||d.user)||d.username||"Unknown"}</td>
    <td>${fmtNum(getPoints(d))}</td>
  ` : `<td></td><td></td><td></td>`;

  return `<tr>${atkHtml}${defHtml}</tr>`;
}).join("")}
</tbody>
    </table>
  </div>`;
  }

  // Top 10 MU by damage
if (rankMu.length) {

  const atkRankMu = rankMu
    .filter(r => r._side === "attacker")
    .sort((a,b) => getValue(b) - getValue(a))
    .slice(0,10);

  const defRankMu = rankMu
    .filter(r => r._side === "defender")
    .sort((a,b) => getValue(b) - getValue(a))
    .slice(0,10);

  const maxRowsMu =
    Math.max(atkRankMu.length, defRankMu.length);

  html += `
<div class="br-section">
  <h3 class="br-section-title">
    🎖 Top 10 Military Units by Damage
  </h3>

  <table class="rank-table">

    <thead>

      <tr>
        <th colspan="3" style="color:var(--blue)">
          ATTACKER
        </th>

        <th colspan="3" style="color:var(--red)">
          DEFENDER
        </th>
      </tr>

      <tr>
        <th>#</th>
        <th>Military Unit</th>
        <th>Damage</th>

        <th>#</th>
        <th>Military Unit</th>
        <th>Damage</th>
      </tr>

    </thead>

    <tbody>

${Array.from({length:maxRowsMu},(_,i)=>{

  const a = atkRankMu[i];
  const d = defRankMu[i];

  const atkHtml = a ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${
      nameMu(a.muId||a.mu)
      ||
      `MU ${String(a.muId||a.mu).slice(-6)}`
    }</td>
    <td>${fmtNum(getValue(a))}</td>
  `
  :
  `<td></td><td></td><td></td>`;

  const defHtml = d ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${
      nameMu(d.muId||d.mu)
      ||
      `MU ${String(d.muId||d.mu).slice(-6)}`
    }</td>
    <td>${fmtNum(getValue(d))}</td>
  `
  :
  `<td></td><td></td><td></td>`;

  return `<tr>${atkHtml}${defHtml}</tr>`;

}).join("")}

    </tbody>

  </table>
</div>`;
}

  // Top 10 MU by GP
 if (gpMu.length) {

  const atkRankMuGP = gpMu
    .filter(r => r._side === "attacker")
    .sort((a,b) => getPoints(b) - getPoints(a))
    .slice(0,10);

  const defRankMuGP = gpMu
    .filter(r => r._side === "defender")
    .sort((a,b) => getPoints(b) - getPoints(a))
    .slice(0,10);

  const maxRowsMuGP =
    Math.max(atkRankMuGP.length, defRankMuGP.length);

  html += `
<div class="br-section">
  <h3 class="br-section-title">
    🎖 Top 10 Military Units by Ground Points
  </h3>

  <table class="rank-table">

<thead>

<tr>
  <th colspan="3" style="color:var(--blue)">
    ATTACKER
  </th>

  <th colspan="3" style="color:var(--red)">
    DEFENDER
  </th>
</tr>

<tr>
  <th>#</th>
  <th>Military Unit</th>
  <th>Ground Points</th>

  <th>#</th>
  <th>Military Unit</th>
  <th>Ground Points</th>
</tr>

</thead>

<tbody>

${Array.from({length:maxRowsMuGP},(_,i)=>{

  const a = atkRankMuGP[i];
  const d = defRankMuGP[i];

  const atkHtml = a ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${nameMu(a.muId||a.mu)||`MU ${String(a.muId||a.mu).slice(-6)}`}</td>
    <td>${fmtNum(getPoints(a))}</td>
  `
  :
  `<td></td><td></td><td></td>`;

  const defHtml = d ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${nameMu(d.muId||d.mu)||`MU ${String(d.muId||d.mu).slice(-6)}`}</td>
    <td>${fmtNum(getPoints(d))}</td>
  `
  :
  `<td></td><td></td><td></td>`;

  return `<tr>${atkHtml}${defHtml}</tr>`;

}).join("")}

</tbody>

</table>
</div>`;
}

  // Top 10 countries by damage
if (rankCountry.length) {

  const atkRankCountry = rankCountry
    .filter(r => r._side === "attacker")
    .sort((a,b)=>getValue(b)-getValue(a))
    .slice(0,10);

  const defRankCountry = rankCountry
    .filter(r => r._side === "defender")
    .sort((a,b)=>getValue(b)-getValue(a))
    .slice(0,10);

  const maxRowsCountry =
    Math.max(
      atkRankCountry.length,
      defRankCountry.length
    );

  html += `
<div class="br-section">

  <h3 class="br-section-title">
    🌍 Top 10 Countries by Damage
  </h3>

  <table class="rank-table">

    <thead>

      <tr>
        <th colspan="3" style="color:var(--blue)">
          ATTACKER
        </th>

        <th colspan="3" style="color:var(--red)">
          DEFENDER
        </th>
      </tr>

      <tr>
        <th>#</th>
        <th>Country</th>
        <th>Damage</th>

        <th>#</th>
        <th>Country</th>
        <th>Damage</th>
      </tr>

    </thead>

    <tbody>

${Array.from({length:maxRowsCountry},(_,i)=>{

  const a = atkRankCountry[i];
  const d = defRankCountry[i];

  const atkHtml = a ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${
      nameCountry(a.countryId||a.country)
      ||
      a.countryName
      ||
      a.name
      ||
      "Unknown"
    }</td>
    <td>${fmtNum(getValue(a))}</td>
  `
  :
  `<td></td><td></td><td></td>`;

  const defHtml = d ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${
      nameCountry(d.countryId||d.country)
      ||
      d.countryName
      ||
      d.name
      ||
      "Unknown"
    }</td>
    <td>${fmtNum(getValue(d))}</td>
  `
  :
  `<td></td><td></td><td></td>`;

  return `<tr>${atkHtml}${defHtml}</tr>`;

}).join("")}

    </tbody>

  </table>

</div>`;
}

  // Top 10 countries by GP
  // Top 10 countries by GP
if (gpCountry.length) {

  const atkRankCountryGP = gpCountry
    .filter(r => r._side === "attacker")
    .sort((a,b)=>getPoints(b)-getPoints(a))
    .slice(0,10);

  const defRankCountryGP = gpCountry
    .filter(r => r._side === "defender")
    .sort((a,b)=>getPoints(b)-getPoints(a))
    .slice(0,10);

  const maxRowsCountryGP =
    Math.max(
      atkRankCountryGP.length,
      defRankCountryGP.length
    );

  html += `
<div class="br-section">

  <h3 class="br-section-title">
    🌍 Top 10 Countries by Ground Points
  </h3>

  <table class="rank-table">

    <thead>

      <tr>
        <th colspan="3" style="color:var(--blue)">
          ATTACKER
        </th>

        <th colspan="3" style="color:var(--red)">
          DEFENDER
        </th>
      </tr>

      <tr>
        <th>#</th>
        <th>Country</th>
        <th>Ground Points</th>

        <th>#</th>
        <th>Country</th>
        <th>Ground Points</th>
      </tr>

    </thead>

    <tbody>

${Array.from({length:maxRowsCountryGP},(_,i)=>{

  const a = atkRankCountryGP[i];
  const d = defRankCountryGP[i];

  const atkHtml = a ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${
      nameCountry(a.countryId||a.country)
      ||
      a.countryName
      ||
      a.name
      ||
      "Unknown"
    }</td>
    <td>${fmtNum(getPoints(a))}</td>
  `
  :
  `<td></td><td></td><td></td>`;

  const defHtml = d ? `
    <td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td>
    <td>${
      nameCountry(d.countryId||d.country)
      ||
      d.countryName
      ||
      d.name
      ||
      "Unknown"
    }</td>
    <td>${fmtNum(getPoints(d))}</td>
  `
  :
  `<td></td><td></td><td></td>`;

  return `<tr>${atkHtml}${defHtml}</tr>`;

}).join("")}

    </tbody>

  </table>

</div>`;
}

  // Orders
  if (orders.length) {
	  
	  const priorityRank = {
  high: 3,
  medium: 2,
  low: 1
};
	  
	  const atkOrders = orders
  .filter(o => (o.side || o.attackerDefender || o._side) === "attacker")
  .sort((a, b) =>
    (priorityRank[b.priority?.toLowerCase()] || 0) -
    (priorityRank[a.priority?.toLowerCase()] || 0)
  );

const defOrders = orders
  .filter(o => (o.side || o.attackerDefender || o._side) === "defender")
  .sort((a, b) =>
    (priorityRank[b.priority?.toLowerCase()] || 0) -
    (priorityRank[a.priority?.toLowerCase()] || 0)
  );

const maxRows = Math.max(atkOrders.length, defOrders.length)
    html+=`
  <div class="br-section">
    <h3 class="br-section-title">🎯 Battle Orders</h3>
    <table class="rank-table">
      <thead>

<tr>
    <th colspan="4"
        style="color:var(--blue)">
        ATTACKER
    </th>

    <th colspan="4"
        style="color:var(--red)">
        DEFENDER
    </th>
</tr>

<tr>
    <th>Through</th>
    <th>Issuer</th>
    <th>Issued By</th>
    <th>Priority</th>

    <th>Through</th>
    <th>Issuer</th>
    <th>Issued By</th>
    <th>Priority</th>
</tr>

</thead>
      <tbody>
${
Array.from({length:maxRows}).map((_,i)=>{

    const atk = atkOrders[i];
    const def = defOrders[i];

    function renderOrder(o){
        if(!o){
            return `<td colspan="4"></td>`;
        }

        const issuedThrough =
            o.mu ? "Military Unit"
          : o.country ? "Country"
          : "Unknown";

        const issuer = orderIssuer(o);

        const createdBy =
            nameUser(o.user) || "Unknown";

        const p = (o.priority || "").toLowerCase();

const priorityColor =
  p === "high"
    ? "var(--red)"
    : p === "medium"
      ? "#f5c542"      // atau var(--yellow) kalau punya
      : p === "low"
        ? "var(--green)"
        : "var(--ink-dim)";

const priority = `
<span style="
  color:${priorityColor};
  font-weight:800;
">
  ${p ? p.charAt(0).toUpperCase() + p.slice(1) : "—"}
</span>`;

        return `
            <td>${issuedThrough}</td>
            <td>${issuer}</td>
            <td>${createdBy}</td>
            <td>${priority}</td>
        `;
    }

    return `
    <tr>
        ${renderOrder(atk)}
        ${renderOrder(def)}
    </tr>
    `;

}).join("")
}
</tbody>
    </table>
  </div>`;
  }

  if (isLive) html+=`<p style="text-align:center;color:var(--ink-dim);font-size:.76rem;padding:6px 0">🔄 Auto-refreshing every 8 s</p>`;
  
  html+=`<div style="padding:8px 0;display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn-primary" id="openFullReportBtn" style="flex:1">📄 Open Full Report</button>
    <button class="btn-secondary" id="exportBattleXlsBtn" style="flex:1">📊 Export XLS</button>
  </div>`;

  E.battleDetailPane.innerHTML = html;

  // ── Wire up round tab buttons ──────────────────────
  const roundTabContainer = document.getElementById(`brRoundTabs_${bid}`);
  if (roundTabContainer) {
    const allTabBtns = roundTabContainer.querySelectorAll("[data-round-idx]");
    const allSections = E.battleDetailPane.querySelectorAll(`[data-round-section][data-round-bid="${bid}"]`);

    function activateRoundTab(idx) {
      // Update pill active states
      allTabBtns.forEach(btn => {
        const isThis = btn.dataset.roundIdx === String(idx);
        btn.classList.toggle("active", isThis);
      });
      // Show/hide sections
      allSections.forEach(sec => {
        sec.style.display = sec.dataset.roundSection === String(idx) ? "block" : "none";
      });
    }

    // Default: show last round tab (or Overall if no rounds)
    const defaultIdx = sortedRounds.length > 0 ? sortedRounds.length - 1 : "overall";
    // Re-set active state: last round pill active, overall pill inactive by default
    allTabBtns.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.roundIdx === String(defaultIdx));
    });

    allTabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        activateRoundTab(btn.dataset.roundIdx);
      });
    });
  }

  document.getElementById("openFullReportBtn")?.addEventListener("click",()=>{
    const title=`${atk||"?"} vs ${def||"?"}${reg?" — "+reg:""}`;
    E.battleReportTitle.textContent = "Battle Report: "+title;
    E.battleReportMeta.textContent = `${isLive?"Live":"Ended"} · ${started?fmtDate(started):""}${ended?" → "+fmtDate(ended):""}`;
    E.battleReportContent.innerHTML = html.replace(/<div[^>]*>\s*<button[^>]*id="openFullReportBtn"[^>]*>[\s\S]*?<\/div>/,"");
    E.battleReportModal.classList.remove("hidden");
  });

  document.getElementById("exportBattleXlsBtn")?.addEventListener("click",()=>{
    exportBattleXLS(b, bid, rankUsers, gpUsers, rankMu, gpMu, rankCountry, gpCountry);
  });
}

function normalizeRankRow(r) {
  return {
    ...r,
    _side: r._side || "unknown",

    damage:
      r.value ??
      r.damage ??
      r.totalDamage ??
      0,

    gp:
      r.points ??
      r.pointsAttacker ??
      r.pointsDefender ??
      getPoints(r) ??
      0,

    userId: r.userId || r.user || null,
    muId: r.muId || r.mu || null,
    countryId: r.countryId || r.country || null,
  };
}

// ─── BATTLE XLS EXPORT ────────────────────────────────
function exportBattleXLS(
  b,
  bid,
  rankUsers,
  gpUsers,
  rankMu,
  gpMu,
  rankCountry,
  gpCountry
) {
  const atk =
    nameCountry(
      b.attacker?.country ||
      b.attackerCountry ||
      b.attacker?.countryId
    ) || "Attacker";

  const def =
    nameCountry(
      b.defender?.country ||
      b.defenderCountry ||
      b.defender?.countryId
    ) || "Defender";

  const reg =
    nameRegion(
      b.defender?.region ||
      b.defenderRegion ||
      b.region
    ) || "";

  const title = `${atk} vs ${def}${reg ? " - " + reg : ""}`;

  // -----------------------------
  // NORMALIZE DATA FIRST
  // -----------------------------
  const users = rankUsers.map(normalizeRankRow);
  const mus = rankMu.map(normalizeRankRow);
  const countries = rankCountry.map(normalizeRankRow);
  const gps = gpUsers.map(normalizeRankRow);
  const gpMus = gpMu.map(normalizeRankRow);
  const gpCountries = gpCountry.map(normalizeRankRow);

  // -----------------------------
  // GP MAPS (SAFE)
  // -----------------------------
  const gpByUser = {};
  gps.forEach(r => {
    const id = r.userId || r.user || "";
    if (id) gpByUser[id] = r.gp;
  });

  const gpByMu = {};
  gpMus.forEach(r => {
    const id = r.muId || r.mu || "";
    if (id) gpByMu[id] = r.gp;
  });

  const gpByCountry = {};
  gpCountries.forEach(r => {
    const id = r.countryId || r.country || "";
    if (id) gpByCountry[id] = r.gp;
  });

  const totalDmg =
    users.reduce((s, r) => s + (r.damage || 0), 0) || 1;

  // =====================================================
  // SHEET 1 — USERS
  // =====================================================
  const sheet1 = [
    ["Rank", "Fighter", "Side", "Damage", "Ground Points", "Damage %"]
  ];

  users
    .sort((a, b) => (b.damage || 0) - (a.damage || 0))
    .forEach((r, i) => {
      const name =
        nameUser(r.userId || r.user) ||
        r.username ||
        "Unknown";

      const dmg = r.damage || 0;
      const gp = gpByUser[r.userId || r.user || ""] || 0;

      const share = ((dmg / totalDmg) * 100).toFixed(2);

      sheet1.push([
        i + 1,
        name,
        (r._side || "").toUpperCase(),
        dmg,
        gp,
        share
      ]);
    });

  // =====================================================
  // SHEET 2 — MUs
  // =====================================================
  const sheet2 = [
    ["Rank", "Military Unit", "Side", "Damage", "Ground Points"]
  ];

  mus
    .sort((a, b) => (b.damage || 0) - (a.damage || 0))
    .forEach((r, i) => {
      const muId = r.muId || r.mu;

      const name =
        nameMu(muId) ||
        `MU ${String(muId).slice(-6)}`;

      const dmg = r.damage || 0;
      const gp = gpByMu[muId] || 0;

      sheet2.push([
        i + 1,
        name,
        (r._side || "").toUpperCase(),
        dmg,
        gp
      ]);
    });

  // =====================================================
  // SHEET 3 — COUNTRIES
  // =====================================================
  const sheet3 = [
    ["Rank", "Country", "Side", "Damage", "Ground Points"]
  ];

  countries
    .sort((a, b) => (b.damage || 0) - (a.damage || 0))
    .forEach((r, i) => {
      const cid = r.countryId || r.country;

      const name =
        nameCountry(cid) ||
        r.countryName ||
        r.name ||
        "Unknown";

      const dmg = r.damage || 0;
      const gp = gpByCountry[cid] || 0;

      sheet3.push([
        i + 1,
        name,
        (r._side || "").toUpperCase(),
        dmg,
        gp
      ]);
    });

  // -----------------------------
  // EXPORT
  // -----------------------------
  buildAndDownloadXLS(title, [
    { name: "Fighters", data: sheet1 },
    { name: "Military Units", data: sheet2 },
    { name: "Countries", data: sheet3 }
  ]);
}

function escapeXml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildAndDownloadXLS(filename, sheets) {
  let html =
`<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="UTF-8">

<!--[if gte mso 9]>
<xml>
<x:ExcelWorkbook>
<x:ExcelWorksheets>
`;

  // ── SHEET HEADERS ─────────────────────────────
  for (const s of sheets) {
    html += `
      <x:ExcelWorksheet>
        <x:Name>${escapeXml(s.name)}</x:Name>
        <x:WorksheetOptions>
          <x:DisplayGridlines/>
        </x:WorksheetOptions>
      </x:ExcelWorksheet>
    `;
  }

  html += `
</x:ExcelWorksheets>
</x:ExcelWorkbook>
</xml>
<![endif]-->
</head>
<body>
`;

  // ── SHEETS CONTENT ────────────────────────────
  for (const s of sheets) {

    if (!s?.data || !Array.isArray(s.data)) {
      console.warn("Skipping invalid sheet:", s);
      continue;
    }

    html += `<table>`;

    // optional caption
    html += `<tr><td colspan="50" style="font-weight:bold;font-size:16px">${escapeXml(s.name)}</td></tr>`;

    for (const row of s.data) {
      html += "<tr>";

      for (const cell of row) {
        html += `<td>${escapeXml(cell)}</td>`;
      }

      html += "</tr>";
    }

    html += `</table><br/>`;
  }

  html += "</body></html>";

  const blob = new Blob([html], {
    type: "application/vnd.ms-excel;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[^a-z0-9_\-\.]/gi, "_") + ".xls";

  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);

  toast("Battle data exported.");
}

function setBattleStatus(m,t="info") { E.battleListStatus.hidden=false; E.battleListStatus.textContent=m; E.battleListStatus.classList.toggle("error",t==="error"); }
function clearBattleStatus() { E.battleListStatus.hidden=true; E.battleListStatus.textContent=""; E.battleListStatus.classList.remove("error"); }
function battleId(b) { return b._id||b.id||b.battleId||""; }

const DAY_MS = 86400000;

async function fetchTxLast24h(type, k, maxPages=8) {
  const cutoff=Date.now()-DAY_MS;
  const items=[]; let cursor;
  for (let p=0;p<maxPages;p++) {
    let res;
    try { res=await fetchTrpc("transaction.getPaginatedTransactions",{limit:100,transactionType:type,cursor},k); }
    catch { break; }
    const data=unwrap(res);
    const page=Array.isArray(data)?data:(data?.items||[]);
    if (!page.length) break;
    let old=false;
    for (const t of page) {
      const ts=new Date(t.createdAt||t.date||t.timestamp||0).getTime();
      if (Number.isFinite(ts)&&ts>0&&ts<cutoff){old=true;continue;}
      items.push(t);
    }
    cursor=data?.nextCursor||data?.cursor||null;
    if (old||!cursor) break;
  }
  return items;
}

function txAmt(t) { const v=Number(t.amount??t.value??t.money??t.total??t.price??0); return Number.isFinite(v)?v:0; }

async function loadMarketStats() {
  const k=apiKey(); if(!k) return;
  try {
    const [wagesR, tradesR, pricesR] = await Promise.allSettled([
      fetchTxLast24h("wage",k),
      fetchTxLast24h("trading",k),
      fetchTrpc("itemTrading.getPrices",{},k),
    ]);
    if (wagesR.status==="fulfilled"&&wagesR.value.length) {
      const wages=wagesR.value;
      const total=wages.reduce((s,t)=>s+txAmt(t),0);
      E.statAvgWage.textContent=fmtMoney(total/wages.length)+" ₿";
      E.statTotalWage.textContent=fmtMoney(total)+" ₿";
    }
    if (tradesR.status==="fulfilled"&&tradesR.value.length) {
      E.statTradeVol.textContent=fmtMoney(tradesR.value.reduce((s,t)=>s+txAmt(t),0))+" ₿";
    }
    if (pricesR.status==="fulfilled") {
      const prices=unwrap(pricesR.value);
      const arr=Array.isArray(prices)?prices:Object.entries(prices||{}).map(([k,v])=>({itemCode:k,price:v}));
      if (arr.length) {
        const top=[...arr].sort((a,b)=>Number(b.price||b.value||0)-Number(a.price||a.value||0))[0];
        E.statTopItem.textContent=(top.itemCode||top.item||top.name||"—")+": "+fmtMoney(top.price||top.value||0);
      }
    }
  } catch {}
}

// ─── MARKET FULL ──────────────────────────────────────
async function loadMarketFull() {
  const k=apiKey(); if(!k) return;
  function setMs(el,msg,err=false) { el.hidden=false; el.textContent=msg; el.classList.toggle("error",err); }
  function clrMs(el) { el.hidden=true; el.textContent=""; el.classList.remove("error"); }

  setMs(E.marketEconStatus,"Loading economic data…");
  setMs(E.marketPricesStatus,"Loading commodity prices…");
  setMs(E.marketOrdersStatus,"Loading trading orders…");
  setMs(E.marketInflationStatus,"Calculating inflation…");

  const [wagesR,tradesR,pricesR] = await Promise.allSettled([
    fetchTxLast24h("wage",k),
    fetchTxLast24h("trading",k),
    fetchTrpc("itemTrading.getPrices",{},k),
  ]);

  // Econ
  try {
    const wages=wagesR.status==="fulfilled"?wagesR.value:[];
    const trades=tradesR.status==="fulfilled"?tradesR.value:[];
    const totalW=wages.reduce((s,t)=>s+txAmt(t),0);
    const avgW=wages.length?totalW/wages.length:0;
    const tradeVol=trades.reduce((s,t)=>s+txAmt(t),0);
    S.market.econ={avgWage:avgW,totalWages:totalW,tradeVol,wageCount:wages.length,tradeCount:trades.length};

    const wageByH={};
    for (const t of wages) {
      const h=new Date(t.createdAt||t.date||0).toISOString().slice(0,16);
      if(!wageByH[h]) wageByH[h]={s:0,n:0};
      wageByH[h].s+=txAmt(t); wageByH[h].n++;
    }
    S.market.wageHistory=Object.entries(wageByH).sort((a,b)=>a[0].localeCompare(b[0])).map(([h,v])=>({h,avg:v.n>0?v.s/v.n:0}));
	S.market.wageHistory.push({
    t: Date.now(),
    avg: avgW
});
    E.marketEconData.innerHTML=[
      {label:"Avg Wage (24h)",   value:wages.length?fmtMoney(avgW)+" ₿":"N/A"},
      {label:"Total Wages (24h)",value:wages.length?fmtMoney(totalW)+" ₿":"N/A"},
      {label:"Wage Transactions", value:wages.length+""},
      {label:"Trade Volume (24h)",value:trades.length?fmtMoney(tradeVol)+" ₿":"N/A"},
      {label:"Trade Transactions",value:trades.length+""},
    ].map(r=>`<div class="econ-row"><span class="econ-row-label">${r.label}</span><span class="econ-row-val">${r.value}</span></div>`).join("");

    if (S.market.wageHistory.length>1) {
      E.marketEconData.innerHTML+=miniChart(S.market.wageHistory.map(w=>w.avg),"Avg Wage by Hour (₿)","var(--accent)");
    }
    clrMs(E.marketEconStatus);
  } catch(e) { setMs(E.marketEconStatus,"Could not load economic data: "+(e.message||""),true); }

  // Prices
  try {
    const prices=unwrap(pricesR.value);
    const arr=(Array.isArray(prices)?prices:Object.entries(prices||{}).map(([k,v])=>({itemCode:k,price:v})))
      .sort((a,b)=>Number(b.price||b.value||0)-Number(a.price||a.value||0));
    S.market.prices=arr;
    const pi=arr.slice(0,10).reduce((s,i)=>s+Number(i.price||i.value||0),0)/Math.min(10,arr.length);
    S.market.priceHistory.push({t:Date.now(),i:pi});
    if(S.market.priceHistory.length>48) S.market.priceHistory.shift();

    // ── Persist current PI snapshot ──
    const nowTs = Date.now();
    const piEntry = { t: nowTs, pi };
    try {
      const stored = JSON.parse(localStorage.getItem("wa-nd-pi-history")||"[]");
      stored.push(piEntry);
      const cutoff = nowTs - 72 * 3600 * 1000;
      const trimmed = stored.filter(e=>e.t>cutoff).slice(-500);
      localStorage.setItem("wa-nd-pi-history", JSON.stringify(trimmed));
      S.market.priceIndexHistory = trimmed;
    } catch {
      S.market.priceIndexHistory.push(piEntry);
      if (S.market.priceIndexHistory.length > 500) S.market.priceIndexHistory.shift();
    }

    E.marketPricesData.innerHTML=arr.slice(0,30).map(item=>{
      const name=item.itemCode||item.item||item.name||"Unknown";
      const price=Number(item.price||item.value||0);
      return `<div class="price-row"><span class="price-name">${name}</span><span class="price-val">${fmtMoney(price)} &#8383;</span></div>`;
    }).join("")||"<p style='color:var(--ink-dim)'>No price data.</p>";
    if (S.market.priceHistory.length>1) {
      E.marketPricesData.innerHTML+=miniChart(S.market.priceHistory.map(p=>p.i),"Price Index (Top-10 Avg &#8383;)","var(--blue)");
    }
    clrMs(E.marketPricesStatus);
  } catch { setMs(E.marketPricesStatus,"Could not load price data.",true); }

  // ── Inflation: backfill PI history from itemMarket transactions on first load ──
  try {
    if (S.market.priceIndexHistory.length < 2) {
      setMs(E.marketInflationStatus,"Backfilling price history from transactions…");
      const cutoff24 = Date.now() - 24*3600*1000;
      const txItems = [];
      let cursor;
      for (let p=0; p<8; p++) {
        let res;
        try { res = await fetchTrpc("transaction.getPaginatedTransactions",{limit:100,transactionType:"itemMarket",cursor},k); }
        catch { break; }
        const data = unwrap(res);
        const page = Array.isArray(data)?data:(data?.items||[]);
        if (!page.length) break;
        let hitOld = false;
        for (const tx of page) {
          const ts = new Date(tx.createdAt||tx.date||tx.timestamp||0).getTime();
          if (Number.isFinite(ts) && ts > 0 && ts < cutoff24) { hitOld=true; continue; }
          txItems.push(tx);
        }
        cursor = data?.nextCursor||data?.cursor||null;
        if (hitOld || !cursor) break;
      }

      if (txItems.length >= 2) {
        // Top-10 most-traded items
        const freq = {};
        for (const tx of txItems) {
          const ic = tx.itemCode||tx.item||"";
          if (ic) freq[ic] = (freq[ic]||0) + 1;
        }
        const topItems = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([ic])=>ic);

        // Live price fallback map
        const livePriceMap = {};
        for (const item of (S.market.prices||[])) {
          const ic = item.itemCode||item.item||item.name||"";
          const price = Number(item.price||item.value||0);
          if (ic && price) livePriceMap[ic] = price;
        }

        // Bucket by 30-min slot
        const buckets = {};
        for (const tx of txItems) {
          const ts = new Date(tx.createdAt||tx.date||tx.timestamp||0);
          if (isNaN(ts)) continue;
          const ic = tx.itemCode||tx.item||"";
          if (!topItems.includes(ic)) continue;
          const unitPrice = Number(tx.unitPrice||tx.pricePerUnit||tx.price||tx.amount||0);
          if (!unitPrice) continue;
          const mins = ts.getMinutes() < 30 ? "00" : "30";
          const slotKey = ts.toISOString().slice(0,13)+":"+mins;
          if (!buckets[slotKey]) buckets[slotKey] = {};
          if (!buckets[slotKey][ic]) buckets[slotKey][ic] = {s:0,n:0};
          buckets[slotKey][ic].s += unitPrice;
          buckets[slotKey][ic].n++;
        }

        const newHistory = Object.entries(buckets)
          .sort((a,b)=>a[0].localeCompare(b[0]))
          .map(([slot, itemMap]) => {
            const t = new Date(slot).getTime();
            const vals = topItems.map(ic => {
              if (itemMap[ic]) return itemMap[ic].s / itemMap[ic].n;
              return livePriceMap[ic] || 0;
            }).filter(v=>v>0);
            const pi = vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0;
            return { t, pi };
          })
          .filter(e=>e.pi>0);

        if (newHistory.length >= 2) {
          const existing = S.market.priceIndexHistory;
          const merged = [...newHistory, ...existing]
            .sort((a,b)=>a.t-b.t)
            .filter((e,i,arr)=>i===0||e.t-arr[i-1].t>5*60*1000);
          const final72h = merged.filter(e=>e.t>Date.now()-72*3600*1000).slice(-500);
          try { localStorage.setItem("wa-nd-pi-history", JSON.stringify(final72h)); } catch {}
          S.market.priceIndexHistory = final72h;
        }
      }
    }
    clrMs(E.marketInflationStatus);
  } catch { clrMs(E.marketInflationStatus); }

  // Orders
  try {
    const topItems=(S.market.prices||[]).slice(0,10).map(i=>i.itemCode||i.item||i.name).filter(Boolean);
    let allOrders=[];
    if (topItems.length) {
      const rs=await Promise.allSettled(topItems.map(ic=>fetchTrpc("tradingOrder.getTopOrders",{itemCode:ic,limit:5},k)));
      for (let i=0;i<rs.length;i++) {
        if (rs[i].status==="fulfilled") {
          const d=unwrap(rs[i].value);
          const arr2 = [
    ...(Array.isArray(d?.buyOrders) ? d.buyOrders : []),
    ...(Array.isArray(d?.sellOrders) ? d.sellOrders : []),
    ...(Array.isArray(d?.items) ? d.items : []),
    ...(Array.isArray(d?.orders) ? d.orders : [])
];
          for (const o of arr2) {
            const price = Number(o.price??o.pricePerUnit??o.unitPrice??o.value??o.amount??0);
            const qty   = Number(o.quantity??o.amount??o.count??1);
            allOrders.push({...o, _itemCode:topItems[i], _price:price, _qty:qty});

          }
        }
      }
    }
    // If still empty, try fetching itemMarket transactions as fallback
    if (!allOrders.length) {
      try {
        const txR = await fetchTrpc("transaction.getPaginatedTransactions",{limit:50,transactionType:"itemMarket"},k);
        const txData = unwrap(txR);
        const txItems = Array.isArray(txData)?txData:(txData?.items||[]);
        allOrders = txItems.map(t=>({
          _itemCode: t.itemCode||t.item||"?",
          _price: Number(t.unitPrice||t.price||t.amount||0),
          _qty: Number(t.quantity||t.amount||1),
          orderType: t.type||"TRADE",
          side: "—",
        }));
      } catch {}
    }
    S.market.orders=allOrders;
    E.marketOrdersData.innerHTML=allOrders.slice(0,25).map(o=>{
      const item=o._itemCode||o.itemCode||o.item||o.name||"Item";
      const qty=o._qty||o.quantity||o.amount||0;
      const price=o._price;
      const type=(o.orderType||o.type||o.side||"ORDER").toUpperCase();
      return `<div class="price-row"><span class="price-name">${item} <small style="color:var(--ink-dim)">${type} ×${fmtNum(qty)}</small></span><span class="price-val">${price>0?fmtMoney(price)+" ₿/u":"—"}</span></div>`;
    }).join("")||"<p style='color:var(--ink-dim)'>No orders available.</p>";
    clrMs(E.marketOrdersStatus);
  } catch(e) { setMs(E.marketOrdersStatus,"Could not load orders: "+(e.message||""),true); }

  loadMarketStats();
  renderInflationCard();
  window.ecgPulse?.(1.5);
}

function miniChart(values, label, color="var(--accent)") {
  if (!values||values.length<2) return "";
  const W=280,H=60,pad=8;
  const mn=Math.min(...values), mx=Math.max(...values), rng=mx-mn||1;
  const pts=values.map((v,i)=>{
    const x=pad+(i/(values.length-1))*(W-pad*2);
    const y=H-pad-((v-mn)/rng)*(H-pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPath=`M${pts[0]} ${pts.slice(1).map(p=>"L"+p).join(" ")} L${W-pad},${H-pad} L${pad},${H-pad} Z`;
  const id="cg"+label.replace(/\W/g,"");
  return `<div class="mini-chart-wrap">
    <div class="mini-chart-label">${label}</div>
    <svg viewBox="0 0 ${W} ${H}" class="mini-chart-svg">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
      </linearGradient></defs>
      <path d="${areaPath}" fill="url(#${id})"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${pts[pts.length-1].split(",")[0]}" cy="${pts[pts.length-1].split(",")[1]}" r="3" fill="${color}"/>
    </svg>
    <div class="mini-chart-range"><span>${fmtMoney(mn)}</span><span>${fmtMoney(mx)}</span></div>
  </div>`;
}

function renderInflationCard() {
  if (!E.marketInflationData) return;
  const history = S.market.priceIndexHistory;

  // Always clear status first
  if (E.marketInflationStatus) {
    E.marketInflationStatus.hidden = true;
    E.marketInflationStatus.textContent = "";
    E.marketInflationStatus.classList.remove("error");
  }

  if (history.length < 2) {
    // Show partial data if we have 1 point; otherwise minimal state
    E.marketInflationData.innerHTML = `
      <div class="infl-hero" style="margin-bottom:12px">
        ${history.length===1
          ? `<span class="infl-pi-val">${fmtMoney(history[0].pi)} <small style="font-size:.7rem;color:var(--ink-dim);font-weight:600">&#8383; PI</small></span>`
          : `<span style="color:var(--ink-dim);font-size:.9rem;font-weight:700">Awaiting market data…</span>`
        }
        <span class="infl-trend-badge" style="background:rgba(132,148,168,.1);color:var(--ink-dim);border-color:rgba(132,148,168,.2)">⏳ Building history</span>
      </div>
      <div class="infl-rows">
        <div class="infl-row"><span class="infl-lbl">1h Change</span><span class="infl-val infl-flat">—</span></div>
        <div class="infl-row"><span class="infl-lbl">6h Change</span><span class="infl-val infl-flat">—</span></div>
        <div class="infl-row"><span class="infl-lbl">24h Inflation</span><span class="infl-val infl-flat">—</span></div>
        <div class="infl-row"><span class="infl-lbl">Data Points</span><span class="infl-val" style="color:var(--ink-dim)">${history.length} / 2 needed</span></div>
      </div>
      <p style="margin:10px 0 0;color:var(--ink-dim);font-size:.72rem;line-height:1.5">
        No itemMarket transaction history found for this period. Data will accumulate on each refresh.
      </p>`;
    return;
  }

  const now = Date.now();
  const latest = history[history.length - 1];
  const currentPI = latest.pi;

  // Find closest entry at or before (now - ms), fall back to oldest available
  function findNearestBefore(ms) {
    const target = now - ms;
    let best = null;
    for (const e of history) {
      if (e.t <= target) best = e;
    }
    return best;  // null = no data that old, caller handles
  }

  const entry1h  = findNearestBefore(1  * 3600 * 1000);
  const entry6h  = findNearestBefore(6  * 3600 * 1000);
  const entry24h = findNearestBefore(24 * 3600 * 1000);

  function pctChange(prev, curr) {
    if (!prev || prev.pi === 0) return null;
    return ((curr - prev.pi) / prev.pi) * 100;
  }

  const chg1h  = pctChange(entry1h,  currentPI);
  const chg6h  = pctChange(entry6h,  currentPI);
  const chg24h = pctChange(entry24h, currentPI);

  function fmtPct(v) {
    if (v === null) return { text:"—", cls:"infl-flat" };
    const sign = v >= 0 ? "+" : "";
    const cls  = v > 0.5 ? "infl-up" : v < -0.5 ? "infl-down" : "infl-flat";
    return { text: sign + v.toFixed(2) + "%", cls };
  }

  const f1h  = fmtPct(chg1h);
  const f6h  = fmtPct(chg6h);
  const f24h = fmtPct(chg24h);

  // Trend driven by longest available window
  const primaryChg = chg24h ?? chg6h ?? chg1h;
  const trend = primaryChg === null ? "neutral"
    : primaryChg > 1.5  ? "hot"
    : primaryChg > 0.3  ? "warm"
    : primaryChg < -1.5 ? "deflating"
    : primaryChg < -0.3 ? "cooling"
    : "stable";

  const trendLabel = {
    hot:"🔥 Inflationary", warm:"📈 Rising Prices",
    stable:"⚖ Stable", cooling:"📉 Cooling",
    deflating:"❄ Deflationary", neutral:"— Insufficient Data",
  }[trend];

  const trendColor = {
    hot:"var(--red)", warm:"var(--yellow)",
    stable:"var(--green)", cooling:"var(--blue)",
    deflating:"var(--blue)", neutral:"var(--ink-dim)",
  }[trend];

  const sparkValues = history.map(e => e.pi);

  let html = `
  <div class="infl-hero" style="margin-bottom:12px">
    <span class="infl-pi-val">${fmtMoney(currentPI)} <small style="font-size:.7rem;color:var(--ink-dim);font-weight:600">&#8383; PI</small></span>
    <span class="infl-trend-badge" style="background:${trendColor}22;color:${trendColor};border-color:${trendColor}55">${trendLabel}</span>
  </div>
  <div class="infl-rows">
    <div class="infl-row">
      <span class="infl-lbl">1h Change</span>
      <span class="infl-val ${f1h.cls}">${f1h.text}</span>
    </div>
    <div class="infl-row">
      <span class="infl-lbl">6h Change</span>
      <span class="infl-val ${f6h.cls}">${f6h.text}</span>
    </div>
    <div class="infl-row">
      <span class="infl-lbl">24h Inflation</span>
      <span class="infl-val ${f24h.cls}">${f24h.text}</span>
    </div>
    <div class="infl-row">
      <span class="infl-lbl">Data Points</span>
      <span class="infl-val" style="color:var(--ink-dim)">${history.length}</span>
    </div>
    <div class="infl-row">
      <span class="infl-lbl">Tracking Since</span>
      <span class="infl-val" style="color:var(--ink-dim);font-size:.74rem">${fmtDate(history[0].t)}</span>
    </div>
  </div>`;

  // Chart — same pattern as wage chart
  if (sparkValues.length > 1) {
    html += miniChart(sparkValues, "Price Index Over Time (&#8383;)", "var(--yellow)");
  }

  html += `<p style="margin:10px 0 0;color:var(--ink-dim);font-size:.72rem;line-height:1.5">
    PI = avg of top-10 commodity prices. Inflation = ((PI<sub>now</sub> &minus; PI<sub>past</sub>) / PI<sub>past</sub>) &times; 100.
  </p>`;

  E.marketInflationData.innerHTML = html;
}


function copyMarketReport() {
  const ec=S.market.econ; const prices=S.market.prices||[]; const orders=S.market.orders||[];
  let r=`# War Era Market Intelligence Report\nGenerated: ${new Date().toUTCString()}\n\n## Economic Overview\n`;
  if(ec){ r+=`- Avg wage: ${fmtMoney(ec.avgWage)} BTC\n- Total wages: ${fmtMoney(ec.totalWages)} BTC (${ec.wageCount} txn)\n- Trade vol: ${fmtMoney(ec.tradeVol)} BTC (${ec.tradeCount} txn)\n\n`; }
  r+=`## Top Commodity Prices\n`;
  for(const i of prices.slice(0,15)) r+=`- ${i.itemCode||i.name||"?"}: ${fmtMoney(Number(i.price||0))} BTC\n`;
  r+=`\n## Top Trading Orders\n`;
  for(const o of orders.slice(0,10)) r+=`- ${(o.orderType||o.type||"ORDER")} ${o._itemCode||o.itemCode||"?"} ×${fmtNum(o._qty||o.quantity||0)} @ ${fmtMoney(o._price||0)} BTC/u\n`;
  // Inflation
  const hist = S.market.priceIndexHistory;
  if (hist.length >= 2) {
    const now = Date.now();
    const curr = hist[hist.length-1].pi;
    function nearBefore(ms){ const t=now-ms; let b=hist[0]; for(const e of hist) if(e.t<=t) b=e; return b; }
    const pct=(ref)=>ref&&ref.pi?((curr-ref.pi)/ref.pi*100).toFixed(2)+"%":"—";
    r+=`\n## Price Inflation\n- Current PI: ${fmtMoney(curr)} BTC\n- 1h: ${pct(nearBefore(3600000))}\n- 6h: ${pct(nearBefore(6*3600000))}\n- 24h: ${pct(nearBefore(86400000))}\n`;
  }
  navigator.clipboard.writeText(r).then(()=>toast("Market report copied."));
}

// ─── JOBS ─────────────────────────────────────────────
async function loadJobs(reset=true) {
  const k=apiKey(); if(!k) return;
  E.jobsStatus.hidden=false; E.jobsStatus.textContent="Loading job offers…";
  if(reset){S.jobs=[];S.jobCursor=null;}
  try {
    const result=await fetchTrpc("workOffer.getWorkOffersPaginated",{limit:50,cursor:reset?undefined:S.jobCursor},k);
    const data=unwrap(result);
    const items=Array.isArray(data)?data:(data?.items||data?.offers||[]);
    S.jobCursor=data?.nextCursor||null;
    S.jobs=reset?items:[...S.jobs,...items];

    await resolveCompaniesForJobs(items, k);
    await ensureLookups(k);

    E.jobsStatus.hidden=true;
    renderJobs();
    populateJobCountryOptions();
  } catch(err) {
    E.jobsStatus.textContent="Could not load jobs: "+(err.message||"");
    E.jobsStatus.classList.add("error");
  }
  E.loadMoreJobsBtn.hidden=!S.jobCursor;
}

function getCompanyId(job) {
  if (job.companyId) return job.companyId;

  if (typeof job.company === "string")
    return job.company;

  if (job.company?._id)
    return job.company._id;

  if (job.company?.id)
    return job.company.id;

  return "";
}

async function resolveCompaniesForJobs(jobs, k) {
  const toFetch = [...new Set(
    jobs
      .filter(j => {
        const cid = getCompanyId(j);
        return cid && !S.lookups.companiesById.has(cid);
      })
      .map(getCompanyId)
      .filter(Boolean)
  )];
  if (!toFetch.length) return;
  await Promise.all(toFetch.map(async cid => {
    try {
      const r = await fetchTrpc("company.getById", {companyId: cid}, k);
      const c = unwrap(r);
      if (c) S.lookups.companiesById.set(cid, c);
	  
    } catch (err) {
    console.error(
        "company.getById failed",
        cid,
        err
    );
}
  }));
  
  
}

function populateJobCountryOptions() {
  if (!E.jobCountryOptions) return;
  const countryNames = new Set();
  for (const j of S.jobs) {
    const cn = getJobCountryName(j);
    if (cn) countryNames.add(cn);
  }
  E.jobCountryOptions.innerHTML = "";
  for (const name of [...countryNames].sort()) {
    const o = document.createElement("option"); o.value = name;
    E.jobCountryOptions.appendChild(o);
  }
}

function getJobCompany(job){
    return S.lookups.companiesById.get(
        getCompanyId(job)
    );
}

function getJobCompanyName(job) {
  const c = getJobCompany(job);
  if (c?.name) return c.name;
  if (c?.companyName) return c.companyName;
  return job.companyName||job.company?.name||"";
}

function getJobCountryName(job) {
  const c = getJobCompany(job);
  if (!c) {
    // fallback: job might have direct region
    const regionId = job.regionId||job.region?._id||job.region?.id||job.region||"";
    if (!regionId) return "";
    const region = S.lookups.regionsById.get(String(regionId));
    if (!region) return "";
    const countryId = region.countryId||region.country?._id||region.country?.id||region.country||"";
    return nameCountry(countryId);
  }
  const regionId = c.regionId||c.region?._id||c.region?.id||c.region||"";
  if (!regionId) return "";
  const region = S.lookups.regionsById.get(String(regionId));
  if (!region) return "";
  const countryId = region.countryId||region.country?._id||region.country?.id||region.country||"";
  return nameCountry(countryId);
}

function getJobRegionName(job) {
  const c = getJobCompany(job);
  if (c) {
    const regionId = c.regionId||c.region?._id||c.region?.id||c.region||"";
    return regionId ? nameRegion(String(regionId)) : "";
  }
  const regionId = job.regionId||job.region?._id||job.region?.id||job.region||"";
  return regionId ? nameRegion(String(regionId)) : "";
}

function renderJobs() {
  const kw=(E.jobSearch?.value||"").toLowerCase();
  const countrySel = (S.jobCountryFilter||"").toLowerCase();

  let jobs = S.jobs.filter(j => {
    if (kw) {
      const company = getJobCompanyName(j)||"";
      const skill = j.skill||j.skillName||j.type||"";
      const desc = j.description||"";
      if (!company.toLowerCase().includes(kw) && !skill.toLowerCase().includes(kw) && !desc.toLowerCase().includes(kw)) return false;
    }
    if (countrySel) {
      const jCountry = getJobCountryName(j).toLowerCase();
      if (!jCountry.includes(countrySel)) return false;
    }
    return true;
  });

  E.jobsList.innerHTML="";
  if(!jobs.length){ E.jobsList.innerHTML=`<p style="color:var(--ink-dim)">No job offers found.</p>`; return; }

  for(const job of jobs) {
    const card=document.createElement("div"); card.className="job-card";
    const company = getJobCompanyName(job) || "Unknown Company";
    const skill=job.skill||job.skillName||job.type||"General";
    const wage=Number(job.wage||job.salary||job.pay||0);
    const currency=job.currency||"BTC";
    const slots=job.openSlots||job.slots||job.count||1;
    const minSkill=job.minSkill||job.requiredLevel||job.level||0;
    const cid = getCompanyId(job);
    const regionName = getJobRegionName(job);
    const countryName = getJobCountryName(job);
    const locationText = [regionName, countryName].filter(Boolean).join(", ");

    card.innerHTML=`
      <p class="job-company">${company}${locationText?` <span style="color:var(--ink-dim);font-weight:500;font-size:.68rem">· ${locationText}</span>`:""}</p>
      <p class="job-title">${skill} Worker</p>
      <div class="job-chips">
        <span class="job-chip wage">💰 ${fmtMoney(wage)} ${currency}/hit</span>
        <span class="job-chip">📋 ${slots} slot${slots!==1?"s":""}</span>
        ${minSkill?`<span class="job-chip">⭐ Min. skill ${minSkill}</span>`:""}
        ${countryName?`<span class="job-chip">🌍 ${countryName}</span>`:""}
      </div>
      <div class="job-actions">
        ${cid
          ?`<button class="job-btn" data-cid="${cid}">🏭 View Company</button>`
          :`<button class="job-btn" disabled title="Company ID not available" style="opacity:.4;cursor:not-allowed">🏭 View Company</button>`}
        <button class="job-btn copy-job" data-wage="${wage}" data-company="${company}" data-skill="${skill}" data-loc="${locationText}">📋 Copy Brief</button>
      </div>`;

    card.querySelector("[data-cid]")?.addEventListener("click", function() {
      window.open(`https://app.warera.io/company/${this.dataset.cid}`, "_blank", "noopener");
    });

    card.querySelector(".copy-job")?.addEventListener("click", function() {
      const loc = this.dataset.loc ? ` (${this.dataset.loc})` : "";
      navigator.clipboard.writeText(
        `Job Offer — ${this.dataset.skill} Worker at ${this.dataset.company}${loc}: ${fmtMoney(this.dataset.wage)} BTC/hit`
      ).then(()=>toast("Job brief copied."));
    });

    E.jobsList.append(card);
  }
}

function copyJobsReport() {
  const byWage=[...S.jobs].sort((a,b)=>Number(b.wage||0)-Number(a.wage||0));
  let r=`# War Era Job Market Report\nGenerated: ${new Date().toUTCString()}\nTotal offers: ${S.jobs.length}\n\n## Top Paying\n`;
  for(const j of byWage.slice(0,20)) {
    const company = getJobCompanyName(j)||"Unknown";
    const country = getJobCountryName(j);
    const region = getJobRegionName(j);
    const loc = [region, country].filter(Boolean).join(", ");
    r+=`- ${company}${loc?` (${loc})`:""} — ${j.skill||j.type||"General"}: ${fmtMoney(j.wage||0)} BTC/hit\n`;
  }
  navigator.clipboard.writeText(r).then(()=>toast("Jobs report copied."));
}

// ─── LOOKUPS ──────────────────────────────────────────
async function ensureLookups(k) {
  if (S.lookupsKey===k) return;
  setStatus("Loading reference data…");
  const [cRes,rRes]=await Promise.all([
    fetchTrpc("country.getAllCountries",{},k),
    fetchTrpc("region.getRegionsObject",{},k),
  ]);
  const countries=unwrap(cRes); const regions=unwrap(rRes);
  S.lookups.countriesById.clear(); S.lookups.countryIdsByName.clear(); S.lookups.regionsById.clear();
  if (Array.isArray(countries)) {
    for (const c of countries) {
      const id=c._id||c.id; if(!id) continue;
      S.lookups.countriesById.set(id,c);
      S.lookups.countryIdsByName.set((c.name||"").toLowerCase(),id);
      if(c.code) S.lookups.countryIdsByName.set(c.code.toLowerCase(),id);
    }
  }
  if (regions&&typeof regions==="object") {
    for (const [id,r] of Object.entries(regions)) S.lookups.regionsById.set(id,r);
  }
  populateCountryOptions();
  S.lookupsKey=k;
}

function populateCountryOptions() {
  const frag=document.createDocumentFragment();
  const sorted=[...S.lookups.countriesById.values()].filter(c=>c.name).sort((a,b)=>a.name.localeCompare(b.name));
  for(const c of sorted){ const o=document.createElement("option"); o.value=c.name; if(c.code) o.label=c.code.toUpperCase(); frag.append(o); }
  E.countryOptions.textContent=""; E.countryOptions.append(frag);
}

async function resolveBattles(events, k) {
  const ids=[...new Set(events.map(e=>getBid(e)).filter(id=>id&&!S.lookups.battlesById.has(id)))];
  if(!ids.length) return;
  await Promise.all(ids.map(async id=>{
    try { const r=await fetchTrpc("battle.getById",{battleId:id},k); const b=unwrap(r); if(b) S.lookups.battlesById.set(id,b); }
    catch { S.lookups.battlesById.set(id,null); }
  }));
}

async function resolveUsers(ids, k) {
  const toFetch=[...new Set(ids)].filter(id=>id&&!S.lookups.usersById.has(id));
  if(!toFetch.length) return;
  await Promise.all(toFetch.map(async uid=>{
    try { const r=await fetchTrpc("user.getUserLite",{userId:uid},k); const u=unwrap(r); if(u) S.lookups.usersById.set(uid,u); }
    catch { S.lookups.usersById.set(uid,null); }
  }));
}

// ─── FETCH ────────────────────────────────────────────
async function fetchTrpc(method, input, k) {
  const url=`${TRPC_BASE}/${method}?input=${encodeURIComponent(JSON.stringify(noUndef(input)))}`;
  const headers = {};
  if (k) headers["x-api-key"] = k;
  const res=await fetch(url,{headers}).catch(err=>{
    if (location.protocol==="file:") throw new Error("Serve over http://localhost — file:// blocks CORS.");
    throw err;
  });
  const txt=await res.text();
  if (!res.ok) {
    if (res.status===401) throw new Error("Invalid API key — check and try again.");
    throw new Error(`Gateway ${res.status}: ${txt.slice(0,140)}`);
  }
  if (!txt) return null;
  const j=JSON.parse(txt);
  if (j?.error?.message) throw new Error(j.error.message);
  return j;
}

function unwrap(r) {
  if (Array.isArray(r)) return r[0]?.result?.data?.json??r[0]?.result?.data??r[0]?.json??r[0];
  return r?.result?.data?.json??r?.result?.data??r?.json??r;
}

function normalizeEvents(r) {
  const d=unwrap(r);
  if (Array.isArray(d)) return d;
  return d?.items||d?.events||d?.data||[];
}

function normalizeCursor(r) { const d=unwrap(r); return d?.nextCursor||d?.cursor||d?.next||null; }
function noUndef(obj) { return Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==undefined)); }

// ─── TIMELINE RENDER ──────────────────────────────────
function renderTimeline() {
  const start=parseLocal(E.startTimeInput.value);
  const end=parseLocal(E.endTimeInput.value);
  const visible=S.events.filter(e=>{
    const ts=evtTime(e); if(!ts) return !start&&!end;
    const t=new Date(ts).getTime(); if(isNaN(t)) return !start&&!end;
    if(start&&t<start.getTime()) return false;
    if(end&&t>end.getTime()) return false;
    return true;
  });
  E.eventList.textContent="";
  if(!visible.length) {
    E.loadMoreBtn.hidden=!S.cursor;
    E.feedMeta.textContent=`${S.events.length} loaded — none in range.`;
    setStatus(S.events.length===0?"No events found.":"No events in the selected time range.");
    return;
  }
  const frag=document.createDocumentFragment();
  for(const e of visible) frag.append(makeEventCard(e));
  E.eventList.append(frag);
  E.loadMoreBtn.hidden=!S.cursor;
  E.feedMeta.textContent=`${visible.length} shown — ${S.events.length} loaded.`;
  clearStatus();
}

function makeEventCard(event) {
  const node=E.tplEvent.content.firstElementChild.cloneNode(true);
  const ed=evtData(event);
  const type=event.type||event.eventType||ed.type||event.name||"event";
  const ts=evtTime(event);

  node.querySelector(".ec-type").textContent=fmtType(type);
  node.querySelector(".ec-title").textContent=buildTitle(event,type,ed);
  node.querySelector(".ec-summary").textContent=buildSummary(event,type,ed);

  const btn=node.querySelector(".ec-copy");
  btn.dataset.eventId=event._id||event.id||"";

  const link=node.querySelector(".ec-link");
  const href=buildLink(event,ed);
  if(href) link.href=href; else link.hidden=true;

  const timeEl=node.querySelector(".ec-time");
  timeEl.textContent=fmtDate(ts);
  if(ts) { const d=new Date(ts); if(!isNaN(d)) timeEl.dateTime=d.toISOString(); }

  const dl=node.querySelector(".ec-details");
  for(const item of buildDetails(event,ed)) {
    const row=document.createElement("div");
    const dt=document.createElement("dt"); dt.textContent=item.label;
    const dd=document.createElement("dd"); dd.textContent=item.value;
    row.append(dt,dd); dl.append(row);
  }
  return node;
}

// ─── ARTICLES RENDER ──────────────────────────────────
function renderArticles() {
  const kw=E.articleSearch.value.trim().toLowerCase();
  const arts=kw?S.articles.filter(a=>(a.title||"").toLowerCase().includes(kw)||(a.content||"").toLowerCase().includes(kw)):S.articles;
  E.articleList.innerHTML="";
  for(const a of arts) {
    const node=E.tplArticle.content.firstElementChild.cloneNode(true);
    node.querySelector(".ac-cat").textContent=a.category||"General";
    node.querySelector(".ac-title").textContent=a.title||"Untitled";
    node.querySelector(".ac-meta").textContent=`${nameUser(a.author)||"Unknown"} · ${a.language||"?"} · ${fmtDate(a.createdAt)}`;
    node.querySelector(".ac-stats").textContent=`Score: ${a.score??a.voteScore??a.votes??0}`;
    node.querySelector(".ac-open").addEventListener("click",()=>window.open(`https://app.warera.io/article/${a._id||a.id}`,"_blank","noopener"));
    node.querySelector(".ac-read").addEventListener("click",()=>{
      E.readerTitle.textContent=a.title||"Untitled";
      E.readerAuthor.textContent=`By ${nameUser(a.author)||"Unknown"}`;
      E.readerContent.innerHTML=a.content||"<p>No content available.</p>";
      E.readerContent.querySelectorAll("a").forEach(l=>{ l.target="_blank"; l.rel="noopener noreferrer"; });
      E.readerContent.querySelectorAll("iframe").forEach(f=>{ f.style.width="100%"; f.style.aspectRatio="16/9"; f.style.height="auto"; });
      E.readerModal.classList.remove("hidden");
    });
    E.articleList.append(node);
  }

  if(S.articleLimiter<10) {
    E.articleFeedMeta.classList.remove("loaded"); void E.articleFeedMeta.offsetWidth;
    E.articleFeedMeta.textContent="Indexing…"; E.articleFeedMeta.classList.add("indexing");
  } else {
    E.articleFeedMeta.classList.remove("indexing"); void E.articleFeedMeta.offsetWidth;
    E.articleFeedMeta.textContent=`${arts.length} articles loaded`;
    E.articleFeedMeta.classList.add("loaded");
    E.articleFeedMeta.addEventListener("animationend",()=>E.articleFeedMeta.classList.remove("loaded"),{once:true});
  }
  E.loadMoreArticlesBtn.hidden=!S.articleCursor;
}

// ─── EVENT ACTIONS ────────────────────────────────────
function handleEventAction(e) {
  const btn=e.target.closest(".ec-copy"); if(!btn) return;
  const ev=S.events.find(x=>(x._id||x.id)===btn.dataset.eventId); if(!ev) return;
  const ed=evtData(ev); const type=ev.type||ev.eventType||ed.type||ev.name||"event";
  const title=buildTitle(ev,type,ed);
  const summary=buildSummary(ev,type,ed);
  const dets=buildDetails(ev,ed).map(i=>`• ${i.label}: ${i.value}`).join("\n");
  const link=buildLink(ev,ed);
  const brief=`# ${title}\n\n${summary}\n\n${dets}${evtTime(ev)?"\n• Time: "+fmtDate(evtTime(ev)):""}\n\n${link?"Source: "+link:""}`;
  navigator.clipboard.writeText(brief).then(()=>toast("News brief copied."));
}

// ─── EVENT DATA HELPERS ───────────────────────────────
function evtData(e) { return e.data&&typeof e.data==="object"?e.data:{}; }
function evtTime(e) { return e.createdAt||e.date||e.time||e.timestamp; }
function getBid(e) { const d=evtData(e); return e.battleId||e.battle?.id||d.battle||""; }

function collectCountryIds(event,ed) {
  return [
    event.countryId,event.country?.id,event.sourceCountry?.id,event.targetCountry?.id,
    event.attackerCountry?.id,event.defenderCountry?.id,
    ed.country,ed.sourceCountry,ed.targetCountry,ed.attackerCountry,ed.defenderCountry,
    ...(Array.isArray(ed.countries)?ed.countries:[]),
    ...(Array.isArray(event.countries)?event.countries:[]),
  ].filter(Boolean);
}

function fmtBattleName(bid) {
  if(!bid) return ""; const b=S.lookups.battlesById.get(bid); if(!b) return "";
  const atk=nameCountry(b.attacker?.country); const def=nameCountry(b.defender?.country); const reg=nameRegion(b.defender?.region);
  const sides=[atk,def].filter(Boolean).join(" vs ");
  if(sides&&reg) return `${sides} in ${reg}`; if(sides) return sides; if(reg) return reg; return "";
}

function nameCountry(id) { if(!id) return ""; return S.lookups.countriesById.get(id)?.name||""; }
function nameRegion(id) { if(!id) return ""; return S.lookups.regionsById.get(String(id))?.name||""; }
function nameUser(id) { if(!id) return ""; const u=S.lookups.usersById.get(id); return u?.username||u?.name||""; }

// ─── PICK (non-repeating random) ─────────────────────
const __pm=new Map();
function pick(...choices) {
  if(choices.length<=1) return choices[0]||"";
  const k=choices.join("||"); const last=__pm.get(k);
  const avail=choices.filter(c=>c!==last);
  const chosen=avail[Math.floor(Math.random()*avail.length)];
  __pm.set(k,chosen); return chosen;
}

// ─── TITLE ─────────────────────────────────────────── 
function buildTitle(event,type,ed) {
  if(event.title) return event.title;
  if(event.message) return event.message;
  if(event.description) return event.description;
  const atk=nameCountry(ed.attackerCountry); const def=nameCountry(ed.defenderCountry);
  const reg=nameRegion(ed.defenderRegion)||nameRegion(ed.region)||nameRegion(ed.regionId);
  const cids=collectCountryIds(event,ed);
  const [c1,c2]=cids.map(nameCountry);
  const allianceName=ed.allianceName||ed.alliance?.name||ed.allianceName||"";

  switch(type) {
    case "countryMoneyTransfer": if(c1&&c2) return `${c1} transferred ${fmtMoney(ed.money)} ₿ to ${c2}`; break;
    case "allianceFormed": if(c1&&c2) return `${c1} formed an alliance with ${c2}`; break;
    case "allianceBroken": if(c1&&c2) return `${c1} broke its alliance with ${c2}`; break;
    case "allianceMemberJoined": {
      const cn=nameCountry(ed.country||ed.countryId||cids[0]);
      if(cn&&allianceName) return `${cn} joins the ${allianceName}`;
      if(cn) return `${cn} joins an alliance`;
      break;
    }
    case "allianceMemberLeft": {
      const cn=nameCountry(ed.country||ed.countryId||cids[0]);
      if(cn&&allianceName) return `${cn} leaves the ${allianceName} alliance`;
      if(cn) return `${cn} leaves an alliance`;
      break;
    }
	case "allianceMemberExcluded": {
      const cn=nameCountry(ed.country||ed.countryId||cids[0]);
	  if (cn&&allianceName) return `${allianceName} Revokes ${cn}'s Membership`;
      if(cn) return `${cn} excluded from an alliance`;
      break;
    }
    case "defensivePactFormed": if(c1&&c2) return `${c1} and ${c2} sign a defensive pact`; break;
    case "defensivePactBroken": if(c1&&c2) return `${c1} breaks the defensive pact with ${c2}`; break;
    case "warDeclared": if(atk&&def) return `${atk} declares war on ${def}`; break;
    case "battleOpened":
      if(atk&&def&&reg) return `${atk} opens a battle vs ${def} in ${reg}`;
      if(atk&&def) return `${atk} opens a battle vs ${def}`;
      break;
    case "battleEnded": {
      const w=ed.wonBy==="attacker"?atk:def; const l=ed.wonBy==="attacker"?def:atk;
      if(w&&l&&reg) return `${w} defeats ${l} in ${reg}`;
      if(w&&l) return `${w} defeats ${l}`;
      break;
    }
    case "newPresident": {
      const country=nameCountry(ed.country); const pres=nameUser(ed.user);
      if(pres&&country) return `${pres} elected president of ${country}`;
      if(country) return `New president in ${country}`;
      break;
    }
    case "regionTransfer": {
      if(c1&&c2&&reg) return `${c1} transfers ${reg} to ${c2}`;
      if(c1&&c2) return `${c1} transfers a region to ${c2}`;
      break;
    }
    case "depositDiscovered": {
      const res=ed.itemCode||"resource";
      return reg?`${res} deposit discovered in ${reg}`:`${res} deposit discovered`;
    }
    case "systemRevolt": return reg?`Revolt erupts in ${reg}`:"Automatic revolt";
    case "regionLiberated": {
      if(c1&&c2&&reg) return `${c1} liberates ${reg} for ${c2}`;
      return "Region liberated";
    }
    case "revolutionStarted": {
      const country=nameCountry(ed.countryId||ed.country);
      return country?`Revolution begins in ${country}`:"Revolution started";
    }
    case "revolutionEnded": {
      const country=nameCountry(ed.countryId||ed.country);
      return country?`Revolution in ${country} ends`:"Revolution ended";
    }
    case "financedRevolt": return reg?`Financed revolt in ${reg}`:"Financed revolt";
    case "peaceMade": {
      const cs=[...new Set(cids.map(nameCountry).filter(Boolean))].join(" & ");
      if(cs) return `${cs} make peace`;
      break;
    }
    case "peace_agreement": {
      const cs=[...new Set(cids.map(nameCountry).filter(Boolean))].join(" & ");
      if(cs) return `${cs} sign peace agreement`;
      break;
    }
    case "bankruptcy": {
      const country=nameCountry(ed.country||ed.countryId||cids[0]);
      if(country) return `${country} declares bankruptcy`;
      return "Country bankruptcy";
    }
    case "resistanceIncreased": if(reg) return `Resistance rises in ${reg}`; break;
    case "resistanceDecreased": if(reg) return `Resistance falls in ${reg}`; break;
    case "strategicResourcesReshuffled": return reg?`Strategic resources reshuffled in ${reg}`:"Strategic resources reshuffled";
  }
  const bid=getBid(event); const bn=fmtBattleName(bid);
  if(bn) return `${fmtType(type)}: ${bn}`;
  if(reg) return `${fmtType(type)}: ${reg}`;
  return fmtType(type);
}

// ─── SUMMARY ──────────────────────────────────────────
function buildSummary(event,type,ed) {
  const atk=nameCountry(ed.attackerCountry); const def=nameCountry(ed.defenderCountry);
  const reg=nameRegion(ed.defenderRegion)||nameRegion(ed.region)||nameRegion(ed.regionId);
  const cids=collectCountryIds(event,ed);
  const cnames=[...new Set(cids.map(nameCountry).filter(Boolean))];
  const [c1,c2]=cnames;
  const allianceName=ed.allianceName||ed.alliance?.name||ed.allianceName||"the alliance";

  switch(type){
    case "countryMoneyTransfer":
      if(c1&&c2) return pick(
        `${c1} has transferred ${fmtMoney(ed.money)} ₿ to ${c2} in an inter-governmental financial transaction.`,
        `Financial records confirm ${c1} sent ${fmtMoney(ed.money)} ₿ directly to ${c2}.`,
        `${fmtMoney(ed.money)} ₿ has been moved from ${c1} to ${c2} in an official state transfer.`
      );
      break;
    case "allianceFormed":
      if(c1&&c2) return pick(
        `${c1} and ${c2} have entered into a formal military alliance, pledging mutual support.`,
        `Diplomatic negotiations concluded as ${c1} and ${c2} announce a new alliance pact.`,
        `${c1} and ${c2} have signed an alliance agreement, marking a new chapter in their bilateral relations.`
      );
      break;
    case "allianceBroken":
      if(c1&&c2) return pick(
        `The alliance between ${c1} and ${c2} has officially dissolved, raising questions about regional stability.`,
        `${c1} has severed its alliance with ${c2}, signalling a significant shift in diplomatic ties.`,
        `${c1} and ${c2} have parted ways, officially ending their alliance agreement.`
      );
      break;
    case "allianceMemberJoined": {
      const cn=nameCountry(ed.country||ed.countryId||cids[0]);
      const allCandidates=cnames.filter(Boolean);
      if(cn&&allianceName!=="the alliance") return pick(
        `${cn} has become the newest member of the ${allianceName} alliance, bolstering its collective strength.`,
        `${cn} officially joins the ${allianceName} alliance, expanding the coalition's reach.`,
        `Diplomats confirm that ${cn} has signed the membership charter for the ${allianceName} alliance.`
      );
      if(allCandidates.length>0) return pick(
        `${allCandidates[0]} has officially joined an inter-national alliance, reshaping the regional power balance.`,
        `A new alliance membership has been confirmed, bringing ${allCandidates[0]} into the coalition.`
      );
      break;
    }
    case "allianceMemberLeft": {
      const cn=nameCountry(ed.country||ed.countryId||cids[0]);
      if(cn&&allianceName!=="the alliance") return pick(
        `${cn} has formally withdrawn from the ${allianceName} alliance, citing unspecified political reasons.`,
        `The ${allianceName} alliance loses a member as ${cn} announces its departure.`,
        `${cn} exits the ${allianceName} alliance, marking a notable shift in the geopolitical landscape.`
      );
      if(cn) return pick(
        `${cn} has formally withdrawn from an alliance, a move that could reshape regional alliances.`,
        `${cn} exits a military coalition, leaving the alliance's future direction in question.`
      );
      break;
    }
    case "allianceMemberExcluded": {
      const cn=nameCountry(ed.country||ed.countryId||cids[0]);
      if(cn&&allianceName!=="the alliance") return pick(
		`Following an internal decision by ${allianceName}, ${cn} has been excluded from the alliance and ceases to hold member status.`,
		`${allianceName} has expelled ${cn} from the alliance, marking the end of its formal membership and participation.`,
		`In a significant political development, ${allianceName} has expelled ${cn} from its ranks, bringing its membership to an abrupt end.`
      );
      if(cn) return pick(
        `${cn} has formally withdrawn from an alliance, a move that could reshape regional alliances.`,
        `${cn} exits a military coalition, leaving the alliance's future direction in question.`
      );
      break;
    }
    case "defensivePactFormed":
      if(c1&&c2) return pick(
        `${c1} and ${c2} have signed a joint defensive pact, committing to mutual military support in the event of an attack.`,
        `A new defensive agreement has been struck between ${c1} and ${c2}, formalising their security cooperation.`,
        `${c1} and ${c2} formalise their alliance with a mutual defence pact, strengthening regional stability.`
      );
      break;
    case "defensivePactBroken":
      if(c1&&c2) return pick(
        `${c1} has officially broken the defensive pact it had previously signed with ${c2}, ending their security agreement.`,
        `The mutual defence pact between ${c1} and ${c2} has been unilaterally terminated, leaving the latter exposed.`,
        `${c1} tears up the defensive pact with ${c2}, straining what was once a stable security partnership.`
      );
      break;
    case "warDeclared":
      if(atk&&def) return pick(
        `Relations between ${atk} and ${def} have reached a breaking point, with ${atk} officially declaring war.`,
        `${atk} has issued a formal declaration of war against ${def}, plunging the region into open conflict.`,
        `War has broken out as ${atk} declares hostilities against ${def}, raising alarm across the region.`
      );
      break;
    case "battleOpened":
      if(atk&&def&&reg) return pick(
        `${atk} has launched a military offensive against ${def}'s position in ${reg}, opening a new front.`,
        `Armed conflict has broken out as forces from ${atk} begin operations against ${def} near ${reg}.`,
        `Battlefield intelligence confirms ${atk} has initiated combat against ${def} in the ${reg} region.`
      );
      if(atk&&def) return pick(
        `${atk} has initiated combat operations against ${def}.`,
        `Hostilities have erupted between ${atk} and ${def}.`
      );
      break;
    case "battleEnded": {
      const w=ed.wonBy==="attacker"?atk:def; const l=ed.wonBy==="attacker"?def:atk;
      if(w&&l) return pick(
        `${w} has emerged victorious over ${l}, bringing an end to the fighting.`,
        `Military operations have concluded with ${w} defeating ${l}${reg?" at "+reg:""}.`,
        `${w} secures a decisive victory against ${l}${reg?" in "+reg:""}, concluding the engagement.`
      );
      break;
    }
    case "newPresident": {
      const country=nameCountry(ed.country); const pres=nameUser(ed.user);
      if(pres&&country) return pick(
        `${pres} has been officially elected as the new president of ${country}, following the conclusion of elections.`,
        `${country} has a new leader — ${pres} has won the presidential election.`,
        `The people of ${country} have chosen ${pres} to lead the nation as its new president.`
      );
      if(country) return pick(`A new president has been elected in ${country}.`,`${country} enters a new political chapter with a presidential election concluded.`);
      break;
    }
    case "regionTransfer":
      if(c1&&c2&&reg) return pick(
        `Control of ${reg} has officially changed hands, transferring from ${c1} to ${c2}.`,
        `${reg} has been formally handed over from ${c1} to ${c2} in an official territorial transfer.`,
        `Territorial maps are being redrawn as ${reg} passes from ${c1} to ${c2}.`
      );
      if(c1&&c2) return pick(`A territorial transfer between ${c1} and ${c2} has been confirmed.`);
      break;
    case "depositDiscovered": {
      const res=ed.itemCode||"resource";
      if(reg) return pick(
        `Survey teams have confirmed the discovery of a new ${res} deposit in ${reg}, potentially boosting the local economy.`,
        `Authorities in ${reg} have announced the discovery of a ${res} deposit, attracting attention from resource companies.`
      );
      return pick(`A new ${res} deposit has been discovered, with details yet to be disclosed.`);
    }
    case "systemRevolt":
      if(reg) return pick(
        `Civil unrest in ${reg} has escalated into open revolt, with authorities struggling to maintain order.`,
        `Reports from ${reg} indicate widespread unrest has turned into open rebellion against the occupying forces.`
      );
      return pick(`Civil unrest has escalated into an automatic revolt.`);
    case "regionLiberated":
      if(c1&&c2&&reg) return pick(
        `${c1} has liberated ${reg} and formally returned it to ${c2}, drawing widespread support.`,
        `${reg} has been freed by ${c1} and restored to its rightful owner, ${c2}.`
      );
      return pick(`A region has been liberated and returned to its original government.`);
    case "revolutionStarted": {
      const country=nameCountry(ed.countryId||ed.country);
      if(country) return pick(
        `A revolution has erupted in ${country} following months of mounting internal tensions.`,
        `${country} descends into revolution as political unrest boils over into open insurgency.`
      );
      return pick(`A revolution has erupted.`);
    }
    case "revolutionEnded": {
      const country=nameCountry(ed.countryId||ed.country);
      if(ed.wonBy==="attacker") return pick(`Revolutionary forces have prevailed in ${country||"the conflict"}, seizing control of the government.`,`The revolution in ${country||"the country"} has concluded with insurgents claiming victory.`);
      if(ed.wonBy==="defender") return pick(`Government forces have suppressed the uprising in ${country||"the country"}, restoring order.`);
      if(country) return pick(`The revolutionary conflict in ${country} has officially concluded.`);
      break;
    }
    case "financedRevolt":
      if(reg) return pick(`An externally financed revolt has been launched in ${reg}, backed by undisclosed foreign interests.`,`Reports confirm outside funding has enabled an armed uprising in ${reg}.`);
      break;
    case "peaceMade":
    case "peace_agreement":
      if(cnames.length) return pick(
        `${cnames.join(" and ")} have formally signed a peace agreement, ending hostilities.`,
        `Hostilities between ${cnames.join(" & ")} have officially ended following successful peace negotiations.`
      );
      break;
    case "bankruptcy": {
      const country=nameCountry(ed.country||ed.countryId||cids[0]);
      if(country) return pick(
        `${country} has declared bankruptcy, plunging its economy into crisis and raising concerns about regional stability.`,
        `In a shocking development, ${country} has officially declared bankruptcy, signalling a severe economic collapse.`,
        `${country} is now bankrupt — the government has formally declared it can no longer meet its financial obligations.`
      );
      return pick(`A country has declared bankruptcy, triggering economic and political uncertainty.`);
    }
    case "resistanceIncreased":
      if(reg) return pick(
        `Resistance levels in ${reg} have increased, suggesting growing opposition to the current occupying force.`,
        `${reg} sees a rise in resistance activity, putting pressure on occupying authorities.`
      );
      break;
    case "resistanceDecreased":
      if(reg) return pick(
        `Resistance in ${reg} has weakened, indicating greater stability under the current administration.`,
        `Reports confirm reduced resistance activity in ${reg}, a sign of consolidating control.`
      );
      break;
    case "strategicResourcesReshuffled":
      if(reg) return pick(
        `Strategic resource allocations in ${reg} have been reshuffled, potentially impacting the regional economy.`,
        `A strategic resource reshuffle has taken place in ${reg}, altering the balance of production capacity.`
      );
      return pick(`Strategic resources have been reshuffled across the map.`);
  }
  if(cnames.length&&reg) return pick(`Developments involving ${cnames.join(", ")} in ${reg}.`,`Reports concern activities of ${cnames.join(", ")} around ${reg}.`);
  if(cnames.length) return pick(`Recent activity involving ${cnames.join(", ")}.`,`Fresh reports concern ongoing developments related to ${cnames.join(", ")}.`);
  if(reg) return pick(`Reports concern developments in ${reg}.`,`Attention turns to events unfolding in ${reg}.`);
  return pick("Further details are emerging across the War Era world.","Observers continue monitoring events across War Era.");
}

function buildDetails(event,ed) {
  const d=[];
  const cnames=[...new Set(collectCountryIds(event,ed).map(nameCountry).filter(Boolean))];
  const reg=nameRegion(event.regionId||event.region?.id||ed.region||ed.defenderRegion||ed.attackerRegion||ed.regionId);
  const bn=fmtBattleName(getBid(event));
  const addD=(label,value)=>{ if(value!=null&&value!==""&&value!==undefined) d.push({label,value:String(value)}); };
  addD("Priority",event.priority);
  addD("Money",ed.money!==undefined?fmtMoney(ed.money)+" ₿":"");
  addD("Winner",ed.wonBy?fmtType(ed.wonBy):"");
  addD("Countries",[...new Set(cnames)].join(", "));
  addD("Region",reg);
  addD("Battle",bn);
  return d.filter(x=>x.value).slice(0,5);
}

function buildLink(event,ed) {
  const BASE="https://app.warera.io";
  const bid=getBid(event); if(bid) return `${BASE}/battle/${bid}`;
  if(ed.war) return `${BASE}/war/${ed.war}`;
  if(Array.isArray(ed.wars)&&ed.wars[0]) return `${BASE}/war/${ed.wars[0]}`;
  const rid=ed.region||ed.defenderRegion||ed.attackerRegion||ed.regionId;
  if(rid) return `${BASE}/region/${rid}`;
  const cid=collectCountryIds(event,ed)[0];
  if(cid) return `${BASE}/country/${cid}`;
  return "";
}

// ─── FORMATTERS ───────────────────────────────────────
function fmtType(v) {
  const map = {
    peaceMade:"Peace Made", battleEnded:"Battle Ended", warEnded:"War Ended",
    warDeclared:"War Declared", battleOpened:"Battle Opened", newPresident:"New President",
    regionTransfer:"Region Transfer", countryMoneyTransfer:"Money Transfer",
    depositDiscovered:"Deposit Discovered", systemRevolt:"System Revolt",
    allianceFormed:"Alliance Formed", allianceBroken:"Alliance Broken",
    allianceMemberJoined:"Alliance Member Joined", allianceMemberLeft:"Alliance Member Left", allianceMemberExcluded: "Alliance Member Excluded",
    defensivePactFormed:"Defensive Pact Formed", defensivePactBroken:"Defensive Pact Broken",
    regionLiberated:"Region Liberated", revolutionStarted:"Revolution Started",
    revolutionEnded:"Revolution Ended", financedRevolt:"Financed Revolt",
    bankruptcy:"Bankruptcy", peace_agreement:"Peace Agreement",
    resistanceIncreased:"Resistance Increased", resistanceDecreased:"Resistance Decreased",
    strategicResourcesReshuffled:"Resources Reshuffled",
  };
  return map[v] || String(v).replace(/_/g," ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/\b\w/g,l=>l.toUpperCase());
}

function fmtMoney(v) {
  const n=Number(v);
  if(!Number.isFinite(n)) return v==null?"—":String(v);
  return new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(n);
}

function fmtNum(v) {
  const n=Number(v); if(!Number.isFinite(n)) return "—";
  if(n>=1e9) return (n/1e9).toFixed(2)+"B";
  if(n>=1e6) return (n/1e6).toFixed(2)+"M";
  if(n>=1e3) return (n/1e3).toFixed(1)+"K";
  return n.toFixed(0);
}

function fmtDate(v) {
  if(!v) return "—"; const d=new Date(v); if(isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat(undefined,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(d);
}

function parseLocal(v) { if(!v) return null; const d=new Date(v); return isNaN(d.getTime())?null:d; }

// ─── STATUS ───────────────────────────────────────────
function setStatus(msg,type="info") { E.statusBox.hidden=false; E.statusBox.textContent=msg; E.statusBox.classList.toggle("error",type==="error"); }
function clearStatus() { E.statusBox.hidden=true; E.statusBox.textContent=""; E.statusBox.classList.remove("error"); }
function setArticleStatus(msg,type="info") { if(!E.articleStatusBox) return; E.articleStatusBox.hidden=false; E.articleStatusBox.textContent=msg; E.articleStatusBox.classList.toggle("error",type==="error"); }
function clearArticleStatus() { if(!E.articleStatusBox) return; E.articleStatusBox.hidden=true; E.articleStatusBox.textContent=""; E.articleStatusBox.classList.remove("error"); }

// ─── TOAST ────────────────────────────────────────────
function toast(msg) {
  document.querySelectorAll(".toast").forEach(t=>t.remove());
  const el=document.createElement("div"); el.className="toast"; el.textContent=msg;
  document.body.append(el); setTimeout(()=>el.remove(),2800);
}

// ─── BOOT ─────────────────────────────────────────────
init();
