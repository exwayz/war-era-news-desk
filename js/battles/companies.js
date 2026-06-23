import { S } from "../core/state.js";
import { renderBattleList } from "./battles.js";

export function nameCountry(id) { if(!id) return ""; return S.lookups.countriesById.get(id)?.name||""; }
export function nameRegion(id) { if(!id) return ""; return S.lookups.regionsById.get(String(id))?.name||""; }
export function nameUser(id) { if(!id) return ""; const u=S.lookups.usersById.get(id); return u?.username||u?.name||""; }
export function nameAlliance(id) { if(!id) return ""; const al=S.lookups.alliancesById.get(id); return al?.name||al?.allianceName||""; }
export function nameArticleTitle(id) { if(!id) return ""; return S.lookups.articlesById.get(id)?.title||""; }
export function nameParty(id) { if(!id) return ""; const p=S.lookups.partiesById.get(id); return p?.name||p?.partyName||""; }

export function injectBattleSearchBar() {
  const col = document.querySelector(".battle-list-col");
  if (!col) return;
  const panelHead = col.querySelector(".panel-head");
  if (!panelHead) return;
  const wrap = document.createElement("div");
  wrap.className = "sticky-toolbar";
  wrap.innerHTML = `
<div class="input-wrap search-bar">
  <input id="battleSearch" type="text" placeholder="Search by country or region…">
  <button class="clear-btn" id="clearBattleSearch" type="button">✕</button>
</div>
<button id="battleLoadMini" class="btn-load-mini">More</button>
`;
  panelHead.insertAdjacentElement("afterend", wrap);
  const inp = document.getElementById("battleSearch");
  const clr = document.getElementById("clearBattleSearch");
  inp.addEventListener("input", () => {
    S.battleSearch = inp.value.trim().toLowerCase();
    renderBattleList();
  });
  clr.addEventListener("click", () => {
    inp.value = "";
    S.battleSearch = "";
    renderBattleList();
    inp.focus();
  });
}
