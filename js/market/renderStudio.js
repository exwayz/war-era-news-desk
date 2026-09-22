// renderStudio.js — Interactive Production Cost Studio + Worker Yield Analysis
// Live-data ports of the "Spectator Tools" (PCS / WYA), fed by production.js rows.

import {
  goodName, studioCost, studioNet,
  studioBreakevenRaw, studioBreakevenFidelity,
} from "./production.js";

const PAL = ["#8C2A1B", "#3B6D11", "#1F6B6B", "#6A3D7A", "#B8860B", "#2F4858", "#A0522D", "#2C4A6A", "#A060C0", "#5C2E10"];
const FIDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function fmt4(v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const n = a >= 100 ? 2 : a >= 1 ? 3 : 4;
  return v.toFixed(n);
}

function fmtTick(v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

function niceY(min, max, ticks) {
  if (min === max) { const v = min || 1; return [v - 1, v, v + 1]; }
  const range = max - min;
  const rough = range / (ticks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm <= 1.5 ? mag : norm <= 3.5 ? 2 * mag : norm <= 7.5 ? 5 * mag : 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.5; v += step) out.push(v);
  if (!out.length) out.push(min, max);
  return out;
}

function grossFor(mode, wage, tax) { return mode === "gross" ? wage : wage / (1 - tax / 100); }
function netFor(mode, wage, tax) { return mode === "gross" ? wage * (1 - tax / 100) : wage; }

// Effective per-good cost / net for a row given wage mode + amount.
function costFor(row, mode, wage, fid, raw) {
  return studioCost(row, netFor(mode, wage, Number(row.incomeTax || 0)), fid, raw);
}
function netPerPP(row, mode, wage, fid, raw, sell) {
  return studioNet(row, netFor(mode, wage, Number(row.incomeTax || 0)), fid, raw, sell) / Number(row.pp || 1);
}

function beTxt(x, rawMin, rawMax) {
  if (x == null || !isFinite(x)) return '<span class="prod-neg">—</span>';
  if (x <= 0) return '<span class="prod-neg">never</span>';
  if (x >= rawMax) return '<span class="prod-profit">always</span>';
  if (x <= rawMin) return '<span class="prod-dim">below range</span>';
  return fmt4(x);
}

function beFTxt(f) {
  if (f == null || !isFinite(f)) return '<span class="prod-neg">never</span>';
  if (f <= 1) return '<span class="prod-profit">always</span>';
  if (f > 10) return '<span class="prod-neg">never</span>';
  return f.toFixed(1) + '%';
}

function liveMark(r) {
  return r.liveDeposit ? `<span class="prod-live" title="Active deposit +${r.depositBonus}%">LIVE +${r.depositBonus}%</span>` : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost Studio
// ─────────────────────────────────────────────────────────────────────────────

let _cont = null, _built = false;
let _rows = [], _byProduct = new Map(), _products = [];

function buildBandChart(rows, sels, mode, wage, fidMin, fidMax, rawMin, rawMax, sell, prodName, rawName) {
  const N = 7;
  const xs = [];
  if (!(rawMax > rawMin)) xs.push(rawMin || 0);
  else for (let i = 0; i < N; i++) xs.push(rawMin + (rawMax - rawMin) * i / (N - 1));
  const avgRaw = xs.reduce((a, b) => a + b, 0) / xs.length;

  const bands = sels.slice(0, 10).map((r, i) => ({
    r, color: PAL[i % PAL.length],
    up: xs.map(x => costFor(r, mode, wage, fidMin, x)),
    lo: xs.map(x => costFor(r, mode, wage, fidMax, x)),
  }));

  let all = isFinite(sell) ? [sell] : [];
  for (const b of bands) all = all.concat(b.up, b.lo);
  if (!all.length) all = [0, 1];
  let mn = Math.min(...all), mx = Math.max(...all);
  let pad = (mx - mn) * 0.08 || Math.max(0.02, Math.abs(mx) * 0.05);
  mn -= pad; mx += pad;

  const W = 760, H = 280, padL = 72, padR = 18, padT = 14, padB = 32;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xPos = x => rawMax > rawMin ? padL + ((x - rawMin) / (rawMax - rawMin)) * plotW : padL + plotW / 2;
  const yPos = v => padT + plotH - ((v - mn) / (mx - mn)) * plotH;
  const yTicks = niceY(mn, mx, 5);
  const xTicks = rawMax > rawMin ? Array.from({ length: 5 }, (_, i) => rawMin + (rawMax - rawMin) * i / 4) : [rawMin || 0];

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="prod-band-svg" role="img" aria-label="Production cost band chart">`;
  for (const t of yTicks) {
    svg += `<line x1="${padL}" y1="${yPos(t).toFixed(1)}" x2="${W - padR}" y2="${yPos(t).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
    svg += `<text x="${padL - 6}" y="${(yPos(t) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--ink-caption)" font-family="var(--font-num)">${fmtTick(t)}</text>`;
  }
  for (const x of xTicks) {
    svg += `<line x1="${xPos(x).toFixed(1)}" y1="${padT}" x2="${xPos(x).toFixed(1)}" y2="${H - padB}" stroke="var(--line)" stroke-width="1"/>`;
    svg += `<text x="${xPos(x).toFixed(1)}" y="${H - padB + 14}" text-anchor="middle" font-size="10" fill="var(--ink-caption)" font-family="var(--font-num)">${fmtTick(x)}</text>`;
  }
  let heldBand = 0;
  for (const b of bands) {
    const upPts = b.up.map((v, i) => `${xPos(xs[i]).toFixed(1)},${yPos(v).toFixed(1)}`);
    const loPts = b.lo.map((v, i) => `${xPos(xs[i]).toFixed(1)},${yPos(v).toFixed(1)}`);
    const bandPath = `M${upPts[0]} ${upPts.slice(1).map(p => "L" + p).join(" ")} L${loPts.slice().reverse().join(" L")} Z`;
    svg += `<path d="${bandPath}" fill="${b.color}" fill-opacity="0.12" stroke="none"/>`;
    svg += `<polyline points="${upPts.join(" ")}" fill="none" stroke="${b.color}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
    svg += `<polyline points="${loPts.join(" ")}" fill="none" stroke="${b.color}" stroke-width="1.5"/>`;
    svg += `<circle class="pb-band-dot" data-band="${heldBand}" data-edge="up" cx="0" cy="0" r="3" fill="${b.color}" stroke="var(--bg)" stroke-width="1.5" opacity="0"/>`;
    svg += `<circle class="pb-band-dot" data-band="${heldBand}" data-edge="lo" cx="0" cy="0" r="3" fill="${b.color}" stroke="var(--bg)" stroke-width="1.5" opacity="0"/>`;
    heldBand++;
  }
  if (isFinite(sell)) {
    const sy = yPos(sell);
    svg += `<line class="pb-sell-line" x1="${padL}" y1="${sy.toFixed(1)}" x2="${W - padR}" y2="${sy.toFixed(1)}" stroke="var(--link)" stroke-width="1.5" stroke-dasharray="6,4"/>`;
    svg += `<text x="${W - padR - 4}" y="${(sy - 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--link)" font-family="var(--font-num)">sell ${fmtTick(sell)}</text>`;
    svg += `<circle class="pb-sell-dot" cx="0" cy="0" r="3.5" fill="var(--link)" stroke="var(--bg)" stroke-width="1.5" opacity="0"/>`;
  }
  svg += `<line class="pb-crosshair" x1="0" y1="${padT}" x2="0" y2="${H - padB}" stroke="var(--ink-dim)" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>`;
  svg += `<circle class="pb-crossdot" cx="0" cy="0" r="4.5" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5" opacity="0"/>`;
  svg += `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" class="pb-hover-area"/>`;
  svg += `<text x="${padL}" y="10" font-size="10" fill="var(--ink-caption)" font-family="var(--font-num)">cost to make 1 ${prodName} (₿) · ${rawName} price on x-axis</text>`;
  svg += `</svg>`;

  let legend = bands.map(b =>
    `<span class="prod-legend-item"><span class="sw" style="background:${b.color}"></span>${esc(b.r.regionName)} · ${b.r.incomeTax}% tax · +${b.r.totalBonus}% bonus ${liveMark(b.r)}</span>`
  ).join(" ");

  let rowsHtml = "";
  for (const b of bands) {
    const r = b.r;
    const tax = Number(r.incomeTax || 0);
    const gross = grossFor(mode, wage, tax);
    const netv = netFor(mode, wage, tax);
    const avgUp = b.up.reduce((s, v) => s + v, 0) / xs.length;
    const avgLo = b.lo.reduce((s, v) => s + v, 0) / xs.length;
    const bandAvg = (avgUp + avgLo) / 2;
    const nb = sell - bandAvg;
    const costMin = Math.min(...b.lo), costMax = Math.max(...b.up);
    const beLo = studioBreakevenRaw(r, netv, fidMin, sell);
    const beHi = studioBreakevenRaw(r, netv, fidMax, sell);
    const beF = studioBreakevenFidelity(r, netv, avgRaw, sell);
    rowsHtml += `<tr>
      <td class="prod-cell-name">${esc(r.regionName)} <small class="prod-dim">${esc(r.countryName)}</small> ${liveMark(r)}</td>
      <td class="prod-num">${fmt4(gross)} <small class="prod-dim">(${fmt4(netv)})</small></td>
      <td class="prod-num">${fmt4(bandAvg)}</td>
      <td class="prod-num ${nb >= 0 ? "prod-profit" : "prod-neg"}">${nb >= 0 ? "+" : ""}${fmt4(nb)}</td>
      <td class="prod-num">${fmt4(costMin)}–${fmt4(costMax)}</td>
      <td class="prod-num">${beTxt(beLo, rawMin, rawMax)}<br><small class="prod-dim">@${fidMin}%</small>&nbsp; ${beTxt(beHi, rawMin, rawMax)}<br><small class="prod-dim">@${fidMax}%</small></td>
      <td class="prod-num">${beFTxt(beF)}</td>
    </tr>`;
  }
  const interact = {
    xs, mn, mx, rawMin, rawMax, sell, prodName, rawName,
    W, H, padL, padR, padT, padB,
    bands: bands.map((b, i) => ({
      idx: i, color: b.color, regionName: b.r.regionName,
      incomeTax: b.r.incomeTax, totalBonus: b.r.totalBonus,
      live: !!b.r.liveDeposit, depositBonus: b.r.depositBonus,
      up: b.up, lo: b.lo,
    })),
  };
  return { svg, legend, rows: rowsHtml, interact, title: `Cost to manufacture one ${prodName} (₿)`, xtitle: `${rawName} price (₿/unit)` };
}

/* ── Band chart crosshair ────────────────────────────────
   The production band chart has a continuous raw-price x-axis
   instead of discrete data points, so the crosshair snaps to the
   nearest sampled raw price and reads each band's low/high-fidelity
   edges plus the net benefit vs sell at that point. */
let _pChartTip = null;

function pChartTipEl() {
  if (!_pChartTip) {
    _pChartTip = document.createElement("div");
    _pChartTip.className = "pb-chart-tip";
    _pChartTip.style.cssText = "display:none;position:fixed;z-index:100003;padding:6px 10px;border-radius:6px;background:var(--surface-hi);border:1px solid var(--line);color:var(--ink);font-size:.72rem;line-height:1.5;pointer-events:none;white-space:pre-wrap;max-width:260px;box-shadow:0 4px 12px rgba(0,0,0,.25)";
    document.body.appendChild(_pChartTip);
  }
  return _pChartTip;
}

function initBandChartCrosshair(svg) {
  if (!svg || !svg.dataset.interact || svg._pbXInited) return;
  let d;
  try { d = JSON.parse(svg.dataset.interact); } catch { return; }
  if (!d.xs || !d.bands.length) return;

  const crosshair = svg.querySelector(".pb-crosshair");
  const crossdot = svg.querySelector(".pb-crossdot");
  const hoverArea = svg.querySelector(".pb-hover-area");
  if (!crosshair || !crossdot || !hoverArea) return;

  const vb = svg.viewBox.baseVal;
  const plotW = d.W - d.padL - d.padR, plotH = d.H - d.padT - d.padB;
  const tip = pChartTipEl();

  const xPos = x => d.rawMax > d.rawMin ? d.padL + ((x - d.rawMin) / (d.rawMax - d.rawMin)) * plotW : d.padL + plotW / 2;
  const yPos = v => d.padT + plotH - ((v - d.mn) / (d.mx - d.mn)) * plotH;

  function svgX(e) {
    const rect = svg.getBoundingClientRect();
    return (e.clientX - rect.left) * (vb.width / rect.width);
  }

  function nearest(sx) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < d.xs.length; i++) {
      const dd = Math.abs(xPos(d.xs[i]) - sx);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return best;
  }

  function moveTip(e) {
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 280) + "px";
    tip.style.top = Math.max(e.clientY - 36, 4) + "px";
  }

  function show(i) {
    const x = xPos(d.xs[i]);
    crosshair.setAttribute("x1", x.toFixed(1));
    crosshair.setAttribute("x2", x.toFixed(1));
    crosshair.setAttribute("opacity", "0.5");
    crossdot.setAttribute("cx", x.toFixed(1));
    crossdot.setAttribute("cy", yPos((d.mn + d.mx) / 2).toFixed(1));
    crossdot.setAttribute("opacity", "1");

    const svgEl = svg;
    svgEl.querySelectorAll(".pb-band-dot").forEach(dot => {
      const b = d.bands[+dot.dataset.band];
      if (!b) { dot.setAttribute("opacity", "0"); return; }
      const v = dot.dataset.edge === "up" ? b.up[i] : b.lo[i];
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute("cy", yPos(v).toFixed(1));
      dot.setAttribute("opacity", "1");
    });
    const sellDot = svgEl.querySelector(".pb-sell-dot");
    if (sellDot && isFinite(d.sell)) {
      sellDot.setAttribute("cx", x.toFixed(1));
      sellDot.setAttribute("cy", yPos(d.sell).toFixed(1));
      sellDot.setAttribute("opacity", "1");
    }

    const lines = [`Raw ${d.rawName} price: ${fmtTick(d.xs[i])} ₿/unit`];
    for (const b of d.bands) {
      const up = b.up[i], lo = b.lo[i];
      const mid = (up + lo) / 2;
      const nb = isFinite(d.sell) ? d.sell - mid : null;
      const live = b.live ? ` · LIVE +${b.depositBonus}%` : "";
      lines.push(`<span style="color:${b.color}">■</span> ${esc(b.regionName)} · ${b.incomeTax}% tax · +${b.totalBonus}% bonus${live}`);
      lines.push(`&nbsp;&nbsp;<span class="prod-dim">cost@1% ${fmtTick(lo)} / @10% ${fmtTick(up)}</span>${nb != null ? ` · net <span class="${nb >= 0 ? "prod-profit" : "prod-neg"}">${nb >= 0 ? "+" : ""}${fmtTick(nb)}</span>` : ""}`);
    }
    tip.innerHTML = lines.join("\n");
    tip.style.display = "block";
  }

  function hide() {
    crosshair.setAttribute("opacity", "0");
    crossdot.setAttribute("opacity", "0");
    svg.querySelectorAll(".pb-band-dot").forEach(dot => dot.setAttribute("opacity", "0"));
    const sellDot = svg.querySelector(".pb-sell-dot");
    if (sellDot) sellDot.setAttribute("opacity", "0");
    tip.style.display = "none";
  }

  hoverArea.addEventListener("mousemove", e => {
    show(nearest(svgX(e)));
    moveTip(e);
  });
  hoverArea.addEventListener("mouseleave", hide);

  svg._pbXInited = true;
}

function refreshStudio() {
  const sel = document.getElementById("psProduct");
  if (!sel) return;
  const key = _products[+sel.value];
  const rows = _byProduct.get(key) || [];
  const ref = rows[0];
  const mode = document.getElementById("psWageMode").value;
  let wage = parseFloat(document.getElementById("psWage").value);
  if (!isFinite(wage) || wage <= 0) wage = 0.12;
  let fidMin = parseInt(document.getElementById("psFidMin").value, 10) || 1;
  let fidMax = parseInt(document.getElementById("psFidMax").value, 10) || 10;
  fidMin = Math.max(1, Math.min(10, fidMin));
  fidMax = Math.max(fidMin, Math.min(10, fidMax));
  let rawMin = parseFloat(document.getElementById("psRawMin").value);
  let rawMax = parseFloat(document.getElementById("psRawMax").value);
  const defRaw = Number(ref?.rmPrice || 0);
  if (!isFinite(rawMin)) rawMin = defRaw * 0.98;
  if (!isFinite(rawMax)) rawMax = defRaw * 1.02;
  if (rawMax < rawMin) { const t = rawMin; rawMin = rawMax; rawMax = t; }
  let sell = parseFloat(document.getElementById("psSell").value);
  if (!isFinite(sell)) sell = Number(ref?.goodPrice || 0);

  const checked = new Set([...document.querySelectorAll('#psRegions input[type="checkbox"]:checked')].map(c => c.dataset.rid));
  const sels = rows.filter(r => checked.has(r.regionId));

  const c = buildBandChart(rows, sels, mode, wage, fidMin, fidMax, rawMin, rawMax, sell, goodName(key), goodName(ref?.rmName || ""));
  document.getElementById("psChart").innerHTML = `<div class="prod-legend">${c.legend || '<span class="prod-dim">No regions selected.</span>'}</div>${c.svg}`;
  const bandSvg = document.getElementById("psChart").querySelector(".prod-band-svg");
  if (bandSvg) {
    bandSvg.dataset.interact = JSON.stringify(c.interact || { xs: [], bands: [] });
    initBandChartCrosshair(bandSvg);
  }
  document.getElementById("psReadout").querySelector("tbody").innerHTML = c.rows || '<tr><td colspan="7" class="prod-dim" style="text-align:center;padding:16px">Select at least one region.</td></tr>';
}

function setStudioProduct() {
  const sel = document.getElementById("psProduct");
  if (!sel) return;
  const key = _products[+sel.value];
  const rows = _byProduct.get(key) || [];
  const ref = rows[0];
  if (ref) {
    const defRaw = Number(ref.rmPrice || 0);
    document.getElementById("psRawMin").value = fmt4(defRaw * 0.98);
    document.getElementById("psRawMax").value = fmt4(defRaw * 1.02);
    document.getElementById("psSell").value = fmt4(Number(ref.goodPrice || 0));
  }
  const sorted = [...rows].sort((a, b) => b.netWages - a.netWages);
  const top = new Set(sorted.slice(0, 6).map(r => r.regionId));
  document.getElementById("psRegions").innerHTML = sorted.map(r => `
    <label class="prod-region-item">
      <input type="checkbox" data-rid="${esc(r.regionId)}" ${top.has(r.regionId) ? "checked" : ""}>
      <span>${esc(r.regionName)}<small>${esc(r.countryName)} · ${r.incomeTax}% tax · +${r.totalBonus}% bonus ${liveMark(r)}</small></span>
    </label>`).join("") || '<span class="prod-dim">No regions.</span>';
  refreshStudio();
}

function ensureStudioDom(container) {
  if (_cont === container && _built) return;
  _cont = container; _built = false;
  container.innerHTML = `
    <div class="prod-studio">
      <div class="prod-acc open">
        <button type="button" class="prod-acc-head"><iconify-icon icon="mdi:sliders" class="lu"></iconify-icon><span>Controls</span><iconify-icon icon="mdi:chevron-down" class="lu prod-acc-caret"></iconify-icon></button>
        <div class="prod-acc-body">
        <div class="prod-controls">
        <div class="prod-field wide"><label class="prod-field-label">Product</label><select id="psProduct" class="prod-input"></select></div>
        <div class="prod-field"><label class="prod-field-label">Wage</label>
          <span class="prod-inline">
            <select id="psWageMode" class="prod-input"><option value="net">Net</option><option value="gross">Gross</option></select>
            <input id="psWage" type="number" step="0.001" min="0" value="0.12" class="prod-input" autocomplete="one-time-code">
          </span>
        </div>
        <div class="prod-field"><label class="prod-field-label">Fidelity %</label>
          <span class="prod-inline">
            <input id="psFidMin" type="number" min="1" max="10" step="1" value="1" class="prod-input" autocomplete="one-time-code">
            <input id="psFidMax" type="number" min="1" max="10" step="1" value="10" class="prod-input" autocomplete="one-time-code">
          </span>
        </div>
        <div class="prod-field"><label class="prod-field-label">Raw price (₿)</label>
          <span class="prod-inline">
            <input id="psRawMin" type="number" step="0.0001" class="prod-input" autocomplete="one-time-code">
            <input id="psRawMax" type="number" step="0.0001" class="prod-input" autocomplete="one-time-code">
          </span>
        </div>
        <div class="prod-field"><label class="prod-field-label">Sell price (₿)</label><input id="psSell" type="number" step="0.0001" class="prod-input" autocomplete="one-time-code"></div>
        <div class="prod-acc" style="grid-column:1/-1">
          <button type="button" class="prod-acc-head"><iconify-icon icon="mdi:map-marker-multiple" class="lu"></iconify-icon><span>Regions</span><iconify-icon icon="mdi:chevron-down" class="lu prod-acc-caret"></iconify-icon></button>
          <details class="prod-acc-body"><summary class="prod-field-label">Regions</summary><div class="prod-field wide"><div id="psRegions" class="prod-region-list"></div></div></details>
        </div>
        </div>
        </div>
      </div>
      <div class="prod-acc">
        <button type="button" class="prod-acc-head"><iconify-icon icon="mdi:chart-line" class="lu"></iconify-icon><span>Cost band chart</span><iconify-icon icon="mdi:chevron-down" class="lu prod-acc-caret"></iconify-icon></button>
        <div class="prod-acc-body"><div class="prod-chartbox" id="psChart"></div></div>
      </div>
      <div class="prod-acc">
        <button type="button" class="prod-acc-head"><iconify-icon icon="mdi:table" class="lu"></iconify-icon><span>Readout table</span><iconify-icon icon="mdi:chevron-down" class="lu prod-acc-caret"></iconify-icon></button>
        <div class="prod-acc-body">
          <div class="prod-table-wrap"><table class="prod-table" id="psReadout"><thead><tr>
            <th>Region</th><th class="prod-num">Set wage (net)</th><th class="prod-num">Cost (avg)</th><th class="prod-num">Net benefit (avg)</th><th class="prod-num">Cost range</th><th class="prod-num">Raw BE @fid</th><th class="prod-num">Fidelity BE</th>
          </tr></thead><tbody></tbody></table></div>
          <p class="prod-hint">Band = cost across raw-price range; upper edge low fidelity, lower edge full fidelity. Net benefit = sell − avg cost. Raw BE = raw price where you break even; Fidelity BE = fidelity at which cost meets sell.</p>
        </div>
      </div>
    </div>`;
  document.getElementById("psProduct").innerHTML = _products.map((k, i) => `<option value="${i}">${esc(goodName(k))}</option>`).join("");
  const bind = el => {
    if (!el) return;
    if (el.id === "psProduct") el.addEventListener("change", setStudioProduct);
    else if (el.id === "psRegions") el.addEventListener("change", refreshStudio);
    else el.addEventListener("input", refreshStudio);
  };
  bind(document.getElementById("psProduct"));
  bind(document.getElementById("psRegions"));
  ["psWage", "psWageMode", "psFidMin", "psFidMax", "psRawMin", "psRawMax", "psSell"].forEach(id => bind(document.getElementById(id)));
  _built = true;
}

export function renderProductionStudio(container, data) {
  if (!container) return;
  if (!data || !data.rows || !data.rows.length) {
    container.innerHTML = '<p class="prod-dim" style="padding:12px">No production data loaded.</p>';
    return;
  }
  _rows = data.rows;
  _byProduct = new Map();
  for (const r of _rows) {
    const key = r.bonusSource || r.productName;
    if (!_byProduct.has(key)) _byProduct.set(key, []);
    _byProduct.get(key).push(r);
  }
  _products = [..._byProduct.keys()];
  ensureStudioDom(container);
  if (document.getElementById("psProduct").options.length === 0) {
    document.getElementById("psProduct").innerHTML = _products.map((k, i) => `<option value="${i}">${esc(goodName(k))}</option>`).join("");
  }
  setStudioProduct();
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Yield
// ─────────────────────────────────────────────────────────────────────────────

function yieldChart(entries, productName) {
  if (!entries.length) return "";
  const W = 760, H = 240, padL = 72, padR = 18, padT = 14, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  let all = [0];
  for (const e of entries) all = all.concat(e.line);
  let mn = Math.min(...all), mx = Math.max(...all);
  const pad = (mx - mn) * 0.08 || 1;
  mn -= pad; mx += pad;
  const xPos = i => padL + (i / (FIDS.length - 1)) * plotW;
  const yPos = v => padT + plotH - ((v - mn) / (mx - mn)) * plotH;
  const yTicks = niceY(mn, mx, 5);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="prod-band-svg" role="img" aria-label="Net benefit per production point vs worker fidelity">`;
  for (const t of yTicks) {
    svg += `<line x1="${padL}" y1="${yPos(t).toFixed(1)}" x2="${W - padR}" y2="${yPos(t).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
    svg += `<text x="${padL - 6}" y="${(yPos(t) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--ink-caption)" font-family="var(--font-num)">${fmtTick(t)}</text>`;
  }
  svg += `<line x1="${padL}" y1="${yPos(0).toFixed(1)}" x2="${W - padR}" y2="${yPos(0).toFixed(1)}" stroke="var(--ink-dim)" stroke-width="1" stroke-dasharray="3,3"/>`;
  FIDS.forEach(f => {
    svg += `<text x="${xPos(f - 1).toFixed(1)}" y="${H - padB + 14}" text-anchor="middle" font-size="10" fill="var(--ink-caption)" font-family="var(--font-num)">${f}%</text>`;
  });
  entries.forEach((e, i) => {
    const pts = e.line.map((v, j) => `${xPos(j).toFixed(1)},${yPos(v).toFixed(1)}`);
    svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="${e.color}" stroke-width="1.8"/>`;
    svg += `<circle cx="${pts[pts.length - 1].split(",")[0]}" cy="${pts[pts.length - 1].split(",")[1]}" r="3" fill="${e.color}"/>`;
  });
  svg += `<text x="${padL}" y="10" font-size="10" fill="var(--ink-caption)" font-family="var(--font-num)">net benefit per PP (₿) · ${productName}</text>`;
  svg += `</svg>`;
  const legend = entries.map(e =>
    `<span class="prod-legend-item"><span class="sw" style="background:${e.color}"></span>${esc(e.r.regionName)} <small class="prod-dim">${e.r.incomeTax}% tax · +${e.r.totalBonus}% bonus ${liveMark(e.r)}</small></span>`
  ).join(" ");
  return { svg, legend };
}

function drillYield(container, data, key, mode, wage) {
  const group = data.rows.filter(r => (r.bonusSource || r.productName) === key);
  const ref = group[0];
  const raw = Number(ref.rmPrice || 0), sell = Number(ref.goodPrice || 0);
  const scored = group.map((r, i) => ({
    r,
    color: PAL[i % PAL.length],
    line: FIDS.map(f => netPerPP(r, mode, wage, f, raw, sell)),
  })).sort((a, b) => b.line[9] - a.line[9]);
  const chart = yieldChart(scored.slice(0, 4), goodName(key));
  const rows = scored.map(e => {
    const r = e.r;
    const beF = studioBreakevenFidelity(r, netFor(mode, wage, Number(r.incomeTax || 0)), raw, sell);
    return `<tr>
      <td class="prod-cell-name">${esc(r.regionName)} <small class="prod-dim">${esc(r.countryName)}</small> ${liveMark(r)}</td>
      <td class="prod-num">${r.incomeTax}%</td>
      <td class="prod-num">+${r.totalBonus.toFixed(1)}%</td>
      <td class="prod-num">${fmt4(e.line[0])}</td>
      <td class="prod-num">${fmt4(e.line[9])}</td>
      <td class="prod-num">${beFTxt(beF)}</td>
    </tr>`;
  }).join("");
  document.getElementById("psYieldDrill").innerHTML = `
    <div class="prod-drill">
      <h4 class="prod-drill-title">${esc(goodName(key))} — specialised regions <small class="prod-dim">(top 4 plotted)</small></h4>
      <div class="prod-legend">${chart.legend || ""}</div>
      ${chart.svg || ""}
      <div class="prod-table-wrap"><table class="prod-table"><thead><tr>
        <th>Region</th><th class="prod-num">Tax</th><th class="prod-num">Bonus</th><th class="prod-num">Net/PP @1%</th><th class="prod-num">Net/PP @10%</th><th class="prod-num">Fidelity BE</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}

function renderYieldTable(container, data, mode, wage) {
  const by = new Map();
  for (const r of data.rows) {
    const key = r.bonusSource || r.productName;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  const rows = [];
  for (const [key, group] of by) {
    const ref = group[0];
    const raw = Number(ref.rmPrice || 0), sell = Number(ref.goodPrice || 0);
    const npp = (r, f) => netPerPP(r, mode, wage, f, raw, sell);
    let best1 = group[0], best10 = group[0];
    for (const r of group) {
      if (npp(r, 1) > npp(best1, 1)) best1 = r;
      if (npp(r, 10) > npp(best10, 10)) best10 = r;
    }
    rows.push({ key, best1, best10, v1: npp(best1, 1), v10: npp(best10, 10) });
  }
  rows.sort((a, b) => b.v10 - a.v10);
  const tbody = container.querySelector("#psYieldRank tbody");
  tbody.innerHTML = rows.map(row => `
    <tr class="prod-yield-row" data-key="${esc(row.key)}">
      <td class="prod-cell-name">${esc(goodName(row.key))}</td>
      <td>${esc(row.best10.regionName)} <small class="prod-dim">${esc(row.best10.countryName)}</small> ${liveMark(row.best10)}</td>
      <td class="prod-num ${row.v10 >= 0 ? "prod-profit" : "prod-neg"}">${row.v10 >= 0 ? "+" : ""}${fmt4(row.v10)}</td>
      <td>${esc(row.best1.regionName)} <small class="prod-dim">${esc(row.best1.countryName)}</small> ${liveMark(row.best1)}</td>
      <td class="prod-num ${row.v1 >= 0 ? "prod-profit" : "prod-neg"}">${row.v1 >= 0 ? "+" : ""}${fmt4(row.v1)}</td>
    </tr>`).join("") || '<tr><td colspan="5" class="prod-dim" style="text-align:center;padding:16px">No data.</td></tr>';
  tbody.querySelectorAll(".prod-yield-row").forEach(tr => {
    tr.addEventListener("click", () => drillYield(container, data, tr.dataset.key, mode, wage));
  });
}

export function renderWorkerYield(container, data) {
  if (!container) return;
  if (!data || !data.rows || !data.rows.length) {
    container.innerHTML = '<p class="prod-dim" style="padding:12px">No production data loaded.</p>';
    return;
  }
  container.innerHTML = `
    <div class="prod-acc open">
      <button type="button" class="prod-acc-head"><iconify-icon icon="mdi:cash-clock" class="lu"></iconify-icon><span>Wage settings</span><iconify-icon icon="mdi:chevron-down" class="lu prod-acc-caret"></iconify-icon></button>
      <div class="prod-acc-body">
        <div class="prod-yield-bar">
          <label class="prod-field-label">Wage</label>
          <select id="psYieldMode" class="prod-input"><option value="net">Net</option><option value="gross">Gross</option></select>
          <input id="psYieldWage" class="prod-input" type="number" step="0.001" min="0" value="0.12" autocomplete="one-time-code">
          <span class="prod-yield-note">Net benefit per production point per resource, at each region's best bonus. Click a row to drill into fidelity curves.</span>
        </div>
      </div>
    </div>
    <div class="prod-acc">
      <button type="button" class="prod-acc-head"><iconify-icon icon="mdi:table" class="lu"></iconify-icon><span>Yield ranking</span><iconify-icon icon="mdi:chevron-down" class="lu prod-acc-caret"></iconify-icon></button>
      <div class="prod-acc-body">
        <div class="prod-table-wrap"><table class="prod-table" id="psYieldRank"><thead><tr>
          <th>Resource</th><th>Best @ 10% fidelity</th><th class="prod-num">Net/PP</th><th>Best @ 1% fidelity</th><th class="prod-num">Net/PP</th>
        </tr></thead><tbody></tbody></table></div>
      </div>
    </div>
    <div class="prod-acc">
      <button type="button" class="prod-acc-head"><iconify-icon icon="mdi:chart-timeline-variant" class="lu"></iconify-icon><span>Fidelity drill-down</span><iconify-icon icon="mdi:chevron-down" class="lu prod-acc-caret"></iconify-icon></button>
      <div class="prod-acc-body"><div id="psYieldDrill"></div></div>
    </div>`;
  const modeEl = container.querySelector("#psYieldMode");
  const wageEl = container.querySelector("#psYieldWage");
  const render = () => renderYieldTable(container, data, modeEl.value, parseFloat(wageEl.value) || 0.12);
  modeEl.addEventListener("change", render);
  wageEl.addEventListener("input", render);
  render();
}
