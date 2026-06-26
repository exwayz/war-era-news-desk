import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { fmtMoney, fmtNum } from "../core/utils.js";
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

function normalize(arr) {
  if (!arr || arr.length < 2) return arr || [];
  const mn = Math.min(...arr);
  const mx = Math.max(...arr);
  if (mx === mn) return arr.map(() => 50);
  return arr.map(v => ((v - mn) / (mx - mn)) * 100);
}

function multiChart(series) {
  const valid = series.filter(s => s.values && s.values.length >= 2);
  if (!valid.length) return `<p style="color:var(--ink-dim);padding:20px;text-align:center">Insufficient historical data for chart.</p>`;

  const W = 800, H = 220, padL = 50, padR = 20, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(...valid.map(s => s.values.length));
  const idx = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);

  const lines = valid.map(s => {
    const norm = normalize(s.values);
    const pts = norm.map((v, i) => `${idx(i).toFixed(1)},${(padT + plotH - (v / 100) * plotH).toFixed(1)}`);
    const lastX = parseFloat(pts[pts.length - 1].split(",")[0]);
    const lastY = parseFloat(pts[pts.length - 1].split(",")[1]);
    const curVal = s.values[s.values.length - 1];
    const prevVal = s.values.length > 1 ? s.values[s.values.length - 2] : null;
    const pct = prevVal && prevVal > 0 ? ((curVal - prevVal) / prevVal) * 100 : null;
    return {
      id: s.label.replace(/\W/g, ""),
      label: s.label,
      color: s.color,
      pts,
      lastX, lastY,
      curVal,
      pct,
    };
  });

  const gridlines = [0, 25, 50, 75, 100];
  const yPos = (v) => padT + plotH - (v / 100) * plotH;

  return `<svg viewBox="0 0 ${W} ${H}" class="exec-chart-svg">
    ${gridlines.map(v => {
      const y = yPos(v);
      return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="var(--border-1)" stroke-width="0.5"/>
        <text x="${padL - 6}" y="${y + 3}" fill="var(--ink-dim)" font-size="9" text-anchor="end">${v}</text>`;
    }).join("")}
    <text x="${padL}" y="${padT - 4}" fill="var(--ink-dim)" font-size="9">Normalized (0–100)</text>
    ${lines.map(l => {
      const fillId = "efill-" + l.id;
      const areaPath = `M${l.pts[0]} ${l.pts.slice(1).map(p => "L" + p).join(" ")} L${padL + plotW},${padT + plotH} L${padL},${padT + plotH} Z`;
      return `<defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${l.color}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${l.color}" stop-opacity="0.01"/>
      </linearGradient></defs>
      <path d="${areaPath}" fill="url(#${fillId})"/>
      <polyline points="${l.pts.join(" ")}" fill="none" stroke="${l.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${l.lastX}" cy="${l.lastY}" r="3.5" fill="${l.color}" stroke="var(--ink-950)" stroke-width="1"/>`;
    }).join("")}
  </svg>
  <div class="exec-legend">${lines.map(l => {
    const label = l.label + (l.curVal != null ? ` (${fmtMoney(l.curVal)})` : "");
    const pctDisplay = l.pct != null ? fmtPct(l.pct) : "";
    return `<span class="exec-legend-item"><span class="exec-legend-dot" style="background:${l.color}"></span>${label} <small style="color:${l.color}">${pctDisplay} ${trend(l.pct)}</small></span>`;
  }).join("")}</div>`;
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
  if (!p) {
    document.querySelector(".analytics-section")?.remove();
    return;
  }

  let section = document.querySelector(".analytics-section");
  if (!section) {
    section = document.createElement("div");
    section.className = "analytics-section";
    section.innerHTML = `<div class="market-card analytics-exec-card" style="grid-column:1/-1">
      <div class="market-card-header"><span class="market-card-title">Executive Economic Dashboard</span></div>
      <div class="analytics-exec-body"></div>
    </div>
    <div class="analytics-cards-grid"></div>`;
    const insertTarget = document.querySelector(".market-grid");
    if (insertTarget) insertTarget.after(section); else return;
  }

  const srv = document.querySelector(".analytics-section");
  const execBody = srv.querySelector(".analytics-exec-body");
  const cardsGrid = srv.querySelector(".analytics-cards-grid");

  const series = [
    { label: "Average Wage", values: S.market.wageHistory.map(w => w.avg), color: "var(--blue, #3b82f6)" },
    { label: "Trade Volume", values: S.market.tradeVolHistory, color: "var(--green, #22c55e)" },
    { label: "Total Payroll", values: S.market.payrollHistory, color: "var(--orange, #f59e0b)" },
    { label: "Commodity Basket", values: S.market.basketHistory, color: "var(--purple, #a855f7)" },
  ];

  execBody.innerHTML = `<div class="exec-chart-wrap">${multiChart(series)}</div>
    <div class="exec-summary">
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
    if (assessSection) assessSection.outerHTML = assessHtml;
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
