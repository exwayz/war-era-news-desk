import { S } from "../core/state.js";
import { fmtMoney, pick } from "../core/utils.js";

export function evtData(e) { return e.data&&typeof e.data==="object"?e.data:{}; }
export function evtTime(e) { return e.createdAt||e.date||e.time||e.timestamp; }
export function getBid(e) { const d=evtData(e); return e.battleId||e.battle?.id||d.battle||""; }

export function collectCountryIds(event,ed) {
  return [
    event.countryId,event.country?.id,event.sourceCountry?.id,event.targetCountry?.id,
    event.attackerCountry?.id,event.defenderCountry?.id,
    ed.country,ed.sourceCountry,ed.targetCountry,ed.attackerCountry,ed.defenderCountry,
    ...(Array.isArray(ed.countries)?ed.countries:[]),
    ...(Array.isArray(event.countries)?event.countries:[]),
  ].filter(Boolean);
}

export function fmtBattleName(bid) {
  if(!bid) return ""; const b=S.lookups.battlesById.get(bid); if(!b) return "";
  const atk=S.lookups.countriesById.get(b.attacker?.country)?.name||"";
  const def=S.lookups.countriesById.get(b.defender?.country)?.name||"";
  const reg=S.lookups.regionsById.get(b.defender?.region)?.name||"";
  const sides=[atk,def].filter(Boolean).join(" vs ");
  if(sides&&reg) return `${sides} in ${reg}`; if(sides) return sides; if(reg) return reg; return "";
}

export function fmtType(v) {
  const map = {
    peaceMade:"Peace Made", battleEnded:"Battle Ended", warEnded:"War Ended",
    warDeclared:"War Declared", battleOpened:"Battle Opened", newPresident:"New President",
    regionTransfer:"Region Transfer", countryMoneyTransfer:"Money Transfer",
    depositDiscovered:"Deposit Discovered", systemRevolt:"System Revolt",
    allianceFormed:"Alliance Formed", allianceBroken:"Alliance Broken",
    allianceMemberJoined:"Alliance Member Joined", allianceMemberLeft:"Alliance Member Left", allianceMemberExcluded: "Alliance Member Excluded",
    defensivePactFormed:"Defensive Pact Formed", defensivePactBroken:"Defensive Pact Broken",
    regionLiberated:"Region Liberated", revolutionStarted:"Revolution Started",
    revolutionEnded:"Revolution Ended", financedRevolt:"Financed Revolt",
    bankruptcy:"Bankruptcy", peace_agreement:"Peace Agreement",
    resistanceIncreased:"Resistance Increased", resistanceDecreased:"Resistance Decreased",
    strategicResourcesReshuffled:"Resources Reshuffled",
  };
  return map[v] || String(v).replace(/_/g," ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/\b\w/g,l=>l.toUpperCase());
}

export function buildTitle(event,type,ed) {
  if(event.title) return event.title;
  if(event.message) return event.message;
  if(event.description) return event.description;
  const atk=S.lookups.countriesById.get(ed.attackerCountry)?.name||"";
  const def=S.lookups.countriesById.get(ed.defenderCountry)?.name||"";
  const reg=S.lookups.regionsById.get(ed.defenderRegion)?.name||S.lookups.regionsById.get(ed.region)?.name||S.lookups.regionsById.get(ed.regionId)?.name||"";
  const cids=collectCountryIds(event,ed);
  const [c1,c2]=cids.map(id=>S.lookups.countriesById.get(id)?.name||"");
  const allianceName=ed.allianceName||ed.alliance?.name||ed.allianceName||"";

  switch(type) {
    case "countryMoneyTransfer": if(c1&&c2) return `${c1} transferred ${fmtMoney(ed.money)} ₿ to ${c2}`; break;
    case "allianceFormed": if(c1&&c2) return `${c1} formed an alliance with ${c2}`; break;
    case "allianceBroken": if(c1&&c2) return `${c1} broke its alliance with ${c2}`; break;
    case "allianceMemberJoined": {
      const cn=S.lookups.countriesById.get(ed.country||ed.countryId||cids[0])?.name||"";
      if(cn&&allianceName) return `${cn} joins the ${allianceName}`;
      if(cn) return `${cn} joins an alliance`;
      break;
    }
    case "allianceMemberLeft": {
      const cn=S.lookups.countriesById.get(ed.country||ed.countryId||cids[0])?.name||"";
      if(cn&&allianceName) return `${cn} leaves the ${allianceName} alliance`;
      if(cn) return `${cn} leaves an alliance`;
      break;
    }
    case "allianceMemberExcluded": {
      const cn=S.lookups.countriesById.get(ed.country||ed.countryId||cids[0])?.name||"";
      if (cn&&allianceName) return `${allianceName} Revokes ${cn}'s Membership`;
      if(cn) return `${cn} excluded from an alliance`;
      break;
    }
    case "defensivePactFormed": if(c1&&c2) return `${c1} and ${c2} sign a defensive pact`; break;
    case "defensivePactBroken": if(c1&&c2) return `${c1} breaks the defensive pact with ${c2}`; break;
    case "warDeclared": if(atk&&def) return `${atk} declares war on ${def}`; break;
    case "battleOpened":
      if(atk&&def&&reg) return `${atk} opens a battle vs ${def} in ${reg}`;
      if(atk&&def) return `${atk} opens a battle vs ${def}`;
      break;
    case "battleEnded": {
      const w=ed.wonBy==="attacker"?atk:def; const l=ed.wonBy==="attacker"?def:atk;
      if(w&&l&&reg) return `${w} defeats ${l} in ${reg}`;
      if(w&&l) return `${w} defeats ${l}`;
      break;
    }
    case "newPresident": {
      const country=S.lookups.countriesById.get(ed.country)?.name||""; const pres=S.lookups.usersById.get(ed.user)?.username||S.lookups.usersById.get(ed.user)?.name||"";
      if(pres&&country) return `${pres} elected president of ${country}`;
      if(country) return `New president in ${country}`;
      break;
    }
    case "regionTransfer": {
      if(c1&&c2&&reg) return `${c1} transfers ${reg} to ${c2}`;
      if(c1&&c2) return `${c1} transfers a region to ${c2}`;
      break;
    }
    case "depositDiscovered": {
      const res=ed.itemCode||"resource";
      return reg?`${res} deposit discovered in ${reg}`:`${res} deposit discovered`;
    }
    case "systemRevolt": return reg?`Revolt erupts in ${reg}`:"Automatic revolt";
    case "regionLiberated": {
      if(c1&&c2&&reg) return `${c1} liberates ${reg} for ${c2}`;
      return "Region liberated";
    }
    case "revolutionStarted": {
      const country=S.lookups.countriesById.get(ed.countryId||ed.country)?.name||"";
      return country?`Revolution begins in ${country}`:"Revolution started";
    }
    case "revolutionEnded": {
      const country=S.lookups.countriesById.get(ed.countryId||ed.country)?.name||"";
      return country?`Revolution in ${country} ends`:"Revolution ended";
    }
    case "financedRevolt": return reg?`Financed revolt in ${reg}`:"Financed revolt";
    case "peaceMade": {
      const cs=[...new Set(cids.map(id=>S.lookups.countriesById.get(id)?.name||"").filter(Boolean))].join(" & ");
      if(cs) return `${cs} make peace`;
      break;
    }
    case "peace_agreement": {
      const cs=[...new Set(cids.map(id=>S.lookups.countriesById.get(id)?.name||"").filter(Boolean))].join(" & ");
      if(cs) return `${cs} sign peace agreement`;
      break;
    }
    case "bankruptcy": {
      const country=S.lookups.countriesById.get(ed.country||ed.countryId||cids[0])?.name||"";
      if(country) return `${country} declares bankruptcy`;
      return "Country bankruptcy";
    }
    case "resistanceIncreased": if(reg) return `Resistance rises in ${reg}`; break;
    case "resistanceDecreased": if(reg) return `Resistance falls in ${reg}`; break;
    case "strategicResourcesReshuffled": return reg?`Strategic resources reshuffled in ${reg}`:"Strategic resources reshuffled";
  }
  const bid=getBid(event); const bn=fmtBattleName(bid);
  if(bn) return `${fmtType(type)}: ${bn}`;
  if(reg) return `${fmtType(type)}: ${reg}`;
  return fmtType(type);
}

export function buildSummary(event,type,ed) {
  const atk=S.lookups.countriesById.get(ed.attackerCountry)?.name||"";
  const def=S.lookups.countriesById.get(ed.defenderCountry)?.name||"";
  const reg=S.lookups.regionsById.get(ed.defenderRegion)?.name||S.lookups.regionsById.get(ed.region)?.name||S.lookups.regionsById.get(ed.regionId)?.name||"";
  const cids=collectCountryIds(event,ed);
  const cnames=[...new Set(cids.map(id=>S.lookups.countriesById.get(id)?.name||"").filter(Boolean))];
  const [c1,c2]=cnames;
  const allianceName=ed.allianceName||ed.alliance?.name||ed.allianceName||"the alliance";

  switch(type){
    case "countryMoneyTransfer":
       const monet = Number(ed.money || 0);
       if (c1 && c2 && monet < 10) return pick(
            `${c1} transferred just ${fmtMoney(monet)} ₿ to ${c2}, a sum so small that observers are already questioning whether the transaction was intended as assistance or merely a symbolic gesture.`,
            `The latest financial exchange saw ${c1} send ${fmtMoney(monet)} ₿ to ${c2}. Analysts agree the paperwork probably cost more than the transfer itself.`,
            `${c1} sent ${fmtMoney(monet)} ₿ to ${c2}, a contribution so modest that observers are debating whether it should be classified as foreign aid or a diplomatic joke.`
        );
       if (c1 && c2) return pick(
            `${c1} has transferred ${fmtMoney(monet)} ₿ to ${c2} in an inter-governmental financial transaction.`,
            `Financial records confirm ${c1} sent ${fmtMoney(monet)} ₿ directly to ${c2}.`,
            `${fmtMoney(monet)} ₿ has been moved from ${c1} to ${c2} in an official state transfer.`
        );
      break;
    case "allianceFormed":
      if(c1&&c2) return pick(
        `${c1} and ${c2} have entered into a formal military alliance, pledging mutual support.`,
        `Diplomatic negotiations concluded as ${c1} and ${c2} announce a new alliance pact.`,
        `${c1} and ${c2} have signed an alliance agreement, marking a new chapter in their bilateral relations.`
      );
      break;
    case "allianceBroken":
      if(c1&&c2) return pick(
        `The alliance between ${c1} and ${c2} has officially dissolved, raising questions about regional stability.`,
        `${c1} has severed its alliance with ${c2}, signalling a significant shift in diplomatic ties.`,
        `${c1} and ${c2} have parted ways, officially ending their alliance agreement.`
      );
      break;
    case "allianceMemberJoined": {
      const cn=S.lookups.countriesById.get(ed.country||ed.countryId||cids[0])?.name||"";
      const allCandidates=cnames.filter(Boolean);
      if(cn&&allianceName!=="the alliance") return pick(
        `${cn} has become the newest member of the ${allianceName} alliance, bolstering its collective strength.`,
        `${cn} officially joins the ${allianceName} alliance, expanding the coalition's reach.`,
        `Diplomats confirm that ${cn} has signed the membership charter for the ${allianceName} alliance.`
      );
      if(allCandidates.length>0) return pick(
        `${allCandidates[0]} has officially joined an inter-national alliance, reshaping the regional power balance.`,
        `A new alliance membership has been confirmed, bringing ${allCandidates[0]} into the coalition.`
      );
      break;
    }
    case "allianceMemberLeft": {
      const cn=S.lookups.countriesById.get(ed.country||ed.countryId||cids[0])?.name||"";
      if(cn&&allianceName!=="the alliance") return pick(
        `${cn} has formally withdrawn from the ${allianceName} alliance, citing unspecified political reasons.`,
        `The ${allianceName} alliance loses a member as ${cn} announces its departure.`,
        `${cn} exits the ${allianceName} alliance, marking a notable shift in the geopolitical landscape.`
      );
      if(cn) return pick(
        `${cn} has formally withdrawn from an alliance, a move that could reshape regional alliances.`,
        `${cn} exits a military coalition, leaving the alliance's future direction in question.`
      );
      break;
    }
    case "allianceMemberExcluded": {
      const cn=S.lookups.countriesById.get(ed.country||ed.countryId||cids[0])?.name||"";
      if(cn&&allianceName!=="the alliance") return pick(
        `Following an internal decision by ${allianceName}, ${cn} has been excluded from the alliance and ceases to hold member status.`,
        `${allianceName} has expelled ${cn} from the alliance, marking the end of its formal membership and participation.`,
        `In a significant political development, ${allianceName} has expelled ${cn} from its ranks, bringing its membership to an abrupt end.`
      );
      if(cn) return pick(
        `${cn} has formally withdrawn from an alliance, a move that could reshape regional alliances.`,
        `${cn} exits a military coalition, leaving the alliance's future direction in question.`
      );
      break;
    }
    case "defensivePactFormed":
      if(c1&&c2) return pick(
        `${c1} and ${c2} have signed a joint defensive pact, committing to mutual military support in the event of an attack.`,
        `A new defensive agreement has been struck between ${c1} and ${c2}, formalising their security cooperation.`,
        `${c1} and ${c2} formalise their alliance with a mutual defence pact, strengthening regional stability.`
      );
      break;
    case "defensivePactBroken":
      if(c1&&c2) return pick(
        `${c1} has officially broken the defensive pact it had previously signed with ${c2}, ending their security agreement.`,
        `The mutual defence pact between ${c1} and ${c2} has been unilaterally terminated, leaving the latter exposed.`,
        `${c1} tears up the defensive pact with ${c2}, straining what was once a stable security partnership.`
      );
      break;
    case "warDeclared":
      if(atk&&def) return pick(
        `Relations between ${atk} and ${def} have reached a breaking point, with ${atk} officially declaring war.`,
        `${atk} has issued a formal declaration of war against ${def}, plunging the region into open conflict.`,
        `War has broken out as ${atk} declares hostilities against ${def}, raising alarm across the region.`
      );
      break;
    case "battleOpened":
      if(atk&&def&&reg) return pick(
        `${atk} has launched a military offensive against ${def}'s position in ${reg}, opening a new front.`,
        `Armed conflict has broken out as forces from ${atk} begin operations against ${def} near ${reg}.`,
        `Battlefield intelligence confirms ${atk} has initiated combat against ${def} in the ${reg} region.`
      );
      if(atk&&def) return pick(
        `${atk} has initiated combat operations against ${def}.`,
        `Hostilities have erupted between ${atk} and ${def}.`
      );
      break;
    case "battleEnded": {
      const w=ed.wonBy==="attacker"?atk:def; const l=ed.wonBy==="attacker"?def:atk;
      if(w&&l) return pick(
        `${w} has emerged victorious over ${l}, bringing an end to the fighting.`,
        `Military operations have concluded with ${w} defeating ${l}${reg?" at "+reg:""}.`,
        `${w} secures a decisive victory against ${l}${reg?" in "+reg:""}, concluding the engagement.`
      );
      break;
    }
    case "newPresident": {
      const country=S.lookups.countriesById.get(ed.country)?.name||""; const pres=S.lookups.usersById.get(ed.user)?.username||S.lookups.usersById.get(ed.user)?.name||"";
      if(pres&&country) return pick(
        `${pres} has been officially elected as the new president of ${country}, following the conclusion of elections.`,
        `${country} has a new leader — ${pres} has won the presidential election.`,
        `The people of ${country} have chosen ${pres} to lead the nation as its new president.`
      );
      if(country) return pick(`A new president has been elected in ${country}.`,`${country} enters a new political chapter with a presidential election concluded.`);
      break;
    }
    case "regionTransfer":
      if(c1&&c2&&reg) return pick(
        `Control of ${reg} has officially changed hands, transferring from ${c1} to ${c2}.`,
        `${reg} has been formally handed over from ${c1} to ${c2} in an official territorial transfer.`,
        `Territorial maps are being redrawn as ${reg} passes from ${c1} to ${c2}.`
      );
      if(c1&&c2) return pick(
        `A territorial transfer between ${c1} and ${c2} has been confirmed.`,
        `Territorial Control Shifts as ${c2} Acquires Region from ${c1}.`,
        `Regional Authority Changes Hands Following Transfer Agreement Between ${c1} and ${c2}.`,
        `Territorial Realignment Underway as Region Moves from ${c1} to ${c2}.`
      );
      break;
    case "depositDiscovered": {
      const res=ed.itemCode||"resource";
      if(reg) return pick(
        `Survey teams have confirmed the discovery of a new ${res} deposit in ${reg}, potentially boosting the local economy.`,
        `Authorities in ${reg} have announced the discovery of a ${res} deposit, attracting attention from resource companies.`
      );
      return pick(`A new ${res} deposit has been discovered, with details yet to be disclosed.`);
    }
    case "systemRevolt":
      if(reg) return pick(
        `Civil unrest in ${reg} has escalated into open revolt, with authorities struggling to maintain order.`,
        `Reports from ${reg} indicate widespread unrest has turned into open rebellion against the occupying forces.`
      );
      return pick(`Civil unrest has escalated into an automatic revolt.`);
    case "regionLiberated":
      if(c1&&c2&&reg) return pick(
        `${c1} has liberated ${reg} and formally returned it to ${c2}, drawing widespread support.`,
        `${reg} has been freed by ${c1} and restored to its rightful owner, ${c2}.`
      );
      return pick(`A region has been liberated and returned to its original government.`);
    case "revolutionStarted": {
      const country=S.lookups.countriesById.get(ed.countryId||ed.country)?.name||"";
      if(country) return pick(
        `A revolution has erupted in ${country} following months of mounting internal tensions.`,
        `${country} descends into revolution as political unrest boils over into open insurgency.`
      );
      return pick(`A revolution has erupted.`);
    }
    case "revolutionEnded": {
      const country=S.lookups.countriesById.get(ed.countryId||ed.country)?.name||"";
      if(ed.wonBy==="attacker") return pick(`Revolutionary forces have prevailed in ${country||"the conflict"}, seizing control of the government.`,`The revolution in ${country||"the country"} has concluded with insurgents claiming victory.`);
      if(ed.wonBy==="defender") return pick(`Government forces have suppressed the uprising in ${country||"the country"}, restoring order.`);
      if(country) return pick(`The revolutionary conflict in ${country} has officially concluded.`);
      break;
    }
    case "financedRevolt":
      if(reg) return pick(`An externally financed revolt has been launched in ${reg}, backed by undisclosed foreign interests.`,`Reports confirm outside funding has enabled an armed uprising in ${reg}.`);
      break;
    case "peaceMade":
    case "peace_agreement":
      if(cnames.length) return pick(
        `${cnames.join(" and ")} have formally signed a peace agreement, ending hostilities.`,
        `Hostilities between ${cnames.join(" & ")} have officially ended following successful peace negotiations.`
      );
      break;
    case "bankruptcy": {
      const country=S.lookups.countriesById.get(ed.country||ed.countryId||cids[0])?.name||"";
      if(country) return pick(
        `${country} has declared bankruptcy, plunging its economy into crisis and raising concerns about regional stability.`,
        `In a shocking development, ${country} has officially declared bankruptcy, signalling a severe economic collapse.`,
        `${country} is now bankrupt — the government has formally declared it can no longer meet its financial obligations.`
      );
      return pick(`A country has declared bankruptcy, triggering economic and political uncertainty.`);
    }
    case "resistanceIncreased":
      if(reg) return pick(
        `Resistance levels in ${reg} have increased, suggesting growing opposition to the current occupying force.`,
        `${reg} sees a rise in resistance activity, putting pressure on occupying authorities.`
      );
      break;
    case "resistanceDecreased":
      if(reg) return pick(
        `Resistance in ${reg} has weakened, indicating greater stability under the current administration.`,
        `Reports confirm reduced resistance activity in ${reg}, a sign of consolidating control.`
      );
      break;
    case "strategicResourcesReshuffled":
      if(reg) return pick(
        `Strategic resource allocations in ${reg} have been reshuffled, potentially impacting the regional economy.`,
        `A strategic resource reshuffle has taken place in ${reg}, altering the balance of production capacity.`
      );
      return pick(`Strategic resources have been reshuffled across the map.`);
  }
  if(cnames.length&&reg) return pick(`Developments involving ${cnames.join(", ")} in ${reg}.`,`Reports concern activities of ${cnames.join(", ")} around ${reg}.`);
  if(cnames.length) return pick(`Recent activity involving ${cnames.join(", ")}.`,`Fresh reports concern ongoing developments related to ${cnames.join(", ")}.`);
  if(reg) return pick(`Reports concern developments in ${reg}.`,`Attention turns to events unfolding in ${reg}.`);
  return pick("Further details are emerging across the War Era world.","Observers continue monitoring events across War Era.");
}

export function buildDetails(event,ed) {
  const d=[];
  const cnames=[...new Set(collectCountryIds(event,ed).map(id=>S.lookups.countriesById.get(id)?.name||"").filter(Boolean))];
  const reg=S.lookups.regionsById.get(event.regionId||event.region?.id||ed.region||ed.defenderRegion||ed.attackerRegion||ed.regionId)?.name||"";
  const bn=fmtBattleName(getBid(event));
  const addD=(label,value)=>{ if(value!=null&&value!==""&&value!==undefined) d.push({label,value:String(value)}); };
  addD("Priority",event.priority);
  addD("Money",ed.money!==undefined?fmtMoney(ed.money)+" ₿":"");
  addD("Winner",ed.wonBy?fmtType(ed.wonBy):"");
  addD("Countries",[...new Set(cnames)].join(", "));
  addD("Region",reg);
  addD("Battle",bn);
  return d.filter(x=>x.value).slice(0,5);
}

export function buildLink(event,ed) {
  const BASE="https://app.warera.io";
  const bid=getBid(event); if(bid) return `${BASE}/battle/${bid}`;
  if(ed.war) return `${BASE}/war/${ed.war}`;
  if(Array.isArray(ed.wars)&&ed.wars[0]) return `${BASE}/war/${ed.wars[0]}`;
  const rid=ed.region||ed.defenderRegion||ed.attackerRegion||ed.regionId;
  if(rid) return `${BASE}/region/${rid}`;
  const cid=collectCountryIds(event,ed)[0];
  if(cid) return `${BASE}/country/${cid}`;
  return "";
}
