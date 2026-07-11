import { S } from "../core/state.js";
import { apiKey, fetchTrpc, fetchTrpcApi2, fetchTrpcApi5, unwrap, fetchFromServer } from "../core/api.js";
import { fmtNum, fmtDate, fmtMoney } from "../core/utils.js";
import { resolveParty, resolveAlliance, resolveContentLinks } from "../core/resolver.js";
import { evtData, evtTime, buildTitle, buildSummary, fmtType } from "../timeline/events.js";
import { toast } from "../ui/toast.js";
import * as cap from "../core/captureReport.js";
import { getCountriesInRegion, populateRegionOptions } from "../core/regionClassification.js";

const POLITICS_EVENT_TYPES = new Set([
  "allianceBroken","allianceFormed","allianceMemberExcluded","allianceMemberJoined","allianceMemberLeft",
  "bankruptcy","battleEnded","battleOpened","countryMoneyTransfer","defensivePactBroken","defensivePactFormed",
  "financedRevolt","newPresident","peace_agreement","peaceMade","regionLiberated","regionTransfer",
  "revolutionEnded","revolutionStarted","systemRevolt","warDeclared"
]);

let _loaded = false;
let _countries = [];
let _selectedCountryId = "";
let _government = null;
let _countryDetail = null;
let _parties = [];
let _elections = [];
let _alliance = null;
let _politicsRegionFilter = "";

export async function loadPolitics(force = false) {
  if (!force && _loaded) return;
  const k = apiKey();
  if (!k) return;
  const container = document.getElementById("politicsContent");
  if (!container) return;

  document.getElementById("politicsStatus").hidden = false;
  document.getElementById("politicsStatus").textContent = "Loading countries...";

  try {
    const r = await fetchTrpc("country.getAllCountries", {}, k);
    const d = unwrap(r);
    _countries = Array.isArray(d) ? d : (d?.items || d?.results || []);
    populateCountryList(_countries);

    document.getElementById("politicsStatus").hidden = true;

    if (_selectedCountryId) {
      await loadCountryData(_selectedCountryId, k);
    } else {
      renderCountryGrid();
    }
  } catch (err) {
    document.getElementById("politicsStatus").textContent = "Failed to load: " + err.message;
  }
  _loaded = true;
}

function populateCountryList(countries) {
  const datalist = document.getElementById("politicsCountryOptions");
  if (!datalist) return;
  datalist.innerHTML = "";
  const sorted = [...countries].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  for (const c of sorted) {
    if (!c._id || !c.name) continue;
    const o = document.createElement("option");
    o.value = c.name;
    o.dataset.id = c._id;
    datalist.appendChild(o);
  }
}

async function loadCountryData(countryId, k) {
  _selectedCountryId = countryId;
  const status = document.getElementById("politicsStatus");
  status.hidden = false;
  status.textContent = "Loading government, parties, elections...";
  try {
    const [govR, partiesR, countryR] = await Promise.all([
      fetchTrpc("government.getByCountryId", { countryId }, k),
      fetchTrpcApi2("party.getManyPaginated", { countryId, limit: 100 }, k).catch(() => ({ items: [] })),
      fetchTrpc("country.getCountryById", { countryId }, k).catch(() => null),
    ]);
    _government = unwrap(govR) || null;
    _countryDetail = unwrap(countryR) || null;
    const pd = unwrap(partiesR);
    _parties = Array.isArray(pd) ? pd : (pd?.items || []);
    _alliance = null;
    if (_countryDetail?.allianceId) {
      try {
        const a = S.lookups.alliancesById.get(_countryDetail.allianceId);
        if (a) _alliance = a;
        else {
          const ar = await fetchTrpcApi2("alliance.getById", { allianceId: _countryDetail.allianceId }, k);
          const ad = unwrap(ar);
          if (ad) { _alliance = ad; S.lookups.alliancesById.set(_countryDetail.allianceId, ad); }
        }
      } catch {}
    }
    _elections = await fetchElections(countryId, k);
    await enrichParties(_parties, k);
    await enrichGovernment(_government, k);
    await enrichCongressMembers(_government, k);
    renderPolitics();
    generatePoliticalSummary(countryId, k);
    saveGovernmentSnapshot(countryId);
  } catch (err) {
    status.textContent = "Error: " + err.message;
  }
  status.hidden = true;
}

async function fetchElections(countryId, k) {
  const input = { countryId, limit: 50, direction: "forward" };
  for (const fetcher of [fetchTrpc, fetchTrpcApi5]) {
    try {
      const r = await fetcher("election.getElections", input, k);
      const d = unwrap(r);
      const items = Array.isArray(d) ? d : (d?.items || []);
      if (items.length) return items;
    } catch {}
  }
  return [];
}

async function enrichParties(parties, k) {
  const needed = new Set();
  for (const p of parties) {
    if (p.leader && !S.lookups.usersById.has(p.leader)) needed.add(p.leader);
    if (p.treasurer && !S.lookups.usersById.has(p.treasurer)) needed.add(p.treasurer);
    if (p.councilMembers) p.councilMembers.forEach(uid => { if (uid && !S.lookups.usersById.has(uid)) needed.add(uid); });
  }
  if (!needed.size) return;
  await Promise.all([...needed].map(async uid => {
    try {
      const r = await fetchTrpcApi2("user.getUserLite", { userId: uid }, k);
      const u = unwrap(r);
      if (u) S.lookups.usersById.set(uid, u);
    } catch {}
  }));
}

async function enrichGovernment(gov, k) {
  if (!gov) return;
  const roleKeys = ["president", "vicePresident", "minOfDefense", "minOfEconomy", "minOfForeignAffairs"];
  const needed = roleKeys.map(key => gov[key]).filter(id => id && !S.lookups.usersById.has(id));
  if (!needed.length) return;
  await Promise.all(needed.map(async uid => {
    try {
      const r = await fetchTrpcApi2("user.getUserLite", { userId: uid }, k);
      const u = unwrap(r);
      if (u) S.lookups.usersById.set(uid, u);
    } catch {}
  }));
}

async function enrichCongressMembers(gov, k) {
  if (!gov?.congressMembers?.length) return;
  const needed = gov.congressMembers.filter(uid => uid && !S.lookups.usersById.has(uid));
  if (!needed.length) return;
  await Promise.all(needed.map(async uid => {
    try {
      const r = await fetchTrpcApi2("user.getUserLite", { userId: uid }, k);
      const u = unwrap(r);
      if (u) S.lookups.usersById.set(uid, u);
    } catch {}
  }));
}

function renderPolitics() {
  const container = document.getElementById("politicsContent");
  if (!container) return;
  const country = _countries.find(c => c._id === _selectedCountryId);
  const countryName = country?.name || _selectedCountryId.slice(-6);
  container.innerHTML = `
    <div class="pol-header">
      <h3>${countryName}</h3>
    </div>
    <div class="pol-grid">
      <div class="glass-panel pol-section pol-gov">
        <h4 class="pol-section-title">Government</h4>
        <div id="polGovBody">${renderGovernment()}</div>
      </div>
      <div class="glass-panel pol-section pol-summary">
        <h4 class="pol-section-title">Political Summary</h4>
        <div id="polSummaryBody" class="pol-scroll"></div>
      </div>
      <div class="glass-panel pol-section pol-parties">
        <h4 class="pol-section-title">Parties <span class="pol-count">${_parties.length}</span></h4>
        <div id="polPartiesBody" class="pol-scroll">${renderParties()}</div>
      </div>
      <div class="glass-panel pol-section pol-elections">
        <h4 class="pol-section-title">Elections <span class="pol-count">${_elections.length}</span></h4>
        <div id="polElectionsBody" class="pol-scroll">${renderElections()}</div>
      </div>
    </div>
  `;
}

function renderGovernment() {
  if (!_government) return '<p class="pol-empty">No government data</p>';

  const roles = [
    { key: "president", label: "President:", icon: "👤" },
    { key: "vicePresident", label: "Vice President:", icon: "👥" },
    { key: "minOfDefense", label: "Minister of Defense:", icon: "⚔" },
    { key: "minOfEconomy", label: "Minister of Economy:", icon: "💰" },
    { key: "minOfForeignAffairs", label: "Foreign Affairs:", icon: "🌍" },
  ];

  const roleHtml = roles.map(r => {
    const userId = _government[r.key];
    if (!userId) return '';
    const user = S.lookups.usersById.get(userId);
    const partyTxt = userPartyName(userId);
    return `
      <div class="pol-role-row">
        <span class="pol-role-icon">${r.icon}</span>
        <span class="pol-role-label">${r.label}</span>
        <span class="pol-role-name"${partyTxt ? ` title="${escHtml(partyTxt)}"` : ""}>${userAvatar(user, userId)} ${escHtml(user?.username || '#' + userId.slice(-6))}</span>
      </div>
    `;
  }).join('');

  let extraHtml = '';

  // Ruling party
  if (_countryDetail?.rulingParty) {
    const rpId = _countryDetail.rulingParty;
    const party = _parties.find(p => p._id === rpId);
    const pAvatar = party?.avatarUrl
      ? `<img class="pol-party-avatar-sm" src="${party.avatarUrl}" alt="" loading="lazy">`
      : `<span class="pol-party-avatar-sm pol-party-initials-sm">${(party?.name?.charAt(0) || '?').toUpperCase()}</span>`;
    extraHtml += `
      <div class="pol-role-row">
        <span class="pol-role-icon">🏛</span>
        <span class="pol-role-label">Ruling Party:</span>
        <span class="pol-role-name">${pAvatar} ${escHtml(party?.name || rpId.slice(-6))}</span>
      </div>
    `;
  }

  // Alliance
  if (_alliance) {
    const aAvatar = _alliance.avatarUrl
      ? `<img class="pol-party-avatar-sm" src="${_alliance.avatarUrl}" alt="" loading="lazy">`
      : `<span class="pol-party-avatar-sm pol-party-initials-sm">${(_alliance.name?.charAt(0) || '?').toUpperCase()}</span>`;
    extraHtml += `
      <div class="pol-role-row">
        <span class="pol-role-icon">🤝</span>
        <span class="pol-role-label">Alliance:</span>
        <span class="pol-role-name">${aAvatar} ${escHtml(_alliance.allianceName || _alliance.name || _alliance._id?.slice(-6))}</span>
      </div>
    `;
  }

  // Defensive pacts
  const pacts = _countryDetail?.defensivePacts;
  if (pacts && pacts.length > 0) {
    extraHtml += `
      <div class="pol-role-row">
        <span class="pol-role-icon">🛡</span>
        <span class="pol-role-label">Defensive Pacts:</span>
        <span class="pol-role-name">${pacts.length} pact${pacts.length > 1 ? 's' : ''}</span>
      </div>
    `;
  }

  // Congress members
  const members = _government.congressMembers || [];
  const memberHtml = members.length
    ? `<details class="pol-congress-details">
        <summary class="pol-congress-summary">Congress <span class="pol-count">${members.length}</span> <span class="details-marker">▾</span></summary>
        <div class="pol-congress-list">${members.map(uid => {
          const u = S.lookups.usersById.get(uid);
          const pt = userPartyName(uid);
          return `<span class="pol-congress-item"${pt ? ` title="${escHtml(pt)}"` : ""}>${userAvatar(u, uid)} ${escHtml(u?.username || '#' + uid.slice(-6))}</span>`;
        }).join('')}</div>
      </details>`
    : '';

  return roleHtml + extraHtml + memberHtml;
}

function userParty(userId) {
  if (!userId || !_parties.length) return null;
  for (const p of _parties) {
    if (p._id && (p.leader === userId || p.treasurer === userId)) return p;
    if (Array.isArray(p.councilMembers) && p.councilMembers.includes(userId)) return p;
    if (Array.isArray(p.members) && p.members.includes(userId)) return p;
  }
  return null;
}

function userPartyName(userId) {
  const p = userParty(userId);
  return p?.name || null;
}

function userAvatar(u, uid) {
  const url = u?.avatarUrl;
  if (url) return `<img class="pol-user-avatar" src="${url}" alt="" loading="lazy">`;
  const initial = (u?.username?.charAt(0) || '?').toUpperCase();
  return `<span class="pol-user-avatar pol-user-initials">${initial}</span>`;
}

function renderParties() {
  if (!_parties.length) return '<p class="pol-empty">No parties</p>';
  return _parties.map((p, i) => {
    const leader = p.leader ? S.lookups.usersById.get(p.leader) : null;
    const leaderName = leader?.username || (p.leader ? '#' + p.leader.slice(-6) : '—');
    const avatar = p.avatarUrl ? `<img class="pol-party-avatar" src="${p.avatarUrl}" alt="" loading="lazy">` : '<span class="pol-party-avatar pol-party-avatar--initials">' + (p.name?.charAt(0) || '?') + '</span>';
    const members = Array.isArray(p.members) ? p.members.length : (p.membersCount || p.memberCount || '?');
    return `
      <div class="pol-party-card" data-pidx="${i}">
        <div class="pol-party-head">
          ${avatar}
          <div class="pol-party-info">
            <span class="pol-party-name">${escHtml(p.name || 'Unnamed')}</span>
            <span class="pol-party-meta">Leader: ${escHtml(leaderName)} · ${fmtNum(members)} members</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderElections() {
  if (!_elections.length) return '<p class="pol-empty">No elections</p>';
  const now = Date.now();
  return _elections.map(e => {
    const type = e.type === 'president' ? '🏛 Presidential' : '🏛 Congress';
    const start = e.votesStartAt ? new Date(e.votesStartAt).getTime() : 0;
    const end = e.votesEndAt ? new Date(e.votesEndAt).getTime() : 0;
    let status, statusClass;
    if (start && end && now < start) { status = 'UPCOMING'; statusClass = 'pol-status-upcoming'; }
    else if (start && end && now >= start && now <= end) { status = 'ACTIVE'; statusClass = 'pol-status-active'; }
    else { status = 'CLOSED'; statusClass = 'pol-status-closed'; }
    return `
      <div class="pol-election-row" data-election-id="${e._id}">
        <div class="pol-election-type">${type}</div>
        <div class="pol-election-dates">
          ${e.votesStartAt ? escHtml(fmtDate(e.votesStartAt)) : '—'} → ${e.votesEndAt ? escHtml(fmtDate(e.votesEndAt)) : '—'}
        </div>
        <span class="pol-election-status ${statusClass}">${status}</span>
        <span class="pol-election-votes">${e.votesCount != null ? fmtNum(e.votesCount) + ' votes' : ''}</span>
      </div>
    `;
  }).join('');
}

function renderCountryGrid() {
  const container = document.getElementById("politicsContent");
  if (!container) return;
  let filtered = [..._countries];
  if (_politicsRegionFilter) {
    const names = getCountriesInRegion(_politicsRegionFilter);
    if (names.length) {
      const lower = new Set(names.map(n => n.toLowerCase()));
      filtered = filtered.filter(c => c.name && lower.has(c.name.toLowerCase()));
    }
  }
  const sorted = [...filtered].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  container.innerHTML = `
    <div class="pol-country-grid">
      ${sorted.map(c => {
        const flag = c.code ? `<img class="pol-grid-flag" src="https://flagcdn.com/${c.code}.svg" alt="" loading="lazy">` : "";
        return `<button class="pol-country-card" data-id="${c._id}">${flag}<span class="pol-country-name">${escHtml(c.name || "?")}</span></button>`;
      }).join("")}
    </div>
  `;
}

function showPartyDetail(party) {
  const k = apiKey();
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  const leader = party.leader ? S.lookups.usersById.get(party.leader) : null;
  const council = party.councilMembers || [];
  const members = Array.isArray(party.members) ? party.members.length : (party.membersCount || party.memberCount || 0);

  let councilHtml = "";
  if (council.length) {
    councilHtml = council.map(uid => {
      const u = S.lookups.usersById.get(uid);
      return `<span class="pol-detail-chip">${userAvatar(u, uid)} ${escHtml(u?.username || '#' + uid.slice(-6))}</span>`;
    }).join("");
  }

  overlay.innerHTML = `
    <div class="modal-card pol-detail-modal">
      <div style="display:flex;align-items:center;gap:10px">
        ${party.avatarUrl ? `<img src="${party.avatarUrl}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1px solid var(--line)">` : `<span style="width:36px;height:36px;border-radius:50%;background:var(--surface-hi);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem">${(party.name?.charAt(0)||'?').toUpperCase()}</span>`}
        <h2 style="margin:0;font-size:1rem">${escHtml(party.name || 'Unnamed')}</h2>
      </div>
      <div class="pol-detail-rows">
        <div class="pol-detail-row"><span class="pol-detail-label">Leader</span><span class="pol-detail-val">${leader ? userAvatar(leader, party.leader) + " " + escHtml(leader.username) : escHtml(party.leader?.slice(-6) || "—")}</span></div>
        ${party.treasurer ? `<div class="pol-detail-row"><span class="pol-detail-label">Treasurer</span><span class="pol-detail-val">${(()=>{const u=S.lookups.usersById.get(party.treasurer);return u?userAvatar(u,party.treasurer)+" "+escHtml(u.username):escHtml(party.treasurer?.slice(-6))})()}</span></div>` : ""}
        <div class="pol-detail-row"><span class="pol-detail-label">Members</span><span class="pol-detail-val">${fmtNum(members)}</span></div>
      </div>
      ${council.length ? `<div><div class="pol-detail-label" style="margin-bottom:4px">Council (${council.length})</div><div class="pol-detail-chips">${councilHtml}</div></div>` : ""}
      <button class="btn-primary pol-detail-close" style="width:100%">Close</button>
    </div>
  `;
  overlay.querySelector(".pol-detail-close").addEventListener("click", () => overlay.remove());
  document.addEventListener("keydown", function onEsc(e) { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onEsc); } });
  document.body.appendChild(overlay);
}

async function showElectionDetail(electionId) {
  const k = apiKey();
  if (!k) return;

  let election = _elections.find(e => e._id === electionId);
  if (!election) return;

  const candidates = election.candidates || election.results || election.candidateList || [];
  const votesMap = election.votes || {};

  const userIds = candidates.map(c => c.user).filter(Boolean);
  await Promise.all(userIds.map(async uid => {
    if (!S.lookups.usersById.has(uid)) {
      try { const r = await fetchTrpcApi2("user.getUserLite", { userId: uid }, k); const u = unwrap(r); if (u) S.lookups.usersById.set(uid, u); } catch {}
    }
  }));

  const partyIds = candidates.map(c => c.party).filter(Boolean);
  const partyCache = {};
  await Promise.all(partyIds.map(async pid => {
    let p = _parties.find(x => x._id === pid);
    if (!p) { try { p = await resolveParty(pid, k); } catch {} }
    if (p) partyCache[pid] = p;
  }));

  const type = election.type === "president" ? "Presidential" : "Congress";
  const candidatesHtml = candidates.length ? candidates.map(c => {
    const uid = c.user || "";
    const user = S.lookups.usersById.get(uid);
    const name = user?.username || uid.slice(-6) || "?";
    const partyId = c.party || "";
    const party = partyCache[partyId];
    const partyName = party?.name || "";
    const elected = c.isElected || false;
    const icon = elected ? `<span style="color:var(--green);font-weight:800">✓</span>` : `<span style="color:var(--red);font-weight:800">✗</span>`;
    const voteCount = votesMap[uid] != null ? votesMap[uid] : (c.voteCount != null ? c.voteCount : 0);
    return `
      <div class="pol-detail-row pol-candidate-row">
        <span class="pol-candidate-icon">${icon}</span>
        <span class="pol-candidate-name">${user ? userAvatar(user, uid) + " " : ""}${escHtml(name)}</span>
        <span class="pol-candidate-party">${partyName ? escHtml(partyName) : "Independent"}</span>
        <span class="pol-candidate-votes">${voteCount > 0 ? fmtNum(voteCount) + (voteCount === 1 ? " vote" : " votes") : ""}</span>
      </div>
    `;
  }).join("") : '<p style="color:var(--ink-dim);font-size:.82rem">No candidate data available.</p>';

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="modal-card pol-detail-modal">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0;font-size:1rem">${type} Election</h2>
        <span style="font-size:.72rem;color:var(--ink-dim)">${election.votesCount != null ? fmtNum(election.votesCount) + " votes" : ""}</span>
      </div>
      <div class="pol-candidate-list">${candidatesHtml}</div>
      <button class="btn-primary pol-detail-close" style="width:100%">Close</button>
    </div>
  `;
  overlay.querySelector(".pol-detail-close").addEventListener("click", () => overlay.remove());
  document.addEventListener("keydown", function onEsc(e) { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onEsc); } });
  document.body.appendChild(overlay);
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function timeAgoLabel(events) {
  const times = events.map(e => new Date(e.createdAt||e.date||e.time||e.timestamp).getTime()).filter(t => !isNaN(t));
  if (!times.length) return "recent events";
  const oldest = Math.min(...times);
  const diff = Date.now() - oldest;
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "in the last hour";
  if (hrs < 24) return `in the last ${hrs} hours`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "in the last day" : `in the last ${days} days`;
}

async function fetchPoliticsEvents(k) {
  for (const fetcher of [fetchTrpcApi2, fetchTrpcApi5]) {
    try {
      const r = await fetcher("event.getEventsPaginated", { limit: 100 }, k);
      const d = unwrap(r);
      const items = d?.items || d?.events || d?.data || [];
      if (Array.isArray(items) && items.length) return items;
    } catch {}
  }
  return [];
}

async function resolveEventNames(events, k) {
  const cids = new Set();
  const rids = new Set();
  const uids = new Set();
  for (const e of events) {
    const ed = e.data || {};
    const ids = [ed.attackerCountry, ed.defenderCountry, ed.country, ed.countryId, ed.sourceCountry, ed.targetCountry];
    ids.forEach(id => { if (id) cids.add(id); });
    if (Array.isArray(e.countries)) e.countries.forEach(id => cids.add(id));
    if (Array.isArray(ed.countries)) ed.countries.forEach(id => cids.add(id));
    [ed.defenderRegion, ed.attackerRegion, ed.region, ed.regionId].forEach(id => { if (id) rids.add(id); });
    [ed.user, ed.from, ed.to].forEach(id => { if (id) uids.add(id); });
  }
  await Promise.all([...cids].map(async id => {
    if (!S.lookups.countriesById.has(id)) {
      try { const r = await fetchTrpc("country.getCountryById", { countryId: id }, k); const d = unwrap(r); if (d) S.lookups.countriesById.set(id, d); } catch {}
    }
  }));
  await Promise.all([...rids].map(async id => {
    if (!S.lookups.regionsById.has(id)) {
      try { const r = await fetchTrpc("region.getById", { regionId: id }, k); const d = unwrap(r); if (d) S.lookups.regionsById.set(id, d); } catch {}
    }
  }));
  await Promise.all([...uids].map(async id => {
    if (!S.lookups.usersById.has(id)) {
      try { const r = await fetchTrpcApi2("user.getUserLite", { userId: id }, k); const d = unwrap(r); if (d) S.lookups.usersById.set(id, d); } catch {}
    }
  }));
}

async function callServerAI(prompt) {
  const result = await fetchFromServer("/api/ai", {
    method: "POST", timeout: 30000,
    body: JSON.stringify({ prompt, context: {} }),
  });
  return result || { error: "Server unreachable" };
}

function cName(id) {
  return S.lookups.countriesById.get(id)?.name || id?.slice(-6) || "?";
}

async function resolveCountryIds(ids, k) {
  const needed = [...new Set(ids.filter(id => id && !S.lookups.countriesById.has(id)))];
  if (!needed.length) return;
  await Promise.all(needed.map(async id => {
    try { const r = await fetchTrpc("country.getCountryById", { countryId: id }, k); const d = unwrap(r); if (d) S.lookups.countriesById.set(id, d); } catch {}
  }));
}

async function resolveBattles(ids, k) {
  const needed = [...new Set(ids.filter(id => id && !S.lookups.battlesById.has(id)))];
  if (!needed.length) return;
  await Promise.all(needed.map(async id => {
    try { const r = await fetchTrpc("battle.getById", { battleId: id }, k); const b = unwrap(r); if (b) S.lookups.battlesById.set(id, b); } catch {}
  }));
}

async function buildCountryContext(k) {
  const lines = [];
  const cd = _countryDetail;
  if (!cd) return "";

  const cTry = S.lookups.countriesById.get(_selectedCountryId);
  const cNameTxt = cTry?.name || _selectedCountryId.slice(-6);

  // Resolve all country IDs
  const idsToResolve = new Set();
  if (Array.isArray(cd.allies)) cd.allies.forEach(id => idsToResolve.add(id));
  if (Array.isArray(cd.warsWith)) cd.warsWith.forEach(id => idsToResolve.add(id));
  if (Array.isArray(cd.defensivePacts)) cd.defensivePacts.forEach(id => idsToResolve.add(id));
  await resolveCountryIds([...idsToResolve], k);

  // Resolve active battle
  if (cd.currentBattleOrder) {
    await resolveBattles([cd.currentBattleOrder], k);
  }

  // Resolve alliance
  let allianceObj = _alliance;
  if (!allianceObj && cd.allianceId) {
    try { allianceObj = await resolveAlliance(cd.allianceId, k); } catch {}
  }

  // Treasury — use countryWealth from rankings (actual account balance)
  const wealth = cd.rankings?.countryWealth?.value ?? cd.countryWealth;
  lines.push(`Treasury: ${fmtMoney(wealth || 0)} (rank ${cd.rankings?.countryWealth?.rank || "?"})`);

  // Taxes
  if (cd.taxes) {
    const t = cd.taxes;
    lines.push(`Tax rates — Income: ${t.income != null ? t.income + "%" : "N/A"}, Market: ${t.market != null ? t.market + "%" : "N/A"}, Self-work: ${t.selfWork != null ? t.selfWork + "%" : "N/A"}`);
  }

  // Unrest — bar/barMax indicates civil war risk percentage
  if (cd.unrest) {
    const u = cd.unrest;
    const pct = u.barMax > 0 ? ((u.bar / u.barMax) * 100).toFixed(1) : 0;
    lines.push(`Unrest: ${pct}% — potential civil war risk`);
  }

  // Population
  if (cd.currentPopulation != null) {
    const active = cd.rankings?.countryActivePopulation?.value ?? cd.countryActivePopulation;
    const activePct = cd.currentPopulation > 0 ? ((active / cd.currentPopulation) * 100).toFixed(1) : 0;
    lines.push(`Population: ${fmtNum(cd.currentPopulation)} total, ${fmtNum(active || 0)} active (${activePct}% activity)`);
  }

  // Rankings snapshot
  const r = cd.rankings || {};
  const rankLine = [];
  if (r.countryDevelopment) rankLine.push(`Development: ${r.countryDevelopment.value} (rank ${r.countryDevelopment.rank})`);
  if (r.countryActivePopulation) rankLine.push(`Active pop rank: ${r.countryActivePopulation.rank}`);
  if (r.countryDamages) rankLine.push(`Damages: ${fmtNum(r.countryDamages.value)} (rank ${r.countryDamages.rank})`);
  if (r.weeklyCountryDamagesPerCitizen) rankLine.push(`Weekly dmg/citizen: ${fmtNum(r.weeklyCountryDamagesPerCitizen.value)} (rank ${r.weeklyCountryDamagesPerCitizen.rank})`);
  if (r.countryBounty) rankLine.push(`Bounty: ${fmtMoney(r.countryBounty.value)} (rank ${r.countryBounty.rank})`);
  if (r.countryProductionBonus) rankLine.push(`Production bonus: ${r.countryProductionBonus.value}% (rank ${r.countryProductionBonus.rank})`);
  if (rankLine.length) lines.push(`Rankings — ${rankLine.join(", ")}`);

  // Wars
  if (Array.isArray(cd.warsWith) && cd.warsWith.length) {
    const names = cd.warsWith.map(id => cName(id)).filter(Boolean).join(", ");
    lines.push(`Currently at war with: ${names}`);
  } else {
    lines.push(`Currently at war with: none`);
  }

  // Active battle
  if (cd.currentBattleOrder) {
    const b = S.lookups.battlesById.get(cd.currentBattleOrder);
    if (b) {
      const atk = cName(b.attacker?.country);
      const def = cName(b.defender?.country);
      const reg = S.lookups.regionsById.get(b.defender?.region)?.name || "";
      lines.push(`Active battle: ${atk} vs ${def}${reg ? " in " + reg : ""}`);
    } else {
      lines.push(`Active battle ongoing`);
    }
  }

  // Alliance
  if (allianceObj) {
    const aName = allianceObj.allianceName || allianceObj.name || "";
    const aMembers = allianceObj.members?.length || allianceObj.memberCount || "";
    lines.push(`Alliance: ${aName}${aMembers ? ` (${fmtNum(aMembers)} members)` : ""}`);
  } else if (cd.allianceId) {
    lines.push(`Alliance member (unknown alliance)`);
  }

  // Allies
  if (Array.isArray(cd.allies) && cd.allies.length) {
    const names = cd.allies.map(id => cName(id)).filter(Boolean).join(", ");
    lines.push(`Allies: ${names}`);
  } else {
    lines.push(`Allies: none`);
  }

  // Defensive pacts
  if (Array.isArray(cd.defensivePacts) && cd.defensivePacts.length) {
    const names = cd.defensivePacts.map(id => cName(id)).filter(Boolean).join(", ");
    lines.push(`Defensive pacts with: ${names}`);
  }

  // Ruling party
  if (cd.rulingParty) {
    const party = _parties.find(p => p._id === cd.rulingParty);
    if (party) {
      let partyDesc = `Ruling party: ${party.name}`;
      const ethics = formatPartyEthics(party.ethics);
      if (ethics) partyDesc += ` (${ethics})`;
      if (party.leader) {
        const leader = S.lookups.usersById.get(party.leader);
        if (leader) partyDesc += `, led by ${leader.username}`;
      }
      lines.push(partyDesc);
    }
  }

  // Government structure
  if (_government) {
    const govRoles = [];
    const roleMap = { president: "President", vicePresident: "Vice President", minOfDefense: "Minister of Defense", minOfEconomy: "Minister of Economy", minOfForeignAffairs: "Minister of Foreign Affairs" };
    for (const [key, label] of Object.entries(roleMap)) {
      const uid = _government[key];
      if (uid) {
        const user = S.lookups.usersById.get(uid);
        govRoles.push(`${label}: ${user?.username || uid.slice(-6)}`);
      }
    }
    if (govRoles.length) lines.push(`Government — ${govRoles.join(", ")}`);
    const congress = _government.congressMembers || [];
    if (congress.length) lines.push(`Congress: ${fmtNum(congress.length)} members`);
  }

  // Election context
  const electionContext = await buildElectionContext(k);
  if (electionContext) lines.push(electionContext);

  return lines.join("\n");
}

async function buildElectionContext(k) {
  if (!_elections.length) return "";
  const lines = [];
  const now = Date.now();
  const SEVENTY_TWO_HOURS = 72 * 3600000;

  // Resolve user names for candidates across relevant elections
  const active = _elections.find(e => e.isActive === true || e.status === "voting");
  const recentFinished = _elections.filter(e => {
    if (e.isActive || e.status === "voting") return false;
    const end = e.votesEndAt ? new Date(e.votesEndAt).getTime() : 0;
    return end > 0 && (now - end) < SEVENTY_TWO_HOURS;
  });
  const candidatesToResolve = [];
  if (active) candidatesToResolve.push(...(active.candidates || []));
  for (const e of recentFinished) candidatesToResolve.push(...(e.candidates || []));
  const userIds = [...new Set(candidatesToResolve.map(c => c.user).filter(Boolean))];
  await Promise.all(userIds.map(async uid => {
    if (!S.lookups.usersById.has(uid)) {
      try { const r = await fetchTrpcApi2("user.getUserLite", { userId: uid }, k); const u = unwrap(r); if (u) S.lookups.usersById.set(uid, u); } catch {}
    }
  }));

  // Active election
  if (active) {
    const type = active.type === "president" ? "Presidential" : "Congress";
    const names = (active.candidates || []).map(c => {
      const u = S.lookups.usersById.get(c.user);
      const p = c.party ? _parties.find(x => x._id === c.party) : null;
      return (u?.username || c.user.slice(-6)) + (p ? ` (${p.name})` : "");
    });
    lines.push(`Active ${type} election is ongoing. Total votes cast: ${active.votesCount || 0}. Candidates: ${names.join(", ")}.`);
  }

  // Recently finished elections (< 72h)
  for (const e of recentFinished) {
    const type = e.type === "president" ? "Presidential" : "Congress";
    const end = new Date(e.votesEndAt).getTime();
    const hoursAgo = Math.round((now - end) / 3600000);
    const ago = hoursAgo < 1 ? "less than an hour ago" : hoursAgo + " hours ago";
    const votes = e.votes || {};
    const candidates = e.candidates || [];
    const details = candidates.map(c => {
      const u = S.lookups.usersById.get(c.user);
      const name = u?.username || c.user.slice(-6) || "?";
      const v = votes[c.user] != null ? votes[c.user] : 0;
      return `${name}: ${v} votes${c.isElected ? " ✓ ELECTED" : ""}`;
    });
    const rulingPartyChange = await detectRulingPartyChange(e, k);
    const changeNote = rulingPartyChange ? ` ${rulingPartyChange}` : "";
    lines.push(`Recent ${type} election ended ${ago}. Total votes: ${e.votesCount || 0}. Results: ${details.join("; ")}.${changeNote}`);
  }

  return lines.join("\n");
}

const SNAPSHOT_KEY = "wa-nd-gov-snapshots";

function loadGovernmentSnapshot(countryId) {
  try {
    const all = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "{}");
    return all[countryId] || null;
  } catch { return null; }
}

function saveGovernmentSnapshot(countryId) {
  const snapshot = {
    timestamp: Date.now(),
    rulingParty: _parties.find(p => p._id === _countryDetail?.rulingParty) || null,
    government: _government ? { ..._government } : null,
    governmentMembers: {},
  };
  if (_government) {
    const roleKeys = ["president", "vicePresident", "minOfDefense", "minOfEconomy", "minOfForeignAffairs"];
    const ids = roleKeys.map(k => _government[k]).filter(Boolean);
    for (const uid of ids) {
      const u = S.lookups.usersById.get(uid);
      if (u) snapshot.governmentMembers[uid] = u.username;
    }
  }
  try {
    const all = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "{}");
    all[countryId] = snapshot;
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(all));
  } catch {}
}

const ETHICS_MAP = {
  militarism:   {  "1": "Expansionist",       "2": "Fanatic Expansionist",  "-1": "Pacifist",            "-2": "Fanatic Pacifist" },
  isolationism: {  "1": "Diplomatic",         "2": "Fanatic Diplomatic",    "-1": "Isolationist",        "-2": "Fanatic Isolationist" },
  imperialism:  {  "1": "Imperialist",        "2": "Fanatic Imperialist",   "-1": "Republican",          "-2": "Fanatic Republican" },
  industrialism:{  "1": "Industrialist",      "2": "Fanatic Industrialist", "-1": "Agrarian",            "-2": "Fanatic Agrarian" },
};

function formatPartyEthics(ethics) {
  if (!ethics) return "";
  if (ethics.unethical) return "UNETHICAL";
  const active = [];
  for (const [axis, value] of Object.entries(ETHICS_MAP)) {
    const v = ethics[axis];
    if (v && value[v]) active.push(value[v]);
  }
  return active.length ? active.join(", ") : "";
}

async function detectRulingPartyChange(election, k) {
  const snapshot = loadGovernmentSnapshot(_selectedCountryId);
  if (!snapshot) return "";

  const isPresidentElection = election.type === "president";
  const changes = [];
  const roleMap = { president: "President", vicePresident: "Vice President", minOfDefense: "Minister of Defense", minOfEconomy: "Minister of Economy", minOfForeignAffairs: "Minister of Foreign Affairs" };

  // Compare ruling party
  const oldParty = snapshot.rulingParty;
  const newPartyId = _countryDetail?.rulingParty;
  const newParty = newPartyId ? _parties.find(p => p._id === newPartyId) : null;
  if (oldParty && newParty && oldParty._id !== newPartyId) {
    let change = `Ruling party changed from ${oldParty.name} to ${newParty.name}`;
    const oldEthicsStr = formatPartyEthics(oldParty.ethics);
    const newEthicsStr = formatPartyEthics(newParty.ethics);
    if (oldEthicsStr !== newEthicsStr) {
      change += ` (${oldEthicsStr} → ${newEthicsStr})`;
    }
    changes.push(change);
  }

  // Compare government roles (only for presidential elections)
  if (isPresidentElection && snapshot.government && _government) {
    for (const [key, label] of Object.entries(roleMap)) {
      const oldUid = snapshot.government[key];
      const newUid = _government[key];
      if (oldUid !== newUid) {
        const oldName = snapshot.governmentMembers?.[oldUid] || oldUid?.slice(-6) || "vacant";
        const newUser = S.lookups.usersById.get(newUid);
        const newName = newUser?.username || newUid?.slice(-6) || "vacant";
        if (oldUid && newUid) changes.push(`${label}: ${oldName} → ${newName}`);
        else if (newUid) changes.push(`${label}: now ${newName}`);
        else changes.push(`${label}: ${oldName} removed`);
      }
    }
  }

  // Compare congress size (for congress elections)
  if (!isPresidentElection && snapshot.government && _government) {
    const oldSize = snapshot.government.congressMembers?.length || 0;
    const newSize = _government.congressMembers?.length || 0;
    if (oldSize !== newSize) changes.push(`Congress size: ${oldSize} → ${newSize}`);
  }

  if (changes.length) return "Government changes: " + changes.join(". ") + ".";
  return "";
}

async function fetchArticlesForContext(countryName, k) {
  if (!countryName || !k) return [];
  const seen = new Set();
  const matched = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    try {
      const result = await fetchTrpc("article.getArticlesPaginated", {
        type: "last", limit: 100, cursor,
      }, k);
      const data = unwrap(result);
      const items = data?.items || [];
      if (!items.length) break;
      for (const a of items) {
        const id = a._id || a.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (!["news", "politics", "election"].includes((a.category || "").toLowerCase())) continue;
        const lower = countryName.toLowerCase();
        if (!(a.title || "").toLowerCase().includes(lower) && !(a.content || "").toLowerCase().includes(lower)) continue;
        matched.push(a);
      }
      cursor = data?.nextCursor || null;
      if (!cursor) break;
    } catch { break; }
  }
  return matched;
}

async function resolveArticleContentToPlainText(htmlContent) {
  if (!htmlContent) return "";
  const temp = document.createElement("div");
  temp.innerHTML = htmlContent;
  await resolveContentLinks(temp);
  await new Promise(r => setTimeout(r, 10));
  return temp.innerText || "";
}

async function buildArticleContext(articles, k, countryName) {
  const MAX_ARTICLES = 5;
  const MAX_CHARS = 600;
  const lines = [];
  const sorted = [...articles].sort((a, b) => {
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  const subset = sorted.slice(0, MAX_ARTICLES);
  for (const a of subset) {
    const date = a.createdAt ? fmtDate(a.createdAt) : "";
    const title = a.title || "Untitled";
    const text = await resolveArticleContentToPlainText(a.content);
    const excerpt = text ? text.slice(0, MAX_CHARS) + (text.length > MAX_CHARS ? "…" : "") : "";
    lines.push(`\n[${date}] ${title}\n${excerpt}`);
  }
  const total = articles.length;
  const note = total > MAX_ARTICLES ? ` (showing ${MAX_ARTICLES} of ${total} recent articles)` : "";
  return `\n\n--- News Articles Context ---\nThe following recent news articles mention ${countryName}${note}:\n${lines.join("\n")}`;
}

async function generatePoliticalSummary(countryId, k) {
  const body = document.getElementById("polSummaryBody");
  if (!body) return;

  const country = S.lookups.countriesById.get(countryId);
  const countryName = country?.name || countryId.slice(-6);
  body.innerHTML = `<span style="color:var(--ink-dim);font-size:.82rem">Analyzing events and news articles...</span>`;

  try {
    const articlePromise = fetchArticlesForContext(countryName, k);

    const countryContext = await buildCountryContext(k);

    const events = await fetchPoliticsEvents(k);
    let eventSection = "";
    if (events.length) {
      const countryEvents = events.filter(e => {
        const cs = e.countries || e.data?.countries || [];
        return Array.isArray(cs) && cs.includes(countryId);
      });
      const filtered = countryEvents.filter(e => POLITICS_EVENT_TYPES.has(e.type || e.data?.type));
      if (filtered.length) {
        await resolveEventNames(filtered, k);
        const timeSpan = timeAgoLabel(filtered);
        const eventLines = filtered.map(e => {
          const ed = evtData(e);
          const type = e.type || ed.type || "event";
          const title = buildTitle(e, type, ed);
          const summary = buildSummary(e, type, ed);
          const ts = evtTime(e) || "";
          return `[${ts}] ${fmtType(type)}: ${title} — ${summary}`;
        });

        const moneyTransfers = filtered.filter(e => (e.type || e.data?.type) === "countryMoneyTransfer");
        let moneySummary = "";
        if (moneyTransfers.length) {
          let sent = 0, received = 0;
          const sentTo = {}, receivedFrom = {};
          for (const e of moneyTransfers) {
            const ed = e.data || {};
            const amt = Number(ed.money) || 0;
            const from = S.lookups.countriesById.get(ed.from || ed.sourceCountry)?.name || "";
            const to = S.lookups.countriesById.get(ed.to || ed.targetCountry)?.name || "";
            if (from === countryName || from === countryId || ed.from === countryId || ed.sourceCountry === countryId) {
              sent += amt;
              sentTo[to] = (sentTo[to] || 0) + amt;
            }
            if (to === countryName || to === countryId || ed.to === countryId || ed.targetCountry === countryId) {
              received += amt;
              receivedFrom[from] = (receivedFrom[from] || 0) + amt;
            }
          }
          const sentStr = sent ? `Sent ${fmtMoney(sent)} ${Object.entries(sentTo).map(([k,v]) => `${fmtMoney(v)} to ${k}`).join(", ")}` : "";
          const recvStr = received ? `Received ${fmtMoney(received)} ${Object.entries(receivedFrom).map(([k,v]) => `${fmtMoney(v)} from ${k}`).join(", ")}` : "";
          moneySummary = [sentStr, recvStr].filter(Boolean).join(". ");
        }
        eventSection = `\n\n--- Recent Events (${timeSpan}) ---\n${eventLines.join("\n")}${moneySummary ? `\n\nMoney transfer breakdown for ${countryName}:\n${moneySummary}` : ""}`;
      }
    }

    const matchedArticles = await articlePromise;
    let articleSection = "";
    if (matchedArticles.length) {
      articleSection = await buildArticleContext(matchedArticles, k, countryName);
    }

    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const hasArticleSection = !!articleSection;
    const prompt = `Current date/time: ${nowStr}
Country: ${countryName}

--- Country Snapshot ---
${countryContext}
${eventSection || "\n\nNo recent political events involving this country were found."}
${articleSection}

Based strictly on the country snapshot${eventSection ? " and recent events" : ""}${hasArticleSection ? " and news articles" : ""} above, provide a concise geopolitical analysis covering: diplomatic relationships and alliances, international standing and conflict involvement, domestic political situation, economic patterns, and potential future developments. Only draw conclusions directly supported by the data.`;

    body.innerHTML = `<span style="color:var(--ink-dim);font-size:.82rem">Generating analysis...</span>`;

    const result = await callServerAI(prompt);

    if (result.error) {
      body.innerHTML = `<span style="color:var(--red);font-size:.82rem">${escHtml(result.error)}</span>`;
      return;
    }

    const response = result.response.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, " ");
    body.innerHTML = `
      <div class="pol-summary-header" style="font-family:Georgia,serif;font-size:.9rem;font-weight:700;color:var(--ink);margin-bottom:6px">Political Summary — ${escHtml(countryName)}</div>
      <div class="pol-summary-body" style="font-family:Literata,serif;font-size:.82rem;line-height:1.6;color:var(--ink)"><p>${response}</p></div>
    `;
  } catch (err) {
    body.innerHTML = `<span style="color:var(--red);font-size:.82rem">${escHtml(err.message)}</span>`;
  }
}

export function initPolitics() {
  const input = document.getElementById("politicsCountryInput");
  if (!input) return;

  populateRegionOptions(document.getElementById("politicsRegionOptions"));
  const regionInput = document.getElementById("politicsRegionFilter");
  const regionClr = document.querySelector("[data-clears='politicsRegionFilter']");
  regionInput?.addEventListener("input", () => {
    _politicsRegionFilter = regionInput.value.replace(/^[^a-zA-Z0-9]*/, "").trim();
    if (!_selectedCountryId) renderCountryGrid();
  });
  regionClr?.addEventListener("click", () => {
    if (regionInput) { regionInput.value = ""; _politicsRegionFilter = ""; if (!_selectedCountryId) renderCountryGrid(); regionInput.focus(); }
  });

  const content = document.getElementById("politicsContent");
  content?.addEventListener("click", e => {
    const card = e.target.closest(".pol-country-card");
    if (card) {
      const id = card.dataset.id;
      const country = _countries.find(c => c._id === id);
      if (!country) return;
      const inp = document.getElementById("politicsCountryInput");
      if (inp) inp.value = country.name || "";
      _selectedCountryId = id;
      const k = apiKey();
      if (!k) return;
      loadCountryData(id, k);
      return;
    }
    const partyCard = e.target.closest(".pol-party-card");
    if (partyCard) {
      const idx = partyCard.dataset.pidx;
      const party = _parties[parseInt(idx)];
      if (party) showPartyDetail(party);
      return;
    }
    const electionRow = e.target.closest(".pol-election-row");
    if (electionRow) {
      const eid = electionRow.dataset.electionId;
      if (eid) showElectionDetail(eid);
      return;
    }
  });

  let debounceTimer;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const name = input.value.trim();
      if (!name) return;
      const match = [...document.querySelectorAll("#politicsCountryOptions option")]
        .find(o => o.value.toLowerCase() === name.toLowerCase());
      if (match) {
        const id = match.dataset.id;
        if (id && id !== _selectedCountryId) {
          _selectedCountryId = id;
          const k = apiKey();
          if (!k) return;
          loadCountryData(id, k);
        }
      }
    }, 300);
  });

  const clearBtn = document.querySelector("[data-clears='politicsCountryInput']");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      input.focus();
      _selectedCountryId = "";
      if (_countries.length) renderCountryGrid();
    });
  }
}

export function copyPoliticsReport() {
  const country = _countries.find(c => c._id === _selectedCountryId);
  const countryName = country?.name || _selectedCountryId.slice(-6);
  if (!_selectedCountryId) { toast("Select a country first."); return; }

  const lines = [`# War Era Politics Report — ${countryName}`, `Generated: ${new Date().toUTCString()}`, ""];

  // Government
  if (_government) {
    lines.push("## Government");
    const roleMap = { president: "President", vicePresident: "Vice President", minOfDefense: "Minister of Defense", minOfEconomy: "Minister of Economy", minOfForeignAffairs: "Foreign Affairs" };
    for (const [key, label] of Object.entries(roleMap)) {
      const uid = _government[key];
      if (uid) {
        const user = S.lookups.usersById.get(uid);
        lines.push(`${label}: ${user?.username || uid.slice(-6)}`);
      }
    }
    if (_countryDetail?.rulingParty) {
      const party = _parties.find(p => p._id === _countryDetail.rulingParty);
      if (party) {
        let rp = `Ruling Party: ${party.name}`;
        const ethics = formatPartyEthics(party.ethics);
        if (ethics) rp += ` (${ethics})`;
        lines.push(rp);
      }
    }
    if (_alliance) lines.push(`Alliance: ${_alliance.allianceName || _alliance.name || ""}`);
    const congress = _government.congressMembers || [];
    if (congress.length) lines.push(`Congress: ${congress.length} members`);
    lines.push("");
  }

  // Country
  const cd = _countryDetail;
  if (cd) {
    lines.push("## Country Snapshot");
    const wealth = cd.rankings?.countryWealth?.value ?? cd.countryWealth;
    lines.push(`Treasury: ${fmtMoney(wealth || 0)} (rank ${cd.rankings?.countryWealth?.rank || "?"})`);
    if (cd.taxes) {
      const t = cd.taxes;
      lines.push(`Tax rates — Income: ${t.income != null ? t.income + "%" : "N/A"}, Market: ${t.market != null ? t.market + "%" : "N/A"}, Self-work: ${t.selfWork != null ? t.selfWork + "%" : "N/A"}`);
    }
    if (cd.currentPopulation != null) {
      const active = cd.rankings?.countryActivePopulation?.value ?? cd.countryActivePopulation;
      const activePct = cd.currentPopulation > 0 ? ((active / cd.currentPopulation) * 100).toFixed(1) : 0;
      lines.push(`Population: ${fmtNum(cd.currentPopulation)} total, ${fmtNum(active || 0)} active (${activePct}% activity)`);
    }
    if (cd.unrest) {
      const u = cd.unrest;
      const pct = u.barMax > 0 ? ((u.bar / u.barMax) * 100).toFixed(1) : 0;
      lines.push(`Unrest: ${pct}%`);
    }
    if (Array.isArray(cd.warsWith) && cd.warsWith.length) {
      lines.push(`At war with: ${cd.warsWith.map(id => cName(id)).filter(Boolean).join(", ")}`);
    } else { lines.push("At war with: none"); }
    if (Array.isArray(cd.allies) && cd.allies.length) {
      lines.push(`Allies: ${cd.allies.map(id => cName(id)).filter(Boolean).join(", ")}`);
    }
    lines.push("");
  }

  // Parties
  lines.push(`## Parties (${_parties.length})`);
  for (const p of _parties) {
    const leader = p.leader ? S.lookups.usersById.get(p.leader) : null;
    const leaderName = leader?.username || (p.leader ? "#" + p.leader.slice(-6) : "—");
    const members = Array.isArray(p.members) ? p.members.length : (p.membersCount || p.memberCount || "?");
    let pl = `${p.name || "Unnamed"} — Leader: ${leaderName} · ${fmtNum(members)} members`;
    const ethics = formatPartyEthics(p.ethics);
    if (ethics) pl += ` [${ethics}]`;
    lines.push(pl);
  }
  lines.push("");

  // Elections
  lines.push(`## Elections (${_elections.length})`);
  for (const e of _elections) {
    const type = e.type === "president" ? "Presidential" : "Congress";
    const start = e.votesStartAt ? fmtDate(e.votesStartAt) : "—";
    const end = e.votesEndAt ? fmtDate(e.votesEndAt) : "—";
    const votes = e.votesCount != null ? `${fmtNum(e.votesCount)} votes` : "";
    lines.push(`${type} ${start} → ${end} ${votes}`);
  }

  navigator.clipboard.writeText(lines.join("\n")).then(() => toast("Politics report copied."));
}

export function capturePoliticsReport() {
  const country = _countries.find(c => c._id === _selectedCountryId);
  const countryName = country?.name || _selectedCountryId.slice(-6);
  if (!_selectedCountryId) { toast("Select a country first."); return; }

  const genLine = "Generated: " + new Date().toUTCString();
  const meta = [genLine];

  let govHtml = "";
  if (_government) {
    const roleMap = { president: "President", vicePresident: "Vice President", minOfDefense: "Minister of Defense", minOfEconomy: "Minister of Economy", minOfForeignAffairs: "Foreign Affairs" };
    for (const [key, label] of Object.entries(roleMap)) {
      const uid = _government[key];
      if (uid) {
        const user = S.lookups.usersById.get(uid);
        govHtml += `<div>${label}: ${user?.username || uid.slice(-6)}</div>`;
      }
    }
    if (_countryDetail?.rulingParty) {
      const party = _parties.find(p => p._id === _countryDetail.rulingParty);
      if (party) {
        let rp = `Ruling Party: ${party.name}`;
        const ethics = formatPartyEthics(party.ethics);
        if (ethics) rp += ` (${ethics})`;
        govHtml += `<div>${rp}</div>`;
      }
    }
    if (_alliance) govHtml += `<div>Alliance: ${_alliance.allianceName || _alliance.name || ""}</div>`;
    const congress = _government.congressMembers || [];
    if (congress.length) govHtml += `<div>Congress: ${congress.length} members</div>`;
  }

  const cd = _countryDetail;
  let ctxHtml = "";
  if (cd) {
    const wealth = cd.rankings?.countryWealth?.value ?? cd.countryWealth;
    ctxHtml += `<div>Treasury: ${fmtMoney(wealth || 0)} (rank ${cd.rankings?.countryWealth?.rank || "?"})</div>`;
    if (cd.taxes) {
      const t = cd.taxes;
      ctxHtml += `<div>Tax rates — Income: ${t.income != null ? t.income + "%" : "N/A"}, Market: ${t.market != null ? t.market + "%" : "N/A"}, Self-work: ${t.selfWork != null ? t.selfWork + "%" : "N/A"}</div>`;
    }
    if (cd.currentPopulation != null) {
      const active = cd.rankings?.countryActivePopulation?.value ?? cd.countryActivePopulation;
      const activePct = cd.currentPopulation > 0 ? ((active / cd.currentPopulation) * 100).toFixed(1) : 0;
      ctxHtml += `<div>Population: ${fmtNum(cd.currentPopulation)} total, ${fmtNum(active || 0)} active (${activePct}%)</div>`;
    }
    if (Array.isArray(cd.warsWith) && cd.warsWith.length) {
      ctxHtml += `<div>At war with: ${cd.warsWith.map(id => cName(id)).filter(Boolean).join(", ")}</div>`;
    } else { ctxHtml += `<div>At war with: none</div>`; }
  }

  const partyRows = _parties.map(p => {
    const leader = p.leader ? S.lookups.usersById.get(p.leader) : null;
    const leaderName = leader?.username || (p.leader ? "#" + p.leader.slice(-6) : "—");
    const members = Array.isArray(p.members) ? p.members.length : (p.membersCount || p.memberCount || 0);
    const ethics = formatPartyEthics(p.ethics);
    return [p.name || "Unnamed", leaderName, String(members), ethics || "—"];
  });

  const electionRows = _elections.map(e => {
    const type = e.type === "president" ? "Presidential" : "Congress";
    const start = e.votesStartAt ? fmtDate(e.votesStartAt) : "—";
    const end = e.votesEndAt ? fmtDate(e.votesEndAt) : "—";
    const votes = e.votesCount != null ? fmtNum(e.votesCount) : "—";
    return [type, start, end, votes];
  });

  const html = cap.pageOpen(`War Era Politics Report — ${countryName}`, "", meta) +
    cap.section("Government", `<div style="font-size:10px;color:var(--ink-dim);line-height:1.5">${govHtml}</div>`) +
    cap.section("Country Snapshot", `<div style="font-size:10px;color:var(--ink-dim);line-height:1.5">${ctxHtml}</div>`) +
    cap.section("Parties", cap.tableBlock("", ["Party", "Leader", "Members", "Ethics"], partyRows, 50)) +
    cap.section("Elections", cap.tableBlock("", ["Type", "Start", "End", "Votes"], electionRows, 50)) +
    cap.pageClose();
  cap.captureHTML(html, "politics_report_" + cap.ts() + ".png");
}

export function loadCountryById(countryId) {
  _selectedCountryId = countryId;
  const c = _countries.find(c => c._id === countryId);
  const input = document.getElementById("politicsCountryInput");
  if (input && c) input.value = c.name;
  const k = apiKey();
  if (!k) return;
  loadCountryData(countryId, k);
}
