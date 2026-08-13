import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtDate, fmtNum, fmtMoney, escapeHtml, escapeXml } from "../core/utils.js";
import { toast } from "../ui/toast.js";
import { highlightUserData } from "../core/profileHighlighter.js";
import { getCountriesInRegion } from "../core/regionClassification.js";
import { ensureLookups } from "../timeline/filters.js";

// Normalise the many possible battle type strings to a small set of kinds so
// icon/emblem choices keep working regardless of how the API spells them.
export function battleTypeKind(t) {
  const s = String(t || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (s === "tournament") return "tournament";
  if (s === "resistance" || s === "rebellion" || s === "uprising" || s === "revolt" || s === "insurgency") return "resistance";
  if (s === "revolution" || s === "civil" || s === "civilwar") return "revolution";
  return "war";
}

// Map a search-bar keyword to the battle kind it stands for, e.g. "civil war"
// -> revolution, "tournament" -> tournament. Unknown words return null so the
// caller falls back to a plain text search instead of matching every war.
export function battleTypeKeyword(kw) {
  const s = String(kw || "").toLowerCase().trim().replace(/[\s_-]+/g, "");
  const map = {
    resistance: "resistance", rebellion: "resistance", uprising: "resistance",
    revolt: "resistance", insurgency: "resistance", insurgencies: "resistance",
    revolution: "revolution", civil: "revolution", civilwar: "revolution",
    tournament: "tournament", mutournament: "tournament", mutournaments: "tournament",
    battle: "war", war: "war",
  };
  return map[s] || null;
}

// Display name for a battle, e.g. "Battle of Eropa", "Resistance for Lorzen",
// "Civil war of Aetern", "MU Tournament".
export function battleTitlePhrase(b) {
  const kind = battleTypeKind(b?.type);
  if (kind === "tournament") return "MU Tournament";
  const reg = nameRegion(b?.defender?.region || b.defenderRegion || b.region);
  const def = nameCountry(b?.defender?.country || b.defenderCountry || b.defender?.countryId);
  if (kind === "resistance") return reg ? `Resistance for ${reg}` : "Resistance";
  if (kind === "revolution") return def ? `Civil war of ${def}` : "Civil War";
  return reg ? `Battle of ${reg}` : "Battle";
}


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
  clearInterval(S.liveListTimer); clearTimeout(S.liveListTimer); S.liveListTimer=null;
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
    const atkDmg = sumDmg(data.attacker?.damages);
    const defDmg = sumDmg(data.defender?.damages);
    const total = atkDmg + defDmg;
    if (total > 0) S.battleDamageCache.set(battleId, total);
    return total;
  } catch { return 0; }
}

// Enrich a single battle card with per-side damage + ground points pulled from
// battle.getById and, for live battles, the current round via round.getById —
// the same sources the battle detail modal uses. For live battles the numbers
// live on the current round; for ended battles the battle-level
// attacker/defender object carries them.
async function fetchBattleCardStats(b) {
  const bid = battleId(b);
  const k = apiKey(); if (!k || !bid) return null;
  try {
    const result = await fetchTrpc("battle.getById", { battleId: bid }, k);
    const data = unwrap(result);
    if (!data) return null;
    const isLive = !data.endedAt || data.isActive === true || data.active === true;
    const cur = (data.currentRound && typeof data.currentRound === "object") ? data.currentRound : null;
    let atkDmg = sumDmg(data.attacker?.damages ?? cur?.attacker?.damages ?? 0);
    let defDmg = sumDmg(data.defender?.damages ?? cur?.defender?.damages ?? 0);
    let atkPts = Number(data.attacker?.points ?? cur?.attacker?.points ?? 0) || 0;
    let defPts = Number(data.defender?.points ?? cur?.defender?.points ?? 0) || 0;
    if (isLive) {
      const curId = typeof data.currentRound === "string"
        ? data.currentRound
        : data.currentRound?._id || data.currentRound?.id || "";
      if (curId) {
        try {
          const rd = unwrap(await fetchTrpc("round.getById", { roundId: curId }, k));
          if (rd && typeof rd === "object") {
            if (rd.attacker?.damages != null) atkDmg = sumDmg(rd.attacker.damages);
            if (rd.defender?.damages != null) defDmg = sumDmg(rd.defender.damages);
            if (rd.attacker?.points != null) atkPts = Number(rd.attacker.points) || 0;
            if (rd.defender?.points != null) defPts = Number(rd.defender.points) || 0;
          }
        } catch {}
      }
    } else if (!atkPts && !defPts) {
      // Ended battles carry the final ground-point totals on the last round;
      // battle-level fields are usually empty for them.
      const ids = [data.rounds, data.roundsHistory, data.roundsAll]
        .filter(a => Array.isArray(a))
        .flat()
        .map(r => (typeof r === "string" ? r : r?._id || r?.id || r?.roundId || ""))
        .filter(Boolean);
      const curId = typeof data.currentRound === "string"
        ? data.currentRound
        : data.currentRound?._id || data.currentRound?.id || "";
      const lastId = curId || ids[ids.length - 1] || "";
      if (lastId) {
        try {
          const rd = unwrap(await fetchTrpc("round.getById", { roundId: lastId }, k));
          if (rd && typeof rd === "object") {
            if (rd.attacker?.points != null) atkPts = Number(rd.attacker.points) || 0;
            if (rd.defender?.points != null) defPts = Number(rd.defender.points) || 0;
          }
        } catch {}
      }
    }
    const stats = { ts: Date.now(), atkDmg, defDmg, atkPts, defPts };
    S.battleCardStats.set(bid, stats);
    if (stats.atkDmg + stats.defDmg > 0) S.battleDamageCache.set(bid, stats.atkDmg + stats.defDmg);
    return stats;
  } catch { return null; }
}

export async function refreshBattleCardStats() {
  if (S.cardStatsPending) return;
  S.cardStatsPending = true;
  const now = Date.now();
  const needs = S.battles.filter(b => {
    const st = S.battleCardStats.get(battleId(b));
    if (!st) return true;
    const isLive = !b.endedAt || b.isActive === true || b.active === true;
    return isLive && now - (st.ts || 0) > 10000;
  });
  if (!needs.length) { S.cardStatsPending = false; return; }
  const chunkSize = 10;
  for (let i = 0; i < needs.length; i += chunkSize) {
    await Promise.allSettled(needs.slice(i, i + chunkSize).map(fetchBattleCardStats));
  }
  S.cardStatsPending = false;
  renderBattleList();
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
    } else if (mode==="keyword") {
      await loadBattleKeywordPages(reset, k);
    } else if (mode==="date") {
      await loadBattleDateRange(reset, k);
    } else {
      await loadBattleFeed(reset, k);
    }
    renderBattleList();
    if (mode==="date") {
      if (S.battleSearchLabel) setBattleStatus(S.battleSearchLabel + (S.battleDateCapped ? ` — first ${S.battles.length} battles.` : "."));
    } else if (mode && S.battleSearchLabel) setBattleStatus(mode==="id" ? "Showing "+S.battleSearchLabel+"." : "Showing "+S.battleSearchLabel+" battles.");
    else clearBattleStatus();
    if (S.battles.length <= 60) refreshBattleCardStats();
    if (mode==="id" && S.battles.length) {
      const card = E.battleList.querySelector(".battle-card");
      if (card) card.click();
    }
  } catch (err) {
    setBattleStatus("Could not load battles: "+(err.message||""), "error");
  }
  const mini = document.getElementById("battleLoadMini");
  if (mini) mini.hidden = !battleSearchHasMore();
  if (S.battleMode === "live") {
    clearInterval(S.liveListTimer); S.liveListTimer = null;
    S.liveListTimer = setInterval(() => refreshBattleCardStats(), 15000);
  }
}

function battleSearchHasMore() {
  if (S.battleSearchMode==="id") return false;
  if (S.battleSearchMode==="country") return !!S.battleSearchCursor;
  if (S.battleSearchMode==="region") return Object.values(S.battleSearchRegionCursors||{}).some(Boolean);
  if (S.battleSearchMode==="keyword") return !!S.battleSearchCursor;
  if (S.battleSearchMode==="date") return !!S.battleDateCapped;
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

// Keyword search (resistance / battle / civil war / tournament…): the API has
// no text search, so we dig the same feed the country search uses and keep
// only battles whose kind/title/name match the word. The "More" button pages
// through additional feed pages.
function battleMatchesKeyword(b, kw) {
  if (!kw) return true;
  const k = battleTypeKeyword(kw);
  if (k && battleTypeKind(b?.type) === k) return true;
  const title = (b.title || b.name || "").toLowerCase();
  const phrase = battleTitlePhrase(b).toLowerCase();
  const type = String(b.type || "").toLowerCase();
  return title.includes(kw) || phrase.includes(kw) || type.includes(kw);
}

async function loadBattleKeywordPages(reset, k) {
  if (reset) S.battleSearchCursor = null;
  const kw = (S.battleSearch || "").toLowerCase();
  const payload = { limit:100, isActive: S.battleMode==="live", cursor:reset?undefined:S.battleSearchCursor };
  const result = await fetchTrpc("battle.getBattles", payload, k).catch(()=>null);
  const data = result ? unwrap(result) : null;
  S.battleSearchCursor = data?.nextCursor || null;
  const battles = result && data ? (Array.isArray(data)?data:(data?.items||data?.battles||[])) : [];
  const matches = battles.filter(b => battleMatchesKeyword(b, kw));
  for (const b of matches) { const id=battleId(b); if(id) S.lookups.battlesById.set(id,b); }
  S.battles = reset ? matches : [...S.battles, ...matches];
  await resolveTournamentMUs(k);
}

// Date range search: the battle feed can only be paged by createdAt (the
// cursor embeds a timestamp), so we walk it backwards from the range end and
// keep every concluded battle whose endedAt lands inside [from, to]. A battle
// lasts well under 24h, so anything created more than 3 days before "from"
// cannot have ended inside the range — that gives a safe early exit.
const BATTLE_DATE_MARGIN_MS = 3 * 24 * 3600 * 1000;
const BATTLE_DATE_MAX_PAGES = 30;
const TIME_CURSOR_DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const TIME_CURSOR_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function makeTimeCursor(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, "0");
  const s = `${TIME_CURSOR_DAYS[d.getUTCDay()]} ${TIME_CURSOR_MONTHS[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
  return `${s}|${"0".repeat(24)}`;
}

async function loadBattleDateRange(reset, k) {
  const df = S.battleDateFrom, dt = S.battleDateTo;
  const fromMs = df ? new Date(df + "T00:00:00").getTime() : 0;
  const toMs = dt ? new Date(dt + "T23:59:59").getTime() : Infinity;
  const now = Date.now();
  const fetchFrom = fromMs > 0 ? fromMs - BATTLE_DATE_MARGIN_MS : 0;
  const fetchTo = Number.isFinite(toMs) ? Math.min(toMs, now) : now;
  if (reset) { S.battleDateCapped = false; S.battleSearchCursor = null; }
  const seen = new Set(reset ? [] : S.battles.map(battleId));
  let collected = [];
  let cursor = S.battleSearchCursor || (fetchTo < now - 60000 ? makeTimeCursor(fetchTo) : undefined);
  let pages = 0;
  let capped = false;
  while (pages < BATTLE_DATE_MAX_PAGES) {
    const payload = { limit:100, isActive:false, ...(cursor ? { cursor } : {}) };
    const result = await fetchTrpc("battle.getBattles", payload, k).catch(()=>null);
    const data = result ? unwrap(result) : null;
    if (!data) break;
    const battles = Array.isArray(data) ? data : (data?.items || data?.battles || []);
    if (!battles.length) break;
    for (const b of battles) {
      const id = battleId(b);
      if (seen.has(id)) continue;
      const e = b.endedAt;
      if (!e) continue;
      const ms = new Date(e).getTime();
      if (isNaN(ms)) continue;
      if (ms >= fromMs && ms <= toMs) {
        seen.add(id);
        collected.push(b);
        S.lookups.battlesById.set(id, b);
      }
    }
    pages++;
    cursor = data?.nextCursor || null;
    if (!cursor) break;
    const oldest = new Date(battles[battles.length - 1].createdAt || 0).getTime();
    const newest = new Date(battles[0].createdAt || 0).getTime();
    if (!Number.isFinite(oldest) || !Number.isFinite(newest)) continue;
    if (newest < fetchFrom) break;  // whole page already older than the fetch window
    if (oldest < fetchFrom) break;  // fetch window fully covered
  }
  capped = pages >= BATTLE_DATE_MAX_PAGES;
  S.battleDateCapped = capped;
  S.battleSearchCursor = capped ? cursor : null;
  S.battles = reset ? collected : [...S.battles, ...collected];
  await resolveTournamentMUs(k);
}

export function renderBattleList() {
  E.battleList.innerHTML="";
  const kw = S.battleSearchMode === "id" ? "" : (S.battleSearch||"");
  const regionK = (S.battleRegionFilter||"").toLowerCase();
  const regionCountryNames = regionK ? getCountriesInRegion(regionK) : [];
  const regionSet = regionCountryNames.length ? new Set(regionCountryNames.map(n => n.toLowerCase())) : null;
  let list = S.battles;
  if (kw) {
    const kwKind = battleTypeKeyword(kw);
    list = list.filter(b => {
      let atk, def;
      if (b.type === "tournament") {
        atk = nameMu(b.attacker?.tournamentTeam).toLowerCase();
        def = nameMu(b.defender?.tournamentTeam).toLowerCase();
      } else {
        atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId).toLowerCase();
        def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId).toLowerCase();
      }
      if (kwKind && battleTypeKind(b.type) === kwKind) return true;
      const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region).toLowerCase();
      const title = (b.title||b.name||"").toLowerCase();
      const phrase = battleTitlePhrase(b).toLowerCase();
      const type = String(b.type||"").toLowerCase();
      return atk.includes(kw)||def.includes(kw)||reg.includes(kw)||title.includes(kw)||phrase.includes(kw)||type.includes(kw);
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
  const sortDir = S.battleSortDir === "asc" ? 1 : -1;
  list = [...list].sort((a, b) => {
    if (sortBy === "damage") {
      const aid = battleId(a), bid2 = battleId(b);
      const da = Number(S.battleDamageCache.get(aid) ?? a.totalDamage ?? a.damage ?? 0);
      const db = Number(S.battleDamageCache.get(bid2) ?? b.totalDamage ?? b.damage ?? 0);
      if (!isFinite(da) && !isFinite(db)) return 0;
      if (!isFinite(da)) return 1;
      if (!isFinite(db)) return -1;
      return (db - da) * sortDir;
    }
    const ae = a.endedAt, be = b.endedAt;
    if (!ae && !be) return 0;
    if (!ae) return 1;
    if (!be) return -1;
    return (new Date(be).getTime() - new Date(ae).getTime()) * sortDir;
  });
  if (!list.length) {
    E.battleList.innerHTML=`<p style="color:var(--ink-dim);padding:20px;text-align:center">${S.battleSearchMode==="id" ? "Battle not found." : kw ? "No battles match your search." : "No battles found."}</p>`;
    return;
  }
  const frag=document.createDocumentFragment();
  for (const b of list) frag.append(makeBattleCard(b));
  E.battleList.append(frag);
  if (S.selectedBattleId) {
    const sel = E.battleList.querySelector(`.battle-card[data-bid="${S.selectedBattleId}"]`);
    if (sel) sel.classList.add("selected");
  }
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
  node.dataset.bid = bid;
  const isLive = !battle.endedAt || battle.isActive===true || battle.active===true;
  const kind = battleTypeKind(battle.type);
  const isTournament = kind === "tournament";
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
  const { atkColor, defColor, atkText, defText } = battleSideColors(battle);
  const regName = nameRegion(battle.defender?.region || battle.defenderRegion || battle.region);
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
    const strikeIcon = kind === "resistance" ? "game-icons:fist" : kind === "revolution" ? "mdi:pitchfork" : "streamline-sharp:sword-attack-solid";
    emblem.innerHTML = `<iconify-icon icon="streamline-sharp:shield-2-remix" class="lu bc-ico-shield" style="color:${defColor}"></iconify-icon><iconify-icon icon="${strikeIcon}" class="lu bc-ico-strike" style="color:${atkColor}"></iconify-icon>`;
  }

  const stats = S.battleCardStats.get(bid);
  const atkDmg = stats ? stats.atkDmg : sumDmg(battle.attacker?.damages ?? battle.atkDamage ?? 0);
  const defDmg = stats ? stats.defDmg : sumDmg(battle.defender?.damages ?? battle.defDamage ?? 0);
  const totalDmg = (atkDmg + defDmg) || S.battleDamageCache.get(bid) || battle.totalDamage || battle.damage || 0;
  node.querySelector(".bc-dmg-val").textContent = totalDmg ? fmtNum(totalDmg) : "";

  const atkPts = stats ? stats.atkPts : Number(battle.attacker?.points ?? battle.attackerPoints ?? battle.currentRound?.attacker?.points ?? 0);
  const defPts = stats ? stats.defPts : Number(battle.defender?.points ?? battle.defenderPoints ?? battle.currentRound?.defender?.points ?? 0);
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

  const nameRow = node.querySelector(".bc-name-row");
  if (nameRow) {
    const phrase = battleTitlePhrase(battle);
    nameRow.textContent = phrase;
    nameRow.title = `${phrase} — ${def ? def + " vs " : ""}${atk ? atk : ""}${regName ? " in " + regName : ""}`;
  }

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
