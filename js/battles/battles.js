import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtDate, fmtNum, escapeXml } from "../core/utils.js";
import { toast } from "../ui/toast.js";


export function stopBattlePolling() {
  clearInterval(S.liveBattleTimer); S.liveBattleTimer=null;
}

export function updateBattleTabPills() {
  E.battleTabLive?.classList.toggle("active", S.battleMode==="live");
  E.battleTabHistory?.classList.toggle("active", S.battleMode==="history");
}

function setBattleStatus(m,t="info") { E.battleListStatus.hidden=false; E.battleListStatus.textContent=m; E.battleListStatus.classList.toggle("error",t==="error"); }
function clearBattleStatus() { E.battleListStatus.hidden=true; E.battleListStatus.textContent=""; E.battleListStatus.classList.remove("error"); }

export function battleId(b) { return b._id||b.id||b.battleId||""; }

export async function loadBattles(reset=true) {
  const k = apiKey(); if (!k) return;
  stopBattlePolling();
  updateBattleTabPills();
  setBattleStatus("Loading battles…");
  if (reset) { S.battles=[]; S.battleCursor=null; E.battleList.innerHTML=""; }
  try {
    const payload = { limit:20, isActive: S.battleMode==="live", cursor:reset?undefined:S.battleCursor };
    const result = await fetchTrpc("battle.getBattles", payload, k);
    const data = unwrap(result);
    const battles = Array.isArray(data)?data:(data?.items||data?.battles||[]);
    S.battleCursor = data?.nextCursor||null;
    for (const b of battles) {
      const id=battleId(b); if(id) S.lookups.battlesById.set(id,b);
    }
    S.battles = reset ? battles : [...S.battles, ...battles];
    renderBattleList();
    clearBattleStatus();
  } catch (err) {
    setBattleStatus("Could not load battles: "+(err.message||""), "error");
  }
  E.loadMoreBattlesBtn.hidden = !S.battleCursor;
}

export function renderBattleList() {
  E.battleList.innerHTML="";
  const kw = S.battleSearch||"";
  let list = S.battles;
  if (kw) {
    list = S.battles.filter(b => {
      const atk = nameCountry(b.attacker?.country||b.attackerCountry||b.attacker?.countryId).toLowerCase();
      const def = nameCountry(b.defender?.country||b.defenderCountry||b.defender?.countryId).toLowerCase();
      const reg = nameRegion(b.defender?.region||b.defenderRegion||b.region).toLowerCase();
      const title = (b.title||b.name||"").toLowerCase();
      return atk.includes(kw)||def.includes(kw)||reg.includes(kw)||title.includes(kw);
    });
  }
  if (!list.length) {
    E.battleList.innerHTML=`<p style="color:var(--ink-dim);padding:20px;text-align:center">${kw?"No battles match your search.":"No battles found."}</p>`;
    return;
  }
  const frag=document.createDocumentFragment();
  for (const b of list) frag.append(makeBattleCard(b));
  E.battleList.append(frag);
}

import { nameCountry, nameRegion, nameUser } from "./companies.js";

function makeBattleCard(battle) {
  const node = E.tplBattle.content.firstElementChild.cloneNode(true);
  const bid = battleId(battle);
  const isLive = !battle.endedAt || battle.isActive===true || battle.active===true;
  const atk = nameCountry(battle.attacker?.country||battle.attackerCountry||battle.attacker?.countryId);
  const def = nameCountry(battle.defender?.country||battle.defenderCountry||battle.defender?.countryId);
  const reg = nameRegion(battle.defender?.region||battle.defenderRegion||battle.region);

  node.querySelector(".bc-dot").classList.add(isLive?"live":"ended");
  node.querySelector(".bc-label").textContent = isLive ? "🔴 LIVE" : "✅ ENDED";

  const title = (atk&&def) ? `${atk} vs ${def}${reg?" — "+reg:""}` : (battle.title||battle.name||"Battle #"+(bid||"?").slice(-6));
  node.querySelector(".bc-title").textContent = title;

  let meta = (battle.createdAt||battle.startedAt) ? "Started: "+fmtDate(battle.createdAt||battle.startedAt) : "";
  if (battle.endedAt) meta += " · Ended: "+fmtDate(battle.endedAt);
  node.querySelector(".bc-meta").textContent = meta;

  const chips = node.querySelector(".bc-chips");
  const chipsData = [];
  if (battle.participants?.length||battle.participantCount) chipsData.push("👥 "+(battle.participants?.length||battle.participantCount||"?")+" fighters");
  if (battle.totalDamage||battle.damage) chipsData.push("⚔ "+fmtNum(battle.totalDamage||battle.damage)+" DMG");
  for (const txt of chipsData.slice(0,2)) {
    const c=document.createElement("span"); c.className="bc-chip"; c.textContent=txt; chips.append(c);
  }

  const btn = node.querySelector(".bc-select");
  btn.addEventListener("click", async()=>{
    S.selectedBattleId=bid;
    document.querySelectorAll(".battle-card").forEach(c=>c.classList.remove("selected"));
    node.classList.add("selected");
    stopBattlePolling();
    const { loadBattleDetail } = await import("./battleDetail.js");
    await loadBattleDetail(battle, bid, false);
    if (isLive) {
      S.liveBattleTimer = setInterval(async()=>{
        if (S.selectedBattleId===bid) { await loadBattleDetail(battle,bid,true); if (window.ecgPulse) window.ecgPulse(0.7); }
      }, 5000);
    }
  });

  return node;
}

export function clearBattleDetail() {
  stopBattlePolling();
  S.selectedBattleId = null;
  document.querySelectorAll(".battle-card").forEach(c => c.classList.remove("selected"));
  E.battleDetailPane.innerHTML = `
    <div class="detail-placeholder">
      <span class="placeholder-icon">⚔</span>
      <p>Select a battle to view the intelligence report</p>
    </div>
  `;
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
