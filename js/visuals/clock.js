import { S } from "../core/state.js";
import { STORE } from "../core/storage.js";
import { apiKey, fetchTrpcApi2, unwrap } from "../core/api.js";
import { escapeHtml } from "../core/utils.js";

let _clockMode = localStorage.getItem(STORE.clockMode) || "local";
let _gameDates = null;
let _gameDatesTimer = null;

export function getClockMode() { return _clockMode; }
export function setClockMode(mode) {
  _clockMode = mode;
  localStorage.setItem(STORE.clockMode, mode);
  updateClockModeUI();
}

function updateClockModeUI() {
  document.querySelectorAll("#clockModeGroup .pill-btn").forEach(b => b.classList.toggle("active", b.dataset.clock === _clockMode));
  const badge = document.getElementById("clockGameBadge");
  if (badge) badge.style.display = _clockMode === "game" ? "" : "none";
  const cdGroup = document.getElementById("gameCountdownGroup");
  if (cdGroup) cdGroup.style.display = _clockMode === "game" ? "" : "none";
}

function fmtCountdown(ms) {
  if (ms <= 0) return "now";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function renderGameCountdowns() {
  const el = document.getElementById("gameCountdowns");
  if (!el || !_gameDates) return;
  const now = Date.now();
  const parts = [];
  if (_gameDates.nextRegenAt) {
    const ms = new Date(_gameDates.nextRegenAt).getTime() - now;
    parts.push(`Regen: ${fmtCountdown(ms)}`);
  }
  if (_gameDates.nextDayAt) {
    const ms = new Date(_gameDates.nextDayAt).getTime() - now;
    parts.push(`Day: ${fmtCountdown(ms)}`);
  }
  if (_gameDates.nextMonthAt) {
    const ms = new Date(_gameDates.nextMonthAt).getTime() - now;
    parts.push(`Month: ${fmtCountdown(ms)}`);
  }
  if (_gameDates.nextPresidentialElectionsAt) {
    const ms = new Date(_gameDates.nextPresidentialElectionsAt).getTime() - now;
    parts.push(`Pres. Election: ${fmtCountdown(ms)}`);
  }
  if (_gameDates.nextCongressElectionsAt) {
    const ms = new Date(_gameDates.nextCongressElectionsAt).getTime() - now;
    parts.push(`Congress: ${fmtCountdown(ms)}`);
  }
  el.textContent = parts.join("  ·  ");
}

export async function fetchGameDates() {
  const k = apiKey();
  if (!k) return;
  try {
    const r = await fetchTrpcApi2("gameConfig.getDates", {}, k);
    _gameDates = unwrap(r);
  } catch {}
}

export function initClock() {
  function tick() {
    const now = new Date();
    const isGame = _clockMode === "game";
    const ref = isGame ? new Date(now.getTime() + now.getTimezoneOffset() * 60000) : now;
    const d = ref.getDate().toString().padStart(2,"0");
    const mo = (ref.getMonth()+1).toString().padStart(2,"0");
    const y = ref.getFullYear();
    const hh = ref.getHours().toString().padStart(2,"0");
    const mm = ref.getMinutes().toString().padStart(2,"0");
    const ss = ref.getSeconds().toString().padStart(2,"0");
    const el = document.getElementById("clockTime");
    if (el) el.textContent = `${hh}:${mm}:${ss}`;
    const dateEl = document.getElementById("clockDate");
    if (dateEl) dateEl.textContent = `${y}-${mo}-${d} `;
    if (isGame) renderGameCountdowns();
  }
  tick();
  setInterval(tick, 1000);
  setInterval(renderGameCountdowns, 1000);
  fetchGameDates();
  _gameDatesTimer = setInterval(fetchGameDates, 5 * 60 * 1000);
  updateClockModeUI();
}

function pillTrend(item) {
  const arrow = item.trend === 1 ? "▲" : item.trend === -1 ? "▼" : "";
  const pct = item.trend !== 0 && item.changePct != null
    ? `${arrow}${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(1)}%`
    : "";
  const trendCls = item.trend === 1 ? "infobar-pill-up" : item.trend === -1 ? "infobar-pill-down" : "";
  return { pct: pct || "\u2014", trendCls };
}

function pillHTML(item) {
  const { pct, trendCls } = pillTrend(item);
  return `<span class="infobar-pill"><span class="infobar-name">${escapeHtml(item.item)}</span> <span class="infobar-value ${trendCls}">${pct}</span></span>`;
}

function applyPill(el, item) {
  const { pct, trendCls } = pillTrend(item);
  let nameEl = el.querySelector(".infobar-name");
  let valueEl = el.querySelector(".infobar-value");
  if (!nameEl) {
    el.innerHTML = `<span class="infobar-name">${escapeHtml(item.item)}</span> <span class="infobar-value ${trendCls}">${pct}</span>`;
  } else {
    nameEl.textContent = item.item;
    valueEl.className = `infobar-value ${trendCls}`;
    valueEl.textContent = pct;
  }
}

let _lastCount = 0;

export function updateInfobar() {
  const scroll = document.getElementById("infobarScroll");
  if (!scroll) return;
  const items = S.market.topValuable;
  if (!items || !items.length) {
    _lastCount = 0;
    scroll.innerHTML = `<span class="infobar-pill" style="font-family:var(--font-ui);color:var(--ink-dim)">Waiting for market data…</span>`;
    return;
  }
  const sliced = items.slice(0, 12);
  const needCount = sliced.length * 2;

  let track = scroll.querySelector(".infobar-track");

  if (!track || _lastCount !== needCount) {
    scroll.innerHTML = `<div class="infobar-track">${sliced.map(pillHTML).join("")}${sliced.map(pillHTML).join("")}</div>`;
    _lastCount = needCount;
    return;
  }

  const pillEls = track.querySelectorAll(".infobar-pill");
  for (let i = 0; i < pillEls.length; i++) {
    applyPill(pillEls[i], sliced[i % sliced.length]);
  }
}
