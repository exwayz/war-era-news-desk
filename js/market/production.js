import { fetchTrpc, unwrap } from "../core/api.js";
import { apiKey } from "../core/api.js";
import { fmtMoney } from "../core/utils.js";
import { S } from "../core/state.js";

const RECIPES = {
  cookedfish: { good: "cookedFish", rm: "fish", rmAmt: 1, pp: 40 },
  heavyammo:  { good: "heavyAmmo",  rm: "lead",  rmAmt: 16, pp: 16 },
  steel:      { good: "steel",      rm: "iron",  rmAmt: 10, pp: 10 },
  bread:      { good: "bread",      rm: "grain", rmAmt: 10, pp: 10 },
  grain:      { good: "grain",      rm: null,    rmAmt: 0,  pp: 1 },
  limestone:  { good: "limestone",  rm: null,    rmAmt: 0,  pp: 1 },
  coca:       { good: "coca",       rm: null,    rmAmt: 0,  pp: 1 },
  concrete:   { good: "concrete",   rm: "limestone", rmAmt: 10, pp: 10 },
  oil:        { good: "oil",        rm: "petroleum", rmAmt: 1,  pp: 1 },
  paper:      { good: "paper",      rm: "wood",      rmAmt: 1,  pp: 1 },
  lightammo:  { good: "lightAmmo",  rm: "lead",      rmAmt: 1,  pp: 1 },
  steak:      { good: "steak",      rm: "livestock", rmAmt: 1,  pp: 20 },
  livestock:  { good: "livestock",  rm: null,        rmAmt: 0,  pp: 20 },
  cocain:     { good: "cocain",     rm: "coca",      rmAmt: 200, pp: 200 },
  lead:       { good: "lead",       rm: null,        rmAmt: 0,  pp: 1 },
  fish:       { good: "fish",       rm: null,        rmAmt: 0,  pp: 40 },
  petroleum:  { good: "petroleum",  rm: null,        rmAmt: 0,  pp: 1 },
  wood:       { good: "wood",       rm: null,        rmAmt: 0,  pp: 1 },
  ammo:       { good: "ammo",       rm: "lead",      rmAmt: 4,  pp: 4 },
  iron:       { good: "iron",       rm: null,        rmAmt: 0,  pp: 1 },
};

const IND_SPECS = ["oil","petroleum","steel","iron","concrete","limestone","lead","lightammo","ammo","heavyammo","wood","paper"];
const AGRI_DEPS = ["fish","coca","grain","livestock"];

const DISPLAY_NAMES = {
  cookedfish:"Cooked Fish", heavyammo:"Heavy Ammo", steel:"Steel", bread:"Bread",
  grain:"Grain", limestone:"Limestone", coca:"Mysterious Plant", concrete:"Concrete",
  oil:"Oil", paper:"Paper", lightammo:"Light Ammo", steak:"Steak",
  livestock:"Livestock", cocain:"Pill", lead:"Lead", fish:"Fish",
  petroleum:"Petroleum", wood:"Wood", ammo:"Ammo", iron:"Iron",
};

function calcSR(count) {
  if (!count) return 0;
  if (count === 1) return 5;
  return 5 + 0.25 * count;
}

function computeRegionEconomics(region, country, partyIndustrialism, prices) {
  const spec = (country.specializedItem || "").toLowerCase();
  const dep = (region.deposit?.type || "none").toLowerCase();
  const incomeTax = country.taxes?.income || 0;
  const ind = partyIndustrialism || 0;

  const sr = country.strategicResources?.resources || {};
  const srBonus = [
    calcSR((sr.gold || []).length),
    calcSR((sr.rareEarths || []).length),
    calcSR((sr.coal || []).length),
    calcSR((sr.lithium || []).length),
    calcSR((sr.diamonds || []).length),
    calcSR((sr.uranium || []).length),
  ].reduce((a, b) => a + b, 0);

  const depositBonus = dep !== "none" ? 30 : 0;
  const ethicsBonus = ({ 2: 30, 1: 10, "-2": 30, "-1": 10 })[ind] || 0;

  let totalBonus = 0;
  let bonusSource = "none";

  if (ind === 1 || ind === 2) {
    if (IND_SPECS.includes(spec)) {
      totalBonus = ethicsBonus + srBonus + (dep === spec ? depositBonus : 0);
    } else {
      totalBonus = srBonus;
    }
    bonusSource = spec;
  } else if (ind === -1 || ind === -2) {
    totalBonus = ethicsBonus + (AGRI_DEPS.includes(dep) ? depositBonus : 0);
    bonusSource = dep;
  } else {
    totalBonus = dep === "none" ? srBonus + depositBonus : Math.max(srBonus, depositBonus);
    bonusSource = depositBonus > srBonus ? dep : spec;
  }

  const recipe = RECIPES[bonusSource];
  if (!recipe) return null;

  const goodPrice = Number(prices[recipe.good] || 0);
  const rmPrice = recipe.rm ? Number(prices[recipe.rm] || 0) : 0;
  const priceOfProduction = recipe.pp ? (goodPrice - recipe.rmAmt * rmPrice) / recipe.pp : 0;
  const profitPerPP = priceOfProduction * (1 + totalBonus / 100);
  const grossWages = priceOfProduction * (1 + (totalBonus + 10) / 100);
  const netWages = grossWages * (1 - incomeTax / 100);

  return {
    bonusSource,
    productName: DISPLAY_NAMES[bonusSource] || bonusSource,
    srBonus: Math.round(srBonus * 1000) / 1000,
    depositBonus,
    depositType: dep,
    ethicsBonus,
    totalBonus: Math.round(totalBonus * 1000) / 1000,
    goodPrice,
    rmPrice,
    rmName: recipe.rm,
    rmAmt: recipe.rmAmt,
    pp: recipe.pp,
    priceOfProduction: Math.round(priceOfProduction * 1000) / 1000,
    profitPerPP: Math.round(profitPerPP * 1000) / 1000,
    grossWages: Math.round(grossWages * 1000) / 1000,
    netWages: Math.round(netWages * 1000) / 1000,
    incomeTax,
  };
}

function ethLabel(ind) {
  if (ind === 2) return "Fanatic Industrialist";
  if (ind === 1) return "Industrialist";
  if (ind === -1) return "Agrarian";
  if (ind === -2) return "Fanatic Agrarian";
  return "Neutral";
}

export async function computeProduction() {
  const k = apiKey();
  if (!k) return null;

  const [cRes, rRes] = await Promise.all([
    fetchTrpc("country.getAllCountries", {}, k),
    fetchTrpc("region.getRegionsObject", {}, k),
  ]);

  const countries = unwrap(cRes);
  const regions = unwrap(rRes);

  let priceMap = {};
  if (S.market.prices && S.market.prices.length) {
    for (const p of S.market.prices) priceMap[p.itemCode || p.item || p.name] = Number(p.price || p.value || 0);
  } else {
    const pRes = await fetchTrpc("itemTrading.getPrices", {}, k);
    const rawPrices = unwrap(pRes);
    const pricesArr = Array.isArray(rawPrices)
      ? rawPrices
      : Object.entries(rawPrices || {}).map(([itemCode, price]) => ({ itemCode, price }));
    for (const p of pricesArr) priceMap[p.itemCode || p.item || p.name] = Number(p.price || p.value || 0);
  }

  const countryArr = Array.isArray(countries) ? countries : (countries?.items || countries?.results || []);
  const countryById = {};
  const uniqueParties = new Set();
  for (const c of countryArr) {
    const id = c._id || c.id;
    if (!id) continue;
    countryById[id] = c;
    if (c.rulingParty) uniqueParties.add(c.rulingParty);
  }

  const partyIndById = {};
  const partyNameById = {};
  const partyIds = [...uniqueParties];
  const partyResults = await Promise.allSettled(
    partyIds.map(pid => fetchTrpc("party.getById", { partyId: pid }, k))
  );
  for (let i = 0; i < partyIds.length; i++) {
    if (partyResults[i].status === "fulfilled") {
      const pd = unwrap(partyResults[i].value);
      if (pd) {
        partyIndById[partyIds[i]] = pd.ethics?.industrialism || 0;
        partyNameById[partyIds[i]] = pd.name || "Unknown";
      }
    }
  }

  const rows = [];
  const productBest = {};

  for (const [rid, rDetail] of Object.entries(regions || {})) {
    const cId = rDetail.country || "";
    const country = countryById[cId] || null;
    if (!country) continue;

    const cname = country.name || "Unknown";
    const partyId = country.rulingParty;
    const ind = partyIndById[partyId] || 0;
    const partyName = partyNameById[partyId] || "None";

    const econ = computeRegionEconomics(rDetail, country, ind, priceMap);
    if (!econ) continue;

    rows.push({
      regionName: rDetail.name || "Unknown",
      countryName: cname,
      depositType: econ.depositType,
      partyName,
      partyIndustrialism: ind,
      incomeTax: econ.incomeTax,
      srBonus: econ.srBonus,
      depositBonus: econ.depositBonus,
      ethicsBonus: econ.ethicsBonus,
      totalBonus: econ.totalBonus,
      productName: econ.productName,
      bonusSource: econ.bonusSource,
      goodPrice: econ.goodPrice,
      rmName: econ.rmName,
      rmPrice: econ.rmPrice,
      rmAmt: econ.rmAmt,
      pp: econ.pp,
      priceOfProduction: econ.priceOfProduction,
      profitPerPP: econ.profitPerPP,
      grossWages: econ.grossWages,
      netWages: econ.netWages,
    });

    const key = econ.bonusSource;
    if (!productBest[key] || econ.netWages > productBest[key].netWages) {
      productBest[key] = { ...econ, regionName: rDetail.name, countryName: cname, partyName, partyIndustrialism: ind, incomeTax: econ.incomeTax, srBonus: econ.srBonus, depositBonus: econ.depositBonus, ethicsBonus: econ.ethicsBonus };
    }
  }

  rows.sort((a, b) => b.netWages - a.netWages);
  const bestPerProduct = Object.values(productBest)
    .filter(r => r.netWages > 0)
    .sort((a, b) => b.netWages - a.netWages);

  return { rows, bestPerProduct, priceMap };
}

export function renderProductionSection(container, data) {
  if (!data || !container) {
    if (container) container.innerHTML = '<p style="color:var(--ink-dim);padding:12px">No production data available.</p>';
    return;
  }
  const { bestPerProduct, rows } = data;

  const profitable = rows.filter(r => r.netWages > 0.01);
  const topWages = profitable.slice(0, 30);
  const topProfit = [...rows].filter(r => r.profitPerPP > 0).sort((a, b) => b.profitPerPP - a.profitPerPP).slice(0, 30);

  let html = '';

  html += `<div class="prod-section">
    <h3 class="cell-title"><iconify-icon icon="mdi:trophy" class="lu"></iconify-icon> Best Region per Product</h3>
    <div class="prod-table-wrap">
      <table class="prod-table"><thead><tr>
        <th>Product</th><th>Region</th><th>Country</th><th class="prod-num">Bonus</th><th class="prod-num">Profit/PP</th><th class="prod-num">Net Wages</th>
      </tr></thead><tbody>`;

  for (const r of bestPerProduct) {
    html += `<tr>
      <td class="prod-cell-name">${r.productName}</td>
      <td>${r.regionName}</td>
      <td>${r.countryName}</td>
      <td class="prod-num">${r.totalBonus.toFixed(1)}%</td>
      <td class="prod-num prod-profit">${fmtMoney(r.profitPerPP)} ₿</td>
      <td class="prod-num prod-wages">${fmtMoney(r.netWages)} ₿</td>
    </tr>`;
  }
  html += '</tbody></table></div></div>';

  html += `<div class="prod-section">
    <h3 class="cell-title"><iconify-icon icon="mdi:map-marker-star" class="lu"></iconify-icon> Top 30 Regions by Net Wages</h3>
    <div class="prod-table-wrap">
      <table class="prod-table"><thead><tr>
        <th>#</th><th>Region</th><th>Country</th><th>Product</th><th class="prod-num">Bonus</th><th class="prod-num">Tax</th><th class="prod-num">Gross</th><th class="prod-num">Net Wages</th>
      </tr></thead><tbody>`;

  topWages.forEach((r, i) => {
    html += `<tr>
      <td class="prod-rank">${i + 1}</td>
      <td>${r.regionName}</td>
      <td>${r.countryName}</td>
      <td class="prod-cell-name">${r.productName}</td>
      <td class="prod-num">${r.totalBonus.toFixed(1)}%</td>
      <td class="prod-num">${r.incomeTax}%</td>
      <td class="prod-num">${fmtMoney(r.grossWages)} ₿</td>
      <td class="prod-num prod-wages">${fmtMoney(r.netWages)} ₿</td>
    </tr>`;
  });
  html += '</tbody></table></div></div>';

  html += `<div class="prod-section">
    <h3 class="cell-title"><iconify-icon icon="mdi:chart-bar" class="lu"></iconify-icon> Top 30 by Profit per Production Point</h3>
    <div class="prod-table-wrap">
      <table class="prod-table"><thead><tr>
        <th>#</th><th>Region</th><th>Country</th><th>Product</th><th class="prod-num">Price</th><th class="prod-num">RM Cost</th><th class="prod-num">Bonus</th><th class="prod-num">Profit/PP</th>
      </tr></thead><tbody>`;

  topProfit.forEach((r, i) => {
    const rmCost = r.rmAmt > 0 ? `${r.rmAmt}×${fmtMoney(r.rmPrice)}` : "—";
    html += `<tr>
      <td class="prod-rank">${i + 1}</td>
      <td>${r.regionName}</td>
      <td>${r.countryName}</td>
      <td class="prod-cell-name">${r.productName}</td>
      <td class="prod-num">${fmtMoney(r.goodPrice)} ₿</td>
      <td class="prod-num">${rmCost}</td>
      <td class="prod-num">${r.totalBonus.toFixed(1)}%</td>
      <td class="prod-num prod-profit">${fmtMoney(r.profitPerPP)} ₿</td>
    </tr>`;
  });
  html += '</tbody></table></div></div>';

  container.innerHTML = html;
}
