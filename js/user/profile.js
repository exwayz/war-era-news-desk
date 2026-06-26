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
  if (/^[a-zA-Z0-9_-]+$/.test(input.trim())) return input.trim();
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
  const userId = extractUserId(input);
  if (!userId) return { error: "Could not extract a valid User ID. Enter a War Era profile URL or user ID." };
  if (!apiKey) return { error: "API key required. Save your API key first." };

  try {
    const { fetchTrpc, unwrap } = await import("../core/api.js");
    const { resolveEntityByType } = await import("../core/resolver.js");

    const raw = await fetchTrpc("user.getUserLite", { userId }, apiKey);
    const user = unwrap(raw);
    if (!user || (!user.username && !user.name)) {
      return { error: "User not found. Check the ID or URL and try again." };
    }

    let richData = {};
    try {
      const richRaw = await fetchTrpc("user.getUserById", { userId }, apiKey);
      const rich = unwrap(richRaw);
      if (rich) richData = rich;
    } catch {}

    const username = user.username || user.name || "Unknown";
    const avatarUrl = user.avatarUrl || user.avatar || "";
    const level = richData.leveling?.level ?? getField(user, "level", "userLevel", "lvl");

    const muId = toId(getField(user, "mu", "muId", "militaryUnit", "militaryunit"));
    const countryInput = getField(user, "country", "countryId", "citizenship", "countryCode");
    const partyId = toId(getField(user, "party", "partyId"));

    let muName = null, countryName = null, partyName = null;
    let countryCode = null;

    if (muId) {
      const muData = await resolveEntityByType("mu", muId, apiKey);
      if (muData) muName = getName(muData);
      if (!muName && typeof user.mu === "object") muName = user.mu.name || null;
    } else if (user.mu && typeof user.mu === "object") {
      muName = user.mu.name || user.mu.muName || user.mu.displayName || null;
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
    } else if (user.party && typeof user.party === "object") {
      partyName = user.party.name || user.party.partyName || null;
    }

    const subscribers = richData.rankings?.userSubscribers?.value ?? null;

    const profile = saveProfile({
      userId,
      username,
      name: user.name || username,
      avatarUrl,
      level: level != null ? String(level) : null,
      muId,
      muName,
      countryCode,
      countryName,
      partyId,
      partyName,
      subscribers,
    });

    return { success: true, profile };
  } catch (e) {
    return { error: "Failed to resolve user: " + (e.message || "API error") };
  }
}
