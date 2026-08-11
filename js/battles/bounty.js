import { E } from "../core/dom.js";
import { apiKey, fetchTrpcApi2, unwrap } from "../core/api.js";
import { fmtMoney, fmtNum, fmtDate, escapeHtml, rankBadgeHtml } from "../core/utils.js";
import { resolveEntityByType } from "../core/resolver.js";
import { nameCountry, nameMu, nameUser, nameRegion, battleSideColors } from "./companies.js";

const CONTRACT_STATUSES = ["won", "active", "expiredNoBids"];
const CONTRACT_TTL = 60000;
const MONEY_TTL = 60000;
const MAX_CARDS = 150;
const _contractCache = new Map();
const _moneyCache = new Map();
let _modalData = null;
let _bountyFilter = "all";
let _moneyType = "users";

export function summarizeContracts(items) {
  const won = items.filter(i => i.status === "won");
  const active = items.filter(i => i.status === "active");
  const expired = items.filter(i => i.status === "expiredNoBids");
  const side = { attacker: { count: 0, budget: 0, payout: 0, spent: 0 }, defender: { count: 0, budget: 0, payout: 0, spent: 0 } };
  let totalBudget = 0, totalPayout = 0, totalSpent = 0;
  for (const i of items) {
    const s = i.forCountrySide === "defender" ? "defender" : "attacker";
    const b = Number(i.budget) || 0;
    const p = Number(i.currentPayout) || 0;
    side[s].count++;
    side[s].budget += b;
    side[s].payout += p;
    if (i.status === "won") { side[s].spent += p; totalSpent += p; }
    else if (i.status === "active") { side[s].spent += b; totalSpent += b; }
    totalBudget += b;
    totalPayout += p;
  }
  return { items, won, active, expired, totalBudget, totalPayout, totalSpent, side };
}

export async function fetchBattleContracts(battleId, force = false) {
  if (!battleId) return summarizeContracts([]);
  const cached = _contractCache.get(battleId);
  if (!force && cached && Date.now() - cached.ts < CONTRACT_TTL) return cached.data;
  const k = apiKey();
  const all = [];
  if (k) {
    for (const status of CONTRACT_STATUSES) {
      let cursor;
      for (let page = 0; page < 20; page++) {
        let res;
        try {
          res = await fetchTrpcApi2("mercenaryContractAuction.getPaginatedAuctions", { battleId, status, limit: 50, cursor }, k);
        } catch { break; }
        const data = unwrap(res);
        const items = Array.isArray(data) ? data : (data?.items || []);
        if (!items.length) break;
        all.push(...items);
        cursor = data?.nextCursor || data?.cursor || null;
        if (!cursor) break;
      }
    }
  }
  const result = summarizeContracts(all);
  _contractCache.set(battleId, { ts: Date.now(), data: result });
  return result;
}

/**
 * Money gained per battle participant (public bounty pools + mercenary contract
 * payouts), from battleRanking.getRanking { dataType:"money" }. Summing the
 * country values per side equals the sum of all user values, i.e. the total
 * money a side paid out in the battle.
 */
async function fetchMoneyRanking(battleId, type, side, pageLimit) {
  const k = apiKey();
  if (!k) return [];
  const all = [];
  let cursor;
  for (let page = 0; page < pageLimit; page++) {
    let res;
    try {
      res = await fetchTrpcApi2("battleRanking.getRanking", { battleId, dataType: "money", type, side, limit: 100, cursor }, k);
    } catch { break; }
    const data = unwrap(res);
    const items = Array.isArray(data) ? data : (data?.items || []);
    if (!items.length) break;
    all.push(...items);
    cursor = data?.nextCursor || data?.cursor || null;
    if (!cursor) break;
  }
  return all;
}

export async function fetchBattleMoney(battleId, force = false) {
  if (!battleId) return null;
  const cached = _moneyCache.get(battleId);
  if (!force && cached && Date.now() - cached.ts < MONEY_TTL) return cached.data;
  const k = apiKey();
  if (!k) return null;
  const sideMoney = async (side) => {
    const [users, mus, countries] = await Promise.all([
      fetchMoneyRanking(battleId, "user", side, 1),
      fetchMoneyRanking(battleId, "mu", side, 1),
      fetchMoneyRanking(battleId, "country", side, 10),
    ]);
    const total = countries.reduce((s, i) => s + (Number(i.value) || 0), 0);
    return { users, mus, countries, total };
  };
  const data = {
    atk: await sideMoney("attacker"),
    def: await sideMoney("defender"),
  };
  _moneyCache.set(battleId, { ts: Date.now(), data });
  return data;
}

export function battleSpend(b, contracts, money) {
  const a = b?.attacker || {};
  const d = b?.defender || {};
  const c = contracts || { items: [], side: { attacker: { count: 0, budget: 0, payout: 0, spent: 0 }, defender: { count: 0, budget: 0, payout: 0, spent: 0 } } };
  const atkPool = Number(a.moneyPool ?? b.attackerMoneyPool) || 0;
  const defPool = Number(d.moneyPool ?? b.defenderMoneyPool) || 0;
  const atkC = c.side.attacker || { count: 0, budget: 0, payout: 0, spent: 0 };
  const defC = c.side.defender || { count: 0, budget: 0, payout: 0, spent: 0 };
  const atkSpent = money?.atk?.total != null ? Number(money.atk.total) : (atkC.spent + atkPool);
  const defSpent = money?.def?.total != null ? Number(money.def.total) : (defC.spent + defPool);
  return {
    atkSpent, defSpent,
    atkContractsSpent: atkC.spent, defContractsSpent: defC.spent,
    atkPool, defPool,
    atkCount: atkC.count, defCount: defC.count,
    atkPerK: a.moneyPer1kDamages ?? b.attackerMoneyPer1kDamages,
    defPerK: d.moneyPer1kDamages ?? b.defenderMoneyPer1kDamages,
  };
}

export function contractWinnerHtml(c) {
  if (c.status === "won") {
    const muId = c.currentWinner || c.bids?.[0]?.mu;
    const userId = c.currentWinnerUser || c.bids?.[0]?.user;
    const mu = muId ? (nameMu(muId) || `MU ${String(muId).slice(-6)}`) : null;
    const u = userId ? (nameUser(userId) || "") : null;
    const parts = [];
    if (mu) parts.push(escapeHtml(mu));
    if (u) parts.push(escapeHtml(u));
    return parts.join(" / ") || "—";
  }
  if (c.status === "active") {
    const bid = (c.bids || []).slice(-1)[0];
    if (!bid) return "No bids yet";
    const mu = bid.mu ? (nameMu(bid.mu) || `MU ${String(bid.mu).slice(-6)}`) : "";
    const u = bid.user ? (nameUser(bid.user) || "") : "";
    return `Top bid: ${[mu, u].filter(Boolean).join(" / ")}`;
  }
  return "—";
}

function statusLabel(s) {
  const icon = (name, color) => `<iconify-icon icon="${name}" class="lu"${color ? ` style="color:${color}"` : ""}></iconify-icon>`;
  if (s === "won") return `${icon("mdi:cash")} Won`;
  if (s === "active") return `${icon("mdi:check-circle-outline", "var(--green)")} Active`;
  if (s === "expiredNoBids") return `${icon("mdi:sleep")} No bids`;
  if (s === "cancelled") return `${icon("mdi:cancel")} Cancelled`;
  if (s === "expiredBattle") return `${icon("mdi:history")} Battle ended`;
  if (s === "expiredRound") return `${icon("mdi:reload")} Round ended`;
  return s || "—";
}

function sideKey(c) {
  return c.forCountrySide === "defender" ? "defender" : "attacker";
}

function battleNames(b) {
  const atkId = b?.attacker?.country || b.attackerCountry || b.attacker?.countryId;
  const defId = b?.defender?.country || b.defenderCountry || b.defender?.countryId;
  const atkName = nameCountry(atkId) || (b.type === "tournament" ? nameMu(b?.attacker?.tournamentTeam) : "") || "Attacker";
  const defName = nameCountry(defId) || (b.type === "tournament" ? nameMu(b?.defender?.tournamentTeam) : "") || "Defender";
  return { atkName, defName };
}

function sideBoxHtml(label, name, spent, count, perK, pool, color) {
  const parts = ["public bounty + contracts"];
  if (perK != null) parts.push(`$${Number(perK)}/1k`);
  if (count) parts.push(`${count} contract${count === 1 ? "" : "s"}`);
  if (pool > 0) parts.push(`${fmtMoney(pool)} pool left`);
  return `<div style="border:1px solid var(--line);border-radius:var(--radius);padding:8px 10px;background:var(--surface-hi)">
    <div style="font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${color}">${label} · ${escapeHtml(name)}</div>
    <div style="font-size:1.15rem;font-weight:900;line-height:1.3">${fmtMoney(spent)} BTC</div>
    <div style="font-size:.66rem;color:var(--ink-dim)">${parts.join(" · ")}</div>
  </div>`;
}

export function bountySummaryHtml(b, contracts, money) {
  const spend = battleSpend(b, contracts, money);
  const { atkName, defName } = battleNames(b);
  const { atkText, defText } = battleSideColors(b);
  const hasAny = spend.atkSpent > 0 || spend.defSpent > 0 || spend.atkPerK != null || spend.defPerK != null;
  if (!hasAny) return "";
  return `<div class="br-section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h3 class="br-section-title" style="margin:0"><iconify-icon icon="mdi:hand-coin" class="lu"></iconify-icon> Bounty &amp; Mercenaries</h3>
      <button class="btn-secondary" data-open-bounty style="padding:3px 10px;min-width:auto;font-size:.72rem">Open Report</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center">
      ${sideBoxHtml("Attacker", atkName, spend.atkSpent, spend.atkCount, spend.atkPerK, spend.atkPool, atkText)}
      <div style="font-size:.66rem;font-weight:800;color:var(--ink-dim);text-align:center">VS</div>
      ${sideBoxHtml("Defender", defName, spend.defSpent, spend.defCount, spend.defPerK, spend.defPool, defText)}
    </div>
  </div>`;
}

export function bindBountySummaryButtons(root, b, bid, contracts) {
  root?.querySelectorAll("[data-open-bounty]").forEach(btn => {
    btn.addEventListener("click", () => openBountyModal(b, bid, contracts));
  });
}

export function closeBountyModal() {
  E.bountyModal?.classList.add("hidden");
}

function statBox(val, label, extraStyle) {
  return `<div class="br-stat-box"${extraStyle ? ` style="${extraStyle}"` : ""}><span class="br-stat-val">${val}</span><span class="br-stat-lbl">${label}</span></div>`;
}

function spendRow(label, perK, count, budget, payout, moneyTotal, color) {
  const perKStr = perK != null ? `$${Number(perK)} / 1k DMG` : "—";
  return `<tr>
    <td style="font-weight:800;color:${color}">${escapeHtml(label)}</td>
    <td>${perKStr}</td>
    <td>${count}</td>
    <td>${fmtMoney(budget)}</td>
    <td>${fmtMoney(payout)}</td>
    <td style="font-weight:800">${fmtMoney(moneyTotal)}</td>
  </tr>`;
}

function contractCardHtml(x, atkName, defName, atkText, defText, atkColor, defColor) {
  const s = sideKey(x);
  const isDef = s === "defender";
  const sideName = isDef ? defName : atkName;
  const sideColor = isDef ? defColor : atkColor;
  const sideTextColor = isDef ? defText : atkText;
  const bids = x.bids || [];
  const perK = (v) => Number.isFinite(Number(v)) ? Number(v) : "—";
  const bidsHtml = bids.length ? `
    <table class="rank-table"><thead>
      <tr><th>MU</th><th>User</th><th>Per K</th><th>Payout</th><th>Bid Time</th></tr>
    </thead><tbody>
      ${bids.map(bd => `<tr>
        <td>${bd.mu ? escapeHtml(nameMu(bd.mu) || `MU ${String(bd.mu).slice(-6)}`) : "—"}</td>
        <td>${bd.user ? escapeHtml(nameUser(bd.user) || String(bd.user).slice(-6)) : "—"}</td>
        <td>${perK(bd.perK)}</td>
        <td>${fmtMoney(bd.payout)}</td>
        <td>${bd.bidAt ? fmtDate(bd.bidAt) : "—"}</td>
      </tr>`).join("")}
    </tbody></table>` : `<p style="font-size:.74rem;color:var(--ink-dim);margin:4px 0">No bids.</p>`;

  return `<div style="border:1px solid var(--line);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px;background:var(--surface)">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:${sideTextColor};border:1px solid ${sideColor};border-radius:999px;padding:1px 8px">${escapeHtml(sideName)}</span>
        <span style="font-size:.7rem;font-weight:700">${statusLabel(x.status)}</span>
        ${x.professionalsOnly ? `<span style="font-size:.66rem;color:var(--ink-dim);border:1px solid var(--line);border-radius:999px;padding:1px 8px"><iconify-icon icon="mdi:crown-outline" class="lu"></iconify-icon> Pros only</span>` : ""}
        <span style="font-size:.66rem;color:var(--ink-dim)">duration ${Number(x.duration) || "—"} min</span>
      </div>
      <div style="font-size:.66rem;color:var(--ink-dim)">${fmtDate(x.createdAt)} → ${fmtDate(x.expiresAt)}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px;margin-top:8px">
      ${statBox(fmtNum(Number(x.minimumDamage) || 0), "Min DMG")}
      ${statBox(fmtMoney(x.budget), "Budget")}
      ${statBox(perK(x.initialPerK), "Initial Per K")}
      ${statBox(perK(x.currentPerK), "Current Per K")}
      ${statBox(fmtMoney(x.currentPayout), "Payout")}
    </div>
    <div style="font-size:.76rem;margin-top:6px;color:var(--ink)"><strong>Winner / Top bid:</strong> ${contractWinnerHtml(x)}</div>
    <details style="margin-top:6px;font-size:.78rem">
      <summary style="cursor:pointer;color:var(--ink-dim);font-weight:700">Bids (${bids.length})</summary>
      <div style="margin-top:6px">${bidsHtml}</div>
    </details>
  </div>`;
}

function moneyEntityNameLink(r, type) {
  if (type === "mus") {
    const id = r.mu;
    return [nameMu(id) || `MU ${String(id).slice(-6)}`, `https://app.warera.io/mu/${id}`];
  }
  if (type === "countries") {
    const id = r.country;
    return [nameCountry(id) || String(id).slice(-6), `https://app.warera.io/country/${id}`];
  }
  const id = r.user;
  return [nameUser(id) || `User ${String(id).slice(-6)}`, `https://app.warera.io/user/${id}`];
}

function moneyCell(rank, name, url, value) {
  return `<td>${rankBadgeHtml(rank)}</td><td><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="entity-link">${escapeHtml(name)}</a></td><td style="font-weight:700">${fmtMoney(value)}</td>`;
}

function moneySideBySide(atkArr, defArr, type) {
  const rows = [];
  const max = Math.max(atkArr.length, defArr.length);
  for (let i = 0; i < max && i < 10; i++) {
    const a = atkArr[i];
    const d = defArr[i];
    const aH = a ? (() => { const [n, u] = moneyEntityNameLink(a, type); return moneyCell(Number(a.rank) || i + 1, n, u, a.value); })() : `<td></td><td></td><td></td>`;
    const dH = d ? (() => { const [n, u] = moneyEntityNameLink(d, type); return moneyCell(Number(d.rank) || i + 1, n, u, d.value); })() : `<td></td><td></td><td></td>`;
    rows.push(`<tr>${aH}${dH}</tr>`);
  }
  return rows.join("");
}

function moneyRankingSectionHtml(money, moneyType, atkColor, defColor) {
  const atk = money?.atk;
  const def = money?.def;
  if (!atk || !def || (!atk.users.length && !def.users.length)) return "";
  const typeKey = moneyType === "mus" ? "mus" : moneyType === "countries" ? "countries" : "users";
  const typeLabel = moneyType === "mus" ? "MU" : moneyType === "countries" ? "Country" : "Fighter";
  const tabs = [
    ["users", "Users"],
    ["mus", "MUs"],
    ["countries", "Countries"],
  ].map(([k, lab]) => `<button class="pill-btn${moneyType === k ? " active" : ""}" data-money-type="${k}" style="font-size:.72rem">${lab}</button>`).join("");
  return `<div class="br-section">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px">
      <h3 class="br-section-title" style="margin:0"><iconify-icon icon="mdi:cash-multiple" class="lu"></iconify-icon> Money Ranking — Who Earned What</h3>
      <div style="display:flex;gap:6px">${tabs}</div>
    </div>
    <table class="rank-table"><thead>
      <tr><th colspan="3" style="color:${atkColor}">ATTACKER · ${fmtMoney(atk.total)} BTC</th><th colspan="3" style="color:${defColor}">DEFENDER · ${fmtMoney(def.total)} BTC</th></tr>
      <tr><th>#</th><th>${typeLabel}</th><th>Earned</th><th>#</th><th>${typeLabel}</th><th>Earned</th></tr>
    </thead><tbody>
      ${moneySideBySide(atk[typeKey], def[typeKey], typeKey)}
    </tbody></table>
    <p style="font-size:.7rem;color:var(--ink-dim);margin:6px 0 0">Money earned by participants from public bounty pools and mercenary contract payouts.</p>
  </div>`;
}

export function bountyModalBodyHtml(b, contracts, money, filter = "all", moneyType = "users") {
  const c = contracts || { items: [], won: [], active: [], expired: [], totalBudget: 0, totalPayout: 0, totalSpent: 0, side: { attacker: { count: 0, budget: 0, payout: 0, spent: 0 }, defender: { count: 0, budget: 0, payout: 0, spent: 0 } } };
  const spend = battleSpend(b, c, money);
  const { atkName, defName } = battleNames(b);
  const { atkColor, defColor, atkText, defText } = battleSideColors(b);
  const bid = b._id || b.battleId || b.id || "";
  const battleLink = bid ? ` <a href="https://app.warera.io/battle/${encodeURIComponent(bid)}" target="_blank" rel="noopener noreferrer" class="entity-link">Open battle in War Era</a>` : "";
  const totalMoney = spend.atkSpent + spend.defSpent;

  const summaryCells = [
    statBox(c.items.length, "Contracts"),
    statBox(fmtMoney(c.totalBudget), "Contract Budget"),
    statBox(fmtMoney(c.totalPayout), "Contract Payouts"),
    statBox(fmtMoney(totalMoney), "Money Paid (Bounty+Contracts)"),
    statBox(c.won.length, "Won"),
    statBox(c.active.length, "Active"),
    statBox(c.expired.length, "No Bids"),
  ].join("");

  const tabs = [
    ["all", "All", c.items.length],
    ["won", "Won", c.won.length],
    ["active", "Active", c.active.length],
    ["expiredNoBids", "No Bids", c.expired.length],
  ].map(([key, label, n]) => `<button class="pill-btn${filter === key ? " active" : ""}" data-bounty-filter="${key}" style="font-size:.72rem">${label} (${n})</button>`).join("");

  const filtered = filter === "all" ? c.items : c.items.filter(i => i.status === filter);
  const shown = filtered.slice(0, MAX_CARDS);
  const cards = shown.length
    ? shown.map(x => contractCardHtml(x, atkName, defName, atkText, defText, atkColor, defColor)).join("")
    : `<p style="color:var(--ink-dim);text-align:center;padding:16px 0">No mercenary contracts in this status.</p>`;
  const moreNote = filtered.length > MAX_CARDS
    ? `<p style="font-size:.7rem;color:var(--ink-dim);margin:4px 0 0">Showing first ${MAX_CARDS} of ${filtered.length} contracts. Refine with the filter tabs above.</p>`
    : "";

  return `<p style="font-size:.78rem;color:var(--ink-dim);margin:0 0 8px">Combined public bounty pools and mercenary contract spend, per side.${battleLink}</p>
    <div class="br-section">
      <div class="br-stats-grid">${summaryCells}</div>
    </div>
    <div class="br-section">
      <h3 class="br-section-title">Per-Side Spend</h3>
      <table class="rank-table"><thead>
        <tr><th>Side</th><th>Bounty / 1k</th><th>Contracts</th><th>Contract Budget</th><th>Contract Paid</th><th>Money Paid (Bounty+Contracts)</th></tr>
      </thead><tbody>
        ${spendRow(atkName, spend.atkPerK, spend.atkCount, c.side.attacker.budget, c.side.attacker.payout, spend.atkSpent, atkText)}
        ${spendRow(defName, spend.defPerK, spend.defCount, c.side.defender.budget, c.side.defender.payout, spend.defSpent, defText)}
      </tbody></table>
      <p style="font-size:.7rem;color:var(--ink-dim);margin:6px 0 0">Money Paid = total public bounty paid out + mercenary contract payouts for the side, from the game's money ranking.</p>
    </div>
    ${moneyRankingSectionHtml(money, moneyType, atkText, defText)}
    <div class="br-section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <h3 class="br-section-title" style="margin:0">Mercenary Contracts (${c.items.length})</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${tabs}</div>
      </div>
      ${cards}
      ${moreNote}
    </div>`;
}

export function renderBountyModalBody() {
  if (!_modalData || !E.bountyModalBody) return;
  E.bountyModalBody.innerHTML = bountyModalBodyHtml(_modalData.b, _modalData.contracts, _modalData.money, _bountyFilter, _moneyType);
}

export function openBountyModal(b, bid, contracts) {
  if (!E.bountyModal) return;
  const { atkName, defName } = battleNames(b);
  const reg = nameRegion(b?.defender?.region || b.defenderRegion || b.region);
  E.bountyModal.classList.remove("hidden");
  if (E.bountyModalTitle) E.bountyModalTitle.textContent = "Bounty & Mercenary Contracts";
  if (E.bountyModalByline) E.bountyModalByline.textContent = `${atkName} vs ${defName}${reg ? " — " + reg : ""}`;
  _bountyFilter = "all";
  _moneyType = "users";
  if (E.bountyModalBody) {
    E.bountyModalBody.innerHTML = '<p style="color:var(--ink-dim)">Loading bounty, money ranking &amp; contract data…</p>';
    Promise.all([fetchBattleContracts(bid, true), fetchBattleMoney(bid, true)])
      .then(async ([c, money]) => {
        _modalData = { b, contracts: c, money };
        await resolveContractEntities(c, money);
        renderBountyModalBody();
      })
      .catch(() => {
        if (E.bountyModalBody) E.bountyModalBody.innerHTML = '<p class="status-msg error">Failed to load bounty &amp; contract data.</p>';
      });
  }
}

async function resolveContractEntities(contracts, money) {
  const k = apiKey();
  if (!k) return;
  const muIds = new Set();
  const userIds = new Set();
  for (const c of contracts?.items || []) {
    if (c.currentWinner) muIds.add(c.currentWinner);
    if (c.currentWinnerUser) userIds.add(c.currentWinnerUser);
    for (const bd of c.bids || []) {
      if (bd.mu) muIds.add(bd.mu);
      if (bd.user) userIds.add(bd.user);
    }
  }
  for (const side of [money?.atk, money?.def]) {
    for (const r of side?.mus || []) if (r.mu) muIds.add(r.mu);
    for (const r of side?.users || []) if (r.user) userIds.add(r.user);
  }
  await Promise.allSettled([
    ...[...muIds].map(id => resolveEntityByType("mu", id, k)),
    ...[...userIds].map(id => resolveEntityByType("user", id, k)),
  ]);
}

export function copyBountyReport() {
  const txt = E.bountyModalBody?.innerText || "";
  if (!txt) return;
  navigator.clipboard?.writeText(txt).then(() => {}).catch(() => {});
}

document.addEventListener("click", e => {
  if (e.target.closest("#closeBountyModal")) closeBountyModal();
  if (e.target.id === "bountyModal") closeBountyModal();
  if (e.target.closest("#copyBountyReportBtn")) copyBountyReport();
  const tab = e.target.closest("[data-bounty-filter]");
  if (tab) {
    _bountyFilter = tab.dataset.bountyFilter;
    renderBountyModalBody();
  }
  const moneyTab = e.target.closest("[data-money-type]");
  if (moneyTab) {
    _moneyType = moneyTab.dataset.moneyType;
    renderBountyModalBody();
  }
});
