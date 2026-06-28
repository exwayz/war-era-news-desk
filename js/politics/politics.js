import { S } from "../core/state.js";
import { apiKey, fetchTrpc, fetchTrpcApi2, fetchTrpcApi5, unwrap } from "../core/api.js";
import { fmtNum, fmtDate } from "../core/utils.js";

let _loaded = false;
let _countries = [];
let _selectedCountryId = "";
let _government = null;
let _countryDetail = null;
let _parties = [];
let _elections = [];
let _alliance = null;

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
  } catch (err) {
    status.textContent = "Error: " + err.message;
  }
  status.hidden = true;
}

async function fetchElections(countryId, k) {
  const input = { countryId, limit: 50, direction: "forward" };
  try {
    const r = await fetchTrpc("election.getElections", input, k);
    const d = unwrap(r);
    const items = Array.isArray(d) ? d : (d?.items || []);
    if (items.length) return items;
  } catch {}
  try {
    const r = await fetchTrpcApi5("election.getElections", input, k);
    const d = unwrap(r);
    const items = Array.isArray(d) ? d : (d?.items || []);
    if (items.length) return items;
  } catch {}
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
    { key: "president", label: "President", icon: "👤" },
    { key: "vicePresident", label: "Vice President", icon: "👥" },
    { key: "minOfDefense", label: "Minister of Defense", icon: "⚔" },
    { key: "minOfEconomy", label: "Minister of Economy", icon: "💰" },
    { key: "minOfForeignAffairs", label: "Foreign Affairs", icon: "🌍" },
  ];

  const roleHtml = roles.map(r => {
    const userId = _government[r.key];
    if (!userId) return '';
    const user = S.lookups.usersById.get(userId);
    return `
      <div class="pol-role-row">
        <span class="pol-role-icon">${r.icon}</span>
        <span class="pol-role-label">${r.label}</span>
        <span class="pol-role-name">${userAvatar(user, userId)} ${escHtml(user?.username || '#' + userId.slice(-6))}</span>
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
        <span class="pol-role-label">Ruling Party</span>
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
        <span class="pol-role-label">Alliance</span>
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
        <span class="pol-role-label">Defensive Pacts</span>
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
          return `<span class="pol-congress-item">${userAvatar(u, uid)} ${escHtml(u?.username || '#' + uid.slice(-6))}</span>`;
        }).join('')}</div>
      </details>`
    : '';

  return roleHtml + extraHtml + memberHtml;
}

function userAvatar(u, uid) {
  const url = u?.avatarUrl;
  if (url) return `<img class="pol-user-avatar" src="${url}" alt="" loading="lazy">`;
  const initial = (u?.username?.charAt(0) || '?').toUpperCase();
  return `<span class="pol-user-avatar pol-user-initials">${initial}</span>`;
}

function renderParties() {
  if (!_parties.length) return '<p class="pol-empty">No parties</p>';
  return _parties.map(p => {
    const leader = p.leader ? S.lookups.usersById.get(p.leader) : null;
    const leaderName = leader?.username || (p.leader ? '#' + p.leader.slice(-6) : '—');
    const avatar = p.avatarUrl ? `<img class="pol-party-avatar" src="${p.avatarUrl}" alt="" loading="lazy">` : '<span class="pol-party-avatar pol-party-avatar--initials">' + (p.name?.charAt(0) || '?') + '</span>';
    const members = Array.isArray(p.members) ? p.members.length : (p.membersCount || p.memberCount || '?');
    return `
      <div class="pol-party-card">
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

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

export function initPolitics() {
  const input = document.getElementById("politicsCountryInput");
  if (!input) return;

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
    });
  }
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
