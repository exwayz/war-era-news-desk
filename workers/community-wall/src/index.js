import { createHash, randomUUID } from "node:crypto";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 12;
const MAX_POSTS_PER_WEEK = 5;
const MSG_MAX_LENGTH = 500;
const AUTHOR_MAX_LENGTH = 40;

const PROHIBITED_WORDS = [
  "fuck","shit","nigger","nigga","bitch","asshole","bastard",
  "cunt","dick","pussy","whore","slut","cock","faggot",
  "retard","nazi","kike","spic","chink","gook","wetback",
  "rape","murder","kill","die","suicide",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,x-api-key",
};

const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 30;

const _rate = new Map();

function sha256(str) {
  return createHash("sha256").update(str).digest("hex");
}

function rateLimited(ip) {
  const now = Date.now();
  const entry = _rate.get(ip);
  if (!entry || now - entry.reset > RATE_LIMIT_WINDOW) {
    _rate.set(ip, { count: 1, reset: now });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const WARERA_API = "https://gateway.warerastats.io/trpc";

async function validateApiKey(key) {
  if (!key) return null;
  try {
    const url = `${WARERA_API}/user.whoami?input=${encodeURIComponent("{}")}`;
    const res = await fetch(url, {
      headers: { "x-api-key": key },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.result?.data || data?.data || data || null;
  } catch {
    return null;
  }
}

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

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (rateLimited(ip)) {
      return json({ error: "Rate limited. Try again shortly." }, 429);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
      if (method === "GET" && path === "/messages") {
        return handleGetMessages(env.DB, url);
      }
      if (method === "GET" && path === "/messages/quota") {
        return handleGetQuota(env.DB, request);
      }
      if (method === "POST" && path === "/messages") {
        return handlePostMessage(env.DB, request);
      }
      if (method === "PATCH" && /^\/messages\/[^/]+\/upvote$/.test(path)) {
        const id = path.split("/")[2];
        return handleUpvote(env.DB, id, request);
      }
      if (method === "DELETE" && /^\/messages\/[^/]+$/.test(path)) {
        const id = path.split("/")[2];
        return handleDeleteMessage(env.DB, id, request);
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || "Internal error" }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();
    await env.DB.prepare("DELETE FROM messages WHERE created_at < ?").bind(weekAgo).run();
    console.log("Cleaned up messages older than 7 days");
  },
};

async function handleGetMessages(db, url) {
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const sort = url.searchParams.get("sort") || "newest";
  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();
  const offset = (page - 1) * PAGE_SIZE;

  const order = sort === "top" ? "upvotes DESC, created_at DESC" : "created_at DESC";

  const rows = await db.prepare(
    `SELECT id, author, text, upvotes, upvoters, created_at
     FROM messages WHERE created_at >= ?
     ORDER BY ${order}
     LIMIT ? OFFSET ?`
  ).bind(weekAgo, PAGE_SIZE, offset).all();

  const countResult = await db.prepare(
    "SELECT COUNT(*) as total FROM messages WHERE created_at >= ?"
  ).bind(weekAgo).first();

  const total = countResult?.total || 0;

  const messages = (rows.results || []).map(r => ({
    ...r,
    upvoters: JSON.parse(r.upvoters || "[]"),
  }));

  return json({ messages, total, page });
}

async function handlePostMessage(db, request) {
  const key = request.headers.get("x-api-key");
  if (!key) return json({ error: "API key required" }, 401);

  const user = await validateApiKey(key);
  if (!user) return json({ error: "Invalid API key" }, 401);

  const body = await request.json().catch(() => ({}));
  const author = (body.author || "").trim().slice(0, AUTHOR_MAX_LENGTH);
  const text = (body.text || "").trim().slice(0, MSG_MAX_LENGTH);

  if (!author || !text) return json({ error: "Author and message required" });
  if (hasProhibitedContent(text)) return json({ error: "Message contains prohibited content" });
  if (hasUrl(text)) return json({ error: "URLs are not allowed" });

  const postedBy = "k_" + sha256(key);
  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();

  const countRow = await db.prepare(
    "SELECT COUNT(*) as cnt FROM messages WHERE posted_by = ? AND created_at >= ?"
  ).bind(postedBy, weekAgo).first();

  if ((countRow?.cnt || 0) >= MAX_POSTS_PER_WEEK) {
    return json({ error: "Post limit reached (5/week)" });
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();

  await db.prepare(
    "INSERT INTO messages (id, author, text, posted_by, upvotes, upvoters, created_at) VALUES (?, ?, ?, ?, 0, '[]', ?)"
  ).bind(id, author, text, postedBy, createdAt).run();

  return json({ success: true, message: { id, author, text, upvotes: 0, upvoters: [], created_at: createdAt } }, 201);
}

async function handleUpvote(db, id, request) {
  const key = request.headers.get("x-api-key");
  if (!key) return json("no-key", 401);

  const hash = sha256(key);

  const row = await db.prepare(
    "SELECT upvotes, upvoters FROM messages WHERE id = ?"
  ).bind(id).first();

  if (!row) return json(false, 404);

  const upvoters = JSON.parse(row.upvoters || "[]");
  if (upvoters.includes(hash)) return json("already");

  upvoters.push(hash);
  const newUpvotes = (row.upvotes || 0) + 1;

  await db.prepare(
    "UPDATE messages SET upvotes = ?, upvoters = ? WHERE id = ?"
  ).bind(newUpvotes, JSON.stringify(upvoters), id).run();

  return json({ success: true, upvotes: newUpvotes });
}

async function handleDeleteMessage(db, id, request) {
  const key = request.headers.get("x-api-key");
  if (!key) return json("no-key", 401);

  const postedBy = "k_" + sha256(key);

  const row = await db.prepare(
    "SELECT posted_by FROM messages WHERE id = ?"
  ).bind(id).first();

  if (!row) return json(false, 404);
  if (row.posted_by !== postedBy) return json(false, 403);

  await db.prepare("DELETE FROM messages WHERE id = ?").bind(id).run();
  return json({ success: true });
}

async function handleGetQuota(db, request) {
  const key = request.headers.get("x-api-key");
  if (!key) return json({ used: 0, remaining: 5, total: 5 });

  const postedBy = "k_" + sha256(key);
  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();

  const row = await db.prepare(
    "SELECT COUNT(*) as cnt FROM messages WHERE posted_by = ? AND created_at >= ?"
  ).bind(postedBy, weekAgo).first();

  const used = row?.cnt || 0;
  return json({ used, remaining: Math.max(0, MAX_POSTS_PER_WEEK - used), total: MAX_POSTS_PER_WEEK });
}
