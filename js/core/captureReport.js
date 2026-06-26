const watermarkPromise = new Promise(resolve => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = "assets/icons/favicon-32x32.png";
});

export function ts() {
  const d = new Date();
  return d.getFullYear() +
    String(d.getMonth()+1).padStart(2,"0") +
    String(d.getDate()).padStart(2,"0") + "_" +
    String(d.getHours()).padStart(2,"0") +
    String(d.getMinutes()).padStart(2,"0") +
    String(d.getSeconds()).padStart(2,"0");
}

const TEXTURE = "repeating-linear-gradient(90deg,rgba(255,255,255,.025) 0px,rgba(255,255,255,.025) 2px,transparent 2px,transparent 6px)";

export const STYLE = {
  container: `font-family:'Ubuntu Sans',sans-serif;padding:24px 20px;width:760px;background:${TEXTURE},#0d1416;color:#ddd`,
  h1: "color:#b22222;font-size:20px;margin:0 0 2px;font-weight:700",
  h2: "color:#b22222;font-size:16px;margin:0 0 6px;font-weight:700",
  subtitle: "font-size:14px;color:#aaa;margin-bottom:4px;font-weight:700",
  meta: "font-size:11px;color:#888;margin-bottom:14px;line-height:1.5;font-weight:700",
  th: "background:#b22222;color:#fff;padding:5px 8px;text-align:left;font-weight:700;font-size:11px;border:1px solid #8b1a1a",
  td: "padding:4px 8px;border:1px solid #333;font-size:11px;color:#ccc;font-weight:700",
  tbl: "border-collapse:collapse;width:100%;font-family:'Ubuntu Sans',sans-serif",
};

export function pageOpen(title, subtitle, metaLines) {
  let m = "";
  if (metaLines && metaLines.length) {
    m = `<div style="${STYLE.meta}">${metaLines.join("<br>")}</div>`;
  }
  let sub = "";
  if (subtitle) {
    sub = `<div style="${STYLE.subtitle}">${subtitle}</div>`;
  }
  return `<div style="${STYLE.container}"><div style="${STYLE.h1}">${title}</div>${sub}${m}`;
}

export function pageClose() {
  return "</div>";
}

export function section(title, contentHtml) {
  const t = title ? `<div style="${STYLE.h2}">${title}</div>` : "";
  return `<div style="margin-bottom:10px">${t}${contentHtml}</div>`;
}

export function flexRow(childrenHtml) {
  return `<div style="display:flex;gap:10px">${childrenHtml}</div>`;
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
  if (title) {
    return `<div style="margin-bottom:8px"><div style="font-size:12px;font-weight:700;color:#b22222;margin:0 0 3px">${title}</div>${tbl}</div>`;
  }
  return tbl;
}

export async function captureHTML(html, filename) {
  import("../audio/audio.js").then(m => m.playCapture()).catch(() => {});
  if (typeof html2canvas === "undefined") {
    import("../ui/toast.js").then(m => m.toast("html2canvas not loaded. Please refresh the page."));
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;left:-9999px;top:0;width:800px;background:#0d1416;font-family:'Ubuntu Sans',sans-serif";
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  const watermark = await watermarkPromise;

  const PAGE_HEIGHT = 1200;
  const totalHeight = wrapper.scrollHeight;
  const pages = Math.ceil(totalHeight / PAGE_HEIGHT);
  let captured = 0;

  function addWatermark(srcCanvas) {
    if (!watermark) return srcCanvas;
    const wmSize = 24;
    const margin = 16;
    const scale = srcCanvas.width / 800;
    const canvas = document.createElement("canvas");
    canvas.width = srcCanvas.width;
    canvas.height = srcCanvas.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(watermark, canvas.width - wmSize * scale - margin * scale, canvas.height - wmSize * scale - margin * scale, wmSize * scale, wmSize * scale);
    return canvas;
  }

  function doPage(page) {
    const y = page * PAGE_HEIGHT;
    const h = Math.min(PAGE_HEIGHT, totalHeight - y);
    wrapper.style.transform = `translateY(-${y}px)`;
    html2canvas(wrapper, {
      width: 800,
      height: h,
      scale: 2,
      useCORS: true,
      backgroundColor: "#0d1416",
      y: 0,
      x: 0,
    }).then(canvas => {
      const finalCanvas = addWatermark(canvas);
      finalCanvas.toBlob(blob => {
        const a = document.createElement("a");
        const pageLabel = pages > 1 ? `_p${page + 1}` : "";
        a.download = filename.replace(/\.png$/, "") + pageLabel + ".png";
        a.href = URL.createObjectURL(blob);
        a.click();
        URL.revokeObjectURL(a.href);
        captured++;
        if (captured < pages) {
          doPage(captured);
        } else {
          wrapper.remove();
          import("../ui/toast.js").then(m => m.toast("Report captured."));
        }
      }, "image/png");
    });
  }

  doPage(0);
}
