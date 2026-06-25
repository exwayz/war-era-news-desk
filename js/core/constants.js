export const TRPC_BASE = "https://gateway.warerastats.io/trpc";
export const API2_BASE = "https://api2.warera.io/trpc";
export const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
export const DAY_MS = 86400000;

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
