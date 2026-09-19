import { FONTS } from "../jotter/jotter.js";
import { renderElementPNG, addElementToImageLibrary } from "./exporters.js";

const DEFAULT_FONT = "Arial, sans-serif";

const state = {
  rows: 0,
  cols: 0,
  colWidths: [],
  rowHeights: [],
  cells: [],
  selected: null,
  mode: "cell",
  resizing: null,
  fontFamily: DEFAULT_FONT,
  zoom: 1,
};

let refs = {};

function ref(id) {
  if (!refs[id]) refs[id] = document.getElementById(id);
  return refs[id];
}

function setDrawerStatus(msg, type) {
  const el = ref("tdStatus");
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ""; el.classList.remove("error"); return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle("error", type === "error");
}

function makeCell() {
  return {
    text: "",
    fontFamily: state.fontFamily || DEFAULT_FONT,
    fontSize: 14,
    bold: false,
    italic: false,
    underline: false,
    color: "#111111",
    fill: "#ffffff",
    align: "left",
    vertical: "middle",
    borderWidth: 1,
    borderColor: "#333333",
  };
}

function createCells(rows, cols) {
  state.cells = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => makeCell())
  );
}

function resizeCellMatrix(oldRows, oldCols, newRows, newCols) {
  const old = state.cells;
  state.cells = Array.from({ length: newRows }, (_, r) =>
    Array.from({ length: newCols }, (_, c) => old[r]?.[c] || makeCell())
  );
  state.rows = newRows;
  state.cols = newCols;
}

function tableWidth() {
  return state.colWidths.reduce((a, b) => a + b, 0);
}

function tableHeight() {
  return state.rowHeights.reduce((a, b) => a + b, 0);
}

function positions() {
  const xs = [0], ys = [0];
  for (const w of state.colWidths) xs.push(xs[xs.length - 1] + w);
  for (const h of state.rowHeights) ys.push(ys[ys.length - 1] + h);
  return { xs, ys };
}

function setupCanvasSize() {
  const canvas = ref("tdCanvas");
  if (!canvas) return;
  const w = state.rows > 0 ? tableWidth() : 800;
  const h = state.rows > 0 ? tableHeight() : 500;
  canvas.width = w;
  canvas.height = h;
  updateZoomLayout();
}

function updateZoomLayout() {
  const canvas = ref("tdCanvas");
  const wrap = ref("tdZoomWrap");
  const stage = ref("tdStage");
  if (!canvas || !wrap) return;
  wrap.style.width = canvas.width + "px";
  wrap.style.height = canvas.height + "px";
  wrap.style.transform = `scale(${state.zoom})`;
  if (stage) {
    stage.style.width = Math.round(canvas.width * state.zoom) + "px";
    stage.style.height = Math.round(canvas.height * state.zoom) + "px";
  }
}

function setZoom(zoom) {
  state.zoom = Math.min(3, Math.max(0.25, zoom));
  updateZoomLayout();
  const slider = ref("tdZoom");
  if (slider) slider.value = String(Math.round(state.zoom * 100));
  const label = ref("tdZoomLabel");
  if (label) label.textContent = Math.round(state.zoom * 100) + "%";
}

function drawSelectionOnly() {
  const canvas = ref("tdCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!state.rows || !state.cols) return;

  const { xs, ys } = positions();
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.cells[r][c];
      const x = xs[c], y = ys[r], w = state.colWidths[c], h = state.rowHeights[r];

      ctx.fillStyle = cell.fill;
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = cell.borderColor;
      ctx.lineWidth = cell.borderWidth;
      ctx.strokeRect(
        x + cell.borderWidth / 2,
        y + cell.borderWidth / 2,
        w - cell.borderWidth,
        h - cell.borderWidth
      );
    }
  }

  if (state.selected) {
    let { r, c } = state.selected;
    let x = xs[c], y = ys[r], w = state.colWidths[c], h = state.rowHeights[r];
    if (state.mode === "row") { x = 0; w = tableWidth(); }
    if (state.mode === "col") { y = 0; h = tableHeight(); }

    ctx.save();
    ctx.fillStyle = "rgba(90, 140, 220, 0.10)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#4f8fe8";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.restore();
  }
}

function updateSelectionInfo() {
  const el = ref("tdSelectionInfo");
  if (!el) return;
  if (!state.selected || !state.rows) {
    el.textContent = "No table yet.";
    return;
  }
  const { r, c } = state.selected;
  el.textContent =
    `Row ${r + 1}, Column ${c + 1}` +
    `\n${state.colWidths[c]} × ${state.rowHeights[r]} px`;
}

function updateInspector() {
  if (!state.selected) return;
  const { r, c } = state.selected;
  const cell = state.cells[r][c];
  const cellW = ref("tdCellWidth"), cellH = ref("tdCellHeight"),
        vAlign = ref("tdVerticalAlign"), bw = ref("tdBorderWidth"),
        bc = ref("tdBorderColor");
  if (cellW) cellW.value = state.colWidths[c];
  if (cellH) cellH.value = state.rowHeights[r];
  if (vAlign) vAlign.value = cell.vertical;
  if (bw) bw.value = cell.borderWidth;
  if (bc) bc.value = cell.borderColor;

  const ff = ref("tdFontFamily");
  if (ff && ff.options.length) ff.value = cell.fontFamily;
  const fs = ref("tdFontSize");
  if (fs && fs.options.length) fs.value = String(cell.fontSize);
  const tc = ref("tdTextColor"), fc = ref("tdFillColor");
  if (tc) tc.value = cell.color;
  if (fc) fc.value = cell.fill;

  ref("tdBoldBtn")?.classList.toggle("active", !!cell.bold);
  ref("tdItalicBtn")?.classList.toggle("active", !!cell.italic);
  ref("tdUnderlineBtn")?.classList.toggle("active", !!cell.underline);
  ["left", "center", "right"].forEach(a => ref(`tdAlign${a[0].toUpperCase()}${a.slice(1)}`)?.classList.toggle("active", cell.align === a));
}

function updateEditors() {
  const editLayer = ref("tdEditLayer");
  if (!editLayer) return;
  editLayer.innerHTML = "";

  if (!state.rows || !state.cols) return;

  const { xs, ys } = positions();
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.cells[r][c];
      const editor = document.createElement("textarea");
      editor.className = "cell-editor";
      editor.value = cell.text;
      editor.dataset.r = r;
      editor.dataset.c = c;

      editor.style.left = xs[c] + "px";
      editor.style.top = ys[r] + "px";
      editor.style.width = state.colWidths[c] + "px";
      editor.style.height = state.rowHeights[r] + "px";
      editor.style.fontFamily = cell.fontFamily || DEFAULT_FONT;
      editor.style.fontSize = cell.fontSize + "px";
      editor.style.fontWeight = cell.bold ? "700" : "400";
      editor.style.fontStyle = cell.italic ? "italic" : "normal";
      editor.style.textDecoration = cell.underline ? "underline" : "none";
      editor.style.color = cell.color;
      editor.style.textAlign = cell.align;
      editor.style.background = "transparent";

      if (cell.vertical === "top") editor.style.paddingTop = "7px";
      else if (cell.vertical === "middle") {
        editor.style.paddingTop = Math.max(7, (state.rowHeights[r] - cell.fontSize * 1.25) / 2) + "px";
      } else {
        editor.style.paddingTop = Math.max(7, state.rowHeights[r] - cell.fontSize * 1.25 - 7) + "px";
      }

      editor.addEventListener("focus", () => {
        state.selected = { r, c };
        updateInspector();
        updateSelectionInfo();
        drawSelectionOnly();
      });

      editor.addEventListener("input", () => {
        cell.text = editor.value;
      });

      editor.addEventListener("pointerdown", (e) => {
        if (e.detail >= 2) return;
        state.selected = { r, c };
        drawSelectionOnly();
      });

      editLayer.appendChild(editor);
    }
  }
}

function draw() {
  setupCanvasSize();
  const canvas = ref("tdCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const hint = ref("tdEmptyHint");
  if (!state.rows || !state.cols) {
    if (hint) hint.hidden = false;
    updateEditors();
    updateSelectionInfo();
    updateActionButtons();
    return;
  }
  if (hint) hint.hidden = true;

  const { xs, ys } = positions();
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.cells[r][c];
      const x = xs[c], y = ys[r], w = state.colWidths[c], h = state.rowHeights[r];

      ctx.fillStyle = cell.fill;
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = cell.borderColor;
      ctx.lineWidth = cell.borderWidth;
      ctx.strokeRect(
        x + cell.borderWidth / 2,
        y + cell.borderWidth / 2,
        w - cell.borderWidth,
        h - cell.borderWidth
      );
    }
  }

  if (state.selected) {
    let { r, c } = state.selected;
    let x = xs[c], y = ys[r], w = state.colWidths[c], h = state.rowHeights[r];
    if (state.mode === "row") { x = 0; w = tableWidth(); }
    if (state.mode === "col") { y = 0; h = tableHeight(); }

    ctx.save();
    ctx.fillStyle = "rgba(90, 140, 220, 0.10)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#4f8fe8";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.restore();
  }

  updateEditors();
  updateInspector();
  updateSelectionInfo();
  updateActionButtons();
}

function getCellFromPoint(px, py) {
  const { xs, ys } = positions();
  let c = -1, r = -1;
  for (let i = 0; i < state.cols; i++) {
    if (px >= xs[i] && px < xs[i + 1]) { c = i; break; }
  }
  for (let i = 0; i < state.rows; i++) {
    if (py >= ys[i] && py < ys[i + 1]) { r = i; break; }
  }
  return { r, c };
}

function canvasPoint(e) {
  const canvas = ref("tdCanvas");
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / state.zoom,
    y: (e.clientY - rect.top) / state.zoom,
  };
}

function updateActionButtons() {
  const has = state.rows > 0 && state.cols > 0;
  ["tdCopyHtmlBtn", "tdCopyMdBtn", "tdPngBtn", "tdAddToLibraryBtn"].forEach(id => {
    const b = ref(id);
    if (b) b.disabled = !has;
  });
  const addRow = ref("tdAddRow"), addCol = ref("tdAddCol"), del = ref("tdDeleteTable");
  if (addCol) addCol.disabled = state.rows > 0 && state.cols >= 12;
  if (addRow) addRow.disabled = state.rows >= 24;
  if (del) del.disabled = !has;
}

function applyToSelection(fn) {
  if (!state.selected || !state.rows) return;
  const { r, c } = state.selected;
  if (state.mode === "cell") {
    fn(state.cells[r][c], r, c);
  } else if (state.mode === "row") {
    for (let j = 0; j < state.cols; j++) fn(state.cells[r][j], r, j);
  } else {
    for (let i = 0; i < state.rows; i++) fn(state.cells[i][c], i, c);
  }
  draw();
}

function setSelection(r, c) {
  state.selected = { r, c };
  draw();
}

function setMode(mode) {
  state.mode = mode;
  ["tdSelectCell", "tdSelectRow", "tdSelectCol"].forEach(id => ref(id)?.classList.remove("active"));
  ref(mode === "cell" ? "tdSelectCell" : mode === "row" ? "tdSelectRow" : "tdSelectCol")?.classList.add("active");
  drawSelectionOnly();
}

function beginResize(e, type, index) {
  e.preventDefault();
  e.stopPropagation();
  const start = type === "col" ? e.clientX : e.clientY;
  state.resizing = {
    type,
    index,
    start,
    original: type === "col" ? state.colWidths[index] : state.rowHeights[index],
  };
  document.body.style.cursor = type === "col" ? "col-resize" : "row-resize";
}

function populateFontSelect() {
  const sel = ref("tdFontFamily");
  if (!sel) return;
  sel.innerHTML = "";
  for (const f of FONTS) {
    const opt = document.createElement("option");
    opt.value = f.value || DEFAULT_FONT;
    opt.textContent = f.label;
    if (f.label === "Arial") opt.dataset.default = "1";
    sel.appendChild(opt);
  }
}

function makeDrawer() {
  const drawer = ref("tdDrawerGrid");
  if (!drawer) return;
  drawer.innerHTML = "";
  const label = ref("tdDrawerLabel");
  for (let r = 1; r <= 10; r++) {
    for (let c = 1; c <= 10; c++) {
      const el = document.createElement("div");
      el.className = "td-drawer-cell";
      el.dataset.r = r;
      el.dataset.c = c;

      el.addEventListener("mouseenter", () => {
        drawer.querySelectorAll(".td-drawer-cell").forEach(x => {
          x.classList.toggle("preview", Number(x.dataset.r) <= r && Number(x.dataset.c) <= c);
        });
        if (label) label.textContent = `${c} × ${r} table`;
      });

      el.addEventListener("mouseleave", () => {
        drawer.querySelectorAll(".td-drawer-cell").forEach(x => x.classList.remove("preview"));
        if (label) label.textContent = "Choose table size";
      });

      el.addEventListener("click", () => {
        resizeCellMatrix(state.rows, state.cols, r, c);
        while (state.colWidths.length < c) state.colWidths.push(120);
        state.colWidths = state.colWidths.slice(0, c);
        while (state.rowHeights.length < r) state.rowHeights.push(60);
        state.rowHeights = state.rowHeights.slice(0, r);
        state.selected = { r: 0, c: 0 };
        setDrawerStatus("");
        draw();
      });

      drawer.appendChild(el);
    }
  }
}

function addRow() {
  const oldRows = state.rows;
  resizeCellMatrix(state.rows, state.cols, state.rows + 1, state.cols);
  state.rowHeights.push(60);
  state.selected = { r: oldRows, c: 0 };
  draw();
}

function addCol() {
  const oldCols = state.cols;
  resizeCellMatrix(state.rows, state.cols, state.rows, state.cols + 1);
  state.colWidths.push(120);
  state.selected = { r: 0, c: oldCols };
  draw();
}

function deleteTable() {
  state.rows = 0;
  state.cols = 0;
  state.colWidths = [];
  state.rowHeights = [];
  state.cells = [];
  state.selected = null;
  state.resizing = null;
  setDrawerStatus("Table cleared. Choose a size from the grid to start a new one.");
  draw();
}

function computeColumnWidths(headers, rows) {
  const CHAR_W = 8;
  const PAD = 34;
  return headers.map((h, i) => {
    let mx = Math.max(1, h.length);
    for (const r of rows) mx = Math.max(mx, (r[i] || "").length);
    return Math.max(70, Math.ceil(mx * CHAR_W) + PAD);
  });
}

// Bridge from the Converter: builds a table from {headers, rows}. The first row
// is styled as a bold header row, mirroring how the converter renders tables.
export function loadTableFromData({ headers, rows }) {
  if (!Array.isArray(headers) || headers.length === 0) {
    setDrawerStatus("Cannot load an empty table", "error");
    return;
  }
  const safeRows = Array.isArray(rows) ? rows : [];
  const nRows = safeRows.length + 1;
  const nCols = headers.length;

  resizeCellMatrix(0, 0, nRows, nCols);
  state.colWidths = computeColumnWidths(headers, safeRows);
  state.rowHeights = [42];
  for (let i = 0; i < safeRows.length; i++) state.rowHeights.push(34);

  for (let c = 0; c < nCols; c++) {
    const head = state.cells[0][c];
    head.text = headers[c].trim();
    head.bold = true;
    head.fill = "#f2f3f5";
    head.fontFamily = state.fontFamily || DEFAULT_FONT;
  }
  for (let r = 0; r < safeRows.length; r++) {
    for (let c = 0; c < nCols; c++) {
      const cell = state.cells[r + 1][c];
      cell.text = String(safeRows[r][c] ?? "");
      cell.fontFamily = state.fontFamily || DEFAULT_FONT;
    }
  }

  state.selected = { r: 0, c: 0 };
  state.mode = "cell";
  state.resizing = null;
  draw();
  setDrawerStatus(`Table loaded into the drawer (${nRows} × ${nCols}). Edit it freely, then export.`);
}

export function drawerHasTable() {
  return state.rows > 0 && state.cols > 0;
}

function buildTableDOM() {
  if (!drawerHasTable()) return null;
  const table = document.createElement("table");
  table.style.borderCollapse = "collapse";
  table.style.color = "#111111";

  const colgroup = document.createElement("colgroup");
  for (let c = 0; c < state.cols; c++) {
    const col = document.createElement("col");
    col.style.width = state.colWidths[c] + "px";
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);

  const tbody = document.createElement("tbody");
  for (let r = 0; r < state.rows; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < state.cols; c++) {
      const cell = state.cells[r][c];
      const td = document.createElement("td");
      td.textContent = cell.text;
      td.style.fontFamily = cell.fontFamily || DEFAULT_FONT;
      td.style.fontSize = cell.fontSize + "px";
      td.style.fontWeight = cell.bold ? "700" : "400";
      td.style.fontStyle = cell.italic ? "italic" : "normal";
      td.style.textDecoration = cell.underline ? "underline" : "none";
      td.style.color = cell.color;
      td.style.backgroundColor = cell.fill;
      td.style.textAlign = cell.align;
      td.style.verticalAlign = cell.vertical;
      td.style.border = cell.borderWidth > 0 ? `${cell.borderWidth}px solid ${cell.borderColor}` : "none";
      td.style.padding = "7px 10px";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function drawerMarkdown() {
  if (!drawerHasTable()) return "";
  const maxLens = [];
  for (let c = 0; c < state.cols; c++) {
    let mx = 0;
    for (let r = 0; r < state.rows; r++) mx = Math.max(mx, state.cells[r][c].text.length);
    maxLens[c] = mx;
  }
  let md = "| " + state.cells[0].map((cell, c) => cell.text.padEnd(maxLens[c])).join(" | ") + " |\n";
  md += "| " + maxLens.map(l => "-".repeat(l)).join(" | ") + " |\n";
  for (let r = 1; r < state.rows; r++) {
    md += "| " + state.cells[r].map((cell, c) => cell.text.padEnd(maxLens[c])).join(" | ") + " |\n";
  }
  return md;
}

function copyDrawerHTML() {
  if (!drawerHasTable()) return setDrawerStatus("Create or load a table first", "error");
  navigator.clipboard.writeText(buildTableDOM().outerHTML)
    .then(() => setDrawerStatus("HTML copied to clipboard"));
}

function copyDrawerMarkdown() {
  if (!drawerHasTable()) return setDrawerStatus("Create or load a table first", "error");
  navigator.clipboard.writeText(drawerMarkdown())
    .then(() => setDrawerStatus("Markdown copied to clipboard"));
}

async function exportDrawerPNG() {
  if (!drawerHasTable()) return setDrawerStatus("Create or load a table first", "error");
  try {
    setDrawerStatus("Rendering PNG...");
    const blob = await renderElementPNG(buildTableDOM());
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = "table.png";
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setDrawerStatus("PNG downloaded");
  } catch (err) {
    setDrawerStatus("PNG export failed: " + (err.message || "unknown error"), "error");
  }
}

async function addDrawerToLibrary() {
  if (!drawerHasTable()) return setDrawerStatus("Create or load a table first", "error");
  const btn = ref("tdAddToLibraryBtn");
  const el = buildTableDOM();
  const firstHeading = String(state.cells[0][0]?.text || "").trim().slice(0, 40);
  if (btn) { btn.disabled = true; btn.dataset.loading = "1"; }
  try {
    const added = await addElementToImageLibrary(
      el,
      firstHeading ? `Table — ${firstHeading}` : `war-era-table-${Date.now()}.png`,
      "war-era-table",
      setDrawerStatus
    );
    setDrawerStatus(added ? "Added to the Image Library." : "This table is already in the Image Library.");
  } catch (err) {
    setDrawerStatus(err.message || "Failed to add the table to the Image Library.", "error");
  } finally {
    if (btn) { btn.disabled = false; delete btn.dataset.loading; }
  }
}

function drawerVisible() {
  const panel = ref("tdDrawerPanel");
  return panel && !panel.hidden;
}

function wireHeaders() {
  window.addEventListener("keydown", (e) => {
    if (!drawerVisible()) return;

    if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const map = { b: "tdBoldBtn", i: "tdItalicBtn", u: "tdUnderlineBtn" };
      ref(map[e.key.toLowerCase()])?.click();
      return;
    }

    if (e.key === "Enter" || e.key === "F2") {
      if (state.selected && document.activeElement.tagName !== "TEXTAREA") {
        const { r, c } = state.selected;
        ref("tdEditLayer")?.querySelector(`textarea[data-r="${r}"][data-c="${c}"]`)?.focus();
        e.preventDefault();
      }
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey &&
        document.activeElement.tagName !== "TEXTAREA" && state.selected) {
      const { r, c } = state.selected;
      const editor = ref("tdEditLayer")?.querySelector(`textarea[data-r="${r}"][data-c="${c}"]`);
      if (editor) {
        editor.focus();
        editor.value += e.key;
        state.cells[r][c].text = editor.value;
        e.preventDefault();
      }
    }
  });
}

function wireEvents() {
  const canvas = ref("tdCanvas");
  if (!canvas) return;

  const boldBtn = ref("tdBoldBtn");
  boldBtn?.addEventListener("click", () => applyToSelection(cell => { cell.bold = !cell.bold; }));
  ref("tdItalicBtn")?.addEventListener("click", () => applyToSelection(cell => { cell.italic = !cell.italic; }));
  ref("tdUnderlineBtn")?.addEventListener("click", () => applyToSelection(cell => { cell.underline = !cell.underline; }));

  ref("tdFontFamily")?.addEventListener("change", (e) => {
    state.fontFamily = e.target.value || DEFAULT_FONT;
    applyToSelection(cell => { cell.fontFamily = state.fontFamily; });
  });
  ref("tdFontSize")?.addEventListener("change", (e) => {
    applyToSelection(cell => { cell.fontSize = Number(e.target.value) || 14; });
  });
  ref("tdTextColor")?.addEventListener("input", (e) => {
    applyToSelection(cell => { cell.color = e.target.value; });
  });
  ref("tdFillColor")?.addEventListener("input", (e) => {
    applyToSelection(cell => { cell.fill = e.target.value; });
  });

  ref("tdAlignLeft")?.addEventListener("click", () => applyToSelection(cell => { cell.align = "left"; }));
  ref("tdAlignCenter")?.addEventListener("click", () => applyToSelection(cell => { cell.align = "center"; }));
  ref("tdAlignRight")?.addEventListener("click", () => applyToSelection(cell => { cell.align = "right"; }));

  ref("tdVerticalAlign")?.addEventListener("change", (e) => {
    applyToSelection(cell => { cell.vertical = e.target.value; });
  });
  ref("tdBorderWidth")?.addEventListener("change", (e) => {
    applyToSelection(cell => { cell.borderWidth = Math.max(0, Number(e.target.value) || 0); });
  });
  ref("tdBorderColor")?.addEventListener("input", (e) => {
    applyToSelection(cell => { cell.borderColor = e.target.value; });
  });

  ref("tdCellWidth")?.addEventListener("change", (e) => {
    if (!state.selected) return;
    state.colWidths[state.selected.c] = Math.max(30, Number(e.target.value) || 30);
    draw();
  });
  ref("tdCellHeight")?.addEventListener("change", (e) => {
    if (!state.selected) return;
    state.rowHeights[state.selected.r] = Math.max(25, Number(e.target.value) || 25);
    draw();
  });

  ref("tdSelectCell")?.addEventListener("click", () => setMode("cell"));
  ref("tdSelectRow")?.addEventListener("click", () => setMode("row"));
  ref("tdSelectCol")?.addEventListener("click", () => setMode("col"));

  ref("tdAddRow")?.addEventListener("click", addRow);
  ref("tdAddCol")?.addEventListener("click", addCol);
  ref("tdDeleteTable")?.addEventListener("click", deleteTable);

  ref("tdCopyHtmlBtn")?.addEventListener("click", copyDrawerHTML);
  ref("tdCopyMdBtn")?.addEventListener("click", copyDrawerMarkdown);
  ref("tdPngBtn")?.addEventListener("click", exportDrawerPNG);
  ref("tdAddToLibraryBtn")?.addEventListener("click", addDrawerToLibrary);

  canvas.addEventListener("pointerdown", (e) => {
    if (state.resizing || !state.rows) return;
    const p = canvasPoint(e);
    const { xs, ys } = positions();
    const threshold = 7 / state.zoom;

    for (let i = 1; i < xs.length - 1; i++) {
      if (Math.abs(p.x - xs[i]) <= threshold) { beginResize(e, "col", i - 1); return; }
    }
    for (let i = 1; i < ys.length - 1; i++) {
      if (Math.abs(p.y - ys[i]) <= threshold) { beginResize(e, "row", i - 1); return; }
    }

    const hit = getCellFromPoint(p.x, p.y);
    if (hit.r >= 0 && hit.c >= 0) setSelection(hit.r, hit.c);
  });

  window.addEventListener("pointermove", (e) => {
    if (!state.resizing) return;
    const rs = state.resizing;
    const screenDelta = (rs.type === "col" ? e.clientX : e.clientY) - rs.start;
    const delta = screenDelta / state.zoom;
    const value = Math.max(30, rs.original + delta);
    if (rs.type === "col") state.colWidths[rs.index] = value;
    else state.rowHeights[rs.index] = value;
    draw();
  });

  window.addEventListener("pointerup", () => {
    if (!state.resizing) return;
    state.resizing = null;
    document.body.style.cursor = "";
  });

  canvas.addEventListener("mousemove", (e) => {
    if (state.resizing || !state.rows) return;
    const p = canvasPoint(e);
    const { xs, ys } = positions();
    const threshold = 7 / state.zoom;
    let cursor = "default";
    for (let i = 1; i < xs.length - 1; i++) {
      if (Math.abs(p.x - xs[i]) <= threshold) cursor = "col-resize";
    }
    for (let i = 1; i < ys.length - 1; i++) {
      if (Math.abs(p.y - ys[i]) <= threshold) cursor = "row-resize";
    }
    canvas.style.cursor = cursor;
  });

  ref("tdZoom")?.addEventListener("input", (e) => setZoom(Number(e.target.value) / 100));
  ref("tdZoomReset")?.addEventListener("click", () => setZoom(1));
  ref("tdCanvasWrap")?.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(state.zoom * Math.exp(-e.deltaY * 0.001));
  }, { passive: false });
}

export function initTableDrawer() {
  wireEvents();
  populateFontSelect();
  makeDrawer();
  wireHeaders();
  draw();
  setDrawerStatus("Start by choosing a table size on the left, or convert text below and press Edit Table.");
}

export { draw as refreshDrawer };