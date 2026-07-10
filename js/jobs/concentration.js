import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtNum, fmtDate } from "../core/utils.js";
import { ensureLookups } from "../timeline/filters.js";
import { toast } from "../ui/toast.js";
import * as cap from "../core/captureReport.js";

let _companyConcentrationData = [];
let _depositConcentrationData = [];

const DEPOSIT_TYPES = ["petroleum", "wood", "iron", "limestone", "grain", "lead", "coca", "fish", "livestock"];
const CONCURRENCY = 10;

async function batchFetch(ids, method, key, idField = "companyId") {
  const results = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const res = await Promise.allSettled(
      batch.map(id => fetchTrpc(method, { [idField]: id }, key))
    );
    for (const r of res) {
      if (r.status === "fulfilled") {
        const data = unwrap(r.value);
        if (data) results.push(data);
      }
    }
  }
  return results;
}

export async function loadCompanyConcentration() {
  const container = document.getElementById("companyConcentration");
  if (!container) return;
  const k = apiKey();
  if (!k) return;
  container.innerHTML = `<p class="status-msg" style="padding:12px">Loading companies…</p>`;
  try {
    const ids = [];
    let cursor;
    for (let i = 0; i < 5; i++) {
      const r = await fetchTrpc("company.getCompanies", { limit: 40, cursor }, k);
      const data = unwrap(r);
      if (!data || !data.items) break;
      ids.push(...data.items.filter(id => typeof id === "string"));
      cursor = data.nextCursor;
      if (!cursor) break;
    }
    if (!ids.length) { container.innerHTML = `<p class="status-msg" style="padding:12px">No companies found.</p>`; return; }
    const companies = await batchFetch(ids, "company.getById", k);
    if (!companies.length) { container.innerHTML = `<p class="status-msg" style="padding:12px">Could not load company details.</p>`; return; }
    const byRegion = {};
    for (const c of companies) {
      const rid = c.region || c.regionId;
      if (!rid) continue;
      if (!byRegion[rid]) byRegion[rid] = { companies: [], itemCodes: {} };
      byRegion[rid].companies.push(c);
      const code = c.itemCode || "unknown";
      byRegion[rid].itemCodes[code] = (byRegion[rid].itemCodes[code] || 0) + 1;
    }
    const sorted = Object.entries(byRegion).sort((a, b) => b[1].companies.length - a[1].companies.length).slice(0, 50);
    _companyConcentrationData = sorted.map(([rid, data]) => ({ regionId: rid, data }));
    await ensureLookups(k);
    const regionIds = sorted.map(([rid]) => rid).filter(Boolean);
    const regions = await batchFetch(regionIds, "region.getById", k, "regionId");
    const regionMap = {};
    for (const r of regions) {
      if (r) regionMap[r._id || r.id] = r;
    }
    let html = `<div class="conc-list">`;
    for (const [rid, data] of sorted) {
      const region = regionMap[rid];
      const rname = region?.name || rid.slice(0, 8);
      const cname = region?.countryCode ? (S.lookups.countriesById.get(region.country)?.name || region.countryCode.toUpperCase()) : "";
      const total = data.companies.length;
      const codes = Object.entries(data.itemCodes).sort((a, b) => b[1] - a[1]);
      const pctBar = codes.map(([code, count]) => {
        const pct = ((count / total) * 100).toFixed(0);
        return `<span class="conc-pct" style="flex:${pct}"><span class="conc-pct-fill" style="width:${pct}%"></span></span>`;
      }).join("");
      const pctLabels = codes.map(([code, count]) => {
        const pct = ((count / total) * 100).toFixed(0);
        return `<span class="conc-pct-label">${code} ${pct}%</span>`;
      }).join(" ");
      html += `<div class="conc-row"><div class="conc-row-head"><span class="conc-region">${rname}</span><span class="conc-country">${cname}</span><span class="conc-count">${fmtNum(total)} companies</span><span class="conc-pct-labels">${pctLabels}</span></div><div class="conc-bars">${pctBar}</div></div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p class="status-msg" style="padding:12px;color:var(--red)">Error: ${err.message}</p>`;
  }
}

export async function loadDepositConcentration(filterType) {
  const container = document.getElementById("depositConcentration");
  if (!container) return;
  const k = apiKey();
  if (!k) return;
  const list = document.getElementById("depositList");
  if (!list) return;
  list.innerHTML = `<p class="status-msg" style="padding:12px">Loading deposits…</p>`;
  try {
    const result = await fetchTrpc("event.getEventsPaginated", { type: "depositDiscovered", limit: 100 }, k);
    const evts = unwrap(result);
    let items = Array.isArray(evts) ? evts : (evts?.items || evts?.events || []);
    if (!items.length) { list.innerHTML = `<p class="status-msg" style="padding:12px">No deposits found.</p>`; return; }
    items = items.filter(e => e.data?.itemCode).sort((a, b) => (b.data?.bonusPercent || 0) - (a.data?.bonusPercent || 0));
    _depositConcentrationData = items;
    await ensureLookups(k);
    const regionIds = [...new Set(items.map(e => e.data?.region).filter(Boolean))];
    const regions = await batchFetch(regionIds, "region.getById", k, "regionId");
    const regionMap = {};
    for (const r of regions) {
      if (r) regionMap[r._id || r.id] = r;
    }
    const now = Date.now();
    let html = `<div class="conc-list">`;
    for (const ev of items) {
      const ed = ev.data;
      const rid = ed.region;
      const region = regionMap[rid];
      const rname = region?.name || rid?.slice(0, 8) || "Unknown";
      const cname = region?.countryCode ? (S.lookups.countriesById.get(region.country)?.name || region.countryCode.toUpperCase()) : "";
      const itemCode = ed.itemCode || "unknown";
      const bonus = ed.bonusPercent || 0;
      const durationDays = ed.durationDays || 0;
      const endsAt = new Date(ev.createdAt).getTime() + durationDays * 86400000;
      const remaining = Math.max(0, Math.ceil((endsAt - now) / 86400000));
      if (filterType && itemCode !== filterType) continue;
      html += `<div class="conc-row"><div class="conc-row-head"><span class="conc-region">${rname}</span><span class="conc-country">${cname}</span><span class="conc-deposit-type">${itemCode}</span><span class="conc-deposit-bonus">+${bonus}%</span><span class="conc-deposit-end">${remaining}d left</span></div></div>`;
    }
    html += `</div>`;
    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = `<p class="status-msg" style="padding:12px;color:var(--red)">Error: ${err.message}</p>`;
  }
}

export function populateDepositFilter() {
  const sel = document.getElementById("depositTypeFilter");
  if (!sel || sel.options.length > 1) return;
  for (const t of DEPOSIT_TYPES) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    sel.appendChild(opt);
  }
}

function _resolveRegionName(regionId, seenRegionMap) {
  if (seenRegionMap[regionId]) return seenRegionMap[regionId];
  const region = S.lookups.regionsById.get(String(regionId));
  if (region) {
    const rname = region.name || regionId.slice(0, 8);
    const country = region.countryCode ? (S.lookups.countriesById.get(region.country)?.name || region.countryCode.toUpperCase()) : "";
    seenRegionMap[regionId] = { rname, cname: country };
    return seenRegionMap[regionId];
  }
  seenRegionMap[regionId] = { rname: regionId.slice(0, 8), cname: "" };
  return seenRegionMap[regionId];
}

export function copyJobsConcentration() {
  const companyView = document.getElementById("companyConcentration");
  const depositView = document.getElementById("depositConcentration");
  const isCompany = companyView && !companyView.hidden;

  let r = `# War Era ${isCompany ? "Company" : "Deposit"} Concentration Report\nGenerated: ${new Date().toUTCString()}\n`;

  const regionCache = {};
  if (isCompany) {
    r += "\n## Company Concentration by Region\n";
    for (const [rid, data] of _companyConcentrationData) {
      const { rname, cname } = _resolveRegionName(rid, regionCache);
      const total = data.companies.length;
      const codes = Object.entries(data.itemCodes).sort((a, b) => b[1] - a[1]);
      const codeStr = codes.map(([code, count]) => `${code} ${((count / total) * 100).toFixed(0)}% (${count})`).join(", ");
      r += `\n${rname}${cname ? ` (${cname})` : ""}: ${fmtNum(total)} companies\n  ${codeStr}`;
    }
  } else {
    if (!_depositConcentrationData.length) { toast("No deposit data loaded. Switch to Deposits view first."); return; }
    r += "\n## Deposit Concentration\n";
    const now = Date.now();
    for (const ev of _depositConcentrationData) {
      const ed = ev.data;
      const rid = ed.region;
      const { rname, cname } = _resolveRegionName(rid, regionCache);
      const itemCode = ed.itemCode || "unknown";
      const bonus = ed.bonusPercent || 0;
      const durationDays = ed.durationDays || 0;
      const endsAt = new Date(ev.createdAt).getTime() + durationDays * 86400000;
      const remaining = Math.max(0, Math.ceil((endsAt - now) / 86400000));
      r += `\n${rname}${cname ? ` (${cname})` : ""}: ${itemCode} +${bonus}% — ${remaining}d left`;
    }
  }
  navigator.clipboard.writeText(r).then(() => toast("Concentration report copied."));
}

export function captureJobsConcentration() {
  const companyView = document.getElementById("companyConcentration");
  const depositView = document.getElementById("depositConcentration");
  const isCompany = companyView && !companyView.hidden;

  if (!isCompany && !_depositConcentrationData.length) { toast("No deposit data loaded."); return; }

  const genLine = "Generated: " + new Date().toUTCString();
  const regionCache = {};
  let rows, headers;

  if (isCompany) {
    headers = ["#", "Region", "Country", "Companies", "Item Codes"];
    rows = _companyConcentrationData.map(([rid, data], i) => {
      const { rname, cname } = _resolveRegionName(rid, regionCache);
      const total = data.companies.length;
      const codes = Object.entries(data.itemCodes).sort((a, b) => b[1] - a[1]);
      const codeStr = codes.map(([code, count]) => `${code} ${((count / total) * 100).toFixed(0)}%`).join(", ");
      return [String(i + 1), rname, cname || "—", fmtNum(total), codeStr];
    });
  } else {
    headers = ["#", "Region", "Country", "Type", "Bonus", "Remaining"];
    const now = Date.now();
    rows = _depositConcentrationData.map((ev, i) => {
      const ed = ev.data;
      const rid = ed.region;
      const { rname, cname } = _resolveRegionName(rid, regionCache);
      const durationDays = ed.durationDays || 0;
      const endsAt = new Date(ev.createdAt).getTime() + durationDays * 86400000;
      const remaining = Math.max(0, Math.ceil((endsAt - now) / 86400000));
      return [String(i + 1), rname, cname || "—", ed.itemCode || "—", "+" + (ed.bonusPercent || 0) + "%", remaining + "d"];
    });
  }

  const title = "War Era " + (isCompany ? "Company" : "Deposit") + " Concentration";
  const html = cap.pageOpen(title, "", [genLine]) +
    cap.section("", cap.tableBlock("", headers, rows, 100)) +
    cap.pageClose();
  cap.captureHTML(html, "concentration_" + cap.ts() + ".png");
}
