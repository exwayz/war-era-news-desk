import { S } from "../core/state.js";
import { fmtMoney } from "../core/utils.js";

export function initClock() {
  function tick() {
    const now = new Date();
    const d = now.getDate().toString().padStart(2,"0");
    const mo = (now.getMonth()+1).toString().padStart(2,"0");
    const y = now.getFullYear();
    const hh = now.getHours().toString().padStart(2,"0");
    const mm = now.getMinutes().toString().padStart(2,"0");
    const ss = now.getSeconds().toString().padStart(2,"0");
    const el = document.getElementById("clockTime");
    if (el) el.textContent = `${hh}:${mm}:${ss}`;
    const dateEl = document.getElementById("clockDate");
    if (dateEl) dateEl.textContent = `${y}-${mo}-${d} `;
  }
  tick();
  setInterval(tick, 1000);
}

export function updateInfobar() {
  const scroll = document.getElementById("infobarScroll");
  if (!scroll) return;
  const items = S.market.topValuable;
  if (!items || !items.length) {
    scroll.innerHTML = `<span class="infobar-pill" style="font-family:var(--font-ui);color:var(--ink-dim)">Waiting for market data…</span>`;
    return;
  }
  const sliced = items.slice(0, 12);
  function pillHTML(item) {
    const arrow = item.trend === 1 ? "▲" : item.trend === -1 ? "▼" : "";
    const pct = item.trend !== 0 && item.changePct != null ? `${arrow}${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(1)}%` : "";
    const trendCls = item.trend === 1 ? "infobar-pill-up" : item.trend === -1 ? "infobar-pill-down" : "";
    return `<span class="infobar-pill"><span class="infobar-name">${item.item}</span> <span class="infobar-value ${trendCls}">${fmtMoney(item.value)}${pct ? ` ${pct}` : ""}</span></span>`;
  }
  let track = scroll.querySelector(".infobar-track");
  if (!track) {
    scroll.innerHTML = `<div class="infobar-track">${sliced.map(pillHTML).join("")}${sliced.map(pillHTML).join("")}</div>`;
    return;
  }
  const pillEls = track.querySelectorAll(".infobar-pill");
  for (let i = 0; i < pillEls.length; i++) {
    const item = sliced[i % sliced.length];
    const el = pillEls[i];
    const arrow = item.trend === 1 ? "▲" : item.trend === -1 ? "▼" : "";
    const pct = item.trend !== 0 && item.changePct != null ? `${arrow}${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(1)}%` : "";
    const trendCls = item.trend === 1 ? "infobar-pill-up" : item.trend === -1 ? "infobar-pill-down" : "";
    let nameEl = el.querySelector(".infobar-name");
    let valueEl = el.querySelector(".infobar-value");
    if (!nameEl) {
      el.innerHTML = `<span class="infobar-name">${item.item}</span> <span class="infobar-value ${trendCls}">${fmtMoney(item.value)}${pct ? ` ${pct}` : ""}</span>`;
    } else {
      nameEl.textContent = item.item;
      valueEl.className = `infobar-value ${trendCls}`;
      valueEl.textContent = `${fmtMoney(item.value)}${pct ? ` ${pct}` : ""}`;
    }
  }
}
