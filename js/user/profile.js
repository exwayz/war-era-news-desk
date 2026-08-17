const STORAGE_KEY = "wa-nd-user-profile";

export function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.userId ? p : null;
  } catch {
    return null;
  }
}

export function saveProfile(data) {
  const existing = loadProfile() || {};
  const profile = { ...existing, ...data, registeredAt: existing.registeredAt || Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

export function deleteProfile() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isRegistered() {
  return !!loadProfile();
}

export function formatProfileLink(userId) {
  if (!userId) return null;
  const id = userId.trim();
  if (!id) return null;
  return `https://app.warera.io/user/${id}`;
}

export function extractUserId(input) {
  if (!input) return null;
  const urlMatch = input.trim().match(/app\.warera\.io\/user\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9]{24}$/.test(input.trim())) return input.trim();
  return null;
}

function getField(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v != null) return v;
  }
  return null;
}

function toId(val) {
  if (!val) return null;
  if (typeof val === "object") return val._id || val.id || val.muId || val.partyId || val.countryId || null;
  return String(val);
}

function getName(val) {
  if (!val) return null;
  if (typeof val === "object") return val.name || val.muName || val.partyName || val.displayName || null;
  return String(val);
}

export async function resolveProfile(input, apiKey) {
  if (!input || !input.trim()) return { error: "Enter a username, user ID, or profile URL." };
  if (!apiKey) return { error: "API key required. Save your API key first." };

  try {
    const { fetchTrpc, unwrap } = await import("../core/api.js");
    const { resolveEntityByType } = await import("../core/resolver.js");

    let userId = extractUserId(input);
    let richData = {};

    if (userId) {
      const raw = await fetchTrpc("user.getUserLite", { userId }, apiKey);
      const user = unwrap(raw);
      if (!user || (!user.username && !user.name)) {
        return { error: "User not found. Check the ID or URL and try again." };
      }
      try {
        const richRaw = await fetchTrpc("user.getUserById", { userId }, apiKey);
        const rich = unwrap(richRaw);
        if (rich) richData = rich;
      } catch {}
      Object.assign(richData, user);
    } else {
      const searchTerm = input.trim();
      const searchRes = await fetchTrpc("search.searchAnything", { searchText: searchTerm }, apiKey);
      const searchData = unwrap(searchRes);
      const foundIds = searchData?.userIds;
      if (!foundIds || !foundIds.length) {
        return { error: `No user found for "${searchTerm}". Try a different username.` };
      }
      userId = foundIds[0];
      const richRaw = await fetchTrpc("user.getUserById", { userId }, apiKey);
      const rich = unwrap(richRaw);
      if (!rich || (!rich.username && !rich.name)) {
        return { error: "User found but profile data could not be loaded." };
      }
      richData = rich;
    }

    const username = richData.username || richData.name || "Unknown";
    const avatarUrl = richData.avatarUrl || richData.avatar || "";
    const level = richData.leveling?.level ?? getField(richData, "level", "userLevel", "lvl");

    const muId = toId(getField(richData, "mu", "muId", "militaryUnit", "militaryunit"));
    const countryInput = getField(richData, "country", "countryId", "citizenship", "countryCode");
    const partyId = toId(getField(richData, "party", "partyId"));

    let muName = null, countryName = null, partyName = null;
    let countryCode = null;

    if (muId) {
      const muData = await resolveEntityByType("mu", muId, apiKey);
      if (muData) muName = getName(muData);
      if (!muName && typeof richData.mu === "object") muName = richData.mu.name || null;
    } else if (richData.mu && typeof richData.mu === "object") {
      muName = richData.mu.name || richData.mu.muName || richData.mu.displayName || null;
    }

    if (countryInput) {
      if (typeof countryInput === "object") {
        countryCode = countryInput.shortCode || countryInput.code || countryInput.iso || countryInput.iso2 || null;
        countryName = countryInput.name || null;
      } else {
        countryCode = String(countryInput).toLowerCase();
        const countryData = await resolveEntityByType("country", countryCode, apiKey);
        if (countryData) countryName = countryData.name || null;
      }
    }

    if (partyId) {
      const partyData = await resolveEntityByType("party", partyId, apiKey);
      if (partyData) partyName = getName(partyData);
    } else if (richData.party && typeof richData.party === "object") {
      partyName = richData.party.name || richData.party.partyName || null;
    }

    const subscribers = richData.rankings?.userSubscribers?.value ?? null;
    const subscriberRank = richData.rankings?.userSubscribers?.rank ?? null;
    const subscriberTier = richData.rankings?.userSubscribers?.tier ?? null;

    const profile = saveProfile({
      userId,
      username,
      name: richData.name || username,
      avatarUrl,
      level: level != null ? String(level) : null,
      muId,
      muName,
      countryCode,
      countryName,
      partyId,
      partyName,
      subscribers,
      subscriberRank,
      subscriberTier,
    });

    return { success: true, profile };
  } catch (e) {
    return { error: "Failed to resolve user: " + (e.message || "API error") };
  }
}
