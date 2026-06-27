import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { fmtMoney, fmtNum, formatShortNumber } from "../core/utils.js";
import { miniChart } from "../core/utils.js";

const TREND_UP = "▲";
const TREND_DOWN = "▼";
const TREND_FLAT = "■";

function trend(val) {
  if (val == null) return TREND_FLAT;
  return val > 2 ? TREND_UP : val < -2 ? TREND_DOWN : TREND_FLAT;
}

function fmtPct(v) {
  if (v == null) return "N/A";
  return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
}

function fmtShort(v) {
  if (v == null || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  if (abs >= 1) return v.toFixed(1);
  return v.toFixed(3);
}

function badge(cat) {
  const colors = {
    "Official Indicator": "var(--green)",
    "Derived Indicator": "var(--blue)",
    "Estimated Indicator": "var(--yellow)",
    "Market Intelligence Indicator": "var(--accent)",
    "Momentum Indicator": "var(--ink-dim)",
  };
  return `<span class="analytics-badge" style="background:${colors[cat]||"var(--ink-dim)"}20;color:${colors[cat]||"var(--ink-dim)"}">${cat}</span>`;
}

function miniHistory(arr, color = "var(--accent)") {
  if (!arr || arr.length < 2) return "";
  return miniChart(arr, "", color);
}

function niceScale(min, max, ticks) {
  if (min === max) { const v = min || 1; return [v - 1, v, v + 1]; }
  const range = max - min;
  const rough = range / (ticks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm <= 1.5 ? mag : norm <= 3.5 ? 2 * mag : norm <= 7.5 ? 5 * mag : 10 * mag;
  const start = Math.ceil(min / step) * step;
  const end = Math.floor(max / step) * step;
  const labels = [];
  for (let v = start; v <= end + step * 0.5; v += step) labels.push(v);
  return labels;
}

function smoothPath(points) {
  if (points.length < 2) return "";
  if (points.length === 2) return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const mx = (points[i - 1].x + points[i].x) / 2;
    d += ` C${mx},${points[i - 1].y} ${mx},${points[i].y} ${points[i].x},${points[i].y}`;
  }
  return d;
}

function fmtChartVal(v) {
  if (v == null || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs < 1) return v.toFixed(4);
  if (abs < 10) return v.toFixed(3);
  if (abs < 1000) return v.toFixed(1);
  return formatShortNumber(v);
}

let _chartKey = "";
let _chartConfig = null;

function multiChart(series) {
  const pureCycleKeys = ["ppHistory","hhiHistory","circulationHistory","tradeEfficiencyHistory","basketHistory"];
  let cycleLen = 0;
  for (const k of pureCycleKeys) {
    if (S.market[k] && S.market[k].length > 0) { cycleLen = S.market[k].length; break; }
  }
  if (cycleLen < 2) {
    cycleLen = Math.min(...series.map(s => s.values.length).filter(l => l >= 2));
    if (!cycleLen || cycleLen < 2) return `<p style="color:var(--ink-dim);padding:20px;text-align:center">Insufficient historical data for chart.</p>`;
  }

  const data = series.map(s => {
    const vals = s.values.length > cycleLen ? s.values.slice(-cycleLen) : s.values;
    return { label: s.label, color: s.color, vals, len: vals.length };
  }).filter(d => d.len >= 2);
  if (!data.length) return `<p style="color:var(--ink-dim);padding:20px;text-align:center">Insufficient historical data for chart.</p>`;

  const totalLen = Math.max(...data.map(d => d.len));

  const key = data.map(d => d.len + "|" + (isFinite(d.vals[d.len - 1]) ? d.vals[d.len - 1].toFixed(2) : "n")).join(";");
  if (key === _chartKey) return "";
  _chartKey = key;

  let gMin = Infinity, gMax = -Infinity;
  for (const d of data) {
    for (const v of d.vals) { if (v != null && isFinite(v)) { if (v < gMin) gMin = v; if (v > gMax) gMax = v; } }
  }
  if (!isFinite(gMin) || !isFinite(gMax) || gMin === gMax) return `<p style="color:var(--ink-dim);padding:20px;text-align:center">Insufficient data range.</p>`;

  const range = gMax - gMin;
  const pado = range * 0.05 || 1;
  gMin -= pado; gMax += pado;

  const W = 800, H = 220, padL = 60, padR = 30, padT = 16, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const xPos = (i) => padL + (totalLen > 1 ? (i / (totalLen - 1)) * plotW : plotW / 2);
  const yPos = (v) => padT + plotH - ((v - gMin) / (gMax - gMin)) * plotH;

  const yTicks = niceScale(gMin, gMax, 5);

  const lines = data.map(d => {
    const points = [];
    for (let i = 0; i < d.len; i++) {
      if (d.vals[i] != null && isFinite(d.vals[i])) {
        points.push({ x: xPos(i), y: yPos(d.vals[i]), v: d.vals[i], i });
      }
    }
    const cur = d.vals[d.len - 1];
    const prev = d.len > 1 ? d.vals[d.len - 2] : null;
    const pct = (prev != null && isFinite(prev) && prev > 0) ? ((cur - prev) / prev) * 100 : null;
    return { label: d.label, color: d.color, points, cur, pct, len: d.len };
  });

  const uid = "ch" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const areas = lines.map(l => {
    if (l.points.length < 2) return "";
    const fid = "fa" + uid + l.label.replace(/\W/g, "");
    const pts = l.points.map(p => `${p.x},${p.y}`).join(" L");
    return `<defs><linearGradient id="${fid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${l.color}" stop-opacity="0.10"/><stop offset="100%" stop-color="${l.color}" stop-opacity="0.01"/></linearGradient></defs><path d="M${l.points[0].x},${padT + plotH} L${pts} L${l.points[l.points.length - 1].x},${padT + plotH} Z" fill="url(#${fid})"/>`;
  }).join("");

  const paths = lines.map(l => {
    if (l.points.length < 2) return "";
    const path = smoothPath(l.points);
    const last = l.points[l.points.length - 1];
    return `<path d="${path}" fill="none" stroke="${l.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>${last ? `<circle cx="${last.x}" cy="${last.y}" r="3" fill="${l.color}" stroke="var(--ink-950)" stroke-width="1"/>` : ""}`;
  }).join("");

  _chartConfig = { uid, lines, plotW, plotH, padL, padT, totalLen };

  return `<div class="exec-chart-inner" style="position:relative" data-uid="${uid}">
    <svg viewBox="0 0 ${W} ${H}" class="exec-chart-svg" style="cursor:crosshair">
      ${yTicks.map(v => {
        const yy = yPos(v);
        return `<line x1="${padL}" y1="${yy}" x2="${padL + plotW}" y2="${yy}" stroke="var(--border-1)" stroke-width="0.5" stroke-dasharray="3,3"/><text x="${padL - 6}" y="${yy + 3}" fill="var(--ink-dim)" font-size="9" text-anchor="end">${fmtShort(v)}</text>`;
      }).join("")}
      <text x="${padL}" y="${padT - 4}" fill="var(--ink-dim)" font-size="9">Last ${totalLen} cycles</text>
      ${areas}
      ${paths}
      <line class="ch-${uid}-xhair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="var(--ink-dim)" stroke-width="0.8" stroke-dasharray="3,3" style="display:none;pointer-events:none"/>
      <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" class="ch-${uid}-zone" style="cursor:crosshair"/>
    </svg>
    <div class="ch-${uid}-tip chart-tooltip" style="display:none;position:absolute;pointer-events:none;background:rgba(24,32,40,0.95);backdrop-filter:blur(6px);border:1px solid var(--border-1);border-radius:6px;padding:8px 12px;font-size:.72rem;z-index:100;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);line-height:1.6"></div>
  </div>
  <div class="exec-legend">${lines.map(l => {
    const pctD = l.pct != null ? fmtPct(l.pct) : "";
    const tri = l.pct != null ? (l.pct > 2 ? TREND_UP : l.pct < -2 ? TREND_DOWN : TREND_FLAT) : TREND_FLAT;
    return `<span class="exec-legend-item"><span class="exec-legend-dot" style="background:${l.color}"></span>${l.label} <span class="exec-legend-val">${l.cur != null ? fmtChartVal(l.cur) : ""}</span> <small style="color:${l.color}">${pctD} ${tri}</small></span>`;
  }).join("")}</div>`;
}

function initChartTools(uid, lines, plotW, plotH, padL, padT, totalLen) {
  const inner = document.querySelector(`.exec-chart-inner[data-uid="${uid}"]`);
  if (!inner) return;
  const svg = inner.querySelector("svg");
  const xhair = inner.querySelector(`.ch-${uid}-xhair`);
  const tip = inner.querySelector(`.ch-${uid}-tip`);
  const zone = inner.querySelector(`.ch-${uid}-zone`);
  if (!svg || !zone || !xhair || !tip) return;

  function getSVGPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const scaleX = 800 / rect.width;
    const scaleY = 220 / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function showTooltip(svgX) {
    const relX = svgX - padL;
    const ratio = Math.max(0, Math.min(1, relX / plotW));
    const idx = Math.round(ratio * (totalLen - 1));
    const cx = padL + (totalLen > 1 ? (idx / (totalLen - 1)) * plotW : plotW / 2);

    xhair.setAttribute("x1", cx);
    xhair.setAttribute("x2", cx);
    xhair.style.display = "";

    const vals = lines.filter(l => l.points.length > 0);
    const atIdx = vals.map(l => {
      const pt = l.points.find(p => p.i === idx) || l.points.reduce((a, b) => Math.abs(b.i - idx) < Math.abs(a.i - idx) ? b : a);
      return { label: l.label, color: l.color, v: pt ? pt.v : null, dist: pt ? Math.abs(pt.i - idx) : Infinity };
    }).filter(x => x.v != null && isFinite(x.v));

    if (!atIdx.length) { tip.style.display = "none"; return; }

    tip.innerHTML = atIdx.map(t => `<span style="color:${t.color}">${t.label}</span> ${fmtChartVal(t.v)}`).join("<br>");
    tip.style.display = "";

    const svgRect = svg.getBoundingClientRect();
    const tipX = cx * (svgRect.width / 800);
    const tipY = padT * (svgRect.height / 220);
    tip.style.left = tipX + "px";
    tip.style.top = (tipY - tip.offsetHeight - 8) + "px";

    if (tipX + tip.offsetWidth > svgRect.width - 4) {
      tip.style.left = (svgRect.width - tip.offsetWidth - 4) + "px";
    }
  }

  function hideTooltip() {
    xhair.style.display = "none";
    tip.style.display = "none";
  }

  zone.addEventListener("mousemove", (e) => {
    const pt = getSVGPoint(e.clientX, e.clientY);
    showTooltip(pt.x);
  });

  zone.addEventListener("mouseleave", hideTooltip);
}

function card(title, category, body, opts = {}) {
  const trendArrow = opts.trend ? `<span class="analytics-trend" style="color:${opts.trendColor || "var(--ink-dim)"}">${opts.trend}</span>` : "";
  const pct = opts.pct != null ? `<span class="analytics-pct">${fmtPct(opts.pct)}</span>` : "";
  return `<div class="market-card analytics-card">
    <div class="market-card-header">
      <span class="market-card-title">${title}</span>
      ${badge(category)}
    </div>
    <div class="analytics-card-body">
      ${opts.value != null ? `<div class="analytics-value">${opts.value} ${trendArrow} ${pct}</div>` : ""}
      ${opts.extra || ""}
      ${opts.chart || ""}
      ${opts.interpretation ? `<div class="analytics-interp">${opts.interpretation}</div>` : ""}
    </div>
  </div>`;
}

export function renderExecutiveDashboard(a) {
  const { p, d, econClass, healthScore, warnings } = a;

  let section = document.querySelector(".analytics-section");
  if (!section) return;

  const srv = document.querySelector(".analytics-section");
  const execBody = srv.querySelector(".analytics-exec-body");
  const cardsGrid = srv.querySelector(".analytics-cards-grid");

  const series = [
    { label: "Commodity Basket", values: S.market.basketHistory, color: "var(--purple, #a855f7)" },
    { label: "Purchasing Power", values: S.market.ppHistory, color: "var(--accent, #f59e0b)" },
    { label: "Market Concentration", values: S.market.hhiHistory, color: "var(--yellow, #eab308)" },
    { label: "Economic Circulation", values: S.market.circulationHistory, color: "var(--orange, #f97316)" },
    { label: "Trade Efficiency", values: S.market.tradeEfficiencyHistory, color: "var(--cyan, #06b6d4)" },
  ];

  const summaryHtml = `<div class="exec-summary">
    <div class="exec-summary-row">
      <span class="exec-label">Economic Status</span>
      <span class="exec-value" style="color:${econClass?.color || "var(--ink-dim)"}">${econClass?.label || "N/A"}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Market Intelligence Score</span>
      <span class="exec-value">${healthScore ? healthScore.score + "/100 · " + healthScore.level : "N/A"}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Trade Momentum</span>
      <span class="exec-value">${fmtPct(d?.tradeMom)} ${trend(d?.tradeMom)}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Payroll Momentum</span>
      <span class="exec-value">${fmtPct(d?.payrollMom)} ${trend(d?.payrollMom)}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Wage Momentum</span>
      <span class="exec-value">${fmtPct(d?.wageMom)} ${trend(d?.wageMom)}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Price Momentum</span>
      <span class="exec-value">${fmtPct(d?.priceMom)} ${trend(d?.priceMom)}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Purchasing Power</span>
      <span class="exec-value">${d?.pp != null ? fmtMoney(d.pp, 4) + " baskets/wage" : "N/A"} ${trend(d?.ppMom)}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Market Concentration</span>
      <span class="exec-value">${d?.hhi != null ? "HHI " + d.hhi.toFixed(0) : "N/A"} ${trend(d?.hhiMom ? -d.hhiMom : null)}</span>
    </div>
  </div>`;

  const chartHtml = multiChart(series);
  if (chartHtml) {
    execBody.innerHTML = `<div class="exec-chart-wrap">${chartHtml}</div>${summaryHtml}`;
    if (_chartConfig) {
      const { uid, lines, plotW, plotH, padL, padT, totalLen } = _chartConfig;
      initChartTools(uid, lines, plotW, plotH, padL, padT, totalLen);
    }
  } else {
    const s = execBody.querySelector(".exec-summary");
    if (s) s.outerHTML = summaryHtml;
  }

  const cards = [];

  cards.push(card("Wage Intelligence", "Derived Indicator", "", {
    value: p.Pw != null ? fmtMoney(p.Pw, 3) + " BTC/hit" : "N/A",
    pct: d?.wageMom,
    trend: trend(d?.wageMom),
    trendColor: d?.wageMom > 0 ? "var(--green)" : d?.wageMom < 0 ? "var(--red)" : "var(--ink-dim)",
    extra: `<div class="analytics-meta">F: Pw = P ÷ H</div>
      <div class="analytics-meta">V: totalPayroll, totalQuantity</div>
      <div class="analytics-meta">Payroll: ${fmtMoney(p.P)} BTC · Hits: ${fmtNum(p.H)} · Txns: ${fmtNum(p.Tw)}</div>
      ${p.wageMin != null ? `<div class="analytics-meta">Wage range: ${fmtMoney(p.wageMin, 3)} → ${fmtMoney(p.wageMax, 3)} BTC/hit</div>` : ""}
      ${p.topWage ? `<div class="analytics-meta">Top offer: ${fmtMoney(p.topWage, 3)} BTC/hit</div>` : ""}`,
    chart: miniHistory(S.market.wageHistory.map(w => w.avg), "var(--blue)"),
    interpretation: d?.wageMom != null ? `Wages ${d.wageMom > 2 ? "rising" : d.wageMom < -2 ? "declining" : "stable"} ${fmtPct(d.wageMom)}.` : "",
  }));

  cards.push(card("Trade Intelligence", "Derived Indicator", "", {
    value: fmtMoney(p.Tv) + " BTC",
    pct: d?.tradeMom,
    trend: trend(d?.tradeMom),
    trendColor: d?.tradeMom > 0 ? "var(--green)" : d?.tradeMom < 0 ? "var(--red)" : "var(--ink-dim)",
    extra: `<div class="analytics-meta">F: Tv = Σ(trade.amount)</div>
      <div class="analytics-meta">V: tradeVol, tradeCount</div>
      <div class="analytics-meta">Transactions: ${fmtNum(p.Tt)} · Avg: ${fmtMoney(d?.tradeEfficiency || 0)} BTC/trade</div>`,
    chart: miniHistory(S.market.tradeVolHistory, "var(--green)"),
    interpretation: d?.tradeMom != null ? `Trade ${d.tradeMom > 2 ? "expanding" : d.tradeMom < -2 ? "contracting" : "stable"} ${fmtPct(d.tradeMom)}.` : "",
  }));

  cards.push(card("Commodity Intelligence", "Market Intelligence Indicator", "", {
    value: p.Basket > 0 ? fmtMoney(p.Basket, 4) + " BTC" : "N/A",
    pct: d?.priceMom,
    trend: trend(d?.priceMom),
    trendColor: d?.priceMom > 0 ? "var(--red)" : d?.priceMom < 0 ? "var(--green)" : "var(--ink-dim)",
    extra: `<div class="analytics-meta">F: Basket = Σ(Top10 Pi) ÷ 10</div>
      <div class="analytics-meta">V: prices array, totalCommodityValue</div>
      <div class="analytics-meta">Basket: avg of top 10 commodity prices</div>
      ${p.Vc > 0 ? `<div class="analytics-meta">Total commodity value: ${fmtMoney(p.Vc)} BTC</div>` : ""}`,
    chart: miniHistory(S.market.basketHistory, "var(--purple)"),
    interpretation: d?.priceMom != null ? `Basket ${d.priceMom > 2 ? "rising" : d.priceMom < -2 ? "falling" : "stable"} ${fmtPct(d.priceMom)}.` : "",
  }));

  cards.push(card("Purchasing Power", "Derived Indicator", "", {
    value: d?.pp != null ? fmtMoney(d.pp, 4) + " baskets/wage" : "N/A",
    pct: d?.ppMom,
    trend: trend(d?.ppMom),
    trendColor: d?.ppMom > 0 ? "var(--green)" : d?.ppMom < 0 ? "var(--red)" : "var(--ink-dim)",
    extra: `<div class="analytics-meta">F: PP = Pw ÷ Basket</div>
      <div class="analytics-meta">V: avgWage, commodityBasket</div>
      <div class="analytics-meta">Avg wage ÷ basket price</div>`,
    chart: miniHistory(S.market.ppHistory, "var(--accent)"),
    interpretation: d?.ppMom != null
      ? d.ppMom > 2 ? "Workers gaining purchasing power." : d.ppMom < -2 ? "Purchasing power declining." : "Purchasing power stable."
      : "",
  }));

  cards.push(card("Market Concentration", "Derived Indicator", "", {
    value: d?.hhi != null ? d.hhi.toFixed(0) : "N/A",
    extra: `<div class="analytics-meta">F: HHI = Σ(share²) × 10000</div>
      <div class="analytics-meta">V: commodity values, totalCommodityValue</div>
      <div class="analytics-meta">Herfindahl-Hirschman Index (0–10000)</div>
      <div class="analytics-meta">${d?.hhi != null ? (d.hhi > 2500 ? "Highly concentrated" : d.hhi > 1500 ? "Moderately concentrated" : "Competitive market") : ""}</div>`,
    chart: miniHistory(S.market.hhiHistory, "var(--yellow)"),
    interpretation: d?.hhi != null ? `HHI ${d.hhi.toFixed(0)} ${d.hhiMom != null ? (d.hhiMom > 0 ? "increasing" : "decreasing") : ""}.` : "",
  }));

  cards.push(card("Economic Circulation", "Estimated Indicator", "", {
    value: d?.circulation != null ? (d.circulation * 100).toFixed(1) + "%" : "N/A",
    pct: d?.tradeMom,
    trend: trend(d?.tradeMom),
    extra: `<div class="analytics-meta">F: Circ = Tv ÷ (P + Tv)</div>
      <div class="analytics-meta">V: tradeVol, totalPayroll</div>
      <div class="analytics-meta">Trade volume ÷ (payroll + trade volume)</div>
      <div class="analytics-meta">${d?.circulation != null ? (d.circulation > 0.5 ? "Trade-driven economy" : "Wage-driven economy") : ""}</div>`,
    chart: miniHistory(S.market.circulationHistory, "var(--orange)"),
    interpretation: d?.circulation != null
      ? `${(d.circulation * 100).toFixed(0)}% of value flows through trade.`
      : "",
  }));

  cards.push(card("Trade Efficiency", "Derived Indicator", "", {
    value: d?.tradeEfficiency != null ? fmtMoney(d.tradeEfficiency) + " BTC/trade" : "N/A",
    extra: `<div class="analytics-meta">F: Eff = Tv ÷ Tt</div>
      <div class="analytics-meta">V: tradeVol, tradeCount</div>
      <div class="analytics-meta">Total trade volume ÷ transaction count</div>`,
    chart: miniHistory(S.market.tradeEfficiencyHistory, "var(--cyan, #06b6d4)"),
    interpretation: d?.tradeEfficiency != null
      ? `Avg ${fmtMoney(d.tradeEfficiency)} BTC per trade.`
      : "",
  }));

  cards.push(card(`Labour Market`, "Derived Indicator", "", {
    value: p.Javg != null ? fmtMoney(p.Javg, 3) + " BTC/hit (avg offer)" : "Job offers N/A",
    extra: `<div class="analytics-meta">F: Javg = Σ(job.wage) ÷ count</div>
      <div class="analytics-meta">V: job wages, avgWage</div>
      ${p.Jmin != null
      ? `<div class="analytics-meta">Offer range: ${fmtMoney(p.Jmin, 3)} → ${fmtMoney(p.Jmax, 3)} BTC/hit</div>
         ${p.Pw > 0 ? `<div class="analytics-meta">Market wage vs offers: ${fmtMoney(p.Pw - (p.Javg || 0), 3)} BTC/hit</div>` : ""}`
      : `<div class="analytics-meta">Open job offers: ${fmtNum(S.jobs.length)}</div>`}`,
    interpretation: p.Javg != null
      ? (p.Pw > p.Javg ? "Market wages above offers — worker-friendly." : "Offers competitive with market rates.")
      : "",
  }));

  cardsGrid.innerHTML = cards.join("");

  const warnSection = document.querySelector(".analytics-warnings");
  if (warnings && warnings.length) {
    const warnHtml = warnings.map(w => `<div class="analytics-warn analytics-warn-${w.level.toLowerCase()}">
      <span class="analytics-warn-icon">${w.icon}</span>
      <span class="analytics-warn-indicator">${w.indicator}</span>
      <span class="analytics-warn-reason">${w.reason}</span>
    </div>`).join("");
    if (warnSection) warnSection.innerHTML = warnHtml;
    else {
      const div = document.createElement("div");
      div.className = "analytics-warnings";
      div.innerHTML = warnHtml;
      cardsGrid.after(div);
    }
  } else if (warnSection) {
    warnSection.remove();
  }

  const assessSection = document.querySelector(".analytics-assessment");
  if (a.assessment) {
    const assessHtml = `<div class="market-card analytics-assess-card" style="grid-column:1/-1">
      <div class="market-card-header"><span class="market-card-title">Economic Intelligence Assessment</span> ${badge("Market Intelligence Indicator")}</div>
      <div class="analytics-assess-body">
        <p class="analytics-assess-summary">${a.assessment.summary}</p>
        ${a.assessment.paragraphs.map(p => `<div class="analytics-assess-item"><strong>${p.topic}:</strong> ${p.text}</div>`).join("")}
      </div>
    </div>`;
    if (assessSection) assessSection.outerHTML = `<div class="analytics-assessment">${assessHtml}</div>`;
    else {
      const div = document.createElement("div");
      div.className = "analytics-assessment";
      div.innerHTML = assessHtml;
      (document.querySelector(".analytics-cards-grid") || srv).after(div);
    }
  } else if (assessSection) {
    assessSection.remove();
  }
}
