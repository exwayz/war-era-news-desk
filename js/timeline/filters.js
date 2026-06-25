import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { OBJECT_ID_RE, EVENT_TYPES } from "../core/constants.js";
import { fetchTrpc, unwrap } from "../core/api.js";

export function populateEventTypes() {
  const frag = document.createDocumentFragment();
  for (const et of EVENT_TYPES) {
    const o=document.createElement("option"); o.value=et;
    const map = {
      peaceMade:"Peace Made", battleEnded:"Battle Ended", warEnded:"War Ended",
      warDeclared:"War Declared", battleOpened:"Battle Opened", newPresident:"New President",
      regionTransfer:"Region Transfer", countryMoneyTransfer:"Money Transfer",
      depositDiscovered:"Deposit Discovered", systemRevolt:"System Revolt",
      allianceFormed:"Alliance Formed", allianceBroken:"Alliance Broken",
      allianceMemberJoined:"Alliance Member Joined", allianceMemberLeft:"Alliance Member Left", allianceMemberExcluded: "Alliance Member Excluded",
      defensivePactFormed:"Defensive Pact Formed", defensivePactBroken:"Defensive Pact Broken",
      regionLiberated:"Region Liberated", revolutionStarted:"Revolution Started",
      revolutionEnded:"Revolution Ended", financedRevolt:"Financed Revolt",
      bankruptcy:"Bankruptcy", peace_agreement:"Peace Agreement",
      resistanceIncreased:"Resistance Increased", resistanceDecreased:"Resistance Decreased",
      strategicResourcesReshuffled:"Resources Reshuffled",
    };
    o.textContent=map[et]||et; frag.append(o);
  }
  E.eventTypeSelect.append(frag);
}

export function populateCountryOptions() {
  const frag=document.createDocumentFragment();
  const sorted=[...S.lookups.countriesById.values()].filter(c=>c.name).sort((a,b)=>a.name.localeCompare(b.name));
  for(const c of sorted){ const o=document.createElement("option"); o.value=c.name; if(c.code) o.label=c.code.toUpperCase(); frag.append(o); }
  E.countryOptions.textContent=""; E.countryOptions.append(frag);
}

export function getFilters() {
  const cval = E.countryInput.value.trim();
  const cid = cval ? (OBJECT_ID_RE.test(cval) ? cval : (S.lookups.countryIdsByName.get(cval.trim().toLowerCase())||"")) : "";
  const limit = Math.max(1, parseInt(E.eventLimitInput?.value, 10) || 50);
  return {
    limit,
    countryId: cid || undefined,
    eventTypes: E.eventTypeSelect.value ? [E.eventTypeSelect.value] : undefined,
  };
}

export async function ensureLookups(k) {
  if (S.lookupsKey===k) return;
  const { setStatus } = await import("../ui/toast.js");
  setStatus("Loading reference data…");
  const [cRes,rRes]=await Promise.all([
    fetchTrpc("country.getAllCountries",{},k),
    fetchTrpc("region.getRegionsObject",{},k),
  ]);
  const countries=unwrap(cRes); const regions=unwrap(rRes);
  S.lookups.countriesById.clear(); S.lookups.countryIdsByName.clear(); S.lookups.regionsById.clear();
  if (Array.isArray(countries)) {
    for (const c of countries) {
      const id=c._id||c.id; if(!id) continue;
      S.lookups.countriesById.set(id,c);
      S.lookups.countryIdsByName.set((c.name||"").toLowerCase(),id);
      if(c.code) S.lookups.countryIdsByName.set(c.code.toLowerCase(),id);
    }
  }
  if (regions&&typeof regions==="object") {
    for (const [id,r] of Object.entries(regions)) S.lookups.regionsById.set(id,r);
  }
  populateCountryOptions();
  S.lookupsKey=k;
}

export async function resolveUsers(ids, k) {
  const toFetch=[...new Set(ids)].filter(id=>id&&!S.lookups.usersById.has(id));
  if(!toFetch.length) return;
  await Promise.all(toFetch.map(async uid=>{
    try { const r=await fetchTrpc("user.getUserLite",{userId:uid},k); const u=unwrap(r); if(u) S.lookups.usersById.set(uid,u); }
    catch { S.lookups.usersById.set(uid,null); }
  }));
}

export async function resolveBattles(events, k) {
  const { getBid } = await import("./events.js");
  const ids=[...new Set(events.map(e=>getBid(e)).filter(id=>id&&!S.lookups.battlesById.has(id)))];
  if(!ids.length) return;
  await Promise.all(ids.map(async id=>{
    try { const r=await fetchTrpc("battle.getById",{battleId:id},k); const b=unwrap(r); if(b) S.lookups.battlesById.set(id,b); }
    catch { S.lookups.battlesById.set(id,null); }
  }));
}
