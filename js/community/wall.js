import { apiKey } from "../core/api.js";
import { toast } from "../ui/toast.js";

const WALL_API = "https://newsdesk-community-wall.rooster-5b9.workers.dev";

const PROHIBITED_WORDS = [
  "fuck","shit","nigger","nigga","bitch","asshole","bastard",
  "cunt","dick","pussy","whore","slut","cock","faggot",
  "retard","nazi","kike","spic","chink","gook","wetback",
  "rape","murder","kill","die","suicide",
];

const PAGE_SIZE = 12;

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

function wallHeaders() {
  const k = apiKey()?.trim();
  const h = { "Content-Type": "application/json" };
  if (k) h["x-api-key"] = k;
  return h;
}

export async function loadMessages(sort, page) {
  if (sort) currentSort = sort;
  if (page != null) currentPage = page; else currentPage = 1;

  const params = new URLSearchParams({ page: currentPage, sort: currentSort });

  try {
    const res = await fetch(`${WALL_API}/messages?${params}`, {
      headers: wallHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load");
    const data = await res.json();
    cachedMessages = currentPage === 1 ? data.messages : cachedMessages.concat(data.messages);
    totalMessages = data.total;
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

export async function getRemainingQuota() {
  try {
    const res = await fetch(`${WALL_API}/messages/quota`, {
      headers: wallHeaders(),
    });
    const data = await res.json();
    return { used: data.used, remaining: data.remaining, total: data.total };
  } catch {
    return { used: 0, remaining: 5, total: 5 };
  }
}

export async function postMessage(author, text) {
  if (!author || !text) return { error: "Author and message required" };
  if (text.length > 500) return { error: "Message too long (max 500 chars)" };
  if (hasProhibitedContent(text)) return { error: "Message contains prohibited content" };
  if (hasUrl(text)) return { error: "URLs are not allowed" };

  try {
    const res = await fetch(`${WALL_API}/messages`, {
      method: "POST",
      headers: wallHeaders(),
      body: JSON.stringify({
        author: author.trim().slice(0, 40),
        text: text.trim().slice(0, 500),
      }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Failed to post" };
    cachedMessages.unshift(data.message);
    totalMessages++;
    return { success: true, message: data.message };
  } catch {
    return { error: "Server unavailable" };
  }
}

export async function upvoteMessage(id) {
  try {
    const res = await fetch(`${WALL_API}/messages/${id}/upvote`, {
      method: "PATCH",
      headers: wallHeaders(),
    });
    const data = await res.json();
    if (data === "no-key") return "no-key";
    if (data === "already") return "already";
    if (data?.success) {
      const idx = cachedMessages.findIndex(m => m.id === id);
      if (idx !== -1) cachedMessages[idx].upvotes = data.upvotes;
      return { success: true, upvotes: data.upvotes };
    }
    return false;
  } catch {
    return false;
  }
}

export async function deleteMessage(id) {
  try {
    const res = await fetch(`${WALL_API}/messages/${id}`, {
      method: "DELETE",
      headers: wallHeaders(),
    });
    if (!res.ok) return false;
    cachedMessages = cachedMessages.filter(m => m.id !== id);
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
