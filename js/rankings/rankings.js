import { S } from "../core/state.js";
import { apiKey, fetchTrpc, fetchTrpcApi2, unwrap } from "../core/api.js";
import { fmtNum } from "../core/utils.js";
import { toast } from "../ui/toast.js";
import * as cap from "../core/captureReport.js";
import { highlightUserData } from "../core/profileHighlighter.js";

const CATEGORIES = {
  weekly: {
    label: "Weekly Damages",
    rankings: [
      { key: "weeklyUserDamages",    title: "Users",           type: "user"    },
      { key: "muWeeklyDamages",      title: "Military Units",  type: "mu"      },
      { key: "weeklyCountryDamages", title: "Countries",       type: "country" },
      { key: "allianceWeeklyDamages",title: "Alliances",       type: "alliance"},
    ],
  },
  users: {
    label: "Users",
    rankings: [
      { key: "userDamages",     title: "Damages",     type: "user"    },
      { key: "userWealth",      title: "Wealth",      type: "user"    },
      { key: "userTerrain",     title: "Grounds",     type: "user"    },
      { key: "userSubscribers", title: "Subscribers",  type: "user"    },
    ],
  },
  mu: {
    label: "MUs",
    rankings: [
      { key: "muDamages",    title: "Damages",     type: "mu" },
      { key: "muWealth",     title: "Wealth",      type: "mu" },
      { key: "muTerrain",    title: "Grounds",     type: "mu" },
      { key: "muReputation", title: "Reputations", type: "mu" },
    ],
  },
  countries: {
    label: "Countries",
    rankings: [
      { key: "countryDamages",          title: "Damages",          type: "country" },
      { key: "countryWealth",           title: "Wealth",           type: "country" },
      { key: "countryDevelopment",      title: "Developments",     type: "country" },
      { key: "countryActivePopulation", title: "Active Population",type: "country" },
    ],
  },
  alliances: {
    label: "Alliances",
    rankings: [
      { key: "allianceDamages",             title: "Damages",           type: "alliance" },
      { key: "allianceDevelopment",          title: "Development",      type: "alliance" },
      { key: "allianceInitialDevelopment",   title: "Initial Development", type: "alliance" },
      { key: "alliancePopulation",           title: "Populations",      type: "alliance" },
    ],
  },
};

const VALUE_FIELDS = ["value","damage","wealth","terrain","subscribers","reputation","development","population","points","count","amount","total","activePopulation","initialDevelopment"];
const INITIAL_SHOW = 10;
const MAX_ITEMS = 50;
const CONCURRENCY = 6;

async function runBatched(promises, limit) {
  const results = [];
  for (let i = 0; i < promises.length; i += limit) {
    const batch = await Promise.all(promises.slice(i, i + limit).map(fn => fn()));
    results.push(...batch);
  }
  return results;
}

function getValue(item) {
  for (const f of VALUE_FIELDS) {
    const v = Number(item[f]);
    if (Number.isFinite(v) && v !== 0) return v;
  }
  return 0;
}

function getEntityId(item, type) {
  if (type === "user")    return item.userId || item.user;
  if (type === "mu")      return item.muId || item.mu;
  if (type === "country") return item.countryId || item.country;
  if (type === "alliance") return item.allianceId || item.alliance || item._id || item.id;
  return null;
}

function getLookup(type) {
  if (type === "user")    return S.lookups.usersById;
  if (type === "mu")      return S.lookups.muById;
  if (type === "country") return S.lookups.countriesById;
  if (type === "alliance") return S.lookups.alliancesById;
  return null;
}

function getName(type, id, data) {
  if (!data) return id ? `#${String(id).slice(-6)}` : "Unknown";
  if (type === "user")    return data.username || data.name || "Unknown";
  if (type === "mu")      return data.name || data.muName || data.displayName || "Unknown";
  if (type === "country") return data.name || "Unknown";
  if (type === "alliance") return data.allianceName || data.name || "Unknown";
  return "Unknown";
}

function getAvatarHtml(type, id, data) {
  if (type === "country") {
    const code = (data?.shortCode || data?.code || data?.iso || data?.iso2 || "").toLowerCase();
    if (code) return `<img class="rk-avatar" src="https://flagcdn.com/${code}.svg" alt="" loading="lazy">`;
    return "";
  }
  const url = data?.avatarUrl || data?.avatar || "";
  if (url) return `<img class="rk-avatar rk-avatar--round" src="${url}" alt="" loading="lazy">`;
  return `<span class="rk-avatar rk-avatar--initials">${(getName(type, id, data).charAt(0) || "?").toUpperCase()}</span>`;
}

const _cache = {};
const _loaded = {};

async function fetchRanking(rankingType, k) {
  try {
    const r = await fetchTrpc("ranking.getRanking", { rankingType }, k);
    const d = unwrap(r);
    if (Array.isArray(d)) return d.slice(0, MAX_ITEMS);
    if (d?.items) return d.items.slice(0, MAX_ITEMS);
    return [];
  } catch {
    try {
      const r = await fetchTrpcApi2("ranking.getRanking", { rankingType }, k);
      const d = unwrap(r);
      if (Array.isArray(d)) return d.slice(0, MAX_ITEMS);
      if (d?.items) return d.items.slice(0, MAX_ITEMS);
      return [];
    } catch {
      return [];
    }
  }
}

async function resolveUnknownEntities(items, type, k) {
  const map = getLookup(type);
  if (!map) return;
  const unknown = [];
  for (const item of items) {
    const id = getEntityId(item, type);
    if (id && !map.has(id)) unknown.push(id);
  }
  if (!unknown.length) return;
  const deduped = [...new Set(unknown)];
  if (type === "user") {
    await Promise.all(deduped.map(async uid => {
      try { const r = unwrap(await fetchTrpc("user.getUserLite", { userId: uid }, k)); if (r) map.set(uid, r); } catch {}
    }));
  } else if (type === "mu") {
    await Promise.all(deduped.map(async mid => {
      try { const r = unwrap(await fetchTrpc("mu.getById", { muId: mid }, k)); if (r) map.set(mid, r); } catch {}
    }));
  } else if (type === "country") {
    await Promise.all(deduped.map(async cid => {
      try { const r = unwrap(await fetchTrpc("country.getById", { countryId: cid }, k)); if (r) map.set(cid, r); } catch {}
    }));
  } else if (type === "alliance") {
    await Promise.all(deduped.map(async aid => {
      try { const r = unwrap(await fetchTrpcApi2("alliance.getById", { allianceId: aid }, k)); if (r) map.set(aid, r); } catch {}
    }));
  }
}

function buildRow(item, type, index) {
  const id = getEntityId(item, type);
  const data = id ? getLookup(type)?.get(id) : null;
  const name = getName(type, id, data);
  const val = getValue(item);
  const avatar = getAvatarHtml(type, id, data);
  const row = document.createElement("div");
  row.className = "rk-row";
  row.innerHTML = `
    <span class="rk-rank">${index + 1}</span>
    ${avatar}
    <span class="rk-name" title="${name.replace(/"/g,"&quot;")}">${name}</span>
    <span class="rk-val">${fmtNum(val)}</span>
  `;
  return row;
}

function renderCellList(entry, container) {
  container.innerHTML = "";
  if (!entry.items.length) {
    container.innerHTML = '<p class="rk-empty">Loading data…</p>';
    return;
  }
  const showCount = Math.min(entry.items.length, entry.showAll ? entry.items.length : INITIAL_SHOW);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < showCount; i++) {
    frag.append(buildRow(entry.items[i], entry.type, i));
  }
  container.append(frag);

  if (!entry.showAll && entry.items.length > INITIAL_SHOW) {
    const btn = document.createElement("button");
    btn.className = "btn-load";
    btn.textContent = `Show More (${Math.min(entry.items.length, MAX_ITEMS) - INITIAL_SHOW} remaining)`;
    btn.addEventListener("click", () => {
      entry.showAll = true;
      renderCellList(entry, container);
    });
    container.append(btn);
  }
}

function renderCategory(catKey) {
  const grid = document.getElementById("rankingsGrid");
  if (!grid) return;
  const status = document.getElementById("rankingsStatus");
  if (status) status.hidden = true;

  const entries = _cache[catKey];
  if (!entries || !entries.length) {
    grid.innerHTML = '<p class="rk-empty" style="padding:40px;text-align:center;color:var(--ink-dim)">No data yet.</p>';
    return;
  }

  grid.innerHTML = "";
  grid.className = "rk-grid";
  entries.forEach((entry, i) => {
    const cell = document.createElement("div");
    cell.className = "rk-cell glass-panel";
    cell.innerHTML = `<h3 class="rk-cell-title">${entry.title}</h3><div class="rk-list"></div>`;
    renderCellList(entry, cell.querySelector(".rk-list"));
    grid.append(cell);
  });
  highlightUserData();
}

let _loading = false;
let _currentCat = "weekly";

export async function loadCategory(catKey) {
  if (_loading) return;
  _loading = true;
  const k = apiKey();
  if (!k) { _loading = false; return; }
  const cat = CATEGORIES[catKey];
  if (!cat) { _loading = false; return; }

  _currentCat = catKey;

  if (_loaded[catKey]) {
    renderCategory(catKey);
    _loading = false;
    return;
  }

  const grid = document.getElementById("rankingsGrid");
  if (!grid) { _loading = false; return; }
  const status = document.getElementById("rankingsStatus");
  if (status) { status.hidden = false; status.textContent = "Loading rankings…"; }

  // Initialize cache slots and render empty cells immediately
  _cache[catKey] = cat.rankings.map(r => ({ type: r.type, title: r.title, items: [], showAll: false }));
  renderCategory(catKey);
  if (status) status.hidden = true;

  // Fetch each ranking independently and render incrementally
  const fetchers = cat.rankings.map(r => () => fetchRanking(r.key, k));
  const results = await runBatched(fetchers, CONCURRENCY);

  await runBatched(cat.rankings.map((r, i) => {
    const items = results[i] || [];
    _cache[catKey][i].items = items;
    return () => resolveUnknownEntities(items, r.type, k);
  }), CONCURRENCY);

  _loaded[catKey] = true;
  renderCategory(catKey);
  _loading = false;
}

export function refreshRankings() {
  Object.keys(_loaded).forEach(k => delete _loaded[k]);
  Object.keys(_cache).forEach(k => delete _cache[k]);
  loadCategory(_currentCat);
}

export function copyRankingsReport() {
  const hasData = Object.keys(CATEGORIES).some(k => _cache[k]?.length);
  if (!hasData) { toast("Rankings not loaded yet. Please wait."); return; }

  let r = `# War Era Rankings Report\nGenerated: ${new Date().toUTCString()}\n`;

  for (const [catKey, cat] of Object.entries(CATEGORIES)) {
    r += `\n\n## ${cat.label}\n`;
    const entries = _cache[catKey];
    if (!entries) { r += "No data.\n"; continue; }
    for (const entry of entries) {
      r += `\n### ${entry.title}\n`;
      const items = entry.items || [];
      for (let i = 0; i < Math.min(items.length, 10); i++) {
        const item = items[i];
        const id = getEntityId(item, entry.type);
        const data = id ? getLookup(entry.type)?.get(id) : null;
        const name = getName(entry.type, id, data);
        const val = getValue(item);
        r += `${i + 1}. ${name} — ${fmtNum(val)}\n`;
      }
    }
  }

  navigator.clipboard.writeText(r).then(() => toast("Rankings report copied."));
}

export function captureRankingsReport() {
  const hasData = Object.keys(CATEGORIES).some(k => _cache[k]?.length);
  if (!hasData) { toast("Rankings not loaded yet. Please wait."); return; }

  const genTime = "Generated: "+new Date().toUTCString();

  for (const [catKey, cat] of Object.entries(CATEGORIES)) {
    const entries = _cache[catKey];
    if (!entries || !entries.length) continue;

    const blocks = entries.map(entry => {
      const items = entry.items || [];
      const rows = items.slice(0, 10).map((item, i) => {
        const id = getEntityId(item, entry.type);
        const data = id ? getLookup(entry.type)?.get(id) : null;
        const name = getName(entry.type, id, data);
        const val = getValue(item);
        return [String(i+1), name, fmtNum(val)];
      });
      return cap.tableBlock(entry.title, ["#","Name","Value"], rows, 10);
    });

    const html = cap.pageOpen("War Era Rankings Report", cat.label, [genTime]) +
      cap.flexRow(
        cap.flexCol(blocks[0] || "") + cap.flexCol(blocks[1] || "")
      ) +
      cap.flexRow(
        cap.flexCol(blocks[2] || "") + cap.flexCol(blocks[3] || "")
      ) +
      cap.pageClose();
    cap.captureHTML(html, "rankings_"+catKey+"_"+cap.ts()+".png");
  }
}

export function initRankings() {
  const pills = document.querySelectorAll("[data-rank-cat]");
  pills.forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.rankCat;
      pills.forEach(b => b.classList.toggle("active", b === btn));
      loadCategory(cat);
    });
  });
}
