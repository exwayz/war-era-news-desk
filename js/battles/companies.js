import { S } from "../core/state.js";
import { renderBattleList, battleId, loadBattles, battleTitlePhrase, battleTypeKind, battleTypeKeyword, updateBattleTabPills } from "./battles.js";
import { fmtDate, fmtNum } from "../core/utils.js";
import { playCopy } from "../audio/audio.js";
import { getCountriesInRegion, populateRegionOptions } from "../core/regionClassification.js";
import { apiKey, fetchTrpcApi2, unwrap } from "../core/api.js";
import { offlineResolve } from "../core/resolver.js";
import { ensureLookups } from "../timeline/filters.js";
import { OBJECT_ID_RE } from "../core/constants.js";

const BATTLE_URL_RE = /battle\/([a-f0-9]{24})/i;

export function resetBattleSearchState() {
  S.battleSearchMode=""; S.battleSearchId=""; S.battleSearchCountryId="";
  S.battleSearchRegionIds=[]; S.battleSearchCursor=null; S.battleSearchRegionCursors={}; S.battleSearchLabel=""; S.battleLoadPath="";
  S.battleDateCapped=false;
}

async function applyBattleSearch(raw) {
  if (!raw.trim()) { resetBattleSearchState(); loadBattles(true); return; }
  const urlM = raw.match(BATTLE_URL_RE);
  const isId = urlM ? true : OBJECT_ID_RE.test(raw.trim());
  if (urlM || isId) {
    resetBattleSearchState();
    S.battleSearchId = urlM ? urlM[1] : raw.trim();
    S.battleSearchMode = "id";
    S.battleSearchLabel = "battle #"+S.battleSearchId.slice(-8);
    await loadBattles(true);
    return;
  }
  const q = raw.trim().toLowerCase();
  const k = apiKey();
  if (q) {
    if (k && S.lookupsKey!==k) await ensureLookups(k).catch(()=>{});
    const kwKind = battleTypeKeyword(q);
    if (kwKind) {
      resetBattleSearchState();
      S.battleSearchMode = "keyword";
      S.battleSearch = q;
      S.battleSearchLabel = "keyword “"+raw.trim()+"”";
      await loadBattles(true);
      return;
    }
    const cid = S.lookups.countryIdsByName.get(q);
    if (cid) {
      resetBattleSearchState();
      S.battleSearchCountryId = cid;
      S.battleSearchMode = "country";
      S.battleSearchLabel = "country "+nameCountry(cid);
      await loadBattles(true);
      return;
    }
    const regionCountries = getCountriesInRegion(q);
    if (regionCountries.length) {
      const ids = regionCountries.map(n => S.lookups.countryIdsByName.get(n.toLowerCase())).filter(Boolean);
      if (ids.length) {
        resetBattleSearchState();
        S.battleSearchRegionIds = ids;
        S.battleSearchMode = "region";
        S.battleSearchLabel = "region "+raw.trim();
        await loadBattles(true);
        return;
      }
    }
  }
  resetBattleSearchState();
  renderBattleList();
}

export function nameCountry(id) { if(!id) return ""; return S.lookups.countriesById.get(id)?.name||id?.slice(-6)||""; }
export function nameRegion(id) { if(!id) return ""; return S.lookups.regionsById.get(String(id))?.name||String(id).slice(-6)||""; }
export function nameUser(id) { if(!id) return ""; const u=S.lookups.usersById.get(id)||offlineResolve("user",id); return u?.username||u?.name||""; }
export function nameMu(id) { if(!id) return ""; const m=S.lookups.muById.get(id)||offlineResolve("mu",id); return m?.name||m?.muName||m?.displayName||m?.fullName||""; }

const SCHEME_COLORS = {
  red:        { light: "#782122", normal: "#651C1D", dark: "#531718" },
  deepOrange: { light: "#803025", normal: "#6D2820", dark: "#59211A" },
  orange:     { light: "#7E3E22", normal: "#6B341D", dark: "#572B18" },
  lightOrange:{ light: "#805626", normal: "#6C4920", dark: "#583B1A" },
  amber:      { light: "#705825", normal: "#5F4B1F", dark: "#4E3D1A" },
  yellow:     { light: "#696224", normal: "#58531F", dark: "#484419" },
  olive:      { light: "#5C5E48", normal: "#4E4F3D", dark: "#404132" },
  lime:       { light: "#485B32", normal: "#3D4D2B", dark: "#323F23" },
  lightGreen: { light: "#336131", normal: "#2B5229", dark: "#234322" },
  green:      { light: "#235A37", normal: "#1D4C2F", dark: "#183E26" },
  emerald:    { light: "#236A49", normal: "#1D5A3D", dark: "#184932" },
  teal:       { light: "#1F6558", normal: "#1A564B", dark: "#16463D" },
  cyan:       { light: "#255A5F", normal: "#1F4C51", dark: "#1A3E42" },
  lightBlue:  { light: "#155B91", normal: "#124D7B", dark: "#0E3F64" },
  blue:       { light: "#1E3F88", normal: "#193673", dark: "#152C5E" },
  indigo:     { light: "#362A7C", normal: "#2E2369", dark: "#261D56" },
  purple:     { light: "#4C3076", normal: "#402963", dark: "#352151" },
  violet:     { light: "#5A3274", normal: "#4D2A62", dark: "#3F2350" },
  pink:       { light: "#743265", normal: "#622A55", dark: "#502346" },
  deepPink:   { light: "#7D2939", normal: "#6A2331", dark: "#561C28" },
  brown:      { light: "#59504C", normal: "#4C4341", dark: "#3E3735" },
  sand:       { light: "#58584D", normal: "#4A4B41", dark: "#3D3D36" },
  gray:       { light: "#445561", normal: "#3A4852", dark: "#2F3B43" },
};

export function countryColor(id) {
  if (!id) return "";
  const c = S.lookups.countriesById.get(id);
  if (!c) return "";
  const shades = SCHEME_COLORS[c.scheme];
  if (!shades) return "";
  return shades.light;
}

export async function ensureAlliances(ids, k) {
  const missing = [...new Set(ids)].filter(id => id && !S.lookups.alliancesById.has(id));
  if (!missing.length) return;
  await Promise.all(missing.map(async id => {
    try {
      const r = await fetchTrpcApi2("alliance.getById", { allianceId: id }, k);
      const a = unwrap(r);
      S.lookups.alliancesById.set(id, a || null);
    } catch { S.lookups.alliancesById.set(id, null); }
  }));
}

export function allianceColor(id) {
  const a = S.lookups.alliancesById.get(id);
  const shades = a?.scheme ? SCHEME_COLORS[a.scheme] : null;
  return shades ? shades.light : "";
}

export function allianceName(id) {
  if (!id) return "";
  const a = S.lookups.alliancesById.get(id);
  return a?.name || offlineResolve("alliance", id)?.name || String(id).slice(-6);
}

export function sideAllianceGroups(countryIds) {
  const counts = new Map();
  for (const cid of new Set((countryIds || []).filter(Boolean))) {
    const allianceId = S.lookups.countriesById.get(cid)?.allianceId;
    if (!allianceId) continue;
    counts.set(allianceId, (counts.get(allianceId) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((x, y) => y.count - x.count || (x.id < y.id ? -1 : 1));
}

export function battleSideAllianceCountries(b, orders, side) {
  const isLive = !b?.endedAt || b?.isActive === true || b?.active === true;
  const sideObj = side === "attacker" ? (b?.attacker || {}) : (b?.defender || {});
  if (isLive) {
    const fromMeta = Array.isArray(sideObj.countryOrders) ? sideObj.countryOrders.filter(Boolean) : [];
    if (fromMeta.length) return fromMeta;
    return [...new Set((orders || []).filter(o => (o.side || o._side) === side && o.country).map(o => o.country))];
  }
  const sideId = sideObj.country || b?.[side === "attacker" ? "attackerCountry" : "defenderCountry"] || sideObj.countryId || "";
  return sideId ? [sideId] : [];
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function brightenHex(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return "";
  const mix = v => Math.round(v + (255 - v) * amt);
  return `#${[mix(c.r), mix(c.g), mix(c.b)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function darkenHex(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return "";
  const mix = v => Math.round(v * (1 - amt));
  return `#${[mix(c.r), mix(c.g), mix(c.b)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

export function battleSideColors(b) {
  const atkId = b?.attacker?.country || b.attackerCountry || b.attacker?.countryId;
  const defId = b?.defender?.country || b.defenderCountry || b.defender?.countryId;
  const atkColor = countryColor(atkId) || "var(--blue)";
  const defColor = countryColor(defId) || "var(--red)";
  const atkText = countryColor(atkId) ? brightenHex(atkColor, 0.25) : atkColor;
  const defText = countryColor(defId) ? brightenHex(defColor, 0.25) : defColor;
  const atkBarText = countryColor(atkId) ? darkenHex(atkColor, 0.4) : "rgba(0,0,0,0.55)";
  const defBarText = countryColor(defId) ? darkenHex(defColor, 0.4) : "rgba(0,0,0,0.55)";
  return { atkColor, defColor, atkText, defText, atkBarText, defBarText };
}

export function injectBattleSearchBar() {
  const col = document.querySelector(".battle-list-col");
  if (!col) return;
  const panelHead = col.querySelector(".panel-head");
  if (!panelHead) return;
  const wrap = document.createElement("div");
  wrap.className = "sticky-toolbar battle-toolbar";
  wrap.innerHTML = `
<div class="input-wrap search-bar">
  <input id="battleSearch" type="text" placeholder="Search by battle ID, URL, or name…">
  <button class="clear-btn" id="clearBattleSearch" type="button"><iconify-icon icon="mdi:close" class="lu"></iconify-icon></button>
</div>
<button id="battleLoadMini" class="btn-load-mini" title="Load more battles">More</button>
<button id="copyBattleListBtn" class="btn-icon-sm" title="Copy all listed"><iconify-icon icon="mdi:clipboard-text-outline" class="lu"></iconify-icon></button>
<div class="tab-pill-group">
  <button class="pill-btn active" data-sort="ended">Date <span class="sort-arrow">▼</span></button>
  <button class="pill-btn" data-sort="damage">DMG <span class="sort-arrow">▼</span></button>
</div>
<div class="input-wrap">
  <iconify-icon icon="mdi:earth" class="lu" style="position:absolute;left:5px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--ink-dim);z-index:1;font-size:12px"></iconify-icon>
  <input id="battlesRegionFilter" type="text" list="battlesRegionOptions" placeholder="Region…" style="padding-left:20px">
  <button class="clear-btn" data-clears="battlesRegionFilter" type="button"><iconify-icon icon="mdi:close" class="lu"></iconify-icon></button>
</div>
<input type="date" id="battleDateFrom" title="Ended from">
<input type="date" id="battleDateTo" title="Ended to" disabled>
<button id="resetBattleFiltersBtn" class="btn-icon-sm" title="Reset search, sort and filters"><iconify-icon icon="mdi:close-box" class="lu"></iconify-icon></button>
<datalist id="battlesRegionOptions"></datalist>
`;
  panelHead.insertAdjacentElement("afterend", wrap);
  document.getElementById("battleLoadMini")?.addEventListener("click", () => {
    loadBattles(false);
  });

  const inp = document.getElementById("battleSearch");
  const clr = document.getElementById("clearBattleSearch");
  let searchTimer = null;
  inp.addEventListener("input", () => {
    S.battleSearch = inp.value.trim().toLowerCase();
    renderBattleList();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyBattleSearch(inp.value), 400);
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(searchTimer); applyBattleSearch(inp.value); } });
  clr.addEventListener("click", () => {
    clearTimeout(searchTimer);
    inp.value = "";
    S.battleSearch = "";
    resetBattleSearchState();
    loadBattles(true);
    inp.focus();
  });

  const regionInp = document.getElementById("battlesRegionFilter");
  const regionClr = document.querySelector("[data-clears='battlesRegionFilter']");
  populateRegionOptions(document.getElementById("battlesRegionOptions"));
  let regionTimer = null;
  regionInp?.addEventListener("input", () => {
    S.battleRegionFilter = regionInp.value.replace(/^[^a-zA-Z0-9]*/, "").trim();
    renderBattleList();
    clearTimeout(regionTimer);
    regionTimer = setTimeout(() => loadBattles(true), 400);
  });
  regionClr?.addEventListener("click", () => {
    if (regionInp) {
      regionInp.value = ""; S.battleRegionFilter = "";
      clearTimeout(regionTimer);
      renderBattleList(); loadBattles(true); regionInp.focus();
    }
  });

  const sortBtns = wrap.querySelectorAll("[data-sort]");
  function updateSortArrows() {
    for (const btn of sortBtns) {
      const arr = btn.querySelector(".sort-arrow");
      if (!arr) continue;
      const on = btn.classList.contains("active");
      arr.textContent = on && S.battleSortDir === "asc" ? "▲" : "▼";
      arr.classList.toggle("off", !on);
    }
  }
  for (const btn of sortBtns) {
    btn.addEventListener("click", () => {
      const wasActive = btn.classList.contains("active");
      sortBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      if (wasActive) {
        S.battleSortDir = S.battleSortDir === "desc" ? "asc" : "desc";
      } else {
        S.battleSort = btn.dataset.sort;
        S.battleSortDir = "desc";
      }
      updateSortArrows();
      renderBattleList();
    });
  }
  updateSortArrows();

  const dFrom = document.getElementById("battleDateFrom");
  const dTo = document.getElementById("battleDateTo");
  // The "to" date only makes sense once "from" is set, so it starts disabled
  // and is unlocked only after the user fills the "from" input.
  function syncBattleDateToDisabled() {
    dTo.disabled = !dFrom.value;
    if (!dFrom.value) dTo.value = "";
  }
  // Date range composes with the active search (country / region / keyword)
  // instead of replacing it, so e.g. "France + date range" works together.
  function applyBattleDate() {
    S.battleDateFrom = dFrom.value;
    S.battleDateTo = dTo.value;
    if (S.battleMode !== "history") { S.battleMode = "history"; updateBattleTabPills(); }
    loadBattles(true);
  }
  dFrom.addEventListener("change", () => { syncBattleDateToDisabled(); applyBattleDate(); });
  dTo.addEventListener("change", applyBattleDate);
  syncBattleDateToDisabled();

  // Full reset: clears the search bar, sort, region and date filters back to
  // their default state (history feed, sort by date desc, no filters).
  document.getElementById("resetBattleFiltersBtn")?.addEventListener("click", () => {
    clearTimeout(searchTimer);
    clearTimeout(regionTimer);
    inp.value = "";
    S.battleSearch = "";
    resetBattleSearchState();
    if (regionInp) { regionInp.value = ""; S.battleRegionFilter = ""; }
    dFrom.value = ""; dTo.value = "";
    S.battleDateFrom = ""; S.battleDateTo = "";
    S.battleDateCapped = false;
    syncBattleDateToDisabled();
    S.battleSort = "ended"; S.battleSortDir = "desc";
    sortBtns.forEach(b => b.classList.remove("active"));
    const endedBtn = wrap.querySelector('[data-sort="ended"]');
    if (endedBtn) endedBtn.classList.add("active");
    updateSortArrows();
    loadBattles(true);
    inp.focus();
  });

  document.getElementById("copyBattleListBtn")?.addEventListener("click", () => {
    playCopy();
    const kw = S.battleSearchMode === "id" ? "" : (S.battleSearch||"");
    let list = [...S.battles];
    if (kw) {
      const kwKind = battleTypeKeyword(kw);
      list = list.filter(b => {
        const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId).toLowerCase();
        const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId).toLowerCase();
        if (kwKind && battleTypeKind(b.type) === kwKind) return true;
        const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region).toLowerCase();
        const title = (b.title||b.name||"").toLowerCase();
        const phrase = battleTitlePhrase(b).toLowerCase();
        const type = String(b.type||"").toLowerCase();
        return atk.includes(kw)||def.includes(kw)||reg.includes(kw)||title.includes(kw)||phrase.includes(kw)||type.includes(kw);
      });
    }
    const df = S.battleDateFrom, dt = S.battleDateTo;
    if (df || dt) {
      const fromMs = df ? new Date(df+"T00:00:00").getTime() : 0;
      const toMs = dt ? new Date(dt+"T23:59:59").getTime() : Infinity;
      list = list.filter(b => {
        const e = b.endedAt;
        if (!e) return false;
        const ms = new Date(e).getTime();
        if (isNaN(ms)) return true;
        return ms >= fromMs && ms <= toMs;
      });
    }
    const sortBy = S.battleSort||"ended";
    const sortDir = S.battleSortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortBy === "damage") {
        const aid = battleId(a), bid2 = battleId(b);
        const da = Number(S.battleDamageCache.get(aid) ?? a.totalDamage ?? a.damage ?? 0);
        const db = Number(S.battleDamageCache.get(bid2) ?? b.totalDamage ?? b.damage ?? 0);
        if (!isFinite(da) && !isFinite(db)) return 0;
        if (!isFinite(da)) return 1;
        if (!isFinite(db)) return -1;
        return (da - db) * sortDir;
      }
      const ae = a.endedAt, be = b.endedAt;
      if (!ae && !be) return 0;
      if (!ae) return 1;
      if (!be) return -1;
      return (new Date(be).getTime() - new Date(ae).getTime()) * sortDir;
    });
    const lines = list.map(b => {
      const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId);
      const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId);
      const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region);
      const typePhrase = battleTitlePhrase(b);
      const started = fmtDate(b.createdAt||b.startedAt);
      const ended = fmtDate(b.endedAt);
      const dmg = S.battleDamageCache.get(battleId(b)) ?? b.totalDamage ?? b.damage ?? 0;
      return `[${started} — ${ended}] ${typePhrase}: ${def} vs ${atk}${reg?" in "+reg:""}, ${fmtNum(dmg)} total damage`;
    });
    navigator.clipboard.writeText(lines.join("\n")).then(()=>toast("Battle list copied."));
  });
}
