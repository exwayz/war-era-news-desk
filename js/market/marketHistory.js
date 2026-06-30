import { S } from "../core/state.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../core/constants.js";
import { calculateAnalytics } from "./analytics.js";

const TABLE = "market_snapshots";
const RETENTION_MS = 7 * 24 * 3600000;

function headers() {
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  };
}

function push(arr, val) { if (isFinite(val)) { arr.push(val); if (arr.length > 48) arr.shift(); } }

function last(arr) { return arr && arr.length > 0 ? arr[arr.length - 1] : null; }

export async function storeMarketSnapshot() {
  const a = calculateAnalytics();
  const prices = S.market.prices || [];
  const pi = prices.length ? prices.slice(0, 10).reduce((s, i) => s + Number(i.price || i.value || 0), 0) / Math.min(10, prices.length) : 0;
  const snapshot = {
    topValuable: (S.market.topValuable || []).map(i => ({ item: i.item, value: i.value })),
    econ: S.market.econ ? {
      totalPayroll: S.market.econ.totalPayroll, tradeVol: S.market.econ.tradeVol,
      avgWage: S.market.econ.avgWage, wageCount: S.market.econ.wageCount, tradeCount: S.market.econ.tradeCount,
    } : null,
    analytics: a.p ? { p: a.p, d: a.d } : null,
    priceIndex: { t: Date.now(), i: pi },
  };
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?created_at=lt.${cutoff}`, {
      method: "DELETE", headers: headers(),
    });
  } catch {}

  // Deduplicate: skip insert if a snapshot already exists in the last 10s
  try {
    const recentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?select=id&order=created_at.desc&limit=1`,
      { headers: headers() }
    );
    if (recentRes.ok) {
      const recent = await recentRes.json();
      if (recent.length === 1) {
        const age = Date.now() - new Date(recent[0].created_at).getTime();
        if (age < 10000) return; // skip — another user already stored this cycle
      }
    }
  } catch {}

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: { ...headers(), "Prefer": "return=minimal" },
      body: JSON.stringify({ snapshot }),
    });
    if (!r.ok) console.warn("[supabase] store snapshot:", r.status);
  } catch (e) { console.error("[supabase] store snapshot failed:", e); }
}

export async function loadSupabaseHistory(limit = 15) {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?created_at=gte.${cutoff}&order=created_at.desc&limit=${limit}`,
      { headers: headers() }
    );
    if (!res.ok) return;
    const rows = await res.json();
    const snapshots = rows.map(r => r.snapshot);
    S.market._supabaseHistory = snapshots;

    // Save current cycle entries (pushed by updateHistories / hourly data)
    const cur = {
      tradeVol: last(S.market.tradeVolHistory),
      payroll: last(S.market.payrollHistory),
      pp: last(S.market.ppHistory),
      hhi: last(S.market.hhiHistory),
      circulation: last(S.market.circulationHistory),
      tradeEfficiency: last(S.market.tradeEfficiencyHistory),
      basket: last(S.market.basketHistory),
      wage: last(S.market.wageHistory),
      price: last(S.market.priceHistory),
    };

    // Clear all
    for (const k of ["tradeVolHistory","payrollHistory","ppHistory","hhiHistory","circulationHistory","tradeEfficiencyHistory","basketHistory","wageHistory","priceHistory"]) {
      S.market[k] = [];
    }

    // Reconstruct from stored snapshots (oldest first)
    const prevs = [...snapshots].reverse();
    for (const s of prevs) {
      if (s.analytics && s.analytics.p) {
        const p = s.analytics.p, d = s.analytics.d;
        push(S.market.tradeVolHistory, p.Tv);
        push(S.market.payrollHistory, p.P);
        if (d) {
          if (d.pp != null) push(S.market.ppHistory, d.pp);
          if (d.hhi != null) push(S.market.hhiHistory, d.hhi);
          if (d.circulation != null) push(S.market.circulationHistory, d.circulation);
          if (d.tradeEfficiency != null) push(S.market.tradeEfficiencyHistory, d.tradeEfficiency);
        }
        if (p.Basket > 0) push(S.market.basketHistory, p.Basket);
      }
      if (s.econ && s.econ.avgWage != null) {
        S.market.wageHistory.push({ avg: s.econ.avgWage });
        if (S.market.wageHistory.length > 48) S.market.wageHistory.shift();
      }
      if (s.priceIndex && s.priceIndex.i > 0) {
        S.market.priceHistory.push(s.priceIndex);
        if (S.market.priceHistory.length > 48) S.market.priceHistory.shift();
      }
    }

    // Re-apply current cycle data (so momentum isn't lost for one cycle)
    if (cur.tradeVol != null) push(S.market.tradeVolHistory, cur.tradeVol);
    if (cur.payroll != null) push(S.market.payrollHistory, cur.payroll);
    if (cur.pp != null) push(S.market.ppHistory, cur.pp);
    if (cur.hhi != null) push(S.market.hhiHistory, cur.hhi);
    if (cur.circulation != null) push(S.market.circulationHistory, cur.circulation);
    if (cur.tradeEfficiency != null) push(S.market.tradeEfficiencyHistory, cur.tradeEfficiency);
    if (cur.basket != null) push(S.market.basketHistory, cur.basket);
    if (cur.wage) { S.market.wageHistory.push(cur.wage); if (S.market.wageHistory.length > 48) S.market.wageHistory.shift(); }
    if (cur.price) { S.market.priceHistory.push(cur.price); if (S.market.priceHistory.length > 48) S.market.priceHistory.shift(); }
  } catch {}
}

export async function loadWeeklyMVI() {
  const weekAgo = new Date(Date.now() - RETENTION_MS).toISOString();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?created_at=gte.${weekAgo}&order=created_at.desc&limit=2000`,
      { headers: headers() }
    );
    if (!res.ok) return;
    const rows = await res.json();
    const acc = {};
    let count = 0;
    for (const row of rows) {
      const tv = row.snapshot?.topValuable;
      if (!Array.isArray(tv)) continue;
      count++;
      for (const entry of tv) {
        if (!entry.item || !entry.value) continue;
        if (!acc[entry.item]) acc[entry.item] = 0;
        acc[entry.item] += Number(entry.value);
      }
    }
    if (count < 10) return;
    const sorted = Object.entries(acc)
      .map(([item, value]) => ({ item, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
    S.market._weeklyMVI = sorted;
  } catch {}
}
