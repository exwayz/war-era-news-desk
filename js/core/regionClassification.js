const CLASSIFICATION = {
  "The Americas": {
    "North America": ["Canada", "Greenland", "United States"],
    "Central America": ["Belize", "Costa Rica", "El Salvador", "Guatemala", "Honduras", "Mexico", "Nicaragua", "Panama"],
    "Caribbean": ["Bahamas", "Cuba", "Dominican Republic", "Haiti", "Jamaica", "Puerto Rico", "Trinidad and Tobago"],
    "South America": ["Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador", "Guyana", "Paraguay", "Peru", "Suriname", "Uruguay", "Venezuela"],
  },
  Europe: {
    "British Isles": ["Ireland", "United Kingdom"],
    "Western Europe": ["Andorra", "Austria", "Belgium", "France", "Germany", "Liechtenstein", "Luxembourg", "Netherlands", "Switzerland"],
    Iberia: ["Portugal", "Spain"],
    "Italy & Mediterranean": ["Italy", "Malta"],
    Balkans: ["Albania", "Bosnia", "Bulgaria", "Croatia", "Greece", "Kosovo", "Montenegro", "North Macedonia", "Romania", "Serbia", "Slovenia", "Cyprus"],
    "Central Europe": ["Czechia", "Hungary", "Poland", "Slovakia"],
    Baltic: ["Estonia", "Latvia", "Lithuania"],
    "Scandinavia & Nordic": ["Denmark", "Finland", "Iceland", "Norway", "Sweden"],
    "Eastern Europe": ["Belarus", "Moldova", "Russia", "Ukraine"],
  },
  "Middle East": {
    "Arabian Peninsula / Gulf": ["Bahrain", "Kuwait", "Oman", "Qatar", "Saudi Arabia", "United Arab Emirates", "Yemen"],
    Levant: ["Israel", "Jordan", "Lebanon", "Palestine", "Syria"],
    "Anatolia & Caucasus": ["Armenia", "Azerbaijan", "Georgia"],
    Persia: ["Iran"],
    Iraq: ["Iraq"],
  },
  Africa: {
    "North Africa": ["Algeria", "Egypt", "Libya", "Morocco", "Tunisia"],
    "West Africa": ["Benin", "Burkina Faso", "Cape Verde", "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Ivory Coast", "Liberia", "Mali", "Mauritania", "Niger", "Nigeria", "Senegal", "Sierra Leone", "Togo"],
    "Central Africa": ["Cameroon", "Central Africa", "Chad", "Congo", "DR Congo", "Equatorial Guinea", "Gabon"],
    "East Africa": ["Burundi", "Comoros", "Djibouti", "Eritrea", "Ethiopia", "Kenya", "Madagascar", "Mauritius", "Rwanda", "Somalia", "South Sudan", "Sudan", "Tanzania", "Uganda"],
    "Southern Africa": ["Angola", "Botswana", "Eswatini", "Lesotho", "Malawi", "Mozambique", "Namibia", "South Africa", "Zambia", "Zimbabwe"],
  },
  Asia: {
    "Central Asia": ["Kazakhstan", "Kyrgyzstan", "Tajikistan", "Turkmenistan", "Uzbekistan"],
    "South Asia": ["Afghanistan", "Bangladesh", "Bhutan", "India", "Nepal", "Pakistan", "Sri Lanka"],
    "East Asia": ["China", "Japan", "Mongolia", "South Korea", "Taiwan", "United Korea"],
    "Southeast Asia": ["Brunei", "Cambodia", "East Timor", "Indonesia", "Laos", "Malaysia", "Myanmar", "Philippines", "Singapore", "Thailand", "Vietnam"],
  },
  Oceania: {
    "Australia & New Zealand": ["Australia", "New Zealand"],
    "Pacific Islands": ["Fiji", "Papua New Guinea", "Solomon Islands", "Vanuatu"],
  },
};

let _flatMap = null;
let _nodeToChildren = null;

function _build() {
  if (_flatMap) return;
  _flatMap = Object.create(null);
  _nodeToChildren = Object.create(null);
  for (const [continent, subRegions] of Object.entries(CLASSIFICATION)) {
    _flatMap[continent.toLowerCase()] = { type: "continent", name: continent };
    const children = [];
    for (const [subRegion, countries] of Object.entries(subRegions)) {
      _flatMap[subRegion.toLowerCase()] = { type: "subregion", name: subRegion, continent };
      children.push(subRegion);
      for (const country of countries) {
        _flatMap[country.toLowerCase()] = { type: "country", name: country, subRegion, continent };
      }
    }
    _nodeToChildren[continent.toLowerCase()] = children;
  }
}

export function getRegionInfo(name) {
  _build();
  return _flatMap[name.toLowerCase()] || null;
}

export function getCountriesInRegion(name) {
  _build();
  const key = name.toLowerCase();
  const info = _flatMap[key];
  if (!info) return [];
  if (info.type === "country") return [info.name];
  const result = [];
  const seen = new Set();
  function walk(node) {
    if (seen.has(node.toLowerCase())) return;
    seen.add(node.toLowerCase());
    if (node.toLowerCase() !== key) { const n = _flatMap[node.toLowerCase()]; if (n && n.type === "country") { result.push(n.name); return; } }
    const sub = _nodeToChildren[node.toLowerCase()];
    if (sub) { for (const s of sub) walk(s); return; }
    for (const [continent, subRegions] of Object.entries(CLASSIFICATION)) {
      if (continent.toLowerCase() === node.toLowerCase()) {
        for (const [sub, countries] of Object.entries(subRegions)) {
          for (const c of countries) { if (!seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); result.push(c); } }
        }
        return;
      }
      for (const [sub, countries] of Object.entries(subRegions)) {
        if (sub.toLowerCase() === node.toLowerCase()) {
          for (const c of countries) { if (!seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); result.push(c); } }
          return;
        }
      }
    }
  }
  walk(key);
  return [...new Set(result)];
}

export function populateRegionOptions(datalistEl) {
  if (!datalistEl) return;
  datalistEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const continent of Object.keys(CLASSIFICATION)) {
    const o = document.createElement("option");
    o.value = "~ " + continent;
    o.dataset.value = continent;
    frag.appendChild(o);
    const subs = CLASSIFICATION[continent];
    for (const sub of Object.keys(subs)) {
      const o2 = document.createElement("option");
      o2.value = "- " + sub;
      o2.dataset.value = sub;
      frag.appendChild(o2);
    }
  }
  datalistEl.appendChild(frag);
}
