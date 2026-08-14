import changelogMd from "../../CHANGELOG?raw";

const CL_VERSION_RE = /^\[[^\]]+\]\s*-\s*\d{4}-\d{2}-\d{2}/;

function inline(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(^|[^\w"])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function renderChangelog(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let listOpen = false;
  let nestedOpen = false;

  const closeList = () => {
    if (nestedOpen) { out.push("</ul>"); nestedOpen = false; }
    if (listOpen) { out.push("</ul>"); listOpen = false; }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) { closeList(); continue; }
    if (t === "---") { closeList(); out.push("<hr>"); continue; }

    const heading = t.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const lvl = heading[1].length;
      const title = inline(heading[2]);
      if (lvl === 2 && CL_VERSION_RE.test(heading[2])) {
        out.push(`<h2 class="cl-version">${title}</h2>`);
      } else {
        out.push(`<h${lvl}>${title}</h${lvl}>`);
      }
      continue;
    }

    const isNested = /^( {2,}|\t+)[-*]/.test(line);
    const bullet = t.match(/^[-*]\s*(.*)$/);
    if (isNested && bullet) {
      if (!nestedOpen) {
        if (listOpen) { out.push("</ul>"); listOpen = false; }
        out.push('<ul class="cl-nested">');
        nestedOpen = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (bullet) {
      if (!listOpen) {
        if (nestedOpen) { out.push("</ul>"); nestedOpen = false; }
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  return out.join("\n");
}

let rendered = false;

export function openChangelog() {
  const body = document.getElementById("changelogBody");
  if (body && !rendered) {
    body.innerHTML = renderChangelog(changelogMd);
    rendered = true;
  }
  document.getElementById("changelogModal")?.classList.remove("hidden");
}

export function closeChangelog() {
  document.getElementById("changelogModal")?.classList.add("hidden");
}
