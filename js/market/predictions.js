import { S } from "../core/state.js";
import { marketItemName } from "../core/utils.js";

export function computePredictions() {
  const topValuable = S.market.topValuable || [];
  const prevScores = S.market._prevScoresSnapshot || S.market.prevCommodityScores || {};
  const commodityOrders = S.market.commodityOrders || [];
  const orders = S.market.orders || [];

  const now = Date.now();
  const prevTime = S.market._lastUpdateTime || now;
  const deltaT = now - prevTime;
  S.market._lastUpdateTime = now;

  const currentRanks = {};
  topValuable.forEach((item, idx) => { currentRanks[item.item || item.itemCode] = idx + 1; });

  const prevSorted = Object.entries(prevScores).filter(([k, v]) => isFinite(v)).sort((a, b) => b[1] - a[1]);
  const prevRanks = {};
  prevSorted.forEach(([key], idx) => { prevRanks[key] = idx + 1; });

  const totalValue = topValuable.reduce((s, i) => s + (i.value || 0), 0);
  const predictions = [];

  for (const item of topValuable) {
    const itemKey = item.item || item.itemCode;
    const currentValue = item.value || 0;
    const previousValue = prevScores[itemKey];
    const currentRank = currentRanks[itemKey] || 0;
    const previousRank = prevRanks[itemKey] || 0;

    const valueGrowth = (previousValue != null && previousValue > 0) ? ((currentValue - previousValue) / previousValue) * 100 : null;

    const deltaValue = (previousValue != null) ? currentValue - previousValue : null;
    const valueVelocity = (deltaValue != null && deltaT > 0) ? deltaValue / (deltaT / 1000) : null;

    const prevVelocity = S.market._prevVelocities ? S.market._prevVelocities[itemKey] : null;
    const valueAcceleration = (valueVelocity != null && prevVelocity != null) ? valueVelocity - prevVelocity : null;

    if (!S.market._prevVelocities) S.market._prevVelocities = {};
    S.market._prevVelocities[itemKey] = valueVelocity;

    const itemOrders = commodityOrders.filter(o => (o._itemCode || o.itemCode) === itemKey);
    const buyOrders = itemOrders.filter(o => (o._side || o.orderType || o.type || o.side || "").toUpperCase() === "BUY");
    const sellOrders = itemOrders.filter(o => (o._side || o.orderType || o.type || o.side || "").toUpperCase() === "SELL");
    const undefOrders = itemOrders.filter(o => {
      const s = (o._side || o.orderType || o.type || o.side || "").toUpperCase();
      return s !== "BUY" && s !== "SELL";
    });
    const buyQty = buyOrders.reduce((s, o) => s + (o._qty || o.quantity || 0), 0);
    const sellQty = sellOrders.reduce((s, o) => s + (o._qty || o.quantity || 0), 0);
    const totalItemQty = buyQty + sellQty;

    const buyValue = buyOrders.reduce((s, o) => s + (o._qty || o.quantity || 0) * (o._price || o.price || 0), 0);
    const sellValue = sellOrders.reduce((s, o) => s + (o._qty || o.quantity || 0) * (o._price || o.price || 0), 0);

    const buyPressure = totalItemQty > 0 ? buyQty / totalItemQty : null;
    const sellPressure = totalItemQty > 0 ? sellQty / totalItemQty : null;
    const pressureRatio = sellQty > 0 ? buyQty / sellQty : (buyQty > 0 ? Infinity : null);
    const netOrderFlow = buyValue - sellValue;
    const liquidityScore = totalItemQty;

    const allQtys = itemOrders.map(o => o._qty || o.quantity || 0);
    const largestQty = allQtys.length ? Math.max(...allQtys) : 0;
    const largeOrderWeight = totalItemQty > 0 ? largestQty / totalItemQty : 0;
    const whaleDetected = largeOrderWeight >= 0.35;

    const marketShare = totalValue > 0 ? currentValue / totalValue : 0;
    const rankChange = previousRank > 0 ? previousRank - currentRank : null;
    const rankGain = rankChange != null ? Math.max(0, rankChange) : null;

    predictions.push({
      itemKey, itemName: marketItemName(itemKey),
      currentValue, previousValue, valueGrowth,
      valueVelocity, valueAcceleration,
      buyPressure, sellPressure, pressureRatio,
      netOrderFlow, liquidityScore,
      largeOrderWeight, whaleDetected,
      marketShare, currentRank, previousRank, rankChange, rankGain,
      buyQty, sellQty, buyValue, sellValue,
    });
  }

  let rotationCount = 0;
  for (const item of topValuable) {
    const itemKey = item.item || item.itemCode;
    const cr = currentRanks[itemKey] || 0;
    const pr = prevRanks[itemKey] || 0;
    if (pr > 0 && cr > 0 && pr !== cr) rotationCount++;
  }
  const marketRotationIndex = rotationCount;

  const heatScores = {};
  for (const pred of predictions) {
    if (pred.previousValue == null) continue;
    const ng = normalizeVal(pred.valueGrowth, predictions.map(p => p.valueGrowth).filter(v => v != null));
    const nb = normalizeVal(pred.buyPressure, predictions.map(p => p.buyPressure).filter(v => v != null));
    const nl = normalizeVal(pred.liquidityScore, predictions.map(p => p.liquidityScore).filter(v => v != null));
    const nr = normalizeVal(pred.rankGain, predictions.map(p => p.rankGain).filter(v => v != null));
    const heat = (0.35 * (ng ?? 50)) + (0.30 * (nb ?? 50)) + (0.20 * (nl ?? 50)) + (0.15 * (nr ?? 50));
    const trend = heat >= 80 ? "Strong Bullish" : heat >= 60 ? "Bullish" : heat >= 40 ? "Stable" : heat >= 20 ? "Bearish" : "Strong Bearish";
    heatScores[pred.itemKey] = { score: heat, trend, pred };
  }

  const histSources = [S.market.wageHistory, S.market.tradeVolHistory, S.market.priceHistory, S.market.payrollHistory];
  const histCount = histSources.filter(h => h && h.length > 1).length;
  const historyCompleteness = histSources.length > 0 ? histCount / histSources.length : 0;

  const momVals = predictions.map(p => p.valueGrowth).filter(v => v != null);
  const momMean = momVals.length ? momVals.reduce((s, v) => s + v, 0) / momVals.length : 0;
  const momVar = momVals.length > 1 ? momVals.reduce((s, v) => s + (v - momMean) ** 2, 0) / momVals.length : 0;
  const momStd = Math.sqrt(momVar);
  const momConsistency = momVals.length > 1 ? Math.max(0, Math.min(1, 1 - (momStd / (Math.abs(momMean) || 1)))) : 0;

  const totalLiq = predictions.reduce((s, p) => s + (p.liquidityScore || 0), 0);
  const liqNorm = Math.min(1, totalLiq / 10000);

  const rankCount = Object.keys(prevScores).length;
  const rankScore = Math.min(1, rankCount / 20);

  const confidence = ((0.40 * historyCompleteness) + (0.30 * momConsistency) + (0.20 * liqNorm) + (0.10 * rankScore)) * 100;

  const sortedHeat = Object.entries(heatScores).sort((a, b) => b[1].score - a[1].score);
  const topBullish = sortedHeat.filter(([k, v]) => v.score >= 60).slice(0, 3);
  const topBearish = sortedHeat.filter(([k, v]) => v.score < 40).slice(-3).reverse();

  const potentialChanges = predictions.filter(p => p.rankChange != null && Math.abs(p.rankChange) >= 1)
    .sort((a, b) => Math.abs(b.rankChange || 0) - Math.abs(a.rankChange || 0)).slice(0, 5);

  const outlook = generateOutlook(heatScores, predictions, marketRotationIndex, confidence);

  return {
    predictions, heatScores, marketRotationIndex,
    confidence: Math.round(Math.max(0, Math.min(100, confidence))),
    topBullish: topBullish.map(([k]) => k),
    topBearish: topBearish.map(([k]) => k),
    potentialChanges, outlook,
    historyCompleteness, momentumConsistency: momConsistency,
    liquidityNorm: liqNorm, rankStabilityScore: rankScore,
    itemsWithHistory: predictions.filter(p => p.previousValue != null).map(p => p.itemKey),
    totalBullish: sortedHeat.filter(([k, v]) => v.score >= 60).length,
    totalBearish: sortedHeat.filter(([k, v]) => v.score < 40).length,
    totalStable: sortedHeat.filter(([k, v]) => v.score >= 40 && v.score < 60).length,
  };
}

function normalizeVal(val, arr) {
  if (val == null || !arr || arr.length < 2) return 50;
  const mn = Math.min(...arr);
  const mx = Math.max(...arr);
  return mx === mn ? 50 : ((val - mn) / (mx - mn)) * 100;
}

function generateOutlook(heatScores, predictions, rotation, confidence) {
  const scores = Object.values(heatScores);
  if (!scores.length) return { summary: "Insufficient history for outlook.", details: [] };
  const bullish = scores.filter(s => s.trend === "Strong Bullish" || s.trend === "Bullish").length;
  const bearish = scores.filter(s => s.trend === "Strong Bearish" || s.trend === "Bearish").length;
  const stable = scores.filter(s => s.trend === "Stable").length;
  const total = scores.length;
  let summary;
  if (bullish > bearish && bullish > total * 0.4) summary = "Bullish bias detected — commodity market expected to strengthen over 24–72 hours. Watch for continued buying pressure and rank upgrades.";
  else if (bearish > bullish && bearish > total * 0.4) summary = "Bearish bias detected — commodity market expected to weaken over 24–72 hours. Monitor for selling pressure and rank downgrades.";
  else if (rotation > total * 0.5) summary = "High market rotation — significant ranking shifts expected. Watch for emerging commodities gaining momentum.";
  else summary = "Market showing mixed signals — no dominant directional bias. Individual commodity selection recommended.";
  const topMovers = Object.entries(heatScores).sort((a, b) => b[1].score - a[1].score).slice(0, 3);
  const bottomMovers = Object.entries(heatScores).sort((a, b) => a[1].score - b[1].score).slice(0, 3);
  const details = [
    `Bullish: ${bullish}/${total} · Bearish: ${bearish}/${total} · Stable: ${stable}/${total}`,
    `Market Rotation Index: ${rotation} commodities changed rank`,
    `Top momentum: ${topMovers.map(([k, v]) => k + " (" + v.trend + ")").join(", ")}`,
    `Weakest momentum: ${bottomMovers.map(([k, v]) => k + " (" + v.trend + ")").join(", ")}`,
  ];
  return { summary, details };
}
