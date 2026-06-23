import { E } from "../core/dom.js";

export function initNixie() {
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  function tick() {
    const now = new Date();
    const d = now.getDate().toString().padStart(2,"0");
    const mo = MONTHS[now.getMonth()];
    const y = now.getFullYear();
    const day = DAYS[now.getDay()];
    const h = now.getHours().toString().padStart(2,"0");
    const m = now.getMinutes().toString().padStart(2,"0");
    const s = now.getSeconds().toString().padStart(2,"0");
    if (E.nixieDate) E.nixieDate.textContent = `${day} ${d} ${mo} ${y}`;
    if (E.nixieTime) E.nixieTime.textContent = `${h}:${m}:${s}`;
  }
  tick();
  setInterval(tick, 1000);
}
