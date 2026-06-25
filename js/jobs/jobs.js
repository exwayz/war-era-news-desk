import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtMoney, fmtNum } from "../core/utils.js";

import { toast } from "../ui/toast.js";
import * as cap from "../core/captureReport.js";
import { ensureLookups } from "../timeline/filters.js";
import { nameCountry, nameRegion } from "../battles/companies.js";

function getCompanyId(job) {
  if (job.companyId) return job.companyId;
  if (typeof job.company === "string") return job.company;
  if (job.company?._id) return job.company._id;
  if (job.company?.id) return job.company.id;
  return "";
}

async function resolveCompaniesForJobs(jobs, k) {
  const toFetch = [...new Set(jobs.filter(j => { const cid = getCompanyId(j); return cid && !S.lookups.companiesById.has(cid); }).map(getCompanyId).filter(Boolean))];
  if (!toFetch.length) return;
  await Promise.all(toFetch.map(async cid => {
    try {
      const r = await fetchTrpc("company.getById", {companyId: cid}, k);
      const c = unwrap(r);
      if (c) S.lookups.companiesById.set(cid, c);
    } catch (err) { console.error("company.getById failed", cid, err); }
  }));
}

function populateJobCountryOptions() {
  if (!E.jobCountryOptions) return;
  const countryNames = new Set();
  for (const j of S.jobs) {
    const cn = getJobCountryName(j);
    if (cn) countryNames.add(cn);
  }
  E.jobCountryOptions.innerHTML = "";
  for (const name of [...countryNames].sort()) {
    const o = document.createElement("option"); o.value = name;
    E.jobCountryOptions.appendChild(o);
  }
}

function getJobCompany(job){
  return S.lookups.companiesById.get(getCompanyId(job));
}

function getJobCompanyName(job) {
  const c = getJobCompany(job);
  if (c?.name) return c.name;
  if (c?.companyName) return c.companyName;
  return job.companyName||job.company?.name||"";
}

function getJobCountryName(job) {
  const c = getJobCompany(job);
  if (!c) {
    const regionId = job.regionId||job.region?._id||job.region?.id||job.region||"";
    if (!regionId) return "";
    const region = S.lookups.regionsById.get(String(regionId));
    if (!region) return "";
    const countryId = region.countryId||region.country?._id||region.country?.id||region.country||"";
    return nameCountry(countryId);
  }
  const regionId = c.regionId||c.region?._id||c.region?.id||c.region||"";
  if (!regionId) return "";
  const region = S.lookups.regionsById.get(String(regionId));
  if (!region) return "";
  const countryId = region.countryId||region.country?._id||region.country?.id||region.country||"";
  return nameCountry(countryId);
}

function getJobRegionName(job) {
  const c = getJobCompany(job);
  if (c) {
    const regionId = c.regionId||c.region?._id||c.region?.id||c.region||"";
    return regionId ? nameRegion(String(regionId)) : "";
  }
  const regionId = job.regionId||job.region?._id||job.region?.id||job.region||"";
  return regionId ? nameRegion(String(regionId)) : "";
}

export function renderJobs() {
  const kw=(E.jobSearch?.value||"").toLowerCase();
  const countrySel = (S.jobCountryFilter||"").toLowerCase();
  const wageFilter = Number(S.jobWageFilter||0);

  let jobs = S.jobs.filter(j => {
    if (kw) {
      const company = getJobCompanyName(j)||"";
      const skill = j.skill||j.skillName||j.type||"";
      const desc = j.description||"";
      if (!company.toLowerCase().includes(kw) && !skill.toLowerCase().includes(kw) && !desc.toLowerCase().includes(kw)) return false;
    }
    if (countrySel) {
      const jCountry = getJobCountryName(j).toLowerCase();
      if (!jCountry.includes(countrySel)) return false;
    }
    const wage = Number(j.wage || j.salary || j.pay || 0);
    if (wageFilter > 0 && wage < wageFilter) return false;
    return true;
  });

  E.jobsList.innerHTML="";
  if(!jobs.length){ E.jobsList.innerHTML=`<p style="color:var(--ink-dim)">No job offers found.</p>`; return; }

  for(const job of jobs) {
    const card=document.createElement("div"); card.className="job-card";
    const company = getJobCompanyName(job) || "Unknown Company";
    const skill=job.skill||job.skillName||job.type||"General";
    const wage=Number(job.wage||job.salary||job.pay||0);
    const currency=job.currency||"BTC";
    const slots=job.openSlots||job.slots||job.count||1;
    const minSkill=job.minSkill||job.requiredLevel||job.level||0;
    const cid = getCompanyId(job);
    const regionName = getJobRegionName(job);
    const countryName = getJobCountryName(job);
    const locationText = [regionName, countryName].filter(Boolean).join(", ");

    card.innerHTML=`
      <p class="job-company">${company}${locationText?` <span style="color:var(--ink-dim);font-weight:500;font-size:.68rem">· ${locationText}</span>`:""}</p>
      <p class="job-title">${skill} Worker</p>
      <div class="job-chips">
        <span class="job-chip wage">💰 ${fmtMoney(wage)} ${currency}/hit</span>
        <span class="job-chip">📋 ${slots} slot${slots!==1?"s":""}</span>
        ${minSkill?`<span class="job-chip">⭐ Min. skill ${minSkill}</span>`:""}
        ${countryName?`<span class="job-chip">🌍 ${countryName}</span>`:""}
      </div>
      <div class="job-actions">
        ${cid ?`<button class="job-btn" data-cid="${cid}">🏭 View Company</button>` :`<button class="job-btn" disabled title="Company ID not available" style="opacity:.4;cursor:not-allowed">🏭 View Company</button>`}
        <button class="job-btn copy-job" data-wage="${wage}" data-company="${company}" data-skill="${skill}" data-loc="${locationText}">📋 Copy Brief</button>
      </div>`;

    card.querySelector("[data-cid]")?.addEventListener("click", function() {
      window.open(`https://app.warera.io/company/${this.dataset.cid}`, "_blank", "noopener");
    });

    card.querySelector(".copy-job")?.addEventListener("click", function() {
      const loc = this.dataset.loc ? ` (${this.dataset.loc})` : "";
      navigator.clipboard.writeText(`Job Offer — ${this.dataset.skill} Worker at ${this.dataset.company}${loc}: ${fmtMoney(this.dataset.wage)} BTC/hit`).then(()=>toast("Job brief copied."));
    });

    E.jobsList.append(card);
  }
}

export function copyJobsReport() {
  const byWage=[...S.jobs].sort((a,b)=>Number(b.wage||0)-Number(a.wage||0));
  let r=`# War Era Job Market Report\nGenerated: ${new Date().toUTCString()}\nTotal offers: ${S.jobs.length}\n\n## Top Paying\n`;
  for(const j of byWage.slice(0,20)) {
    const company = getJobCompanyName(j)||"Unknown";
    const country = getJobCountryName(j);
    const region = getJobRegionName(j);
    const loc = [region, country].filter(Boolean).join(", ");
    r+=`- ${company}${loc?` (${loc})`:""} — ${j.skill||j.type||"General"}: ${fmtMoney(j.wage||0)} BTC/hit\n`;
  }
  navigator.clipboard.writeText(r).then(()=>toast("Jobs report copied."));
}

export function captureJobsReport() {
  const byWage=[...S.jobs].sort((a,b)=>Number(b.wage||0)-Number(a.wage||0));
  const rows = byWage.slice(0,20).map((j,i) => {
    const company = getJobCompanyName(j)||"Unknown";
    const country = getJobCountryName(j);
    const region = getJobRegionName(j);
    const loc = [region, country].filter(Boolean).join(", ");
    return [String(i+1), company, loc||"—", j.skill||j.type||"General", fmtMoney(j.wage||0)+" BTC/hit"];
  });
  const html = cap.pageOpen("War Era Job Market Report", "", ["Total offers: "+S.jobs.length, "Generated: "+new Date().toUTCString()]) +
    cap.section("Top Job Offers", cap.tableBlock("", ["#","Company","Location","Skill","Wage"], rows, 20)) +
    cap.pageClose();
  cap.captureHTML(html, "jobs_report_"+cap.ts()+".png");
}

export async function loadJobs(reset=true) {
  const k=apiKey(); if(!k) return;
  E.jobsStatus.hidden=false; E.jobsStatus.textContent="Loading job offers…";
  if(reset){S.jobs=[];S.jobCursor=null;}
  try {
    const result=await fetchTrpc("workOffer.getWorkOffersPaginated",{limit:50,cursor:reset?undefined:S.jobCursor},k);
    const data=unwrap(result);
    const items=Array.isArray(data)?data:(data?.items||data?.offers||[]);
    S.jobCursor=data?.nextCursor||null;
    S.jobs=reset?items:[...S.jobs,...items];

    await resolveCompaniesForJobs(items, k);
    await ensureLookups(k);

    E.jobsStatus.hidden=true;
    renderJobs();
    populateJobCountryOptions();
  } catch(err) {
    E.jobsStatus.textContent="Could not load jobs: "+(err.message||"");
    E.jobsStatus.classList.add("error");
  }
  E.loadMoreJobsBtn.hidden=!S.jobCursor;
}
