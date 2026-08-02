import { STORE } from "../core/storage.js";

export function toggleTheme() { applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"); }
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(STORE.theme, t);
  const btn = document.getElementById("themeToggleBtn");
  if (btn) {
    const icon = t==="dark" ? "mdi:weather-sunny" : "mdi:weather-night";
    btn.innerHTML = `<span class="side-icon"><iconify-icon icon="${icon}" class="lu"></iconify-icon></span>`;
  }
}
