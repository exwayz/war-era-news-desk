// itemHistory.js — 30-day daily market history per commodity.
// Source: api2 `itemTrading.getItemTrading` (X-API-Key) → daily aggregates.
// Cached in S.market.itemHistories with a TTL; lazy + prefetchable.

import { S } from "../core/state.js";
import { apiKey, fetchTrpcApi2, unwrap } from "../core/api.js";

const TTL_MS = 30 * 60 * 1000;

function normalize(raw, code) {
  if (!raw || !Array.isArray(raw.values)) return null;
  const values = raw.values.map(v => ({
    t: new Date(v.valueAt).getTime(),
    date: v.valueAt,
    avg: Number(v.avgValue ?? v.avg ?? 0),
    value: Number(v.totalValue ?? v.value ?? 0),
    qty: Number(v.totalQuantity ?? v.quantity ?? 0),
    txns: Number(v.transactionsCount ?? v.txns ?? 0),
  })).filter(v => isFinite(v.t) && isFinite(v.avg) && v.avg > 0);
  if (!values.length) return null;
  values.sort((a, b) => a.t - b.t);
  return {
    code,
    min: Number(raw.minPrice ?? 0),
    max: Number(raw.maxPrice ?? 0),
    current: Number(raw.currentValue ?? 0) || values[values.length - 1].avg,
    values,
    fetchedAt: Date.now(),
  };
}

export async function fetchItemHistory(code, force = false) {
  const k = apiKey();
  if (!k || !code) return null;
  const cached = S.market.itemHistories.get(code);
  if (cached && !force && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  try {
    const r = await fetchTrpcApi2("itemTrading.getItemTrading", { itemCode: code }, k);
    const raw = unwrap(r);
    const hist = normalize(raw, code);
    if (hist) S.market.itemHistories.set(code, hist);
    return hist;
  } catch {
    return cached || null;
  }
}

export function getItemHistory(code) {
  const h = S.market.itemHistories.get(code);
  if (!h || Date.now() - h.fetchedAt > TTL_MS) return null;
  return h;
}

// Prefetch histories for a list of codes with bounded concurrency.
export async function ensureHistories(codes, { concurrency = 6, force = false } = {}) {
  const jobs = [...new Set((codes || []).filter(Boolean))];
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const code = jobs[idx++];
      const h = getItemHistory(code);
      if (h && !force) { results.push(h); continue; }
      results.push(await fetchItemHistory(code, force));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results.filter(Boolean);
}

export function clearItemHistories() { S.market.itemHistories.clear(); }
