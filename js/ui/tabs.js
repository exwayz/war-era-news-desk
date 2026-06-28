import { S, unseenTimelineEvents, setUnseenTimelineEvents } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey } from "../core/api.js";
import { loadBattles } from "../battles/battles.js";
import { loadMarketFull } from "../market/market.js";
import { loadJobs } from "../jobs/jobs.js";
import { loadCategory } from "../rankings/rankings.js";
import { loadMessages, renderWallMessages, renderWallCount } from "../community/wall.js";
import { loadPolitics } from "../politics/politics.js";
import { highlightUserData } from "../core/profileHighlighter.js";
export function switchTab(tab) {
  document.querySelectorAll(".overlay").forEach(o => o.classList.add("hidden"));
  S.currentTab = tab;
  E.tabBtns.forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  E.tabPanels.forEach(p=>p.classList.toggle("active", p.id==="tab-"+tab));
  if(tab === "timeline"){
    clearTimelineBadge();
    isTimelineOpen();
  }
  if (tab === "community") {
    loadMessages(S.wallSort).then(result => {
      renderWallMessages("wallGrid", result.messages);
      renderWallCount("wallCount");
    });
  }
  setTimeout(highlightUserData, 100);
  const k = apiKey();
  if (!k) return;
  if (tab==="battles" && S.battles.length===0) loadBattles(true);
  if (tab==="market" && !S.market.prices) loadMarketFull();
  if (tab==="jobs" && S.jobs.length===0) loadJobs(true);
  if (tab==="rankings") loadCategory(document.querySelector("[data-rank-cat].active")?.dataset.rankCat || "weekly");
  if (tab==="politics") loadPolitics();
}

export function isTimelineOpen(){
  return document.getElementById("tab-timeline")?.classList.contains("active");
}

export function clearTimelineBadge(){
  setUnseenTimelineEvents(0);
  updateTimelineBadge();
}

export function updateTimelineBadge(){
  const badge = document.getElementById("timelineBadge");
  if(!badge) return;
  if(unseenTimelineEvents <= 0){
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.textContent = unseenTimelineEvents > 99 ? "99+" : unseenTimelineEvents;
}
