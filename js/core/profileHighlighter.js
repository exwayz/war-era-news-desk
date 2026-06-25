import { loadProfile } from "../user/profile.js";

export function highlightUserData() {
  const p = loadProfile();
  if (!p) return;

  const names = [];
  if (p.username) names.push(p.username.trim().toLowerCase());
  if (p.muName) names.push(p.muName.trim().toLowerCase());
  if (p.countryName) names.push(p.countryName.trim().toLowerCase());
  if (p.partyName) names.push(p.partyName.trim().toLowerCase());

  if (!names.length) return;

  const selector = ".rk-name, .rk-row, .ac-meta, .bc-meta, .bc-chip, .ec-summary, .rk-cell-title, .rk-val, .ec-details";
  document.querySelectorAll(selector).forEach((el) => {
    const text = el.textContent.trim().toLowerCase();
    for (const n of names) {
      if (text === n || text.includes(n)) {
        el.classList.add("hl-user");
        break;
      }
    }
  });
}
