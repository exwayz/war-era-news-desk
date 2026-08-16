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
  const themeColor = document.querySelector('meta[name="theme-color"]:not([media])');
  if (themeColor) themeColor.content = t === "dark" ? "#121212" : "#f8f8dc";
}
export function applyTexture(on) {
  document.documentElement.dataset.texture = on ? "on" : "off";
  localStorage.setItem(STORE.texture, on ? "1" : "0");
  const cb = document.getElementById("paperTextureToggle");
  if (cb) cb.checked = !!on;
}
