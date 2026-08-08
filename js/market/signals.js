// signals.js — live commodity signal engine + composite market index.
// Port of the market-sig analysis engine, recomputed client-side every cycle
// from live order books + prices + cached 30-day daily history (no cron / server).
//   score      = 0.30·trend + 0.20·rsi + 0.18·imbalance + 0.22·volume + 0.10·intraday
//   confidence = 0.45·liquidity + 0.25·agreement + 0.30·historyQuality
// Levels: >=+0.55 Strong Buy | >=+0.25 Buy | >=+0.08 Accumulate | ±0.08 Hold |
//         <=-0.08 Reduce | <=-0.25 Sell | <=-0.55 Strong Sell

import { S } from "../core/state.js";
import { marketItemName } from "../core/utils.js";

export const SIGNAL_LEVELS = [
  { min: 0.55, key: "strongBuy",  name: "Strong Buy" },
  { min: 0.25, key: "buy",        name: "Buy" },
  { min: 0.08, key: "accumulate", name: "Accumulate" },
  { min: -0.08, key: "hold",      name: "Hold" },
  { min: -0.25, key: "reduce",    name: "Reduce" },
  { min: -0.55, key: "sell",      name: "Sell" },
  { min: -Infinity, key: "strongSell", name: "Strong Sell" },
];

export function signalOf(score) {
  if (!isFinite(score)) return { key: "hold", name: "Hold" };
  for (const l of SIGNAL_LEVELS) if (score >= l.min) return l;
  return SIGNAL_LEVELS[SIGNAL_LEVELS.length - 1];
}

function clamp(v, lo = -1, hi = 1) { return Math.max(lo, Math.min(hi, v)); }
function sma(arr, n) { if (arr.length < n) return null; return arr.slice(-n).reduce((a, b) => a + b, 0) / n; }
function ema(arr, n) {
  if (arr.length < n) return null;
  const k = 2 / (n + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}
function rsi(arr, n = 14) {
  if (arr.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = arr[i] - arr[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / n, avgL = loss / n;
  for (let i = n + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
    avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}
function roc(arr, n) {
  if (arr.length < n + 1) return null;
  const prev = arr[arr.length - 1 - n];
  if (!(prev > 0)) return null;
  return (arr[arr.length - 1] - prev) / prev;
}
function volRatio(closes, n = 3, m = 14) {
  if (closes.length < Math.max(n, m)) return 1;
  const a = closes.slice(-n).reduce((s, v) => s + v, 0) / n;
  const b = closes.slice(-m).reduce((s, v) => s + v, 0) / m;
  return b > 0 ? a / b : 1;
}
function stdev(arr) {
  if (!arr.length) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length);
}
function liquidityScore(book) {
  if (!book || !book.mid) return 0;
  const spreadPct = (book.spreadPct ?? 0) * 100;
  const spreadScore = clamp(1 - spreadPct / 8, 0, 1);
  const depthScore = clamp(Math.log10(1 + (book.depthMoney ?? 0)) / 4.5, 0, 1);
  const volumeScore = clamp(Math.log10(1 + (book.volume3d ?? 0)) / 4.5, 0, 1);
  return 0.5 * spreadScore + 0.3 * depthScore + 0.2 * volumeScore;
}

// Order book per item code from the live commodity order feed.
export function computeItemBooks() {
  const books = new Map();
  for (const o of S.market.commodityOrders || []) {
    const code = o._itemCode || o.itemCode || o.item;
    if (!code) continue;
    const side = (o._side || o.orderType || o.type || o.side || "").toUpperCase();
    const price = Number(o._price ?? o.pricePerUnit ?? o.unitPrice ?? 0);
    const qty = Number(o._qty ?? o.quantity ?? o.amount ?? 0);
    if (!(price > 0) || !(qty > 0)) continue;
    let b = books.get(code);
    if (!b) {
      b = { code, bestBid: 0, bestAsk: Infinity, bidQty: 0, askQty: 0, bidMoney: 0, askMoney: 0 };
      books.set(code, b);
    }
    if (side === "BUY") {
      if (price > b.bestBid) b.bestBid = price;
      b.bidQty += qty; b.bidMoney += qty * price;
    } else if (side === "SELL") {
      if (price < b.bestAsk) b.bestAsk = price;
      b.askQty += qty; b.askMoney += qty * price;
    }
  }
  for (const b of books.values()) {
    b.bestAsk = b.bestAsk === Infinity ? null : b.bestAsk;
    b.mid = (b.bestBid > 0 && b.bestAsk != null) ? (b.bestBid + b.bestAsk) / 2 : (b.bestBid > 0 ? b.bestBid : null);
    b.spread = (b.bestBid > 0 && b.bestAsk != null) ? b.bestAsk - b.bestBid : null;
    b.spreadPct = b.mid ? (b.spread ?? 0) / b.mid : null;
    const tot = b.bidQty + b.askQty;
    b.imbalance = tot > 0 ? (b.bidQty - b.askQty) / tot : 0;
    b.depth = tot;
    b.depthMoney = b.bidMoney + b.askMoney;
  }
  S.market.itemBooks = books;
  return books;
}

// Single-commodity signal, computed from live price + book + 30-day closes.
export function computeItemSignal(code, price, book) {
  const hist = S.market.itemHistories.get(code);
  const closes = hist ? hist.values.map(v => v.avg) : [];
  const prevMid = S.market.prevMids.get(code);
  S.market.prevMids.set(code, price);

  // trend from daily closes (SMA5/10/20 position + ROC5/10)
  let trend = 0;
  if (closes.length >= 5) {
    const pos = n => {
      const m = sma(closes, n);
      return m ? clamp(((price - m) / m) * 8) : 0;
    };
    const maScore = (pos(5) + pos(10) + pos(20)) / 3;
    const r5 = clamp((roc(closes, 5) ?? 0) * 6);
    const r10 = clamp((roc(closes, 10) ?? 0) * 4);
    trend = clamp(0.4 * maScore + 0.3 * r5 + 0.3 * r10);
  }

  // RSI(14) blended toward mean-reversion (buy-the-dip bias)
  let rsiScore = 0, rsiVal = null;
  const r = rsi(closes, 14);
  if (r != null) {
    rsiVal = r;
    rsiScore = clamp(0.45 * ((r - 50) / 50) + 0.55 * ((50 - r) / 40));
  }

  // live order-book imbalance
  const imb = clamp((book?.imbalance ?? 0) * 1.4);

  // volume agreement with trend (3d vs 14d daily qty)
  const qtys = hist ? hist.values.map(v => v.qty) : [];
  let volume = 0;
  if (qtys.length >= 5) {
    const vr = volRatio(qtys, 3, 14);
    volume = trend >= 0
      ? clamp(trend * (0.55 + 0.45 * vr))
      : clamp(trend * (0.55 + 0.45 * (2 - Math.min(2, vr))));
  }

  // intraday: move since previous snapshot mid
  const intraday = (prevMid != null && prevMid > 0)
    ? clamp(((price - prevMid) / prevMid) * 12)
    : 0;

  const score = clamp(0.30 * trend + 0.20 * rsiScore + 0.18 * imb + 0.22 * volume + 0.10 * intraday);
  const level = signalOf(score);

  // confidence
  const liq = liquidityScore(book);
  const comps = [trend, rsiScore, imb, volume];
  const agreement = clamp(1 - stdev(comps) / 0.75, 0, 1);
  const historyQuality = (Math.min(1, closes.length / 20) * 0.7) + (rsiVal != null ? 0.3 : 0);
  const confidence = clamp(0.45 * liq + 0.25 * agreement + 0.30 * historyQuality, 0, 1);

  return {
    code, price, level, score, confidence, rsi: rsiVal,
    components: { trend, rsi: rsiScore, imbalance: imb, volume, intraday },
    liquidity: liq, history: closes.length, book,
  };
}

// Compute signals for all priced items that have history.
export function computeMarketSignals() {
  const books = computeItemBooks();
  const signals = new Map();
  for (const p of S.market.prices || []) {
    const code = p.itemCode || p.item || p.name;
    if (!code || !S.market.itemHistories.has(code)) continue;
    const price = Number(p.price ?? p.value ?? 0);
    if (!(price > 0)) continue;
    signals.set(code, computeItemSignal(code, price, books.get(code)));
  }
  S.market.signals = signals;
  return signals;
}

// ── Composite market index (geometric chain) ────────────────────────────────
// daily: seed 100 on first common date, chain exp(mean(ln(v_t / v_{t-1})))
// across all commodities present on both days.
export function computeCompositeIndex() {
  const items = [...S.market.itemHistories.entries()].filter(([, h]) => h.values.length >= 2);
  if (!items.length) return null;

  // date → Map(code → avg)
  const byDate = new Map();
  for (const [code, h] of items) {
    for (const v of h.values) {
      const d = v.date;
      if (!byDate.has(d)) byDate.set(d, new Map());
      byDate.get(d).set(code, v.avg);
    }
  }
  const dates = [...byDate.keys()].sort();
  let idx = 100;
  const daily = [];
  for (let i = 0; i < dates.length; i++) {
    if (i === 0) { daily.push({ t: new Date(dates[0]).getTime(), value: idx }); continue; }
    const prev = byDate.get(dates[i - 1]);
    const cur = byDate.get(dates[i]);
    const logs = [];
    for (const [code, v] of cur) {
      const pv = prev.get(code);
      if (pv != null && pv > 0 && v > 0) logs.push(Math.log(v / pv));
    }
    if (logs.length) idx = idx * Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length);
    daily.push({ t: new Date(dates[i]).getTime(), value: idx });
  }

  // intraday: chain live price vs last daily close onto the last daily index
  const intraday = [];
  const lastDaily = daily[daily.length - 1];
  const lastDate = byDate.get(dates[dates.length - 1]);
  if (lastDaily && lastDate) {
    const logs = [];
    for (const p of S.market.prices || []) {
      const code = p.itemCode || p.item || p.name;
      const prev = lastDate.get(code);
      if (prev != null && prev > 0) {
        const price = Number(p.price ?? p.value ?? 0);
        if (price > 0) logs.push(Math.log(price / prev));
      }
    }
    if (logs.length) {
      const nowVal = lastDaily.value * Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length);
      intraday.push({ t: lastDaily.t, value: lastDaily.value }, { t: Date.now(), value: nowVal });
    }
  }

  const index = { daily, intraday };
  S.market.compositeIndex = index;
  return index;
}

export function indexTrend() {
  const idx = S.market.compositeIndex;
  if (!idx || !idx.daily.length) return 0;
  const d = idx.daily;
  const a = d[d.length - 1].value, b = d[Math.max(0, d.length - 8)].value;
  return b > 0 ? ((a - b) / b) * 100 : 0;
}

export function itemLabel(code) { return marketItemName(code); }
