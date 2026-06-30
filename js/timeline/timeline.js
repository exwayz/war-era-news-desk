import { S, setUnseenTimelineEvents, getUnseenTimelineEvents } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, normalizeEvents, normalizeCursor } from "../core/api.js";
import { STORE } from "../core/storage.js";
import { fmtDate, parseLocal } from "../core/utils.js";
import { resolveBattles, resolveUsers, ensureLookups, getFilters } from "./filters.js";
import { loadArticles } from "./articles.js";
import { evtData, evtTime, buildTitle, buildSummary, buildDetails, buildLink, fmtType } from "./events.js";
import { toast, setStatus, clearStatus } from "../ui/toast.js";
import { isTimelineOpen, updateTimelineBadge } from "../ui/tabs.js";
import { highlightUserData } from "../core/profileHighlighter.js";

export function scheduleEventsRefresh() {
  clearTimeout(S.filterTimer);
  S.filterTimer = setTimeout(()=>loadEvents(true), 350);
}

export async function loadEvents(reset) {
  if (S.isLoading) return;
  const k = apiKey();
  if (!k) { setStatus("Enter your API key first.", "error"); return; }
  localStorage.setItem(STORE.apiKey, k);
  S.isLoading = true;
  setStatus(reset ? "Loading timeline…" : "Loading more…");
  E.applyFiltersBtn.disabled = E.loadMoreBtn.disabled = true;
  if (reset) { S.cursor=null; S.events=[]; E.eventList.textContent=""; }
  try {
    await ensureLookups(k);
    if (reset) S.lastFilters = getFilters();
    const result = await fetchTrpc("event.getEventsPaginated", {...S.lastFilters, cursor:reset?undefined:S.cursor}, k);
    const evts = normalizeEvents(result);
    S.cursor = normalizeCursor(result);
    S.events = reset ? evts : [...S.events, ...evts];
    await resolveBattles(evts, k);
    await resolveUsers(evts.map(e=>evtData(e).user).filter(Boolean), k);
    renderTimeline();

  } catch (err) {
    console.error(err);
    setStatus(err.message||"Failed to load events.", "error");
  } finally {
    S.isLoading = false;
    E.applyFiltersBtn.disabled = E.loadMoreBtn.disabled = false;
  }
}

export function startAutoRefresh() {
  clearInterval(S.autoRefreshTimer);
  S.autoRefreshTimer = setInterval(()=>{
    if (S.isLoading || !apiKey()) return;
    silentRefreshEvents();
    if (S.articleLimiter < 10) { S.articleLimiter++; loadArticles(false); }
    else S.articleLimiter = 100;
  }, 5000);
}

export async function silentRefreshEvents() {
  try {
    const result = await fetchTrpc("event.getEventsPaginated", {...S.lastFilters, limit:20}, apiKey());
    const fresh = normalizeEvents(result).filter(e=>!S.events.some(x=>(x._id||x.id)===(e._id||e.id)));
    const hasFresh = !!fresh.length;
    if (hasFresh) {
      for(const ev of fresh) showLiveEventToast(ev);
      S.events = [...fresh, ...S.events];
    }
    if (hasFresh) {
      renderTimeline();
      S.articleLimiter = 0; loadArticles(true);
    }
  } catch {}
}

export function showLiveEventToast(event) {
  if(isTimelineOpen()){
    updateTimelineBadge();
    return;
  }

  const ue = getUnseenTimelineEvents();
  setUnseenTimelineEvents(ue + 1);
  updateTimelineBadge();

  const toastEl = document.getElementById("infobarToast");
  const toastText = document.getElementById("infobarToastText");
  const infobar = document.getElementById("infobar");
  if(!toastEl || !toastText || !infobar) return;

  const ed = evtData(event);
  const type = event.type || event.eventType || ed.type || event.name || "event";
  const title = buildTitle(event, type, ed);
  toastText.textContent = title ? `New: ${title}` : "New event registered";

  // Slot-machine animation: MVI scroll pushes down, toast slides in
  infobar.classList.add("toasting");
  toastEl.hidden = false;
  toastEl.classList.remove("hide");
  requestAnimationFrame(() => toastEl.classList.add("show"));

  playPing();

  if (window._infobarToastTimer) clearTimeout(window._infobarToastTimer);
  window._infobarToastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
    toastEl.classList.add("hide");
    setTimeout(() => {
      toastEl.hidden = true;
      infobar.classList.remove("toasting");
    }, 500);
  }, 10000);
}

function playPing(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type="sine";
    osc.frequency.value=880;
    gain.gain.value=.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.stop(ctx.currentTime + 0.25);
  }catch(e){}
}

export function renderTimeline() {
  const start=parseLocal(E.startTimeInput.value);
  const end=parseLocal(E.endTimeInput.value);
  const visible=S.events.filter(e=>{
    const ts=evtTime(e); if(!ts) return !start&&!end;
    const t=new Date(ts).getTime(); if(isNaN(t)) return !start&&!end;
    if(start&&t<start.getTime()) return false;
    if(end&&t>end.getTime()) return false;
    return true;
  });
  E.eventList.textContent="";
  if(!visible.length) {
    E.loadMoreBtn.hidden=!S.cursor;
    E.feedMeta.textContent=`${S.events.length} loaded — none in range.`;
    setStatus(S.events.length===0?"No events found.":"No events in the selected time range.");
    return;
  }
  const frag=document.createDocumentFragment();
  for(const e of visible) frag.append(makeEventCard(e));
  E.eventList.append(frag);
  E.loadMoreBtn.hidden=!S.cursor;
  E.feedMeta.textContent=`${visible.length} shown — ${S.events.length} loaded.`;
  clearStatus();
  highlightUserData();
}

function makeEventCard(event) {
  const node=E.tplEvent.content.firstElementChild.cloneNode(true);
  const ed=evtData(event);
  const type=event.type||event.eventType||ed.type||event.name||"event";
  const ts=evtTime(event);

  node.querySelector(".ec-type").textContent=fmtType(type);
  node.querySelector(".ec-title").textContent=buildTitle(event,type,ed);
  node.querySelector(".ec-summary").textContent=buildSummary(event,type,ed);

  const btn=node.querySelector(".ec-copy");
  btn.dataset.eventId=event._id||event.id||"";

  const link=node.querySelector(".ec-link");
  const href=buildLink(event,ed);
  if(href) link.href=href; else link.hidden=true;

  const timeEl=node.querySelector(".ec-time");
  timeEl.textContent=fmtDate(ts);
  if(ts) { const d=new Date(ts); if(!isNaN(d)) timeEl.dateTime=d.toISOString(); }

  const dl=node.querySelector(".ec-details");
  for(const item of buildDetails(event,ed)) {
    const row=document.createElement("div");
    const dt=document.createElement("dt"); dt.textContent=item.label;
    const dd=document.createElement("dd"); dd.textContent=item.value;
    row.append(dt,dd); dl.append(row);
  }
  return node;
}

export function handleEventAction(e) {
  const btn=e.target.closest(".ec-copy"); if(!btn) return;
  const ev=S.events.find(x=>(x._id||x.id)===btn.dataset.eventId); if(!ev) return;
  const ed=evtData(ev); const type=ev.type||ev.eventType||ed.type||ev.name||"event";
  const title=buildTitle(ev,type,ed);
  const summary=buildSummary(ev,type,ed);
  const dets=buildDetails(ev,ed).map(i=>`• ${i.label}: ${i.value}`).join("\n");
  const link=buildLink(ev,ed);
  const brief=`# ${title}\n\n${summary}\n\n${dets}${evtTime(ev)?"\n• Time: "+fmtDate(evtTime(ev)):""}\n\n${link?"Source: "+link:""}`;
  navigator.clipboard.writeText(brief).then(()=>toast("News brief copied."));
}




