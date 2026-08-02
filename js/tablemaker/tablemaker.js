import { escapeHtml } from "../core/utils.js";

let _html2canvasPromise = null;
function loadHtml2Canvas() {
  if (_html2canvasPromise) return _html2canvasPromise;
  _html2canvasPromise = new Promise((resolve, reject) => {
    if (window.html2canvas) { resolve(window.html2canvas); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => { _html2canvasPromise = null; reject(new Error("Failed to load html2canvas from CDN")); };
    document.head.appendChild(s);
  });
  return _html2canvasPromise;
}

function setStatus(msg, type) {
  const el = document.getElementById("tmStatus");
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ""; el.classList.remove("error"); return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle("error", type === "error");
}

function getInput() { return document.getElementById("tmInput"); }

function detectFormat(text) {
  const trimmed = text.trim();
  if (/^\|.*\|/.test(trimmed) && /\|[\s-:]+\|/.test(trimmed)) return "markdown";
  const lines = trimmed.split("\n").filter(l => l.trim());
  const tabCount = lines.filter(l => l.split("\t").length > 1).length;
  if (tabCount > lines.length * 0.5) return "tsv";
  const commaCount = lines.filter(l => l.split(",").length > 2).length;
  if (commaCount > lines.length * 0.5) return "csv";
  if (/^\s*[\u2022\-\*]\s/m.test(trimmed)) return "bullets";
  if (/^\s*\d+[\.\)]\s/m.test(trimmed)) return "numbered";
  return "plaintext";
}

function parseMarkdown(text) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];
  let headers = null;
  for (const line of lines) {
    if (/^\|[\s\-:|]+\|$/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map(c => c.trim());
    if (cells.length === 0) continue;
    if (!headers) headers = cells;
    else rows.push(cells);
  }
  return { headers, rows };
}

function parseDelimited(text, delimiter) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];
  let headers = null;
  for (const line of lines) {
    const cells = line.split(delimiter).map(c => c.trim());
    if (cells.length < 2) continue;
    if (!headers) headers = cells;
    else rows.push(cells);
  }
  return { headers, rows };
}

function parseBullets(text) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];
  let headers = null;
  for (const line of lines) {
    const cleaned = line.replace(/^[\u2022\-\*]\s*/, "").trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/\s{2,}|\t/).map(c => c.trim()).filter(Boolean);
    if (parts.length < 2) { rows.push([cleaned]); continue; }
    if (!headers) headers = parts;
    else rows.push(parts);
  }
  return { headers, rows };
}

function parseNumbered(text) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];
  let headers = null;
  for (const line of lines) {
    const cleaned = line.replace(/^\d+[\.\)]\s*/, "").trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/\s{2,}|\t/).map(c => c.trim()).filter(Boolean);
    if (parts.length < 2) { rows.push([cleaned]); continue; }
    if (!headers) headers = parts;
    else rows.push(parts);
  }
  return { headers, rows };
}

function parsePlaintext(text) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];
  let headers = null;
  for (const line of lines) {
    const parts = line.split(/\t/).map(c => c.trim()).filter(Boolean);
    if (parts.length < 2) {
      const spaced = line.split(/\s{3,}/).map(c => c.trim()).filter(Boolean);
      if (spaced.length >= 2) {
        if (!headers) headers = spaced;
        else rows.push(spaced);
      } else {
        rows.push([line]);
      }
    } else {
      if (!headers) headers = parts;
      else rows.push(parts);
    }
  }
  return { headers, rows };
}

function computeColPixelWidths(headers, rows) {
  const CHAR_W = 7.4;
  const PAD = 34;
  const cols = headers.length;
  const widths = [];
  for (let c = 0; c < cols; c++) {
    let mx = headers[c].length;
    for (const r of rows) mx = Math.max(mx, (r[c] || "").length);
    widths[c] = Math.max(70, Math.ceil(mx * CHAR_W) + PAD);
  }
  return widths;
}

function classifyColumns(headers, rows) {
  const cols = headers.length;
  const types = [];
  for (let c = 0; c < cols; c++) {
    const vals = rows.map(r => r[c] || "");
    const allNum = vals.every(v => /^[\d\.\,\-\+MKBk]+$/.test(v.trim()));
    const short = vals.every(v => v.trim().length <= 4);
    if (allNum && short) types.push("center");
    else types.push("left");
  }
  return types;
}

function renderTable(headers, rows) {
  const widths = computeColPixelWidths(headers, rows);
  const types = classifyColumns(headers, rows);
  const colCount = headers.length;
  const total = widths.reduce((a, b) => a + b, 0);

  let html = `<div class="tm-table-wrap"><table style="width:${total}px">`;
  html += "<colgroup>";
  for (let c = 0; c < colCount; c++) html += `<col style="width:${widths[c]}px">`;
  html += "</colgroup>";
  html += "<thead><tr>";
  for (let c = 0; c < colCount; c++) html += `<th>${escapeHtml(headers[c])}</th>`;
  html += "</tr></thead><tbody>";
  for (const row of rows) {
    html += "<tr>";
    for (let c = 0; c < colCount; c++) {
      const cls = types[c] === "center" ? ' class="col-center"' : "";
      html += `<td${cls}>${escapeHtml(row[c] || "")}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table></div>";
  return html;
}

function toMarkdown(headers, rows) {
  const maxLens = headers.map((h, i) => {
    let mx = h.length;
    for (const r of rows) mx = Math.max(mx, (r[i] || "").length);
    return mx;
  });
  let md = "| " + headers.map((h, i) => h.padEnd(maxLens[i])).join(" | ") + " |\n";
  md += "| " + maxLens.map(l => "-".repeat(l)).join(" | ") + " |\n";
  for (const row of rows) {
    md += "| " + row.map((c, i) => (c || "").padEnd(maxLens[i])).join(" | ") + " |\n";
  }
  return md;
}

let lastHeaders = null;
let lastRows = null;

function convert() {
  const input = getInput();
  const text = input ? input.value : "";
  const output = document.getElementById("tmOutput");
  if (!output) return;
  if (!text.trim()) {
    setStatus("No input provided", "error");
    output.innerHTML = '<div id="tmEmptyMsg" class="tm-empty">Your table will appear here</div>';
    return;
  }
  const fmt = detectFormat(text);
  setStatus("Detected format: " + fmt.toUpperCase());

  let result;
  switch (fmt) {
    case "markdown": result = parseMarkdown(text); break;
    case "tsv": result = parseDelimited(text, "\t"); break;
    case "csv": result = parseDelimited(text, ","); break;
    case "bullets": result = parseBullets(text); break;
    case "numbered": result = parseNumbered(text); break;
    default: result = parsePlaintext(text); break;
  }

  if (!result.headers || result.rows.length === 0) {
    setStatus("Could not parse table data", "error");
    output.innerHTML = '<div id="tmEmptyMsg" class="tm-empty">Could not detect headers and rows</div>';
    return;
  }

  lastHeaders = result.headers;
  lastRows = result.rows;
  output.innerHTML = renderTable(result.headers, result.rows);
}

function clearAll() {
  const input = getInput();
  if (input) input.value = "";
  const output = document.getElementById("tmOutput");
  if (output) output.innerHTML = '<div id="tmEmptyMsg" class="tm-empty">Your table will appear here</div>';
  setStatus("");
  lastHeaders = null;
  lastRows = null;
}

function copyHTML() {
  const table = document.querySelector("#tmOutput .tm-table-wrap");
  if (!table) return setStatus("Nothing to copy", "error");
  navigator.clipboard.writeText(table.outerHTML).then(() => setStatus("HTML copied to clipboard"));
}

function copyMarkdown() {
  if (!lastHeaders) return setStatus("Nothing to copy", "error");
  navigator.clipboard.writeText(toMarkdown(lastHeaders, lastRows)).then(() => setStatus("Markdown copied to clipboard"));
}

async function exportPNG() {
  const table = document.querySelector("#tmOutput .tm-table-wrap");
  if (!table) return setStatus("Nothing to export", "error");
  setStatus("Rendering PNG...");
  try {
    const html2canvas = await loadHtml2Canvas();
    const tableEl = table.querySelector("table");
    const tableW = tableEl ? tableEl.getBoundingClientRect().width : 0;
    const clone = table.cloneNode(true);
    clone.style.position = "fixed";
    clone.style.left = "-9999px";
    clone.style.top = "0";
    clone.style.width = Math.round(tableW) + "px";
    document.body.appendChild(clone);
    const canvas = await html2canvas(clone, { backgroundColor: null, scale: 2, useCORS: true, logging: false });
    document.body.removeChild(clone);
    const link = document.createElement("a");
    link.download = "table.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    setStatus("PNG downloaded");
  } catch (err) {
    setStatus("PNG export failed: " + (err.message || "unknown error"), "error");
  }
}

export function initTableMaker() {
  document.getElementById("tmConvertBtn")?.addEventListener("click", convert);
  document.getElementById("tmClearBtn")?.addEventListener("click", clearAll);
  document.getElementById("tmCopyHtmlBtn")?.addEventListener("click", copyHTML);
  document.getElementById("tmCopyMdBtn")?.addEventListener("click", copyMarkdown);
  document.getElementById("tmPngBtn")?.addEventListener("click", exportPNG);
}
