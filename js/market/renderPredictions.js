import { S } from "../core/state.js";
import { fmtMoney, fmtNum } from "../core/utils.js";
import { computePredictions } from "./predictions.js";

function fmtPct(v) {
  if (v == null) return "N/A";
  return (v > 0 ? "+" : "") + Number(v).toFixed(1) + "%";
}

const CAT_COLORS = {
  "Prediction Indicator": "var(--green)",
  "Pressure Indicator": "var(--blue)",
  "Momentum Indicator": "var(--accent)",
  "Liquidity Indicator": "var(--yellow)",
  "Confidence Indicator": "var(--ink-dim)",
  "Rank Indicator": "var(--orange)",
};

function catColor(cat) { return CAT_COLORS[cat] || "var(--ink-dim)"; }

function badge(cat) {
  const c = catColor(cat);
  return `<span class="analytics-badge" style="background:${c}20;color:${c}">${cat}</span>`;
}

function hl(name, cat) { return `<span style="color:${catColor(cat)};font-weight:700">${name}</span>`; }

const TREND_UP = "▲";
const TREND_DOWN = "▼";
const TREND_FLAT = "■";

function trendArrow(v) {
  if (v == null) return TREND_FLAT;
  return v > 5 ? TREND_UP : v < -5 ? TREND_DOWN : TREND_FLAT;
}

function predCard(title, category, body, opts = {}) {
  const trend = opts.trend ? `<span class="analytics-trend" style="color:${opts.trendColor || "var(--ink-dim)"}">${opts.trend}</span>` : "";
  const pct = opts.pct != null ? `<span class="analytics-pct">${fmtPct(opts.pct)}</span>` : "";
  return `<div class="market-card analytics-card">
    <div class="market-card-header">
      <span class="market-card-title">${title}</span>
      ${badge(category)}
    </div>
    <div class="analytics-card-body">
      ${opts.value != null ? `<div class="analytics-value">${opts.value} ${trend} ${pct}</div>` : ""}
      ${opts.extra || ""}
      ${opts.interpretation ? `<div class="analytics-interp">${opts.interpretation}</div>` : ""}
    </div>
  </div>`;
}

export function renderPredictionDashboard() {
  let section = document.querySelector(".prediction-section");
  if (!section) return;

  const p = computePredictions();
  const execBody = section.querySelector(".prediction-exec-body");
  const cardsGrid = section.querySelector(".prediction-cards-grid");
  if (!execBody || !cardsGrid) return;

  const hasHistory = p.itemsWithHistory.length > 0;

  const icons = { "Strong Bullish": "▲▲", "Bullish": "▲", "Stable": "■", "Bearish": "▼", "Strong Bearish": "▼▼" };
  const trendColors = { "Strong Bullish": "var(--green)", "Bullish": "var(--green-dim, #6ee7b7)", "Stable": "var(--ink-dim)", "Bearish": "var(--orange)", "Strong Bearish": "var(--red)" };

  execBody.innerHTML = `<div class="exec-summary">
    <div class="exec-summary-row">
      <span class="exec-label">Prediction Confidence</span>
      <span class="exec-value">${p.confidence != null ? p.confidence + "/100" : "N/A"}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Market Rotation Index</span>
      <span class="exec-value">${p.marketRotationIndex != null ? p.marketRotationIndex + " rank changes" : "N/A"}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Commodities with History</span>
      <span class="exec-value">${hasHistory ? p.itemsWithHistory.length + "/" + p.predictions.length : "0/" + p.predictions.length}</span>
    </div>
    <div class="exec-summary-row">
      <span class="exec-label">Bullish / Stable / Bearish</span>
      <span class="exec-value">${p.totalBullish || 0} / ${p.totalStable || 0} / ${p.totalBearish || 0}</span>
    </div>
  </div>`;

  const cards = [];
  const topItem = p.predictions[0];

  cards.push(predCard("Commodity Momentum Score", "Prediction Indicator", "", {
    value: hasHistory ? p.itemsWithHistory.length + " tracked" : "Insufficient History",
    pct: topItem?.valueGrowth,
    trend: trendArrow(topItem?.valueGrowth),
    trendColor: (topItem?.valueGrowth || 0) > 0 ? "var(--green)" : "var(--red)",
    extra: `<div class="analytics-meta">F: Momentum = valueGrowth% across tracked commodities</div>
      <div class="analytics-meta">V: topValuable[n].value, prevCommodityScores</div>
      ${hasHistory ? `<div class="analytics-meta">Tracked items: ${p.itemsWithHistory.slice(0, 5).map(n => hl(n, "Prediction Indicator")).join(", ")}${p.itemsWithHistory.length > 5 ? "..." : ""}</div>` : ""}`,
    interpretation: hasHistory ? `${p.itemsWithHistory.length} commodities have sufficient history for momentum tracking.` : "At least two data snapshots required to compute momentum.",
  }));

  const avgHeat = Object.values(p.heatScores).length
    ? Object.values(p.heatScores).reduce((s, h) => s + h.score, 0) / Object.values(p.heatScores).length
    : null;
  const avgTrend = avgHeat != null ? (avgHeat >= 60 ? "Bullish" : avgHeat >= 40 ? "Stable" : "Bearish") : "N/A";

  cards.push(predCard("Commodity Heat Score", "Prediction Indicator", "", {
    value: avgHeat != null ? avgHeat.toFixed(1) + " · " + avgTrend : "Insufficient History",
    extra: `<div class="analytics-meta">F: 0.35×G + 0.30×BP + 0.20×LQ + 0.15×RG</div>
      <div class="analytics-meta">V: valueGrowth%, buyPressure, liquidityScore, rankGain</div>
      <div class="analytics-meta">Composite weighted score (0–100)</div>`,
    interpretation: avgHeat != null ? `Market heat: ${avgHeat.toFixed(1)} — ${avgTrend.toLowerCase()} sentiment.` : "Requires historical commodity value data.",
  }));

  const topGrowth = p.predictions.filter(p2 => p2.valueGrowth != null).sort((a, b) => (b.valueGrowth || 0) - (a.valueGrowth || 0)).slice(0, 1)[0];
  const worstGrowth = p.predictions.filter(p2 => p2.valueGrowth != null).sort((a, b) => (a.valueGrowth || 0) - (b.valueGrowth || 0)).slice(0, 1)[0];

  cards.push(predCard("Value Growth", "Momentum Indicator", "", {
    value: topGrowth ? fmtPct(topGrowth.valueGrowth) : "Insufficient History",
    pct: topGrowth?.valueGrowth,
    trend: trendArrow(topGrowth?.valueGrowth),
    trendColor: (topGrowth?.valueGrowth || 0) > 0 ? "var(--green)" : "var(--red)",
    extra: `<div class="analytics-meta">F: ((Cv − Pv) ÷ Pv) × 100</div>
      <div class="analytics-meta">V: commodity.value, prevCommodityScores[item]</div>
      ${topGrowth ? `<div class="analytics-meta">Leader: ${hl(topGrowth.itemName, "Momentum Indicator")} (${fmtPct(topGrowth.valueGrowth)})</div>` : ""}
      ${worstGrowth ? `<div class="analytics-meta">Lowest: ${hl(worstGrowth.itemName, "Momentum Indicator")} (${fmtPct(worstGrowth.valueGrowth)})</div>` : ""}`,
    interpretation: topGrowth ? `Best performer: ${hl(topGrowth.itemName, "Momentum Indicator")} at ${fmtPct(topGrowth.valueGrowth)}.` : "",
  }));

  const topVel = p.predictions.filter(p2 => p2.valueVelocity != null).sort((a, b) => Math.abs(b.valueVelocity || 0) - Math.abs(a.valueVelocity || 0)).slice(0, 1)[0];

  cards.push(predCard("Value Velocity", "Momentum Indicator", "", {
    value: topVel ? fmtMoney(Math.abs(topVel.valueVelocity || 0), 6) + " BTC/s" : "Insufficient History",
    extra: `<div class="analytics-meta">F: (Cv − Pv) ÷ ΔTime</div>
      <div class="analytics-meta">V: commodity.value, prevCommodityScores, update timestamp</div>
      ${topVel ? `<div class="analytics-meta">Fastest: ${hl(topVel.itemName, "Momentum Indicator")} (${fmtMoney(Math.abs(topVel.valueVelocity || 0), 6)} BTC/s)</div>` : ""}`,
    interpretation: topVel ? `Highest velocity: ${hl(topVel.itemName, "Momentum Indicator")}.` : "",
  }));

  const topAcc = p.predictions.filter(p2 => p2.valueAcceleration != null).sort((a, b) => Math.abs(b.valueAcceleration || 0) - Math.abs(a.valueAcceleration || 0)).slice(0, 1)[0];

  cards.push(predCard("Value Acceleration", "Momentum Indicator", "", {
    value: topAcc ? fmtMoney(Math.abs(topAcc.valueAcceleration || 0), 8) + " BTC/s²" : "Insufficient History",
    pct: topAcc?.valueAcceleration != null ? (topAcc.valueAcceleration / (Math.abs(topAcc.valueVelocity || 1)) * 100) : null,
    extra: `<div class="analytics-meta">F: VcurrVel − VprevVel</div>
      <div class="analytics-meta">V: current velocity, previous velocity</div>
      ${topAcc ? `<div class="analytics-meta">Fastest acceleration: ${hl(topAcc.itemName, "Momentum Indicator")}</div>` : ""}`,
    interpretation: topAcc ? `Acceleration detected in ${hl(topAcc.itemName, "Momentum Indicator")}.` : "Requires 3+ snapshots for acceleration.",
  }));

  const maxBP = p.predictions.filter(p2 => p2.buyPressure != null).sort((a, b) => (b.buyPressure || 0) - (a.buyPressure || 0)).slice(0, 1)[0];
  const maxSP = p.predictions.filter(p2 => p2.sellPressure != null).sort((a, b) => (b.sellPressure || 0) - (a.sellPressure || 0)).slice(0, 1)[0];

  cards.push(predCard("Buy Pressure", "Pressure Indicator", "", {
    value: maxBP ? (maxBP.buyPressure * 100).toFixed(1) + "%" : "Insufficient Data",
    extra: `<div class="analytics-meta">F: BuyQty ÷ (BuyQty + SellQty)</div>
      <div class="analytics-meta">V: commodityOrders (BUY side)</div>
      ${maxBP ? `<div class="analytics-meta">Highest: ${hl(maxBP.itemName, "Pressure Indicator")} (${(maxBP.buyPressure * 100).toFixed(0)}%)</div>` : ""}`,
    interpretation: maxBP ? `Highest buy pressure on ${hl(maxBP.itemName, "Pressure Indicator")}.` : "",
  }));

  cards.push(predCard("Sell Pressure", "Pressure Indicator", "", {
    value: maxSP ? (maxSP.sellPressure * 100).toFixed(1) + "%" : "Insufficient Data",
    extra: `<div class="analytics-meta">F: SellQty ÷ (BuyQty + SellQty)</div>
      <div class="analytics-meta">V: commodityOrders (SELL side)</div>
      ${maxSP ? `<div class="analytics-meta">Highest: ${hl(maxSP.itemName, "Pressure Indicator")} (${(maxSP.sellPressure * 100).toFixed(0)}%)</div>` : ""}`,
    interpretation: maxSP ? `Highest sell pressure on ${hl(maxSP.itemName, "Pressure Indicator")}.` : "",
  }));

  const bestPR = p.predictions.filter(p2 => p2.pressureRatio != null && isFinite(p2.pressureRatio)).sort((a, b) => (b.pressureRatio || 0) - (a.pressureRatio || 0)).slice(0, 1)[0];

  cards.push(predCard("Pressure Ratio", "Pressure Indicator", "", {
    value: bestPR ? bestPR.pressureRatio.toFixed(2) + "x" : "Insufficient Data",
    extra: `<div class="analytics-meta">F: BuyQty ÷ SellQty</div>
      <div class="analytics-meta">V: commodityOrders BUY/SELL quantities</div>
      <div class="analytics-meta">>1 = buy dominance, <1 = sell dominance</div>
      ${bestPR ? `<div class="analytics-meta">Highest ratio: ${hl(bestPR.itemName, "Pressure Indicator")} (${bestPR.pressureRatio.toFixed(2)}x)</div>` : ""}`,
    interpretation: bestPR ? (bestPR.pressureRatio > 1.2 ? "Strong buy dominance across top commodities." : bestPR.pressureRatio < 0.8 ? "Sell pressure outweighs buying." : "Balanced buy/sell pressure.") : "",
  }));

  const maxNF = p.predictions.filter(p2 => p2.netOrderFlow != null).sort((a, b) => Math.abs(b.netOrderFlow || 0) - Math.abs(a.netOrderFlow || 0)).slice(0, 1)[0];

  cards.push(predCard("Net Order Flow", "Liquidity Indicator", "", {
    value: maxNF ? (maxNF.netOrderFlow >= 0 ? "+" : "") + fmtMoney(Math.abs(maxNF.netOrderFlow || 0)) + " BTC" : "Insufficient Data",
    extra: `<div class="analytics-meta">F: BuyValue − SellValue</div>
      <div class="analytics-meta">V: commodityOrders BUY/SELL values</div>
      ${maxNF ? `<div class="analytics-meta">Largest flow: ${hl(maxNF.itemName, "Liquidity Indicator")} (${(maxNF.netOrderFlow >= 0 ? "+" : "") + fmtMoney(Math.abs(maxNF.netOrderFlow || 0))} BTC)</div>` : ""}`,
    interpretation: maxNF ? (maxNF.netOrderFlow > 0 ? "Net buying across tracked commodities." : "Net selling across tracked commodities.") : "",
  }));

  cards.push(predCard("Liquidity Score", "Liquidity Indicator", "", {
    value: fmtNum(p.predictions.reduce((s, p2) => s + (p2.liquidityScore || 0), 0)),
    extra: `<div class="analytics-meta">F: Σ(All Order Quantities)</div>
      <div class="analytics-meta">V: commodityOrders (all sides)</div>
      <div class="analytics-meta">Total order book depth across all tracked commodities</div>`,
    interpretation: "Aggregate market liquidity from visible order books.",
  }));

  const whales = p.predictions.filter(p2 => p2.whaleDetected);
  cards.push(predCard("Whale Detection", "Liquidity Indicator", "", {
    value: whales.length > 0 ? `${whales.length} whale${whales.length > 1 ? "s" : ""} detected` : "No whales",
    extra: `<div class="analytics-meta">F: LargestOrderQty ÷ TotalOrderQty ≥ 35%</div>
      <div class="analytics-meta">V: commodityOrders quantities</div>
      ${whales.length ? `<div class="analytics-meta">${whales.map(w => hl(w.itemName, "Liquidity Indicator") + " (" + (w.largeOrderWeight * 100).toFixed(0) + "%)").join(", ")}</div>` : `<div class="analytics-meta">No commodity has a single order ≥35% of its order book.</div>`}`,
    interpretation: whales.length ? `${whales.length} commodities show whale activity — large single orders dominating order books.` : "No whale activity detected.",
  }));

  const stableCount = Object.keys(S.market._prevScoresSnapshot || {}).length;

  cards.push(predCard("Rank Stability", "Rank Indicator", "", {
    value: stableCount > 1 ? stableCount + " ranked items" : "Insufficient History",
    extra: `<div class="analytics-meta">F: σ of historical rank positions</div>
      <div class="analytics-meta">V: commodity ranks (2 snapshots min)</div>
      <div class="analytics-meta">${stableCount > 1 ? stableCount + " commodities with previous rank data" : "Need 2+ data points"}</div>`,
    interpretation: stableCount > 1 ? `${stableCount} commodities have rank history for stability analysis.` : "",
  }));

  const risers = p.predictions.filter(p2 => p2.rankChange != null && p2.rankChange > 0).length;
  const fallers = p.predictions.filter(p2 => p2.rankChange != null && p2.rankChange < 0).length;

  cards.push(predCard("Rank Momentum", "Rank Indicator", "", {
    value: risers + " risers",
    extra: `<div class="analytics-meta">F: ΔRank = PrevRank − CurrRank</div>
      <div class="analytics-meta">V: current rank order, prevCommodityScores rank order</div>
      <div class="analytics-meta">Risers: ${risers} · Fallers: ${fallers}</div>`,
    interpretation: `${risers} commodities rising, ${fallers} falling.`,
  }));

  cards.push(predCard("Market Rotation Index", "Rank Indicator", "", {
    value: p.marketRotationIndex + " changes",
    extra: `<div class="analytics-meta">F: Σ(rank changed between consecutive snapshots)</div>
      <div class="analytics-meta">V: current ranks, previous ranks</div>
      <div class="analytics-meta">${p.marketRotationIndex} commodities changed position since last snapshot</div>`,
    interpretation: p.marketRotationIndex > 5 ? "High rotation — market undergoing active reallocation." : p.marketRotationIndex > 2 ? "Moderate rotation — some sector shifting detected." : "Low rotation — ranks relatively stable.",
  }));

  cards.push(predCard("Prediction Confidence", "Confidence Indicator", "", {
    value: p.confidence != null ? p.confidence + "/100" : "Insufficient Data",
    extra: `<div class="analytics-meta">F: 0.40×Hc + 0.30×Mc + 0.20×Liq + 0.10×Rs</div>
      <div class="analytics-meta">V: history arrays, momentum values, liquidity, rank data</div>
      <div class="analytics-meta">History: ${(p.historyCompleteness * 100).toFixed(0)}% · Momentum: ${(p.momentumConsistency * 100).toFixed(0)}% · Liquidity: ${(p.liquidityNorm * 100).toFixed(0)}% · Rank: ${(p.rankStabilityScore * 100).toFixed(0)}%</div>`,
    interpretation: p.confidence >= 70 ? "High confidence — sufficient history and consistent momentum." : p.confidence >= 40 ? "Moderate confidence — more data improves accuracy." : "Low confidence — limited history available.",
  }));

  cardsGrid.innerHTML = cards.join("");
  renderOutlook(p, section);}

function renderOutlook(p, section) {
  const existing = section.querySelector(".prediction-outlook");
  const hasHistory = p.itemsWithHistory.length > 0;

  const bullishHtml = p.topBullish.length
    ? p.topBullish.map(k => {
        const h = p.heatScores[k];
        const name = h?.pred?.itemName || k;
        return `<div class="exec-summary-row"><span class="exec-label" style="color:var(--green)">▲ ${name}</span><span class="exec-value">${h ? h.score.toFixed(1) : "N/A"} · ${h ? h.trend : "N/A"}</span></div>`;
      }).join("")
    : `<div class="exec-summary-row"><span class="exec-label">None</span><span class="exec-value">No bullish commodities</span></div>`;

  const bearishHtml = p.topBearish.length
    ? p.topBearish.map(k => {
        const h = p.heatScores[k];
        const name = h?.pred?.itemName || k;
        return `<div class="exec-summary-row"><span class="exec-label" style="color:var(--red)">▼ ${name}</span><span class="exec-value">${h ? h.score.toFixed(1) : "N/A"} · ${h ? h.trend : "N/A"}</span></div>`;
      }).join("")
    : `<div class="exec-summary-row"><span class="exec-label">None</span><span class="exec-value">No bearish commodities</span></div>`;

  const changesHtml = p.potentialChanges.length
    ? p.potentialChanges.map(pc => {
        const dir = pc.rankChange > 0 ? "▲ up" : "▼ down";
        const col = pc.rankChange > 0 ? "var(--green)" : "var(--red)";
        return `<div class="exec-summary-row"><span class="exec-label">${pc.itemName}</span><span class="exec-value" style="color:${col}">${dir} ${Math.abs(pc.rankChange)} rank${Math.abs(pc.rankChange) > 1 ? "s" : ""}</span></div>`;
      }).join("")
    : `<div class="exec-summary-row"><span class="exec-label">Stable</span><span class="exec-value">No significant rank changes predicted</span></div>`;

  const outlookHtml = `<div class="market-card analytics-exec-card prediction-outlook" style="grid-column:1/-1;margin-top:16px">
    <div class="market-card-header"><span class="market-card-title">Next 24–72 Hour Commodity Outlook</span> ${badge("Prediction Indicator")}</div>
    <div class="analytics-exec-body">
      <div class="exec-outlook">
        ${hasHistory ? `<p class="analytics-assess-summary">${p.outlook.summary}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">
          <div class="exec-summary">
            <div class="exec-summary-row" style="border:none;padding-bottom:4px"><span class="exec-label" style="font-weight:600;color:var(--accent)">Top Bullish</span><span class="exec-value"></span></div>
            ${bullishHtml}
          </div>
          <div class="exec-summary">
            <div class="exec-summary-row" style="border:none;padding-bottom:4px"><span class="exec-label" style="font-weight:600;color:var(--accent)">Top Bearish</span><span class="exec-value"></span></div>
            ${bearishHtml}
          </div>
          <div class="exec-summary">
            <div class="exec-summary-row" style="border:none;padding-bottom:4px"><span class="exec-label" style="font-weight:600;color:var(--accent)">Potential Ranking Changes</span><span class="exec-value"></span></div>
            ${changesHtml}
          </div>
        </div>`
        : `<p class="analytics-assess-summary">Insufficient history for commodity outlook. At least two data snapshots are required.</p>`}
      </div>
    </div>
  </div>`;

  if (existing) existing.outerHTML = outlookHtml;
  else {
    const div = document.createElement("div");
    div.innerHTML = outlookHtml;
    section.querySelector(".prediction-cards-grid")?.after(div.firstElementChild);
  }
}
