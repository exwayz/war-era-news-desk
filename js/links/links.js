import { S } from "../core/state.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { toast } from "../ui/toast.js";
import { getCountriesInRegion, populateRegionOptions } from "../core/regionClassification.js";
import { getCoatOfArmsUrl, retryCoatOfArms } from "../core/coatOfArms.js";

let _countries = [];
let _regionFilter = "";

export async function loadCountries() {
  const k = apiKey();
  if (!k) return;
  const container = document.getElementById("tab-links");
  if (!container) return;

  const list = document.getElementById("countryLinkList");
  if (!list) return;
  list.innerHTML = '<p class="status-msg" style="padding:12px">Loading countries…</p>';

  try {
    const r = await fetchTrpc("country.getAllCountries", {}, k);
    const d = unwrap(r);
    _countries = Array.isArray(d) ? d : (d?.items || d?.results || []);
    _countries.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    populateRegionOptions(document.getElementById("linksRegionOptions"));
    renderCountryList();
  } catch (err) {
    list.innerHTML = `<p class="status-msg" style="padding:12px;color:var(--red)">Error: ${err.message}</p>`;
  }
}

function filterCountriesByRegion() {
  if (!_regionFilter) return _countries;
  const names = getCountriesInRegion(_regionFilter);
  if (!names.length) return _countries;
  const lower = new Set(names.map(n => n.toLowerCase()));
  const filtered = [];
  for (const c of _countries) {
    if (c.name && lower.has(c.name.toLowerCase())) filtered.push(c);
  }
  return filtered;
}

function renderCountryList() {
  const list = document.getElementById("countryLinkList");
  if (!list) return;
  const filtered = filterCountriesByRegion();
  if (!filtered.length) {
    list.innerHTML = '<p class="status-msg" style="padding:12px">No countries match the filter.</p>';
    return;
  }
  else if (!_countries.length) {
    list.innerHTML = '<p class="status-msg" style="padding:12px">No countries found.</p>';
    return;
  }
  document.getElementById("linkCount")?.remove();
  const header = document.querySelector(".links-toolbar");
  const shown = filtered.length;
  const total = _countries.length;
  if (header) {
    const count = document.createElement("span");
    count.id = "linkCount";
    count.className = "meta-text";
    count.textContent = shown + " countries" + (shown < total ? " (" + total + " total)" : "");
    header.appendChild(count);
  }
  const frag = document.createDocumentFragment();
  for (const c of filtered) {
    const id = c._id;
    if (!id) continue;
    const path = "/country/" + id;
    const code = c.code || "";
    const flagFallback = code ? `https://flagcdn.com/${code.toLowerCase()}.svg` : "";
    const coa = getCoatOfArmsUrl(c.name);
    const row = document.createElement("div");
    row.className = "link-row";

    const flagSpan = document.createElement("span");
    flagSpan.className = "link-flag";
    const img = document.createElement("img");
    img.width = 20;
    img.height = 15;
    img.loading = "lazy";
    if (coa) {
      img.src = coa;
      img.alt = "";
      img.dataset.coaCountry = c.name;
      img.dataset.coaFallback = flagFallback;
      img.addEventListener("error", function onCoaError() {
        retryCoatOfArms(this, this.dataset.coaCountry, this.dataset.coaFallback);
      });
    } else if (flagFallback) {
      img.src = flagFallback;
      img.alt = "";
    }
    if (img.src) flagSpan.appendChild(img);
    row.appendChild(flagSpan);

    const nameSpan = document.createElement("span");
    nameSpan.className = "link-name";
    nameSpan.textContent = c.name || id.slice(-8);
    row.appendChild(nameSpan);

    const codeEl = document.createElement("code");
    codeEl.className = "link-path";
    codeEl.textContent = path;
    row.appendChild(codeEl);

    const btn = document.createElement("button");
    btn.className = "btn-tiny link-copy";
    btn.dataset.path = path;
    btn.textContent = "Copy";
    row.appendChild(btn);
    frag.appendChild(row);
  }
  list.innerHTML = "";
  list.appendChild(frag);

  list.addEventListener("click", e => {
    const btn = e.target.closest(".link-copy");
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.path).then(() => toast("Link copied."));
  });
}

export function copyAllLinks() {
  const filtered = filterCountriesByRegion();
  if (!filtered.length) { toast("No countries to copy."); return; }
  const links = filtered
    .filter(c => c._id)
    .map(c => `${c.name || c._id.slice(-8)}: /country/${c._id}`)
    .join("\n");
  navigator.clipboard.writeText(links).then(() => toast(filtered.length + " links copied."));
}

export function initLinksFilters() {
  const input = document.getElementById("linksRegionFilter");
  if (!input) return;
  input.addEventListener("input", () => {
    _regionFilter = input.value.replace(/^[^a-zA-Z0-9]*/, "").trim();
    renderCountryList();
  });
  const clearBtn = document.querySelector("[data-clears='linksRegionFilter']");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      _regionFilter = "";
      renderCountryList();
    });
  }
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
