import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtDate, fmtNum, getValue, getPoints, normalizeRankRow, escapeHtml, rankBadgeHtml } from "../core/utils.js";
import { nameCountry, nameRegion, nameUser, nameMu, battleSideColors } from "./companies.js";
import { clearBattleDetail, buildAndDownloadXLS, battleId } from "./battles.js";
import { fetchBattleContracts, fetchBattleMoney, bountySummaryHtml, bindBountySummaryButtons } from "./bounty.js";
import { ensureLookups } from "../timeline/filters.js";

function orderIssuer(o) {
  if (o.mu) return nameMu(o.mu) || `MU ${String(o.mu).slice(-6)}`;
  if (o.country) return nameCountry(o.country) || "Unknown Country";
  if (o.user) return nameUser(o.user) || "Unknown User";
  return "Unknown";
}

function makeEntityLink(name, url) {
  const safeName = escapeHtml(name);
  if (!url) return safeName || "Unknown";
  const safeUrl = escapeHtml(url);
  return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="entity-link">${safeName}</a>`;
}

function okArr(r) {
  if (r.status !== "fulfilled") return [];
  const raw = unwrap(r.value);
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.items)) return raw.items;
  if (raw && typeof raw === "object") {
    const merged = [];
    if (Array.isArray(raw.attacker)) raw.attacker.forEach(x => merged.push({...x,_side:"attacker"}));
    if (Array.isArray(raw.defender)) raw.defender.forEach(x => merged.push({...x,_side:"defender"}));
    if (merged.length) return merged;
  }
  return [];
}

function orderSideList(orders, side) {
  const priorityRank = { high: 3, medium: 2, low: 1 };
  return (orders || [])
    .filter(o => (o.side || o.attackerDefender || o._side) === side)
    .sort((a, b) => (priorityRank[b.priority?.toLowerCase()] || 0) - (priorityRank[a.priority?.toLowerCase()] || 0));
}

function orderRowHtml(o) {
  const issuedThrough = o.mu ? "Military Unit" : o.country ? "Country" : "Unknown";
  const issuer = orderIssuer(o);
  const createdBy = nameUser(o.user) || "Unknown";
  const p = (o.priority || "").toLowerCase();
  const priorityColor = p === "high" ? "var(--red)" : p === "medium" ? "#f5c542" : p === "low" ? "var(--green)" : "var(--ink-dim)";
  const priority = `<span style="color:${priorityColor};font-weight:800;">${p ? p.charAt(0).toUpperCase() + p.slice(1) : "—"}</span>`;
  return `<td>${issuedThrough}</td><td>${issuer}</td><td>${createdBy}</td><td>${priority}</td>`;
}

let _ordersModal = { side: "attacker", orders: [], title: "", byline: "", color: "var(--ink-dim)" };

function renderOrdersModalBody() {
  if (!E.battleOrdersModalBody) return;
  const { side, orders, title, byline, color } = _ordersModal;
  const list = orderSideList(orders, side);
  const body = list.length
    ? `<table class="rank-table"><thead>
<tr><th style="color:${color}">Through</th><th style="color:${color}">Issuer</th><th style="color:${color}">Issued By</th><th style="color:${color}">Priority</th></tr>
</thead><tbody>${list.map(o => `<tr>${orderRowHtml(o)}</tr>`).join("")}</tbody></table>`
    : `<p style="color:var(--ink-dim);text-align:center;padding:12px 0">No orders issued for this side.</p>`;
  E.battleOrdersModalBody.innerHTML = body;
}

export function openOrdersModal(side, orders, title, byline, color) {
  if (!E.battleOrdersModal) return;
  _ordersModal = { side, orders, title, byline, color };
  if (E.battleOrdersModalTitle) E.battleOrdersModalTitle.textContent = title;
  if (E.battleOrdersModalByline) E.battleOrdersModalByline.textContent = byline;
  E.battleOrdersModal.classList.remove("hidden");
  renderOrdersModalBody();
}

function closeOrdersModal() { E.battleOrdersModal?.classList.add("hidden"); }
function copyOrdersReport() { navigator.clipboard?.writeText(E.battleOrdersModalBody?.innerText || "").then(() => {}).catch(() => {}); }

document.addEventListener("click", e => {
  if (e.target.closest("#closeBattleOrdersModal")) closeOrdersModal();
  if (e.target.id === "battleOrdersModal") closeOrdersModal();
  if (e.target.closest("#copyBattleOrdersBtn")) copyOrdersReport();
});

export async function loadBattleDetail(battle, bid, silent=false) {
  const k = apiKey(); if(!k) return;
  await ensureLookups(k).catch(()=>{});
  if (!silent) E.battleDetailPane.innerHTML = `<div style="padding:24px;color:var(--ink-dim)">Loading intelligence report…</div>`;
  try {
    const [rUsrMerged, rMuMerged, rCtyMerged, rGpUsrAtk, rGpUsrDef, rGpMuAtk, rGpMuDef, rGpCtyAtk, rGpCtyDef, rOrdAtk, rOrdDef, rDetail, rContracts, rMoney] = await Promise.allSettled([
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
      fetchBattleContracts(bid),
      fetchBattleMoney(bid),
    ]);

    const [rUsrAtk, rUsrDef] = await Promise.allSettled([
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"user",side:"attacker"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"user",side:"defender"},k),
    ]);

    let atkParticipantCount = unwrap(rUsrAtk.value)?.itemCount || 0;
    let defParticipantCount = unwrap(rUsrDef.value)?.itemCount || 0;

    let allUsers = [
      ...okArr(rUsrAtk).map(r => ({...r, _side: "attacker"})),
      ...okArr(rUsrDef).map(r => ({...r, _side: "defender"}))
    ];

    const [rMuAtk, rMuDef] = await Promise.allSettled([
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"mu",side:"attacker"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"mu",side:"defender"},k),
    ]);

    let allMu = [
      ...okArr(rMuAtk).map(r => ({...r, _side: "attacker"})),
      ...okArr(rMuDef).map(r => ({...r, _side: "defender"}))
    ];

    const [rCtyAtk, rCtyDef] = await Promise.allSettled([
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"country",side:"attacker"},k),
      fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"country",side:"defender"},k),
    ]);

    let allCountry = [
      ...okArr(rCtyAtk).map(r => ({...r, _side: "attacker"})),
      ...okArr(rCtyDef).map(r => ({...r, _side: "defender"}))
    ];

    if (!allUsers.length) {
      const [rUsrAtk2, rUsrDef2] = await Promise.allSettled([
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"user",side:"attacker"},k),
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"user",side:"defender"},k),
      ]);
      allUsers = [...okArr(rUsrAtk2).map(r=>({...r,_side:"attacker"})),...okArr(rUsrDef2).map(r=>({...r,_side:"defender"}))];
    }
    if (!allMu.length) {
      const [rMuAtk2, rMuDef2] = await Promise.allSettled([
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"mu",side:"attacker"},k),
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"mu",side:"defender"},k),
      ]);
      allMu = [...okArr(rMuAtk2).map(r=>({...r,_side:"attacker"})),...okArr(rMuDef2).map(r=>({...r,_side:"defender"}))];
    }
    if (!allCountry.length) {
      const [rCtyAtk2, rCtyDef2] = await Promise.allSettled([
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"country",side:"attacker"},k),
        fetchTrpc("battleRanking.getRanking",{battleId:bid,dataType:"damage",type:"country",side:"defender"},k),
      ]);
      allCountry = [...okArr(rCtyAtk2).map(r=>({...r,_side:"attacker"})),...okArr(rCtyDef2).map(r=>({...r,_side:"defender"}))];
    }

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
      await Promise.all(unknownMu.map(async mid => {
        try {
          const res = await fetchTrpc("mu.getById", { muId: mid }, k);
          const mu = unwrap(res);
          if (mu) S.lookups.muById.set(mid, mu);
        } catch {}
      }));
    }

    // Resolve tournament team MUs
    if (bdDetail.type === "tournament") {
      const tMuIds = [bdDetail.attacker?.tournamentTeam, bdDetail.defender?.tournamentTeam].filter(id => id && !S.lookups.muById.has(id));
      await Promise.all(tMuIds.map(async mid => {
        try {
          const res = await fetchTrpc("mu.getById", { muId: mid }, k);
          const mu = unwrap(res);
          if (mu) S.lookups.muById.set(mid, mu);
        } catch {}
      }));
    }

    const allRoundIds = [
      ...(Array.isArray(bdDetail.rounds) ? bdDetail.rounds : []),
      ...(Array.isArray(bdDetail.roundsHistory) ? bdDetail.roundsHistory : []),
    ].filter(Boolean);

    const currentRoundId = typeof bdDetail.currentRound === "string"
      ? bdDetail.currentRound
      : bdDetail.currentRound?._id || bdDetail.currentRound?.id || "";

    const uniqueRoundIds = [...new Set([...allRoundIds, currentRoundId].filter(Boolean))];

    const roundsData = (await Promise.allSettled(
      uniqueRoundIds.map(rid => fetchTrpc("round.getById", { roundId: rid }, k))
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

    const atkCountryId = bdDetail.attacker?.country || bdDetail.attackerCountry || "";
    const defCountryId = bdDetail.defender?.country || bdDetail.defenderCountry || "";

    const perRoundData = {};
    if (roundsData.length) {
      const roundKinds = {
        damageUsers:  { dataType: "damage", type: "user" },
        damageMu:     { dataType: "damage", type: "mu" },
        damageCountry:{ dataType: "damage", type: "country" },
        gpUsers:      { dataType: "points", type: "user" },
        gpMu:         { dataType: "points", type: "mu" },
        gpCountry:    { dataType: "points", type: "country" },
      };
      await Promise.all(roundsData.map(async (rd, i) => {
        const roundId = rd._id;
        const out = { _idx: i, damageUsers: [], damageMu: [], damageCountry: [], gpUsers: [], gpMu: [], gpCountry: [], ordersAtk: [], ordersDef: [], atkPar: 0, defPar: 0, atkGp: 0, defGp: 0 };
        try {
          for (const [key, spec] of Object.entries(roundKinds)) {
            const [atkR, defR] = await Promise.allSettled([
              fetchTrpc("battleRanking.getRanking", { roundId, ...spec, side: "attacker" }, k),
              fetchTrpc("battleRanking.getRanking", { roundId, ...spec, side: "defender" }, k),
            ]);
            const merged = [
              ...okArr(atkR).map(r => ({ ...r, _side: "attacker" })),
              ...okArr(defR).map(r => ({ ...r, _side: "defender" })),
            ];
            if (key === "damageUsers") {
              out.atkPar = unwrap(atkR.value)?.itemCount || 0;
              out.defPar = unwrap(defR.value)?.itemCount || 0;
            }
            out[key] = merged;
          }
          const [ordAtkR, ordDefR] = await Promise.allSettled([
            fetchTrpc("battleOrder.getByBattle", { battleId: bid, roundId, side: "attacker" }, k),
            fetchTrpc("battleOrder.getByBattle", { battleId: bid, roundId, side: "defender" }, k),
          ]);
          out.ordersAtk = okArr(ordAtkR).map(o => ({ ...o, _side: "attacker" }));
          out.ordersDef = okArr(ordDefR).map(o => ({ ...o, _side: "defender" }));
          if (!out.ordersAtk.length && !out.ordersDef.length && (ordersAtk.length || ordersDef.length)) {
            out.ordersAtk = ordersAtk;
            out.ordersDef = ordersDef;
          }
          const atkCountryEntry = out.gpCountry.find(r => r._side === "attacker" && (r.countryId || r.country) === atkCountryId) || out.gpCountry.find(r => r._side === "attacker");
          const defCountryEntry = out.gpCountry.find(r => r._side === "defender" && (r.countryId || r.country) === defCountryId) || out.gpCountry.find(r => r._side === "defender");
          out.atkGp = atkCountryEntry ? getPoints(atkCountryEntry) : 0;
          out.defGp = defCountryEntry ? getPoints(defCountryEntry) : 0;
        } catch {}
        perRoundData[roundId] = out;
      }));
    }

    const roundUsers = Object.values(perRoundData).flatMap(p => p.damageUsers.concat(p.gpUsers));
    const roundMus = Object.values(perRoundData).flatMap(p => p.damageMu.concat(p.gpMu));
    const roundUnknownUsers = [...new Set(roundUsers.map(r => r.userId || r.user).filter(id => id && !S.lookups.usersById.has(id)))];
    if (roundUnknownUsers.length) await Promise.all(roundUnknownUsers.map(async uid => {
      try {
        const r = await fetchTrpc("user.getUserLite", { userId: uid }, k);
        const u = unwrap(r); if (u) S.lookups.usersById.set(uid, u);
      } catch {}
    }));
    const roundUnknownMu = [...new Set(roundMus.map(r => r.muId || r.mu).filter(id => id && !S.lookups.muById.has(id)))];
    if (roundUnknownMu.length) await Promise.all(roundUnknownMu.map(async mid => {
      try {
        const res = await fetchTrpc("mu.getById", { muId: mid }, k);
        const mu = unwrap(res); if (mu) S.lookups.muById.set(mid, mu);
      } catch {}
    }));

    const contracts = rContracts.status === "fulfilled" ? rContracts.value : { items: [], won: [], active: [], expired: [], totalBudget: 0, totalPayout: 0, side: { attacker: { count: 0, budget: 0, payout: 0 }, defender: { count: 0, budget: 0, payout: 0 } } };
    const money = rMoney.status === "fulfilled" ? rMoney.value : null;

    renderBattleDetail(bdDetail, bid, allUsers, allMu, allCountry, gpUsers, gpMu, gpCountry, allOrders, atkParticipantCount, defParticipantCount, roundsData, perRoundData, contracts, money);
  } catch (err) {
    if (!silent) E.battleDetailPane.innerHTML = `<div class="status-msg error">${err.message||"Failed to load battle detail"}</div>`;
  }
}

function renderBattleDetail(b, bid, rankUsers, rankMu, rankCountry, gpUsers, gpMu, gpCountry, orders, atkPar, defPar, roundsData, perRoundData, contracts, money) {
  clearInterval(S.battleTickTimer); S.battleTickTimer = null;
  const isTournament = b.type === "tournament";
  let atk, def, atkId, defId, atkAvatar, defAvatar;
  if (isTournament) {
    atk = nameMu(b.attacker?.tournamentTeam);
    def = nameMu(b.defender?.tournamentTeam);
    atkId = b.attacker?.tournamentTeam;
    defId = b.defender?.tournamentTeam;
    const atkMu = S.lookups.muById.get(atkId);
    const defMu = S.lookups.muById.get(defId);
    const muAvatar = (mu) => mu?.avatarUrl ? `<img src="${mu.avatarUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;display:block">` : "";
    atkAvatar = muAvatar(atkMu);
    defAvatar = muAvatar(defMu);
  } else {
    atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId);
    def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId);
    atkId = b.attacker?.country||b.attackerCountry||b.attacker?.countryId;
    defId = b.defender?.country||b.defenderCountry||b.defender?.countryId;
    const atkCode = (S.lookups.countriesById.get(atkId)?.code||"").toLowerCase();
    const defCode = (S.lookups.countriesById.get(defId)?.code||"").toLowerCase();
    atkAvatar = atkCode ? `<img src="https://media.warera.io/images/flags/${atkCode.toLowerCase()}.svg" alt="" style="width:32px;display:block">` : "";
    defAvatar = defCode ? `<img src="https://media.warera.io/images/flags/${defCode.toLowerCase()}.svg" alt="" style="width:32px;display:block">` : "";
  }
  const { atkColor, defColor, atkText, defText, atkBarText, defBarText } = battleSideColors(b);
  const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region);
  const isLive = !b.endedAt || b.isActive===true || b.active===true;
  const started = b.createdAt||b.startedAt||"";
  const ended = b.endedAt||"";
  const winner = b.winner||(b.wonBy==="attacker"?atk:b.wonBy==="defender"?def:null);

  function sumDmg(d) {
    if (d == null) return 0;
    if (typeof d === "number") return d;
    if (typeof d === "object") return Object.values(d).reduce((s, v) => s + (Number(v) || 0), 0);
    return Number(d) || 0;
  }
  const liveTag = isLive ? ` <span style="color:var(--red);font-size:.68rem;animation:livePulse 1.5s infinite;display:inline-block">● LIVE</span>` : "";
  const battleTypeLabel = b.type === "resistance" ? "Resistance" : b.type === "revolution" ? "Civil War" : b.type === "war" ? "Battle" : b.type === "tournament" ? "MU Tournament" : "Combat";
  const rounds = roundsData || [];
  const sortedRounds = [...rounds].sort((a,b) => {
    const ta = new Date(a.createdAt||a.startedAt||0).getTime();
    const tb = new Date(b.createdAt||b.startedAt||0).getTime();
    return ta - tb;
  });
  const currentLiveRound = roundsData.find(rd => rd._isCurrent) || [...sortedRounds].reverse().find(rd => rd._isCurrent || !rd.endedAt) || null;
  const tickInfo = currentLiveRound?.live || b.live || null;
  const atkRoundsWon = Number(b.attacker?.wonRoundsCount ?? b.attackerRoundsWon ?? 0);
  const defRoundsWon = Number(b.defender?.wonRoundsCount ?? b.defenderRoundsWon ?? 0);
  const roundsToWin  = Number(b.roundsToWin ?? 2);
  const startedDate = new Date(started);
  const endedDate = ended ? new Date(ended) : new Date();
  const durationMs = endedDate - startedDate;
  const durationStr = durationMs > 0 ? formatDuration(durationMs) : "";

  const roundTabsHtml = sortedRounds.length > 0 ? `
  <div class="br-round-tabs" id="brRoundTabs_${bid}" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px;">
    ${sortedRounds.map((rd,i)=>{
      const rdWinner = rd.wonBy === "attacker" ? (atk||"ATK") : rd.wonBy === "defender" ? (def||"DEF") : null;
      const isActive = (rd.isActive===true || rd._isCurrent===true || !rd.endedAt) && !rdWinner;
      const badge = rdWinner ? `<iconify-icon icon="mdi:trophy" class="lu" style="font-size:.6rem;margin-left:3px"></iconify-icon>` : isActive ? `<span style="color:var(--red);font-size:.6rem;margin-left:3px">●</span>` : "";
      return `<button class="pill-btn" data-round-idx="${i}" data-round-tab-bid="${bid}" style="font-size:.72rem">Round ${i+1}${badge}</button>`;
    }).join("")}
    <button class="pill-btn" data-round-idx="overall" data-round-tab-bid="${bid}" style="font-size:.72rem">Overall</button>
  </div>` : "";

  function buildRoundGpBar(rd, roundIdx) {
    if (!rd) return "";
    const atkPts = rd?.pointsAttacker ?? rd?.attacker?.points ?? 0;
    const defPts = rd?.pointsDefender ?? rd?.defender?.points ?? 0;
    const MAX_GP = 300;
    const safeAtk = Math.min(atkPts, MAX_GP);
    const safeDef = Math.min(defPts, MAX_GP);
    const atkBarPct = Math.round((safeAtk / MAX_GP) * 50);
    const defBarPct = Math.round((safeDef / MAX_GP) * 50);
    const rdWinner = rd?.wonBy === "attacker" ? (atk || "Attacker") : rd?.wonBy === "defender" ? (def || "Defender") : null;
    const rdStatus = rdWinner
      ? `<span style="color:var(--green);font-size:.72rem"><iconify-icon icon="mdi:trophy" class="lu"></iconify-icon> Won by ${rdWinner}</span>`
      : (rd?.isActive === true || rd?._isCurrent === true || !rd?.endedAt)
      ? `<span style="color:var(--red);font-size:.72rem">● Active</span>`
      : `<span style="color:var(--ink-dim);font-size:.72rem">Ended</span>`;

    return `<div class="br-section" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:.78rem;font-weight:800;color:var(--ink-dim);text-transform:uppercase;letter-spacing:.06em">Round ${roundIdx + 1} Ground Points</span>
      ${rdStatus}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:5px">
      <span style="color:${atkText};font-weight:800">${atk || "Attacker"} <strong>${fmtNum(atkPts)}</strong> pts</span>
      <span style="color:var(--ink-dim);font-size:.68rem">First to 300 wins</span>
      <span style="color:${defText};font-weight:800"><strong>${fmtNum(defPts)}</strong> pts ${def || "Defender"}</span>
    </div>
    <div style="position:relative;height:16px;background:var(--line);overflow:hidden;display:flex;align-items:center;">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${atkBarPct}%;background:${atkColor};transition:width .5s ease;"></div>
      <div style="position:absolute;right:0;top:0;bottom:0;width:${defBarPct}%;background:${defColor};transition:width .5s ease;"></div>
      <div style="position:absolute;left:50%;top:10%;bottom:10%;width:2px;background:var(--ink-dim);opacity:.4;transform:translateX(-50%);"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.64rem;color:var(--ink-dim);margin-top:3px">
      <span>0</span><span>150</span><span style="position:relative;left:-4px">300</span><span>150</span><span>0</span>
    </div>
  </div>`;
  }

  const atkOrderCount = orderSideList(orders, "attacker").length;
  const defOrderCount = orderSideList(orders, "defender").length;
  const orderBtnHtml = (count, side) => {
    const color = side === "attacker" ? atkColor : defColor;
    const text = side === "attacker" ? atkText : defText;
    const btn = `<button class="order-detail-btn" data-order-side="${side}" data-order-bid="${bid}" title="${count} ${side} order${count === 1 ? "" : "s"} issued" style="width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid ${color};color:${text};background:color-mix(in srgb, ${color} 16%, transparent);cursor:pointer;padding:0"><iconify-icon icon="mdi:bullseye" class="lu" style="font-size:15px"></iconify-icon></button>`;
    const cnt = `<span style="font-size:.74rem;font-weight:900;color:${text};min-width:1em;text-align:center;font-variant-numeric:tabular-nums" title="Orders issued">${count}</span>`;
    return `<span style="display:inline-flex;align-items:center;gap:5px">${side === "attacker" ? btn + cnt : cnt + btn}</span>`;
  };

  const battleScoreHtml = `
  <div style="display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:12px;background:var(--surface-hi);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:8px">${atkAvatar}${isLive ? orderBtnHtml(atkOrderCount, "attacker") : ""}</div>
    <div style="display:flex;justify-content:center;align-items:center;gap:16px">
      <div style="text-align:center">
        <div style="font-size:2rem;font-weight:900;color:${atkText};line-height:1">${atkRoundsWon}</div>
        <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;color:var(--ink-dim);margin-top:2px">${atk||"Attacker"}</div>
      </div>
      <div style="text-align:center;color:var(--ink-dim)">
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Battle Score</div>
        <div style="font-size:.66rem;margin-top:2px">First to ${roundsToWin} rounds wins</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:2rem;font-weight:900;color:${defText};line-height:1">${defRoundsWon}</div>
        <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;color:var(--ink-dim);margin-top:2px">${def||"Defender"}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px">${isLive ? orderBtnHtml(defOrderCount, "defender") : ""}${defAvatar}</div>
  </div>`;

  const liveTickHtml = isLive && tickInfo ? `
  <div class="br-section" style="margin-bottom:12px;padding:10px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <iconify-icon icon="mdi:timer-sand" class="lu" style="font-size:16px"></iconify-icon>
    <span style="font-size:.78rem;font-weight:800">Tick <span id="brTickNo_${bid}">${Number(tickInfo.ticksCount) || 0}</span></span>
    <span style="font-size:.72rem;color:var(--ink-dim)">damage leader earns <strong>${Number(tickInfo.actualTickPoints) || 1} pts</strong> per tick · first to 300 pts wins</span>
    <span style="margin-left:auto;font-size:.72rem;color:var(--ink-dim)">next tick in <strong id="brTickCount_${bid}" style="font-variant-numeric:tabular-nums">--:--</strong></span>
  </div>` : "";

  function orderSplit(list) {
    return { atk: orderSideList(list, "attacker"), def: orderSideList(list, "defender") };
  }

  function overallScope() {
    let rawAtkDmg = b.attacker?.damages, rawDefDmg = b.defender?.damages;
    let rawAtkHits = b.attacker?.hitCount, rawDefHits = b.defender?.hitCount;
    if (currentLiveRound) {
      if (currentLiveRound.attacker?.damages != null) rawAtkDmg = currentLiveRound.attacker.damages;
      if (currentLiveRound.defender?.damages != null) rawDefDmg = currentLiveRound.defender.damages;
      if (currentLiveRound.attacker?.hitCount != null) rawAtkHits = currentLiveRound.attacker.hitCount;
      if (currentLiveRound.defender?.hitCount != null) rawDefHits = currentLiveRound.defender.hitCount;
    }
    let atkDmg = rawAtkDmg != null ? sumDmg(rawAtkDmg) : rankUsers.filter(r => r._side === "attacker").reduce((s, r) => s + getValue(r), 0);
    let defDmg = rawDefDmg != null ? sumDmg(rawDefDmg) : rankUsers.filter(r => r._side === "defender").reduce((s, r) => s + getValue(r), 0);
    let totalDmg = atkDmg + defDmg || b.totalDamage || b.damage || 0;
    if (!totalDmg && roundsData && roundsData.length) {
      atkDmg = roundsData.reduce((s, rd) => s + (rd.attacker?.damages ?? 0), 0);
      defDmg = roundsData.reduce((s, rd) => s + (rd.defender?.damages ?? 0), 0);
      totalDmg = atkDmg + defDmg;
    }
    let atkGp = gpUsers.filter(r => r._side === "attacker").reduce((s, r) => s + getPoints(r), 0);
    let defGp = gpUsers.filter(r => r._side === "defender").reduce((s, r) => s + getPoints(r), 0);
    if (currentLiveRound) {
      if (currentLiveRound.attacker?.points != null) atkGp = currentLiveRound.attacker.points;
      if (currentLiveRound.defender?.points != null) defGp = currentLiveRound.defender.points;
    }
    const participantsA = atkPar || b.atkPar || 0;
    const participantsD = defPar || b.defPar || 0;
    const atkPct = totalDmg > 0 ? Math.round((atkDmg / totalDmg) * 100) : 50;
    const defPct = 100 - atkPct;
    const hitCount = (rawAtkHits || 0) + (rawDefHits || 0);
    const sides = orderSplit(orders);
    let narrative = "";
    if (isLive) {
      narrative = `${battleTypeLabel} ongoing: <strong>${atk||"Attacker"}</strong> vs <strong>${def||"Defender"}</strong>${reg?" in "+reg:""}. Damage split: ${atkPct}% vs ${defPct}%.`;
    } else {
      narrative = winner
        ? `<strong>${winner}</strong> secured victory${reg?" at "+reg:""}. Total damage: ${fmtNum(totalDmg)}. ${participantsA + participantsD} fighters participated.`
        : `Battle concluded${reg?" at "+reg:""}. Total damage: ${fmtNum(totalDmg)}.`;
    }
    return {
      scopeKey: "overall",
      label: "Overall",
      atkDmg, defDmg, totalDmg, atkGp, defGp, atkPct, defPct,
      participantsA, participantsD, participantsT: participantsA + participantsD,
      hitCount,
      statusLabel: isLive ? "LIVE" : "ENDED",
      winner, started, ended,
      narrative,
      damageUsers: rankUsers, damageMu: rankMu, damageCountry: rankCountry,
      gpUsers, gpMu, gpCountry,
      ordersAtk: sides.atk, ordersDef: sides.def,
    };
  }

  function roundScope(rd, idx) {
    const pr = perRoundData?.[rd._id] || {};
    const dUsers = pr.damageUsers || [];
    const rawAtkDmg = rd.attacker?.damages, rawDefDmg = rd.defender?.damages;
    const atkDmg = rawAtkDmg != null ? sumDmg(rawAtkDmg) : dUsers.filter(r => r._side === "attacker").reduce((s, r) => s + getValue(r), 0);
    const defDmg = rawDefDmg != null ? sumDmg(rawDefDmg) : dUsers.filter(r => r._side === "defender").reduce((s, r) => s + getValue(r), 0);
    const totalDmg = atkDmg + defDmg;
    const atkPct = totalDmg > 0 ? Math.round((atkDmg / totalDmg) * 100) : 50;
    const defPct = 100 - atkPct;
    const atkGp = pr.atkGp || rd.pointsAttacker || rd.attacker?.points || 0;
    const defGp = pr.defGp || rd.pointsDefender || rd.defender?.points || 0;
    const participantsA = pr.atkPar || 0;
    const participantsD = pr.defPar || 0;
    const hitCount = (rd.attacker?.hitCount || 0) + (rd.defender?.hitCount || 0);
    const rWinner = rd.wonBy === "attacker" ? atk : rd.wonBy === "defender" ? def : null;
    const rActive = (rd.isActive === true || rd._isCurrent === true || !rd.endedAt) && !rWinner;
    const statusLabel = rWinner ? "WON" : rActive ? "ACTIVE" : "ENDED";
    const narrative = `Round ${idx + 1} ${rWinner ? `won by <strong>${rWinner}</strong>` : rActive ? "ongoing" : "concluded"}${totalDmg ? `: ${fmtNum(totalDmg)} total damage, ${atkPct}% vs ${defPct}% split` : ""}.`;
    const rSides = orderSplit([...(pr.ordersAtk || []), ...(pr.ordersDef || [])]);
    return {
      scopeKey: String(idx),
      label: `Round ${idx + 1}`,
      atkDmg, defDmg, totalDmg, atkGp, defGp, atkPct, defPct,
      participantsA, participantsD, participantsT: participantsA + participantsD,
      hitCount,
      statusLabel,
      winner: rWinner,
      started: rd.createdAt || rd.startedAt || "",
      ended: rd.endedAt || "",
      narrative,
      damageUsers: dUsers,
      damageMu: pr.damageMu || [],
      damageCountry: pr.damageCountry || [],
      gpUsers: pr.gpUsers || [],
      gpMu: pr.gpMu || [],
      gpCountry: pr.gpCountry || [],
      ordersAtk: rSides.atk,
      ordersDef: rSides.def,
      round: rd,
      roundIdx: idx,
    };
  }

  function scopeFor(key) {
    if (key === "overall") return overallScope();
    const idx = Number(key);
    return roundScope(sortedRounds[idx], idx);
  }

  const rankRowNum = i => rankBadgeHtml(i + 1);

  const rankConfigFor = (sc) => ({
    damage: { value: getValue, label: "Damage", sources: { users: sc.damageUsers, mus: sc.damageMu, countries: sc.damageCountry } },
    points: { value: getPoints, label: "Ground Points", sources: { users: sc.gpUsers, mus: sc.gpMu, countries: sc.gpCountry } },
  });
  const rankEntity = {
    users: { label: "Fighter", name: r => nameUser(r.userId || r.user) || r.username, link: r => `https://app.warera.io/user/${r.userId || r.user}` },
    mus: { label: "Military Unit", name: r => nameMu(r.muId || r.mu) || `MU ${String(r.muId || r.mu).slice(-6)}`, link: r => `https://app.warera.io/mu/${r.muId || r.mu}` },
    countries: { label: "Country", name: r => nameCountry(r.countryId || r.country) || r.countryName || r.name, link: r => `https://app.warera.io/country/${r.countryId || r.country}` },
  };

  function scoreBarHtml(sc) {
    return `<div class="score-bar-wrap" style="margin-top:8px">
      <div class="score-bar-labels">
        <span style="color:${atkText};font-weight:800">${atk||"Attacker"} ${sc.atkPct}%</span>
        <span style="color:var(--ink-dim);font-size:.72rem">DAMAGE SHARE</span>
        <span style="color:${defText};font-weight:800">${sc.defPct}% ${def||"Defender"}</span>
      </div>
      <div class="score-bar">
  <div style="flex:${sc.atkPct} 0 0; background:${atkColor}; border-right:2px solid rgba(255,255,255,0.65); display:flex; align-items:center; justify-content:flex-end; padding-right:8px;">
    <span style="font-size:26px;line-height:1;font-family:var(--font-ui);font-weight:900;color:${atkBarText}">${fmtNum(sc.atkDmg)}</span>
  </div>
  <div style="flex:${sc.defPct} 0 0; background:${defColor}; display:flex; align-items:center; justify-content:flex-start; padding-left:8px;">
    <span style="font-size:26px;line-height:1;font-family:var(--font-ui);font-weight:900;color:${defBarText}">${fmtNum(sc.defDmg)}</span>
  </div>
</div>
    </div>`;
  }

  function statsGridHtml(sc) {
    return `<div class="br-stats-grid">
      ${atk?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.85rem">${atk}</span><span class="br-stat-lbl">Attacker</span></div>`:""}
      <div class="br-stat-box"><span class="br-stat-val">${sc.participantsA||"—"}</span><span class="br-stat-lbl"> Attacker Participants</span></div>
      <div class="br-stat-box"><span class="br-stat-val" style="color:${atkText}">${sc.atkDmg?fmtNum(sc.atkDmg):"—"}</span><span class="br-stat-lbl">Attacker Damage</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${sc.totalDmg?fmtNum(sc.totalDmg):"—"}</span><span class="br-stat-lbl">Total Damage</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${sc.statusLabel}</span><span class="br-stat-lbl">Status</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${sc.hitCount ? fmtNum(sc.hitCount) : "—"}</span><span class="br-stat-lbl">Total Hits</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${sc.participantsD||"—"}</span><span class="br-stat-lbl">Defender Participants</span></div>
      <div class="br-stat-box"><span class="br-stat-val" style="color:${defText}">${sc.defDmg?fmtNum(sc.defDmg):"—"}</span><span class="br-stat-lbl">Defender Damage</span></div>
      ${def?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.85rem">${def}</span><span class="br-stat-lbl">Defender</span></div>`:""}
      ${reg?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.82rem">${reg}</span><span class="br-stat-lbl">Region</span></div>`:""}
      ${sc.started?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.72rem">${fmtDate(sc.started)}</span><span class="br-stat-lbl">Started</span></div>`:""}
      ${sc.ended?`<div class="br-stat-box"><span class="br-stat-val" style="font-size:.72rem">${fmtDate(sc.ended)}</span><span class="br-stat-lbl">Ended</span></div>`:""}
      ${sc.winner?`<div class="br-stat-box" style="border-color:var(--green)"><span class="br-stat-val"><iconify-icon icon="mdi:trophy" class="lu"></iconify-icon> ${sc.winner}</span><span class="br-stat-lbl">Winner</span></div>`:""}
    </div>`;
  }

  function rankTableHtml(cat, type, sc) {
    const cfg = rankConfigFor(sc)[cat];
    const ent = rankEntity[type];
    const list = cfg.sources[type];
    if (!list || !list.length) return `<p style="color:var(--ink-dim);text-align:center;padding:12px 0">No ranking data available.</p>`;
    const atkRank = list.filter(r => r._side === "attacker").sort((a, b) => cfg.value(b) - cfg.value(a)).slice(0, 10);
    const defRank = list.filter(r => r._side === "defender").sort((a, b) => cfg.value(b) - cfg.value(a)).slice(0, 10);
    if (!atkRank.length && !defRank.length) return `<p style="color:var(--ink-dim);text-align:center;padding:12px 0">No ranking data available.</p>`;
    const maxRows = Math.max(atkRank.length, defRank.length);
    const rows = Array.from({ length: maxRows }, (_, i) => {
      const a = atkRank[i], d = defRank[i];
      const atkHtml = a ? `<td>${rankRowNum(i)}</td><td>${makeEntityLink(ent.name(a) || "Unknown", ent.link(a))}</td><td>${fmtNum(cfg.value(a))}</td>` : `<td></td><td></td><td></td>`;
      const defHtml = d ? `<td>${rankRowNum(i)}</td><td>${makeEntityLink(ent.name(d) || "Unknown", ent.link(d))}</td><td>${fmtNum(cfg.value(d))}</td>` : `<td></td><td></td><td></td>`;
      return `<tr>${atkHtml}${defHtml}</tr>`;
    }).join("");
    return `<table class="rank-table"><thead>
    <tr><th colspan="3" style="color:${atkText}">ATTACKER</th><th colspan="3" style="color:${defText}">DEFENDER</th></tr>
    <tr><th>#</th><th>${ent.label}</th><th>${cfg.label}</th><th>#</th><th>${ent.label}</th><th>${cfg.label}</th></tr>
    </thead><tbody>${rows}</tbody></table>`;
  }

  function rankingsHtml(sc, cat, type) {
    const rankCatPills = [
      ["damage", `<iconify-icon icon="mdi:sword-cross" class="lu"></iconify-icon> Damage`],
      ["points", `<iconify-icon icon="mdi:flag" class="lu"></iconify-icon> Ground Points`],
    ];
    const rankTypePills = [
      ["users", "Users"],
      ["mus", "MUs"],
      ["countries", "Countries"],
    ];
    const rankPillHtml = (list, group, defaultVal) => list.map(([val, label]) =>
      `<button class="pill-btn${val === defaultVal ? " active" : ""}" data-rank-${group}="${val}" style="font-size:.72rem">${label}</button>`
    ).join("");
    const rankTablesHtml = rankCatPills.map(([c]) => rankTypePills.map(([t]) =>
      `<div data-rank-table="${c}-${t}" style="${c === cat && t === type ? "" : "display:none"}">${rankTableHtml(c, t, sc)}</div>`
    ).join("")).join("");
    return `<div class="br-section">
      <h3 class="br-section-title"><iconify-icon icon="mdi:podium" class="lu"></iconify-icon> Rankings</h3>
      <div id="brRankTabs_${bid}" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        ${rankPillHtml(rankCatPills, "cat", cat)}
        <span style="width:10px"></span>
        ${rankPillHtml(rankTypePills, "type", type)}
      </div>
      <div id="brRankTables_${bid}">${rankTablesHtml}</div>
    </div>`;
  }

  function ordersHtml(sc) {
    const atkOrders = sc.ordersAtk;
    const defOrders = sc.ordersDef;
    const maxRows = Math.max(atkOrders.length, defOrders.length);
    return `<div class="br-section"><h3 class="br-section-title"><iconify-icon icon="mdi:bullseye-arrow" class="lu"></iconify-icon> Battle Orders</h3>
    <table class="rank-table"><thead>
<tr><th colspan="4" style="color:${atkText}">ATTACKER</th><th colspan="4" style="color:${defText}">DEFENDER</th></tr>
<tr><th>Through</th><th>Issuer</th><th>Issued By</th><th>Priority</th><th>Through</th><th>Issuer</th><th>Issued By</th><th>Priority</th></tr>
</thead><tbody>
${Array.from({length:maxRows}).map((_,i)=>{
  return `<tr>${atkOrders[i] ? orderRowHtml(atkOrders[i]) : `<td colspan="4"></td>`}${defOrders[i] ? orderRowHtml(defOrders[i]) : `<td colspan="4"></td>`}</tr>`;
}).join("")}
</tbody></table></div>`;
  }

  function buildScopeHtml(sc) {
    let h = `<div class="br-narrative">${sc.narrative}</div>`;
    if (sc.round) h += buildRoundGpBar(sc.round, sc.roundIdx);
    h += scoreBarHtml(sc);
    h += statsGridHtml(sc);
    const anyRank = [sc.damageUsers, sc.gpUsers, sc.damageMu, sc.gpMu, sc.damageCountry, sc.gpCountry].some(l => l && l.length);
    if (anyRank) h += rankingsHtml(sc, view.cat, view.type);
    if (sc.ordersAtk.length || sc.ordersDef.length) h += ordersHtml(sc);
    return h;
  }

  const staticTop = `<div class="br-section">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
    <h3 class="br-section-title" style="margin:0">Battle Overview${liveTag}</h3>
    <button id="clearBattleDetailBtn" class="btn-secondary" style="margin-left:auto;padding:4px 10px;min-width:auto;">⌫ Clear</button>
  </div>
  ${roundTabsHtml}
  ` + battleScoreHtml + liveTickHtml + bountySummaryHtml(b, contracts, money);

  const scopeBodyId = `brScopeBody_${bid}`;

  const staticBottom = (isLive ? `<p style="text-align:center;color:var(--ink-dim);font-size:.76rem;padding:6px 0"><iconify-icon icon="mdi:sync" class="lu nd-spin"></iconify-icon> Auto-refreshing every 5 s</p>` : "") + `<div style="padding:8px 0;display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn-primary" id="openFullReportBtn" style="flex:1"><iconify-icon icon="mdi:file-document-outline" class="lu"></iconify-icon> Open Full Report</button>
    <button class="btn-secondary" id="exportBattleXlsBtn" style="flex:1"><iconify-icon icon="mdi:file-excel-outline" class="lu"></iconify-icon> Export XLS</button>
        <button class="btn-secondary" id="captureBattlePaneBtn" style="flex:1"><iconify-icon icon="mdi:camera" class="lu"></iconify-icon> Capture Report</button>
  </div>`;

  E.battleDetailPane.innerHTML = staticTop + `<div id="${scopeBodyId}"></div>` + staticBottom;

  if (isLive && tickInfo?.nextTickAt) {
    const countEl = document.getElementById(`brTickCount_${bid}`);
    const noEl = document.getElementById(`brTickNo_${bid}`);
    const updateTick = () => {
      const diff = new Date(tickInfo.nextTickAt).getTime() - Date.now();
      if (countEl) {
        if (diff <= 0) { countEl.textContent = "due…"; if (noEl) noEl.textContent = String((Number(tickInfo.ticksCount) || 0) + 1); return; }
        const s = Math.floor(diff / 1000);
        countEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }
    };
    updateTick();
    S.battleTickTimer = setInterval(updateTick, 1000);
  }

  bindBountySummaryButtons(E.battleDetailPane, b, bid, contracts);
  document.getElementById("clearBattleDetailBtn")?.addEventListener("click", () => { clearBattleDetail(); });
  E.battleDetailPane.querySelectorAll(".order-detail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const side = btn.dataset.orderSide;
      const color = side === "attacker" ? atkColor : defColor;
      const sideName = side === "attacker" ? (atk || "Attacker") : (def || "Defender");
      openOrdersModal(side, orders, `${sideName} Battle Orders`, `Live battle · ${orderSideList(orders, side).length} order${orderSideList(orders, side).length === 1 ? "" : "s"} issued${reg ? " · " + reg : ""}`, color);
    });
  });

  function bindRankTabs(root) {
    const tableBox = root?.querySelector(`#brRankTables_${bid}`);
    if (!tableBox) return;
    const syncRankTables = () => {
      const cat = root.querySelector("[data-rank-cat].active")?.dataset.rankCat || "damage";
      const type = root.querySelector("[data-rank-type].active")?.dataset.rankType || "users";
      tableBox.querySelectorAll("[data-rank-table]").forEach(t => {
        t.style.display = t.dataset.rankTable === `${cat}-${type}` ? "block" : "none";
      });
    };
    root.querySelectorAll("[data-rank-cat], [data-rank-type]").forEach(btn => {
      btn.addEventListener("click", () => {
        const group = btn.hasAttribute("data-rank-cat") ? "data-rank-cat" : "data-rank-type";
        root.querySelectorAll(`[${group}]`).forEach(other => other.classList.toggle("active", other === btn));
        syncRankTables();
        view.cat = root.querySelector("[data-rank-cat].active")?.dataset.rankCat || "damage";
        view.type = root.querySelector("[data-rank-type].active")?.dataset.rankType || "users";
        saveView();
      });
    });
  }

  let currentScopeData = null;
  let currentScopeHtml = "";

  let view = (S.battleView && S.battleView.bid === bid) ? { roundIdx: S.battleView.roundIdx || "overall", cat: S.battleView.cat || "damage", type: S.battleView.type || "users" } : { roundIdx: "overall", cat: "damage", type: "users" };
  if (view.roundIdx !== "overall") {
    const idx = Number(view.roundIdx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= sortedRounds.length) view.roundIdx = "overall";
  }
  const saveView = () => { S.battleView = { bid, roundIdx: view.roundIdx, cat: view.cat, type: view.type }; };

  function renderScope(idx) {
    currentScopeData = scopeFor(idx);
    currentScopeHtml = buildScopeHtml(currentScopeData);
    const bodyEl = document.getElementById(scopeBodyId);
    if (bodyEl) { bodyEl.innerHTML = currentScopeHtml; bindRankTabs(bodyEl); }
  }

  const roundTabContainer = document.getElementById(`brRoundTabs_${bid}`);
  const allTabBtns = roundTabContainer ? roundTabContainer.querySelectorAll("[data-round-idx]") : [];
  function activateRoundTab(idx) {
    allTabBtns.forEach(btn => { btn.classList.toggle("active", btn.dataset.roundIdx === String(idx)); });
    view.roundIdx = String(idx);
    saveView();
    renderScope(idx);
  }
  const defaultIdx = view.roundIdx;
  allTabBtns.forEach(btn => { btn.classList.toggle("active", btn.dataset.roundIdx === String(defaultIdx)); });
  allTabBtns.forEach(btn => { btn.addEventListener("click", () => { activateRoundTab(btn.dataset.roundIdx); }); });
  renderScope(defaultIdx);

  document.getElementById("openFullReportBtn")?.addEventListener("click", () => {
    const title = `${battleTypeLabel}: ${atk||"?"} vs ${def||"?"}${reg?" — "+reg:""}`;
    E.battleReportTitle.textContent = "Battle Report: "+title;
    E.battleReportMeta.textContent = `${isLive?"Live":"Ended"} · ${started?fmtDate(started):""}${ended?" → "+fmtDate(ended):""}`;
    E.battleReportContent.innerHTML = (staticTop + currentScopeHtml + staticBottom).replace(/<div[^>]*>\s*<button[^>]*id="openFullReportBtn"[^>]*>[\s\S]*?<\/div>/, "");
    bindBountySummaryButtons(E.battleReportContent, b, bid, contracts);
    bindRankTabs(E.battleReportContent);
    if (E.openBattlePageBtn) { E.openBattlePageBtn.dataset.battleId = bid; }
    E.battleReportModal.classList.remove("hidden");
  });

  document.getElementById("exportBattleXlsBtn")?.addEventListener("click", () => {
    if (!currentScopeData) return;
    exportBattleXLS(b, bid, currentScopeData.damageUsers, currentScopeData.gpUsers, currentScopeData.damageMu, currentScopeData.gpMu, currentScopeData.damageCountry, currentScopeData.gpCountry);
  });

  document.getElementById("captureBattlePaneBtn")?.addEventListener("click", async () => {
    const ch = await import("../core/captureReport.js");
    const sc = currentScopeData || overallScope();
    const title2 = `${battleTypeLabel}: ${atk||"Attacker"} vs ${def||"Defender"}${reg?" — "+reg:""}${sc.scopeKey === "overall" ? "" : " · "+sc.label}`;
    const slug = (atk||"Attacker")+"_vs_"+(def||"Defender")+(reg?"_"+reg.replace(/[\s-]+/g,"_"):"")+(sc.scopeKey === "overall" ? "" : "_round_"+(sc.roundIdx+1));
    const ptotalDmg = sc.totalDmg || sc.damageUsers.reduce((s, r) => s + getValue(r), 0);
    const ptotalGp = (sc.atkGp + sc.defGp) || sc.gpUsers.reduce((s, r) => s + getPoints(r), 0);
    const parts = (sc.participantsA||0)+(sc.participantsD||0);
    const score = `${atkRoundsWon}—${defRoundsWon}`;
    const meta = [
      `Attacker: ${atk||"—"} | Defender: ${def||"—"}${reg?" · Region: "+reg:""} | Winner: ${sc.winner||winner||"—"} | Score: ${score}`,
      `Damage: ${fmtNum(ptotalDmg)} | Total Hits: ${sc.hitCount} | Participants: ${fmtNum(parts)}`,
      `${sc.started ? "Started: "+fmtDate(sc.started) : ""}${sc.ended ? "  ·  Ended: "+fmtDate(sc.ended) : ""}${durationStr ? "  ·  "+durationStr : ""}`,
      `Generated: ${new Date().toUTCString()}`,
    ];
    if (sc.damageUsers.length) {
      const atkD = sc.damageUsers.filter(r => r._side === "attacker").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const defD = sc.damageUsers.filter(r => r._side === "defender").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const atkG = sc.gpUsers.filter(r => r._side === "attacker").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const defG = sc.gpUsers.filter(r => r._side === "defender").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const dm = rowsSideBySide(atkD, defD, r => nameUser(r.userId||r.user)||r.username||"Unknown", getValue);
      const gp = rowsSideBySide(atkG, defG, r => nameUser(r.userId||r.user)||r.username||"Unknown", getPoints);
      const subH = `<th colspan="3" style="${ch.STYLE.th};text-align:center">ATTACKER</th><th colspan="3" style="${ch.STYLE.th};text-align:center">DEFENDER</th>`;
      const html = ch.pageOpen("War Era Battle Report", title2, meta) +
        ch.section("Top Fighters by Damage", ch.tableBlock("", ["#","Fighter","Damage","#","Fighter","Damage"], dm, 10, subH)) +
        ch.section("Top Fighters by Total Hits", ch.tableBlock("", ["#","Fighter","Ground Pts","#","Fighter","Ground Pts"], gp, 10, subH)) +
        ch.pageClose();
      await ch.captureHTML(html, `battle_${slug}_fighters_${ch.ts()}.png`);
    }
    if (sc.damageMu.length) {
      const atkD = sc.damageMu.filter(r => r._side === "attacker").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const defD = sc.damageMu.filter(r => r._side === "defender").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const atkG = sc.gpMu.filter(r => r._side === "attacker").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const defG = sc.gpMu.filter(r => r._side === "defender").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const dm = rowsSideBySide(atkD, defD, r => nameMu(r.muId||r.mu)||`MU ${String(r.muId||r.mu).slice(-6)}`, getValue);
      const gp = rowsSideBySide(atkG, defG, r => nameMu(r.muId||r.mu)||`MU ${String(r.muId||r.mu).slice(-6)}`, getPoints);
      const subH = `<th colspan="3" style="${ch.STYLE.th};text-align:center">ATTACKER</th><th colspan="3" style="${ch.STYLE.th};text-align:center">DEFENDER</th>`;
      const html = ch.pageOpen("War Era Battle Report", title2, meta) +
        ch.section("Top MUs by Damage", ch.tableBlock("", ["#","MU","Damage","#","MU","Damage"], dm, 10, subH)) +
        ch.section("Top MUs by Total Hits", ch.tableBlock("", ["#","MU","Ground Pts","#","MU","Ground Pts"], gp, 10, subH)) +
        ch.pageClose();
      await ch.captureHTML(html, `battle_${slug}_mu_${ch.ts()}.png`);
    }
    if (sc.damageCountry.length) {
      const atkD = sc.damageCountry.filter(r => r._side === "attacker").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const defD = sc.damageCountry.filter(r => r._side === "defender").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const atkG = sc.gpCountry.filter(r => r._side === "attacker").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const defG = sc.gpCountry.filter(r => r._side === "defender").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const dm = rowsSideBySide(atkD, defD, r => nameCountry(r.countryId||r.country)||r.countryName||r.name||"Unknown", getValue);
      const gp = rowsSideBySide(atkG, defG, r => nameCountry(r.countryId||r.country)||r.countryName||r.name||"Unknown", getPoints);
      const subH = `<th colspan="3" style="${ch.STYLE.th};text-align:center">ATTACKER</th><th colspan="3" style="${ch.STYLE.th};text-align:center">DEFENDER</th>`;
      const html = ch.pageOpen("War Era Battle Report", title2, meta) +
        ch.section("Top Countries by Damage", ch.tableBlock("", ["#","Country","Damage","#","Country","Damage"], dm, 10, subH)) +
        ch.section("Top Countries by Total Hits", ch.tableBlock("", ["#","Country","Ground Pts","#","Country","Ground Pts"], gp, 10, subH)) +
        ch.pageClose();
      await ch.captureHTML(html, `battle_${slug}_countries_${ch.ts()}.png`);
    }
  });
}

function rowsSideBySide(atkArr, defArr, nameFn, valFn) {
  const max = Math.max(atkArr.length, defArr.length);
  const rows = [];
  for (let i = 0; i < max; i++) {
    const a = atkArr[i]; const d = defArr[i];
    rows.push([
      a ? String(i+1) : "", a ? nameFn(a) : "", a ? fmtNum(valFn(a)) : "",
      d ? String(i+1) : "", d ? nameFn(d) : "", d ? fmtNum(valFn(d)) : "",
    ]);
  }
  return rows;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (d) parts.push(d + "d");
  if (h) parts.push(h + "h");
  if (m) parts.push(m + "m");
  if (s) parts.push(s + "s");
  return parts.join(" ") || "<1s";
}



function exportBattleXLS(b, bid, rankUsers, gpUsers, rankMu, gpMu, rankCountry, gpCountry) {
  const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId)||"Attacker";
  const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId)||"Defender";
  const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region)||"";
  const title = `${atk} vs ${def}${reg ? " - " + reg : ""}`;

  const users = rankUsers.map(normalizeRankRow);
  const mus = rankMu.map(normalizeRankRow);
  const countries = rankCountry.map(normalizeRankRow);
  const gps = gpUsers.map(normalizeRankRow);
  const gpMus = gpMu.map(normalizeRankRow);
  const gpCountries = gpCountry.map(normalizeRankRow);

  const gpByUser = {};
  gps.forEach(r => { const id = r.userId || r.user || ""; if (id) gpByUser[id] = r.gp; });
  const gpByMu = {};
  gpMus.forEach(r => { const id = r.muId || r.mu || ""; if (id) gpByMu[id] = r.gp; });
  const gpByCountry = {};
  gpCountries.forEach(r => { const id = r.countryId || r.country || ""; if (id) gpByCountry[id] = r.gp; });

  const totalDmg = users.reduce((s, r) => s + (r.damage || 0), 0) || 1;

  const sheet1 = [["Rank", "Fighter", "Side", "Damage", "Ground Points", "Damage %"]];
  users.sort((a, b) => (b.damage || 0) - (a.damage || 0)).forEach((r, i) => {
    const name = nameUser(r.userId || r.user) || r.username || "Unknown";
    const dmg = r.damage || 0;
    const gp = gpByUser[r.userId || r.user || ""] || 0;
    const share = ((dmg / totalDmg) * 100).toFixed(2);
    sheet1.push([i + 1, name, (r._side || "").toUpperCase(), dmg, gp, share]);
  });

  const sheet2 = [["Rank", "Military Unit", "Side", "Damage", "Ground Points"]];
  mus.sort((a, b) => (b.damage || 0) - (a.damage || 0)).forEach((r, i) => {
    const muId = r.muId || r.mu;
    const name = nameMu(muId) || `MU ${String(muId).slice(-6)}`;
    const dmg = r.damage || 0;
    const gp = gpByMu[muId] || 0;
    sheet2.push([i + 1, name, (r._side || "").toUpperCase(), dmg, gp]);
  });

  const sheet3 = [["Rank", "Country", "Side", "Damage", "Ground Points"]];
  countries.sort((a, b) => (b.damage || 0) - (a.damage || 0)).forEach((r, i) => {
    const cid = r.countryId || r.country;
    const name = nameCountry(cid) || r.countryName || r.name || "Unknown";
    const dmg = r.damage || 0;
    const gp = gpByCountry[cid] || 0;
    sheet3.push([i + 1, name, (r._side || "").toUpperCase(), dmg, gp]);
  });

  buildAndDownloadXLS(title, [
    { name: "Fighters", data: sheet1 },
    { name: "Military Units", data: sheet2 },
    { name: "Countries", data: sheet3 }
  ]);
}
