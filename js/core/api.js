import { TRPC_BASE, API2_BASE, API5_BASE, MARKET_DATA_URL, AI_SERVER_URL } from "./constants.js";
import { STORE } from "./storage.js";
import { E } from "./dom.js";

// ── Tiered transaction data (true/lite/cold) ──
let _trueTx = null;   // { wages, trades } from maxPages=2000
let _liteTx = null;   // { wages, trades } from maxPages=50
let _trueTxErr = null;
let _trueTxFired = false;
let _upgradeFn = null;

export function onTxUpgrade(fn) { _upgradeFn = fn; }

export async function fetchTxPaginated(type, k, maxPages) {
  const cutoff = Date.now() - 86400000;
  const items = [];
  let cursor;
  for (let p = 0; p < maxPages; p++) {
    let res;
    try {
      res = await fetchTrpc("transaction.getPaginatedTransactions", { limit: 100, transactionType: type, cursor }, k);
    } catch { break; }
    const data = unwrap(res);
    const page = Array.isArray(data) ? data : (data?.items || []);
    if (!page.length) break;
    let old = false;
    for (const t of page) {
      const ts = new Date(t.createdAt || t.date || t.timestamp || 0).getTime();
      if (Number.isFinite(ts) && ts > 0 && ts < cutoff) { old = true; continue; }
      items.push(t);
    }
    cursor = data?.nextCursor || data?.cursor || null;
    if (old || !cursor) break;
  }
  return items;
}

export function startTransactionTrueAmount(k) {
  if (_trueTxFired) return;
  _trueTxFired = true;
  (async () => {
    try {
      const [wages, trades] = await Promise.all([
        fetchTxPaginated("wage", k, 2000),
        fetchTxPaginated("trading", k, 2000),
      ]);
      _trueTx = { wages, trades };
      _trueTxErr = null;
      _upgradeFn?.("true");
    } catch (e) {
      _trueTxErr = e;
      // Allow a later retry if this run failed (don't leave the tier stuck).
      _trueTxFired = false;
    }
  })();
}

export function startTransactionLiteAmount(k) {
  (async () => {
    try {
      const [wages, trades] = await Promise.all([
        fetchTxPaginated("wage", k, 50),
        fetchTxPaginated("trading", k, 50),
      ]);
      _liteTx = { wages, trades };
      _upgradeFn?.("lite");
    } catch {}
  })();
}

// Call when the API key changes so stale tiered tx data from the old key is
// never served and the true/lite fetch guards can fire again for the new key.
export function resetTxCaches() {
  _trueTx = null;
  _liteTx = null;
  _trueTxErr = null;
  _trueTxFired = false;
}

export function getBestTxData() {
  if (_trueTx) return _trueTx;
  if (_liteTx) return _liteTx;
  return null;
}

export function apiKey() {
  return localStorage.getItem(STORE.apiKey) || E.apiKeyInput.value.trim() || "";
}

const WAE_KEY_RE = /^wae_[a-f0-9]{64,}$/i;
export function isValidApiKey(k) {
  return WAE_KEY_RE.test(k.trim());
}

function noUndef(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==undefined && v!==null));
}

// Hard per-attempt timeout so a stalled gateway can never hang an await forever
// (a hung fetch used to silently kill the live battle tick refresh chain).
const FETCH_TIMEOUT_MS = 20000;

export async function fetchTrpc(method, input, k) {
  const url=`${TRPC_BASE}/${method}?input=${encodeURIComponent(JSON.stringify(noUndef(input)))}`;
  const headers = {};
  if (k) headers["x-api-key"] = k;
  let lastErr;
  for (let attempt=0; attempt<3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, attempt*1000));
    try {
      const res=await fetch(url,{headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)}).catch(err=>{
        if (location.protocol==="file:") throw new Error("Serve over http://localhost — file:// blocks CORS.");
        throw err;
      });
      const txt=await res.text();
      if (res.status===503 && attempt<2) { lastErr=new Error(`Gateway 503: ${txt.slice(0,80)}`); continue; }
      if (!res.ok) {
        if (res.status===401) throw new Error("Invalid API key — check and try again.");
        throw new Error(`Gateway ${res.status}: ${txt.slice(0,140)}`);
      }
      if (!txt) return null;
      const j=JSON.parse(txt);
      if (j?.error?.message) throw new Error(j.error.message);
      return j;
    } catch (err) {
      if (err.message?.startsWith("Invalid API key")||err.message?.includes("file://")) throw err;
      lastErr=err;
    }
  }
  // If gateway failed with a database connection error, fall back to api2
  if (lastErr && (lastErr.message||"").match(/postgres|database|hostname|connect/i)) {
    try { return await fetchTrpcApi2(method, input, k); } catch {}
  }
  throw lastErr||new Error(`${method} failed after 3 retries`);
}

export async function fetchTrpcApi5(method, input, apiKeyValue) {
  const payload = encodeURIComponent(JSON.stringify(noUndef(input)));
  const r = await fetch(
    `${API5_BASE}/${method}?input=${payload}`,
    {
      headers: {
        "Authorization": "Bearer " + apiKeyValue
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    }
  );
  if (!r.ok) throw new Error(`${method} ${r.status}`);
  return r.json();
}

export async function fetchTrpcApi2(method, input, apiKeyValue) {
  const payload = encodeURIComponent(JSON.stringify(noUndef(input)));
  const r = await fetch(
    `${API2_BASE}/${method}?input=${payload}`,
    {
      headers: {
        "X-API-Key": apiKeyValue
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    }
  );
  if (!r.ok) throw new Error(`${method} ${r.status}`);
  return r.json();
}

export function unwrap(r) {
  if (Array.isArray(r)) return r[0]?.result?.data?.json??r[0]?.result?.data??r[0]?.json??r[0];
  return r?.result?.data?.json??r?.result?.data??r?.json??r;
}

export function normalizeEvents(r) {
  const d=unwrap(r);
  if (Array.isArray(d)) return d;
  return d?.items||d?.events||d?.data||[];
}

export function normalizeCursor(r) {
  const d=unwrap(r);
  return d?.nextCursor||d?.cursor||d?.next||null;
}

export async function fetchAI(prompt) {
  if (!AI_SERVER_URL) return { error: "AI server not configured" };
  try {
    const r = await fetch(`${AI_SERVER_URL}/api/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await r.json();
    if (!r.ok) return { error: data?.error || `AI server ${r.status}` };
    return data;
  } catch (e) {
    return { error: e.name === "TimeoutError" ? "AI request timed out" : "AI server unreachable" };
  }
}

/** Fetch tournament teams for a tournament ID (works via api2 gateway) */
export async function fetchTournamentTeams(tournamentId, k) {
  try {
    const r = await fetchTrpcApi2("tournamentTeam.getByTournamentId", { tournamentId }, k);
    const data = unwrap(r);
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

/** Fetch tx data directly from game API with configurable pagination (bypasses server proxies) */
export async function fetchMarketData(k, maxPages = 1) {
  const [wages, trades, ws] = await Promise.allSettled([
    fetchTxPaginated("wage", k, maxPages),
    fetchTxPaginated("trading", k, maxPages),
    fetchTrpcApi2("workOffer.getWageStats", {}, k).catch(() => {}),
  ]);
  return {
    wages: wages.status === "fulfilled" ? wages.value : [],
    trades: trades.status === "fulfilled" ? trades.value : [],
    wageStats: ws.status === "fulfilled" ? unwrap(ws.value) : null,
  };
}
