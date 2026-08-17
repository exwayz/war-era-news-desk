import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, fetchTrpcApi2, fetchTournamentTeams, unwrap } from "../core/api.js";
import { fmtDate, fmtNum, fmtMoney, getValue, getPoints, normalizeRankRow, escapeHtml, rankBadgeHtml } from "../core/utils.js";
import { nameCountry, nameRegion, nameUser, nameMu, battleSideColors, ensureAlliances, allianceColor, allianceName, sideAllianceGroups, battleSideAllianceCountries, SCHEME_COLORS } from "./companies.js";
import { buildAndDownloadXLS, battleId, battleTypeKind } from "./battles.js";
import { fetchBattleContracts, fetchBattleMoney, bountySummaryHtml, bindBountySummaryButtons } from "./bounty.js";
import { ensureLookups } from "../timeline/filters.js";
import { toast } from "../ui/toast.js";

// Snapshot of the currently rendered battle detail, captured inside
// renderBattleDetail so the markdown copy report can be built on demand.
let _battleReportCtx = null;

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

function orderTableHtml(list, color) {
  if (!list.length) return `<p style="color:var(--ink-dim);text-align:center;padding:10px 0">No orders in this category.</p>`;
  return `<table class="rank-table"><thead>
<tr><th style="color:${color}">Through</th><th style="color:${color}">Issuer</th><th style="color:${color}">Issued By</th><th style="color:${color}">Priority</th></tr>
</thead><tbody>${list.map(o => `<tr>${orderRowHtml(o)}</tr>`).join("")}</tbody></table>`;
}

function ordersSection(title, icon, list, color) {
  return `<div class="orders-section"><div class="orders-section-head"><iconify-icon icon="${icon}" class="lu"></iconify-icon> <h3>${title}</h3> <span class="orders-count">${list.length}</span></div>${orderTableHtml(list, color)}</div>`;
}

function renderOrdersModalBody() {
  if (!E.battleOrdersModalBody) return;
  const { side, orders, title, byline, color } = _ordersModal;
  const list = orderSideList(orders, side);
  const country = list.filter(o => o.country);
  const mu = list.filter(o => o.mu);
  const other = list.filter(o => !o.country && !o.mu);
  const body = list.length
    ? ordersSection("Country Orders", "tdesign:flag-filled", country, color)
      + ordersSection("MU Orders", "carbon:pcn-military", mu, color)
      + (other.length ? ordersSection("Other Orders", "mdi:help-circle-outline", other, color) : "")
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
  const reqSeq = ++S.battleDetailSeq; // newer loads / clears invalidate this one
  // NOTE: do not stopBattlePolling() here — silent reloads must keep the live
  // countdown ticking; timer teardown is owned by the card click / clearBattleDetail.
  await ensureLookups(k).catch(()=>{});
  if (!silent) {
    const { atkColor, defColor } = battleSideColors(battle);
    if (E.battleReportTitle) E.battleReportTitle.textContent = "Battle Intelligence Report";
    if (E.battleReportMeta) E.battleReportMeta.textContent = "Loading intelligence report…";
    if (E.battleReportContent) E.battleReportContent.innerHTML = `<div style="padding:32px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--ink-dim)">
      <div class="spinner" style="--sp-c1:${atkColor};--sp-c2:${defColor}"><span class="spinnerin"></span></div>
      <span style="font-size:.82rem">Loading intelligence report…</span>
    </div>`;
    if (E.battleReportModal) E.battleReportModal.classList.remove("hidden");
  }
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

    // Resolve tournament team data (type + teams)
    if (bdDetail.type === "tournament" && bdDetail.tournament) {
      // Fetch tournament doc if not cached
      if (!S.lookups.tournamentsById.has(bdDetail.tournament)) {
        try {
          const tRes = await fetchTrpc("tournament.getById", { tournamentId: bdDetail.tournament }, k);
          const tData = unwrap(tRes);
          if (tData) S.lookups.tournamentsById.set(bdDetail.tournament, tData);
        } catch {}
      }
      // Fetch tournament teams if not cached
      const teamIds = [bdDetail.attacker?.tournamentTeam, bdDetail.defender?.tournamentTeam].filter(id => id && !S.lookups.tournamentTeamsById.has(id));
      if (teamIds.length) {
        const teams = await fetchTournamentTeams(bdDetail.tournament, k);
        for (const team of teams) {
          if (team?._id) S.lookups.tournamentTeamsById.set(team._id, team);
        }
      }
      // Also resolve the individual MUs that belong to the teams for ranking display
      const allTeamMuIds = new Set();
      for (const tid of [bdDetail.attacker?.tournamentTeam, bdDetail.defender?.tournamentTeam]) {
        const team = S.lookups.tournamentTeamsById.get(tid);
        if (team?.mus) team.mus.forEach(mid => allTeamMuIds.add(mid));
      }
      const unknownTeamMu = [...allTeamMuIds].filter(id => id && !S.lookups.muById.has(id));
      if (unknownTeamMu.length) {
        await Promise.all(unknownTeamMu.map(async mid => {
          try {
            const res = await fetchTrpc("mu.getById", { muId: mid }, k);
            const mu = unwrap(res);
            if (mu) S.lookups.muById.set(mid, mu);
          } catch {}
        }));
      }
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

    // battle.getLiveBattleData returns fresh tick/score data within seconds of a
    // tick, while round.getById can be cached server-side for ~5 minutes. Overlay
    // the live payload onto the current round so the countdown never freezes on
    // "due…" and the score/damage numbers advance on the real tick.
    const [liveGw, liveApi2] = await Promise.allSettled([
      fetchTrpc("battle.getLiveBattleData", { battleId: bid }, k),
      fetchTrpcApi2("battle.getLiveBattleData", { battleId: bid }, k),
    ]);
    const liveRes = (liveGw.status === "fulfilled" ? unwrap(liveGw.value) : null) || (liveApi2.status === "fulfilled" ? unwrap(liveApi2.value) : null);
    const liveRound = liveRes?.round;
    if (liveRound && (liveRound.nextTickAt || liveRound.actualTickPoints != null)) {
      const cur = roundsData.find(rd => rd._id === liveRound.roundId) || roundsData.find(rd => rd._isCurrent);
      if (cur) {
        cur.isActive = liveRound.isActive ?? cur.isActive;
        if (liveRound.nextTickAt || liveRound.actualTickPoints != null) {
          cur.live = { ...(cur.live || {}), nextTickAt: liveRound.nextTickAt ?? cur.live?.nextTickAt, actualTickPoints: liveRound.actualTickPoints ?? cur.live?.actualTickPoints };
        }
        if (liveRound.attackerPoints != null) { cur.attacker = { ...(cur.attacker || {}), points: liveRound.attackerPoints }; cur.pointsAttacker = liveRound.attackerPoints; }
        if (liveRound.defenderPoints != null) { cur.defender = { ...(cur.defender || {}), points: liveRound.defenderPoints }; cur.pointsDefender = liveRound.defenderPoints; }
        if (liveRound.attackerDamages != null) cur.attacker = { ...(cur.attacker || {}), damages: liveRound.attackerDamages };
        if (liveRound.defenderDamages != null) cur.defender = { ...(cur.defender || {}), damages: liveRound.defenderDamages };
      } else if (!roundsData.length) {
        roundsData.push({
          _id: liveRound.roundId,
          _isCurrent: true,
          isActive: liveRound.isActive ?? true,
          live: { nextTickAt: liveRound.nextTickAt, actualTickPoints: liveRound.actualTickPoints },
          attacker: { points: liveRound.attackerPoints ?? 0, damages: liveRound.attackerDamages ?? 0 },
          defender: { points: liveRound.defenderPoints ?? 0, damages: liveRound.defenderDamages ?? 0 },
          pointsAttacker: liveRound.attackerPoints ?? 0,
          pointsDefender: liveRound.defenderPoints ?? 0,
        });
      }
    }

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

    // Stale response guard: skip rendering if the battle was cleared or a newer load started.
    if (reqSeq !== S.battleDetailSeq || S.selectedBattleId !== bid) return;
    const allianceIds = [...new Set([
      ...battleSideAllianceCountries(bdDetail, ordersAtk, "attacker"),
      ...battleSideAllianceCountries(bdDetail, ordersDef, "defender"),
    ].map(cid => S.lookups.countriesById.get(cid)?.allianceId).filter(Boolean))];
    await ensureAlliances(allianceIds, k);
    renderBattleDetail(bdDetail, bid, allUsers, allMu, allCountry, gpUsers, gpMu, gpCountry, allOrders, atkParticipantCount, defParticipantCount, roundsData, perRoundData, contracts, money);
  } catch (err) {
    if (reqSeq === S.battleDetailSeq && S.selectedBattleId === bid && !silent) {
      E.battleReportContent.innerHTML = `<div class="status-msg error">${err.message||"Failed to load battle detail"}</div>`;
    } else if (reqSeq === S.battleDetailSeq && S.selectedBattleId === bid && silent) {
      // Keep the live refresh loop alive after a failed reload — otherwise the
      // battle detail would silently freeze until the user reopens or reloads.
      scheduleLiveRefresh(bid, true, null);
    }
  }
}

function renderBattleDetail(b, bid, rankUsers, rankMu, rankCountry, gpUsers, gpMu, gpCountry, orders, atkPar, defPar, roundsData, perRoundData, contracts, money) {
  clearInterval(S.battleTickTimer); S.battleTickTimer = null;
  const isTournament = b.type === "tournament";
  const isCivilWar = !isTournament && battleTypeKind(b.type) === "revolution";
  const cwDef = "Government";
  const cwAtk = "Rebels";
  const sideLabel = (side, fallback) => isCivilWar ? (side === "attacker" ? cwAtk : cwDef) : fallback;
  let atk, def, atkId, defId, atkAvatar, defAvatar;
  if (isTournament) {
    atkId = b.attacker?.tournamentTeam;
    defId = b.defender?.tournamentTeam;
    const atkTeam = S.lookups.tournamentTeamsById.get(atkId);
    const defTeam = S.lookups.tournamentTeamsById.get(defId);
    atk = atkTeam ? `Team ${atkTeam.number}` : (nameMu(atkId) || `Team ${String(atkId).slice(-4)}`);
    def = defTeam ? `Team ${defTeam.number}` : (nameMu(defId) || `Team ${String(defId).slice(-4)}`);
    // Build team emblem avatars (swords-emblem icon with team number)
    const teamEmblem = (team) => {
      if (!team) return "";
      const scheme = team.colorScheme || "";
      const shades = SCHEME_COLORS[scheme];
      const color = shades ? shades.light : "var(--ink-dim)";
      return `<span class="br-team-emblem bc-team-emblem" data-team-id="${escapeHtml(team._id)}" title="Team ${team.number} — click to view members" style="cursor:pointer">
        <iconify-icon icon="game-icons:swords-emblem" class="bc-team-swords" style="color:${color};font-size:44px;width:44px;height:44px"></iconify-icon>
        <span class="bc-team-num" style="color:#fff">${team.number}</span>
      </span>`;
    };
    atkAvatar = teamEmblem(atkTeam);
    defAvatar = teamEmblem(defTeam);
  } else {
    atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId);
    def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId);
    atkId = b.attacker?.country||b.attackerCountry||b.attacker?.countryId;
    defId = b.defender?.country||b.defenderCountry||b.defender?.countryId;
    const atkCode = (S.lookups.countriesById.get(atkId)?.code||"").toLowerCase();
    const defCode = (S.lookups.countriesById.get(defId)?.code||"").toLowerCase();
    const atkFlag = atkCode ? `<img src="https://media.warera.io/images/flags/${atkCode.toLowerCase()}.svg" alt="" style="width:38px;display:block">` : "";
    const defFlag = defCode ? `<img src="https://media.warera.io/images/flags/${defCode.toLowerCase()}.svg" alt="" style="width:38px;display:block">` : "";
    atkAvatar = isCivilWar && atkFlag
      ? `<span style="position:relative;display:inline-block;line-height:0">${atkFlag}<iconify-icon icon="mingcute:angry-fill" class="lu" style="position:absolute;top:-7px;right:-7px;color:var(--red);font-size:17px;background:#fff;border-radius:50%;padding:1px;box-shadow:0 1px 3px rgba(0,0,0,.5)"></iconify-icon></span>`
      : atkFlag;
    defAvatar = defFlag;
  }
  const { atkColor, defColor, atkText, defText, atkBarText, defBarText } = battleSideColors(b);
  const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region);
  const isLive = !b.endedAt || b.isActive===true || b.active===true;
  const started = b.createdAt||b.startedAt||"";
  const ended = b.endedAt||"";
  const winner = isCivilWar
    ? (b.wonBy === "attacker" ? cwAtk
       : b.wonBy === "defender" ? cwDef
       : (b.winner && String(b.winner).toLowerCase() === String(atk || "").toLowerCase()) ? cwAtk
       : (b.winner && String(b.winner).toLowerCase() === String(def || "").toLowerCase()) ? cwDef
       : null)
    : (b.winner || (b.wonBy === "attacker" ? atk : b.wonBy === "defender" ? def : null));

  function sumDmg(d) {
    if (d == null) return 0;
    if (typeof d === "number") return d;
    if (typeof d === "object") return Object.values(d).reduce((s, v) => s + (Number(v) || 0), 0);
    return Number(d) || 0;
  }
  const liveTag = isLive ? ` <span style="color:var(--red);font-size:.68rem;animation:livePulse 1.5s infinite;display:inline-block">● LIVE</span>` : "";
  const battleKind = battleTypeKind(b.type);
  let battleTypeLabel;
  if (battleKind === "tournament") {
    const t = S.lookups.tournamentsById.get(b.tournament);
    battleTypeLabel = t?.type === "country" ? "Country Tournament" : t?.type === "mu" ? "MU Tournament" : (t?.name || "Tournament");
  } else {
    battleTypeLabel = battleKind === "resistance" ? "Resistance" : battleKind === "revolution" ? "Civil War" : "Battle";
  }
  const rounds = roundsData || [];
  const sortedRounds = [...rounds].sort((a,b) => {
    const ta = new Date(a.createdAt||a.startedAt||0).getTime();
    const tb = new Date(b.createdAt||b.startedAt||0).getTime();
    return ta - tb;
  });
  const currentLiveRound = isLive ? (roundsData.find(rd => rd._isCurrent) || [...sortedRounds].reverse().find(rd => rd._isCurrent || !rd.endedAt) || null) : null;
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
      const rdWinner = rd.wonBy === "attacker" ? sideLabel("attacker", atk || "ATK") : rd.wonBy === "defender" ? sideLabel("defender", def || "DEF") : null;
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
    const rdWinner = rd?.wonBy === "attacker" ? sideLabel("attacker", atk || "Attacker") : rd?.wonBy === "defender" ? sideLabel("defender", def || "Defender") : null;
    const rdStatus = rdWinner
      ? `<span style="color:var(--green);font-size:.72rem"><iconify-icon icon="mdi:trophy" class="lu"></iconify-icon> Won by ${rdWinner}</span>`
      : (rd?.isActive === true || rd?._isCurrent === true || !rd?.endedAt)
      ? `<span style="color:var(--red);font-size:.72rem">● Active</span>`
      : `<span style="color:var(--ink-dim);font-size:.72rem">Ended</span>`;

    const rdLive = rd?.live;
    const tickRemaining = rdLive?.nextTickAt ? Math.max(0, (new Date(rdLive.nextTickAt).getTime() - Date.now()) / 1000) : null;
    const atkEta = tickRemaining != null ? calculateRoundETA(atkPts, defPts, tickRemaining) : null;
    const defEta = tickRemaining != null ? calculateRoundETA(defPts, atkPts, tickRemaining) : null;
    const etaChip = (eta, side, color) => {
      if (eta != null) {
        return `<span style="display:inline-flex;align-items:center;gap:5px;color:${color};font-weight:800"><iconify-icon icon="eos-icons:hourglass" class="lu" style="font-size:14px"></iconify-icon> <span id="brEta${side === "attacker" ? "Atk" : "Def"}_${bid}_${roundIdx}">${formatRoundETA(eta)}</span></span>`;
      }
      const pts = side === "attacker" ? atkPts : defPts;
      return pts >= 300 ? `<span style="color:var(--green);font-size:.66rem;font-weight:800">Won</span>` : "";
    };
    const etaRow = (atkEta != null || defEta != null) ? `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:.7rem;margin-bottom:4px">
      <span>${etaChip(defEta, "defender", defText)}</span>
      <span style="font-size:.6rem;color:var(--ink-dim);text-transform:uppercase;letter-spacing:.06em">ETA to 300</span>
      <span>${etaChip(atkEta, "attacker", atkText)}</span>
    </div>` : "";

    return `<div class="br-section" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:.78rem;font-weight:800;color:var(--ink-dim);text-transform:uppercase;letter-spacing:.06em">Round ${roundIdx + 1} Ground Points</span>
      ${rdStatus}
    </div>
    ${etaRow}
    <div style="display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:5px">
      <span style="color:${defText};font-weight:800"><strong>${fmtNum(defPts)}</strong> pts ${sideLabel("defender", def || "Defender")}</span>
      <span style="color:var(--ink-dim);font-size:.68rem">First to 300 wins</span>
      <span style="color:${atkText};font-weight:800">${sideLabel("attacker", atk || "Attacker")} <strong>${fmtNum(atkPts)}</strong> pts</span>
    </div>
    <div style="position:relative;height:16px;background:var(--line);overflow:hidden;display:flex;align-items:center;">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${defBarPct}%;background:${defColor};transition:width .5s ease;"></div>
      <div style="position:absolute;right:0;top:0;bottom:0;width:${atkBarPct}%;background:${atkColor};transition:width .5s ease;"></div>
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
    const btn = `<button class="order-detail-btn" data-order-side="${side}" data-order-bid="${bid}" title="${count} ${side} order${count === 1 ? "" : "s"} issued" style="width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid ${color};color:${text};background:color-mix(in srgb, ${color} 16%, transparent);cursor:pointer;padding:0"><iconify-icon icon="boxicons:target" class="lu" style="font-size:15px"></iconify-icon></button>`;
    const cnt = `<span style="font-size:.74rem;font-weight:900;color:${text};min-width:1em;text-align:center;font-variant-numeric:tabular-nums" title="Orders issued">${count}</span>`;
    return `<span style="display:inline-flex;align-items:center;gap:5px">${side === "attacker" ? btn + cnt : cnt + btn}</span>`;
  };

  const allianceRowHtml = (groups, side) => {
    if (!groups.length) return "";
    const chips = groups.map(g => {
      const color = allianceColor(g.id) || "var(--ink-dim)";
      return `<span style="font-size:.64rem;font-weight:800;color:${color};text-align:center">${escapeHtml(allianceName(g.id))}</span>`;
    }).join("");
    return `<div data-alliance-row="${side}" style="display:flex;flex-direction:column;align-items:center;gap:2px">${chips}</div>`;
  };

  const atkAllianceHtml = allianceRowHtml(sideAllianceGroups(battleSideAllianceCountries(b, orders, "attacker")), "attacker");
  const defAllianceHtml = allianceRowHtml(sideAllianceGroups(battleSideAllianceCountries(b, orders, "defender")), "defender");
  const battleScoreHtml = `
  <div class="br-score-block" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;padding:12px;background:var(--surface-hi);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:10px;justify-self:start">${defAvatar}${isLive ? orderBtnHtml(defOrderCount, "defender") : ""}${defAllianceHtml}</div>
    <div style="display:flex;justify-content:center;align-items:center;gap:16px">
      <div style="text-align:center">
        <div style="font-size:2rem;font-weight:900;color:${defText};line-height:1">${defRoundsWon}</div>
        <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;color:var(--ink-dim);margin-top:2px">${sideLabel("defender", def||"Defender")}</div>
      </div>
      <div style="text-align:center;color:var(--ink-dim)">
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Battle Score</div>
        <div style="font-size:.66rem;margin-top:2px">First to ${roundsToWin} rounds wins</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:2rem;font-weight:900;color:${atkText};line-height:1">${atkRoundsWon}</div>
        <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;color:var(--ink-dim);margin-top:2px">${sideLabel("attacker", atk||"Attacker")}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;justify-self:end">${atkAllianceHtml}${isLive ? orderBtnHtml(atkOrderCount, "attacker") : ""}${atkAvatar}</div>
  </div>`;

  const TICK_BRACKETS = [[1,1],[100,2],[200,3],[300,4],[400,5],[500,6]];
  const curRoundPts = (currentLiveRound
    ? Number(currentLiveRound.attacker?.points ?? 0) + Number(currentLiveRound.defender?.points ?? 0)
    : Number(b.attacker?.points ?? 0) + Number(b.defender?.points ?? 0));
  const tickVal = Number(tickInfo?.actualTickPoints) || 1;
  const curBracketVal = [...TICK_BRACKETS].reverse().find(([t]) => curRoundPts >= t)?.[1] || 1;
  const nextBracket = TICK_BRACKETS.find(([t]) => curRoundPts < t);
  const atkDmgNow = sumDmg(currentLiveRound?.attacker?.damages ?? b.attacker?.damages ?? 0);
  const defDmgNow = sumDmg(currentLiveRound?.defender?.damages ?? b.defender?.damages ?? 0);
  const dmgLeaderAtk = atkDmgNow > defDmgNow;
  const dmgLeaderName = dmgLeaderAtk ? sideLabel("attacker", atk || "Attacker") : sideLabel("defender", def || "Defender");
  const bracketBar = TICK_BRACKETS.map(([t, v]) =>
    `<span title="${v} pt${v === 1 ? "" : "s"}/tick at ${t}+ total" style="flex:1;text-align:center;font-size:.62rem;font-weight:800;padding:2px 0;border-radius:3px;${v === curBracketVal ? `background:${dmgLeaderAtk ? atkColor : defColor};color:#fff` : "background:var(--surface-hi);color:var(--ink-dim);border:1px solid var(--line)"}">${v}</span>`
  ).join("");
  const liveTickHtml = isLive && tickInfo ? `
  <div class="br-section" style="margin-bottom:12px;padding:10px 12px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <iconify-icon icon="mdi:timer-sand" class="lu" style="font-size:16px"></iconify-icon>
      <span style="font-size:.78rem;font-weight:800">Tick cycle <span id="brTickNo_${bid}">${Number(tickInfo.ticksCount) || 0}</span></span>
      <span style="font-size:.72rem;color:var(--ink-dim)">Total <strong>${curRoundPts}</strong> · <strong>${tickVal} pt${tickVal === 1 ? "" : "s"}</strong> per tick to damage leader${nextBracket ? ` · next <strong>${nextBracket[1]} pts</strong> at ${nextBracket[0]} total (+${nextBracket[0] - curRoundPts})` : ""}</span>
      <span style="font-size:.72rem;font-weight:700;color:${dmgLeaderAtk ? atkText : defText}">${dmgLeaderName} leads damage</span>
      <span style="margin-left:auto;font-size:.72rem;color:var(--ink-dim)">next tick in <strong id="brTickCount_${bid}" style="font-variant-numeric:tabular-nums">--:--</strong></span>
    </div>
    <div style="display:flex;gap:3px;margin-top:8px">${bracketBar}</div>
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
      narrative = isCivilWar
        ? `${battleTypeLabel} ongoing${reg ? " in " + reg : ""}. Damage split: ${defPct}% vs ${atkPct}%.`
        : `${battleTypeLabel} ongoing: <strong>${def||"Defender"}</strong> vs <strong>${atk||"Attacker"}</strong>${reg?" in "+reg:""}. Damage split: ${defPct}% vs ${atkPct}%.`;
    } else {
      narrative = winner
        ? (isCivilWar
          ? (winner === cwAtk
            ? `Rebel forces successfully overthrew the government. Total damage: ${fmtNum(totalDmg)}. ${participantsA + participantsD} fighters participated.`
            : `Government forces successfully suppressed the rebellion. Total damage: ${fmtNum(totalDmg)}. ${participantsA + participantsD} fighters participated.`)
          : `<strong>${winner}</strong> secured victory${reg?" at "+reg:""}. Total damage: ${fmtNum(totalDmg)}. ${participantsA + participantsD} fighters participated.`)
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
    const rWinner = rd.wonBy === "attacker" ? sideLabel("attacker", atk) : rd.wonBy === "defender" ? sideLabel("defender", def) : null;
    const rActive = (rd.isActive === true || rd._isCurrent === true || !rd.endedAt) && !rWinner;
    const statusLabel = rWinner ? "WON" : rActive ? "ACTIVE" : "ENDED";
    const narrative = `Round ${idx + 1} ${rWinner ? `won by <strong>${rWinner}</strong>` : rActive ? "ongoing" : "concluded"}${totalDmg ? `: ${fmtNum(totalDmg)} total damage, ${defPct}% vs ${atkPct}% split` : ""}.`;
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
        <span style="color:${defText};font-weight:800">${def||"Defender"} ${sc.defPct}%</span>
        <span style="color:var(--ink-dim);font-size:.72rem">DAMAGE SHARE</span>
        <span style="color:${atkText};font-weight:800">${sc.atkPct}% ${atk||"Attacker"}</span>
      </div>
      <div class="score-bar">
  <div style="flex:${sc.defPct} 0 0; background:${defColor}; border-right:2px solid rgba(255,255,255,0.65); display:flex; align-items:center; justify-content:flex-end; padding-right:8px;">
    <span style="font-size:26px;line-height:1;font-family:var(--font-ui);font-weight:900;color:${defBarText}">${fmtNum(sc.defDmg)}</span>
  </div>
  <div style="flex:${sc.atkPct} 0 0; background:${atkColor}; display:flex; align-items:center; justify-content:flex-start; padding-left:8px;">
    <span style="font-size:26px;line-height:1;font-family:var(--font-ui);font-weight:900;color:${atkBarText}">${fmtNum(sc.atkDmg)}</span>
  </div>
</div>
    </div>`;
  }

  function statsGridHtml(sc) {
    const scStart = sc.started ? new Date(sc.started).getTime() : 0;
    const scEnd = sc.ended ? new Date(sc.ended).getTime() : 0;
    const durationMs = (scStart && scEnd && scEnd > scStart) ? (scEnd - scStart) : 0;
    const endedVal = sc.ended ? fmtDate(sc.ended) : (isLive ? "On going" : "—");
    const durationVal = durationMs > 0 ? formatDuration(durationMs) : (isLive ? "On going" : "—");
    const winnerVal = sc.winner ? sc.winner : "—";
    const defVal = sideLabel("defender", def || "Defender");
    const atkVal = sideLabel("attacker", atk || "Attacker");
    return `<div class="br-stats-grid">
      <div class="br-stat-box"><span class="br-stat-val" style="font-size:.85rem">${defVal}</span><span class="br-stat-lbl">Defender</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${sc.participantsD || "—"}</span><span class="br-stat-lbl">Defender Participants</span></div>
      <div class="br-stat-box"><span class="br-stat-val" style="color:${defText}">${sc.defDmg ? fmtNum(sc.defDmg) : "—"}</span><span class="br-stat-lbl">Defender Damage</span></div>
      <div class="br-stat-box br-stat-box--total"><span class="br-stat-val">${sc.totalDmg ? fmtNum(sc.totalDmg) : "—"}</span><span class="br-stat-lbl">Total Damage</span></div>
      <div class="br-stat-box"><span class="br-stat-val" style="color:${atkText}">${sc.atkDmg ? fmtNum(sc.atkDmg) : "—"}</span><span class="br-stat-lbl">Attacker Damage</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${sc.participantsA || "—"}</span><span class="br-stat-lbl">Attacker Participants</span></div>
      <div class="br-stat-box"><span class="br-stat-val" style="font-size:.85rem">${atkVal}</span><span class="br-stat-lbl">Attacker</span></div>
      <div class="br-stat-box"><span class="br-stat-val" style="font-size:.82rem">${reg || "—"}</span><span class="br-stat-lbl">Region</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${sc.hitCount ? fmtNum(sc.hitCount) : "—"}</span><span class="br-stat-lbl">Total Hits</span></div>
      <div class="br-stat-box"><span class="br-stat-val" style="font-size:.72rem">${sc.started ? fmtDate(sc.started) : "—"}</span><span class="br-stat-lbl">Started</span></div>
      <div class="br-stat-box"><span class="br-stat-val" style="font-size:.72rem">${durationVal}</span><span class="br-stat-lbl">Duration</span></div>
      <div class="br-stat-box"><span class="br-stat-val" style="font-size:.72rem">${endedVal}</span><span class="br-stat-lbl">Ended</span></div>
      <div class="br-stat-box"><span class="br-stat-val">${sc.statusLabel}</span><span class="br-stat-lbl">Status</span></div>
      <div class="br-stat-box" ${sc.winner ? 'style="border-color:var(--green)"' : ""}><span class="br-stat-val">${sc.winner ? `<iconify-icon icon="mdi:trophy" class="lu"></iconify-icon> ` : ""}${winnerVal}</span><span class="br-stat-lbl">Winner</span></div>
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
      return `<tr>${defHtml}${atkHtml}</tr>`;
    }).join("");
    return `<table class="rank-table"><thead>
    <tr><th colspan="3" style="color:${defText}">DEFENDER</th><th colspan="3" style="color:${atkText}">ATTACKER</th></tr>
    <tr><th>#</th><th>${ent.label}</th><th>${cfg.label}</th><th>#</th><th>${ent.label}</th><th>${cfg.label}</th></tr>
    </thead><tbody>${rows}</tbody></table>`;
  }

  function rankingsHtml(sc, cat, type) {
    const rankCatPills = [
      ["damage", "mdi:sword-cross", "Damage"],
      ["points", "mdi:flag", "Ground Points"],
    ];
    const rankTypePills = [
      ["users", "mdi:account-group", "Users"],
      ["mus", "mdi:shield-account-outline", "MUs"],
      ["countries", "mdi:flag", "Countries"],
    ];
    const rankPillHtml = (list, group, defaultVal) => list.map(([val, icon, label]) =>
      `<button class="pill-btn br-rank-pill${val === defaultVal ? " active" : ""}" data-rank-${group}="${val}" style="font-size:.72rem"><iconify-icon icon="${icon}" class="lu"></iconify-icon><span class="pill-label">${label}</span></button>`
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

  function buildScopeHtml(sc) {
    let h = `<div class="br-narrative">${sc.narrative}</div>`;
    if (sc.round) h += buildRoundGpBar(sc.round, sc.roundIdx);
    h += scoreBarHtml(sc);
    h += statsGridHtml(sc);
    const anyRank = [sc.damageUsers, sc.gpUsers, sc.damageMu, sc.gpMu, sc.damageCountry, sc.gpCountry].some(l => l && l.length);
    if (anyRank) h += rankingsHtml(sc, view.cat, view.type);
    return h;
  }

  const staticTop = `<div class="br-section">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
    <h3 class="br-section-title" style="margin:0">Battle Overview${liveTag}</h3>
  </div>
  ${roundTabsHtml}
  ` + battleScoreHtml + liveTickHtml + bountySummaryHtml(b, contracts, money);

  const scopeBodyId = `brScopeBody_${bid}`;

  const staticBottom = (isLive ? `<p style="text-align:center;color:var(--ink-dim);font-size:.76rem;padding:6px 0"><iconify-icon icon="mdi:sync" class="lu nd-spin"></iconify-icon> Auto-refreshing on tick</p>` : "") + `<div style="padding:8px 0;display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn-primary" id="exportBattleXlsBtn" style="flex:1"><iconify-icon icon="mdi:file-excel-outline" class="lu"></iconify-icon> Export XLS</button>
    <button class="btn-secondary" id="captureBattlePaneBtn" style="flex:1"><iconify-icon icon="mdi:camera" class="lu"></iconify-icon> Capture Report</button>
  </div>`;

  const detailHtml = staticTop + `<div id="${scopeBodyId}"></div>` + staticBottom;
  if (E.battleReportTitle) E.battleReportTitle.textContent = isCivilWar
    ? `${battleTypeLabel}: ${cwDef} vs ${cwAtk}${reg ? " — "+reg : ""}`
    : `${battleTypeLabel}: ${def||"?"} vs ${atk||"?"}${reg ? " — "+reg : ""}`;
  if (E.battleReportMeta) E.battleReportMeta.textContent = `${isLive ? "Live" : "Ended"}${started ? " · "+fmtDate(started) : ""}${ended ? " → "+fmtDate(ended) : ""}`;
  if (E.refreshBattleReportBtn) E.refreshBattleReportBtn.style.display = isLive ? "" : "none";
  const prevScroll = E.battleReportContent.scrollTop;
  E.battleReportContent.innerHTML = detailHtml;
  E.battleReportContent.scrollTop = prevScroll;
  if (E.openBattlePageBtn) E.openBattlePageBtn.dataset.battleId = bid;
  if (E.battleReportModal) E.battleReportModal.classList.remove("hidden");

  if (isLive && tickInfo?.nextTickAt) {
    const countEl = document.getElementById(`brTickCount_${bid}`);
    const noEl = document.getElementById(`brTickNo_${bid}`);
    const liveRoundIdx = currentLiveRound ? sortedRounds.indexOf(currentLiveRound) : -1;
    const updateEta = (diff) => {
      const etaAtkEl = liveRoundIdx >= 0 ? document.getElementById(`brEtaAtk_${bid}_${liveRoundIdx}`) : null;
      const etaDefEl = liveRoundIdx >= 0 ? document.getElementById(`brEtaDef_${bid}_${liveRoundIdx}`) : null;
      if (etaAtkEl || etaDefEl) {
        const rem = Math.max(0, diff / 1000);
        const atkP = Number(currentLiveRound?.attacker?.points ?? currentLiveRound?.pointsAttacker ?? 0);
        const defP = Number(currentLiveRound?.defender?.points ?? currentLiveRound?.pointsDefender ?? 0);
        const aEta = calculateRoundETA(atkP, defP, rem);
        const dEta = calculateRoundETA(defP, atkP, rem);
        if (etaAtkEl) etaAtkEl.textContent = aEta != null ? formatRoundETA(aEta) : (atkP >= 300 ? "Won" : "");
        if (etaDefEl) etaDefEl.textContent = dEta != null ? formatRoundETA(dEta) : (defP >= 300 ? "Won" : "");
      }
    };
    const updateTick = () => {
      const diff = new Date(tickInfo.nextTickAt).getTime() - Date.now();
      if (countEl) {
        if (diff <= 0) { countEl.textContent = "due…"; if (noEl) noEl.textContent = String((Number(tickInfo.ticksCount) || 0) + 1); }
        else {
          const s = Math.floor(diff / 1000);
          countEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
        }
      }
      updateEta(diff);
    };
    updateTick();
    S.battleTickTimer = setInterval(updateTick, 1000);
  }

  bindBountySummaryButtons(E.battleReportContent, b, bid, contracts);
  E.battleReportContent.querySelectorAll(".order-detail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const side = btn.dataset.orderSide;
      const color = side === "attacker" ? atkColor : defColor;
      const sideName = side === "attacker" ? sideLabel("attacker", atk || "Attacker") : sideLabel("defender", def || "Defender");
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

  _battleReportCtx = {
    b, bid,
    defLabel: sideLabel("defender", def || "Defender"),
    atkLabel: sideLabel("attacker", atk || "Attacker"),
    reg, battleTypeLabel, isLive, winner,
    defRoundsWon, atkRoundsWon, roundsToWin,
    sortedRounds, started, ended, durationStr,
    contracts,
    overallScope, roundScope, rankConfigFor, rankEntity,
    getScope: () => currentScopeData,
  };

  // Live battles default to the active round so you land on the round that is
  // currently playing; ended battles default to Overall. A saved view for this
  // battle (chosen via the round tabs) still wins over the default.
  const defaultRoundIdx = () => {
    if (isLive && currentLiveRound) {
      const idx = sortedRounds.indexOf(currentLiveRound);
      if (idx >= 0) return String(idx);
    }
    return "overall";
  };
  let view = (S.battleView && S.battleView.bid === bid) ? { roundIdx: S.battleView.roundIdx || "overall", cat: S.battleView.cat || "damage", type: S.battleView.type || "users" } : { roundIdx: defaultRoundIdx(), cat: "damage", type: "users" };
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

  document.getElementById("exportBattleXlsBtn")?.addEventListener("click", () => {
    if (!currentScopeData) return;
    exportBattleXLS(b, bid, currentScopeData.damageUsers, currentScopeData.gpUsers, currentScopeData.damageMu, currentScopeData.gpMu, currentScopeData.damageCountry, currentScopeData.gpCountry);
  });

  document.getElementById("captureBattlePaneBtn")?.addEventListener("click", async () => {
    const ch = await import("../core/captureReport.js");
    const sc = currentScopeData || overallScope();
    const title2 = `${battleTypeLabel}: ${sideLabel("defender", def||"Defender")} vs ${sideLabel("attacker", atk||"Attacker")}${reg?" — "+reg:""}${sc.scopeKey === "overall" ? "" : " · "+sc.label}`;
    const slug = (sideLabel("defender", def||"Defender"))+"_vs_"+(sideLabel("attacker", atk||"Attacker"))+(reg?"_"+reg.replace(/[\s-]+/g,"_"):"")+(sc.scopeKey === "overall" ? "" : "_round_"+(sc.roundIdx+1));
    const ptotalDmg = sc.totalDmg || sc.damageUsers.reduce((s, r) => s + getValue(r), 0);
    const ptotalGp = (sc.atkGp + sc.defGp) || sc.gpUsers.reduce((s, r) => s + getPoints(r), 0);
    const parts = (sc.participantsA||0)+(sc.participantsD||0);
    const score = `${defRoundsWon}—${atkRoundsWon}`;
    const meta = [
      `Defender: ${sideLabel("defender", def||"—")} | Attacker: ${sideLabel("attacker", atk||"—")}${reg?" · Region: "+reg:""} | Winner: ${sc.winner||winner||"—"} | Score: ${score}`,
      `Damage: ${fmtNum(ptotalDmg)} | Total Hits: ${sc.hitCount} | Participants: ${fmtNum(parts)}`,
      `${sc.started ? "Started: "+fmtDate(sc.started) : ""}${sc.ended ? "  ·  Ended: "+fmtDate(sc.ended) : ""}${durationStr ? "  ·  "+durationStr : ""}`,
      `Generated: ${new Date().toUTCString()}`,
    ];
    if (sc.damageUsers.length) {
      const atkD = sc.damageUsers.filter(r => r._side === "attacker").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const defD = sc.damageUsers.filter(r => r._side === "defender").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const atkG = sc.gpUsers.filter(r => r._side === "attacker").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const defG = sc.gpUsers.filter(r => r._side === "defender").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const dm = rowsSideBySide(defD, atkD, r => nameUser(r.userId||r.user)||r.username||"Unknown", getValue);
      const gp = rowsSideBySide(defG, atkG, r => nameUser(r.userId||r.user)||r.username||"Unknown", getPoints);
      const subH = `<th colspan="3" style="${ch.STYLE.th};text-align:center">DEFENDER</th><th colspan="3" style="${ch.STYLE.th};text-align:center">ATTACKER</th>`;
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
      const dm = rowsSideBySide(defD, atkD, r => nameMu(r.muId||r.mu)||`MU ${String(r.muId||r.mu).slice(-6)}`, getValue);
      const gp = rowsSideBySide(defG, atkG, r => nameMu(r.muId||r.mu)||`MU ${String(r.muId||r.mu).slice(-6)}`, getPoints);
      const subH = `<th colspan="3" style="${ch.STYLE.th};text-align:center">DEFENDER</th><th colspan="3" style="${ch.STYLE.th};text-align:center">ATTACKER</th>`;
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
      const dm = rowsSideBySide(defD, atkD, r => nameCountry(r.countryId||r.country)||r.countryName||r.name||"Unknown", getValue);
      const gp = rowsSideBySide(defG, atkG, r => nameCountry(r.countryId||r.country)||r.countryName||r.name||"Unknown", getPoints);
      const subH = `<th colspan="3" style="${ch.STYLE.th};text-align:center">DEFENDER</th><th colspan="3" style="${ch.STYLE.th};text-align:center">ATTACKER</th>`;
      const html = ch.pageOpen("War Era Battle Report", title2, meta) +
        ch.section("Top Countries by Damage", ch.tableBlock("", ["#","Country","Damage","#","Country","Damage"], dm, 10, subH)) +
        ch.section("Top Countries by Total Hits", ch.tableBlock("", ["#","Country","Ground Pts","#","Country","Ground Pts"], gp, 10, subH)) +
        ch.pageClose();
      await ch.captureHTML(html, `battle_${slug}_countries_${ch.ts()}.png`);
    }
  });

  scheduleLiveRefresh(bid, isLive, tickInfo);
}

// Schedule the next data refresh from the live tick timer instead of a fixed poll:
// refresh once after the next tick processes (~7s after nextTickAt), re-check every
// 4s while the tick is "due" (processing), and back off to 15s when the tick info is
// stale or missing.
// A watchdog re-arms the loop even if a reload stalls, so the tick refresh can never
// silently die and leave the countdown frozen on "due…" forever.
let _battleReloadWatchdog = null;

function scheduleLiveRefresh(bid, isLive, tickInfo) {
  clearTimeout(S.liveBattleTimer); S.liveBattleTimer = null;
  clearTimeout(_battleReloadWatchdog); _battleReloadWatchdog = null;
  if (!isLive) return;
  const next = tickInfo?.nextTickAt ? new Date(tickInfo.nextTickAt).getTime() : 0;
  let delay = 15000;
  if (next > 0) {
    const diff = next - Date.now();
    if (diff > 0) delay = Math.min(diff + 7000, 120000);
    else if (diff > -15000) delay = 4000;
  }
  S.liveBattleTimer = setTimeout(() => {
    if (S.selectedBattleId !== bid) return;
    // Watchdog: if this reload ever stalls without re-arming the loop (the next
    // timer is normally set inside loadBattleDetail → renderBattleDetail), force
    // a fresh schedule so the live tick refresh keeps running.
    clearTimeout(_battleReloadWatchdog);
    _battleReloadWatchdog = setTimeout(() => {
      if (S.selectedBattleId === bid && !S.liveBattleTimer) {
        scheduleLiveRefresh(bid, true, null);
      }
    }, Math.max(delay + 20000, 45000));
    loadBattleDetail({ _id: bid }, bid, true).catch(() => {});
  }, delay);
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

// Adaptive round ETA: the tick reward tier is based on combined round points
// (min(6, floor((atkPts+defPts)/100)+1)), so as the winning side accumulates
// points the combined total crosses 200/300/400/500 and the per-tick reward
// grows. Simulate that progression instead of freezing the current reward,
// which would overestimate the ETA by nearly 2x on low-points rounds.
function calculateRoundETA(roundPoints, otherRoundPoints, tickRemaining) {
  const TARGET_POINTS = 300;
  const TICK_DURATION = 120;

  if (roundPoints >= TARGET_POINTS) {
    return null;
  }

  let p = roundPoints;
  let ticks = 0;
  while (p < TARGET_POINTS && ticks < 1000) {
    const reward = Math.min(6, Math.floor((p + otherRoundPoints) / 100) + 1);
    if (reward <= 0) return null;
    p += reward;
    ticks++;
  }

  return tickRemaining + (ticks - 1) * TICK_DURATION;
}

function formatRoundETA(seconds) {
  if (seconds == null) {
    return "—";
  }

  if (seconds < 60) {
    return `~${Math.ceil(seconds)}s`;
  }

  const minutes = Math.ceil(seconds / 60);

  if (minutes < 60) {
    return `~${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `~${hours}h`;
  }

  return `~${hours}h ${remainingMinutes}m`;
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



function brRankSection(list, valFn, atkLabel, defLabel, nameFn) {
  const atk = (list || []).filter(r => r._side === "attacker").sort((a, b) => valFn(b) - valFn(a)).slice(0, 10);
  const def = (list || []).filter(r => r._side === "defender").sort((a, b) => valFn(b) - valFn(a)).slice(0, 10);
  if (!atk.length && !def.length) return "";
  const L = [];
  if (atk.length) {
    L.push(`${atkLabel} top 10:`);
    atk.forEach((r, i) => L.push(`- ${i + 1}. ${nameFn(r) || "Unknown"}: ${fmtNum(valFn(r))}`));
  }
  if (def.length) {
    L.push(`${defLabel} top 10:`);
    def.forEach((r, i) => L.push(`- ${i + 1}. ${nameFn(r) || "Unknown"}: ${fmtNum(valFn(r))}`));
  }
  return L.join("\n");
}

function brBountyLine(ctx) {
  const b = ctx.b;
  const atkPerK = b.attacker?.moneyPer1kDamages ?? b.attackerMoneyPer1kDamages;
  const defPerK = b.defender?.moneyPer1kDamages ?? b.defenderMoneyPer1kDamages;
  const pool = (Number(b.attacker?.moneyPool ?? b.attackerMoneyPool) || 0) + (Number(b.defender?.moneyPool ?? b.defenderMoneyPool) || 0);
  const cAtk = ctx.contracts?.side?.attacker?.count ?? ctx.contracts?.attacker?.count;
  const cDef = ctx.contracts?.side?.defender?.count ?? ctx.contracts?.defender?.count;
  const parts = [];
  if (atkPerK != null || defPerK != null) parts.push(`${fmtMoney(atkPerK ?? defPerK)} BTC/1k damage`);
  if (pool > 0) parts.push(`${fmtMoney(pool)} BTC total pool`);
  if (cAtk != null || cDef != null) parts.push(`${(cAtk || 0) + (cDef || 0)} contracts`);
  if (!parts.length) return "";
  return `- Bounty: ${parts.join(" · ")}`;
}

function buildBattleReportMarkdown() {
  const ctx = _battleReportCtx;
  if (!ctx) return "";
  const sc = ctx.getScope() || ctx.overallScope();
  const { atkLabel, defLabel, reg, battleTypeLabel, isLive, winner } = ctx;
  const L = [];

  L.push("# War Era Battle Report");
  L.push(`Generated: ${new Date().toUTCString()}`);
  L.push("");
  L.push("## Battle Overview");
  L.push(`- Battle: ${battleTypeLabel} — ${defLabel} vs ${atkLabel}${reg ? " in " + reg : ""}`);
  L.push(`- Status: ${isLive ? "LIVE" : "Ended"}`);
  L.push(`- Score: ${defLabel} ${ctx.defRoundsWon}–${ctx.atkRoundsWon} ${atkLabel}`);
  L.push(`- First to: ${ctx.roundsToWin} round(s)`);
  if (ctx.started) L.push(`- Started: ${fmtDate(ctx.started)}`);
  if (ctx.ended) L.push(`- Ended: ${fmtDate(ctx.ended)}`);
  if (ctx.durationStr) L.push(`- Duration: ${ctx.durationStr}`);
  L.push(`- Winner: ${winner || "—"}`);
  L.push(`- Total Damage: ${fmtNum(sc.totalDmg)}`);
  L.push(`- Fighters: ${fmtNum(sc.participantsT)}`);
  L.push(`- Hits: ${fmtNum(sc.hitCount || 0)}`);
  L.push(`- Damage Share: ${defLabel} ${sc.defPct}% vs ${sc.atkPct}% ${atkLabel}`);
  const bounty = brBountyLine(ctx);
  if (bounty) L.push(bounty);
  L.push("");

  if (ctx.sortedRounds.length) {
    L.push("## Rounds");
    L.push("");
    ctx.sortedRounds.forEach((rd, idx) => {
      let r = null;
      try { r = ctx.roundScope(rd, idx); } catch {}
      const w = r?.winner || "—";
      const dmg = r?.totalDmg ? fmtNum(r.totalDmg) : "—";
      const split = r ? `${r.defPct}% vs ${r.atkPct}%` : "—";
      L.push(`- Round ${idx + 1}: winner ${w} — ${dmg} total damage — ${split} split`);
    });
    L.push("");
  }

  if (sc.narrative) {
    L.push(`## ${sc.scopeKey === "overall" ? "Overall" : sc.label}`);
    L.push("");
    L.push(sc.narrative.replace(/<[^>]*>/g, "").trim());
    L.push("");
  }

  const cats = [["damage", "Damage", getValue], ["points", "Ground Points", getPoints]];
  const types = [
    ["users", "Fighters", r => nameUser(r.userId || r.user) || r.username || "Unknown"],
    ["mus", "Military Units", r => nameMu(r.muId || r.mu) || `MU ${String(r.muId || r.mu).slice(-6)}`],
    ["countries", "Countries", r => nameCountry(r.countryId || r.country) || r.countryName || r.name || "Unknown"],
  ];
  const rankBlocks = [];
  for (const [catKey, catLabel, valFn] of cats) {
    const cfg = ctx.rankConfigFor(sc)[catKey];
    for (const [typeKey, typeLabel, nameFn] of types) {
      const src = cfg.sources[typeKey] || [];
      const block = brRankSection(src, valFn, atkLabel, defLabel, nameFn);
      if (block) rankBlocks.push(`### ${catLabel} — ${typeLabel}`, "", block, "");
    }
  }
  if (rankBlocks.length) {
    L.push("## Rankings");
    L.push("");
    L.push(...rankBlocks);
  }
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function copyBattleReport() {
  const txt = buildBattleReportMarkdown();
  if (!txt) return;
  navigator.clipboard?.writeText(txt).then(() => toast("Battle report copied.")).catch(() => {});
}

document.addEventListener("click", e => {
  if (e.target.closest("#copyBattleReportBtn")) copyBattleReport();
  if (e.target.closest("#refreshBattleReportBtn")) {
    const bid = E.openBattlePageBtn?.dataset.battleId;
    if (bid) {
      const btn = e.target.closest("#refreshBattleReportBtn");
      btn.disabled = true;
      loadBattleDetail({ _id: bid }, bid, true)
        .catch(() => {})
        .finally(() => { btn.disabled = false; });
    }
  }
});

function exportBattleXLS(b, bid, rankUsers, gpUsers, rankMu, gpMu, rankCountry, gpCountry) {
  const isCivilWar = battleTypeKind(b.type) === "revolution" && b.type !== "tournament";
  let atk, def;
  if (b.type === "tournament") {
    const atkTeam = S.lookups.tournamentTeamsById.get(b.attacker?.tournamentTeam);
    const defTeam = S.lookups.tournamentTeamsById.get(b.defender?.tournamentTeam);
    atk = atkTeam ? `Team ${atkTeam.number}` : (nameMu(b.attacker?.tournamentTeam) || "Attacker");
    def = defTeam ? `Team ${defTeam.number}` : (nameMu(b.defender?.tournamentTeam) || "Defender");
  } else if (isCivilWar) {
    atk = "Rebels";
    def = "Government";
  } else {
    atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId) || "Attacker";
    def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId) || "Defender";
  }
  const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region)||"";
  const title = `${def} vs ${atk}${reg ? " - " + reg : ""}`;

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
