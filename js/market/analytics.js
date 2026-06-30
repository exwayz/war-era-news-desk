import { S } from "../core/state.js";

const MAX_HISTORY = 48;

export function ensureHistories() {
  for (const k of ["tradeVolHistory","payrollHistory","ppHistory","hhiHistory","circulationHistory","tradeEfficiencyHistory","basketHistory"]) {
    if (!S.market[k]) S.market[k] = [];
  }
}

export function aggregateDatasets() {
  const ec = S.market.econ;
  return {
    econ: ec,
    prices: S.market.prices || [],
    orders: S.market.orders || [],
    topValuable: S.market.topValuable || [],
    wageHistory: S.market.wageHistory || [],
    priceHistory: S.market.priceHistory || [],
    jobs: S.jobs || [],
    commodityOrders: S.market.commodityOrders || [],
    prevScores: S.market.prevCommodityScores || {},
  };
}

export function calculatePrimary(d) {
  if (!d.econ) return null;
  const P = d.econ.totalPayroll || 0;
  const H = d.econ.totalQuantity || 0;
  const Tw = d.econ.wageCount || 0;
  const Tv = d.econ.tradeVol || 0;
  const Tt = d.econ.tradeCount || 0;
  const Pw = d.econ.avgWage || (H > 0 ? P / H : 0);
  const prices = d.prices.slice(0, 10);
  const Basket = prices.length ? prices.reduce((s, i) => s + Number(i.price || i.value || 0), 0) / prices.length : 0;
  const Vc = d.topValuable.reduce((s, i) => s + (i.value || 0), 0);
  let Javg = null, Jmin = null, Jmax = null;
  const jw = d.jobs.map(j => Number(j.wage || j.price || j.amount || 0)).filter(w => w > 0);
  if (jw.length) {
    Javg = jw.reduce((s, w) => s + w, 0) / jw.length;
    Jmin = Math.min(...jw);
    Jmax = Math.max(...jw);
  }
  const topWage = d.econ.topOffer;
  const wageMin = d.econ.wageMin;
  const wageMax = d.econ.wageMax;
  return { P, H, Tw, Tv, Tt, Pw, Basket, Vc, Javg, Jmin, Jmax, topWage, wageMin, wageMax, topValuable: d.topValuable };
}

export function calculateStats(d, p) {
  if (!p) return null;
  const vals = d.prices.map(i => Number(i.price || i.value || 0)).filter(v => v > 0);
  const n = vals.length;
  if (!n) return { priceMean: 0, priceMedian: 0, priceStdDev: 0, priceCV: 0 };
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  return { priceMean: mean, priceMedian: median, priceStdDev: stdDev, priceCV: mean > 0 ? stdDev / mean : 0 };
}

export function calculateDerived(p, stats, h) {
  if (!p || !stats) return null;
  const circulation = (p.P + p.Tv) > 0 ? p.Tv / (p.P + p.Tv) : 0;
  const pp = p.Basket > 0 ? p.Pw / p.Basket : 0;
  const hhi = p.Vc > 0 ? p.topValuable.reduce((s, i) => { const sh = (i.value || 0) / p.Vc; return s + sh * sh; }, 0) * 10000 : 0;
  const tradeEfficiency = p.Tt > 0 ? p.Tv / p.Tt : 0;

  const prev = h && h.prev ? h.prev : null;
  const tradeMom = prev && prev.Tv > 0 ? ((p.Tv - prev.Tv) / prev.Tv) * 100 : null;
  const payrollMom = prev && prev.P > 0 ? ((p.P - prev.P) / prev.P) * 100 : null;
  const wageMom = prev && prev.Pw > 0 ? ((p.Pw - prev.Pw) / prev.Pw) * 100 : null;
  const priceMom = prev && prev.Basket > 0 ? ((p.Basket - prev.Basket) / prev.Basket) * 100 : null;
  const ppMom = prev && prev.pp > 0 ? ((pp - prev.pp) / prev.pp) * 100 : null;
  const hhiMom = prev && prev.hhi > 0 ? ((hhi - prev.hhi) / prev.hhi) * 100 : null;

  const ma5 = (arr, val) => {
    const all = [...arr.slice(-4), val].filter(v => isFinite(v));
    return all.length ? all.reduce((s, v) => s + v, 0) / all.length : null;
  };

  return {
    circulation, pp, hhi, tradeEfficiency,
    tradeMom, payrollMom, wageMom, priceMom, ppMom, hhiMom,
    tradeMa5: ma5(S.market.tradeVolHistory, p.Tv),
    payrollMa5: ma5(S.market.payrollHistory, p.P),
    ppMa5: ma5(S.market.ppHistory, pp),
    hhiMa5: ma5(S.market.hhiHistory, hhi),
  };
}

export function classifyEconomy(d) {
  const h = d;
  if (!h) return { status: "N/A", label: "Insufficient Data" };
  const t = h.tradeMom, pr = h.payrollMom, pi = h.priceMom;
  if (t == null || pr == null || pi == null) return { status: "N/A", label: "Insufficient Data" };
  if (Math.abs(pi) > 8 || (h.hhiMom != null && h.hhiMom > 15)) return { status: "volatile", label: "Volatile", color: "var(--red)" };
  if (t < -5 && pr < -5) return { status: "contraction", label: "Contraction", color: "var(--dark-red)" };
  if (t < 0 && pr < 0 && pi <= 0) return { status: "cooling", label: "Cooling", color: "var(--yellow)" };
  if (t > 5 && pr > 3 && pi > -3 && pi < 5) return { status: "expansion", label: "Expansion", color: "var(--green)" };
  if (t >= -3 && t <= 3 && pr >= -3 && pr <= 3 && pi >= -3 && pi <= 3) return { status: "stable", label: "Stable", color: "var(--blue)" };
  return { status: "mixed", label: "Mixed Signals", color: "var(--accent)" };
}

export function calculateHealthScore(d) {
  if (!d || d.tradeMom == null || d.ppMom == null) return null;

  const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
  const momScore = (mom) => {
    if (mom == null) return 50;
    if (mom > 20) return 100;
    if (mom < -20) return 0;
    return 50 + mom * 2.5;
  };
  const invert = (v) => Math.max(0, Math.min(100, 100 - v));

  const tradeScore = momScore(d.tradeMom) * 0.2;
  const ppScore = momScore(d.ppMom) * 0.2;
  const hhiScore = d.hhi != null ? invert((d.hhi / 10000) * 100) * 0.15 : 50 * 0.15;
  const circScore = (d.circulation != null ? d.circulation * 100 : 50) * 0.15;
  const labourScore = momScore(d.wageMom) * 0.1;
  const commodScore = d.priceMom != null ? invert(Math.abs(d.priceMom) * 5) * 0.1 : 50 * 0.1;
  const momentumScore = momScore((d.tradeMom + (d.wageMom || 0) + (d.ppMom || 0)) / 3) * 0.1;

  const total = clamp(tradeScore + ppScore + hhiScore + circScore + labourScore + commodScore + momentumScore);
  const level = total >= 90 ? "Excellent" : total >= 75 ? "Strong" : total >= 60 ? "Healthy" : total >= 40 ? "Weak" : total >= 20 ? "Critical" : "Collapse";
  return { score: Math.round(total), level };
}

export function generateWarnings(d) {
  const w = [];
  if (!d) return w;
  if (d.priceMom != null && d.priceMom > 5) w.push({ level: "WARNING", indicator: "Inflation Pressure", reason: "Price momentum exceeds +5%", icon: "▲" });
  if (d.wageMom != null && d.wageMom > 8) w.push({ level: "CAUTION", indicator: "Labour Shortage", reason: "Wage momentum exceeds +8%", icon: "⚠" });
  if (d.priceMom != null && Math.abs(d.priceMom) > 8) w.push({ level: "WARNING", indicator: "Commodity Bubble", reason: "Price volatility exceeds 8%", icon: "⚡" });
  if (d.tradeMom != null && d.tradeMom < -5) w.push({ level: "WARNING", indicator: "Trade Slowdown", reason: "Trade momentum below -5%", icon: "▼" });
  if (d.tradeMom != null && d.tradeMom > 15) w.push({ level: "INFO", indicator: "Trade Surge", reason: "Trade momentum above +15%", icon: "▲" });
  if (d.hhi != null && d.hhi > 2500) w.push({ level: "WARNING", indicator: "High Market Concentration", reason: "HHI exceeds 2500", icon: "◆" });
  if (d.hhi != null && d.hhi < 1000) w.push({ level: "INFO", indicator: "Competitive Market", reason: "HHI below 1000", icon: "✓" });
  if (d.ppMom != null && d.ppMom < -5) w.push({ level: "CAUTION", indicator: "Weak Purchasing Power", reason: "Purchasing power declining", icon: "↓" });
  if (d.circulation != null && d.circulation < 0.3) w.push({ level: "CAUTION", indicator: "Low Economic Circulation", reason: "Trade-to-wage ratio below 30%", icon: "↻" });
  const military = ["heavyAmmo","lightAmmo","ammo","steel","case1","case2"];
  const topMil = (S.market.topValuable || []).slice(0, 5).filter(i => military.includes(i.item || i.itemCode || "")).length;
  if (topMil >= 3) w.push({ level: "INFO", indicator: "Military Production Focus", reason: `${topMil}/5 top commodities are military`, icon: "⚔" });
  return w;
}

export function generateAssessment(p, d, warnings) {
  if (!p || !d) return { summary: "Insufficient data for assessment.", paragraphs: [] };
  const ec = d;
  const lines = [];
  const mom = (v, up, down) => v == null ? "stable" : v > 2 ? up : v < -2 ? down : "stable";
  const fmtPct = (v) => v == null ? "N/A" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";

  if (ec.wageMom != null) {
    if (ec.wageMom > 3) lines.push({ topic: "Labour Market", text: `Wages rising ${fmtPct(ec.wageMom)} — labour demand is high. Workers benefit from competitive hiring.` });
    else if (ec.wageMom < -3) lines.push({ topic: "Labour Market", text: `Wages declining ${fmtPct(ec.wageMom)} — labour demand softening. Employers reducing costs.` });
    else lines.push({ topic: "Labour Market", text: `Wage growth stable at ${fmtPct(ec.wageMom)}. Labour market conditions normal.` });
  }
  if (ec.pp != null && ec.ppMom != null) {
    if (ec.ppMom > 2) lines.push({ topic: "Purchasing Power", text: `Purchasing power improving ${fmtPct(ec.ppMom)} — average wage outpaces commodity prices.` });
    else if (ec.ppMom < -2) lines.push({ topic: "Purchasing Power", text: `Purchasing power declining ${fmtPct(ec.ppMom)} — commodity prices rising faster than wages.` });
    else lines.push({ topic: "Purchasing Power", text: `Purchasing power stable relative to commodity basket.` });
  }
  if (d.hhi != null) {
    if (d.hhi > 2500) lines.push({ topic: "Market Concentration", text: `Market is highly concentrated (HHI ${d.hhi.toFixed(0)}). Dominant commodities control significant value.` });
    else if (d.hhi > 1500) lines.push({ topic: "Market Concentration", text: `Moderate market concentration (HHI ${d.hhi.toFixed(0)}). Some commodities dominate trade.` });
    else lines.push({ topic: "Market Concentration", text: `Market is competitive (HHI ${d.hhi.toFixed(0)}). Value distributed across many commodities.` });
  }
  if (ec.tradeMom != null) {
    if (ec.tradeMom > 5) lines.push({ topic: "Market Liquidity", text: `Trade volume surging ${fmtPct(ec.tradeMom)} — high market liquidity and activity.` });
    else if (ec.tradeMom < -5) lines.push({ topic: "Market Liquidity", text: `Trade volume contracting ${fmtPct(ec.tradeMom)} — declining market liquidity.` });
    else lines.push({ topic: "Market Liquidity", text: `Trade activity showing normal fluctuation ${fmtPct(ec.tradeMom)}.` });
  }
  if (ec.priceMom != null && Math.abs(ec.priceMom) > 3) {
    lines.push({ topic: "Inflation Pressure", text: `Commodity basket ${ec.priceMom > 0 ? "rising" : "falling"} ${fmtPct(ec.priceMom)} — ${ec.priceMom > 0 ? "inflationary" : "deflationary"} pressure detected.` });
  }
  if (ec.circulation != null) {
    const pct = (ec.circulation * 100).toFixed(0);
    lines.push({ topic: "Economic Circulation", text: `${pct}% of economic activity is trade-based. ${ec.circulation > 0.5 ? "Healthy trade-to-wage balance." : "Wages dominate over trade — lower velocity of money."}` });
  }
  const mil = (warnings || []).find(w => w.indicator === "Military Production Focus");
  if (mil) lines.push({ topic: "Strategic Economy", text: `Military commodities dominate top-valued items — possible wartime industrial mobilisation.` });

  const risks = warnings.filter(w => w.level === "WARNING").map(w => w.indicator);
  const summary = risks.length
    ? `${risks.length} active warning${risks.length > 1 ? "s" : ""}: ${risks.join(", ")}. Monitor highlighted indicators.`
    : "No active warnings — economic indicators within normal ranges.";
  return { summary, paragraphs: lines };
}

export function updateHistories(p, d) {
  if (!p) return;
  ensureHistories();
  const push = (arr, val) => { if (isFinite(val)) { arr.push(val); if (arr.length > MAX_HISTORY) arr.shift(); } };
  push(S.market.tradeVolHistory, p.Tv);
  push(S.market.payrollHistory, p.P);
  if (d && d.pp != null) push(S.market.ppHistory, d.pp);
  if (d && d.hhi != null) push(S.market.hhiHistory, d.hhi);
  if (d && d.circulation != null) push(S.market.circulationHistory, d.circulation);
  if (d && d.tradeEfficiency != null) push(S.market.tradeEfficiencyHistory, d.tradeEfficiency);
  if (p.Basket > 0) push(S.market.basketHistory, p.Basket);
}

export function getPrevious() {
  const h = S.market;
  const last = (arr) => arr && arr.length > 0 ? arr[arr.length - 1] : null;
  return {
    Tv: last(h.tradeVolHistory),
    P: last(h.payrollHistory),
    Pw: h.wageHistory && h.wageHistory.length > 0 ? h.wageHistory[h.wageHistory.length - 1].avg : null,
    Basket: last(h.basketHistory),
    pp: last(h.ppHistory),
    hhi: last(h.hhiHistory),
  };
}

export function calculateAnalytics() {
  ensureHistories();
  const datasets = aggregateDatasets();
  const p = calculatePrimary(datasets);
  const stats = calculateStats(datasets, p);
  const prev = getPrevious();
  const d = calculateDerived(p, stats, { prev });
  const econClass = classifyEconomy(d);
  const healthScore = calculateHealthScore(d);
  const warnings = generateWarnings(d);
  const assessment = generateAssessment(p, d, warnings);
  return { datasets, p, stats, d, econClass, healthScore, warnings, assessment };
}
