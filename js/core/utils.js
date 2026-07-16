import { S, __pm } from "./state.js";

export function debounce(fn, ms) {
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); };
}

export function fmtMoney(v) {
  const n=Number(v);
  if(!Number.isFinite(n)) return v==null?"—":String(v);
  return new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(n);
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

export function escapeXml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
