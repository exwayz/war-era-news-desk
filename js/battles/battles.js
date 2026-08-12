import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtDate, fmtNum, fmtMoney, escapeHtml, escapeXml } from "../core/utils.js";
import { toast } from "../ui/toast.js";
import { highlightUserData } from "../core/profileHighlighter.js";
import { getCountriesInRegion } from "../core/regionClassification.js";
import { ensureLookups } from "../timeline/filters.js";


async function resolveTournamentMUs(k) {
  const muIds = new Set();
  for (const b of S.battles) {
    if (b.type !== "tournament") continue;
    const atkMu = b.attacker?.tournamentTeam;
    const defMu = b.defender?.tournamentTeam;
    if (atkMu && !S.lookups.muById.has(atkMu)) muIds.add(atkMu);
    if (defMu && !S.lookups.muById.has(defMu)) muIds.add(defMu);
  }
  if (!muIds.size) return;
  await Promise.all([...muIds].map(async mid => {
    try {
      const r = await fetchTrpc("mu.getById", { muId: mid }, k);
      const mu = unwrap(r);
      if (mu) S.lookups.muById.set(mid, mu);
    } catch {}
  }));
}

export function stopBattlePolling() {
  clearInterval(S.liveBattleTimer); clearTimeout(S.liveBattleTimer); S.liveBattleTimer=null;
  clearInterval(S.battleTickTimer); S.battleTickTimer=null;
}

export function updateBattleTabPills() {
  E.battleTabLive?.classList.toggle("active", S.battleMode==="live");
  E.battleTabHistory?.classList.toggle("active", S.battleMode==="history");
}

function setBattleStatus(m,t="info") { E.battleListStatus.hidden=false; E.battleListStatus.textContent=m; E.battleListStatus.classList.toggle("error",t==="error"); }
function clearBattleStatus() { E.battleListStatus.hidden=true; E.battleListStatus.textContent=""; E.battleListStatus.classList.remove("error"); }

export function battleId(b) { return b._id||b.id||b.battleId||""; }

export async function fetchBattleDamage(battleId) {
  const k = apiKey(); if (!k) return 0;
  try {
    const result = await fetchTrpc("battle.getById", { battleId }, k);
    const data = unwrap(result);
    if (!data) return 0;
    function sumDmg(d) {
      if (d == null) return 0;
      if (typeof d === "number") return d;
      if (typeof d === "object") return Object.values(d).reduce((s, v) => s + (Number(v) || 0), 0);
      return Number(d) || 0;
    }
    const atkDmg = sumDmg(data.attacker?.damages);
    const defDmg = sumDmg(data.defender?.damages);
    const total = atkDmg + defDmg;
    if (total > 0) S.battleDamageCache.set(battleId, total);
    return total;
  } catch { return 0; }
}

export async function refreshBattleDamageCache() {
  if (S.damageCachePending) return;
  S.damageCachePending = true;
  const ids = S.battles.filter(b => !b.isActive && !b.active && b.endedAt && !S.battleDamageCache.has(battleId(b))).map(battleId);
  if (!ids.length) { S.damageCachePending = false; return; }
  const chunkSize = 10;
  for (let i = 0; i < ids.length; i += chunkSize) {
    await Promise.allSettled(ids.slice(i, i + chunkSize).map(fetchBattleDamage));
  }
  S.damageCachePending = false;
  if (S.battleSort === "damage") renderBattleList();
}

export async function loadBattles(reset=true) {
  const k = apiKey(); if (!k) return;
  stopBattlePolling();
  updateBattleTabPills();
  if (reset) { S.battles=[]; S.battleCursor=null; E.battleList.innerHTML=""; }
  const mode = S.battleSearchMode;
  setBattleStatus(mode==="id" ? "Loading battle…" : (mode ? "Searching battles…" : "Loading battles…"));
  try {
    await ensureLookups(k).catch(()=>{});
    if (mode==="id") {
      await loadBattleById(k);
    } else if (mode==="country") {
      await loadBattleCountryPage(reset, k);
    } else if (mode==="region") {
      await loadBattleRegionPages(reset, k);
    } else {
      await loadBattleFeed(reset, k);
    }
    renderBattleList();
    if (mode && S.battleSearchLabel) setBattleStatus(mode==="id" ? "Showing "+S.battleSearchLabel+"." : "Showing "+S.battleSearchLabel+" battles.");
    else clearBattleStatus();
    if (S.battleMode === "history") refreshBattleDamageCache();
    if (mode==="id" && S.battles.length) {
      const card = E.battleList.querySelector(".battle-card");
      if (card) card.click();
    }
  } catch (err) {
    setBattleStatus("Could not load battles: "+(err.message||""), "error");
  }
  E.loadMoreBattlesBtn.hidden = !battleSearchHasMore();
}

function battleSearchHasMore() {
  if (S.battleSearchMode==="id") return false;
  if (S.battleSearchMode==="country") return !!S.battleSearchCursor;
  if (S.battleSearchMode==="region") return Object.values(S.battleSearchRegionCursors||{}).some(Boolean);
  return !!S.battleCursor;
}

async function loadBattleFeed(reset, k) {
  const payload = { limit:20, isActive: S.battleMode==="live", cursor:reset?undefined:S.battleCursor };
  const result = await fetchTrpc("battle.getBattles", payload, k);
  const data = unwrap(result);
  const battles = Array.isArray(data)?data:(data?.items||data?.battles||[]);
  S.battleCursor = data?.nextCursor||null;
  for (const b of battles) { const id=battleId(b); if(id) S.lookups.battlesById.set(id,b); }
  S.battles = reset ? battles : [...S.battles, ...battles];
  await resolveTournamentMUs(k);
}

async function loadBattleById(k) {
  const bid = S.battleSearchId;
  let battle = S.lookups.battlesById.get(bid);
  if (!battle) {
    const result = await fetchTrpc("battle.getById", { battleId: bid }, k);
    battle = unwrap(result);
  }
  S.battles = battle ? [battle] : [];
}

async function loadBattleCountryPage(reset, k) {
  const payload = { limit:20, isActive: S.battleMode==="live", countryId:S.battleSearchCountryId, cursor:reset?undefined:S.battleSearchCursor };
  const result = await fetchTrpc("battle.getBattles", payload, k);
  const data = unwrap(result);
  const battles = Array.isArray(data)?data:(data?.items||data?.battles||[]);
  S.battleSearchCursor = data?.nextCursor||null;
  for (const b of battles) { const id=battleId(b); if(id) S.lookups.battlesById.set(id,b); }
  S.battles = reset ? battles : [...S.battles, ...battles];
  await resolveTournamentMUs(k);
}

async function loadBattleRegionPages(reset, k) {
  if (reset) S.battleSearchRegionCursors = {};
  const pages = await Promise.all((S.battleSearchRegionIds||[]).map(async cid => {
    if (!reset && !S.battleSearchRegionCursors[cid]) return [];
    const payload = { limit:20, isActive: S.battleMode==="live", countryId:cid, cursor:reset?undefined:S.battleSearchRegionCursors[cid] };
    const result = await fetchTrpc("battle.getBattles", payload, k).catch(()=>null);
    const data = unwrap(result);
    if (result && data) S.battleSearchRegionCursors[cid] = data?.nextCursor||null;
    return result && data ? (Array.isArray(data)?data:(data?.items||data?.battles||[])) : [];
  }));
  const all = pages.flat();
  for (const b of all) { const id=battleId(b); if(id) S.lookups.battlesById.set(id,b); }
  S.battles = reset ? all : [...S.battles, ...all];
  await resolveTournamentMUs(k);
}

export function renderBattleList() {
  E.battleList.innerHTML="";
  const kw = S.battleSearchMode ? "" : (S.battleSearch||"");
  const regionK = (S.battleRegionFilter||"").toLowerCase();
  const regionCountryNames = regionK ? getCountriesInRegion(regionK) : [];
  const regionSet = regionCountryNames.length ? new Set(regionCountryNames.map(n => n.toLowerCase())) : null;
  let list = S.battles;
  if (kw) {
    list = list.filter(b => {
      let atk, def;
      if (b.type === "tournament") {
        atk = nameMu(b.attacker?.tournamentTeam).toLowerCase();
        def = nameMu(b.defender?.tournamentTeam).toLowerCase();
      } else {
        atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId).toLowerCase();
        def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId).toLowerCase();
      }
      const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region).toLowerCase();
      const title = (b.title||b.name||"").toLowerCase();
      return atk.includes(kw)||def.includes(kw)||reg.includes(kw)||title.includes(kw);
    });
  }
  if (regionSet) {
    list = list.filter(b => {
      const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId).toLowerCase();
      const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId).toLowerCase();
      return regionSet.has(atk) || regionSet.has(def);
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
  list = [...list].sort((a, b) => {
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
  if (!list.length) {
    E.battleList.innerHTML=`<p style="color:var(--ink-dim);padding:20px;text-align:center">${S.battleSearchMode==="id" ? "Battle not found." : kw ? "No battles match your search." : "No battles found."}</p>`;
    return;
  }
  const frag=document.createDocumentFragment();
  for (const b of list) frag.append(makeBattleCard(b));
  E.battleList.append(frag);
  highlightUserData();
}

import { nameCountry, nameRegion, nameMu, battleSideColors } from "./companies.js";

function sumDmg(d) {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  if (typeof d === "object") return Object.values(d).reduce((s, v) => s + (Number(v) || 0), 0);
  return Number(d) || 0;
}

function sideFlagHtml(id, isTournament) {
  if (!id) return "";
  if (isTournament) {
    const mu = S.lookups.muById.get(id);
    return mu?.avatarUrl ? `<img class="bc-flag-img bc-flag-img--round" src="${escapeHtml(mu.avatarUrl)}" alt="">` : "";
  }
  const code = (S.lookups.countriesById.get(id)?.code || "").toLowerCase();
  return code ? `<img class="bc-flag-img" src="https://media.warera.io/images/flags/${code}.svg" alt="">` : "";
}

function fmtDateShort(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const s = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.getFullYear() === new Date().getFullYear() ? s : s + " '" + String(d.getFullYear()).slice(2);
}

function makeBattleCard(battle) {
  const node = E.tplBattle.content.firstElementChild.cloneNode(true);
  const bid = battleId(battle);
  const isLive = !battle.endedAt || battle.isActive===true || battle.active===true;
  const isTournament = battle.type === "tournament";
  let atk, def, atkId, defId;
  if (isTournament) {
    atkId = battle.attacker?.tournamentTeam;
    defId = battle.defender?.tournamentTeam;
    atk = nameMu(atkId);
    def = nameMu(defId);
  } else {
    atkId = battle.attacker?.country||battle.attackerCountry||battle.attacker?.countryId;
    defId = battle.defender?.country||battle.defenderCountry||battle.defender?.countryId;
    atk = nameCountry(atkId);
    def = nameCountry(defId);
  }
  const { atkColor, defColor, atkText, defText, atkBarText, defBarText } = battleSideColors(battle);
  const fallbackName = id => id ? String(id).slice(-6) : "?";

  const status = node.querySelector(".bc-status");
  status.classList.add(isLive ? "live" : "ended");
  status.innerHTML = `<span class="bc-status-dot"></span><span class="bc-status-txt">${isLive ? "LIVE" : "ENDED"}</span>`;
  status.title = isLive ? "Live battle" : "Battle ended";

  const atkPerK = battle.attacker?.moneyPer1kDamages ?? battle.attackerMoneyPer1kDamages;
  const defPerK = battle.defender?.moneyPer1kDamages ?? battle.defenderMoneyPer1kDamages;
  const atkPool = battle.attacker?.moneyPool ?? battle.attackerMoneyPool;
  const defPool = battle.defender?.moneyPool ?? battle.defenderMoneyPool;
  const poolTotal = (Number(atkPool)||0) + (Number(defPool)||0);
  const bounty = node.querySelector(".bc-bounty");
  const bountyParts = [];
  if (atkPerK != null || defPerK != null) bountyParts.push(`₿${fmtMoney(atkPerK ?? defPerK)}/1k`);
  if (poolTotal > 0) bountyParts.push(`₿${fmtNum(poolTotal)} pool`);
  if (bountyParts.length) bounty.innerHTML = `<iconify-icon icon="mdi:coin" class="lu"></iconify-icon> ${bountyParts.join(" · ")}`;
  else bounty.classList.add("empty");

  const started = battle.createdAt||battle.startedAt;
  const ended = battle.endedAt;
  const dates = node.querySelector(".bc-dates");
  dates.textContent = isLive
    ? (started ? fmtDateShort(started) : "")
    : (started && ended ? `${fmtDateShort(started)} → ${fmtDateShort(ended)}` : "");
  dates.title = isLive
    ? (started ? "Started: "+fmtDate(started) : "Live battle")
    : (started && ended ? `Started: ${fmtDate(started)} — Ended: ${fmtDate(ended)}` : "");

  node.querySelector(".bc-side--atk").innerHTML = `${sideFlagHtml(atkId, isTournament)}<span class="bc-name">${escapeHtml(atk || fallbackName(atkId))}</span>`;
  node.querySelector(".bc-side--def").innerHTML = `${sideFlagHtml(defId, isTournament)}<span class="bc-name">${escapeHtml(def || fallbackName(defId))}</span>`;

  const atkRounds = Number(battle.attacker?.wonRoundsCount ?? battle.attackerRoundsWon ?? 0);
  const defRounds = Number(battle.defender?.wonRoundsCount ?? battle.defenderRoundsWon ?? 0);
  const atkScoreEl = node.querySelector(".bc-score--atk");
  const defScoreEl = node.querySelector(".bc-score--def");
  atkScoreEl.textContent = String(atkRounds || 0);
  defScoreEl.textContent = String(defRounds || 0);
  atkScoreEl.style.color = atkText;
  defScoreEl.style.color = defText;

  const emblem = node.querySelector(".bc-emblem-icons");
  if (isTournament) {
    emblem.innerHTML = `<iconify-icon icon="mdi:trophy" class="lu" style="color:var(--gold);font-size:1.7rem"></iconify-icon>`;
  } else {
    const atkIcon = battle.type === "resistance" ? "mdi:fist" : battle.type === "revolution" ? "mdi:rake" : "mdi:sword";
    emblem.innerHTML = `<iconify-icon icon="${atkIcon}" class="lu" style="color:${atkColor};font-size:1.35rem"></iconify-icon><iconify-icon icon="mdi:shield" class="lu" style="color:${defColor};font-size:1.35rem"></iconify-icon>`;
  }

  const atkDmg = sumDmg(battle.attacker?.damages ?? battle.atkDamage ?? 0);
  const defDmg = sumDmg(battle.defender?.damages ?? battle.defDamage ?? 0);
  const totalDmg = (atkDmg + defDmg) || S.battleDamageCache.get(bid) || battle.totalDamage || battle.damage || 0;
  node.querySelector(".bc-dmg-val").textContent = totalDmg ? fmtNum(totalDmg) : "";

  const atkPts = Number(battle.attacker?.points ?? 0);
  const defPts = Number(battle.defender?.points ?? 0);
  const MAX_GP = 300;
  const atkPtsEl = node.querySelector(".bc-points-atk");
  const defPtsEl = node.querySelector(".bc-points-def");
  atkPtsEl.textContent = atkPts ? fmtNum(atkPts) : "";
  defPtsEl.textContent = defPts ? fmtNum(defPts) : "";
  atkPtsEl.style.color = atkText;
  defPtsEl.style.color = defText;
  const atkPtsFill = node.querySelector(".bc-pts-atk");
  const defPtsFill = node.querySelector(".bc-pts-def");
  atkPtsFill.style.width = (Math.min(atkPts, MAX_GP) / MAX_GP * 100) + "%";
  atkPtsFill.style.background = atkText;
  defPtsFill.style.width = (Math.min(defPts, MAX_GP) / MAX_GP * 100) + "%";
  defPtsFill.style.background = defText;

  const atkPct = (atkDmg + defDmg) > 0 ? Math.round(atkDmg / (atkDmg + defDmg) * 100) : 50;
  const defPct = 100 - atkPct;
  const atkSeg = node.querySelector(".bc-share-atk");
  const defSeg = node.querySelector(".bc-share-def");
  atkSeg.style.flex = atkPct + " 0 0";
  atkSeg.style.background = atkColor;
  defSeg.style.flex = defPct + " 0 0";
  defSeg.style.background = defColor;
  const atkSegDmg = node.querySelector(".bc-share-atk .bc-share-dmg");
  const atkSegPct = node.querySelector(".bc-share-atk .bc-share-pct");
  const defSegDmg = node.querySelector(".bc-share-def .bc-share-dmg");
  const defSegPct = node.querySelector(".bc-share-def .bc-share-pct");
  atkSegDmg.textContent = atkDmg ? fmtNum(atkDmg) : "";
  atkSegPct.textContent = (atkDmg || defDmg) ? atkPct + "%" : "";
  defSegDmg.textContent = defDmg ? fmtNum(defDmg) : "";
  defSegPct.textContent = (atkDmg || defDmg) ? defPct + "%" : "";
  atkSegDmg.style.color = atkBarText;
  atkSegPct.style.color = atkBarText;
  defSegDmg.style.color = defBarText;
  defSegPct.style.color = defBarText;

  node.addEventListener("click", async ()=>{
    S.selectedBattleId=bid;
    document.querySelectorAll(".battle-card").forEach(c=>c.classList.remove("selected"));
    node.classList.add("selected");
    stopBattlePolling();
    const { loadBattleDetail } = await import("./battleDetail.js");
    await loadBattleDetail(battle, bid, false);
    // Subsequent refreshes are scheduled by battleDetail.js from the live tick timer.
  });

  return node;
}

export function clearBattleDetail() {
  stopBattlePolling();
  S.battleDetailSeq++; // invalidate any in-flight load so it cannot re-render the modal
  S.selectedBattleId = null;
  document.querySelectorAll(".battle-card").forEach(c => c.classList.remove("selected"));
  if (E.battleReportModal) E.battleReportModal.classList.add("hidden");
  if (E.battleReportContent) E.battleReportContent.innerHTML = "";
}

export function buildAndDownloadXLS(filename, sheets) {
  let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8">
<!--[if gte mso 9]>
<xml>
<x:ExcelWorkbook>
<x:ExcelWorksheets>`;

  for (const s of sheets) {
    html += `<x:ExcelWorksheet><x:Name>${escapeXml(s.name)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>`;
  }

  html += `</x:ExcelWorksheets></x:ExcelWorkbook></xml>
<![endif]-->
</head><body>`;

  for (const s of sheets) {
    if (!s?.data || !Array.isArray(s.data)) { console.warn("Skipping invalid sheet:", s); continue; }
    html += `<table>`;
    html += `<tr><td colspan="50" style="font-weight:bold;font-size:16px">${escapeXml(s.name)}</td></tr>`;
    for (const row of s.data) {
      html += "<tr>";
      for (const cell of row) { html += `<td>${escapeXml(cell)}</td>`; }
      html += "</tr>";
    }
    html += `</table><br/>`;
  }

  html += "</body></html>";

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[^a-z0-9_\-\.]/gi, "_") + ".xls";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast("Battle data exported.");
}
