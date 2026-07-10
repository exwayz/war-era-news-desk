import { S } from "../core/state.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { toast } from "../ui/toast.js";

let _countries = [];

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
    renderCountryList();
  } catch (err) {
    list.innerHTML = `<p class="status-msg" style="padding:12px;color:var(--red)">Error: ${err.message}</p>`;
  }
}

function renderCountryList() {
  const list = document.getElementById("countryLinkList");
  if (!list) return;
  if (!_countries.length) {
    list.innerHTML = '<p class="status-msg" style="padding:12px">No countries found.</p>';
    return;
  }
  document.getElementById("linkCount")?.remove();
  const header = document.querySelector(".links-toolbar");
  if (header) {
    const count = document.createElement("span");
    count.id = "linkCount";
    count.className = "meta-text";
    count.textContent = _countries.length + " countries";
    header.appendChild(count);
  }
  const frag = document.createDocumentFragment();
  for (const c of _countries) {
    const id = c._id;
    if (!id) continue;
    const path = "/country/" + id;
    const code = c.code || "";
    const flag = code ? `https://flagcdn.com/${code.toLowerCase()}.svg` : "";
    const row = document.createElement("div");
    row.className = "link-row";
    row.innerHTML = `
      <span class="link-flag">${flag ? `<img src="${flag}" alt="" loading="lazy" width="20" height="15">` : ""}</span>
      <span class="link-name">${escHtml(c.name || id.slice(-8))}</span>
      <code class="link-path">${path}</code>
      <button class="btn-tiny link-copy" data-path="${path}">Copy</button>
    `;
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
  if (!_countries.length) { toast("No countries loaded."); return; }
  const links = _countries
    .filter(c => c._id)
    .map(c => `/country/${c._id}`)
    .join("\n");
  navigator.clipboard.writeText(links).then(() => toast(_countries.length + " links copied."));
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
