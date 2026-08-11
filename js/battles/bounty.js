import { E } from "../core/dom.js";
import { apiKey, fetchTrpcApi2, unwrap } from "../core/api.js";
import { fmtMoney, fmtNum, fmtDate, escapeHtml } from "../core/utils.js";
import { nameCountry, nameMu, nameUser, nameRegion } from "./companies.js";

const CONTRACT_STATUSES = ["won", "active", "expiredNoBids"];
const CONTRACT_TTL = 60000;
const MAX_CARDS = 150;
const _contractCache = new Map();
let _modalData = null;
let _bountyFilter = "all";

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

export function battleSpend(b, contracts) {
  const a = b?.attacker || {};
  const d = b?.defender || {};
  const c = contracts || { items: [], side: { attacker: { count: 0, budget: 0, payout: 0, spent: 0 }, defender: { count: 0, budget: 0, payout: 0, spent: 0 } } };
  const atkPool = Number(a.moneyPool ?? b.attackerMoneyPool) || 0;
  const defPool = Number(d.moneyPool ?? b.defenderMoneyPool) || 0;
  const atkC = c.side.attacker || { count: 0, budget: 0, payout: 0, spent: 0 };
  const defC = c.side.defender || { count: 0, budget: 0, payout: 0, spent: 0 };
  return {
    atkSpent: atkC.spent + atkPool,
    defSpent: defC.spent + defPool,
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
  if (s === "won") return "💰 Won";
  if (s === "active") return "🟢 Active";
  if (s === "expiredNoBids") return "💤 No bids";
  if (s === "cancelled") return "✖ Cancelled";
  if (s === "expiredBattle") return "⚰ Battle ended";
  if (s === "expiredRound") return "🔁 Round ended";
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

function sideBoxHtml(label, name, spent, count, perK, color) {
  const perKStr = perK != null ? ` · $${Number(perK)}/1k` : "";
  const countStr = count ? ` · ${count} contracts` : "";
  return `<div style="border:1px solid var(--line);border-radius:var(--radius);padding:8px 10px;background:var(--surface-hi)">
    <div style="font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${color}">${label} · ${escapeHtml(name)}</div>
    <div style="font-size:1.15rem;font-weight:900;line-height:1.3">${fmtMoney(spent)}</div>
    <div style="font-size:.66rem;color:var(--ink-dim)">spent${countStr}${perKStr}</div>
  </div>`;
}

export function bountySummaryHtml(b, contracts) {
  const spend = battleSpend(b, contracts);
  const { atkName, defName } = battleNames(b);
  const hasAny = spend.atkSpent > 0 || spend.defSpent > 0 || spend.atkPerK != null || spend.defPerK != null;
  if (!hasAny) return "";
  return `<div class="br-section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h3 class="br-section-title" style="margin:0">💰 Bounty &amp; Mercenaries</h3>
      <button class="btn-secondary" data-open-bounty style="padding:3px 10px;min-width:auto;font-size:.72rem">Open Report</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center">
      ${sideBoxHtml("Attacker", atkName, spend.atkSpent, spend.atkCount, spend.atkPerK, "var(--blue)")}
      <div style="font-size:.66rem;font-weight:800;color:var(--ink-dim);text-align:center">VS</div>
      ${sideBoxHtml("Defender", defName, spend.defSpent, spend.defCount, spend.defPerK, "var(--red)")}
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

function spendRow(label, perK, pool, count, budget, payout, spent, color) {
  const perKStr = perK != null ? `$${Number(perK)} / 1k DMG` : "—";
  return `<tr>
    <td style="font-weight:800;color:${color}">${escapeHtml(label)}</td>
    <td>${perKStr}</td>
    <td>${fmtMoney(pool)}</td>
    <td>${count}</td>
    <td>${fmtMoney(budget)}</td>
    <td>${fmtMoney(payout)}</td>
    <td style="font-weight:800">${fmtMoney(spent)}</td>
  </tr>`;
}

function contractCardHtml(x, atkName, defName) {
  const s = sideKey(x);
  const isDef = s === "defender";
  const sideName = isDef ? defName : atkName;
  const sideColor = isDef ? "var(--red)" : "var(--blue)";
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
        <span style="font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:${sideColor};border:1px solid ${sideColor};border-radius:999px;padding:1px 8px">${escapeHtml(sideName)}</span>
        <span style="font-size:.7rem;font-weight:700">${statusLabel(x.status)}</span>
        ${x.professionalsOnly ? `<span style="font-size:.66rem;color:var(--ink-dim);border:1px solid var(--line);border-radius:999px;padding:1px 8px">👑 Pros only</span>` : ""}
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

export function bountyModalBodyHtml(b, contracts, filter = "all") {
  const c = contracts || { items: [], won: [], active: [], expired: [], totalBudget: 0, totalPayout: 0, totalSpent: 0, side: { attacker: { count: 0, budget: 0, payout: 0, spent: 0 }, defender: { count: 0, budget: 0, payout: 0, spent: 0 } } };
  const spend = battleSpend(b, c);
  const { atkName, defName } = battleNames(b);
  const bid = b._id || b.battleId || b.id || "";
  const battleLink = bid ? ` <a href="https://app.warera.io/battle/${encodeURIComponent(bid)}" target="_blank" rel="noopener noreferrer" class="entity-link">Open battle in War Era</a>` : "";

  const summaryCells = [
    statBox(c.items.length, "Contracts"),
    statBox(fmtMoney(c.totalBudget), "Total Budget"),
    statBox(fmtMoney(c.totalPayout), "Total Paid"),
    statBox(fmtMoney(c.totalSpent), "Total Spent"),
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
    ? shown.map(x => contractCardHtml(x, atkName, defName)).join("")
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
        <tr><th>Side</th><th>Bounty / 1k</th><th>Public Pool</th><th>Contracts</th><th>Budget</th><th>Paid Out</th><th>Total Spent</th></tr>
      </thead><tbody>
        ${spendRow(atkName, spend.atkPerK, spend.atkPool, spend.atkCount, c.side.attacker.budget, c.side.attacker.payout, spend.atkSpent, "var(--blue)")}
        ${spendRow(defName, spend.defPerK, spend.defPool, spend.defCount, c.side.defender.budget, c.side.defender.payout, spend.defSpent, "var(--red)")}
      </tbody></table>
    </div>
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
  E.bountyModalBody.innerHTML = bountyModalBodyHtml(_modalData.b, _modalData.contracts, _bountyFilter);
}

export function openBountyModal(b, bid, contracts) {
  if (!E.bountyModal) return;
  const { atkName, defName } = battleNames(b);
  const reg = nameRegion(b?.defender?.region || b.defenderRegion || b.region);
  E.bountyModal.classList.remove("hidden");
  if (E.bountyModalTitle) E.bountyModalTitle.textContent = "Bounty & Mercenary Contracts";
  if (E.bountyModalByline) E.bountyModalByline.textContent = `${atkName} vs ${defName}${reg ? " — " + reg : ""}`;
  _bountyFilter = "all";
  if (E.bountyModalBody) {
    E.bountyModalBody.innerHTML = '<p style="color:var(--ink-dim)">Loading bounty &amp; contract data…</p>';
    fetchBattleContracts(bid, true).then(c => {
      _modalData = { b, contracts: c };
      renderBountyModalBody();
    }).catch(() => {
      if (E.bountyModalBody) E.bountyModalBody.innerHTML = '<p class="status-msg error">Failed to load bounty &amp; contract data.</p>';
    });
  }
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
});
