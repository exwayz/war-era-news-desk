import { S } from "../core/state.js";
import { renderBattleList, battleId } from "./battles.js";
import { fmtDate, fmtNum } from "../core/utils.js";
import { playCopy } from "../audio/audio.js";
import { getCountriesInRegion, populateRegionOptions } from "../core/regionClassification.js";

export function nameCountry(id) { if(!id) return ""; return S.lookups.countriesById.get(id)?.name||id?.slice(-6)||""; }
export function nameRegion(id) { if(!id) return ""; return S.lookups.regionsById.get(String(id))?.name||String(id).slice(-6)||""; }
export function nameUser(id) { if(!id) return ""; const u=S.lookups.usersById.get(id); return u?.username||u?.name||""; }
export function nameMu(id) { if(!id) return ""; const m=S.lookups.muById.get(id); return m?.name||m?.muName||m?.displayName||m?.fullName||""; }
export function nameAlliance(id) { if(!id) return ""; const al=S.lookups.alliancesById.get(id); return al?.name||al?.allianceName||""; }
export function nameArticleTitle(id) { if(!id) return ""; return S.lookups.articlesById.get(id)?.title||""; }
export function nameParty(id) { if(!id) return ""; const p=S.lookups.partiesById.get(id); return p?.name||p?.partyName||""; }

export function injectBattleSearchBar() {
  const col = document.querySelector(".battle-list-col");
  if (!col) return;
  const panelHead = col.querySelector(".panel-head");
  if (!panelHead) return;
  const wrap = document.createElement("div");
  wrap.className = "sticky-toolbar";
  wrap.innerHTML = `
<div class="input-wrap search-bar">
  <input id="battleSearch" type="text" placeholder="Search by country or region…">
  <button class="clear-btn" id="clearBattleSearch" type="button"><iconify-icon icon="mdi:close" class="lu"></iconify-icon></button>
</div>
<div class="input-wrap" style="flex:0 0 auto;max-width:130px">
  <iconify-icon icon="mdi:earth" class="lu" style="position:absolute;left:5px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--ink-dim);z-index:1;font-size:12px"></iconify-icon>
  <input id="battlesRegionFilter" type="text" list="battlesRegionOptions" placeholder="Region…" style="padding-left:20px">
  <button class="clear-btn" data-clears="battlesRegionFilter" type="button"><iconify-icon icon="mdi:close" class="lu"></iconify-icon></button>
</div>
<datalist id="battlesRegionOptions"></datalist>
<button id="battleLoadMini" class="btn-load-mini">More</button>
<button id="copyBattleListBtn" class="btn-icon-sm" title="Copy all listed"><iconify-icon icon="mdi:clipboard-text-outline" class="lu"></iconify-icon></button>
`;
  panelHead.insertAdjacentElement("afterend", wrap);
  document.getElementById("battleLoadMini")?.addEventListener("click", () => {
    document.getElementById("loadMoreBattlesButton")?.click();
  });

  const fr = document.createElement("div");
  fr.className = "battle-filter-row";
  fr.innerHTML = `
<div class="tab-pill-group">
  <button class="pill-btn active" data-sort="ended">Date</button>
  <button class="pill-btn" data-sort="damage">DMG</button>
</div>
<input type="date" id="battleDateFrom" title="Ended from">
<input type="date" id="battleDateTo" title="Ended to">
`;
  wrap.insertAdjacentElement("afterend", fr);

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

  const regionInp = document.getElementById("battlesRegionFilter");
  const regionClr = document.querySelector("[data-clears='battlesRegionFilter']");
  populateRegionOptions(document.getElementById("battlesRegionOptions"));
  regionInp?.addEventListener("input", () => {
    S.battleRegionFilter = regionInp.value.replace(/^[^a-zA-Z0-9]*/, "").trim();
    renderBattleList();
  });
  regionClr?.addEventListener("click", () => {
    if (regionInp) { regionInp.value = ""; S.battleRegionFilter = ""; renderBattleList(); regionInp.focus(); }
  });

  const sortBtns = fr.querySelectorAll("[data-sort]");
  for (const btn of sortBtns) {
    btn.addEventListener("click", () => {
      sortBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      S.battleSort = btn.dataset.sort;
      renderBattleList();
    });
  }

  const dFrom = document.getElementById("battleDateFrom");
  const dTo = document.getElementById("battleDateTo");
  dFrom.addEventListener("change", () => {
    S.battleDateFrom = dFrom.value;
    renderBattleList();
  });
  dTo.addEventListener("change", () => {
    S.battleDateTo = dTo.value;
    renderBattleList();
  });

  document.getElementById("copyBattleListBtn")?.addEventListener("click", () => {
    playCopy();
    const kw = S.battleSearch||"";
    let list = [...S.battles];
    if (kw) {
      list = list.filter(b => {
        const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId).toLowerCase();
        const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId).toLowerCase();
        const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region).toLowerCase();
        const title = (b.title||b.name||"").toLowerCase();
        return atk.includes(kw)||def.includes(kw)||reg.includes(kw)||title.includes(kw);
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
    list.sort((a, b) => {
      if (sortBy === "damage") {
        const aid = battleId(a), bid2 = battleId(b);
        const da = Number(S.battleDamageCache.get(aid) ?? a.totalDamage ?? a.damage ?? 0);
        const db = Number(S.battleDamageCache.get(bid2) ?? b.totalDamage ?? b.damage ?? 0);
        if (!isFinite(da) && !isFinite(db)) return 0;
        if (!isFinite(da)) return 1;
        if (!isFinite(db)) return -1;
        return db - da;
      }
      const ae = a.endedAt, be = b.endedAt;
      if (!ae && !be) return 0;
      if (!ae) return 1;
      if (!be) return -1;
      return new Date(be).getTime() - new Date(ae).getTime();
    });
    const lines = list.map(b => {
      const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId);
      const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId);
      const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region);
      const typePhrase = b.type === "war" ? `Battle of ${reg}` : b.type === "resistance" ? `Resistance for ${reg}` : b.type === "revolution" ? `Civil war of ${def}` : b.type === "tournament" ? `MU Tournament` : `Battle`;
      const started = fmtDate(b.createdAt||b.startedAt);
      const ended = fmtDate(b.endedAt);
      const dmg = S.battleDamageCache.get(battleId(b)) ?? b.totalDamage ?? b.damage ?? 0;
      return `[${started} — ${ended}] ${typePhrase}: ${atk} vs ${def}${reg?" in "+reg:""}, ${fmtNum(dmg)} total damage`;
    });
    navigator.clipboard.writeText(lines.join("\n")).then(()=>toast("Battle list copied."));
  });
}
