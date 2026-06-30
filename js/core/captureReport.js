function cv(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function ts() {
  const d = new Date();
  return d.getFullYear() +
    String(d.getMonth()+1).padStart(2,"0") +
    String(d.getDate()).padStart(2,"0") + "_" +
    String(d.getHours()).padStart(2,"0") +
    String(d.getMinutes()).padStart(2,"0") +
    String(d.getSeconds()).padStart(2,"0");
}

function buildStyles() {
  const bg = cv("--bg");
  const ink = cv("--ink");
  const inkDim = cv("--ink-dim");
  const line = cv("--line");
  const surface = cv("--surface");
  return {
    container: `font-family:Literata,Georgia,serif;padding:6px 10px;width:780px;background:${bg};color:${ink};line-height:1.4`,
    h1: `color:${ink};font-size:18px;margin:0 0 2px;font-weight:700;font-family:'Playfair Display',Georgia,serif;border-bottom:1px solid ${line};padding-bottom:4px`,
    h2: `color:${ink};font-size:13px;margin:0 0 2px;font-weight:700;font-family:'Playfair Display',Georgia,serif`,
    meta: `font-size:10px;color:${inkDim};margin-bottom:4px;line-height:1.3`,
    th: `background:${surface};color:${ink};padding:2px 5px;text-align:left;font-weight:600;font-size:10px;border:1px solid ${line}`,
    td: `padding:2px 5px;border:1px solid ${line};font-size:10px;color:${inkDim}`,
    tbl: "border-collapse:collapse;width:100%",
  };
}

export const STYLE = new Proxy({}, {
  get(_, prop) { return buildStyles()[prop]; }
});

export function pageOpen(title, subtitle, metaLines) {
  const m = metaLines?.length ? `<div style="${STYLE.meta}">${metaLines.join("<br>")}</div>` : "";
  return `<div style="${STYLE.container}"><div style="${STYLE.h1}">${title}</div>${m}`;
}

export function pageClose() {
  return "</div>";
}

export function section(title, contentHtml) {
  const t = title ? `<div style="${STYLE.h2}">${title}</div>` : "";
  return `<div style="margin-bottom:4px">${t}${contentHtml}</div>`;
}

export function flexRow(childrenHtml) {
  return `<div style="display:flex;gap:6px">${childrenHtml}</div>`;
}

export function flexCol(html) {
  return `<div style="flex:1;min-width:0">${html}</div>`;
}

export function tableBlock(title, headers, rows, maxRows, subheaderHtml) {
  const limited = rows.slice(0, maxRows);
  const th = headers.map(h => `<th style="${STYLE.th}">${h}</th>`).join("");
  const tr = limited.map(row =>
    `<tr>${row.map(c => `<td style="${STYLE.td}">${c}</td>`).join("")}</tr>`
  ).join("");
  const sub = subheaderHtml ? `<tr>${subheaderHtml}</tr>` : "";
  const tbl = `<table style="${STYLE.tbl}"><thead>${sub}<tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  return title ? `<div style="margin-bottom:4px"><div style="${STYLE.h2}">${title}</div>${tbl}</div>` : tbl;
}

export async function captureHTML(html, filename) {
  import("../audio/audio.js").then(m => m.playCapture()).catch(() => {});
  if (typeof html2canvas === "undefined") {
    import("../ui/toast.js").then(m => m.toast("html2canvas not loaded. Please refresh the page."));
    return;
  }
  const wrapper = document.createElement("div");
  const bg = cv("--bg");
  wrapper.style.cssText = `position:fixed;left:-9999px;top:0;width:800px;background:${bg}`;
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  const PAGE_HEIGHT = 1200;
  const totalHeight = wrapper.scrollHeight;
  const pages = Math.ceil(totalHeight / PAGE_HEIGHT);
  let captured = 0;

  function doPage(page) {
    const y = page * PAGE_HEIGHT;
    const h = Math.min(PAGE_HEIGHT, totalHeight - y);
    wrapper.style.transform = `translateY(-${y}px)`;
    html2canvas(wrapper, {
      width: 800,
      height: h,
      scale: 2,
      useCORS: true,
      backgroundColor: bg,
      y: 0, x: 0,
    }).then(canvas => {
      canvas.toBlob(blob => {
        const a = document.createElement("a");
        const pageLabel = pages > 1 ? `_p${page + 1}` : "";
        a.download = filename.replace(/\.png$/, "") + pageLabel + ".png";
        a.href = URL.createObjectURL(blob);
        a.click();
        URL.revokeObjectURL(a.href);
        captured++;
        if (captured < pages) doPage(captured);
        else { wrapper.remove(); import("../ui/toast.js").then(m => m.toast("Report captured.")); }
      }, "image/png");
    });
  }
  doPage(0);
}
