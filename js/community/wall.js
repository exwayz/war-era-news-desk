import { apiKey } from "../core/api.js";
import { WALL_API_BASE } from "../core/constants.js";

const PROHIBITED_WORDS = [
  "fuck", "shit", "nigger", "nigga", "bitch", "asshole", "bastard",
  "cunt", "dick", "pussy", "whore", "slut", "cock", "faggot",
  "retard", "nazi", "kike", "spic", "chink", "gook", "wetback",
  "rape", "murder", "kill", "die", "suicide",
];

const API_BASE = WALL_API_BASE;
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

export async function loadMessages(sort, page) {
  if (sort) currentSort = sort;
  if (page != null) currentPage = page; else currentPage = 1;
  try {
    const res = await fetch(`${API_BASE}?sort=${currentSort}&page=${currentPage}`);
    if (!res.ok) throw new Error("Failed to load");
    const data = await res.json();
    cachedMessages = data.messages || [];
    totalMessages = data.total || 0;
    return { messages: cachedMessages, total: totalMessages, page: currentPage };
  } catch {
    return { messages: cachedMessages, total: totalMessages, page: currentPage };
  }
}

export async function loadMoreMessages() {
  const nextPage = currentPage + 1;
  try {
    const res = await fetch(`${API_BASE}?sort=${currentSort}&page=${nextPage}`);
    if (!res.ok) throw new Error("Failed to load");
    const data = await res.json();
    const newMsgs = data.messages || [];
    cachedMessages = cachedMessages.concat(newMsgs);
    totalMessages = data.total || 0;
    currentPage = nextPage;
    return { messages: cachedMessages, total: totalMessages, page: currentPage, loaded: newMsgs.length };
  } catch {
    return { messages: cachedMessages, total: totalMessages, page: currentPage, loaded: 0 };
  }
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

export async function postMessage(author, text) {
  if (!author || !text) return { error: "Author and message required" };
  if (text.length > 500) return { error: "Message too long (max 500 chars)" };
  if (hasProhibitedContent(text)) return { error: "Message contains prohibited content" };
  if (hasUrl(text)) return { error: "URLs are not allowed" };

  try {
    const key = apiKey();
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: author.trim().slice(0, 40), text: text.trim().slice(0, 500), apiKey: key }),
    });
    if (res.status === 429) return { error: "Post limit reached (max 5 per week)" };
    if (!res.ok) return { error: "Failed to post" };
    const msg = await res.json();
    cachedMessages.unshift(msg);
    totalMessages++;
    return { success: true, message: msg };
  } catch {
    return { error: "Server unavailable" };
  }
}

export async function upvoteMessage(id) {
  try {
    const key = apiKey();
    const res = await fetch(`${API_BASE}/${id}/upvote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    if (res.status === 409) return "already";
    if (!res.ok) return false;
    const updated = await res.json();
    const idx = cachedMessages.findIndex((m) => m.id === id);
    if (idx !== -1) cachedMessages[idx] = updated;
    return true;
  } catch {
    return false;
  }
}

export async function deleteMessage(id) {
  try {
    const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) return false;
    cachedMessages = cachedMessages.filter((m) => m.id !== id);
    totalMessages = Math.max(0, totalMessages - 1);
    return true;
  } catch {
    return false;
  }
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
  for (const msg of msgs) {
    const card = document.createElement("article");
    card.className = "wall-card";
    card.dataset.wallId = msg.id;
    const date = new Date(msg.createdAt);
    const timeStr = date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    card.innerHTML = `
      <div class="wall-card-head">
        <span class="wall-card-author">${escHtml(msg.author)}</span>
        <span class="wall-card-time">${timeStr}</span>
      </div>
      <p class="wall-card-text">${escHtml(msg.text)}</p>
      <div class="wall-card-actions">
        <button class="wall-upvote-btn" data-id="${msg.id}">👍 ${msg.upvotes || 0}</button>
        <button class="wall-read-btn" data-id="${msg.id}">Read</button>
      </div>
    `;
    grid.appendChild(card);
  }
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
