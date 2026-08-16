// renderSignals.js — Signals market view + commodity intelligence modal.
// Renders the composite market index chart, the ranked signal table, and a
// per-commodity detail modal (30-day price + SMA overlay, volume, order book,
// signal component breakdown, recent trades). No chart library — inline SVG.

import { S } from "../core/state.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtMoney, marketItemName, formatShortNumber, entityDisplayName, escapeHtml } from "../core/utils.js";
import { resolveEntityByType } from "../core/resolver.js";
import { ensureHistories, getItemHistory, fetchItemHistory } from "./itemHistory.js";
import {
  computeMarketSignals, computeCompositeIndex, computeItemSignal,
  indexTrend, signalOf,
} from "./signals.js";

const LEVEL_COLOR = {
  strongBuy: "var(--green)", buy: "var(--green)", accumulate: "var(--green)",
  hold: "var(--accent)", reduce: "var(--orange)", sell: "var(--red)", strongSell: "var(--red)",
};

// Reference material shown when hovering a signal badge — what the level means,
// the math/logic behind the score band, and the indicator concepts used.
const SIGNAL_REFERENCE = {
  strongBuy: {
    name: "Strong Buy", min: 0.55, max: 1.0,
    what: "Extremely underpriced. The commodity is trading far below its recent norm — well under its 5/10/20-day moving averages, deeply oversold, and below the previous snapshot.",
    math: "Score ≥ +0.55, driven by all five components reading strongly positive: price far below its moving averages, steeply negative ROC, RSI deep in the oversold zone, price below the previous snapshot, and ask-side pressure on the book.",
    logic: "Mean reversion: after a sharp selloff the market typically snaps back toward its average. The deeper the discount, the stronger the expected bounce — so the tool rates this as the best value entry.",
    ref: "RSI oversold band (<30), Wilder's RSI, price vs SMA discount, contrarian/mean-reversion trading.",
  },
  buy: {
    name: "Buy", min: 0.25, max: 0.55,
    what: "Underpriced. The commodity is trading below its recent averages with momentum pointing down — a solid entry zone rather than an extreme dip.",
    math: "Score between +0.25 and +0.55: price sits noticeably under its moving averages, short-term ROC is negative, RSI is under 50, and at least one more component (book imbalance or intraday dip) confirms.",
    logic: "Same mean-reversion idea as Strong Buy but with a milder discount — still a good moment to buy, with a slightly smaller expected rebound.",
    ref: "RSI <50, price below SMA, negative rate of change (ROC), mean reversion.",
  },
  accumulate: {
    name: "Accumulate", min: 0.08, max: 0.25,
    what: "Mildly underpriced. Price is modestly below its recent average — enough to start building a position, but without all components aligned yet.",
    math: "Score between +0.08 and +0.25: trend, RSI and/or intraday are positive but only mildly so, and some components may still be neutral or negative.",
    logic: "Scaling-in signal: buy in tranches rather than a single large entry, because the discount is real but not extreme and the pullback may deepen further.",
    ref: "Contrarian accumulation / position scaling, RSI just under 50.",
  },
  hold: {
    name: "Hold", min: -0.08, max: 0.08,
    what: "Fairly priced. Price is essentially at its recent average with momentum balanced — no edge in either direction.",
    math: "Score between -0.08 and +0.08: positive and negative components roughly cancel out (price near SMA, RSI near 50, balanced book).",
    logic: "Neutral zone. Neither buyers nor sellers have a statistical advantage at this price, so the tool recommends standing pat.",
    ref: "Fair value / mean, RSI ≈ 50, no divergence from the moving average.",
  },
  reduce: {
    name: "Reduce", min: -0.25, max: -0.08,
    what: "Mildly overpriced. Price is modestly above its recent average — worth trimming a portion of holdings and taking some profit.",
    math: "Score between -0.25 and -0.08: price slightly above its moving averages, ROC slightly positive, RSI above 50, with only partial confirmation.",
    logic: "Profit-taking signal: the commodity is a bit richer than its norm, so lightening the position protects gains while leaving room if the trend continues.",
    ref: "Profit-taking / scaling out, RSI just above 50.",
  },
  sell: {
    name: "Sell", min: -0.55, max: -0.25,
    what: "Overpriced. The commodity is trading above its recent norm with momentum pointing up — an exit zone.",
    math: "Score between -0.55 and -0.25: price well above its moving averages, positive ROC, RSI over 50, with confirming pressure from book imbalance or intraday strength.",
    logic: "Mean reversion to the downside: the price has run ahead of its fair value and is statistically likely to pull back — better to sell into strength.",
    ref: "RSI >50, price above SMA, positive rate of change (ROC), mean reversion.",
  },
  strongSell: {
    name: "Strong Sell", min: -1.0, max: -0.55,
    what: "Extremely overpriced. Price is far above its recent norm — well over its moving averages, deeply overbought, and above the previous snapshot.",
    math: "Score ≤ -0.55: all five components read strongly negative — price far above its moving averages, steeply positive ROC, RSI deep in the overbought zone, price above the previous snapshot, and bid-side pressure inflating the book.",
    logic: "Distribution signal: the market has run far ahead of fair value and the statistical pullback risk is highest here — the tool rates this as the best moment to exit or short.",
    ref: "RSI overbought band (>70), Wilder's RSI, price vs SMA premium, overbought distribution.",
  },
};

let _tipEl = null;
let _tipTarget = null;

function tipEl() {
  if (!_tipEl) {
    _tipEl = document.createElement("div");
    _tipEl.className = "sig-tooltip";
    _tipEl.hidden = true;
    document.body.appendChild(_tipEl);
  }
  return _tipEl;
}

function signalTooltipHTML(key, sig) {
  const ref = SIGNAL_REFERENCE[key] || SIGNAL_REFERENCE.hold;
  const color = LEVEL_COLOR[key] || "var(--ink)";
  const fmt = v => (v >= 0 ? "+" : "") + v.toFixed(3);
  const comps = sig && sig.components ? [
    ["Trend", sig.components.trend, 0.30],
    ["RSI", sig.components.rsi, 0.20],
    ["Imbalance", sig.components.imbalance, 0.18],
    ["Volume", sig.components.volume, 0.22],
    ["Intraday", sig.components.intraday, 0.10],
  ] : null;
  const compRows = comps ? comps.map(([lbl, v, w]) => `
      <div class="st-comp">
        <span>${lbl}</span>
        <span class="st-comp-bar"><i style="width:${Math.round(Math.abs(v) * 100)}%;left:${v >= 0 ? "50%" : "50%"};transform:${v >= 0 ? "translateX(0)" : "translateX(-100%)"}"></i></span>
        <span style="font-family:var(--font-mono)">${fmt(v)}</span>
        <span style="color:var(--ink-dim);font-family:var(--font-mono)">×${w.toFixed(2)} = ${fmt(v * w)}</span>
      </div>`).join("") : "";
  const fmtBand = v => (v >= 0 ? "+" : "") + v.toFixed(2);
  const band = `${fmtBand(ref.min)} → ${fmtBand(ref.max)}`;
  return `
    <div class="st-head"><span class="st-name" style="color:${color};border-color:${color}">${ref.name}</span>
      <span class="st-band">score ${band}</span></div>
    <div class="st-what">${ref.what}</div>
    <div class="st-label">Math &amp; logic</div>
    <div class="st-math">${ref.math}</div>
    <div class="st-label">Why it says so here</div>
    <div class="st-comps">
      <div class="st-comp st-comp-head"><span>Component</span><span style="text-align:center">Value</span><span>Weight → contribution</span></div>
      ${compRows}
      <div class="st-comp st-comp-total"><span>Score</span><span></span><span style="font-family:var(--font-mono);text-align:right">${sig ? fmt(sig.score) : "—"}</span></div>
    </div>
    <div class="st-label">Reference</div>
    <div class="st-ref">${ref.ref}</div>`;
}

function showSignalTip(target, sig) {
  const key = target.dataset.signalKey;
  if (!key) return;
  const el = tipEl();
  el.innerHTML = signalTooltipHTML(key, sig);
  el.hidden = false;
  _tipTarget = target;
  positionTip(target);
}

function positionTip(target) {
  const el = tipEl();
  if (!el || el.hidden) return;
  const r = target.getBoundingClientRect();
  const tw = el.offsetWidth, th = el.offsetHeight;
  const pad = 10, m = 8;
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = document.documentElement.clientHeight || innerHeight;

  // Horizontal: prefer aligning left with the badge; if that would overflow
  // the right edge, shift left; always clamp inside the viewport.
  let x = r.left;
  if (x + tw > vw - pad) x = r.right - tw;
  x = Math.max(pad, Math.min(x, vw - tw - pad));

  // Vertical: prefer below the badge; if the tooltip is taller than the space
  // below, flip above; if it can't fit either side, pick the side with more
  // room; always clamp so the whole tooltip stays readable.
  let y;
  const spaceBelow = vh - r.bottom - m;
  const spaceAbove = r.top - m;
  if (th <= spaceBelow) {
    y = r.bottom + m;
  } else if (th <= spaceAbove) {
    y = r.top - th - m;
  } else if (spaceBelow >= spaceAbove) {
    y = r.bottom + m;
  } else {
    y = r.top - th - m;
  }
  y = Math.max(pad, Math.min(y, vh - th - pad));

  el.style.left = Math.round(x) + "px";
  el.style.top = Math.round(y) + "px";
}

function hideSignalTip() {
  _tipTarget = null;
  const el = tipEl();
  el.hidden = true;
}

// Delegated hover for signal badges in the table + dossier modal.
document.addEventListener("mouseover", e => {
  const b = e.target.closest("[data-signal-key]");
  if (b) {
    const row = b.closest("[data-commodity-code]");
    const code = row ? row.dataset.commodityCode : (_modalCode || "");
    const sig = code ? S.market.signals.get(code) : null;
    showSignalTip(b, sig);
  }
});
document.addEventListener("mousemove", e => {
  if (_tipTarget && !tipEl().hidden) {
    const b = e.target.closest("[data-signal-key]");
    if (b) positionTip(b);
  }
});
document.addEventListener("mouseout", e => {
  if (!_tipTarget) return;
  const t = e.target;
  if (!t || typeof t.closest !== "function" || !t.closest("[data-signal-key]")) hideSignalTip();
});

function livePrice(code) {
  const p = (S.market.prices || []).find(i => (i.itemCode || i.item || i.name) === code);
  return p ? Number(p.price || p.value || 0) : 0;
}

function pctChange(closes, n) {
  if (closes.length < n + 1) return null;
  const prev = closes[closes.length - 1 - n];
  if (!(prev > 0)) return null;
  return ((closes[closes.length - 1] - prev) / prev) * 100;
}

function fmtPct(v, digits = 1) {
  if (v == null || !isFinite(v)) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(digits) + "%";
}

// ── Composite index chart (daily + intraday chain) ──────────────────────────
function indexSVG() {
  const idx = S.market.compositeIndex;
  if (!idx) return '<p style="color:var(--ink-dim);padding:12px">Index not available yet.</p>';
  const points = [...idx.daily.map(d => ({ t: d.t, v: d.value }))];
  const intra = idx.intraday || [];
  if (intra.length >= 2) points.push({ t: intra[intra.length - 1].t, v: intra[intra.length - 1].value });
  if (points.length < 2) return '<p style="color:var(--ink-dim);padding:12px">Not enough history to chart the index.</p>';
  const W = 900, H = 150, pad = 10;
  const mn = Math.min(...points.map(p => p.v)), mx = Math.max(...points.map(p => p.v));
  const rng = mx - mn || 1;
  const t0 = points[0].t, t1 = points[points.length - 1].t, tr = (t1 - t0) || 1;
  const X = i => pad + ((points[i].t - t0) / tr) * (W - pad * 2);
  const Y = v => H - pad - ((v - mn) / rng) * (H - pad * 2);
  let grid = "";
  for (let g = 1; g < 5; g++) {
    const gy = pad + (g / 5) * (H - pad * 2);
    grid += `<line x1="${pad}" y1="${gy.toFixed(1)}" x2="${W - pad}" y2="${gy.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
  }
  const pts = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`);
  const area = `M${pts[0]} ${pts.slice(1).map(p => "L" + p).join(" ")} L${W - pad},${H - pad} L${pad},${H - pad} Z`;
  const last = pts[pts.length - 1].split(",");
  return `<svg viewBox="0 0 ${W} ${H}" class="exec-chart-svg">
    ${grid}
    <defs><linearGradient id="ixgrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--blue)" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="var(--blue)" stop-opacity="0.02"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#ixgrad)"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="var(--blue)" stroke-width="1.5"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="var(--blue)"/>
  </svg>`;
}

// ── Signals view HTML ───────────────────────────────────────────────────────
function signalsHTML() {
  const idx = S.market.compositeIndex;
  const idxVal = idx && idx.daily.length ? idx.daily[idx.daily.length - 1].value : null;
  const trend = indexTrend();
  const signals = [...(S.market.signals || new Map()).values()].sort((a, b) => b.score - a.score);

  const head = `<div class="sig-row sig-head">
    <span class="sig-name">Commodity</span>
    <span class="sig-price">Price</span>
    <span class="sig-chg">1D</span>
    <span class="sig-chg">7D</span>
    <span class="sig-num">RSI</span>
    <span class="sig-num">Spread</span>
    <span class="sig-num">Imbal.</span>
    <span class="sig-badge">Signal</span>
    <span class="sig-num">Confidence</span>
    <span class="sig-num">Score</span>
  </div>`;

  const rows = signals.map(s => {
    const hist = getItemHistory(s.code);
    const closes = hist ? hist.values.map(v => v.avg) : [];
    const d1 = pctChange(closes, 1), d7 = pctChange(closes, 7);
    const spr = s.book && s.book.spreadPct != null ? s.book.spreadPct * 100 : null;
    const imb = s.book && s.book.imbalance != null ? s.book.imbalance * 100 : null;
    const color = LEVEL_COLOR[s.level.key] || "var(--ink)";
    const conf = Math.round(s.confidence * 100);
    return `<div class="sig-row" data-commodity-code="${s.code}">
      <span class="sig-name" data-l="Commodity">${marketItemName(s.code)}</span>
      <span class="sig-price" data-l="Price">${fmtMoney(s.price)}</span>
      <span class="sig-chg ${d1 > 0 ? "up" : d1 < 0 ? "down" : ""}" data-l="1D">${fmtPct(d1)}</span>
      <span class="sig-chg ${d7 > 0 ? "up" : d7 < 0 ? "down" : ""}" data-l="7D">${fmtPct(d7)}</span>
      <span class="sig-num" data-l="RSI">${s.rsi != null ? s.rsi.toFixed(0) : "—"}</span>
      <span class="sig-num" data-l="Spread">${spr == null ? "—" : spr.toFixed(1) + "%"}</span>
      <span class="sig-num" data-l="Imbal.">${imb == null ? "—" : (imb > 0 ? "+" : "") + imb.toFixed(0) + "%"}</span>
      <span class="sig-badge" style="color:${color};border-color:${color}" data-signal-key="${s.level.key}" data-l="Signal">${s.level.name}</span>
      <span class="sig-conf" data-l="Confidence"><i style="width:${conf}%"></i></span>
      <span class="sig-num sig-score" data-l="Score">${s.score.toFixed(3)}</span>
    </div>`;
  }).join("");

  return `
    <div class="market-card signals-index-card">
      <div class="market-card-header">
        <span class="market-card-title">Composite Market Index</span>
        <span class="signals-idx-meta">
          <b style="color:var(--blue)">${idxVal != null ? idxVal.toFixed(2) : "—"}</b>
          <span class="${trend > 0 ? "up" : trend < 0 ? "down" : ""}">${fmtPct(trend)}</span>
          <span style="color:var(--ink-dim)">geometric chain, live</span>
        </span>
      </div>
      ${indexSVG()}
    </div>
    <div class="market-card signals-table-card">
      <div class="market-card-header">
        <span class="market-card-title">Commodity Signals</span>
        <span style="color:var(--ink-dim);font-size:.72rem">click a row for the intelligence dossier</span>
      </div>
      <div class="sig-table">${head}${rows || '<p style="color:var(--ink-dim);padding:12px">No signals computed yet.</p>'}</div>
    </div>`;
}

export async function renderSignalsView(section) {
  if (!section) return;
  section.innerHTML = '<p style="color:var(--ink-dim);padding:12px">Loading market signals…</p>';
  const codes = (S.market.prices || []).map(i => i.itemCode || i.item || i.name).filter(Boolean);
  await ensureHistories(codes, { concurrency: 6 });
  computeMarketSignals();
  computeCompositeIndex();
  section.innerHTML = signalsHTML();
}

// Cheap recompute (histories stay cached) — called on the 10s refresh.
export function refreshSignals() {
  if (!S.market.signals.size && !(S.market.compositeIndex)) return;
  computeMarketSignals();
  computeCompositeIndex();
  const section = document.querySelector(".signals-section");
  if (section && !section.hidden && section.offsetParent !== null) section.innerHTML = signalsHTML();
  if (_modalCode) renderCommodityModal(_modalCode, true);
}

// ── Commodity intelligence modal ────────────────────────────────────────────
let _modalCode = null;

function smaVals(closes, n) {
  if (closes.length < n) return null;
  return closes.map((_, i) => {
    if (i + 1 < n) return null;
    return closes.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n;
  });
}

function chartSVG(hist) {
  const vals = hist.values;
  const closes = vals.map(v => v.avg);
  const s5 = smaVals(closes, 5), s20 = smaVals(closes, 20);
  const W = 900, HP = 170, HV = 64, pad = 12;
  const mn = Math.min(...closes), mx = Math.max(...closes), rng = mx - mn || 1;
  const X = i => pad + (i / (vals.length - 1)) * (W - pad * 2);
  const Y = v => HP - pad - ((v - mn) / rng) * (HP - pad * 2);
  const line = arr => arr.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const line2 = arr => arr.map((v, i) => v == null ? "" : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).join(" ");
  const vmax = Math.max(...vals.map(v => v.qty)) || 1;
  const vbars = vals.map((v, i) => {
    const h = Math.max(2, (v.qty / vmax) * (HV - pad * 2));
    const x = X(i) - 8;
    return `<rect x="${x.toFixed(1)}" y="${(HV - h).toFixed(1)}" width="16" height="${h.toFixed(1)}" fill="var(--accent)" opacity="0.75"/>`;
  }).join("");
  let grid = "";
  for (let g = 1; g < 4; g++) {
    const gy = pad + (g / 4) * (HP - pad * 2);
    grid += `<line x1="${pad}" y1="${gy.toFixed(1)}" x2="${W - pad}" y2="${gy.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
  }
  const cpt = line(closes);
  const sp5 = s5 ? line2(s5) : "";
  const sp20 = s20 ? line2(s20) : "";
  const lastX = X(vals.length - 1);
  return `<svg viewBox="0 0 ${W} ${HP + HV + 20}" class="exec-chart-svg">
    <defs><linearGradient id="cmg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${grid}
    <path d="M${cpt} L${lastX.toFixed(1)},${HP - pad} L${pad},${HP - pad} Z" fill="url(#cmg)"/>
    ${sp20 ? `<polyline points="${sp20}" fill="none" stroke="var(--orange)" stroke-width="1.2"/>` : ""}
    ${sp5 ? `<polyline points="${sp5}" fill="none" stroke="var(--green)" stroke-width="1.2"/>` : ""}
    <polyline points="${cpt}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
    <line x1="${pad}" y1="${HP + 8}" x2="${W - pad}" y2="${HP + 8}" stroke="var(--line)" stroke-width="1"/>
    ${vbars}
  </svg>`;
}

async function loadRecentTrades(code) {
  const k = apiKey();
  if (!k) return [];
  try {
    const r = await fetchTrpc("transaction.getPaginatedTransactions", { limit: 25, transactionType: "trading" }, k);
    const d = unwrap(r);
    const items = Array.isArray(d) ? d : (d?.items || []);
    return items.filter(t => (t.itemCode || t.item) === code).slice(0, 8);
  } catch { return []; }
}

// Cache resolved trade-entity names (trade seller/buyer IDs are untyped and can
// be a user, MU, country or alliance, so each is probed in that order).
const _txEntityNames = new Map();
const TX_ENTITY_TYPES = ["user"];
const TX_RESOLVE_TIMEOUT = 6000;

function txResolveWithTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("resolve timeout")), ms)),
  ]);
}

async function resolveTxEntityName(id, k) {
  if (!id) return "";
  if (_txEntityNames.has(id)) return _txEntityNames.get(id);
  try {
    const name = await txResolveWithTimeout((async () => {
      for (const type of TX_ENTITY_TYPES) {
        const ent = await resolveEntityByType(type, id, k);
        if (ent) return entityDisplayName(type, id, ent);
      }
      return "";
    })(), TX_RESOLVE_TIMEOUT);
    _txEntityNames.set(id, name);
    return name;
  } catch {
    _txEntityNames.set(id, "");
    return "";
  }
}

// Fire-and-forget: never blocks rendering. Resolves each unique trade party ID
// (timeout-bounded) and patches the matching seller/buyer cells in place.
async function resolveTradeEntityNames(trades, k) {
  const ids = [...new Set(trades.flatMap(t => [t.sellerId, t.buyerId]).filter(Boolean))];
  await Promise.all(ids.map(async id => {
    const name = await resolveTxEntityName(id, k);
    if (!name) return;
    document.querySelectorAll(`[data-tx-seller="${id}"]`).forEach(el => { el.textContent = name; });
    document.querySelectorAll(`[data-tx-buyer="${id}"]`).forEach(el => { el.textContent = name; });
  }));
}

function fmtTxTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + " " +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

async function renderCommodityModal(code, keepBody = false) {
  const name = marketItemName(code);
  const title = document.getElementById("commodityModalTitle");
  const body = document.getElementById("commodityModalBody");
  if (title) title.innerHTML = `${name} <span style="color:var(--ink-dim);font-size:.7rem;font-weight:400">intelligence dossier</span>`;
  if (!body) return;
  const k = apiKey();

  const hist = await fetchItemHistory(code, !keepBody);
  if (!hist) {
    body.innerHTML = '<p style="color:var(--red)">No 30-day history available for this commodity.</p>';
    return;
  }

  const price = livePrice(code) || hist.current;
  const book = S.market.itemBooks.get(code);
  const sig = computeItemSignal(code, price, book);
  const color = LEVEL_COLOR[sig.level.key] || "var(--ink)";
  const closes = hist.values.map(v => v.avg);
  const d1 = pctChange(closes, 1), d7 = pctChange(closes, 7);
  const totalVol = hist.values.reduce((s, v) => s + v.qty, 0);
  const range = { mn: Math.min(...closes), mx: Math.max(...closes) };

  const trades = keepBody ? (S.market._recentTrades || []) : await loadRecentTrades(code);
  S.market._recentTrades = trades;
  const tradesHTML = trades.length ? trades.map(t => {
    const price2 = Number(t.money || 0) > 0 ? Number(t.money) / Math.max(1, Number(t.quantity || 1)) : 0;
    const seller = _txEntityNames.get(t.sellerId) || String(t.sellerId || "").slice(0, 8);
    const buyer = _txEntityNames.get(t.buyerId) || String(t.buyerId || "").slice(0, 8);
    return `<div class="cm-tx-row">
      <span>${fmtTxTime(t.createdAt || t.offerCreatedAt)}</span>
      <span><span data-tx-seller="${escapeHtml(t.sellerId || "")}">${escapeHtml(seller)}</span> → <span data-tx-buyer="${escapeHtml(t.buyerId || "")}">${escapeHtml(buyer)}</span></span>
      <span>${formatShortNumber(Number(t.quantity || 0))}</span>
      <span>${fmtMoney(price2)} ₿</span>
    </div>`;
  }).join("") : '<p style="color:var(--ink-dim);padding:6px 0">No recent trading transactions found.</p>';

  const compRows = [["Trend", sig.components.trend], ["RSI", sig.components.rsi], ["Imbalance", sig.components.imbalance], ["Volume", sig.components.volume], ["Intraday", sig.components.intraday]].map(([lbl, v]) => {
    const pct = Math.round(clamp2(v) * 100);
    const cls = v >= 0 ? "pos" : "neg";
    return `<div class="cm-comp-row"><span class="cm-comp-label">${lbl}</span><span class="cm-comp-bar"><i class="${cls}" style="width:${Math.abs(pct)}%"></i></span><span class="cm-comp-val">${(v >= 0 ? "+" : "") + v.toFixed(3)}</span></div>`;
  }).join("");

  body.innerHTML = `
    <div class="cm-stats">
      <div class="cm-stat"><span>Live Price</span><b>${fmtMoney(price)} ₿</b></div>
      <div class="cm-stat"><span>Signal</span><b style="color:${color}" data-signal-key="${sig.level.key}">${sig.level.name}</b></div>
      <div class="cm-stat"><span>Score</span><b>${sig.score.toFixed(3)}</b></div>
      <div class="cm-stat"><span>Confidence</span><b>${Math.round(sig.confidence * 100)}%</b></div>
      <div class="cm-stat"><span>RSI(14)</span><b>${sig.rsi != null ? sig.rsi.toFixed(1) : "—"}</b></div>
      <div class="cm-stat"><span>1D / 7D</span><b><span class="${d1 > 0 ? "up" : d1 < 0 ? "down" : ""}">${fmtPct(d1)}</span> / <span class="${d7 > 0 ? "up" : d7 < 0 ? "down" : ""}">${fmtPct(d7)}</span></b></div>
      <div class="cm-stat"><span>30D Range</span><b>${fmtMoney(range.mn)} – ${fmtMoney(range.mx)}</b></div>
      <div class="cm-stat"><span>30D Volume</span><b>${formatShortNumber(totalVol)}</b></div>
    </div>
    <h3 class="cm-sec">Price — 30 days (green=SMA5, orange=SMA20)</h3>
    <div class="cm-chart">${chartSVG(hist)}</div>
    <h3 class="cm-sec">Signal Composition</h3>
    <div class="cm-comps">${compRows}</div>
    <div class="cm-grid">
      <div>
        <h3 class="cm-sec">Order Book</h3>
        ${book ? `<div class="cm-obl">
          <div class="cm-tx-row"><span>Best Bid</span><span>${fmtMoney(book.bestBid || 0)} ₿</span></div>
          <div class="cm-tx-row"><span>Best Ask</span><span>${fmtMoney(book.bestAsk || 0)} ₿</span></div>
          <div class="cm-tx-row"><span>Spread</span><span>${book.spreadPct != null ? (book.spreadPct * 100).toFixed(2) + "%" : "—"}</span></div>
          <div class="cm-tx-row"><span>Depth</span><span>${formatShortNumber(book.depth || 0)}</span></div>
          <div class="cm-tx-row"><span>Bid Money</span><span>${fmtMoney(book.bidMoney || 0)} ₿</span></div>
          <div class="cm-tx-row"><span>Ask Money</span><span>${fmtMoney(book.askMoney || 0)} ₿</span></div>
          <div class="cm-tx-row"><span>Imbalance</span><span>${book.imbalance != null ? (book.imbalance * 100).toFixed(1) + "%" : "—"}</span></div>
        </div>` : '<p style="color:var(--ink-dim)">No live orders.</p>'}
      </div>
      <div>
        <h3 class="cm-sec">Recent Trades</h3>
        <div class="cm-tx-table">
          <div class="cm-tx-row cm-tx-head"><span>Time</span><span>Seller → Buyer</span><span>Qty</span><span>Price</span></div>
          ${tradesHTML}
        </div>
      </div>
    </div>`;
  resolveTradeEntityNames(trades, k);
}

function clamp2(v) { return Math.max(-1, Math.min(1, v)); }

export function openCommodityModal(code) {
  _modalCode = code;
  const modal = document.getElementById("commodityModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  const body = document.getElementById("commodityModalBody");
  if (body) body.innerHTML = '<p style="color:var(--ink-dim)">Loading dossier…</p>';
  renderCommodityModal(code);
}

export function closeCommodityModal() {
  _modalCode = null;
  const modal = document.getElementById("commodityModal");
  if (modal) modal.classList.add("hidden");
}

document.addEventListener("click", e => {
  const row = e.target.closest("[data-commodity-code]");
  if (row) { openCommodityModal(row.dataset.commodityCode); return; }
  if (e.target.closest("#closeCommodityModal")) closeCommodityModal();
  if (e.target.id === "commodityModal") closeCommodityModal();
});
