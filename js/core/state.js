export const S = {
  cursor:null, events:[], articleCursor:null, articles:[],
  isLoading:false, lastFilters:{}, filterTimer:null, pendingReload:false, pendingArticleReload:false,
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
  battleDetailSeq:0,
  battleView:null, battleTickTimer:null,
  battleSearch:"", battleSearchMode:"", battleSearchId:"", battleSearchCountryId:"", battleSearchRegionIds:[], battleSearchCursor:null, battleSearchRegionCursors:{}, battleSearchLabel:"", battleLoadPath:"",
  battleRegionFilter:"", battleTypeFilter:"all", battleSort:"ended", battleSortDir:"desc", battleDateFrom:"", battleDateTo:"", battleDateCapped:false, battleDamageCache:new Map(), battleCardStats:new Map(), cardStatsPending:false, liveListTimer:null,
  articleSort:"date", articleLangs:[],
  market:{ econ:null, prices:null, orders:null, commodityOrders:[], equipmentOrders:[], orderView:"commodity", priceHistory:[], wageHistory:[], topValuable:[], _weeklyMVI:null, _mviView:"live", tradeVolHistory:[], payrollHistory:[], ppHistory:[], hhiHistory:[], circulationHistory:[], tradeEfficiencyHistory:[], basketHistory:[],
    trade:{ prices:null, lastPrices:null, volume:0, count:0, VWAP:0, turnover:0, high:0, low:0, average:0, median:0, velocity:0, priceHistory:[], volHistory:[] },
    orderbook:{ bestBid:null, bestAsk:null, spread:null, midPrice:null, markPrice:null, depth:0, buyLiquidity:0, sellLiquidity:0, bookVolume:0, imbalance:null, support:null, resistance:null, commodityOrders:[] },
    signals:new Map(), itemBooks:new Map(), itemHistories:new Map(), recentTrades:[], compositeIndex:null, prevMids:new Map(),
  },
  jobs:[], jobCursor:null, jobTimer:null,
  jobCountryFilter:"",
  timelineRegionFilter:"",
  currentTab:"timeline",
  jobWageFilter:0,
  wallSort:"newest",
  newEventIds:new Set(),       // timeline events registered while away, awaiting user recognition
  seenNewEventIds:new Set(),   // subset of newEventIds whose cards have been visible on screen
  newMarkersSince:0,           // timestamp when the tagged cards were first shown to the user
  newMarkersClearTimer:null,   // pending clear for the minimum pulse window
  newBattleIds:new Set(),      // live battles registered while away, awaiting user recognition
  seenNewBattleIds:new Set(),  // subset of newBattleIds whose cards have been visible on screen
  battleNewMarkersSince:0,     // timestamp when the tagged battle cards were first shown
  battleNewMarkersClearTimer:null, // pending clear for the minimum pulse window
};

S.lookups.muById = new Map();
S.lookups.partiesById = new Map();
S.lookups.articlesById = new Map();
S.lookups.tournamentTeamsById = new Map(); // team ID → { _id, number, colorScheme, countries, mus, participants }
S.lookups.tournamentsById = new Map();    // tournament ID → { _id, type, name, ... }

export let unseenTimelineEvents = 0;

export function setUnseenTimelineEvents(v) {
  unseenTimelineEvents = v;
}

export function getUnseenTimelineEvents() {
  return unseenTimelineEvents;
}

export const __pm = new Map();
