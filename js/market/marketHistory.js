import { S } from "../core/state.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../core/constants.js";

const TABLE = "market_snapshots";

function headers() {
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  };
}

const TWO_HOURS = 7200000;

export async function storeMarketSnapshot() {
  const snapshot = {
    topValuable: (S.market.topValuable || []).map(i => ({ item: i.item, value: i.value })),
    econ: S.market.econ ? {
      totalPayroll: S.market.econ.totalPayroll,
      tradeVol: S.market.econ.tradeVol,
      avgWage: S.market.econ.avgWage,
      wageCount: S.market.econ.wageCount,
      tradeCount: S.market.econ.tradeCount,
    } : null,
  };
  const cutoff = new Date(Date.now() - TWO_HOURS).toISOString();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?created_at=lt.${cutoff}`, {
      method: "DELETE", headers: headers(),
    });
  } catch {}
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: { ...headers(), "Prefer": "return=minimal" },
      body: JSON.stringify({ snapshot }),
    });
  } catch {}
}

export async function loadSupabaseHistory(limit = 15) {
  const cutoff = new Date(Date.now() - TWO_HOURS).toISOString();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?created_at=gte.${cutoff}&order=created_at.desc&limit=${limit}`,
      { headers: headers() }
    );
    if (!res.ok) return;
    const rows = await res.json();
    S.market._supabaseHistory = rows.map(r => r.snapshot);
  } catch {}
}
