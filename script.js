/* =======================================================
   WAR ERA NEWS DESK — v0.2.0
   SCRIPT.JS
   ======================================================= */

const TRPC_BASE = "https://gateway.warerastats.io/trpc";
const EVENTS_METHOD = "event.getEventsPaginated";
const ARTICLES_METHOD = "article.getArticlesPaginated";

const EVENT_TYPES = [
  "warDeclared", "peace_agreement", "battleOpened", "battleEnded",
  "newPresident", "regionTransfer", "peaceMade", "countryMoneyTransfer",
  "depositDiscovered", "systemRevolt", "bankruptcy", "allianceFormed",
  "allianceBroken", "regionLiberated", "strategicResourcesReshuffled",
  "resistanceIncreased", "resistanceDecreased", "revolutionStarted",
  "revolutionEnded", "financedRevolt",
];

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

// =====================================================
// STATE
// =====================================================

const state = {
  cursor: null, events: [], articleCursor: null, articles: [],
  isLoading: false, lastFilters: {}, filterTimer: null,
  lookups: {
    countriesById: new Map(), countryIdsByName: new Map(),
    regionsById: new Map(), battlesById: new Map(), usersById: new Map(),
  },
  lookupsReadyForKey: "",
  autoRefreshTimer: null,
  // Battle tracker
  battles: [], battleCursor: null, activeBattleMode: "history",
  selectedBattleId: null,
  // Market
  marketData: { econ: null, prices: null, orders: null },
  // Jobs
  jobs: [], jobCursor: null,
  // UI
  currentView: "main",
};

const STORAGE_KEYS = {
  apiKey: "war-era-news-desk-api-key",
  theme: "war-era-news-desk-theme",
};

// =====================================================
// DOM ELEMENTS
// =====================================================

const el = {
  apiKeyInput: document.querySelector("#apiKeyInput"),
  applyFiltersButton: document.querySelector("#applyFiltersButton"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  countryInput: document.querySelector("#countryInput"),
  countryOptions: document.querySelector("#countryOptions"),
  endTimeInput: document.querySelector("#endTimeInput"),
  eventList: document.querySelector("#eventList"),
  eventTypeSelect: document.querySelector("#eventTypeSelect"),
  feedMeta: document.querySelector("#feedMeta"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  refreshButton: document.querySelector("#refreshButton"),
  startTimeInput: document.querySelector("#startTimeInput"),
  statusBox: document.querySelector("#statusBox"),
  template: document.querySelector("#eventCardTemplate"),
  themeButton: document.querySelector("#themeButton"),
  apiButton: document.getElementById("apiButton"),
  apiKeyModal: document.getElementById("apiKeyModal"),
  saveApiKeyButton: document.getElementById("saveApiKeyButton"),
  clearApiKeyBtn: document.getElementById("clearApiKeyBtn"),
  articleList: document.querySelector("#articleList"),
  articleFeedMeta: document.querySelector("#articleFeedMeta"),
  articleStatusBox: document.querySelector("#articleStatusBox"),
  loadMoreArticlesButton: document.querySelector("#loadMoreArticlesButton"),
  articleSearch: document.querySelector("#articleSearch"),
  articleTemplate: document.querySelector("#articleCardTemplate"),
  readerModal: document.querySelector("#articleReaderModal"),
  readerTitle: document.querySelector("#readerTitle"),
  readerAuthor: document.querySelector("#readerAuthor"),
  readerContent: document.querySelector("#readerContent"),
  closeReader: document.querySelector("#closeReader"),
  copyArticleBtn: document.querySelector("#copyArticleBtn"),
  // View nav
  navBattles: document.getElementById("navBattles"),
  navMarket: document.getElementById("navMarket"),
  navJobs: document.getElementById("navJobs"),
  viewMain: document.getElementById("viewMain"),
  viewBattles: document.getElementById("viewBattles"),
  viewMarket: document.getElementById("viewMarket"),
  viewJobs: document.getElementById("viewJobs"),
  // Market header stats
  statAvgWage: document.getElementById("statAvgWage"),
  statTotalWage: document.getElementById("statTotalWage"),
  statTradeVol: document.getElementById("statTradeVol"),
  statTopItem: document.getElementById("statTopItem"),
  // Battle tracker
  battleTemplate: document.querySelector("#battleCardTemplate"),
  battleList: document.querySelector("#battleList"),
  battleListStatus: document.querySelector("#battleListStatus"),
  battleDetailPane: document.querySelector("#battleDetailPane"),
  battleRefreshBtn: document.querySelector("#battleRefreshBtn"),
  battleTabLive: document.querySelector("#battleTabLive"),
  battleTabHistory: document.querySelector("#battleTabHistory"),
  loadMoreBattlesButton: document.querySelector("#loadMoreBattlesButton"),
  battleReportModal: document.querySelector("#battleReportModal"),
  battleReportTitle: document.querySelector("#battleReportTitle"),
  battleReportMeta: document.querySelector("#battleReportMeta"),
  battleReportContent: document.querySelector("#battleReportContent"),
  copyBattleReportBtn: document.querySelector("#copyBattleReportBtn"),
  closeBattleReport: document.querySelector("#closeBattleReport"),
  // Market panel
  marketRefreshBtn: document.querySelector("#marketRefreshBtn"),
  copyMarketReportBtn: document.querySelector("#copyMarketReportBtn"),
  marketEconStatus: document.querySelector("#marketEconStatus"),
  marketEconData: document.querySelector("#marketEconData"),
  marketPricesStatus: document.querySelector("#marketPricesStatus"),
  marketPricesData: document.querySelector("#marketPricesData"),
  marketOrdersStatus: document.querySelector("#marketOrdersStatus"),
  marketOrdersData: document.querySelector("#marketOrdersData"),
  // Jobs
  jobsRefreshBtn: document.querySelector("#jobsRefreshBtn"),
  copyJobsReportBtn: document.querySelector("#copyJobsReportBtn"),
  jobsStatus: document.querySelector("#jobsStatus"),
  jobsList: document.querySelector("#jobsList"),
  jobSearch: document.querySelector("#jobSearch"),
  loadMoreJobsButton: document.querySelector("#loadMoreJobsButton"),
};

let limitter = 0;

// =====================================================
// OSCILLOSCOPE
// =====================================================

(function initOscilloscope() {
  const canvas = document.getElementById("oscilloscopeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, animFrame;
  const waves = [
    { freq: 0.004, amp: 0.06, speed: 0.012, phase: 0, lineWidth: 1.5, alpha: 0.45 },
    { freq: 0.007, amp: 0.035, speed: 0.02, phase: 1.2, lineWidth: 0.8, alpha: 0.25 },
    { freq: 0.0028, amp: 0.08, speed: 0.008, phase: 2.5, lineWidth: 1, alpha: 0.2 },
  ];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function draw(ts) {
    animFrame = requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);

    // Grid lines — subtle
    const isDark = document.documentElement.dataset.theme === "dark";
    const gridColor = isDark ? "rgba(216,107,86,0.05)" : "rgba(163,59,40,0.04)";
    const oscColor = isDark ? "rgba(216,107,86," : "rgba(163,59,40,";

    ctx.save();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    const cols = 24, rows = 14;
    for (let i = 1; i < cols; i++) {
      const x = (W / cols) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let i = 1; i < rows; i++) {
      const y = (H / rows) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();

    // Oscilloscope waves — triangular with sine softening
    const t = ts * 0.001;
    for (const wave of waves) {
      const phase = wave.phase + t * wave.speed;
      ctx.beginPath();
      ctx.save();
      ctx.strokeStyle = oscColor + wave.alpha + ")";
      ctx.lineWidth = wave.lineWidth;

      for (let x = 0; x <= W; x += 2) {
        const angle = x * wave.freq + phase;
        // Triangular wave: use Math.asin(sin(x)) normalized
        const tri = (2 / Math.PI) * Math.asin(Math.sin(angle * Math.PI));
        // Soften with a sine blend
        const blend = Math.sin(angle) * 0.3 + tri * 0.7;
        const y = H / 2 + blend * wave.amp * H;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  resize();
  window.addEventListener("resize", resize);
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    requestAnimationFrame(draw);
  }
})();

// =====================================================
// INIT
// =====================================================

function init() {
  el.apiKeyInput.value = localStorage.getItem(STORAGE_KEYS.apiKey) || "";
  applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || "light");
  populateEventTypes();
  bindEvents();
  bindClearButtons();

  if (el.apiKeyInput.value.trim()) {
    document.getElementById("globalEventsTitle")?.classList.add("live");
    loadEvents({ reset: true });
    loadArticles(true);
    startAutoRefresh();
    loadMarketStats(); // Load topbar stats quietly
  } else {
    el.apiButton.classList.add("needs-attention");
    setStatus("Enter your War Era API key to start the live timeline.");
  }
}

// =====================================================
// CLEAR BUTTONS (X on inputs)
// =====================================================

function bindClearButtons() {
  document.querySelectorAll(".clear-btn[data-clears]").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.clears);
      if (input) {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }
    });
  });

  if (el.clearApiKeyBtn) {
    el.clearApiKeyBtn.addEventListener("click", () => {
      el.apiKeyInput.value = "";
      el.apiKeyInput.focus();
    });
  }
}

// =====================================================
// VIEW NAVIGATION
// =====================================================

function showView(viewName) {
  const views = { main: el.viewMain, battles: el.viewBattles, market: el.viewMarket, jobs: el.viewJobs };
  const navBtns = { battles: el.navBattles, market: el.navMarket, jobs: el.navJobs };

  for (const [name, view] of Object.entries(views)) {
    if (view) view.classList.toggle("hidden", name !== viewName);
  }
  for (const [name, btn] of Object.entries(navBtns)) {
    if (btn) btn.classList.toggle("active", name === viewName);
  }

  state.currentView = viewName;

  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) return;

  if (viewName === "battles" && state.battles.length === 0) {
    loadBattles(true);
  }
  if (viewName === "market" && !state.marketData.prices) {
    loadMarketFull();
  }
  if (viewName === "jobs" && state.jobs.length === 0) {
    loadJobs(true);
  }
}

// =====================================================
// EVENT TYPES & BIND
// =====================================================

function populateEventTypes() {
  const fragment = document.createDocumentFragment();
  for (const eventType of EVENT_TYPES) {
    const option = document.createElement("option");
    option.value = eventType;
    option.textContent = formatEventType(eventType);
    fragment.append(option);
  }
  el.eventTypeSelect.append(fragment);
}

function bindEvents() {
  el.applyFiltersButton.addEventListener("click", () => loadEvents({ reset: true }));
  el.refreshButton.addEventListener("click", () => { loadEvents({ reset: true }); loadArticles(true); });
  el.loadMoreButton.addEventListener("click", () => loadEvents({ reset: false }));
  el.themeButton.addEventListener("click", toggleTheme);
  el.eventList.addEventListener("click", handleTimelineAction);

  el.countryInput.addEventListener("input", scheduleCountryRefresh);
  el.countryInput.addEventListener("change", scheduleCountryRefresh);
  el.eventTypeSelect.addEventListener("change", scheduleServerRefresh);
  el.startTimeInput.addEventListener("change", renderTimeline);
  el.endTimeInput.addEventListener("change", renderTimeline);

  el.clearFiltersButton.addEventListener("click", () => {
    el.countryInput.value = "";
    el.eventTypeSelect.value = "";
    el.startTimeInput.value = "";
    el.endTimeInput.value = "";
    loadEvents({ reset: true });
  });

  el.apiButton.addEventListener("click", () => {
    el.apiKeyInput.value = localStorage.getItem(STORAGE_KEYS.apiKey) || "";
    el.apiKeyModal.classList.remove("hidden");
    el.apiKeyInput.focus();
  });

  el.saveApiKeyButton.addEventListener("click", () => {
    const apiKey = el.apiKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    el.apiButton.classList.remove("needs-attention");
    document.getElementById("globalEventsTitle")?.classList.add("live");
    el.apiKeyModal.classList.add("hidden");
    if (apiKey) {
      state.lookupsReadyForKey = "";
      loadEvents({ reset: true });
      loadArticles(true);
      startAutoRefresh();
      loadMarketStats();
    }
  });

  el.apiKeyModal.addEventListener("click", e => {
    if (e.target === el.apiKeyModal) el.apiKeyModal.classList.add("hidden");
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      el.apiKeyModal.classList.add("hidden");
      el.readerModal?.classList.add("hidden");
      el.battleReportModal?.classList.add("hidden");
    }
  });

  // Reader modal
  el.closeReader?.addEventListener("click", () => el.readerModal.classList.add("hidden"));
  el.readerModal?.addEventListener("click", e => { if (e.target === el.readerModal) el.readerModal.classList.add("hidden"); });
  el.copyArticleBtn?.addEventListener("click", () => {
    const text = el.readerContent?.innerText || "";
    navigator.clipboard.writeText(text).then(() => showToast("Article text copied."));
  });

  el.loadMoreArticlesButton?.addEventListener("click", () => loadArticles(false));
  el.articleSearch?.addEventListener("input", renderArticles);

  // View nav
  el.navBattles?.addEventListener("click", () => showView(state.currentView === "battles" ? "main" : "battles"));
  el.navMarket?.addEventListener("click", () => showView(state.currentView === "market" ? "main" : "market"));
  el.navJobs?.addEventListener("click", () => showView(state.currentView === "jobs" ? "main" : "jobs"));

  // Battle tracker
  el.battleRefreshBtn?.addEventListener("click", () => loadBattles(true));
  el.battleTabLive?.addEventListener("click", () => { state.activeBattleMode = "live"; loadBattles(true); });
  el.battleTabHistory?.addEventListener("click", () => { state.activeBattleMode = "history"; loadBattles(true); });
  el.loadMoreBattlesButton?.addEventListener("click", () => loadBattles(false));
  el.closeBattleReport?.addEventListener("click", () => el.battleReportModal?.classList.add("hidden"));
  el.battleReportModal?.addEventListener("click", e => { if (e.target === el.battleReportModal) el.battleReportModal.classList.add("hidden"); });
  el.copyBattleReportBtn?.addEventListener("click", () => {
    const text = el.battleReportContent?.innerText || "";
    navigator.clipboard.writeText(text).then(() => showToast("Battle report copied."));
  });

  // Market
  el.marketRefreshBtn?.addEventListener("click", () => loadMarketFull());
  el.copyMarketReportBtn?.addEventListener("click", copyMarketReport);

  // Jobs
  el.jobsRefreshBtn?.addEventListener("click", () => loadJobs(true));
  el.copyJobsReportBtn?.addEventListener("click", copyJobsReport);
  el.jobSearch?.addEventListener("input", renderJobs);
  el.loadMoreJobsButton?.addEventListener("click", () => loadJobs(false));
}

// =====================================================
// AUTO REFRESH
// =====================================================

function startAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = setInterval(() => {
    if (state.isLoading) return;
    const apiKey = el.apiKeyInput.value.trim();
    if (!apiKey) return;
    refreshEvents();
    if (limitter < 10) { limitter++; loadArticles(false); }
    else { limitter = 100; }
  }, 5000);
}

async function refreshEvents() {
  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) return;
  try {
    const result = await fetchTrpc(EVENTS_METHOD, { ...state.lastFilters, limit: 20 }, apiKey);
    const newestEvents = normalizeEvents(result);
    if (!newestEvents.length) return;
    const existingIds = new Set(state.events.map(e => e._id || e.id));
    const fresh = newestEvents.filter(e => !existingIds.has(e._id || e.id));
    if (!fresh.length) return;
    state.events = [...fresh, ...state.events];
    renderTimeline();
    loadArticles(true);
    limitter = 0;
  } catch (e) {
    // silent
  }
}

// =====================================================
// THEME
// =====================================================

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  localStorage.setItem(STORAGE_KEYS.theme, t);
  el.themeButton.textContent = t === "dark" ? "Light" : "Dark";
}

// =====================================================
// EVENTS — LOAD
// =====================================================

function scheduleServerRefresh() {
  window.clearTimeout(state.filterTimer);
  state.filterTimer = window.setTimeout(() => loadEvents({ reset: true }), 350);
}

function scheduleCountryRefresh() {
  const country = el.countryInput.value.trim();
  if (country && !resolveCountryId(country)) return;
  scheduleServerRefresh();
}

function getFilters() {
  const countryId = resolveCountryId(el.countryInput.value.trim());
  return {
    limit: 50,
    countryId: countryId || undefined,
    eventTypes: el.eventTypeSelect.value ? [el.eventTypeSelect.value] : undefined,
  };
}

function resolveCountryId(value) {
  if (!value) return "";
  if (OBJECT_ID_PATTERN.test(value)) return value;
  return state.lookups.countryIdsByName.get(normalizeNameKey(value)) || "";
}

async function loadEvents({ reset }) {
  if (state.isLoading) return;
  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) { setStatus("Enter your War Era API key before loading events.", "error"); return; }

  localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
  state.isLoading = true;
  setStatus(reset ? "Loading timeline..." : "Loading more events...");
  setControlsDisabled(true);

  if (reset) { state.cursor = null; state.events = []; el.eventList.textContent = ""; }

  try {
    await ensureLookups(apiKey);
    if (reset) state.lastFilters = getFilters();
    const payload = { ...state.lastFilters, cursor: reset ? undefined : state.cursor };
    const result = await fetchTrpc(EVENTS_METHOD, payload, apiKey);
    const events = normalizeEvents(result);
    state.cursor = normalizeCursor(result);
    state.events = reset ? events : [...state.events, ...events];
    await resolveBattlesForEvents(events, apiKey);
    await resolveUsersForEvents(events, apiKey);
    renderTimeline();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Could not load events.", "error");
  } finally {
    state.isLoading = false;
    setControlsDisabled(false);
  }
}

// =====================================================
// ARTICLES
// =====================================================

async function loadArticles(reset = true) {
  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) return;
  if (reset) { state.articleCursor = null; state.articles = []; }
  const payload = { limit: 100, cursor: reset ? undefined : state.articleCursor };
  try {
    const result = await fetchTrpc(ARTICLES_METHOD, payload, apiKey);
    const data = unwrapTrpcResult(result);
    const items = data.items || [];
    await resolveUsersForArticles(items, apiKey);
    state.articleCursor = data.nextCursor || null;
    state.articles = reset ? items : [...state.articles, ...items];
    renderArticles();
  } catch (e) {
    // silent
  }
}

// =====================================================
// BATTLE TRACKER
// =====================================================

async function loadBattles(reset = true) {
  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) return;

  setBattleListStatus("Loading battles...");
  el.battleTabLive?.classList.toggle("active", state.activeBattleMode === "live");
  el.battleTabHistory?.classList.toggle("active", state.activeBattleMode === "history");

  if (reset) { state.battles = []; state.battleCursor = null; el.battleList.innerHTML = ""; }

  try {
    let battles = [];
    if (state.activeBattleMode === "live") {
      const result = await fetchTrpc("battle.getLiveBattleData", { limit: 20 }, apiKey);
      const data = unwrapTrpcResult(result);
      battles = Array.isArray(data) ? data : (data?.items || data?.battles || []);
    } else {
      const payload = { limit: 20, cursor: reset ? undefined : state.battleCursor };
      const result = await fetchTrpc("battle.getBattles", payload, apiKey);
      const data = unwrapTrpcResult(result);
      battles = Array.isArray(data) ? data : (data?.items || data?.battles || []);
      state.battleCursor = data?.nextCursor || null;
    }

    // Enrich battles with country names
    await Promise.all(battles.map(async b => {
      const bid = b._id || b.id || b.battleId;
      if (bid && !state.lookups.battlesById.has(bid)) {
        state.lookups.battlesById.set(bid, b);
      }
    }));

    state.battles = reset ? battles : [...state.battles, ...battles];
    renderBattleList();
    clearBattleListStatus();
  } catch (err) {
    setBattleListStatus("Could not load battles: " + (err.message || "Unknown error"), "error");
  }

  el.loadMoreBattlesButton.hidden = state.activeBattleMode === "live" || !state.battleCursor;
}

function renderBattleList() {
  if (state.battles.length === 0) {
    el.battleList.innerHTML = `<p style="color:var(--muted);padding:20px;text-align:center">No battles found.</p>`;
    return;
  }

  el.battleList.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const battle of state.battles) {
    frag.append(renderBattleCard(battle));
  }
  el.battleList.append(frag);
}

function renderBattleCard(battle) {
  const node = el.battleTemplate.content.firstElementChild.cloneNode(true);
  const bid = battle._id || battle.id || battle.battleId || "";
  const isLive = battle.isLive || battle.active || battle.status === "live" || !battle.endedAt;
  const attacker = nameCountry(battle.attacker?.country || battle.attackerCountry || battle.attacker?.countryId);
  const defender = nameCountry(battle.defender?.country || battle.defenderCountry || battle.defender?.countryId);
  const region = nameRegion(battle.defender?.region || battle.defenderRegion || battle.region);

  const dot = node.querySelector(".battle-status-dot");
  dot.classList.add(isLive ? "live" : "ended");

  node.querySelector(".battle-label").textContent = isLive ? "🔴 LIVE" : "✅ ENDED";

  const title = attacker && defender
    ? `${attacker} vs ${defender}${region ? " — " + region : ""}`
    : (battle.title || battle.name || "Battle #" + bid.slice(-6));
  node.querySelector(".battle-title").textContent = title;

  const started = battle.createdAt || battle.startedAt || battle.openedAt || "";
  const ended = battle.endedAt || "";
  let metaText = started ? "Started: " + formatDate(started) : "";
  if (ended) metaText += " · Ended: " + formatDate(ended);
  node.querySelector(".battle-meta").textContent = metaText;

  // Quick stats chips
  const qStats = node.querySelector(".battle-quick-stats");
  const chips = [];
  if (battle.participants?.length || battle.participantCount) {
    chips.push({ label: "👥 " + (battle.participants?.length || battle.participantCount || "?") + " fighters" });
  }
  if (battle.totalDamage || battle.damage) {
    chips.push({ label: "⚔ " + formatNum(battle.totalDamage || battle.damage) + " DMG" });
  }
  if (battle.groundPoints || battle.totalGroundPoints) {
    chips.push({ label: "🏴 " + formatNum(battle.groundPoints || battle.totalGroundPoints) + " GP" });
  }
  for (const chip of chips.slice(0, 3)) {
    const c = document.createElement("span");
    c.className = "battle-stat-chip";
    c.textContent = chip.label;
    qStats.append(c);
  }

  const selectBtn = node.querySelector(".battle-select-btn");
  selectBtn.addEventListener("click", async () => {
    state.selectedBattleId = bid;
    await loadBattleDetail(battle, bid);
  });

  return node;
}

async function loadBattleDetail(battle, battleId) {
  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) return;

  el.battleDetailPane.innerHTML = `<div style="padding:20px;color:var(--muted)">Loading battle intelligence...</div>`;

  try {
    const [rankingResult, ordersResult] = await Promise.allSettled([
      fetchTrpc("battleRanking.getRanking", { battleId }, apiKey),
      fetchTrpc("battleOrder.getByBattle", { battleId }, apiKey),
    ]);

    const ranking = rankingResult.status === "fulfilled" ? (unwrapTrpcResult(rankingResult.value) || []) : [];
    const orders = ordersResult.status === "fulfilled" ? (unwrapTrpcResult(ordersResult.value) || []) : [];

    // Resolve user names in ranking
    const userIds = [...new Set(ranking.map(r => r.userId || r.user).filter(Boolean))]
      .filter(id => !state.lookups.usersById.has(id));
    if (userIds.length > 0) {
      await Promise.all(userIds.map(async uid => {
        try {
          const r = await fetchTrpc("user.getUserLite", { userId: uid }, apiKey);
          const u = unwrapTrpcResult(r);
          if (u) state.lookups.usersById.set(uid, u);
        } catch {}
      }));
    }

    renderBattleDetail(battle, battleId, ranking, orders);
  } catch (err) {
    el.battleDetailPane.innerHTML = `<div class="status error">${err.message || "Failed to load battle detail"}</div>`;
  }
}

function renderBattleDetail(battle, battleId, ranking, orders) {
  const attacker = nameCountry(battle.attacker?.country || battle.attackerCountry || battle.attacker?.countryId);
  const defender = nameCountry(battle.defender?.country || battle.defenderCountry || battle.defender?.countryId);
  const region = nameRegion(battle.defender?.region || battle.defenderRegion || battle.region);
  const isLive = battle.isLive || battle.active || !battle.endedAt;
  const started = battle.createdAt || battle.startedAt || "";
  const ended = battle.endedAt || "";
  const totalDmg = battle.totalDamage || battle.damage || 0;
  const gp = battle.groundPoints || battle.totalGroundPoints || 0;
  const participants = battle.participants?.length || battle.participantCount || (ranking?.length) || 0;

  // Narrative
  let narrative = "";
  if (isLive) {
    narrative = pick(
      `Active combat is currently underway between ${attacker || "attacking forces"} and ${defender || "defending forces"}${region ? " in the contested region of " + region : ""}. This battle remains open with outcomes yet to be determined.`,
      `Battlefield reports confirm that forces from ${attacker || "the attacker"} have engaged ${defender || "the defender"}${region ? " near " + region : ""}. Fighting continues across multiple fronts.`,
      `Intelligence confirms ongoing military engagement between ${attacker || "attacking forces"} and ${defender || "defending forces"}${region ? " centered around " + region : ""}. Ground commanders report heavy exchanges.`
    );
  } else {
    const winner = battle.winner || (battle.wonBy === "attacker" ? attacker : defender) || "Unknown";
    narrative = pick(
      `Battle concluded with ${winner} securing victory${region ? " in " + region : ""}. The engagement involved ${participants} fighters${totalDmg ? " who collectively dealt " + formatNum(totalDmg) + " in damage" : ""}.`,
      `Military operations ended with a decisive victory for ${winner}${region ? " over the contested area of " + region : ""}. Commanders report ${participants} participants took part in the engagement.`,
      `After fierce fighting, ${winner} prevailed in this engagement${region ? " around " + region : ""}. ${totalDmg ? formatNum(totalDmg) + " total damage was inflicted during the battle." : ""}`
    );
  }

  // Build HTML
  let html = `
    <div class="battle-report-section">
      <h3>Battle Overview</h3>
      <div class="battle-narrative">${narrative}</div>
      <div class="battle-stats-grid">
        <div class="battle-stat-box"><span class="stat-val">${participants || "—"}</span><span class="stat-lbl">Participants</span></div>
        <div class="battle-stat-box"><span class="stat-val">${totalDmg ? formatNum(totalDmg) : "—"}</span><span class="stat-lbl">Total Damage</span></div>
        <div class="battle-stat-box"><span class="stat-val">${gp ? formatNum(gp) : "—"}</span><span class="stat-lbl">Ground Points</span></div>
        <div class="battle-stat-box"><span class="stat-val">${isLive ? "🔴 LIVE" : "✅ Ended"}</span><span class="stat-lbl">Status</span></div>
        ${attacker ? `<div class="battle-stat-box"><span class="stat-val">${attacker}</span><span class="stat-lbl">Attacker</span></div>` : ""}
        ${defender ? `<div class="battle-stat-box"><span class="stat-val">${defender}</span><span class="stat-lbl">Defender</span></div>` : ""}
        ${region ? `<div class="battle-stat-box"><span class="stat-val">${region}</span><span class="stat-lbl">Region</span></div>` : ""}
        ${started ? `<div class="battle-stat-box"><span class="stat-val" style="font-size:.8rem">${formatDate(started)}</span><span class="stat-lbl">Started</span></div>` : ""}
        ${ended ? `<div class="battle-stat-box"><span class="stat-val" style="font-size:.8rem">${formatDate(ended)}</span><span class="stat-lbl">Ended</span></div>` : ""}
      </div>
    </div>`;

  // Rankings
  if (ranking && ranking.length > 0) {
    const byDmg = [...ranking].sort((a, b) => (b.damage || b.totalDamage || 0) - (a.damage || a.totalDamage || 0)).slice(0, 20);
    html += `
      <div class="battle-report-section">
        <h3>⚔ Damage Rankings</h3>
        <table class="ranking-table">
          <thead><tr><th>#</th><th>Fighter</th><th>Damage</th><th>Hits</th><th>Ground</th></tr></thead>
          <tbody>${byDmg.map((r, i) => {
            const uname = nameUser(r.userId || r.user) || (r.username) || "Unknown";
            const dmg = r.damage || r.totalDamage || 0;
            const hits = r.hits || r.totalHits || 0;
            const gpR = r.groundPoints || 0;
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1) + ".";
            return `<tr><td><span class="rank-medal">${medal}</span></td><td>${uname}</td><td>${formatNum(dmg)}</td><td>${formatNum(hits)}</td><td>${gpR || "—"}</td></tr>`;
          }).join("")}</tbody>
        </table>
      </div>`;
  }

  // MU Contracts / Orders
  if (orders && orders.length > 0) {
    html += `
      <div class="battle-report-section">
        <h3>📋 Battle Orders & Contracts</h3>
        <table class="ranking-table">
          <thead><tr><th>Type</th><th>Issued By</th><th>Side</th><th>Budget</th><th>Hits Required</th></tr></thead>
          <tbody>${orders.slice(0, 15).map(o => {
            const issuer = nameUser(o.userId || o.issuedBy) || o.companyName || "Unknown";
            const side = o.side || o.attackerDefender || "—";
            const budget = o.budget ? formatMoney(o.budget) + " BTC" : "—";
            const hits = o.requiredHits || o.hits || "—";
            return `<tr><td>${o.type || "Contract"}</td><td>${issuer}</td><td>${side}</td><td>${budget}</td><td>${hits}</td></tr>`;
          }).join("")}</tbody>
        </table>
      </div>`;
  }

  // Export button
  html += `
    <div class="battle-report-section" style="padding-top:4px">
      <button class="primary-button" id="exportBattleReportBtn" style="width:100%">📋 Open Full Report</button>
    </div>`;

  el.battleDetailPane.innerHTML = html;

  // Bind export
  document.getElementById("exportBattleReportBtn")?.addEventListener("click", () => {
    const title = `${attacker || "?"} vs ${defender || "?"}${region ? " — " + region : ""}`;
    el.battleReportTitle.textContent = `Battle Report: ${title}`;
    el.battleReportMeta.textContent = `${isLive ? "Live" : "Ended"} · ${started ? "Started " + formatDate(started) : ""} ${ended ? "· Ended " + formatDate(ended) : ""}`;
    el.battleReportContent.innerHTML = html.replace(/<button[^>]*>.*?<\/button>/gs, "");
    el.battleReportModal.classList.remove("hidden");
  });
}

function setBattleListStatus(msg, type = "info") {
  el.battleListStatus.hidden = false;
  el.battleListStatus.textContent = msg;
  el.battleListStatus.classList.toggle("error", type === "error");
}

function clearBattleListStatus() {
  el.battleListStatus.hidden = true;
  el.battleListStatus.textContent = "";
  el.battleListStatus.classList.remove("error");
}

// =====================================================
// MARKET — TOPBAR STATS
// =====================================================

async function loadMarketStats() {
  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) return;

  try {
    const [txResult, pricesResult] = await Promise.allSettled([
      fetchTrpc("transaction.getPaginatedTransactions", { limit: 200 }, apiKey),
      fetchTrpc("itemTrading.getPrices", {}, apiKey),
    ]);

    if (txResult.status === "fulfilled") {
      const data = unwrapTrpcResult(txResult.value);
      const items = Array.isArray(data) ? data : (data?.items || []);
      const now = Date.now();
      const h24 = items.filter(t => now - new Date(t.createdAt || t.date || 0).getTime() < 86400000);
      const wages = h24.filter(t => (t.type || "").toLowerCase().includes("wage") || (t.reason || "").toLowerCase().includes("wage"));
      const trades = h24.filter(t => (t.type || "").toLowerCase().includes("trade") || (t.type || "").toLowerCase().includes("buy") || (t.type || "").toLowerCase().includes("sell"));

      if (wages.length > 0) {
        const total = wages.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const avg = total / wages.length;
        el.statAvgWage.textContent = formatMoney(avg) + " ₿";
        el.statTotalWage.textContent = formatMoney(total) + " ₿";
      }
      if (trades.length > 0) {
        const vol = trades.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        el.statTradeVol.textContent = formatMoney(vol) + " ₿";
      }
    }

    if (pricesResult.status === "fulfilled") {
      const prices = unwrapTrpcResult(pricesResult.value);
      const arr = Array.isArray(prices) ? prices : Object.entries(prices || {}).map(([k, v]) => ({ item: k, price: v }));
      if (arr.length > 0) {
        const top = arr.sort((a, b) => (Number(b.price || b.value || 0)) - (Number(a.price || a.value || 0)))[0];
        el.statTopItem.textContent = (top.item || top.itemCode || top.name || "—") + ": " + formatMoney(top.price || top.value || 0);
      }
    }
  } catch {}
}

// =====================================================
// MARKET — FULL PANEL
// =====================================================

async function loadMarketFull() {
  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) return;

  el.marketEconStatus.hidden = false;
  el.marketEconStatus.textContent = "Loading economic data...";
  el.marketPricesStatus.hidden = false;
  el.marketPricesStatus.textContent = "Loading commodity prices...";
  el.marketOrdersStatus.hidden = false;
  el.marketOrdersStatus.textContent = "Loading trading orders...";

  const [txResult, pricesResult, ordersResult] = await Promise.allSettled([
    fetchTrpc("transaction.getPaginatedTransactions", { limit: 200 }, apiKey),
    fetchTrpc("itemTrading.getPrices", {}, apiKey),
    fetchTrpc("tradingOrder.getTopOrders", { limit: 30 }, apiKey),
  ]);

  // Economic overview
  try {
    const data = unwrapTrpcResult(txResult.value);
    const items = Array.isArray(data) ? data : (data?.items || []);
    const now = Date.now();
    const h24 = items.filter(t => now - new Date(t.createdAt || t.date || 0).getTime() < 86400000);
    const wages = h24.filter(t => (t.type || "").toLowerCase().includes("wage") || (t.reason || "").toLowerCase().includes("wage"));
    const trades = h24.filter(t => (t.type || "").toLowerCase().includes("trade") || (t.type || "").toLowerCase().includes("buy") || (t.type || "").toLowerCase().includes("sell"));
    const totalWages = wages.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const avgWage = wages.length > 0 ? totalWages / wages.length : 0;
    const tradeVol = trades.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    state.marketData.econ = { avgWage, totalWages, tradeVol, wageCount: wages.length, tradeCount: trades.length };

    el.marketEconData.innerHTML = [
      { label: "Average Wage (24h)", value: wages.length > 0 ? formatMoney(avgWage) + " ₿" : "N/A" },
      { label: "Total Wages Paid (24h)", value: wages.length > 0 ? formatMoney(totalWages) + " ₿" : "N/A" },
      { label: "Wage Transactions", value: wages.length.toString() },
      { label: "Trade Volume (24h)", value: trades.length > 0 ? formatMoney(tradeVol) + " ₿" : "N/A" },
      { label: "Trade Transactions", value: trades.length.toString() },
    ].map(row => `
      <div class="econ-stat-row">
        <span class="econ-stat-label">${row.label}</span>
        <span class="econ-stat-value">${row.value}</span>
      </div>`).join("");
    el.marketEconStatus.hidden = true;
  } catch (err) {
    el.marketEconStatus.textContent = "Could not load economic data.";
    el.marketEconStatus.classList.add("error");
  }

  // Commodity prices
  try {
    const prices = unwrapTrpcResult(pricesResult.value);
    const arr = Array.isArray(prices)
      ? prices
      : Object.entries(prices || {}).map(([k, v]) => ({ itemCode: k, price: v }));
    arr.sort((a, b) => (Number(b.price || b.value || 0)) - (Number(a.price || a.value || 0)));
    state.marketData.prices = arr;

    el.marketPricesData.innerHTML = arr.slice(0, 30).map(item => {
      const name = item.itemCode || item.item || item.name || "Unknown";
      const price = item.price || item.value || 0;
      return `<div class="price-item"><span class="price-item-name">${name}</span><span class="price-item-val">${formatMoney(price)} ₿</span></div>`;
    }).join("") || "<p style='color:var(--muted)'>No price data available.</p>";
    el.marketPricesStatus.hidden = true;
  } catch {
    el.marketPricesStatus.textContent = "Could not load price data.";
    el.marketPricesStatus.classList.add("error");
  }

  // Top orders
  try {
    const orders = unwrapTrpcResult(ordersResult.value);
    const arr = Array.isArray(orders) ? orders : (orders?.items || orders?.orders || []);
    state.marketData.orders = arr;

    el.marketOrdersData.innerHTML = arr.slice(0, 20).map(order => {
      const item = order.itemCode || order.item || order.name || "Item";
      const qty = order.quantity || order.amount || 0;
      const price = order.price || order.unitPrice || 0;
      const type = (order.type || "").toUpperCase() || "ORDER";
      return `<div class="price-item">
        <span class="price-item-name">${item} <small style="color:var(--muted)">${type} ×${formatNum(qty)}</small></span>
        <span class="price-item-val">${formatMoney(price)} ₿/u</span>
      </div>`;
    }).join("") || "<p style='color:var(--muted)'>No orders available.</p>";
    el.marketOrdersStatus.hidden = true;
  } catch {
    el.marketOrdersStatus.textContent = "Could not load order data.";
    el.marketOrdersStatus.classList.add("error");
  }

  // Also update topbar stats
  loadMarketStats();
}

function copyMarketReport() {
  const econ = state.marketData.econ;
  const prices = state.marketData.prices || [];
  const orders = state.marketData.orders || [];

  let report = `# War Era Market Intelligence Report\n`;
  report += `Generated: ${new Date().toUTCString()}\n\n`;

  report += `## Economic Overview (Last 24 Hours)\n`;
  if (econ) {
    report += `- Average wage: ${formatMoney(econ.avgWage)} BTC\n`;
    report += `- Total wages paid: ${formatMoney(econ.totalWages)} BTC across ${econ.wageCount} transactions\n`;
    report += `- Trade volume: ${formatMoney(econ.tradeVol)} BTC across ${econ.tradeCount} trades\n\n`;
  } else {
    report += `No economic data available.\n\n`;
  }

  report += `## Top Commodity Prices\n`;
  for (const item of prices.slice(0, 15)) {
    report += `- ${item.itemCode || item.name || "?"}: ${formatMoney(item.price || 0)} BTC\n`;
  }

  report += `\n## Top Trading Orders\n`;
  for (const order of orders.slice(0, 10)) {
    const item = order.itemCode || order.item || order.name || "?";
    const qty = order.quantity || order.amount || 0;
    const price = order.price || 0;
    const type = order.type || "ORDER";
    report += `- ${type} ${item} ×${formatNum(qty)} @ ${formatMoney(price)} BTC/unit\n`;
  }

  navigator.clipboard.writeText(report).then(() => showToast("Market report copied."));
}

// =====================================================
// JOBS
// =====================================================

async function loadJobs(reset = true) {
  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) return;

  el.jobsStatus.hidden = false;
  el.jobsStatus.textContent = "Loading job offers...";

  if (reset) { state.jobs = []; state.jobCursor = null; }

  try {
    const payload = { limit: 50, cursor: reset ? undefined : state.jobCursor };
    const result = await fetchTrpc("workOffer.getWorkOffersPaginated", payload, apiKey);
    const data = unwrapTrpcResult(result);
    const items = Array.isArray(data) ? data : (data?.items || data?.offers || []);
    state.jobCursor = data?.nextCursor || null;
    state.jobs = reset ? items : [...state.jobs, ...items];
    el.jobsStatus.hidden = true;
    renderJobs();
  } catch (err) {
    el.jobsStatus.textContent = "Could not load jobs: " + (err.message || "Unknown error");
    el.jobsStatus.classList.add("error");
  }

  el.loadMoreJobsButton.hidden = !state.jobCursor;
}

function renderJobs() {
  const keyword = (el.jobSearch?.value || "").trim().toLowerCase();
  let jobs = state.jobs;
  if (keyword) {
    jobs = jobs.filter(j =>
      (j.companyName || "").toLowerCase().includes(keyword) ||
      (j.skill || j.type || "").toLowerCase().includes(keyword) ||
      (j.description || "").toLowerCase().includes(keyword)
    );
  }

  el.jobsList.innerHTML = "";
  if (jobs.length === 0) {
    el.jobsList.innerHTML = `<p style="color:var(--muted)">No job offers found.</p>`;
    return;
  }

  for (const job of jobs) {
    const card = document.createElement("div");
    card.className = "job-card";

    const company = job.companyName || job.company?.name || "Unknown Company";
    const skill = job.skill || job.skillName || job.type || "General";
    const wage = job.wage || job.salary || job.pay || 0;
    const currency = job.currency || "BTC";
    const slots = job.openSlots || job.slots || job.count || 1;
    const minSkill = job.minSkill || job.requiredLevel || job.level || 0;
    const companyId = job.companyId || job.company?._id || job.company?.id || "";

    card.innerHTML = `
      <p class="job-company">${company}</p>
      <p class="job-title">${skill} Worker</p>
      <div class="job-details">
        <span class="job-chip wage">💰 ${formatMoney(wage)} ${currency}/hit</span>
        <span class="job-chip">📋 ${slots} slot${slots !== 1 ? "s" : ""}</span>
        ${minSkill ? `<span class="job-chip">⭐ Min. skill ${minSkill}</span>` : ""}
      </div>
      <div class="job-actions">
        ${companyId ? `<button class="job-open-btn" data-company="${companyId}">View Company</button>` : ""}
        <button class="job-open-btn copy-job-btn" data-wage="${wage}" data-company="${company}" data-skill="${skill}">📋 Copy</button>
      </div>`;

    card.querySelector("[data-company]")?.addEventListener("click", function () {
      const cid = this.dataset.company;
      if (cid) window.open(`https://app.warera.io/company/${cid}`, "_blank");
    });

    card.querySelector(".copy-job-btn")?.addEventListener("click", function () {
      const text = `Job Offer — ${this.dataset.skill} at ${this.dataset.company}: ${formatMoney(this.dataset.wage)} BTC/hit`;
      navigator.clipboard.writeText(text).then(() => showToast("Job brief copied."));
    });

    el.jobsList.append(card);
  }
}

function copyJobsReport() {
  const jobs = state.jobs;
  let report = `# War Era Job Market Report\n`;
  report += `Generated: ${new Date().toUTCString()}\n`;
  report += `Total offers: ${jobs.length}\n\n`;

  const byWage = [...jobs].sort((a, b) => (Number(b.wage || 0)) - (Number(a.wage || 0)));
  report += `## Top Paying Offers\n`;
  for (const job of byWage.slice(0, 20)) {
    const company = job.companyName || job.company?.name || "Unknown";
    const skill = job.skill || job.type || "General";
    const wage = job.wage || 0;
    report += `- ${company} — ${skill}: ${formatMoney(wage)} BTC/hit\n`;
  }

  navigator.clipboard.writeText(report).then(() => showToast("Jobs report copied."));
}

// =====================================================
// LOOKUPS & RESOLVERS
// =====================================================

async function ensureLookups(apiKey) {
  if (state.lookupsReadyForKey === apiKey) return;
  setStatus("Loading reference data...");

  const [countriesResult, regionsResult] = await Promise.all([
    fetchTrpc("country.getAllCountries", {}, apiKey),
    fetchTrpc("region.getRegionsObject", {}, apiKey),
  ]);

  const countries = unwrapTrpcResult(countriesResult);
  const regions = unwrapTrpcResult(regionsResult);

  state.lookups.countriesById.clear();
  state.lookups.countryIdsByName.clear();
  state.lookups.regionsById.clear();
  state.lookups.battlesById.clear();

  if (Array.isArray(countries)) {
    for (const country of countries) {
      const id = country._id || country.id;
      if (!id) continue;
      state.lookups.countriesById.set(id, country);
      state.lookups.countryIdsByName.set(normalizeNameKey(country.name), id);
      if (country.code) state.lookups.countryIdsByName.set(normalizeNameKey(country.code), id);
    }
  }

  if (regions && typeof regions === "object") {
    for (const [id, region] of Object.entries(regions)) {
      state.lookups.regionsById.set(id, region);
    }
  }

  populateCountryOptions();
  state.lookupsReadyForKey = apiKey;
}

function populateCountryOptions() {
  const fragment = document.createDocumentFragment();
  const countries = [...state.lookups.countriesById.values()]
    .filter(c => c.name).sort((a, b) => a.name.localeCompare(b.name));
  for (const country of countries) {
    const option = document.createElement("option");
    option.value = country.name;
    if (country.code) option.label = country.code.toUpperCase();
    fragment.append(option);
  }
  el.countryOptions.textContent = "";
  el.countryOptions.append(fragment);
}

async function resolveBattlesForEvents(events, apiKey) {
  const battleIds = [...new Set(events.map(getBattleId).filter(Boolean))]
    .filter(id => !state.lookups.battlesById.has(id));
  if (!battleIds.length) return;
  await Promise.all(battleIds.map(async battleId => {
    try {
      const result = await fetchTrpc("battle.getById", { battleId }, apiKey);
      const battle = unwrapTrpcResult(result);
      if (battle && typeof battle === "object") state.lookups.battlesById.set(battleId, battle);
    } catch { state.lookups.battlesById.set(battleId, null); }
  }));
}

async function resolveUsersForEvents(events, apiKey) {
  const userIds = [...new Set(events.map(e => getEventData(e).user).filter(Boolean))]
    .filter(id => !state.lookups.usersById.has(id));
  if (!userIds.length) return;
  await Promise.all(userIds.map(async userId => {
    try {
      const result = await fetchTrpc("user.getUserLite", { userId }, apiKey);
      const user = unwrapTrpcResult(result);
      if (user && typeof user === "object") state.lookups.usersById.set(userId, user);
    } catch { state.lookups.usersById.set(userId, null); }
  }));
}

async function resolveUsersForArticles(articles, apiKey) {
  const userIds = [...new Set(articles.map(a => a.author).filter(Boolean))]
    .filter(id => !state.lookups.usersById.has(id));
  if (!userIds.length) return;
  await Promise.all(userIds.map(async userId => {
    try {
      const result = await fetchTrpc("user.getUserLite", { userId }, apiKey);
      const user = unwrapTrpcResult(result);
      if (user) state.lookups.usersById.set(userId, user);
    } catch { state.lookups.usersById.set(userId, null); }
  }));
}

// =====================================================
// FETCH HELPERS
// =====================================================

async function fetchTrpc(method, input, apiKey) {
  const url = `${TRPC_BASE}/${method}?input=${encodeURIComponent(JSON.stringify(removeUndefined(input)))}`;
  return fetchJson(url, { headers: { "x-api-key": apiKey } });
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (location.protocol === "file:") {
      throw new Error("Serve this over http://localhost to use the gateway.");
    }
    throw error;
  }
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401) throw new Error("Invalid API key — check and try again.");
    throw new Error(`Gateway ${response.status}: ${text.slice(0, 140)}`);
  }
  if (!text) return null;
  const json = JSON.parse(text);
  if (json?.error?.message) throw new Error(json.error.message);
  return json;
}

function normalizeEvents(result) {
  const data = unwrapTrpcResult(result);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizeCursor(result) {
  const data = unwrapTrpcResult(result);
  return data?.nextCursor || data?.cursor || data?.next || null;
}

function unwrapTrpcResult(result) {
  if (Array.isArray(result)) {
    return result[0]?.result?.data?.json ?? result[0]?.result?.data ?? result[0]?.json ?? result[0];
  }
  return result?.result?.data?.json ?? result?.result?.data ?? result?.json ?? result;
}

// =====================================================
// RENDER — TIMELINE
// =====================================================

function renderTimeline() {
  const visibleEvents = filterEventsByTime(state.events);
  el.eventList.textContent = "";

  if (visibleEvents.length === 0) {
    el.loadMoreButton.hidden = !state.cursor;
    el.feedMeta.textContent = `${state.events.length} event${state.events.length === 1 ? "" : "s"} loaded.`;
    setStatus(state.events.length === 0 ? "No events found for the current filters." : "No loaded events match the time range.");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const event of visibleEvents) fragment.append(renderEventCard(event));
  el.eventList.append(fragment);
  el.loadMoreButton.hidden = !state.cursor;
  el.feedMeta.textContent = `${visibleEvents.length} shown — ${state.events.length} loaded.`;
  clearStatus();
}

function filterEventsByTime(events) {
  const start = parseLocalDateTime(el.startTimeInput.value);
  const end = parseLocalDateTime(el.endTimeInput.value);
  return events.filter(event => {
    const timestamp = getEventTimestamp(event);
    if (!timestamp) return !start && !end;
    const time = new Date(timestamp).getTime();
    if (Number.isNaN(time)) return !start && !end;
    if (start && time < start.getTime()) return false;
    if (end && time > end.getTime()) return false;
    return true;
  });
}

function renderEventCard(event) {
  const node = el.template.content.firstElementChild.cloneNode(true);
  const eventData = getEventData(event);
  const eventType = event.type || event.eventType || eventData.type || event.name || "event";
  const timestamp = getEventTimestamp(event);
  const eventLink = getWarEraLink(event, eventData);

  node.querySelector(".event-type").textContent = formatEventType(eventType);
  node.querySelector(".event-title").textContent = buildEventTitle(event, eventType, eventData);
  node.querySelector(".event-summary").textContent = buildEventSummary(event, eventData);
  node.querySelector(".event-write-button").dataset.eventId = event._id || event.id || "";

  const linkElement = node.querySelector(".event-link");
  if (eventLink) { linkElement.href = eventLink; } else { linkElement.hidden = true; }

  const timeElement = node.querySelector(".event-time");
  timeElement.textContent = formatDate(timestamp);
  const parsedTime = timestamp ? new Date(timestamp) : null;
  if (parsedTime && !Number.isNaN(parsedTime.getTime())) timeElement.dateTime = parsedTime.toISOString();

  const details = node.querySelector(".event-details");
  for (const item of buildDetails(event, eventData)) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = item.label;
    value.textContent = item.value;
    row.append(term, value);
    details.append(row);
  }

  return node;
}

// =====================================================
// RENDER — ARTICLES
// =====================================================

function renderArticles() {
  const keyword = el.articleSearch.value.trim().toLowerCase();
  let articles = state.articles;
  if (keyword) {
    articles = articles.filter(a =>
      a.title?.toLowerCase().includes(keyword) ||
      a.content?.toLowerCase().includes(keyword)
    );
  }

  el.articleList.innerHTML = "";
  for (const article of articles) {
    const node = el.articleTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".article-category").textContent = article.category || "Unknown";
    node.querySelector(".article-title").textContent = article.title || "Untitled";
    const authorName = nameUser(article.author) || "Unknown Author";
    node.querySelector(".article-meta").textContent = `${authorName} · ${article.language || "?"} · ${formatDate(article.createdAt)}`;
    node.querySelector(".article-stats").textContent = `Score: ${article.score || 0}`;

    node.querySelector(".article-open").addEventListener("click", () => {
      window.open(`https://app.warera.io/article/${article._id}`, "_blank");
    });

    node.querySelector(".article-read").addEventListener("click", () => {
      el.readerTitle.textContent = article.title || "Untitled";
      el.readerAuthor.textContent = `By ${nameUser(article.author) || "Unknown Author"}`;
      el.readerContent.innerHTML = article.content || "<p>No content available.</p>";

      el.readerContent.querySelectorAll("a").forEach(link => {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      });

      el.readerContent.querySelectorAll("iframe").forEach(frame => {
        frame.style.width = "100%";
        frame.style.maxWidth = "100%";
        frame.style.aspectRatio = "16/9";
        frame.style.height = "auto";
      });

      el.readerModal.classList.remove("hidden");
    });

    el.articleList.append(node);
  }

  if (limitter < 10) {
    el.articleFeedMeta.textContent = "indexing....";
    el.articleFeedMeta.classList.remove("loadedPulse");
    el.articleFeedMeta.classList.add("indexing");
  } else {
    el.articleFeedMeta.textContent = `${articles.length} articles loaded`;
    el.articleFeedMeta.classList.remove("indexing");
    el.articleFeedMeta.classList.remove("loadedPulse");
    void el.articleFeedMeta.offsetWidth;
    el.articleFeedMeta.classList.add("loadedPulse");
    el.articleFeedMeta.addEventListener("animationend", () => {
      el.articleFeedMeta.classList.remove("loadedPulse");
    }, { once: true });
  }

  el.loadMoreArticlesButton.hidden = !state.articleCursor;
}

// =====================================================
// EVENT CARD ACTIONS
// =====================================================

async function handleTimelineAction(event) {
  const button = event.target.closest(".event-write-button");
  if (!button) return;
  const eventId = button.dataset.eventId;
  const timelineEvent = state.events.find(item => (item._id || item.id) === eventId);
  if (!timelineEvent) return;
  const news = buildArticleSeed(timelineEvent);
  await navigator.clipboard.writeText(news);
  showToast("News brief copied to clipboard.");
}

// =====================================================
// EVENT DATA HELPERS
// =====================================================

function getEventData(event) {
  return event.data && typeof event.data === "object" ? event.data : {};
}

function getEventTimestamp(event) {
  return event.createdAt || event.date || event.time || event.timestamp;
}

function getBattleId(event) {
  const eventData = getEventData(event);
  return event.battleId || event.battle?.id || eventData.battle || "";
}

// =====================================================
// PICK (randomized but non-repeating)
// =====================================================

const __pickMemory = new Map();

function pick(...choices) {
  if (choices.length <= 1) return choices[0] ?? "";
  const key = choices.join("||");
  const last = __pickMemory.get(key);
  const available = choices.filter(item => item !== last);
  const chosen = available[Math.floor(Math.random() * available.length)];
  __pickMemory.set(key, chosen);
  return chosen;
}

// =====================================================
// BUILD EVENT TITLE
// =====================================================

function buildEventTitle(event, eventType, eventData) {
  if (event.title) return event.title;
  if (event.message) return event.message;
  if (event.description) return event.description;

  if (eventType === "countryMoneyTransfer") {
    const [from, to] = collectCountryIds(event, eventData).map(nameCountry);
    if (from && to) return `${from} transferred ${formatMoney(eventData.money)} to ${to}`;
  }
  if (eventType === "allianceFormed") {
    const [first, second] = collectCountryIds(event, eventData).map(nameCountry);
    if (first && second) return `${first} formed an alliance with ${second}`;
  }
  if (eventType === "allianceBroken") {
    const [first, second] = collectCountryIds(event, eventData).map(nameCountry);
    if (first && second) return `${first} broke its alliance with ${second}`;
  }
  if (eventType === "warDeclared") {
    const attacker = nameCountry(eventData.attackerCountry);
    const defender = nameCountry(eventData.defenderCountry);
    if (attacker && defender) return `${attacker} declared war on ${defender}`;
  }
  if (eventType === "battleOpened") {
    const attacker = nameCountry(eventData.attackerCountry);
    const defender = nameCountry(eventData.defenderCountry);
    const region = nameRegion(eventData.defenderRegion);
    if (attacker && defender && region) return `${attacker} opened a battle against ${defender} in ${region}`;
    if (attacker && defender) return `${attacker} opened a battle against ${defender}`;
  }
  if (eventType === "battleEnded") {
    const winner = eventData.wonBy === "attacker" ? nameCountry(eventData.attackerCountry) : nameCountry(eventData.defenderCountry);
    const loser = eventData.wonBy === "attacker" ? nameCountry(eventData.defenderCountry) : nameCountry(eventData.attackerCountry);
    const region = nameRegion(eventData.defenderRegion || eventData.attackerRegion);
    if (winner && loser && region) return `${winner} defeated ${loser} in ${region}`;
    if (winner && loser) return `${winner} defeated ${loser}`;
  }
  if (eventType === "newPresident") {
    const country = nameCountry(eventData.country);
    const president = nameUser(eventData.user);
    if (president && country) return `${president} elected president of ${country}`;
    if (country) return `New president elected in ${country}`;
  }
  if (eventType === "regionTransfer") {
    const [from, to] = collectCountryIds(event, eventData).map(nameCountry);
    const region = nameRegion(eventData.region) || nameRegion(eventData.regionId);
    if (from && to && region) return `${from} transferred ${region} to ${to}`;
    if (from && to) return `${from} transferred a region to ${to}`;
  }
  if (eventType === "depositDiscovered") {
    const resource = eventData.itemCode || "resource";
    const region = nameRegion(eventData.region) || nameRegion(eventData.regionId);
    return region ? `${resource} deposit discovered in ${region}` : `${resource} deposit discovered`;
  }
  if (eventType === "depositDepleted") {
    const resource = eventData.itemCode || "resource";
    const region = nameRegion(eventData.region) || nameRegion(eventData.regionId);
    return region ? `${resource} deposit depleted in ${region}` : `${resource} deposit depleted`;
  }
  if (eventType === "systemRevolt") {
    const region = nameRegion(eventData.region) || nameRegion(eventData.regionId);
    return region ? `Revolt erupted in ${region}` : "Automatic revolt started";
  }
  if (eventType === "regionLiberated") {
    const [liberator, recipient] = collectCountryIds(event, eventData).map(nameCountry);
    const region = nameRegion(eventData.regionId) || nameRegion(eventData.region);
    if (liberator && recipient && region) return `${liberator} liberated ${region} for ${recipient}`;
    return "Region liberated";
  }
  if (eventType === "revolutionStarted") {
    const country = nameCountry(eventData.countryId) || nameCountry(eventData.country);
    return country ? `Revolution started in ${country}` : "Revolution started";
  }
  if (eventType === "revolutionEnded") {
    const country = nameCountry(eventData.countryId) || nameCountry(eventData.country);
    return country ? `The revolution in ${country} has ended` : "Revolution ended";
  }
  if (eventType === "financedRevolt") {
    const region = nameRegion(eventData.regionId);
    return region ? `Revolt financed in ${region}` : "Financed revolt";
  }
  if (eventType === "peaceMade") {
    const countryNames = collectCountryIds(event, eventData).map(nameCountry).filter(Boolean);
    if (countryNames.length > 0) return `${uniqueValues(countryNames).join(" and ")} made peace`;
  }
  if (eventType === "allianceMemberJoined") {
    const country = nameCountry(eventData.country);
    const alliance = eventData.allianceName;
    if (country && alliance) return `${country} joined ${alliance}`;
    if (country) return `${country} joined an alliance`;
  }
  if (eventType === "defensivePactFormed") {
    const [countryA, countryB] = collectCountryIds(event, eventData).map(nameCountry);
    if (countryA && countryB) return `${countryA} signed defensive pact with ${countryB}`;
    return "Defensive pact signed";
  }

  const battleId = getBattleId(event);
  if (battleId) { const n = formatBattleName(battleId); if (n) return `${formatEventType(eventType)}: ${n}`; }
  const regionName = nameRegion(eventData.region || eventData.defenderRegion);
  if (regionName) return `${formatEventType(eventType)}: ${regionName}`;
  return formatEventType(eventType);
}

// =====================================================
// BUILD EVENT SUMMARY (keep existing full logic)
// =====================================================

function buildEventSummary(event, eventData) {
  const eventType = event.type || event.eventType || eventData.type || event.name || "event";
  const countryNames = collectCountryIds(event, eventData).map(nameCountry).filter(Boolean);
  const regionName = nameRegion(eventData.region || eventData.defenderRegion);

  if (eventType === "countryMoneyTransfer") {
    const [from, to] = collectCountryIds(event, eventData).map(nameCountry);
    if (from && to) return pick(
      `${from} has transferred ${formatMoney(eventData.money)} in funds to ${to}.`,
      `Financial records indicate a transfer of ${formatMoney(eventData.money)} from ${from} to ${to}.`,
      `${formatMoney(eventData.money)} has reportedly been transferred from ${from} to ${to}.`,
      `Authorities have confirmed a financial transfer worth ${formatMoney(eventData.money)} from ${from} to ${to}.`
    );
  }

  if (eventType === "allianceFormed" || eventType === "allianceBroken") {
    const [first, second] = collectCountryIds(event, eventData).map(nameCountry);
    const allianceName = eventData.allianceName || eventData.alliance?.name || eventData.alliance;
    if (first && second && allianceName) {
      if (eventType === "allianceFormed") return pick(
        `${first} and ${second} have formally joined the ${allianceName} alliance.`,
        `A new diplomatic chapter has begun as ${first} and ${second} officially enter the ${allianceName} alliance.`,
        `${first} and ${second} have announced their participation in the ${allianceName} alliance.`
      );
      return pick(
        `${first} and ${second} have withdrawn from the ${allianceName} alliance.`,
        `${first} and ${second} have officially left the ${allianceName} alliance.`,
        `The partnership between ${first} and ${second} inside the ${allianceName} alliance has come to an end.`
      );
    }
    if (first && second) {
      if (eventType === "allianceFormed") return pick(
        `${first} and ${second} have entered into a formal alliance.`,
        `Diplomatic negotiations have resulted in an alliance between ${first} and ${second}.`,
        `${first} and ${second} have announced a new strategic partnership.`
      );
      return pick(
        `The alliance between ${first} and ${second} has officially come to an end.`,
        `${first} and ${second} are no longer formally allied.`,
        `Diplomatic ties between ${first} and ${second} have been dissolved.`
      );
    }
  }

  if (eventType === "battleOpened") {
    const attacker = nameCountry(eventData.attackerCountry);
    const defender = nameCountry(eventData.defenderCountry);
    const attackerRegion = nameRegion(eventData.attackerRegion);
    const defenderRegion = nameRegion(eventData.defenderRegion);
    if (attacker && defender && attackerRegion && defenderRegion) return pick(
      `${attacker} has launched a military offensive from ${attackerRegion} against ${defender}'s position in ${defenderRegion}.`,
      `Armed conflict has broken out as forces from ${attacker} begin operations against ${defender} near ${defenderRegion}.`,
      `Military operations are now underway after ${attacker} opened a new offensive targeting ${defender} in ${defenderRegion}.`,
      `Fresh fighting has erupted between ${attacker} and ${defender}, with clashes reported around ${defenderRegion}.`,
      `Battlefield reports indicate that ${attacker} has initiated an assault toward ${defenderRegion}, bringing a new front into active conflict.`
    );
    if (attacker && defender) return pick(
      `Hostilities have broken out between ${attacker} and ${defender}.`,
      `Military operations have commenced as ${attacker} launches an offensive against ${defender}.`,
      `Fresh fighting has erupted between ${attacker} and ${defender}.`,
      `Reports confirm that armed conflict has begun between ${attacker} and ${defender}.`,
      `${attacker} has opened a new military offensive against ${defender}.`
    );
  }

  if (eventType === "battleEnded") {
    const winnerSide = eventData.wonBy === "attacker" ? "attacker" : "defender";
    const winner = winnerSide === "attacker" ? nameCountry(eventData.attackerCountry) : nameCountry(eventData.defenderCountry);
    const loser = winnerSide === "attacker" ? nameCountry(eventData.defenderCountry) : nameCountry(eventData.attackerCountry);
    if (winner && loser) return pick(
      `Military operations have concluded with ${winner} emerging victorious over ${loser}.`,
      `${winner} has secured victory following the conclusion of fighting against ${loser}.`,
      `Latest battlefield reports confirm a victory for ${winner} over ${loser}.`,
      `The battle has come to an end with ${winner} prevailing over ${loser}.`
    );
  }

  if (eventType === "newPresident") {
    const country = nameCountry(eventData.country);
    const president = nameUser(eventData.user);
    if (president && country) return pick(
      `${president} has officially been elected president of ${country}.`,
      `${country} has elected ${president} as its new president.`,
      `Election officials confirmed ${president} as the newly elected president of ${country}.`,
      `${president} will assume the presidency of ${country} following the latest vote.`
    );
    if (country) return pick(
      `${country} has officially elected a new president.`,
      `Election results indicate that ${country} has chosen a new president.`,
      `A new president has been elected in ${country}.`
    );
  }

  if (eventType === "regionTransfer") {
    const [from, to] = collectCountryIds(event, eventData).map(nameCountry);
    const region = nameRegion(eventData.region) || nameRegion(eventData.regionId);
    if (from && to && region) return pick(
      `Control of ${region} has officially been transferred from ${from} to ${to}.`,
      `${region} has formally changed hands following its transfer from ${from} to ${to}.`,
      `Officials have confirmed the transfer of ${region} from ${from} to ${to}.`,
      `The territorial transfer of ${region} from ${from} to ${to} has now been finalized.`
    );
    if (from && to) return pick(
      `A territorial transfer has officially taken place between ${from} and ${to}.`,
      `${from} has transferred territory to ${to}, according to the latest reports.`,
      `Officials confirmed a territorial transfer involving ${from} and ${to}.`
    );
  }

  if (eventType === "allianceMemberJoined") {
    const country = nameCountry(eventData.country);
    const alliance = eventData.allianceName;
    if (country && alliance) return pick(
      `${country} has officially joined the ${alliance} alliance.`,
      `${country} has entered the ranks of the ${alliance} alliance.`,
      `Alliance officials confirmed the admission of ${country} into ${alliance}.`,
      `${country} has become the newest member of the ${alliance} alliance.`
    );
    if (country) return pick(
      `${country} has officially joined a new alliance.`,
      `${country} has announced its entry into a formal alliance.`,
      `Diplomatic developments indicate that ${country} has joined an alliance.`
    );
  }

  if (eventType === "defensivePactFormed") {
    const [countryA, countryB] = collectCountryIds(event, eventData).map(nameCountry);
    if (countryA && countryB) return pick(
      `${countryA} and ${countryB} have signed a new defensive pact.`,
      `A mutual defense agreement has been concluded between ${countryA} and ${countryB}.`,
      `${countryA} and ${countryB} have formalized a new defensive partnership.`
    );
    return pick(`A new defensive pact has been signed.`, `Officials confirmed the conclusion of a new defensive agreement.`);
  }

  if (eventType === "depositDiscovered") {
    const resource = eventData.itemCode || "resource";
    const region = nameRegion(eventData.region) || nameRegion(eventData.regionId);
    if (region) return pick(
      `Authorities have confirmed the discovery of a new ${resource} deposit in ${region}.`,
      `Survey teams have identified a ${resource} deposit in ${region}.`,
      `Geological reports indicate the discovery of ${resource} reserves in ${region}.`
    );
    return pick(
      `Authorities have confirmed the discovery of a new ${resource} deposit.`,
      `Survey teams have reported a newly discovered ${resource} reserve.`
    );
  }

  if (eventType === "depositDepleted") {
    const resource = eventData.itemCode || "resource";
    const region = nameRegion(eventData.region) || nameRegion(eventData.regionId);
    if (region) return pick(
      `The ${resource} deposit in ${region} has reportedly been exhausted.`,
      `Extraction efforts have depleted the ${resource} deposit in ${region}.`,
      `Officials confirmed that the ${resource} deposit in ${region} has run dry.`
    );
    return pick(`A ${resource} deposit has reportedly been exhausted.`, `Known reserves of ${resource} have reportedly been depleted.`);
  }

  if (eventType === "systemRevolt") {
    const region = nameRegion(eventData.region) || nameRegion(eventData.regionId);
    if (region) return pick(
      `Civil unrest has erupted in ${region}, escalating into open revolt.`,
      `Reports from ${region} indicate that widespread unrest has turned into open rebellion.`,
      `${region} has become the center of a growing uprising amid mounting unrest.`
    );
    return pick(`Civil unrest has escalated into open revolt.`, `Reports indicate that an uprising has broken out.`);
  }

  if (eventType === "regionLiberated") {
    const [liberator, recipient] = collectCountryIds(event, eventData).map(nameCountry);
    const region = nameRegion(eventData.regionId) || nameRegion(eventData.region);
    if (liberator && recipient && region) return pick(
      `${liberator} has liberated ${region} before formally returning it to ${recipient}.`,
      `${region} has been liberated by ${liberator} and restored to ${recipient}.`,
      `Officials confirmed that ${region} has been returned to ${recipient} following its liberation by ${liberator}.`
    );
    return pick(`A region has reportedly been liberated.`, `Officials have confirmed the liberation of a contested region.`);
  }

  if (eventType === "revolutionStarted") {
    const country = nameCountry(eventData.countryId) || nameCountry(eventData.country);
    if (country) return pick(
      `A revolution has erupted in ${country} following mounting internal tensions.`,
      `Reports indicate that revolutionary activity has broken out across ${country}.`,
      `${country} has entered a period of open revolutionary unrest.`,
      `Growing instability has escalated into a revolution in ${country}.`
    );
    return pick(`A revolution has erupted.`, `Authorities have confirmed the outbreak of a revolution.`);
  }

  if (eventType === "revolutionEnded") {
    const country = nameCountry(eventData.countryId) || nameCountry(eventData.country);
    if (eventData.wonBy === "attacker") return pick(
      `Revolutionary forces have emerged victorious in ${country}, bringing the conflict to a close.`,
      `Latest reports confirm a revolutionary victory in ${country}.`,
      `The revolution in ${country} has concluded with the insurgent forces prevailing.`
    );
    if (eventData.wonBy === "defender") return pick(
      `Government forces have successfully suppressed the uprising in ${country}.`,
      `Authorities report that the revolution in ${country} has been brought under control.`,
      `Government troops have restored control after defeating revolutionary forces in ${country}.`
    );
    if (country) return pick(`The revolutionary conflict in ${country} has officially come to an end.`, `Fighting linked to the revolution in ${country} has now concluded.`);
    return pick(`The revolution has officially come to an end.`, `Authorities have confirmed the conclusion of the revolutionary conflict.`);
  }

  if (eventType === "financedRevolt") {
    const region = nameRegion(eventData.regionId);
    const occupier = nameCountry(eventData.occupyingCountryId);
    const revolting = nameCountry(eventData.revoltingCountryId);
    if (region && occupier && revolting) return pick(
      `Reports indicate that an externally backed revolt has been launched in ${region} against the occupation by ${occupier} in support of ${revolting}.`,
      `Foreign-backed insurgent activity has reportedly emerged in ${region}, targeting the occupation by ${occupier}.`,
      `An externally financed rebellion has reportedly begun in ${region} against occupying forces from ${occupier}.`
    );
    return pick(`Reports indicate that outside support has financed an armed uprising.`, `Authorities are investigating reports of foreign-backed insurgent activity.`);
  }

  if (eventType === "peaceMade" && countryNames.length > 0) {
    const countries = uniqueValues(countryNames).join(" and ");
    return pick(
      `${countries} have formally signed a peace agreement, bringing hostilities to an end.`,
      `A formal peace agreement has been concluded between ${countries}.`,
      `Hostilities between ${countries} have officially ended following the signing of a peace agreement.`,
      `Diplomatic negotiations have resulted in a peace agreement between ${countries}.`
    );
  }

  if (countryNames.length > 0 && regionName) {
    const countries = uniqueValues(countryNames).join(", ");
    return pick(
      `The latest developments involve ${countries} in and around ${regionName}.`,
      `Fresh reports from ${regionName} concern activities involving ${countries}.`,
      `Attention remains focused on ${regionName}, where developments involving ${countries} continue to unfold.`
    );
  }

  if (countryNames.length > 0) {
    const countries = uniqueValues(countryNames).join(", ");
    return pick(
      `Recent developments involve ${countries}.`,
      `Officials continue to monitor events involving ${countries}.`,
      `Fresh reports concern ongoing developments related to ${countries}.`
    );
  }

  if (regionName) return pick(
    `The latest reports concern developments in ${regionName}.`,
    `Attention remains focused on events unfolding in ${regionName}.`,
    `Fresh information continues to emerge from ${regionName}.`
  );

  return pick(
    `Further details are emerging from the latest reports across the War Era world.`,
    `Additional developments continue to arrive from the global War Era news feed.`,
    `Authorities and observers continue to monitor events unfolding across the War Era world.`,
    `More information is expected as reports continue to arrive from around the world.`
  );
}

// =====================================================
// BUILD DETAILS CHIPS
// =====================================================

function buildDetails(event, eventData) {
  const details = [];
  const countryNames = collectCountryIds(event, eventData).map(nameCountry).filter(Boolean);
  const regionName = nameRegion(event.regionId || event.region?.id || eventData.region || eventData.defenderRegion || eventData.attackerRegion);
  const battleName = formatBattleName(getBattleId(event));

  addDetail(details, "Priority", event.priority);
  addDetail(details, "Money", eventData.money !== undefined ? formatMoney(eventData.money) : "");
  addDetail(details, "Winner", eventData.wonBy ? formatEventType(eventData.wonBy) : "");
  addDetail(details, "Countries", uniqueValues(countryNames).join(", "));
  addDetail(details, "Region", regionName);
  addDetail(details, "Battle", battleName);

  return details.slice(0, 5);
}

function collectCountryIds(event, eventData) {
  return [
    event.countryId, event.country?.id, event.sourceCountry?.id, event.targetCountry?.id,
    event.attackerCountry?.id, event.defenderCountry?.id,
    eventData.country, eventData.sourceCountry, eventData.targetCountry,
    eventData.attackerCountry, eventData.defenderCountry,
    ...(Array.isArray(eventData.countries) ? eventData.countries : []),
    ...(Array.isArray(event.countries) ? event.countries : []),
  ].filter(Boolean);
}

function formatBattleName(battleId) {
  if (!battleId) return "";
  const battle = state.lookups.battlesById.get(battleId);
  if (!battle) return "";
  const attacker = nameCountry(battle.attacker?.country);
  const defender = nameCountry(battle.defender?.country);
  const region = nameRegion(battle.defender?.region);
  const sides = [attacker, defender].filter(Boolean).join(" vs ");
  if (sides && region) return `${sides} in ${region}`;
  if (sides) return sides;
  if (region) return region;
  return "";
}

function nameCountry(id) {
  if (!id) return "";
  return state.lookups.countriesById.get(id)?.name || "";
}

function nameRegion(id) {
  if (!id) return "";
  return state.lookups.regionsById.get(id)?.name || "";
}

function nameUser(id) {
  if (!id) return "";
  return state.lookups.usersById.get(id)?.username || state.lookups.usersById.get(id)?.name || "";
}

function addDetail(details, label, value) {
  if (value === undefined || value === null || value === "") return;
  details.push({ label, value: String(value) });
}

// =====================================================
// BUILD NEWS BRIEF
// =====================================================

function buildArticleSeed(event) {
  const eventData = getEventData(event);
  const eventType = event.type || event.eventType || eventData.type || event.name || "event";
  const headline = buildEventTitle(event, eventType, eventData);
  const summary = buildEventSummary(event, eventData);
  const details = buildDetails(event, eventData).map(item => `• ${item.label}: ${item.value}`).join("\n");
  const link = getWarEraLink(event, eventData);
  const timestamp = getEventTimestamp(event);

  return `# ${headline}

${summary}

${details}
${timestamp ? "\n• Time: " + formatDate(timestamp) : ""}

${link ? "Source: " + link : ""}`;
}

// =====================================================
// WAR ERA LINKS
// =====================================================

function getWarEraLink(event, eventData) {
  const BASE_URL = "https://app.warera.io";
  const battleId = getBattleId(event);
  if (battleId) return `${BASE_URL}/battle/${battleId}`;
  if (eventData.war) return `${BASE_URL}/war/${eventData.war}`;
  if (Array.isArray(eventData.wars) && eventData.wars[0]) return `${BASE_URL}/war/${eventData.wars[0]}`;
  const regionId = eventData.region || eventData.defenderRegion || eventData.attackerRegion;
  if (regionId) return `${BASE_URL}/region/${regionId}`;
  const countryId = collectCountryIds(event, eventData)[0];
  if (countryId) return `${BASE_URL}/country/${countryId}`;
  return "";
}

// =====================================================
// FORMAT HELPERS
// =====================================================

function formatEventType(value) {
  if (value === "peaceMade") return "Peace Made";
  if (value === "battleEnded" || value === "warEnded" || value === "warEndedByBattle" || value === "war_end") return "Battle Ended";
  return String(value)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, l => l.toUpperCase());
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value === undefined || value === null ? "—" : String(value);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount);
}

function formatNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

function parseLocalDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function normalizeNameKey(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

// =====================================================
// STATUS HELPERS
// =====================================================

function setStatus(message, type = "info") {
  el.statusBox.hidden = false;
  el.statusBox.textContent = message;
  el.statusBox.classList.toggle("error", type === "error");
}

function clearStatus() {
  el.statusBox.hidden = true;
  el.statusBox.textContent = "";
  el.statusBox.classList.remove("error");
}

function setControlsDisabled(disabled) {
  el.applyFiltersButton.disabled = disabled;
  el.clearFiltersButton.disabled = disabled;
  el.refreshButton.disabled = disabled;
  el.loadMoreButton.disabled = disabled;
}

// =====================================================
// TOAST NOTIFICATION
// =====================================================

function showToast(message) {
  const existing = document.querySelector(".copy-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "copy-toast";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2800);
}

// =====================================================
// BOOT
// =====================================================

init();
