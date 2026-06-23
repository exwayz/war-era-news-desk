import { S } from "../core/state.js";
import { apiKey, fetchTrpc, fetchTrpcApi2, unwrap } from "../core/api.js";
import { fmtNum } from "../core/utils.js";
import { toast } from "../ui/toast.js";

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

// Per-category data cache: catKey -> [{ title, type, items }]
const _cache = {};

async function fetchRanking(rankingType, k) {
  try {
    const r = await fetchTrpc("ranking.getRanking", { rankingType }, k);
    const d = unwrap(r);
    if (Array.isArray(d)) return d;
    if (d?.items) return d.items;
    return [];
  } catch {
    try {
      const r = await fetchTrpcApi2("ranking.getRanking", { rankingType }, k);
      const d = unwrap(r);
      if (Array.isArray(d)) return d;
      if (d?.items) return d.items;
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

function renderItemList(items, type, container) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<p class="rk-empty">No data available.</p>';
    return;
  }
  const total = Math.min(items.length, 50);
  const initial = 10;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < Math.min(total, initial); i++) {
    frag.append(buildRow(items[i], type, i));
  }
  container.append(frag);
  if (total > initial) {
    const btn = document.createElement("button");
    btn.className = "btn-load";
    btn.textContent = `Show More (${total - initial} remaining)`;
    btn.addEventListener("click", () => {
      btn.remove();
      const more = document.createDocumentFragment();
      for (let i = initial; i < total; i++) {
        more.append(buildRow(items[i], type, i));
      }
      container.append(more);
    });
    container.append(btn);
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

function renderCell(ranking, data, container) {
  const cell = document.createElement("div");
  cell.className = "rk-cell glass-panel";
  cell.innerHTML = `<h3 class="rk-cell-title">${ranking.title}</h3><div class="rk-list"></div>`;
  const list = cell.querySelector(".rk-list");
  renderItemList(data, ranking.type, list);
  container.append(cell);
}

function renderCategoryFromCache(catKey) {
  const grid = document.getElementById("rankingsGrid");
  if (!grid) return;
  const status = document.getElementById("rankingsStatus");
  if (status) status.hidden = true;

  const cached = _cache[catKey];
  if (!cached || !cached.length) {
    grid.innerHTML = '<p class="rk-empty" style="padding:40px;text-align:center;color:var(--ink-dim)">No data yet.</p>';
    return;
  }

  grid.innerHTML = "";
  grid.className = "rk-grid";
  cached.forEach((r, i) => renderCell(
    { title: CATEGORIES[catKey].rankings[i].title, type: r.type },
    r.items,
    grid
  ));
}

async function fetchAndCacheCategory(catKey, k) {
  const cat = CATEGORIES[catKey];
  if (!cat) return;
  const results = await Promise.allSettled(cat.rankings.map(r => fetchRanking(r.key, k)));
  await Promise.all(cat.rankings.map((r, i) => {
    const data = results[i].status === "fulfilled" ? results[i].value : [];
    return resolveUnknownEntities(data, r.type, k);
  }));
  _cache[catKey] = cat.rankings.map((r, i) => ({
    type: r.type,
    items: results[i].status === "fulfilled" ? results[i].value : [],
  }));
}

let _loading = false;
let _preloadStarted = false;

export async function loadCategory(catKey) {
  if (_loading) return;
  _loading = true;
  const k = apiKey();
  if (!k) { _loading = false; return; }

  const cat = CATEGORIES[catKey];
  if (!cat) { _loading = false; return; }

  const grid = document.getElementById("rankingsGrid");
  if (!grid) { _loading = false; return; }

  // Show cached data instantly if available
  if (_cache[catKey]) {
    renderCategoryFromCache(catKey);
    _loading = false;
    // Re-fetch in background so next view is fresh
    fetchAndCacheCategory(catKey, k).then(() => {
      if (_currentCat === catKey) renderCategoryFromCache(catKey);
    });
    return;
  }

  const status = document.getElementById("rankingsStatus");
  if (status) { status.hidden = false; status.textContent = "Loading rankings…"; }

  await fetchAndCacheCategory(catKey, k);
  renderCategoryFromCache(catKey);
  _currentCat = catKey;
  _loading = false;
}

let _currentCat = "weekly";

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

export function preloadRankings() {
  if (_preloadStarted) return;
  _preloadStarted = true;
  const k = apiKey();
  if (!k) return;
  Promise.all(Object.keys(CATEGORIES).map(key => fetchAndCacheCategory(key, k))).then(() => {
    renderCategoryFromCache(_currentCat);
  });
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

  if (apiKey()) {
    // Deferred preload — waits for critical UI to settle before fetching
    setTimeout(preloadRankings, 3000);
  }
}
