export const TRPC_BASE = "https://gateway.warerastats.io/trpc";
export const API2_BASE = "https://api2.warera.io/trpc";
export const API5_BASE = "https://api5.warera.io/trpc";
export const MARKET_SERVER_URL = "https://newsdesk-server-4942.onbelmo.uk";
export const MARKET_DATA_URL = "https://market-server.rooster-5b9.workers.dev"; // ← update to your Deno Deploy URL after deploying
export const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
export const DAY_MS = 86400000;
// Supabase — replace with your project's values from Settings → API
export const SUPABASE_URL = "https://bfxyhxjlbrfavuzoljvs.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmeHloeGpsYnJmYXZ1em9sanZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDAzODAsImV4cCI6MjA5Nzk3NjM4MH0.0WlDueuTpxhO35Wor6f9zOFUhEPQ_7E9VeRvbpOu6aM";

export const EVENT_TYPES = [
"allianceBroken",
"allianceFormed",
"allianceMemberExcluded",
"allianceMemberJoined",
"allianceMemberLeft",
"bankruptcy",
"battleEnded",
"battleOpened",
"countryMoneyTransfer",
"defensivePactBroken",
"defensivePactFormed",
"depositDiscovered",
"financedRevolt",
"newPresident",
"peace_agreement",
"peaceMade",
"regionLiberated",
"regionTransfer",
"resistanceDecreased",
"resistanceIncreased",
"revolutionEnded",
"revolutionStarted",
"strategicResourcesReshuffled",
"systemRevolt",
"warDeclared",
];
