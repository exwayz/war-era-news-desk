import { S, __pm } from "./state.js";

export function debounce(fn, ms) {
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); };
}

export function fmtMoney(v, precision) {
  const n=Number(v);
  if(!Number.isFinite(n)) return v==null?"—":String(v);
  return new Intl.NumberFormat(undefined,{maximumFractionDigits: Number.isInteger(precision) ? precision : 2}).format(n);
}

export function fmtNum(v) {
  const n=Number(v); if(!Number.isFinite(n)) return "—";
  if(n>=1e9) return (n/1e9).toFixed(2)+"B";
  if(n>=1e6) return (n/1e6).toFixed(2)+"M";
  if(n>=1e3) return (n/1e3).toFixed(1)+"K";
  return n.toFixed(0);
}

export function fmtDate(v) {
  if(!v) return "—"; const d=new Date(v); if(isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat(undefined,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(d);
}

export function parseLocal(v) { if(!v) return null; const d=new Date(v); return isNaN(d.getTime())?null:d; }

export function escapeHtml(s) {
  return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Playfair Display rank number; top 3 tinted gold/silver/bronze, the rest plain.
export function rankBadgeHtml(rank) {
  const n = Number(rank);
  const color = n === 1 ? "var(--gold)" : n === 2 ? "var(--silver)" : n === 3 ? "var(--bronze)" : "";
  return `<span style="font-family:var(--font-ui);font-weight:700;${color ? `color:${color};` : ""}">${n}</span>`;
}

export function escapeXml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Allow-list HTML sanitizer for user-authored content (articles). Renders the
// markup in a detached element, then drops scripts/styles/event handlers and
// dangerous URLs while keeping common rich-text tags.
const SANITIZE_TAGS = new Set([
  "P","BR","B","STRONG","I","EM","U","S","STRIKE","MARK","SMALL","SUB","SUP",
  "H1","H2","H3","H4","H5","H6","UL","OL","LI","DL","DT","DD","BLOCKQUOTE",
  "PRE","CODE","HR","A","IMG","TABLE","THEAD","TBODY","TFOOT","TR","TH","TD",
  "SPAN","DIV","FIGURE","FIGCAPTION","HEADER","FOOTER","SECTION","ARTICLE",
]);
const SANITIZE_HREF_OK = /^(https?:|mailto:|tel:|#)/i;

// Article rich-text carries its layout as inline styles (alignment, font).
// Keep only typographic/layout declarations that are safe — no URLs, no JS,
// no positioning that could overlay the page.
const SANITIZE_STYLE_OK = new Set([
  "text-align","text-indent","text-decoration","text-transform","text-shadow",
  "direction","unicode-bidi",
  "font-family","font-size","font-weight","font-style","font-variant",
  "line-height","letter-spacing","word-spacing","white-space","vertical-align",
  "color","background-color",
  "margin","margin-top","margin-right","margin-bottom","margin-left",
  "padding","padding-top","padding-right","padding-bottom","padding-left",
  "width","height","min-width","min-height","max-width","max-height",
  "border","border-top","border-right","border-bottom","border-left",
  "border-color","border-style","border-width","border-radius",
]);
const SANITIZE_STYLE_BAD = /url\s*\(|expression\s*\(|javascript\s*:|behavior\s*:|@import|-moz-binding/i;

function sanitizeStyle(raw) {
  if (!raw) return "";
  const kept = [];
  for (const decl of String(raw).split(";")) {
    const idx = decl.indexOf(":");
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    if (!SANITIZE_STYLE_OK.has(prop)) continue;
    const val = decl.slice(idx + 1).replace(/!important/gi, "").trim();
    if (!val || SANITIZE_STYLE_BAD.test(val)) continue;
    kept.push(`${prop}:${val}`);
  }
  return kept.join(";");
}

export function sanitizeHtml(html) {
  if (!html) return "";
  const template = document.createElement("template");
  template.innerHTML = String(html);
  const root = template.content;

  function clean(node) {
    if (node.nodeType === 3) return;
    if (node.nodeType !== 1) { node.remove(); return; }
    const tag = node.tagName.toUpperCase();
    if (!SANITIZE_TAGS.has(tag) || tag === "IMG") {
      if (tag === "IMG" && SANITIZE_HREF_OK.test(node.getAttribute("src") || "")) {
        node.removeAttribute("onerror"); node.removeAttribute("onload");
        for (const attr of [...node.attributes]) {
          if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        }
      } else {
        node.remove();
        return;
      }
    }
    for (const attr of [...node.attributes]) {
      const n = attr.name.toLowerCase();
      if (/^on/i.test(n) || /^class$/i.test(n)) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (n === "style") {
        const v = sanitizeStyle(node.getAttribute("style"));
        if (v) node.setAttribute("style", v); else node.removeAttribute("style");
        continue;
      }
      if (n === "align") {
        const v = String(attr.value || "").trim().toLowerCase();
        if (!["left", "right", "center", "justify"].includes(v)) node.removeAttribute("align");
        continue;
      }
      if (n === "href" || n === "src") {
        const v = attr.value.trim();
        if (SANITIZE_HREF_OK.test(v)) continue;
        node.removeAttribute(attr.name);
      }
      if (n === "target" && attr.value !== "_blank") node.removeAttribute(attr.name);
      if (n === "rel") node.removeAttribute(attr.name);
    }
    [...node.childNodes].forEach(clean);
  }
  [...root.childNodes].forEach(clean);
  return template.innerHTML;
}

export function getValue(r) {
  return Number(
    r?.value ??
    r?.damage ??
    r?.totalDamage ??
    0
  );
}

export function getPoints(r) {
  return Number(
    r?.points ??
    r?.value ??
    0
  );
}

export function normalizeRankRow(r) {
  return {
    ...r,
    _side: r._side || "unknown",
    damage:
      r.value ??
      r.damage ??
      r.totalDamage ??
      0,
    gp:
      r.points ??
      r.pointsAttacker ??
      r.pointsDefender ??
      getPoints(r) ??
      0,
    userId: r.userId || r.user || null,
    muId: r.muId || r.mu || null,
    countryId: r.countryId || r.country || null,
  };
}

export function formatShortNumber(num) {
  const n = Number(num);
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, "") + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, "") + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2).replace(/\.00$/, "") + "K";
  return n.toFixed(2).replace(/\.00$/, "");
}

export function pick(...choices) {
  if(choices.length<=1) return choices[0]||"";
  const k=choices.join("||"); const last=__pm.get(k);
  const avail=choices.filter(c=>c!==last);
  const chosen=avail[Math.floor(Math.random()*avail.length)];
  __pm.set(k,chosen); return chosen;
}

export function typeLabel(t) {
  return {
    user:"User", country:"Country", region:"Region", mu:"Military Unit",
    company:"Company", battle:"Battle", alliance:"Alliance",
    article:"Article", party:"Party",
  }[t] || (t ? t.charAt(0).toUpperCase()+t.slice(1) : "Entity");
}

export function entityDisplayName(type, id, data) {
  if (!data) return id ? `${typeLabel(type)} #${String(id).slice(-6)}` : typeLabel(type);
  switch (type) {
    case "user": return data.username||data.name||"Unknown User";
    case "country": return data.name||"Unknown Country";
    case "region": return data.name||"Unknown Region";
    case "mu": return data.name||data.muName||data.displayName||data.fullName||"Unknown Unit";
    case "company": return data.name||data.companyName||"Unknown Company";
    case "battle": {
      const atk=S.lookups.countriesById.get(data.attacker?.country||data.attackerCountry||data.attacker?.countryId)?.name||"";
      const def=S.lookups.countriesById.get(data.defender?.country||data.defenderCountry||data.defender?.countryId)?.name||"";
      return (atk&&def) ? `${atk} vs ${def}` : "Battle";
    }
    case "alliance": return data.alliance||data.name||data.allianceName||"Alliance";
    case "article": return data.title||"Untitled Article";
    case "party": return data.party||data.name||data.partyName||"Party";
  }
  return "Entity";
}

export function marketItemName(code){
  const commodityNames = {
    bread:"Bread",
    cocain:"Pill",
    case2:"Elite Case",
    case1:"Case",
    fish:"Fish",
    cookedFish:"Cooked Fish",
    livestock:"Livestock",
    grain:"Grain",
    coca:"Mysterious Plant",
    steak:"Steak",
    petroleum:"Petroleum",
    lead:"Lead",
    iron:"Iron",
    limestone:"Limestone",
    wood:"Wood",
    paper:"Paper",
    lightAmmo:"Light Ammo",
    ammo:"Ammo",
    heavyAmmo:"Heavy Ammo",
    oil:"Oil",
    scraps:"Scraps",
    concrete:"Concrete",
    steel:"Steel"
  };
  if(commodityNames[code]) return commodityNames[code];
  const weaponNames = {
    knife:"Knife",
    gun:"Gun",
    rifle:"Rifle",
    sniper:"Sniper",
    tank:"Tank",
    fighterJet:"Fighter Jet"
  };
  if(weaponNames[code]) return weaponNames[code];
  const tiers = { 1:"Basic", 2:"Reinforced", 3:"Advanced", 4:"Elite", 5:"Legendary", 6:"Mythic" };
  const m = code?.match(/^(boots|gloves|helmet|pants|chest)(\d)$/);
  if(m){
    const slot = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    return `${tiers[m[2]]} ${slot}`;
  }
  return code || "Unknown";
}

export function commodityBars(data){
  if(!data.length) return "";
  const max = Math.max(...data.map(x=>x.value));
  return `
    <div class="commodity-bars">
      ${data.map(x=>`
        <div class="commodity-bar-row">
          <div class="commodity-bar-head">
  <span>
    ${x.item}
    ${
      x.bonus != null
      ? `<small class="commodity-up" style="margin-left:4px">+${x.bonus.toFixed(0)}%bonus</small>`
      : ""
    }
    ${
      x.trend > 0
      ? `<small class="commodity-up">▲ +${x.changePct.toFixed(1)}%</small>`
      : x.trend < 0
      ? `<small class="commodity-down">▼ ${x.changePct.toFixed(1)}%</small>`
      : ``
    }
  </span>
  <span>${fmtMoney(x.value)} ₿</span>
</div>
          <div class="commodity-bar-bg">
            <div class="commodity-bar-fill" style="width:${(x.value/max)*100}%"></div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

export function miniChart(values, label, color="var(--accent)") {
  if (!values||values.length<2) return "";
  const W=280,H=60,pad=8;
  const mn=Math.min(...values), mx=Math.max(...values), rng=mx-mn||1;
  const pts=values.map((v,i)=>{
    const x=pad+(i/(values.length-1))*(W-pad*2);
    const y=H-pad-((v-mn)/rng)*(H-pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPath=`M${pts[0]} ${pts.slice(1).map(p=>"L"+p).join(" ")} L${W-pad},${H-pad} L${pad},${H-pad} Z`;
  const id="cg"+label.replace(/\W/g,"");
  return `<div class="mini-chart-wrap">
    <div class="mini-chart-label">${label}</div>
    <svg viewBox="0 0 ${W} ${H}" class="mini-chart-svg">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
      </linearGradient></defs>
      <path d="${areaPath}" fill="url(#${id})"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${pts[pts.length-1].split(",")[0]}" cy="${pts[pts.length-1].split(",")[1]}" r="3" fill="${color}"/>
    </svg>
    <div class="mini-chart-range"><span>${fmtMoney(mn)}</span><span>${fmtMoney(mx)}</span></div>
  </div>`;
}
