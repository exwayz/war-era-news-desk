import { apiKey } from "../core/api.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../core/constants.js";
import { loadProfile } from "../user/profile.js";
import { toast } from "../ui/toast.js";

const PROHIBITED_WORDS = [
  "fuck", "shit", "nigger", "nigga", "bitch", "asshole", "bastard",
  "cunt", "dick", "pussy", "whore", "slut", "cock", "faggot",
  "retard", "nazi", "kike", "spic", "chink", "gook", "wetback",
  "rape", "murder", "kill", "die", "suicide",
];

const TABLE = "messages";
const PAGE_SIZE = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasProhibitedContent(text) {
  const n = normalize(text);
  for (const word of PROHIBITED_WORDS) {
    if (n.includes(word)) return true;
  }
  return false;
}

function hasUrl(text) {
  return /https?:\/\//i.test(text);
}

let cachedMessages = [];
let currentSort = "newest";
let currentPage = 1;
let totalMessages = 0;

function supabaseHeaders() {
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Prefer": "return=representation",
  };
}

function buildUrl(params) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return `${SUPABASE_URL}/rest/v1/${TABLE}${qs}`;
}

const SHA256_TEXT = new TextEncoder();
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", SHA256_TEXT.encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getWeekAgo() {
  return Date.now() - WEEK_MS;
}

export async function loadMessages(sort, page) {
  if (sort) currentSort = sort;
  if (page != null) currentPage = page; else currentPage = 1;

  const order = currentSort === "top" ? "upvotes.desc" : "created_at.desc";
  const from = (currentPage - 1) * PAGE_SIZE;
  const weekAgo = getWeekAgo();

  try {
    const [dataRes, countRes] = await Promise.all([
      fetch(buildUrl({
        "created_at": `gte.${weekAgo}`,
        "order": order,
        "limit": String(PAGE_SIZE),
        "offset": String(from),
      }), { headers: supabaseHeaders() }),
      fetch(buildUrl({
        "created_at": `gte.${weekAgo}`,
        "select": "id",
      }), { headers: { ...supabaseHeaders(), "Prefer": "count=exact" } }),
    ]);

    if (!dataRes.ok) throw new Error("Failed to load");
    const messages = await dataRes.json();
    const total = parseInt(countRes.headers.get("content-range")?.split("/")[1] || "0", 10);

    cachedMessages = currentPage === 1 ? messages : cachedMessages.concat(messages);
    totalMessages = total;
    return { messages: cachedMessages, total: totalMessages, page: currentPage };
  } catch {
    return { messages: cachedMessages, total: totalMessages, page: currentPage };
  }
}

export async function loadMoreMessages() {
  const prevLen = cachedMessages.length;
  const nextPage = currentPage + 1;
  const result = await loadMessages(currentSort, nextPage);
  return { ...result, loaded: cachedMessages.length - prevLen };
}

export function getCachedMessages() {
  return cachedMessages;
}

export function getTotalCount() {
  return totalMessages;
}

export function hasMoreMessages() {
  return cachedMessages.length < totalMessages;
}

async function getWeeklyCount(ids) {
  if (!ids.length) return 0;
  const weekAgo = getWeekAgo();
  try {
    const qs = `posted_by=in.(${ids.join(",")})&created_at=gte.${weekAgo}&select=id`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?${qs}`, {
      headers: { ...supabaseHeaders(), "Prefer": "count=exact" },
    });
    if (!res.ok) return 0;
    return parseInt(res.headers.get("content-range")?.split("/")[1] || "0", 10);
  } catch {
    return 0;
  }
}

export async function getRemainingQuota() {
  const ids = await posterIdentifiers();
  const count = await getWeeklyCount(ids);
  return { used: count, remaining: Math.max(0, 5 - count), total: 5 };
}

async function posterIdentifiers() {
  const key = apiKey()?.trim();
  const ids = [];
  if (key) ids.push("k_" + await sha256(key));
  const profile = loadProfile();
  if (profile?.userId) ids.push("u_" + profile.userId);
  return ids;
}

export async function postMessage(author, text) {
  if (!author || !text) return { error: "Author and message required" };
  if (text.length > 500) return { error: "Message too long (max 500 chars)" };
  if (hasProhibitedContent(text)) return { error: "Message contains prohibited content" };
  if (hasUrl(text)) return { error: "URLs are not allowed" };

  const key = apiKey().trim();
  if (!key) return { error: "API key required to post" };

  try {
    const ids = await posterIdentifiers();
    if (!ids.length) return { error: "No identifier available to post" };
    const count = await getWeeklyCount(ids);
    if (count >= 5) return { error: "Post limit reached (5/week)" };

    const postedBy = ids[0];
    const res = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: "POST",
      headers: { ...supabaseHeaders(), "Prefer": "return=representation" },
      body: JSON.stringify({
        author: author.trim().slice(0, 40),
        text: text.trim().slice(0, 500),
        posted_by: postedBy,
        upvotes: 0,
        upvoters: [],
      }),
    });
    if (!res.ok) return { error: "Failed to post" };
    let msg = await res.json();
    if (Array.isArray(msg)) msg = msg[0];
    cachedMessages.unshift(msg);
    totalMessages++;
    return { success: true, message: msg };
  } catch {
    return { error: "Server unavailable" };
  }
}

export async function upvoteMessage(id) {
  const key = apiKey().trim();
  if (!key) return "no-key";

  try {
    const hash = await sha256(key);

    const getRes = await fetch(buildUrl({ id: `eq.${id}`, select: "upvoters,upvotes" }), {
      headers: supabaseHeaders(),
    });
    if (!getRes.ok) return false;
    const rows = await getRes.json();
    if (!rows.length) return false;
    const current = rows[0].upvoters || [];
    if (current.includes(hash)) return "already";

    const patchRes = await fetch(buildUrl({ id: `eq.${id}` }), {
      method: "PATCH",
      headers: { ...supabaseHeaders(), "Prefer": "return=representation" },
      body: JSON.stringify({
        upvoters: [...current, hash],
        upvotes: (rows[0].upvotes || 0) + 1,
      }),
    });
    if (!patchRes.ok) return false;
    let updated = await patchRes.json();
    if (Array.isArray(updated)) updated = updated[0];
    const idx = cachedMessages.findIndex((m) => m.id === id);
    if (idx !== -1) cachedMessages[idx] = updated;
    return { success: true, upvotes: updated?.upvotes ?? (rows[0].upvotes || 0) + 1 };
  } catch {
    return false;
  }
}

export async function deleteMessage(id) {
  try {
    const res = await fetch(buildUrl({ id: `eq.${id}` }), {
      method: "DELETE",
      headers: supabaseHeaders(),
    });
    if (!res.ok) return false;
    cachedMessages = cachedMessages.filter((m) => m.id !== id);
    totalMessages = Math.max(0, totalMessages - 1);
    return true;
  } catch {
    return false;
  }
}

export function createWallCard(msg) {
  const card = document.createElement("article");
  card.className = "wall-card";
  card.dataset.wallId = msg.id;
  const date = new Date(msg.created_at);
  const timeStr = date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  card.innerHTML = `
    <div class="wall-card-head">
      <span class="wall-card-author">${escHtml(msg.author)}</span>
      <span class="wall-card-time">${timeStr}</span>
    </div>
    <p class="wall-card-text">${escHtml(msg.text)}</p>
    <div class="wall-card-actions">
      <button class="wall-upvote-btn" data-id="${msg.id}"><iconify-icon icon="mdi:thumb-up-outline" class="lu"></iconify-icon> ${msg.upvotes || 0}</button>
      <button class="wall-read-btn" data-id="${msg.id}">Read</button>
    </div>
  `;
  return card;
}

export function renderWallMessages(containerId, messages) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  const msgs = messages || cachedMessages;
  grid.innerHTML = "";
  if (!msgs.length) {
    grid.innerHTML = '<p class="wall-empty">No messages yet. Be the first to post!</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const msg of msgs) frag.appendChild(createWallCard(msg));
  grid.appendChild(frag);
}

export function prependWallCard(containerId, msg) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  const empty = grid.querySelector(".wall-empty");
  if (empty) empty.remove();
  grid.insertBefore(createWallCard(msg), grid.firstChild);
}

export function updateUpvoteDisplay(containerId, id, upvotes) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  const card = grid.querySelector(`[data-wall-id="${id}"]`);
  if (!card) return;
  const btn = card.querySelector(".wall-upvote-btn");
  if (!btn) return;
  for (const node of [...btn.childNodes]) {
    if (node.nodeType === 3) node.remove();
  }
  btn.append(" " + (upvotes ?? 0));
}

export function renderWallCount(countElId, count) {
  const el = document.getElementById(countElId);
  if (!el) return;
  const n = count !== undefined ? count : cachedMessages.length;
  el.textContent = n + " message" + (n !== 1 ? "s" : "") + (totalMessages > cachedMessages.length ? ` (${totalMessages} total)` : "");
}

export function getMessageById(id) {
  return cachedMessages.find((m) => m.id === id);
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

export function copyCommunityReport() {
  const msgs = getCachedMessages();
  if (!msgs.length) { toast("No messages loaded."); return; }
  let r = `# War Era Community Wall Report\nGenerated: ${new Date().toUTCString()}\nTotal: ${msgs.length} messages\n\n`;
  for (const m of msgs) {
    const date = new Date(m.created_at);
    const timeStr = date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    r += `${m.author} (${timeStr}):\n  ${m.text}\n  👍 ${m.upvotes || 0}\n\n`;
  }
  navigator.clipboard.writeText(r).then(() => toast("Community report copied."));
}
