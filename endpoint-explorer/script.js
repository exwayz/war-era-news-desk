const ENDPOINTS = {

"company.getById":{
desc:"Get company by ID",
params:{ companyId:"" }
},

"company.getCompanies":{
desc:"Get companies",
params:{ perPage:20 }
},

"country.getCountryById":{
desc:"Get country by ID",
params:{ countryId:"" }
},

"country.getAllCountries":{
desc:"Get all countries",
params:{}
},

"event.getEventsPaginated":{
desc:"Event feed",
params:{
limit:20
}
},

"government.getByCountryId":{
desc:"Government",
params:{
countryId:""
}
},

"region.getById":{
desc:"Region",
params:{
regionId:""
}
},

"region.getRegionsObject":{
desc:"All regions",
params:{}
},

"battle.getById":{
desc:"Battle",
params:{
battleId:""
}
},

"battle.getLiveBattleData":{
desc:"Live battle",
params:{
battleId:""
}
},

"battle.getBattles":{
desc:"Battles",
params:{
isActive:true,
limit:20
}
},

"round.getById":{
desc:"Round",
params:{
roundId:""
}
},

"round.getLastHits":{
desc:"Last hits",
params:{
roundId:""
}
},

"battleRanking.getRanking":{
desc:"Battle rankings",
params:{
dataType:"damage",
type:"user",
side:"attacker",
limit:20
}
},

"itemTrading.getPrices":{
desc:"Item prices",
params:{}
},

"tradingOrder.getTopOrders":{
desc:"Commodity buy/sell orders",
params:{
itemCode:"heavyAmmo",
limit:20
}
},

"itemOffer.getById":{
desc:"Item offer",
params:{
itemOfferId:""
}
},

"workOffer.getById":{
desc:"Work offer",
params:{
workOfferId:""
}
},

"workOffer.getWorkOfferByCompanyId":{
desc:"Company work offer",
params:{
companyId:""
}
},

"workOffer.getWorkOffersPaginated":{
desc:"Work offers",
params:{
limit:20
}
},

"ranking.getRanking":{
desc:"Ranking",
params:{
rankingType:"countryDamages"
}
},

"search.searchAnything":{
desc:"Global search",
params:{
searchText:""
}
},

"gameConfig.getDates":{
desc:"Game dates",
params:{}
},

"gameConfig.getGameConfig":{
desc:"Game config",
params:{}
},

"user.getUserLite":{
desc:"User lite",
params:{
userId:""
}
},

"user.getUserById":{
desc:"User profile",
params:{
userId:""
}
},

"user.getUsersByCountry":{
desc:"Users by country",
params:{
countryId:"",
limit:20
}
},

"article.getArticleById":{
desc:"Article",
params:{
articleId:""
}
},

"article.getArticleLiteById":{
desc:"Article lite",
params:{
articleId:""
}
},

"article.getArticlesPaginated":{
desc:"Articles",
params:{
type:"last",
limit:20
}
},

"mu.getById":{
desc:"Military unit",
params:{
muId:""
}
},

"mu.getManyPaginated":{
desc:"Military units",
params:{
limit:20
}
},

"transaction.getPaginatedTransactions":{
desc:"Transactions",
params:{
limit:20
}
},

"upgrade.getUpgradeByTypeAndEntity":{
desc:"Upgrade",
params:{
upgradeType:"bunker"
}
},

"worker.getWorkers":{
desc:"Workers",
params:{}
},

"worker.getTotalWorkersCount":{
desc:"Worker count",
params:{
userId:""
}
},

"battleOrder.getByBattle":{
desc:"Battle orders",
params:{
battleId:"",
side:"attacker"
}
},

"inventory.fetchCurrentEquipment":{
desc:"Current equipment",
params:{
userId:""
}
},

"battleLootSummary.getByBattleAndUser":{
desc:"Battle loot",
params:{
battleId:"",
userId:""
}
},

"mercenaryContractAuction.getPaginatedAuctions":{
desc:"Mercenary auctions",
params:{
status:"active",
limit:50
}
},

"alliance.getManyPaginated":{
desc:"Alliance list",
params:{
limit:20
}
},

"party.getManyPaginated":{
desc:"Party list",
params:{
limit:20
}
}

};

let lastResponse = null;

const E = {
apiBase: document.getElementById("apiBase"),
apiKey: document.getElementById("apiKey"),
endpoint: document.getElementById("endpoint"),
params: document.getElementById("params"),

fetchBtn: document.getElementById("fetchBtn"),
prettyBtn: document.getElementById("prettyBtn"),
copyResponseBtn: document.getElementById("copyResponseBtn"),

resultBox: document.getElementById("resultBox"),
urlBox: document.getElementById("urlBox"),
endpointInfo: document.getElementById("endpointInfo"),

jsCode: document.getElementById("jsCode"),
jsResult: document.getElementById("jsResult"),
runJsBtn: document.getElementById("runJsBtn")
};

init();

function init(){

populateEndpoints();

loadSaved();

if(!E.endpoint.value){
E.endpoint.value =
Object.keys(ENDPOINTS)[0];
}

loadTemplate();

E.endpoint.addEventListener(
"change",
loadTemplate
);

E.fetchBtn.addEventListener(
"click",
fetchEndpoint
);

E.prettyBtn.addEventListener(
"click",
prettyJson
);

if(E.runJsBtn){

E.runJsBtn.addEventListener(
"click",
runCustomJs
);

}


}

function populateEndpoints(){

E.endpoint.innerHTML="";

for(const ep in ENDPOINTS){

const o=document.createElement("option");

o.value=ep;
o.textContent=ep;

E.endpoint.appendChild(o);

}

}

function loadTemplate(){

const ep = E.endpoint.value;

const cfg = ENDPOINTS[ep];

if(!cfg) return;

E.endpointInfo.textContent =
cfg.desc;

E.params.value =
JSON.stringify(
cfg.params,
null,
2
);

saveSettings();

}

function prettyJson(){

try{

const obj =
JSON.parse(E.params.value);

E.params.value =
JSON.stringify(
obj,
null,
2
);

}
catch{

alert("Invalid JSON");

}

}

function saveSettings(){

localStorage.setItem(
"trpcExplorer",
JSON.stringify({

apiBase:E.apiBase.value,
apiKey:E.apiKey.value,
endpoint:E.endpoint.value

})
);

}

function loadSaved(){

try{

const s =
JSON.parse(
localStorage.getItem(
"trpcExplorer"
)
);

if(!s) return;

if(s.apiBase)
E.apiBase.value=s.apiBase;

if(s.apiKey)
E.apiKey.value=s.apiKey;

if(s.endpoint)
E.endpoint.value=s.endpoint;

}
catch{}

}

async function fetchEndpoint(){

saveSettings();

E.resultBox.textContent =
"Loading...";

try{

const endpoint =
E.endpoint.value.trim();

const input =
JSON.parse(E.params.value);

const payload = {
"0":{
json:input
}
};

const url =
`${E.apiBase.value}/${endpoint}`;

E.urlBox.textContent =
url;

const res =
await fetch(url,{

method:"POST",

headers:{
"Content-Type":"application/json",
"X-API-Key":
E.apiKey.value.trim()
},

body:
JSON.stringify(payload)

});

const txt =
await res.text();

let json;

try{
json=JSON.parse(txt);
}
catch{
json=txt;
}

lastResponse=json;

E.resultBox.textContent =
JSON.stringify(
json,
null,
2
);

}
catch(err){

E.resultBox.textContent =
err.stack ||
err.message;

}

}

async function trpc(
endpoint,
input={}
){

const payload={
"0":{
json:input
}
};

const url =
`${E.apiBase.value}/${endpoint}`;

const res =
await fetch(url,{

method:"POST",

headers:{
"Content-Type":"application/json",
"X-API-Key":
E.apiKey.value.trim()
},

body:
JSON.stringify(payload)

});

const txt =
await res.text();

try{
return JSON.parse(txt);
}
catch{
return txt;
}

}

async function raw(
    endpoint,
    input={}
){

    const url =
        `${E.apiBase.value}/${endpoint}`;

    const res =
        await fetch(url,{

            method:"POST",

            headers:{
                "Content-Type":"application/json",
                "X-API-Key":
                    E.apiKey.value.trim()
            },

            body:
                JSON.stringify(input)

        });

    const txt =
        await res.text();

    try{
        return JSON.parse(txt);
    }
    catch{
        return txt;
    }

}

function apiKey(){
return E.apiKey.value.trim();
}

function apiBase(){
return E.apiBase.value;
}

async function runCustomJs(){

if(!E.jsResult)
return;

E.jsResult.textContent =
"Running...";

try{

const logs=[];

const oldLog =
console.log;

console.log=(...args)=>{

logs.push(

args.map(v=>{

try{

return typeof v==="object"
?JSON.stringify(v,null,2)
:String(v);

}
catch{

return String(v);

}

}).join(" ")

);

};

const fn =
new Function(
"trpc",
"apiKey",
"apiBase",
"response",

`
return (async()=>{

${E.jsCode.value}

})();
`
);

const result =
await fn(
trpc,
apiKey,
apiBase,
lastResponse
);

console.log = oldLog;

let output =
logs.join("\n\n");

if(result!==undefined){

output +=

"\n\n========== RETURN ==========\n\n";

output +=

typeof result==="object"
?JSON.stringify(result,null,2)
:String(result);

}

E.jsResult.textContent =
output || "Finished.";

}
catch(err){

E.jsResult.textContent =
err.stack || err.message;

}
}