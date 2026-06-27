export const S = {
  cursor:null, events:[], articleCursor:null, articles:[],
  isLoading:false, lastFilters:{}, filterTimer:null,
  lookups:{
    countriesById:new Map(), countryIdsByName:new Map(),
    regionsById:new Map(), battlesById:new Map(),
    usersById:new Map(), companiesById:new Map(),
    alliancesById:new Map(),
  },
  lookupsKey:"",
  autoRefreshTimer:null,
  articleLimiter:0,
  battles:[], battleCursor:null, battleMode:"history",
  selectedBattleId:null,
  liveBattleTimer:null,
  battleSearch:"", battleSort:"ended", battleDateFrom:"", battleDateTo:"", battleDamageCache:new Map(), damageCachePending:false,
  articleSort:"date", articleTimeFrom:"", articleTimeTo:"",
  market:{ econ:null, prices:null, orders:null, commodityOrders:[], equipmentOrders:[], orderView:"commodity", priceHistory:[], wageHistory:[], topValuable:[], tradeVolHistory:[], payrollHistory:[], ppHistory:[], hhiHistory:[], circulationHistory:[], tradeEfficiencyHistory:[], basketHistory:[] },
  jobs:[], jobCursor:null, jobTimer:null,
  jobCountryFilter:"",
  currentTab:"timeline",
  jobWageFilter:0,
  wallSort:"newest",
};

S.lookups.muById = new Map();
S.lookups.articlesById = new Map();
S.lookups.partiesById = new Map();

export let unseenTimelineEvents = 0;

export function setUnseenTimelineEvents(v) {
  unseenTimelineEvents = v;
}

export function getUnseenTimelineEvents() {
  return unseenTimelineEvents;
}

export const __pm = new Map();
