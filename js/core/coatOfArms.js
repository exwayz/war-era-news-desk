const COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/";
const CACHE_KEY = "wa-nd-coa-cache";

const KNOWN = {
  "indonesia": "National_emblem_of_Indonesia_Garuda_Pancasila.svg",
  "japan": "Imperial_Seal_of_Japan.svg",
  "china": "National_Emblem_of_the_People%27s_Republic_of_China.svg",
  "united kingdom": "Royal_Coat_of_Arms_of_the_United_Kingdom.svg",
  "canada": "Coat_of_arms_of_Canada.svg",
  "united states": "Coat_of_arms_of_the_United_States.svg",
  "australia": "Coat_of_arms_of_Australia.svg",
  "india": "Emblem_of_India.svg",
  "south korea": "Coat_of_arms_of_South_Korea.svg",
  "north korea": "Coat_of_arms_of_North_Korea.svg",
  "saudi arabia": "Emblem_of_Saudi_Arabia.svg",
  "israel": "Emblem_of_Israel.svg",
  "iran": "Emblem_of_Iran.svg",
  "iraq": "Coat_of_arms_of_Iraq.svg",
  "afghanistan": "National_emblem_of_Afghanistan.svg",
  "nepal": "Emblem_of_Nepal.svg",
  "bhutan": "National_Emblem_of_Bhutan.svg",
  "sri lanka": "Coat_of_arms_of_Sri_Lanka.svg",
  "bangladesh": "National_emblem_of_Bangladesh.svg",
  "myanmar": "Coat_of_arms_of_Myanmar.svg",
  "laos": "National_emblem_of_Laos.svg",
  "cambodia": "Royal_arms_of_Cambodia.svg",
  "vietnam": "Emblem_of_Vietnam.svg",
  "philippines": "Coat_of_arms_of_the_Philippines.svg",
  "malaysia": "Coat_of_arms_of_Malaysia.svg",
  "singapore": "Coat_of_arms_of_Singapore.svg",
  "brunei": "Emblem_of_Brunei.svg",
  "east timor": "Coat_of_arms_of_East_Timor.svg",
  "mongolia": "Coat_of_arms_of_Mongolia.svg",
  "taiwan": "National_Emblem_of_the_Republic_of_China.svg",
  "mexico": "Coat_of_arms_of_Mexico.svg",
  "brazil": "Coat_of_arms_of_Brazil.svg",
  "russia": "Coat_of_arms_of_Russia.svg",
  "egypt": "Coat_of_arms_of_Egypt.svg",
  "south africa": "Coat_of_arms_of_South_Africa.svg",
  "germany": "Coat_of_arms_of_Germany.svg",
  "france": "Coat_of_arms_of_France.svg",
  "italy": "Coat_of_arms_of_Italy.svg",
  "spain": "Coat_of_arms_of_Spain.svg",
  "netherlands": "Coat_of_arms_of_the_Netherlands.svg",
  "belgium": "Coat_of_arms_of_Belgium.svg",
  "switzerland": "Coat_of_arms_of_Switzerland.svg",
  "austria": "Coat_of_arms_of_Austria.svg",
  "sweden": "Coat_of_arms_of_Sweden.svg",
  "norway": "Coat_of_arms_of_Norway.svg",
  "denmark": "Coat_of_arms_of_Denmark.svg",
  "finland": "Coat_of_arms_of_Finland.svg",
  "poland": "Coat_of_arms_of_Poland.svg",
  "czechia": "Coat_of_arms_of_the_Czech_Republic.svg",
  "hungary": "Coat_of_arms_of_Hungary.svg",
  "romania": "Coat_of_arms_of_Romania.svg",
  "bulgaria": "Coat_of_arms_of_Bulgaria.svg",
  "serbia": "Coat_of_arms_of_Serbia.svg",
  "croatia": "Coat_of_arms_of_Croatia.svg",
  "greece": "Coat_of_arms_of_Greece.svg",
  "turkey": "Coat_of_arms_of_Turkey.svg",
  "ukraine": "Coat_of_arms_of_Ukraine.svg",
  "portugal": "Coat_of_arms_of_Portugal.svg",
  "ireland": "Coat_of_arms_of_Ireland.svg",
  "new zealand": "Coat_of_arms_of_New_Zealand.svg",
  "argentina": "Coat_of_arms_of_Argentina.svg",
  "chile": "Coat_of_arms_of_Chile.svg",
  "colombia": "Coat_of_arms_of_Colombia.svg",
  "peru": "Coat_of_arms_of_Peru.svg",
  "venezuela": "Coat_of_arms_of_Venezuela.svg",
  "cuba": "Coat_of_arms_of_Cuba.svg",
  "morocco": "Coat_of_arms_of_Morocco.svg",
  "algeria": "Coat_of_arms_of_Algeria.svg",
  "tunisia": "Coat_of_arms_of_Tunisia.svg",
  "libya": "Coat_of_arms_of_Libya.svg",
  "nigeria": "Coat_of_arms_of_Nigeria.svg",
  "kenya": "Coat_of_arms_of_Kenya.svg",
  "ethiopia": "Coat_of_arms_of_Ethiopia.svg",
  "ghana": "Coat_of_arms_of_Ghana.svg",
  "ivory coast": "Coat_of_arms_of_Ivory_Coast.svg",
  "senegal": "Coat_of_arms_of_Senegal.svg",
  "angola": "Coat_of_arms_of_Angola.svg",
  "mozambique": "Coat_of_arms_of_Mozambique.svg",
  "zambia": "Coat_of_arms_of_Zambia.svg",
  "zimbabwe": "Coat_of_arms_of_Zimbabwe.svg",
  "tanzania": "Coat_of_arms_of_Tanzania.svg",
  "uganda": "Coat_of_arms_of_Uganda.svg",
  "pakistan": "Coat_of_arms_of_Pakistan.svg",
  "kazakhstan": "Coat_of_arms_of_Kazakhstan.svg",
  "uzbekistan": "Coat_of_arms_of_Uzbekistan.svg",
  "thailand": "Coat_of_arms_of_Thailand.svg",
  "united arab emirates": "Coat_of_arms_of_the_United_Arab_Emirates.svg",
  "syria": "Coat_of_arms_of_Syria.svg",
  "jordan": "Coat_of_arms_of_Jordan.svg",
  "lebanon": "Coat_of_arms_of_Lebanon.svg",
  "yemen": "Coat_of_arms_of_Yemen.svg",
  "kuwait": "Coat_of_arms_of_Kuwait.svg",
  "oman": "Coat_of_arms_of_Oman.svg",
  "qatar": "Coat_of_arms_of_Qatar.svg",
  "bahrain": "Coat_of_arms_of_Bahrain.svg",
  "palestine": "Coat_of_arms_of_Palestine.svg",
  "dominican republic": "Coat_of_arms_of_the_Dominican_Republic.svg",
  "haiti": "Coat_of_arms_of_Haiti.svg",
  "jamaica": "Coat_of_arms_of_Jamaica.svg",
  "trinidad and tobago": "Coat_of_arms_of_Trinidad_and_Tobago.svg",
  "bahamas": "Coat_of_arms_of_the_Bahamas.svg",
  "barbados": "Coat_of_arms_of_Barbados.svg",
  "belarus": "Coat_of_arms_of_Belarus.svg",
  "moldova": "Coat_of_arms_of_Moldova.svg",
  "georgia": "Coat_of_arms_of_Georgia.svg",
  "armenia": "Coat_of_arms_of_Armenia.svg",
  "azerbaijan": "Coat_of_arms_of_Azerbaijan.svg",
  "lithuania": "Coat_of_arms_of_Lithuania.svg",
  "latvia": "Coat_of_arms_of_Latvia.svg",
  "estonia": "Coat_of_arms_of_Estonia.svg",
  "iceland": "Coat_of_arms_of_Iceland.svg",
  "slovakia": "Coat_of_arms_of_Slovakia.svg",
  "slovenia": "Coat_of_arms_of_Slovenia.svg",
  "bosnia": "Coat_of_arms_of_Bosnia_and_Herzegovina.svg",
  "albania": "Coat_of_arms_of_Albania.svg",
  "macedonia": "Coat_of_arms_of_North_Macedonia.svg",
  "north macedonia": "Coat_of_arms_of_North_Macedonia.svg",
  "montenegro": "Coat_of_arms_of_Montenegro.svg",
  "kosovo": "Coat_of_arms_of_Kosovo.svg",
  "cyprus": "Coat_of_arms_of_Cyprus.svg",
  "malta": "Coat_of_arms_of_Malta.svg",
  "luxembourg": "Coat_of_arms_of_Luxembourg.svg",
  "monaco": "Coat_of_arms_of_Monaco.svg",
  "andorra": "Coat_of_arms_of_Andorra.svg",
  "liechtenstein": "Coat_of_arms_of_Liechtenstein.svg",
  "san marino": "Coat_of_arms_of_San_Marino.svg",
  "vatican": "Coat_of_arms_of_Vatican_City.svg",
  "paraguay": "Coat_of_arms_of_Paraguay.svg",
  "uruguay": "Coat_of_arms_of_Uruguay.svg",
  "bolivia": "Coat_of_arms_of_Bolivia.svg",
  "ecuador": "Coat_of_arms_of_Ecuador.svg",
  "guyana": "Coat_of_arms_of_Guyana.svg",
  "suriname": "Coat_of_arms_of_Suriname.svg",
  "belize": "Coat_of_arms_of_Belize.svg",
  "costa rica": "Coat_of_arms_of_Costa_Rica.svg",
  "el salvador": "Coat_of_arms_of_El_Salvador.svg",
  "guatemala": "Coat_of_arms_of_Guatemala.svg",
  "honduras": "Coat_of_arms_of_Honduras.svg",
  "nicaragua": "Coat_of_arms_of_Nicaragua.svg",
  "panama": "Coat_of_arms_of_Panama.svg",
  "greenland": "Coat_of_arms_of_Greenland.svg",
  "congo": "Coat_of_arms_of_the_Republic_of_the_Congo.svg",
  "dr congo": "Coat_of_arms_of_the_Democratic_Republic_of_the_Congo.svg",
  "cameroon": "Coat_of_arms_of_Cameroon.svg",
  "chad": "Coat_of_arms_of_Chad.svg",
  "gabon": "Coat_of_arms_of_Gabon.svg",
  "equatorial guinea": "Coat_of_arms_of_Equatorial_Guinea.svg",
  "central africa": "Coat_of_arms_of_the_Central_African_Republic.svg",
  "rwanda": "Coat_of_arms_of_Rwanda.svg",
  "burundi": "Coat_of_arms_of_Burundi.svg",
  "somalia": "Coat_of_arms_of_Somalia.svg",
  "djibouti": "Coat_of_arms_of_Djibouti.svg",
  "eritrea": "Coat_of_arms_of_Eritrea.svg",
  "south sudan": "Coat_of_arms_of_South_Sudan.svg",
  "sudan": "Coat_of_arms_of_Sudan.svg",
  "madagascar": "Coat_of_arms_of_Madagascar.svg",
  "mauritius": "Coat_of_arms_of_Mauritius.svg",
  "comoros": "Coat_of_arms_of_the_Comoros.svg",
  "mauritania": "Coat_of_arms_of_Mauritania.svg",
  "mali": "Coat_of_arms_of_Mali.svg",
  "burkina faso": "Coat_of_arms_of_Burkina_Faso.svg",
  "niger": "Coat_of_arms_of_Niger.svg",
  "benin": "Coat_of_arms_of_Benin.svg",
  "togo": "Coat_of_arms_of_Togo.svg",
  "liberia": "Coat_of_arms_of_Liberia.svg",
  "sierra leone": "Coat_of_arms_of_Sierra_Leone.svg",
  "guinea": "Coat_of_arms_of_Guinea.svg",
  "guinea-bissau": "Coat_of_arms_of_Guinea-Bissau.svg",
  "gambia": "Coat_of_arms_of_The_Gambia.svg",
  "cape verde": "Coat_of_arms_of_Cape_Verde.svg",
  "botswana": "Coat_of_arms_of_Botswana.svg",
  "lesotho": "Coat_of_arms_of_Lesotho.svg",
  "eswatini": "Coat_of_arms_of_Eswatini.svg",
  "malawi": "Coat_of_arms_of_Malawi.svg",
  "namibia": "Coat_of_arms_of_Namibia.svg",
  "fiji": "Coat_of_arms_of_Fiji.svg",
  "papua new guinea": "Coat_of_arms_of_Papua_New_Guinea.svg",
  "solomon islands": "Coat_of_arms_of_the_Solomon_Islands.svg",
  "vanuatu": "Coat_of_arms_of_Vanuatu.svg",
  "kyrgyzstan": "Coat_of_arms_of_Kyrgyzstan.svg",
  "tajikistan": "Coat_of_arms_of_Tajikistan.svg",
  "turkmenistan": "Coat_of_arms_of_Turkmenistan.svg",
  "afghanistan": "National_emblem_of_Afghanistan.svg",
  "são tomé and príncipe": "Coat_of_arms_of_S%C3%A3o_Tom%C3%A9_and_Pr%C3%ADncipe.svg",
};

let _cache = {};

function loadCache() {
  try { const d = localStorage.getItem(CACHE_KEY); if (d) _cache = JSON.parse(d); } catch {}
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(_cache)); } catch {}
}
loadCache();

export function getCoatOfArmsUrl(countryName) {
  if (!countryName) return "";
  const key = countryName.toLowerCase().trim();
  if (_cache[key]) return _cache[key];
  if (KNOWN[key]) {
    const url = COMMONS + KNOWN[key];
    _cache[key] = url;
    saveCache();
    return url;
  }
  const encoded = encodeURIComponent(countryName);
  const url = COMMONS + "Coat_of_arms_of_" + encoded + ".svg";
  _cache[key] = url;
  saveCache();
  return url;
}

export function retryCoatOfArms(imgEl, countryName, flagFallback) {
  const key = (countryName || "").toLowerCase().trim();
  const attempts = parseInt(imgEl.dataset.coaAttempt || "0", 10);
  if (attempts >= 3) {
    if (flagFallback) imgEl.src = flagFallback;
    return;
  }
  const alts = [
    () => COMMONS + "National_emblem_of_" + encodeURIComponent(countryName) + ".svg",
    () => COMMONS + "Emblem_of_" + encodeURIComponent(countryName) + ".svg",
    () => COMMONS + "Coat_of_Arms_of_" + encodeURIComponent(countryName) + ".svg",
  ];
  if (attempts < alts.length) {
    const nextUrl = alts[attempts]();
    imgEl.dataset.coaAttempt = String(attempts + 1);
    imgEl.src = nextUrl;
    if (_cache[key] !== nextUrl) { _cache[key] = nextUrl; saveCache(); }
  } else {
    if (flagFallback) imgEl.src = flagFallback;
  }
}
