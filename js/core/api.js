import { TRPC_BASE, API2_BASE } from "./constants.js";
import { STORE } from "./storage.js";
import { E } from "./dom.js";

export function apiKey() {
  return E.apiKeyInput.value.trim() || localStorage.getItem(STORE.apiKey) || "";
}

function noUndef(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==undefined));
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
  throw lastErr||new Error(`${method} failed after 3 retries`);
}

export async function fetchTrpcApi2(method, input, apiKeyValue) {
  const payload = encodeURIComponent(JSON.stringify(input || {}));
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
