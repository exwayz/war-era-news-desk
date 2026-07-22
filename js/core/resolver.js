import { S } from "./state.js";
import { apiKey, fetchTrpc, fetchTrpcApi2, unwrap } from "./api.js";
import { ensureLookups } from "../timeline/filters.js";
import { entityDisplayName, escapeHtml } from "./utils.js";
import { offlineLookups } from "../../data/offlineLookups.js";

const _offlineMaps = {
  country: offlineLookups.countries,
  region: offlineLookups.regions,
  alliance: offlineLookups.alliances,
  party: offlineLookups.parties,
  mu: offlineLookups.mus,
};

async function fetchWithFallback(method, params, k) {
  try { return unwrap(await fetchTrpc(method, params, k)); } catch {}
  try { return unwrap(await fetchTrpcApi2(method, params, k)); } catch {}
  return null;
}

export function offlineResolve(type, id) {
  const map = _offlineMaps[type];
  if (!map || !id) return null;
  const name = map[id];
  if (!name) return null;
  const stub = { _id: id, id, name };
  if (type === "alliance") stub.alliance = name;
  if (type === "party") stub.party = name;
  return stub;
}

export async function resolveEntityByType(type, id, k) {
  k = k || apiKey();
  if (!id) return null;

  const cacheMap = {
    user: "usersById", country: "countriesById", region: "regionsById",
    mu: "muById", company: "companiesById", battle: "battlesById",
    alliance: "alliancesById", article: "articlesById", party: "partiesById",
  }[type];

  if (cacheMap && S.lookups[cacheMap]?.has(id)) return S.lookups[cacheMap].get(id);

  const offline = offlineResolve(type, id);
  if (offline) {
    if (cacheMap) S.lookups[cacheMap].set(id, offline);
    return offline;
  }

  if (!k) return null;
  try {
    switch (type) {
      case "user": {
        const u = await fetchWithFallback("user.getUserLite", { userId:id }, k);
        if (u) S.lookups.usersById.set(id,u);
        return u;
      }
      case "country": {
        await ensureLookups(k);
        let c = await fetchWithFallback("country.getById", { countryId:id }, k);
        if (!c) c = await fetchWithFallback("country.getCountryById", { countryId:id }, k);
        if (c) S.lookups.countriesById.set(id,c);
        return c;
      }
      case "region": {
        await ensureLookups(k);
        let r = await fetchWithFallback("region.getById", { regionId:id }, k);
        if (!r) r = await fetchWithFallback("region.getRegionById", { regionId:id }, k);
        if (r) S.lookups.regionsById.set(id,r);
        return r;
      }
      case "mu": {
        const m = await fetchWithFallback("mu.getById", { muId:id }, k);
        if (m) S.lookups.muById.set(id,m);
        return m;
      }
      case "company": {
        const c = await fetchWithFallback("company.getById", { companyId:id }, k);
        if (c) S.lookups.companiesById.set(id,c);
        return c;
      }
      case "battle": {
        const b = await fetchWithFallback("battle.getById", { battleId:id }, k);
        if (b) S.lookups.battlesById.set(id,b);
        return b;
      }
      case "alliance": {
        const alliance = await resolveAlliance(id, k);
        if (alliance) S.lookups.alliancesById.set(id, alliance);
        return alliance;
      }
      case "article": {
        let a = await fetchWithFallback("article.getById", { articleId:id }, k);
        if (!a) a = await fetchWithFallback("article.getArticleById", { articleId:id }, k);
        if (a) S.lookups.articlesById.set(id,a);
        return a;
      }
      case "party": {
        const party = await resolveParty(id, k);
        if (party) S.lookups.partiesById.set(id, party);
        return party;
      }
    }
  } catch (e) { console.warn("resolveEntityByType failed", type, id, e); }
  return null;
}

export async function resolveAlliance(allianceId, k) {
  const method = "alliance.getManyPaginated";
  for (const fetcher of [fetchTrpc, fetchTrpcApi2]) {
    try {
      let cursor = null;
      while (true) {
        const input = { limit: 100 };
        if (cursor) input.cursor = cursor;
        const res = unwrap(await fetcher(method, input, k));
        const alliances = res?.items || res?.alliances || res?.data || [];
        const found = alliances.find(a => a._id === allianceId || a.id === allianceId || a.allianceId === allianceId);
        if (found) return found;
        if (!res?.nextCursor) break;
        cursor = res.nextCursor;
      }
    } catch (err) { console.warn("resolveAlliance via", fetcher.name, err); }
  }
  return null;
}

export async function resolveParty(partyId, k) {
  const method = "party.getManyPaginated";
  for (const fetcher of [fetchTrpc, fetchTrpcApi2]) {
    try {
      let cursor = null;
      while (true) {
        const input = { limit: 100 };
        if (cursor) input.cursor = cursor;
        const res = unwrap(await fetcher(method, input, k));
        const parties = res?.items || res?.parties || res?.data || [];
        const found = parties.find(p => p._id === partyId || p.id === partyId || p.partyId === partyId);
        if (found) return found;
        if (!res?.nextCursor) break;
        cursor = res.nextCursor;
      }
    } catch (err) { console.warn("resolveParty via", fetcher.name, err); }
  }
  return null;
}

export async function resolveContentLinks(container) {
  if (!container) return;
  const k = apiKey(); if (!k) return;
  const spans = [...container.querySelectorAll("span[data-content-link]")];
  if (!spans.length) return;

  const parsed = [];
  for (const span of spans) {
    const type = span.dataset.contentType||"";
    let info=null;
    try { info = JSON.parse(span.dataset.contentData||"{}"); } catch { info=null; }
    const id = info?.[type+"Id"] || info?.id || "";
    if (!type || !id) continue;
    span.classList.add("entity-resolving");
    span.textContent = "…";
    parsed.push({ span, type, id, info });
  }
  if (!parsed.length) return;

  const uniqueKeys = [...new Set(parsed.map(p=>p.type+":"+p.id))];
  await Promise.all(uniqueKeys.map(key=>{
    const [type,id] = key.split(":");
    return resolveEntityByType(type,id,k);
  }));

  const getData = (type,id) => {
    switch(type) {
      case "user": return S.lookups.usersById?.get(id);
      case "country": return S.lookups.countriesById?.get(id);
      case "region": return S.lookups.regionsById?.get(id);
      case "mu": return S.lookups.muById?.get(id);
      case "company": return S.lookups.companiesById?.get(id);
      case "battle": return S.lookups.battlesById?.get(id);
      case "alliance": return S.lookups.alliancesById?.get(id);
      case "article": return S.lookups.articlesById?.get(id);
      case "party": return S.lookups.partiesById?.get(id);
    }
    return null;
  };

  for (const {span,type,id,info} of parsed) {
    const data = getData(type,id);
    const name = entityDisplayName(type,id,data);
    const url = info?.fullMatch || `https://app.warera.io/${type}/${id}`;
    span.classList.remove("entity-resolving");
    span.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="entity-link">${escapeHtml(name)}</a>`;
  }
}
