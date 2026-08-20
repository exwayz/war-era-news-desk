let _tip = null;
const ATTR = "data-tip";

function convertTitles(root) {
  root.querySelectorAll("[title]").forEach(el => {
    if (el.closest("#studioModal")) return;
    const t = el.getAttribute("title");
    if (t != null && t !== "") {
      el.setAttribute(ATTR, t);
      el.removeAttribute("title");
    }
  });
}

function show(el, cx, cy) {
  const text = el.getAttribute(ATTR);
  if (!text) return;
  if (!_tip) {
    _tip = document.createElement("div");
    _tip.className = "nd-tooltip";
    document.body.appendChild(_tip);
  }
  _tip.textContent = text;
  _tip.style.display = "block";
  const tw = _tip.offsetWidth;
  const th = _tip.offsetHeight;
  let left = cx - tw / 2;
  let top = cy + 16;
  if (left < 4) left = 4;
  if (left + tw > window.innerWidth - 4) left = window.innerWidth - tw - 4;
  if (top + th > window.innerHeight - 4) top = cy - th - 8;
  _tip.style.left = left + "px";
  _tip.style.top = top + "px";
}

function hide() {
  if (_tip) _tip.style.display = "none";
}

export function initTooltips() {
  convertTitles(document.body);

  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) convertTitles(node);
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("mouseover", e => {
    const el = e.target.closest?.("[data-tip]");
    if (el && !el.closest("#studioModal")) show(el, e.clientX, e.clientY);
  }, true);

  document.addEventListener("mouseout", e => {
    const el = e.target.closest?.("[data-tip]");
    if (el) hide();
  }, true);

  document.addEventListener("focusin", e => {
    const el = e.target.closest?.("[data-tip]");
    if (el && !el.closest("#studioModal")) {
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.top + r.height);
    }
  });

  document.addEventListener("focusout", () => hide());
}
