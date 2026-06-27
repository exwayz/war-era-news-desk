import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtDate, fmtNum, getValue, getPoints, normalizeRankRow } from "../core/utils.js";
import { nameCountry, nameRegion, nameUser } from "./companies.js";
import { clearBattleDetail, buildAndDownloadXLS, battleId } from "./battles.js";

function nameMu(id) {
  if (!id) return "";
  const mu = S.lookups.muById.get(id);
  if (!mu) return "";
  return mu.name ?? mu.muName ?? mu.displayName ?? mu.fullName ?? "";
}

function orderIssuer(o) {
  if (o.mu) return nameMu(o.mu) || `MU ${String(o.mu).slice(-6)}`;
  if (o.country) return nameCountry(o.country) || "Unknown Country";
  if (o.user) return nameUser(o.user) || "Unknown User";
  return "Unknown";
}

function makeEntityLink(name, url) {
  if (!url) return name || "Unknown";
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="entity-link">${name}</a>`;
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

export async function loadBattleDetail(battle, bid, silent=false) {
  const k = apiKey(); if(!k) return;
  if (!silent) E.battleDetailPane.innerHTML = `<div style="padding:24px;color:var(--ink-dim)">Loading intelligence report…</div>`;
  try {
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

    renderBattleDetail(bdDetail, bid, allUsers, allMu, allCountry, gpUsers, gpMu, gpCountry, allOrders, atkParticipantCount, defParticipantCount, roundsData, roundGpData);
  } catch (err) {
    if (!silent) E.battleDetailPane.innerHTML = `<div class="status-msg error">${err.message||"Failed to load battle detail"}</div>`;
  }
}

function renderBattleDetail(b, bid, rankUsers, rankMu, rankCountry, gpUsers, gpMu, gpCountry, orders, atkPar, defPar, roundsData, roundGpData) {
  const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId);
  const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId);
  const atkId = b.attacker?.country||b.attackerCountry||b.attacker?.countryId;
  const defId = b.defender?.country||b.defenderCountry||b.defender?.countryId;
  const atkCode = (S.lookups.countriesById.get(atkId)?.code||"").toLowerCase();
  const defCode = (S.lookups.countriesById.get(defId)?.code||"").toLowerCase();
  const atkFlag = atkCode ? `<img src="https://flagcdn.com/${atkCode}.svg" alt="" style="width:28px;height:28px;object-fit:cover;display:block">` : "";
  const defFlag = defCode ? `<img src="https://flagcdn.com/${defCode}.svg" alt="" style="width:28px;height:28px;object-fit:cover;display:block">` : "";
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
  let rawAtkDmg = b.attacker?.damages, rawDefDmg = b.defender?.damages;
  let atkDmg = rawAtkDmg != null ? sumDmg(rawAtkDmg) : rankUsers.filter(r => r._side === "attacker").reduce((s, r) => s + getValue(r), 0);
  let defDmg = rawDefDmg != null ? sumDmg(rawDefDmg) : rankUsers.filter(r => r._side === "defender").reduce((s, r) => s + getValue(r), 0);
  let totalDmg = atkDmg+defDmg||b.totalDamage||b.damage||0;
  let atkGp = gpUsers.filter(r => r._side === "attacker").reduce((s, r) => s + getPoints(r), 0);
  let defGp = gpUsers.filter(r => r._side === "defender").reduce((s, r) => s + getPoints(r), 0);
  let participantsA = atkPar || b.atkPar || 0;
  let participantsD = defPar || b.defPar || 0;
  let participantsT = participantsA+participantsD;

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

  const rounds = roundsData || [];
  const sortedRounds = [...rounds].sort((a,b) => {
    const ta = new Date(a.createdAt||a.startedAt||0).getTime();
    const tb = new Date(b.createdAt||b.startedAt||0).getTime();
    return ta - tb;
  });

  const roundTabsHtml = sortedRounds.length > 0 ? `
  <div class="br-round-tabs" id="brRoundTabs_${bid}" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px;">
    ${sortedRounds.map((rd,i)=>{
      const rdWinner = rd.wonBy === "attacker" ? (atk||"ATK") : rd.wonBy === "defender" ? (def||"DEF") : null;
      const isActive = (rd.isActive===true || rd._isCurrent===true || !rd.endedAt) && !rdWinner;
      const badge = rdWinner ? `<span style="font-size:.6rem;margin-left:3px">🏆</span>` : isActive ? `<span style="color:var(--red);font-size:.6rem;margin-left:3px">●</span>` : "";
      return `<button class="pill-btn${i===sortedRounds.length-1?" active":""}" data-round-idx="${i}" data-round-tab-bid="${bid}" style="font-size:.72rem">Round ${i+1}${badge}</button>`;
    }).join("")}
    <button class="pill-btn active" data-round-idx="overall" data-round-tab-bid="${bid}" style="font-size:.72rem">Overall</button>
  </div>` : "";

  const roundsByNumber = Object.fromEntries(roundsData.map(r => [Number(r.number), r]));
  const round1 = roundsByNumber?.[1];
  const round2 = roundsByNumber?.[2];

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
      ? `<span style="color:var(--green);font-size:.72rem">🏆 Won by ${rdWinner}</span>`
      : (rd?.isActive === true || rd?._isCurrent === true || !rd?.endedAt)
      ? `<span style="color:var(--red);font-size:.72rem">🔴 Active</span>`
      : `<span style="color:var(--ink-dim);font-size:.72rem">Ended</span>`;

    return `<div class="br-section" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:.78rem;font-weight:800;color:var(--ink-dim);text-transform:uppercase;letter-spacing:.06em">Round ${roundIdx + 1} Ground Points</span>
      ${rdStatus}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:5px">
      <span style="color:var(--blue);font-weight:800">${atk || "Attacker"} <strong>${fmtNum(atkPts)}</strong> pts</span>
      <span style="color:var(--ink-dim);font-size:.68rem">First to 300 wins</span>
      <span style="color:var(--red);font-weight:800"><strong>${fmtNum(defPts)}</strong> pts ${def || "Defender"}</span>
    </div>
    <div style="position:relative;height:16px;background:var(--line-solid);border-radius:8px;overflow:hidden;display:flex;align-items:center;">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${atkBarPct}%;background:var(--blue);border-radius:8px 0 0 8px;transition:width .5s ease;"></div>
      <div style="position:absolute;right:0;top:0;bottom:0;width:${defBarPct}%;background:var(--red);border-radius:0 8px 8px 0;transition:width .5s ease;"></div>
      <div style="position:absolute;left:50%;top:10%;bottom:10%;width:2px;background:var(--ink-dim);opacity:.4;transform:translateX(-50%);"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.64rem;color:var(--ink-dim);margin-top:3px">
      <span>0</span><span>150</span><span style="position:relative;left:-4px">300</span><span>150</span><span>0</span>
    </div>
  </div>`;
  }

  const battleScoreHtml = `
  <div style="display:grid;grid-template-columns:28px 1fr 28px;align-items:center;gap:12px;padding:12px;background:var(--surface-hi);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:12px">
    <div>${atkFlag}</div>
    <div style="display:flex;justify-content:center;align-items:center;gap:16px">
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
    </div>
    <div>${defFlag}</div>
  </div>`;

  let html = `<div class="br-section">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
    <h3 class="br-section-title" style="margin:0">Battle Overview${liveTag}</h3>
    <button id="clearBattleDetailBtn" class="btn-secondary" style="margin-left:auto;padding:4px 10px;min-width:auto;">⌫ Clear</button>
  </div>
  ${roundTabsHtml}
  <div class="br-narrative">${narrative}</div>`;

  html += battleScoreHtml;

  if (sortedRounds.length > 0) {
    html += `<div id="brRoundGpBars_${bid}">`;
    sortedRounds.forEach((rd, i) => {
      const defaultShow = i === sortedRounds.length - 1;
      html += `<div class="br-round-section" data-round-section="${i}" data-round-bid="${bid}" style="display:${defaultShow?"block":"none"}">${buildRoundGpBar(rd, i)}</div>`;
    });
    html += `<div class="br-round-section" data-round-section="overall" data-round-bid="${bid}" style="display:none"></div>`;
    html += `</div>`;
  }

  html += `<div class="score-bar-wrap" style="margin-top:8px">
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

  html+=`<div class="br-stats-grid">
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
    </div></div>`;

  const atkRank = rankUsers.filter(r => r._side === "attacker").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
  const defRank = rankUsers.filter(r => r._side === "defender").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
  const maxRows = Math.max(atkRank.length, defRank.length);

  if (rankUsers.length) {
    html+=`<div class="br-section"><h3 class="br-section-title">⚔ Top 10 Fighters by Damage</h3>
    <table class="rank-table"><thead>
<tr><th colspan="3" style="color:var(--blue)">ATTACKER</th><th colspan="3" style="color:var(--red)">DEFENDER</th></tr>
<tr><th>#</th><th>Fighter</th><th>Damage</th><th>#</th><th>Fighter</th><th>Damage</th></tr>
</thead><tbody>
${Array.from({length:maxRows},(_,i)=>{
  const a = atkRank[i]; const d = defRank[i];
  const atkHtml = a ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameUser(a.userId||a.user)||a.username||"Unknown",`https://app.warera.io/user/${a.userId||a.user}`)}</td><td>${fmtNum(getValue(a))}</td>` : `<td></td><td></td><td></td>`;
  const defHtml = d ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameUser(d.userId||d.user)||d.username||"Unknown",`https://app.warera.io/user/${d.userId||d.user}`)}</td><td>${fmtNum(getValue(d))}</td>` : `<td></td><td></td><td></td>`;
  return `<tr>${atkHtml}${defHtml}</tr>`;
}).join("")}
</tbody></table></div>`;
  }

  const atkRankGP = gpUsers.filter(r => r._side === "attacker").sort((a,b)=>getPoints(b)-getPoints(a)).slice(0,10);
  const defRankGP = gpUsers.filter(r => r._side === "defender").sort((a,b)=>getPoints(b)-getPoints(a)).slice(0,10);
  const maxRowsUGP = Math.max(atkRankGP.length, defRankGP.length);

  if (gpUsers.length) {
    html+=`<div class="br-section"><h3 class="br-section-title">🏴 Top 10 Fighters by Ground Points</h3>
    <table class="rank-table"><thead>
<tr><th colspan="3" style="color:var(--blue)">ATTACKER</th><th colspan="3" style="color:var(--red)">DEFENDER</th></tr>
<tr><th>#</th><th>Fighter</th><th>Ground Points</th><th>#</th><th>Fighter</th><th>Ground Points</th></tr>
</thead><tbody>
${Array.from({length:maxRowsUGP},(_,i)=>{
  const a = atkRankGP[i]; const d = defRankGP[i];
  const atkHtml = a ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameUser(a.userId||a.user)||a.username||"Unknown",`https://app.warera.io/user/${a.userId||a.user}`)}</td><td>${fmtNum(getPoints(a))}</td>` : `<td></td><td></td><td></td>`;
  const defHtml = d ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameUser(d.userId||d.user)||d.username||"Unknown",`https://app.warera.io/user/${d.userId||d.user}`)}</td><td>${fmtNum(getPoints(d))}</td>` : `<td></td><td></td><td></td>`;
  return `<tr>${atkHtml}${defHtml}</tr>`;
}).join("")}
</tbody></table></div>`;
  }

  if (rankMu.length) {
    const atkRankMu = rankMu.filter(r => r._side === "attacker").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
    const defRankMu = rankMu.filter(r => r._side === "defender").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
    const maxRowsMu = Math.max(atkRankMu.length, defRankMu.length);
    html += `<div class="br-section"><h3 class="br-section-title">🎖 Top 10 Military Units by Damage</h3>
    <table class="rank-table"><thead><tr><th colspan="3" style="color:var(--blue)">ATTACKER</th><th colspan="3" style="color:var(--red)">DEFENDER</th></tr>
    <tr><th>#</th><th>Military Unit</th><th>Damage</th><th>#</th><th>Military Unit</th><th>Damage</th></tr></thead><tbody>
${Array.from({length:maxRowsMu},(_,i)=>{
  const a = atkRankMu[i]; const d = defRankMu[i];
  const atkHtml = a ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameMu(a.muId||a.mu)||`MU ${String(a.muId||a.mu).slice(-6)}`,`https://app.warera.io/mu/${a.muId||a.mu}`)}</td><td>${fmtNum(getValue(a))}</td>` : `<td></td><td></td><td></td>`;
  const defHtml = d ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameMu(d.muId||d.mu)||`MU ${String(d.muId||d.mu).slice(-6)}`,`https://app.warera.io/mu/${d.muId||d.mu}`)}</td><td>${fmtNum(getValue(d))}</td>` : `<td></td><td></td><td></td>`;
  return `<tr>${atkHtml}${defHtml}</tr>`;
}).join("")}
</tbody></table></div>`;
  }

  if (gpMu.length) {
    const atkRankMuGP = gpMu.filter(r => r._side === "attacker").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
    const defRankMuGP = gpMu.filter(r => r._side === "defender").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
    const maxRowsMuGP = Math.max(atkRankMuGP.length, defRankMuGP.length);
    html += `<div class="br-section"><h3 class="br-section-title">🎖 Top 10 Military Units by Ground Points</h3>
    <table class="rank-table"><thead><tr><th colspan="3" style="color:var(--blue)">ATTACKER</th><th colspan="3" style="color:var(--red)">DEFENDER</th></tr>
    <tr><th>#</th><th>Military Unit</th><th>Ground Points</th><th>#</th><th>Military Unit</th><th>Ground Points</th></tr></thead><tbody>
${Array.from({length:maxRowsMuGP},(_,i)=>{
  const a = atkRankMuGP[i]; const d = defRankMuGP[i];
  const atkHtml = a ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameMu(a.muId||a.mu)||`MU ${String(a.muId||a.mu).slice(-6)}`,`https://app.warera.io/mu/${a.muId||a.mu}`)}</td><td>${fmtNum(getPoints(a))}</td>` : `<td></td><td></td><td></td>`;
  const defHtml = d ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameMu(d.muId||d.mu)||`MU ${String(d.muId||d.mu).slice(-6)}`,`https://app.warera.io/mu/${d.muId||d.mu}`)}</td><td>${fmtNum(getPoints(d))}</td>` : `<td></td><td></td><td></td>`;
  return `<tr>${atkHtml}${defHtml}</tr>`;
}).join("")}
</tbody></table></div>`;
  }

  if (rankCountry.length) {
    const atkRankCountry = rankCountry.filter(r => r._side === "attacker").sort((a,b)=>getValue(b)-getValue(a)).slice(0,10);
    const defRankCountry = rankCountry.filter(r => r._side === "defender").sort((a,b)=>getValue(b)-getValue(a)).slice(0,10);
    const maxRowsCountry = Math.max(atkRankCountry.length, defRankCountry.length);
    html += `<div class="br-section"><h3 class="br-section-title">🌍 Top 10 Countries by Damage</h3>
    <table class="rank-table"><thead><tr><th colspan="3" style="color:var(--blue)">ATTACKER</th><th colspan="3" style="color:var(--red)">DEFENDER</th></tr>
    <tr><th>#</th><th>Country</th><th>Damage</th><th>#</th><th>Country</th><th>Damage</th></tr></thead><tbody>
${Array.from({length:maxRowsCountry},(_,i)=>{
  const a = atkRankCountry[i]; const d = defRankCountry[i];
  const atkHtml = a ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameCountry(a.countryId||a.country)||a.countryName||a.name||"Unknown",`https://app.warera.io/country/${a.countryId||a.country}`)}</td><td>${fmtNum(getValue(a))}</td>` : `<td></td><td></td><td></td>`;
  const defHtml = d ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameCountry(d.countryId||d.country)||d.countryName||d.name||"Unknown",`https://app.warera.io/country/${d.countryId||d.country}`)}</td><td>${fmtNum(getValue(d))}</td>` : `<td></td><td></td><td></td>`;
  return `<tr>${atkHtml}${defHtml}</tr>`;
}).join("")}
</tbody></table></div>`;
  }

  if (gpCountry.length) {
    const atkRankCountryGP = gpCountry.filter(r => r._side === "attacker").sort((a,b)=>getPoints(b)-getPoints(a)).slice(0,10);
    const defRankCountryGP = gpCountry.filter(r => r._side === "defender").sort((a,b)=>getPoints(b)-getPoints(a)).slice(0,10);
    const maxRowsCountryGP = Math.max(atkRankCountryGP.length, defRankCountryGP.length);
    html += `<div class="br-section"><h3 class="br-section-title">🌍 Top 10 Countries by Ground Points</h3>
    <table class="rank-table"><thead><tr><th colspan="3" style="color:var(--blue)">ATTACKER</th><th colspan="3" style="color:var(--red)">DEFENDER</th></tr>
    <tr><th>#</th><th>Country</th><th>Ground Points</th><th>#</th><th>Country</th><th>Ground Points</th></tr></thead><tbody>
${Array.from({length:maxRowsCountryGP},(_,i)=>{
  const a = atkRankCountryGP[i]; const d = defRankCountryGP[i];
  const atkHtml = a ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameCountry(a.countryId||a.country)||a.countryName||a.name||"Unknown",`https://app.warera.io/country/${a.countryId||a.country}`)}</td><td>${fmtNum(getPoints(a))}</td>` : `<td></td><td></td><td></td>`;
  const defHtml = d ? `<td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td>${makeEntityLink(nameCountry(d.countryId||d.country)||d.countryName||d.name||"Unknown",`https://app.warera.io/country/${d.countryId||d.country}`)}</td><td>${fmtNum(getPoints(d))}</td>` : `<td></td><td></td><td></td>`;
  return `<tr>${atkHtml}${defHtml}</tr>`;
}).join("")}
</tbody></table></div>`;
  }

  if (orders.length) {
    const priorityRank = { high: 3, medium: 2, low: 1 };
    const atkOrders = orders.filter(o => (o.side || o.attackerDefender || o._side) === "attacker").sort((a, b) => (priorityRank[b.priority?.toLowerCase()] || 0) - (priorityRank[a.priority?.toLowerCase()] || 0));
    const defOrders = orders.filter(o => (o.side || o.attackerDefender || o._side) === "defender").sort((a, b) => (priorityRank[b.priority?.toLowerCase()] || 0) - (priorityRank[a.priority?.toLowerCase()] || 0));
    const maxRows = Math.max(atkOrders.length, defOrders.length);
    html+=`<div class="br-section"><h3 class="br-section-title">🎯 Battle Orders</h3>
    <table class="rank-table"><thead>
<tr><th colspan="4" style="color:var(--blue)">ATTACKER</th><th colspan="4" style="color:var(--red)">DEFENDER</th></tr>
<tr><th>Through</th><th>Issuer</th><th>Issued By</th><th>Priority</th><th>Through</th><th>Issuer</th><th>Issued By</th><th>Priority</th></tr>
</thead><tbody>
${Array.from({length:maxRows}).map((_,i)=>{
  const atk = atkOrders[i]; const def = defOrders[i];
  function renderOrder(o){
    if(!o) return `<td colspan="4"></td>`;
    const issuedThrough = o.mu ? "Military Unit" : o.country ? "Country" : "Unknown";
    const issuer = orderIssuer(o);
    const createdBy = nameUser(o.user) || "Unknown";
    const p = (o.priority || "").toLowerCase();
    const priorityColor = p === "high" ? "var(--red)" : p === "medium" ? "#f5c542" : p === "low" ? "var(--green)" : "var(--ink-dim)";
    const priority = `<span style="color:${priorityColor};font-weight:800;">${p ? p.charAt(0).toUpperCase() + p.slice(1) : "—"}</span>`;
    return `<td>${issuedThrough}</td><td>${issuer}</td><td>${createdBy}</td><td>${priority}</td>`;
  }
  return `<tr>${renderOrder(atk)}${renderOrder(def)}</tr>`;
}).join("")}
</tbody></table></div>`;
  }

  if (isLive) html+=`<p style="text-align:center;color:var(--ink-dim);font-size:.76rem;padding:6px 0">🔄 Auto-refreshing every 8 s</p>`;

  const startedDate = new Date(started);
  const endedDate = ended ? new Date(ended) : new Date();
  const durationMs = endedDate - startedDate;
  const durationStr = durationMs > 0 ? formatDuration(durationMs) : "";
  html+=`<div style="padding:8px 0;display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn-primary" id="openFullReportBtn" style="flex:1">📄 Open Full Report</button>
    <button class="btn-secondary" id="exportBattleXlsBtn" style="flex:1">📊 Export XLS</button>
    <button class="btn-secondary" id="captureBattlePaneBtn" style="flex:1">📸 Capture Report</button>
  </div>`;

  E.battleDetailPane.innerHTML = html;

  document.getElementById("clearBattleDetailBtn")?.addEventListener("click", () => { clearBattleDetail(); });

  const roundTabContainer = document.getElementById(`brRoundTabs_${bid}`);
  if (roundTabContainer) {
    const allTabBtns = roundTabContainer.querySelectorAll("[data-round-idx]");
    const allSections = E.battleDetailPane.querySelectorAll(`[data-round-section][data-round-bid="${bid}"]`);

    function activateRoundTab(idx) {
      allTabBtns.forEach(btn => { btn.classList.toggle("active", btn.dataset.roundIdx === String(idx)); });
      allSections.forEach(sec => { sec.style.display = sec.dataset.roundSection === String(idx) ? "block" : "none"; });
    }

    const defaultIdx = sortedRounds.length > 0 ? sortedRounds.length - 1 : "overall";
    allTabBtns.forEach(btn => { btn.classList.toggle("active", btn.dataset.roundIdx === String(defaultIdx)); });
    allTabBtns.forEach(btn => { btn.addEventListener("click", () => { activateRoundTab(btn.dataset.roundIdx); }); });
  }

  document.getElementById("openFullReportBtn")?.addEventListener("click",()=>{
    const title=`${atk||"?"} vs ${def||"?"}${reg?" — "+reg:""}`;
    E.battleReportTitle.textContent = "Battle Report: "+title;
    E.battleReportMeta.textContent = `${isLive?"Live":"Ended"} · ${started?fmtDate(started):""}${ended?" → "+fmtDate(ended):""}`;
    E.battleReportContent.innerHTML = html.replace(/<div[^>]*>\s*<button[^>]*id="openFullReportBtn"[^>]*>[\s\S]*?<\/div>/,"");
    if (E.openBattlePageBtn) {E.openBattlePageBtn.dataset.battleId = bid;}
    E.battleReportModal.classList.remove("hidden");
  });

  document.getElementById("exportBattleXlsBtn")?.addEventListener("click",()=>{
    exportBattleXLS(b, bid, rankUsers, gpUsers, rankMu, gpMu, rankCountry, gpCountry);
  });

  document.getElementById("captureBattlePaneBtn")?.addEventListener("click", async ()=>{
    const ch = await import("../core/captureReport.js");
    const title2 = `${atk||"Attacker"} vs ${def||"Defender"}${reg?" — "+reg:""}`;
    const slug = (atk||"Attacker")+"_vs_"+(def||"Defender")+(reg?"_"+reg.replace(/[\s-]+/g,"_"):"");
    const ptotalDmg = rankUsers.reduce((s, r) => s + getValue(r), 0);
    const ptotalGp = gpUsers.reduce((s, r) => s + getPoints(r), 0);
    const parts = (atkPar||0)+(defPar||0);
    const score = `${atkRoundsWon}—${defRoundsWon}`;
    const meta = [
      `Attacker: ${atk||"—"} | Defender: ${def||"—"}${reg?" · Region: "+reg:""} | Winner: ${winner||"—"} | Score: ${score}`,
      `Damage: ${fmtNum(ptotalDmg)} | Ground Points: ${fmtNum(ptotalGp)} | Participants: ${fmtNum(parts)}`,
      `${started ? "Started: "+fmtDate(started) : ""}${ended ? "  ·  Ended: "+fmtDate(ended) : ""}${durationStr ? "  ·  "+durationStr : ""}`,
      `Generated: ${new Date().toUTCString()}`,
    ];
    if (rankUsers.length) {
      const atkD = rankUsers.filter(r => r._side === "attacker").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const defD = rankUsers.filter(r => r._side === "defender").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const atkG = gpUsers.filter(r => r._side === "attacker").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const defG = gpUsers.filter(r => r._side === "defender").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const dm = rowsSideBySide(atkD, defD, r => nameUser(r.userId||r.user)||r.username||"Unknown", getValue);
      const gp = rowsSideBySide(atkG, defG, r => nameUser(r.userId||r.user)||r.username||"Unknown", getPoints);
      const subH = `<th colspan="3" style="${ch.STYLE.th};text-align:center">ATTACKER</th><th colspan="3" style="${ch.STYLE.th};text-align:center">DEFENDER</th>`;
      const html = ch.pageOpen("War Era Battle Report", title2, meta) +
        ch.section("Top Fighters by Damage", ch.tableBlock("", ["#","Fighter","Damage","#","Fighter","Damage"], dm, 10, subH)) +
        ch.section("Top Fighters by Ground Points", ch.tableBlock("", ["#","Fighter","Ground Pts","#","Fighter","Ground Pts"], gp, 10, subH)) +
        ch.pageClose();
      await ch.captureHTML(html, `battle_${slug}_fighters_${ch.ts()}.png`);
    }
    if (rankMu.length) {
      const atkD = rankMu.filter(r => r._side === "attacker").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const defD = rankMu.filter(r => r._side === "defender").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const atkG = gpMu.filter(r => r._side === "attacker").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const defG = gpMu.filter(r => r._side === "defender").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const dm = rowsSideBySide(atkD, defD, r => nameMu(r.muId||r.mu)||`MU ${String(r.muId||r.mu).slice(-6)}`, getValue);
      const gp = rowsSideBySide(atkG, defG, r => nameMu(r.muId||r.mu)||`MU ${String(r.muId||r.mu).slice(-6)}`, getPoints);
      const subH = `<th colspan="3" style="${ch.STYLE.th};text-align:center">ATTACKER</th><th colspan="3" style="${ch.STYLE.th};text-align:center">DEFENDER</th>`;
      const html = ch.pageOpen("War Era Battle Report", title2, meta) +
        ch.section("Top MUs by Damage", ch.tableBlock("", ["#","MU","Damage","#","MU","Damage"], dm, 10, subH)) +
        ch.section("Top MUs by Ground Points", ch.tableBlock("", ["#","MU","Ground Pts","#","MU","Ground Pts"], gp, 10, subH)) +
        ch.pageClose();
      await ch.captureHTML(html, `battle_${slug}_mu_${ch.ts()}.png`);
    }
    if (rankCountry.length) {
      const atkD = rankCountry.filter(r => r._side === "attacker").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const defD = rankCountry.filter(r => r._side === "defender").sort((a,b) => getValue(b) - getValue(a)).slice(0,10);
      const atkG = gpCountry.filter(r => r._side === "attacker").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const defG = gpCountry.filter(r => r._side === "defender").sort((a,b) => getPoints(b) - getPoints(a)).slice(0,10);
      const dm = rowsSideBySide(atkD, defD, r => nameCountry(r.countryId||r.country)||r.countryName||r.name||"Unknown", getValue);
      const gp = rowsSideBySide(atkG, defG, r => nameCountry(r.countryId||r.country)||r.countryName||r.name||"Unknown", getPoints);
      const subH = `<th colspan="3" style="${ch.STYLE.th};text-align:center">ATTACKER</th><th colspan="3" style="${ch.STYLE.th};text-align:center">DEFENDER</th>`;
      const html = ch.pageOpen("War Era Battle Report", title2, meta) +
        ch.section("Top Countries by Damage", ch.tableBlock("", ["#","Country","Damage","#","Country","Damage"], dm, 10, subH)) +
        ch.section("Top Countries by Ground Points", ch.tableBlock("", ["#","Country","Ground Pts","#","Country","Ground Pts"], gp, 10, subH)) +
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
