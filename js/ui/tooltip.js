let _tip = null;
const ATTR = "data-tip";

function convertTitles(root) {
  root.querySelectorAll("[title]").forEach(el => {
    const t = el.getAttribute("title");
    if (t != null && t !== "") {
      el.setAttribute(ATTR, t);
      el.removeAttribute("title");
    }
  });
}

function show(el) {
  const text = el.getAttribute(ATTR);
  if (!text) return;
  if (!_tip) {
    _tip = document.createElement("div");
    _tip.className = "nd-tooltip";
    document.body.appendChild(_tip);
  }
  _tip.textContent = text;
  _tip.style.display = "block";
  const r = el.getBoundingClientRect();
  const tw = _tip.offsetWidth;
  const th = _tip.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  let top = r.top - th - 6;
  if (left < 4) left = 4;
  if (left + tw > window.innerWidth - 4) left = window.innerWidth - tw - 4;
  if (top < 4) top = r.bottom + 6;
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

  document.addEventListener("mouseenter", e => {
    const el = e.target.closest?.("[data-tip]");
    if (el) show(el);
  }, true);

  document.addEventListener("mouseleave", e => {
    const el = e.target.closest?.("[data-tip]");
    if (el) hide();
  }, true);

  document.addEventListener("focusin", e => {
    const el = e.target.closest?.("[data-tip]");
    if (el) show(el);
  });

  document.addEventListener("focusout", () => hide());
}
