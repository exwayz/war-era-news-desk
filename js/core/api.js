import { TRPC_BASE, API2_BASE, API5_BASE, MARKET_SERVER_URL, MARKET_DATA_URL } from "./constants.js";
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
      _upgradeFn?.("true");
    } catch (e) { _trueTxErr = e; }
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

export function getBestTxData() {
  if (_trueTx) return _trueTx;
  if (_liteTx) return _liteTx;
  return null;
}

export function apiKey() {
  return E.apiKeyInput.value.trim() || localStorage.getItem(STORE.apiKey) || "";
}

function noUndef(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==undefined && v!==null));
}

export async function fetchTrpc(method, input, k) {
  const url=`${TRPC_BASE}/${method}?input=${encodeURIComponent(JSON.stringify(noUndef(input)))}`;
  const headers = {};
  if (k) headers["x-api-key"] = k;
  let lastErr;
  for (let attempt=0; attempt<3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, attempt*1000));
    try {
      const res=await fetch(url,{headers}).catch(err=>{
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
      }
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
      }
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

export async function fetchFromServer(path, opts = {}) {
  if (!MARKET_SERVER_URL) return null;
  try {
    const r = await fetch(`${MARKET_SERVER_URL}${path}`, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body || undefined,
      signal: AbortSignal.timeout(opts.timeout || 5000),
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

/** Fetch from Belmo cache first, fall back to direct API on miss/stale */
export async function fetchCached(key, directFetcher) {
  if (MARKET_SERVER_URL) {
    try {
      const r = await fetch(`${MARKET_SERVER_URL}/api/cache/${key}`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const data = await r.json();
        if (data?.items?.length) return data.items;
      }
    } catch {}
  }
  return directFetcher ? await directFetcher() : [];
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
