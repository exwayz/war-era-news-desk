import { STORE } from "../core/storage.js";

export function toggleTheme() { applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"); }
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(STORE.theme, t);
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.innerHTML = t==="dark" ? `<iconify-icon icon="mdi:weather-sunny" class="lu"></iconify-icon>` : `<iconify-icon icon="mdi:weather-night" class="lu"></iconify-icon>`;
}
