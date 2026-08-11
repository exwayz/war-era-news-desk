import { apiKey, fetchTrpcApi2, unwrap } from "../core/api.js";
import { fmtMoney, fmtNum, fmtDate, escapeHtml } from "../core/utils.js";
import { nameCountry, nameMu, nameUser } from "./companies.js";

const CONTRACT_STATUSES = ["won", "active", "expiredNoBids"];
const CONTRACT_TTL = 60000;
const _contractCache = new Map();

export function summarizeContracts(items) {
  const won = items.filter(i => i.status === "won");
  const active = items.filter(i => i.status === "active");
  const expired = items.filter(i => i.status === "expiredNoBids");
  const side = { attacker: { count: 0, budget: 0, payout: 0 }, defender: { count: 0, budget: 0, payout: 0 } };
  let totalBudget = 0, totalPayout = 0;
  for (const i of items) {
    const s = i.forCountrySide === "defender" ? "defender" : "attacker";
    const b = Number(i.budget) || 0;
    const p = Number(i.currentPayout) || 0;
    side[s].count++;
    side[s].budget += b;
    side[s].payout += p;
    totalBudget += b;
    totalPayout += p;
  }
  return { items, won, active, expired, totalBudget, totalPayout, side };
}

export async function fetchBattleContracts(battleId) {
  if (!battleId) return summarizeContracts([]);
  const cached = _contractCache.get(battleId);
  if (cached && Date.now() - cached.ts < CONTRACT_TTL) return cached.data;
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

export function bountySectionHtml(b) {
  const a = b?.attacker || {};
  const d = b?.defender || {};
  const atkPerK = a.moneyPer1kDamages ?? b.attackerMoneyPer1kDamages;
  const defPerK = d.moneyPer1kDamages ?? b.defenderMoneyPer1kDamages;
  const atkPool = a.moneyPool ?? b.attackerMoneyPool;
  const defPool = d.moneyPool ?? b.defenderMoneyPool;
  const atkEff = a.bountyEffectiveAt ?? b.attackerBountyEffectiveAt;
  const defEff = d.bountyEffectiveAt ?? b.defenderBountyEffectiveAt;
  const atkName = nameCountry(b.attacker?.country || b.attackerCountry || b.attacker?.countryId) || "Attacker";
  const defName = nameCountry(b.defender?.country || b.defenderCountry || b.defender?.countryId) || "Defender";
  const hasAny = atkPerK != null || defPerK != null || atkPool != null || defPool != null;
  if (!hasAny) return "";

  function sideCell(name, perK, pool, eff) {
    const perKStr = perK != null ? `$${Number(perK)} / 1k DMG` : "—";
    const poolStr = pool != null ? fmtMoney(pool) : "—";
    const effStr = eff ? fmtDate(eff) : "";
    return `<td style="vertical-align:top;padding:6px">
      <div style="font-weight:800;font-size:.78rem">${escapeHtml(name)}</div>
      <div style="font-size:.74rem;margin-top:3px">Per 1k DMG: <strong>${perKStr}</strong></div>
      <div style="font-size:.74rem">Pool: <strong>${poolStr}</strong></div>
      ${effStr ? `<div style="font-size:.66rem;color:var(--ink-dim);margin-top:2px">Bounty since ${effStr}</div>` : ""}
    </td>`;
  }

  return `<div class="br-section">
    <h3 class="br-section-title">💰 Public Bounty</h3>
    <table class="rank-table"><thead>
      <tr><th style="color:var(--blue)">Attacker</th><th style="color:var(--red)">Defender</th></tr>
    </thead><tbody>
      <tr>${sideCell(atkName, atkPerK, atkPool, atkEff)}${sideCell(defName, defPerK, defPool, defEff)}</tr>
    </tbody></table>
  </div>`;
}

export function contractsSectionHtml(c, atkName, defName) {
  const total = c.items.length;
  if (!total) return "";
  const a = c.side.attacker;
  const d = c.side.defender;
  const atkLabel = atkName || "Attacker";
  const defLabel = defName || "Defender";

  const summaryCells = [
    `<div class="br-stat-box"><span class="br-stat-val">${total}</span><span class="br-stat-lbl">Contracts</span></div>`,
    `<div class="br-stat-box"><span class="br-stat-val">${fmtMoney(c.totalBudget)}</span><span class="br-stat-lbl">Total Budget</span></div>`,
    `<div class="br-stat-box"><span class="br-stat-val">${fmtMoney(c.totalPayout)}</span><span class="br-stat-lbl">Total Payout</span></div>`,
    `<div class="br-stat-box"><span class="br-stat-val">${c.won.length}</span><span class="br-stat-lbl">Won</span></div>`,
    `<div class="br-stat-box"><span class="br-stat-val">${c.active.length}</span><span class="br-stat-lbl">Active</span></div>`,
    `<div class="br-stat-box"><span class="br-stat-val">${c.expired.length}</span><span class="br-stat-lbl">No Bids</span></div>`,
  ];

  const sideRows = `
    <tr>
      <td style="color:var(--blue);font-weight:800">${escapeHtml(atkLabel)}</td>
      <td>${a.count}</td><td>${fmtMoney(a.budget)}</td><td>${fmtMoney(a.payout)}</td>
      <td style="color:var(--red);font-weight:800">${escapeHtml(defLabel)}</td>
      <td>${d.count}</td><td>${fmtMoney(d.budget)}</td><td>${fmtMoney(d.payout)}</td>
    </tr>`;

  const rows = c.items.slice(0, 30).map((x) => {
    const s = sideKey(x);
    const isDef = s === "defender";
    const sideName = isDef ? defLabel : atkLabel;
    return `<tr>
      <td style="${isDef ? "color:var(--red)" : "color:var(--blue)"};font-weight:800">${escapeHtml(sideName)}</td>
      <td>${fmtNum(Number(x.minimumDamage) || 0)}</td>
      <td>${fmtMoney(x.budget)}</td>
      <td>${Number.isFinite(Number(x.initialPerK)) ? Number(x.initialPerK) : "—"}</td>
      <td>${fmtMoney(x.currentPayout)}</td>
      <td>${statusLabel(x.status)}</td>
      <td>${contractWinnerHtml(x)}</td>
    </tr>`;
  }).join("");

  const more = c.items.length > 30 ? `<p style="font-size:.7rem;color:var(--ink-dim);margin:4px 0 0">Showing first 30 of ${c.items.length} contracts.</p>` : "";

  return `<div class="br-section">
    <h3 class="br-section-title">🤝 Mercenary Contracts</h3>
    <div class="br-stats-grid" style="margin-bottom:8px">${summaryCells.join("")}</div>
    <table class="rank-table"><thead>
      <tr><th colspan="4" style="color:var(--blue)">ATTACKER</th><th colspan="4" style="color:var(--red)">DEFENDER</th></tr>
      <tr><th>Side</th><th>Contracts</th><th>Budget</th><th>Payout</th><th>Side</th><th>Contracts</th><th>Budget</th><th>Payout</th></tr>
    </thead><tbody>${sideRows}</tbody></table>
    <table class="rank-table" style="margin-top:8px"><thead>
      <tr><th>Side</th><th>Min DMG</th><th>Budget</th><th>Per K</th><th>Payout</th><th>Status</th><th>Winner / Top Bid</th></tr>
    </thead><tbody>${rows}</tbody></table>
    ${more}
  </div>`;
}

export function bountyAndContractsSectionHtml(b, contracts) {
  const atkName = nameCountry(b.attacker?.country || b.attackerCountry || b.attacker?.countryId);
  const defName = nameCountry(b.defender?.country || b.defenderCountry || b.defender?.countryId);
  return bountySectionHtml(b) + contractsSectionHtml(contracts, atkName, defName);
}
