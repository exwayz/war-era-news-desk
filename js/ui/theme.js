import { E } from "../core/dom.js";
import { STORE } from "../core/storage.js";

export function toggleTheme() { applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"); }
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(STORE.theme, t);
  E.themeButton.textContent = t==="dark" ? "Light" : "Dark";
}
