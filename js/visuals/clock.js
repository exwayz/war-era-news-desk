import { E } from "../core/dom.js";
import { playClock } from "../audio/audio.js";

export function initNixie() {
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  let lastHour = -1;
  let pulseActive = false;
  let pulseCount = 0;
  function tick() {
    const now = new Date();
    const d = now.getDate().toString().padStart(2,"0");
    const mo = MONTHS[now.getMonth()];
    const y = now.getFullYear();
    const day = DAYS[now.getDay()];
    const h = now.getHours();
    const hh = h.toString().padStart(2,"0");
    const m = now.getMinutes();
    const mm = m.toString().padStart(2,"0");
    const s = now.getSeconds();
    const ss = s.toString().padStart(2,"0");
    if (E.nixieDate) E.nixieDate.textContent = `${day} ${d} ${mo} ${y}`;
    if (E.nixieTime) E.nixieTime.textContent = `${hh}:${mm}:${ss}`;
    if (lastHour === -1) {
      lastHour = h;
    } else if (h !== lastHour && m === 0 && s === 0) {
      lastHour = h;
      pulseActive = true;
      pulseCount = 0;
      if (E.nixieClock) E.nixieClock.classList.add("pulsating");
    }
    if (pulseActive) {
      playClock();
      pulseCount++;
      if (pulseCount >= 30) {
        pulseActive = false;
        if (E.nixieClock) E.nixieClock.classList.remove("pulsating");
      }
    }
  }
  tick();
  setInterval(tick, 1000);
}
