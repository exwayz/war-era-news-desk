const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8022;
const DB = path.join(__dirname, "database", "messages.json");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_POSTS_PER_WEEK = 5;
const PAGE_SIZE = 12;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function readDB() {
  try {
    const raw = fs.readFileSync(DB, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeDB(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

function cleanupOld() {
  const msgs = readDB();
  const cutoff = Date.now() - WEEK_MS;
  const filtered = msgs.filter((m) => m.createdAt >= cutoff);
  if (filtered.length !== msgs.length) writeDB(filtered);
  return filtered;
}

function hashKey(k) {
  return crypto.createHash("sha256").update(k).digest("hex");
}

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(__dirname, urlPath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // GET /api/messages?sort=newest&page=1
  if (pathname === "/api/messages" && req.method === "GET") {
    cleanupOld();
    const msgs = readDB();
    const sort = url.searchParams.get("sort") || "newest";
    if (sort === "top") msgs.sort((a, b) => b.upvotes - a.upvotes);
    else msgs.sort((a, b) => b.createdAt - a.createdAt);

    const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
    const total = msgs.length;
    const start = (page - 1) * PAGE_SIZE;
    const paged = msgs.slice(start, start + PAGE_SIZE);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ messages: paged, total, page, pageSize: PAGE_SIZE }));
    return;
  }

  // POST /api/messages
  if (pathname === "/api/messages" && req.method === "POST") {
    try {
      const data = await parseBody(req);
      if (!data.text || !data.author) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "text and author required" }));
        return;
      }
      if (data.text.length > 500) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "text too long" }));
        return;
      }

      const apiKey = (data.apiKey || "").trim();
      if (!apiKey) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: "API key required to post" }));
        return;
      }
      const postedBy = hashKey(apiKey);

      cleanupOld();
      const msgs = readDB();
      const cutoff = Date.now() - WEEK_MS;
      const recentCount = msgs.filter((m) => m.postedBy === postedBy && m.createdAt >= cutoff).length;
      if (recentCount >= MAX_POSTS_PER_WEEK) {
        res.writeHead(429);
        res.end(JSON.stringify({ error: "Post limit reached (5/week)" }));
        return;
      }

      const msg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        author: data.author.slice(0, 40),
        text: data.text.slice(0, 500),
        createdAt: Date.now(),
        upvotes: 0,
        postedBy,
      };
      msgs.push(msg);
      writeDB(msgs);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(msg));
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
    return;
  }

  // POST /api/messages/:id/upvote
  const upvoteMatch = pathname.match(/^\/api\/messages\/([^/]+)\/upvote$/);
  if (upvoteMatch && req.method === "POST") {
    const id = upvoteMatch[1];
    let bodyApiKey = "";
    try {
      const body = await parseBody(req);
      bodyApiKey = (body.apiKey || "").trim();
    } catch {}
    if (!bodyApiKey) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "API key required to upvote" }));
      return;
    }
    const hash = hashKey(bodyApiKey);
    const msgs = readDB();
    const msg = msgs.find((m) => m.id === id);
    if (!msg) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    msg.upvoters = msg.upvoters || [];
    if (msg.upvoters.includes(hash)) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: "already upvoted" }));
      return;
    }
    msg.upvoters.push(hash);
    msg.upvotes = (msg.upvotes || 0) + 1;
    writeDB(msgs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(msg));
    return;
  }

  // DELETE /api/messages/:id
  const deleteMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (deleteMatch && req.method === "DELETE") {
    const id = deleteMatch[1];
    let msgs = readDB();
    const idx = msgs.findIndex((m) => m.id === id);
    if (idx === -1) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    msgs.splice(idx, 1);
    writeDB(msgs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`News Desk server running on http://localhost:${PORT}`);
});
