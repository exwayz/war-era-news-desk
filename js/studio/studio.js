import { apiKey, fetchTrpcApi2, unwrap } from "../core/api.js";
import { E } from "../core/dom.js";
import { loadAll, saveMany } from "../library/libraryStore.js";
import { setCurrentArticle } from "../library/bookmarks.js";
import { openRootArticle } from "../ui/readerNav.js";
import { playRead } from "../audio/audio.js";

/* ═══════════════════════════════════════════════════════
   Newsroom Studio — War Era Journalist Analytics
   ═══════════════════════════════════════════════════════ */

const MAX_PAGES = 50;
const PAGE_SIZE = 100;
const ARTICLES_PER_PAGE = 20;
const TIP_VALUE = 5;
const TIP_FEE = 3;

function articleBtcRev(a) { return (a.tips || 0) * TIP_VALUE - ((a.tips || 0) > 0 ? TIP_FEE : 0); }
function articleGemRev(a) { return (a.gemTips || 0) * TIP_VALUE; }

let _data = null;
let _section = "overview";
let _sortCol = "views";
let _sortAsc = false;
let _detailId = null;
let _articlePage = 0;
let _timeframe = "all";
let _autoRefreshTimer = null;

function fmtN(v) {
  if (v == null || !isFinite(v)) return "—";
  const n = Number(v);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDays(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n < 1) return "<1 day";
  if (Math.round(n) === 1) return "1 day";
  return Math.round(n) + " days";
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ── Data Fetching ────────────────────────────────────── */

const CACHE_KEY = "wa-studio-analytics";
const CACHE_TTL = 30 * 60 * 1000;

function loadCachedAnalytics(userId) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { data: null, stale: true };
    const cached = JSON.parse(raw);
    if (cached.userId !== userId) return { data: null, stale: true };
    const stale = Date.now() - cached.ts > CACHE_TTL;
    return { data: cached.data, stale };
  } catch { return { data: null, stale: true }; }
}

function saveCachedAnalytics(userId, data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId, ts: Date.now(), data }));
  } catch {}
}

async function fetchArticlesFromApi(userId, k, onProgress) {
  if (onProgress) onProgress(0, 0, "api");
  const all = [];
  let cursor;
  let page = 0;
  while (page < MAX_PAGES) {
    const input = { type: "last", limit: PAGE_SIZE };
    if (cursor) input.cursor = cursor;
    try {
      const res = await fetchTrpcApi2("article.getArticlesPaginated", input, k);
      const data = unwrap(res);
      if (!data?.items?.length) break;
      for (const a of data.items) {
        if (a.author === userId) all.push(a);
      }
      cursor = data.nextCursor;
      if (!cursor) break;
      page++;
      if (onProgress) onProgress(page, all.length, "api");
    } catch (e) {
      console.warn("[Studio] fetch error:", e);
      break;
    }
  }
  return all;
}

async function fetchArticlesFromCache(userId) {
  const cached = await loadAll();
  return cached.filter(a => a.author === userId);
}

function hasStats(article) {
  const s = article.stats;
  if (!s) return false;
  return !!(s.views || s.likes || s.dislikes || s.tips || s.gemTips || s.comments || s.score);
}

async function backfillStats(articles, k, onProgress) {
  const needStats = articles.filter(a => !hasStats(a));
  if (!needStats.length) return articles;
  const enriched = [...articles];
  const map = new Map(enriched.map(a => [a._id, a]));
  const BATCH = 10;
  for (let i = 0; i < needStats.length; i += BATCH) {
    const batch = needStats.slice(i, i + BATCH);
    if (onProgress) onProgress(i, needStats.length);
    const results = await Promise.allSettled(
      batch.map(a => fetchTrpcApi2("article.getArticleById", { articleId: a._id }, k).then(r => unwrap(r)))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value?._id) {
        const full = r.value;
        const existing = map.get(full._id);
        if (existing) {
          existing.stats = full.stats || {};
        }
      }
    }
  }
  if (needStats.length) {
    try {
      const backfilled = needStats.filter(a => hasStats(a)).map(a => {
        const slim = { ...a };
        delete slim.content;
        return slim;
      });
      if (backfilled.length) await saveMany(backfilled);
    } catch {}
  }
  return enriched;
}

async function fetchAllArticles(userId, k, onProgress) {
  if (onProgress) onProgress(0, 0, "cache");
  let articles = await fetchArticlesFromCache(userId);

  if (!articles.length) {
    articles = await fetchArticlesFromApi(userId, k, onProgress);
  }

  if (articles.length) {
    articles = await backfillStats(articles, k, onProgress);
  }
  return articles;
}

async function fetchFreshProfile(userId, k) {
  try {
    const r = await fetchTrpcApi2("user.getUserLite", { userId }, k);
    const u = unwrap(r);
    if (u) {
      const sub = u.rankings?.userSubscribers || {};
      return { subscribers: sub.value ?? 0, subscriberRank: sub.rank ?? null, subscriberTier: sub.tier ?? null, username: u.username || u.name, avatarUrl: u.avatarUrl || u.avatar };
    }
  } catch {}
  return null;
}

/* ── Analytics ────────────────────────────────────────── */

function computePublishing(sorted) {
  if (sorted.length < 2) {
    return { articlesPerWeek: 0, articlesPerMonth: 0, avgGap: null, weeklyData: buildWeeklyData([]) };
  }
  const dates = sorted.map(a => new Date(a.publishedAt || a.createdAt).getTime()).filter(t => isFinite(t));
  if (dates.length < 2) {
    return { articlesPerWeek: 0, articlesPerMonth: 0, avgGap: null, weeklyData: buildWeeklyData(dates) };
  }
  const totalSpan = dates[dates.length - 1] - dates[0];
  const totalDays = totalSpan / 86400000;
  const totalWeeks = Math.max(totalDays / 7, 1);
  const totalMonths = Math.max(totalDays / 30, 1);
  let gapSum = 0;
  for (let i = 1; i < dates.length; i++) gapSum += dates[i] - dates[i - 1];
  return {
    articlesPerWeek: sorted.length / totalWeeks,
    articlesPerMonth: sorted.length / totalMonths,
    avgGap: gapSum / (dates.length - 1) / 86400000,
    weeklyData: buildWeeklyData(dates),
  };
}

function buildWeeklyData(dates) {
  const now = Date.now();
  const weekMs = 7 * 86400000;
  const start = now - 52 * weekMs;
  const data = [];
  for (let w = 0; w < 52; w++) {
    const wStart = start + w * weekMs;
    data.push({ week: w, count: dates.filter(t => t >= wStart && t < wStart + weekMs).length });
  }
  return data;
}

function classifyArticle(a, m) {
  const cls = [];
  if (a.views > m.avgViews * 2) cls.push("High Reach");
  if (a.views > 0 && a.engagementRate > m.avgEngagement * 2) cls.push("High Engagement");
  if (a.views > 0 && a.comments / a.views > m.avgCommentRate * 2 / 100) cls.push("Discussion Driver");
  if ((a.tips + a.gemTips) > m.avgTips * 2) cls.push("Revenue Driver");
  if (a.reactions > 0 && a.dislikes / a.reactions > 0.3) cls.push("Polarizing");
  return cls;
}

function computeMetrics(articles, profile) {
  const n = articles.length;
  if (!n) return null;
  let totalViews = 0, totalLikes = 0, totalDislikes = 0, totalScore = 0;
  let totalComments = 0, totalTips = 0, totalGemTips = 0;
  for (const a of articles) {
    const s = a.stats || {};
    totalViews += s.views || 0;
    totalLikes += s.likes || 0;
    totalDislikes += s.dislikes || 0;
    totalScore += s.score || 0;
    totalComments += s.comments || 0;
    totalTips += s.tips || 0;
    totalGemTips += s.gemTips || 0;
  }
  const avgViews = totalViews / n;
  const avgScore = totalScore / n;
  const avgComments = totalComments / n;
  const avgTips = (totalTips + totalGemTips) / n;
  const reactions = totalLikes + totalDislikes;
  const engagementRate = totalViews ? (reactions + totalComments) / totalViews * 100 : 0;
  const reactionRate = totalViews ? reactions / totalViews * 100 : 0;
  const commentRate = totalViews ? totalComments / totalViews * 100 : 0;
  const subscriberCount = profile?.subscribers ?? 0;
  const subscriberRank = profile?.subscriberRank ?? null;
  const subscriberTier = profile?.subscriberTier ?? null;
  const sorted = [...articles].sort((a, b) => new Date(a.publishedAt || a.createdAt) - new Date(b.publishedAt || b.createdAt));
  const publishing = computePublishing(sorted);

  const articleMetrics = articles.map(a => {
    const s = a.stats || {};
    const views = s.views || 0;
    const likes = s.likes || 0;
    const dislikes = s.dislikes || 0;
    const comments = s.comments || 0;
    const tips = s.tips || 0;
    const gemTips = s.gemTips || 0;
    const score = s.score || (likes - dislikes);
    const rx = likes + dislikes;
    return {
      ...a, views, likes, dislikes, score, comments, tips, gemTips, reactions: rx, subs: s.subs || 0,
      engagementRate: views ? (rx + comments) / views * 100 : 0,
      reactionRate: views ? rx / views * 100 : 0,
      commentRate: views ? comments / views * 100 : 0,
      classifications: [],
    };
  });

  const clsCtx = { avgViews, avgEngagement: engagementRate, avgCommentRate: commentRate, avgTips };
  for (const am of articleMetrics) am.classifications = classifyArticle(am, clsCtx);

  const tippedArticles = articleMetrics.filter(a => (a.tips + a.gemTips) > 0).length;
  const totalBtcRev = Math.max(0, totalTips * TIP_VALUE - tippedArticles * TIP_FEE);
  const totalGemRev = totalGemTips * TIP_VALUE;

  return {
    articles: sorted, articleMetrics, totalArticles: n,
    totalViews, totalLikes, totalDislikes, totalScore, totalComments,
    totalTips, totalGemTips,
    totalBtcRevenue: totalBtcRev,
    totalGemRevenue: totalGemRev,
    avgViews, avgScore, avgComments,
    avgBtcRevenue: n ? totalBtcRev / n : 0,
    avgGemRevenue: n ? totalGemRev / n : 0,
    reactions, engagementRate, reactionRate, commentRate,
    subscriberCount, subscriberRank, subscriberTier, publishing,
  };
}

function generateInsights(m) {
  if (!m || m.totalArticles < 2) return [];
  const ins = [];
  const topView = [...m.articleMetrics].sort((a, b) => b.views - a.views)[0];
  if (topView?.views > 0) ins.push({ icon: "mdi:eye-outline", color: "st-ic-yellow", text: `"${topView.title}" generated the highest views (${fmtN(topView.views)}).` });
  const topEng = [...m.articleMetrics].sort((a, b) => b.engagementRate - a.engagementRate)[0];
  if (topEng?.engagementRate > 0) ins.push({ icon: "mdi:comment-processing-outline", color: "st-ic-red", text: `"${topEng.title}" had the strongest engagement rate (${topEng.engagementRate.toFixed(1)}%).` });
  const topTip = [...m.articleMetrics].sort((a, b) => (b.tips + b.gemTips) - (a.tips + a.gemTips))[0];
  if (topTip && (topTip.tips + topTip.gemTips) > 0) ins.push({ icon: "boxicons:coin-filled", color: "st-ic-gold", text: `"${topTip.title}" generated the most tips (${fmtN(articleBtcRev(topTip) + articleGemRev(topTip))} units).` });
  const topCom = [...m.articleMetrics].sort((a, b) => b.comments - a.comments)[0];
  if (topCom?.comments > 0) ins.push({ icon: "mdi:forum-outline", color: "st-ic-cyan", text: `"${topCom.title}" generated the most discussion (${topCom.comments} comments).` });
  if (m.publishing.articlesPerWeek > 0) ins.push({ icon: "mdi:calendar-clock", color: "st-ic-orange", text: `Publishing at ${m.publishing.articlesPerWeek.toFixed(1)} articles per week.` });
  return ins;
}

function computeHealth(m) {
  if (!m || m.totalArticles === 0) return null;
  const clamp = v => Math.max(0, Math.min(100, v));
  const engScore = clamp(m.engagementRate * 5) * 0.25;
  const reachScore = clamp(m.avgViews / 10) * 0.25;
  const pubScore = clamp(m.publishing.articlesPerWeek * 50) * 0.25;
  const revScore = clamp((m.totalBtcRevenue + m.totalGemRevenue) / m.totalArticles) * 0.25;
  const total = Math.round(engScore + reachScore + pubScore + revScore);
  const level = total >= 85 ? "Excellent" : total >= 70 ? "Strong" : total >= 50 ? "Healthy" : total >= 30 ? "Weak" : "Critical";
  return { score: total, level, eng: Math.round(engScore / 0.25), reach: Math.round(reachScore / 0.25), pub: Math.round(pubScore / 0.25), rev: Math.round(revScore / 0.25) };
}

function healthColor(pct) { return pct >= 75 ? "var(--st-green)" : pct >= 35 ? "var(--st-yellow)" : "var(--st-red)"; }

/* ── Rendering Helpers ────────────────────────────────── */

function mCard(label, value, icon, colorClass = "") {
  return `<div class="st-metric"><div class="st-metric-label"><iconify-icon icon="${icon}" class="lu${colorClass ? " " + colorClass : ""}"></iconify-icon> ${label}</div><div class="st-metric-value">${value}</div></div>`;
}

function barChart(data) {
  if (!data.length) return `<p style="color:var(--st-ink-dim);padding:20px;text-align:center">No data.</p>`;
  const vals = data.map(d => Number(d.value) || 0);
  const max = Math.max(...vals, 1);
  const hasNonZero = vals.some(v => v > 0);
  if (!hasNonZero) return `<p style="color:var(--st-ink-dim);padding:20px;text-align:center">All values are zero for this period.</p>`;
  return `<div class="st-bar-chart">${data.map((d, i) => {
    const v = vals[i];
    const pct = max > 0 ? Math.max(2, (v / max) * 100) : 2;
    return `<div class="st-bar-col" title="${esc(d.label)}: ${v}"><div class="st-bar" style="height:${pct}%"></div></div>`;
  }).join("")}</div>`;
}

function areaChart(articles) {
  if (!articles.length) return `<p style="color:var(--st-ink-dim);padding:20px;text-align:center">No data.</p>`;

  const weekMap = new Map();
  for (const a of articles) {
    const d = new Date(a.publishedAt || a.createdAt);
    if (isNaN(d.getTime())) continue;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const key = weekStart.toISOString().slice(0, 10);
    const existing = weekMap.get(key) || { views: 0, tips: 0, engagement: 0, count: 0, date: weekStart };
    existing.views += a.views || 0;
    existing.tips += (a.tips || 0) + (a.gemTips || 0);
    existing.engagement += a.engagementRate || 0;
    existing.count++;
    weekMap.set(key, existing);
  }

  const weeks = [...weekMap.values()].sort((a, b) => a.date - b.date);
  if (!weeks.length) return `<p style="color:var(--st-ink-dim);padding:20px;text-align:center">No date data available.</p>`;

  const W = 600, H = 200, PAD_L = 45, PAD_B = 28, PAD_T = 30, PAD_R = 10;
  const cW = W - PAD_L - PAD_R;
  const cH = H - PAD_T - PAD_B;
  const maxVal = Math.max(...weeks.map(w => w.views), 1);

  const points = weeks.map((w, i) => {
    const x = PAD_L + (i / Math.max(weeks.length - 1, 1)) * cW;
    const y = PAD_T + cH - (w.views / maxVal) * cH;
    return { x, y, views: w.views, tips: w.tips, engagement: w.engagement, count: w.count, date: w.date };
  });

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = line + ` L${points[points.length - 1].x.toFixed(1)},${PAD_T + cH} L${points[0].x.toFixed(1)},${PAD_T + cH} Z`;

  const yTicks = 4;
  const yLines = [];
  const yLabels = [];
  for (let i = 0; i <= yTicks; i++) {
    const val = Math.round((maxVal / yTicks) * i);
    const y = PAD_T + cH - (val / maxVal) * cH;
    yLines.push(`<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="var(--st-line)" stroke-width="0.5" opacity="0.4"/>`);
    yLabels.push(`<text x="${PAD_L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--st-ink-dim)" font-size="9">${fmtN(val)}</text>`);
  }

  const xLabels = [];
  const maxLabels = Math.min(points.length, 8);
  const step = Math.max(1, Math.floor(points.length / maxLabels));
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const lbl = p.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    xLabels.push(`<text x="${p.x.toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="var(--st-ink-dim)" font-size="8">${lbl}</text>`);
  }
  if (points.length > 1 && (points.length - 1) % step !== 0) {
    const p = points[points.length - 1];
    const lbl = p.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    xLabels.push(`<text x="${p.x.toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="var(--st-ink-dim)" font-size="8">${lbl}</text>`);
  }

  const ptsJson = esc(JSON.stringify(points.map(p => ({ x: p.x, y: p.y, views: p.views, tips: p.tips, count: p.count, engagement: p.engagement, date: p.date.toISOString() }))));

  return `<div class="st-chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" class="st-area-chart" preserveAspectRatio="xMidYMid meet" data-points='${ptsJson}'>
      <defs>
        <linearGradient id="stAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--st-cyan)" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="var(--st-cyan)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${yLines.join("")}${yLabels.join("")}${xLabels.join("")}
      <path d="${area}" fill="url(#stAreaGrad)"/>
      <path d="${line}" fill="none" stroke="var(--st-cyan)" stroke-width="2" stroke-linejoin="round"/>
      <line class="st-crosshair" x1="0" y1="${PAD_T}" x2="0" y2="${PAD_T + cH}" stroke="var(--st-ink-dim)" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>
      <circle class="st-crossdot" cx="0" cy="0" r="5" fill="var(--st-cyan)" stroke="var(--st-bg)" stroke-width="2" opacity="0"/>
      <rect x="${PAD_L}" y="${PAD_T}" width="${cW}" height="${cH}" fill="transparent" class="st-chart-hover-area"/>
    </svg>
    <div class="st-cross-label" style="display:none"></div>
  </div>`;
}

/* ── Chart Crosshair ──────────────────────────────────── */

let _chartTooltip = null;

function initChartTooltips(container) {
  const svg = container.querySelector(".st-area-chart");
  if (!svg) return;

  const ptsRaw = svg.dataset.points;
  if (!ptsRaw) return;
  let pts;
  try { pts = JSON.parse(ptsRaw); } catch { return; }
  if (!pts.length) return;

  pts.forEach(p => { p.date = new Date(p.date); });

  const crosshair = svg.querySelector(".st-crosshair");
  const crossdot = svg.querySelector(".st-crossdot");
  const hoverArea = svg.querySelector(".st-chart-hover-area");

  const crossLabel = svg.closest(".st-chart-wrap").querySelector(".st-cross-label");
  if (crossLabel && crossLabel.parentElement !== document.body) {
    document.body.appendChild(crossLabel);
  }

  if (!_chartTooltip) {
    _chartTooltip = document.createElement("div");
    _chartTooltip.className = "st-chart-tip";
    _chartTooltip.style.cssText = "display:none;position:fixed;z-index:100003;padding:6px 10px;border-radius:6px;background:var(--st-surface-hi);border:1px solid var(--st-line);color:var(--st-ink);font-size:.72rem;line-height:1.5;pointer-events:none;white-space:pre-wrap;max-width:240px;box-shadow:0 4px 12px rgba(0,0,0,.25)";
    document.body.appendChild(_chartTooltip);
  }

  const vb = svg.viewBox.baseVal;

  function getSVGPoint(e) {
    const rect = svg.getBoundingClientRect();
    const scaleX = vb.width / rect.width;
    const scaleY = vb.height / rect.height;
    return { sx: (e.clientX - rect.left) * scaleX, sy: (e.clientY - rect.top) * scaleY };
  }

  function findNearest(sx) {
    let best = pts[0], bestDist = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.x - sx);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  function showCrosshair(pt) {
    crosshair.setAttribute("x1", pt.x.toFixed(1));
    crosshair.setAttribute("x2", pt.x.toFixed(1));
    crosshair.setAttribute("opacity", "0.5");
    crossdot.setAttribute("cx", pt.x.toFixed(1));
    crossdot.setAttribute("cy", pt.y.toFixed(1));
    crossdot.setAttribute("opacity", "1");

    const label = fmtN(pt.views);
    crossLabel.textContent = label;
    const svgRect = svg.getBoundingClientRect();
    const scaleX = svgRect.width / vb.width;
    const scaleY = svgRect.height / vb.height;
    const labelX = svgRect.left + pt.x * scaleX;
    const labelY = svgRect.top + pt.y * scaleY;
    crossLabel.style.display = "block";
    crossLabel.style.left = labelX + "px";
    crossLabel.style.top = (labelY - 8) + "px";

    const avgEng = pt.count ? (pt.engagement / pt.count).toFixed(1) : "0";
    const tips = pt.tips * TIP_VALUE;
    const dateStr = pt.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const info = `${dateStr}\nViews: ${fmtN(pt.views)}\nArticles: ${pt.count}\nEngagement: ${avgEng}%\nTips: ${fmtN(tips)}`;
    _chartTooltip.textContent = info;
    _chartTooltip.style.display = "block";
  }

  function hideCrosshair() {
    crosshair.setAttribute("opacity", "0");
    crossdot.setAttribute("opacity", "0");
    crossLabel.style.display = "none";
    if (_chartTooltip) _chartTooltip.style.display = "none";
  }

  function moveTooltip(e) {
    if (!_chartTooltip) return;
    const x = Math.min(e.clientX + 14, window.innerWidth - 250);
    const y = Math.max(e.clientY - 70, 4);
    _chartTooltip.style.left = x + "px";
    _chartTooltip.style.top = y + "px";
  }

  hoverArea.addEventListener("mousemove", e => {
    const { sx } = getSVGPoint(e);
    const pt = findNearest(sx);
    showCrosshair(pt);
    moveTooltip(e);
  });

  hoverArea.addEventListener("mouseleave", hideCrosshair);
}

/* ── Studio Calendar Tooltip ──────────────────────────── */

let _calTip = null;

function initCalendarTooltips(container) {
  const cells = container.querySelectorAll(".st-cal-cell[data-tip]");
  if (!cells.length) return;

  if (!_calTip) {
    _calTip = document.createElement("div");
    _calTip.className = "st-cal-tip";
    _calTip.style.display = "none";
    document.body.appendChild(_calTip);
  }

  cells.forEach(cell => {
    cell.addEventListener("mouseenter", e => {
      _calTip.textContent = cell.dataset.tip;
      _calTip.style.display = "block";
      const r = cell.getBoundingClientRect();
      _calTip.style.left = (r.left + r.width / 2) + "px";
      _calTip.style.top = (r.top - 6) + "px";
    });
    cell.addEventListener("mouseleave", () => { _calTip.style.display = "none"; });
  });
}

/* ── Section Renderers ────────────────────────────────── */

function renderOverview(el) {
  const m = _data.metrics;
  const p = _data.profile;
  const health = computeHealth(m);
  const insights = generateInsights(m);
  const now = Date.now();
  const cutoffMap = { "7d": 7 * 864e5, "30d": 30 * 864e5, "90d": 90 * 864e5, "1y": 365 * 864e5 };
  const cutoff = cutoffMap[_timeframe] || 0;
  const fa = cutoff ? m.articleMetrics.filter(a => new Date(a.publishedAt || a.createdAt).getTime() >= now - cutoff) : m.articleMetrics;
  const fTotalViews = fa.reduce((s, a) => s + a.views, 0);
  const fTippedArticles = fa.filter(a => (a.tips + a.gemTips) > 0).length;
  const fTotalTips = Math.max(0, fa.reduce((s, a) => s + a.tips, 0) * TIP_VALUE - fTippedArticles * TIP_FEE);
  const fTotalGem = fa.reduce((s, a) => s + a.gemTips, 0) * TIP_VALUE;
  const fEng = fa.length ? fa.reduce((s, a) => s + a.engagementRate, 0) / fa.length : 0;

  const healthScoreColor = health ? (health.score >= 70 ? "var(--st-green)" : health.score >= 35 ? "var(--st-yellow)" : "var(--st-red)") : "var(--st-ink-dim)";
  const healthStrokeColor = health ? (health.score >= 70 ? "#16a34a" : health.score >= 35 ? "#ca8a04" : "#dc2626") : "rgba(0,0,0,.35)";
  const profileUsername = p?.username || "Unknown";
  const profileUrl = p?.userId ? `https://app.warera.io/user/${esc(p.userId)}` : "#";

  el.innerHTML = `
    <div class="st-profile">
      <div class="st-profile-avatar-wrap">
        ${p?.avatarUrl
          ? `<img class="st-profile-avatar" src="${esc(p.avatarUrl)}" alt="" loading="lazy">`
          : `<div class="st-profile-avatar-placeholder">${profileUsername.charAt(0).toUpperCase()}</div>`}
        ${health ? `<div class="st-profile-rate-badge" style="color:${healthScoreColor};--st-badge-stroke:${healthStrokeColor}">${health.score}</div>` : ""}
      </div>
      <a class="st-profile-username" href="${profileUrl}" target="_blank" rel="noopener" style="color:${healthScoreColor}">${esc(profileUsername)}</a>
    </div>
    <div class="st-grid st-grid-4">
      ${mCard("Total Articles", fa.length, "mdi:newspaper-variant-outline", "st-ic-cyan")}
      ${mCard("Total Views", fmtN(fTotalViews), "mdi:eye-outline", "st-ic-yellow")}
      ${mCard("Avg Views / Article", fmtN(fa.length ? fTotalViews / fa.length : 0), "mdi:chart-line", "st-ic-green")}
      ${mCard("Engagement Rate", fEng.toFixed(1) + "%", "mdi:heart-outline", "st-ic-red")}
      ${mCard("Subscribers", fmtN(m.subscriberCount), "mdi:signal-variant", "st-ic-lime")}
      ${mCard("BTC Tips", fmtN(fTotalTips), "boxicons:coin-filled", "st-ic-gold")}
      ${mCard("Gem Tips", fmtN(fTotalGem), "mage:gem-a", "st-ic-indigo")}
      ${mCard("Publishing Freq", m.publishing.articlesPerWeek.toFixed(1) + "/wk", "mdi:calendar-clock", "st-ic-orange")}
    </div>
    <div class="st-section-head">Performance
      <div class="st-timeframe">${["7d","30d","90d","1y","all"].map(tf =>
        `<button class="pill-btn${_timeframe === tf ? " active" : ""}" data-tf="${tf}">${tf === "all" ? "All Time" : tf.toUpperCase()}</button>`
      ).join("")}</div>
    </div>
    <div class="st-chart-area">${areaChart(fa)}</div>
    ${health ? `<div class="st-health">
      <div class="st-health-score" style="color:${health.score >= 70 ? "var(--st-green)" : health.score >= 35 ? "var(--st-yellow)" : "var(--st-red)"}">
        <span class="st-health-num">${health.score}</span><span class="st-health-label">${health.level}</span>
      </div>
      <div class="st-health-bars">
        <div class="st-hbar-row"><span>Engagement</span><div class="st-hbar"><div style="width:${health.eng}%;background:${healthColor(health.eng)}"></div></div><span>${health.eng}</span></div>
        <div class="st-hbar-row"><span>Reach</span><div class="st-hbar"><div style="width:${health.reach}%;background:${healthColor(health.reach)}"></div></div><span>${health.reach}</span></div>
        <div class="st-hbar-row"><span>Consistency</span><div class="st-hbar"><div style="width:${health.pub}%;background:${healthColor(health.pub)}"></div></div><span>${health.pub}</span></div>
        <div class="st-hbar-row"><span>Revenue</span><div class="st-hbar"><div style="width:${health.rev}%;background:${healthColor(health.rev)}"></div></div><span>${health.rev}</span></div>
      </div>
      <div class="st-health-tip">Composite indicator based on engagement, reach, publishing consistency, and revenue. Not an official War Era statistic.</div>
    </div>` : ""}
    ${insights.length ? `<div class="st-section-head">Insights</div><div class="st-insights">${insights.map(i =>
      `<div class="st-insight"><iconify-icon icon="${i.icon}" class="st-insight-icon${i.color ? " " + i.color : ""}"></iconify-icon> ${i.text}</div>`
    ).join("")}</div>` : ""}
  `;
  el.querySelectorAll("[data-tf]").forEach(b => b.addEventListener("click", () => { _timeframe = b.dataset.tf; renderSection(); }));
  initChartTooltips(el);
}

function renderArticles(el) {
  const m = _data.metrics;
  let arts = [...m.articleMetrics];
  arts.sort((a, b) => {
    let va = a[_sortCol], vb = b[_sortCol];
    if (typeof va === "string") { va = (va || "").toLowerCase(); vb = (vb || "").toLowerCase(); }
    if (_sortCol === "publishedAt") {
      va = new Date(a.publishedAt || a.createdAt).getTime() || 0;
      vb = new Date(b.publishedAt || b.createdAt).getTime() || 0;
    }
    return _sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });
  const totalPages = Math.ceil(arts.length / ARTICLES_PER_PAGE);
  const start = _articlePage * ARTICLES_PER_PAGE;
  const page = arts.slice(start, start + ARTICLES_PER_PAGE);
  const arrow = col => _sortCol === col ? (_sortAsc ? " \u25B2" : " \u25BC") : "";

  el.innerHTML = `
    <div class="st-table-wrap"><table class="st-table">
      <thead><tr>
        <th data-sort="title">Article</th>
        <th data-sort="publishedAt">Published${arrow("publishedAt")}</th>
        <th data-sort="views">Views${arrow("views")}</th>
        <th data-sort="score">Score${arrow("score")}</th>
        <th data-sort="comments">Comments${arrow("comments")}</th>
        <th data-sort="tips">Revenue${arrow("tips")}</th>
        <th data-sort="engagementRate">Engagement${arrow("engagementRate")}</th>
      </tr></thead>
      <tbody>${page.map(a => `<tr class="st-row" data-id="${a._id || a.id}">
        <td class="st-title-cell">${esc(a.title || "Untitled")}${a.classifications?.length ? `<span class="st-inline-badges">${a.classifications.map(c => `<span class="st-badge">${c}</span>`).join("")}</span>` : ""}</td>
        <td>${fmtDate(a.publishedAt || a.createdAt)}</td>
        <td>${fmtN(a.views)}</td>
        <td>${fmtN(a.score)}</td>
        <td>${fmtN(a.comments)}</td>
        <td>${fmtN(articleBtcRev(a) + articleGemRev(a))}</td>
        <td>${a.engagementRate.toFixed(1)}%</td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${totalPages > 1 ? `<div class="st-pager">
      <button class="btn-secondary" id="stPrev" ${_articlePage === 0 ? "disabled" : ""}>\u2190 Prev</button>
      <span>${_articlePage + 1} / ${totalPages}</span>
      <button class="btn-secondary" id="stNext" ${_articlePage >= totalPages - 1 ? "disabled" : ""}>Next \u2192</button>
    </div>` : ""}
  `;
  el.querySelectorAll("th[data-sort]").forEach(th => th.addEventListener("click", () => {
    const c = th.dataset.sort;
    if (_sortCol === c) _sortAsc = !_sortAsc; else { _sortCol = c; _sortAsc = false; }
    renderSection();
  }));
  el.querySelectorAll(".st-row").forEach(r => r.addEventListener("click", () => { _detailId = r.dataset.id; _section = "detail"; renderSection(); }));
  document.getElementById("stPrev")?.addEventListener("click", () => { _articlePage--; renderSection(); });
  document.getElementById("stNext")?.addEventListener("click", () => { _articlePage++; renderSection(); });
}

function renderDetail(el) {
  const a = _data.metrics.articleMetrics.find(x => (x._id || x.id) === _detailId);
  if (!a) { el.innerHTML = `<p>Article not found.</p>`; return; }
  el.innerHTML = `
    <button class="btn-secondary st-back" id="stDetailBack">\u2190 Back to Articles</button>
    <h3 class="st-detail-title">${esc(a.title || "Untitled")}</h3>
    <div class="st-grid st-grid-4">
      ${mCard("Views", fmtN(a.views), "mdi:eye-outline", "st-ic-yellow")}
      ${mCard("Likes", fmtN(a.likes), "mdi:thumb-up-outline", "st-ic-green")}
      ${mCard("Dislikes", fmtN(a.dislikes), "mdi:thumb-down-outline", "st-ic-red")}
      ${mCard("Score", fmtN(a.score), "mdi:star-outline", "st-ic-gold")}
      ${mCard("Comments", fmtN(a.comments), "mdi:comment-outline", "st-ic-cyan")}
      ${mCard("BTC Revenue", fmtN(articleBtcRev(a)), "boxicons:coin-filled", "st-ic-gold")}
      ${mCard("Gem Revenue", fmtN(articleGemRev(a)), "mage:gem-a", "st-ic-indigo")}
      ${mCard("Engagement Rate", a.engagementRate.toFixed(1) + "%", "mdi:chart-line", "st-ic-red")}
      ${mCard("Reaction Rate", a.reactionRate.toFixed(1) + "%", "mdi:heart-outline", "st-ic-red")}
      ${mCard("Comment Rate", a.commentRate.toFixed(1) + "%", "mdi:forum-outline", "st-ic-cyan")}
      ${mCard("Published", fmtDate(a.publishedAt || a.createdAt), "mdi:calendar", "st-ic-orange")}
      ${mCard("Subscribers", fmtN(a.subs || 0), "mdi:signal-variant", "st-ic-lime")}
    </div>
    ${a.classifications?.length ? `<div class="st-badges">${a.classifications.map(c => `<span class="st-badge">${c}</span>`).join("")}</div>` : ""}
    <button class="btn-primary st-read-btn" id="stReadArticle"><iconify-icon icon="mdi:book-open-page-variant-outline"></iconify-icon> Read Article</button>
  `;
  document.getElementById("stDetailBack")?.addEventListener("click", () => { _section = "articles"; _detailId = null; renderSection(); });
  document.getElementById("stReadArticle")?.addEventListener("click", async () => {
    const btn = document.getElementById("stReadArticle");
    if (btn) { btn.disabled = true; btn.textContent = "Loading..."; }
    try {
      const res = await fetchTrpcApi2("article.getArticleById", { articleId: a._id || a.id }, apiKey());
      const full = unwrap(res);
      if (full) {
        setCurrentArticle(full);
        openRootArticle(full);
        E.readerModal.classList.remove("hidden");
        playRead();
      }
    } catch (e) {
      console.warn("[Studio] Failed to load article:", e);
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<iconify-icon icon="mdi:book-open-page-variant-outline"></iconify-icon> Read Article'; }
  });
}

function renderAudience(el) {
  const m = _data.metrics;
  el.innerHTML = `
    <div class="st-grid st-grid-3">
      ${mCard("Total Subscribers", fmtN(m.subscriberCount), "mdi:signal-variant", "st-ic-lime")}
      ${mCard("Subscriber Rank", m.subscriberRank ? "#" + m.subscriberRank : "\u2014", "mdi:trophy-outline", "st-ic-gold")}
      ${mCard("Subscriber Tier", m.subscriberTier ? m.subscriberTier.charAt(0).toUpperCase() + m.subscriberTier.slice(1) : "\u2014", "mdi:medal-outline", "st-ic-indigo")}
    </div>
    <div class="st-section-head">Subscriber Performance</div>
    <div class="st-grid st-grid-3">
      ${mCard("Total Articles", m.totalArticles, "mdi:newspaper-variant-outline", "st-ic-cyan")}
      ${mCard("Avg Views / Article", fmtN(m.avgViews), "mdi:eye-outline", "st-ic-yellow")}
      ${mCard("Avg Comments / Article", m.avgComments.toFixed(1), "mdi:comment-outline", "st-ic-green")}
    </div>
    <div class="st-section-head">Top Articles by Views</div>
    <div class="st-list">${[...m.articleMetrics].sort((a, b) => b.views - a.views).slice(0, 10).map((a, i) =>
      `<div class="st-list-item"><span class="st-list-rank">#${i + 1}</span><span class="st-list-title">${esc(a.title || "Untitled")}</span><span class="st-list-val">${fmtN(a.views)} views</span></div>`
    ).join("")}</div>
  `;
}

function renderRevenue(el) {
  const m = _data.metrics;
  el.innerHTML = `
    <div class="st-grid st-grid-3">
      ${mCard("Total BTC Revenue", fmtN(m.totalBtcRevenue), "boxicons:coin-filled", "st-ic-gold")}
      ${mCard("Total Gem Revenue", fmtN(m.totalGemRevenue), "mage:gem-a", "st-ic-indigo")}
      ${mCard("Avg Revenue / Article", fmtN(m.avgBtcRevenue + m.avgGemRevenue), "mdi:chart-line", "st-ic-green")}
    </div>
    <div class="st-section-head">Top Earning Articles</div>
    <div class="st-list">${[...m.articleMetrics].sort((a, b) => (articleBtcRev(b) + articleGemRev(b)) - (articleBtcRev(a) + articleGemRev(a))).filter(a => (a.tips + a.gemTips) > 0).slice(0, 10).map((a, i) =>
      `<div class="st-list-item"><span class="st-list-rank">#${i + 1}</span><span class="st-list-title">${esc(a.title || "Untitled")}</span><span class="st-list-val">${fmtN(articleBtcRev(a))} BTC \u00B7 ${fmtN(articleGemRev(a))} Gem</span></div>`
    ).join("")}</div>
    ${m.totalBtcRevenue === 0 && m.totalGemRevenue === 0 ? `<p style="color:var(--st-ink-dim);padding:20px;text-align:center">No tips recorded for this journalist.</p>` : ""}
  `;
}

function renderPublishing(el) {
  const m = _data.metrics;
  el.innerHTML = `
    <div class="st-grid st-grid-3">
      ${mCard("Total Articles", m.totalArticles, "mdi:newspaper-variant-outline", "st-ic-cyan")}
      ${mCard("Articles / Week", m.publishing.articlesPerWeek.toFixed(1), "mdi:calendar-week", "st-ic-orange")}
      ${mCard("Articles / Month", m.publishing.articlesPerMonth.toFixed(1), "mdi:calendar-month", "st-ic-orange")}
    </div>
    ${m.publishing.avgGap != null ? `<div class="st-grid st-grid-2" style="margin-top:8px">
      ${mCard("Avg Publishing Gap", fmtDays(m.publishing.avgGap), "mdi:timer-sand", "st-ic-yellow")}
    </div>` : ""}
    <div class="st-section-head">Publishing Activity (Last 52 Weeks)</div>
    <div class="st-calendar">${m.publishing.weeklyData.map(w => {
      const maxC = Math.max(...m.publishing.weeklyData.map(x => x.count), 1);
      const intensity = w.count / maxC;
      const bg = w.count === 0 ? "var(--st-surface-hi)" : `color-mix(in srgb, var(--st-cyan) ${Math.round(20 + intensity * 80)}%, transparent)`;
      return `<div class="st-cal-cell" style="background:${bg}" data-tip="${w.count} article${w.count !== 1 ? "s" : ""}"></div>`;
    }).join("")}</div>
    <div class="st-section-head">Recent Articles</div>
    <div class="st-list">${m.articles.slice(-10).reverse().map(a =>
      `<div class="st-list-item"><span class="st-list-title">${esc(a.title || "Untitled")}</span><span class="st-list-val">${fmtDate(a.publishedAt || a.createdAt)}</span></div>`
    ).join("")}</div>
  `;
  initCalendarTooltips(el);
}

/* ── Main Render ──────────────────────────────────────── */

function renderSection() {
  if (!_data?.metrics) return;
  const el = document.getElementById("studioContent");
  if (!el) return;
  switch (_section) {
    case "overview": renderOverview(el); break;
    case "articles": renderArticles(el); break;
    case "detail": renderDetail(el); break;
    case "audience": renderAudience(el); break;
    case "revenue": renderRevenue(el); break;
    case "publishing": renderPublishing(el); break;
  }
  document.querySelectorAll("#studioTabs .pill-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === _section));
}

/* ── Public API ───────────────────────────────────────── */

export function initStudio() {
  document.getElementById("closeStudioBtn")?.addEventListener("click", closeStudio);
  document.getElementById("studioModal")?.addEventListener("click", e => { if (e.target.id === "studioModal") closeStudio(); });
  document.getElementById("studioTabs")?.addEventListener("click", e => {
    const btn = e.target.closest("[data-tab]");
    if (btn) { _section = btn.dataset.tab; _detailId = null; _articlePage = 0; renderSection(); }
  });
}

function closeStudio() {
  document.getElementById("studioModal")?.classList.add("hidden");
  if (_chartTooltip) _chartTooltip.style.display = "none";
  if (_calTip) _calTip.style.display = "none";
  const orphan = document.querySelector(".st-cross-label");
  if (orphan) orphan.style.display = "none";
  if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
  _section = "overview";
  _detailId = null;
}

const REFRESH_INTERVAL = 5 * 60 * 1000;

function updateRefreshTimestamp() {
  const el = document.getElementById("studioLastRefresh");
  if (el) el.textContent = "Updated " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function startAutoRefresh(userId, profileData, k, modal, content) {
  if (_autoRefreshTimer) clearInterval(_autoRefreshTimer);
  _autoRefreshTimer = setInterval(() => {
    if (modal.classList.contains("hidden")) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; return; }
    refreshStudioData(userId, profileData, k, modal, content, true);
  }, REFRESH_INTERVAL);
}

export async function openStudio(userId, profileData) {
  const modal = document.getElementById("studioModal");
  const content = document.getElementById("studioContent");
  if (!modal || !content) return;

  _section = "overview";
  _timeframe = "all";
  _detailId = null;
  _articlePage = 0;

  document.querySelectorAll("#studioTabs .pill-btn").forEach(b => b.classList.remove("active"));
  document.querySelector('#studioTabs .pill-btn[data-tab="overview"]')?.classList.add("active");

  modal.classList.remove("hidden");
  content.innerHTML = `<div class="st-loading"><iconify-icon icon="mdi:loading" class="nd-spin"></iconify-icon><p>Loading profile analytics...</p></div>`;

  _data = { userId, profile: profileData };
  const k = apiKey();

  const head = modal.querySelector(".st-head");
  let refreshBtn = head.querySelector("#studioRefreshBtn");
  if (!refreshBtn) {
    refreshBtn = document.createElement("button");
    refreshBtn.id = "studioRefreshBtn";
    refreshBtn.className = "btn-icon-sm";
    refreshBtn.title = "Refresh data from API";
    refreshBtn.innerHTML = `<iconify-icon icon="mdi:refresh" class="lu"></iconify-icon>`;
    refreshBtn.style.cssText = "position:absolute;top:4px;left:4px;color:var(--st-ink-dim);background:none;border:none;cursor:pointer;padding:4px;font-size:1.1rem;transition:color .15s,text-shadow .15s;";
    head.appendChild(refreshBtn);
    refreshBtn.addEventListener("click", () => refreshStudioData(userId, profileData, k, modal, content, false));
  }
  let tsEl = head.querySelector("#studioLastRefresh");
  if (!tsEl) {
    tsEl = document.createElement("span");
    tsEl.id = "studioLastRefresh";
    tsEl.style.cssText = "position:absolute;top:8px;left:40px;font-size:.6rem;color:var(--st-ink-dim);";
    head.appendChild(tsEl);
  }
  updateRefreshTimestamp();

  const { data: cachedAnalytics, stale } = loadCachedAnalytics(userId);
  if (cachedAnalytics) {
    _data.metrics = cachedAnalytics;
    renderSection();
    if (stale) refreshStudioData(userId, profileData, k, modal, content, true);
    startAutoRefresh(userId, profileData, k, modal, content);
    return;
  }

  await fetchAndRender(userId, profileData, k, content);
  startAutoRefresh(userId, profileData, k, modal, content);
}

async function refreshStudioData(userId, profileData, k, modal, content, silent) {
  const refreshBtn = modal?.querySelector("#studioRefreshBtn");
  if (refreshBtn) refreshBtn.classList.add("nd-spin");
  try {
    const [articles, freshProfile] = await Promise.all([
      fetchAllArticles(userId, k),
      fetchFreshProfile(userId, k),
    ]);
    if (freshProfile) {
      _data.profile = { ...(_data.profile || profileData), ...freshProfile };
      Object.assign(profileData, freshProfile);
    }
    if (articles.length) {
      const newMetrics = computeMetrics(articles, _data.profile || profileData);
      if (newMetrics) {
        _data.metrics = newMetrics;
        saveCachedAnalytics(userId, newMetrics);
        renderSection();
      }
    }
    updateRefreshTimestamp();
  } catch (e) {
    console.warn("[Studio] background refresh failed:", e);
  } finally {
    if (refreshBtn) refreshBtn.classList.remove("nd-spin");
  }
}

async function fetchAndRender(userId, profileData, k, content) {
  try {
    content.innerHTML = `<div class="st-loading"><iconify-icon icon="mdi:loading" class="nd-spin"></iconify-icon><p>Loading articles...</p></div>`;
    const [articles, freshProfile] = await Promise.all([
      fetchAllArticles(userId, k, (_p, count, src) => {
        if (src === "cache") {
          content.innerHTML = `<div class="st-loading"><iconify-icon icon="mdi:database-outline" class="nd-spin"></iconify-icon><p>Loading from library cache...</p></div>`;
        } else {
          content.innerHTML = `<div class="st-loading"><iconify-icon icon="mdi:loading" class="nd-spin"></iconify-icon><p>Loading articles... (${count} found)</p></div>`;
        }
      }),
      fetchFreshProfile(userId, k),
    ]);

    if (freshProfile) {
      _data.profile = { ...(_data.profile || profileData), ...freshProfile };
      Object.assign(profileData, freshProfile);
    }

    content.innerHTML = `<div class="st-loading"><iconify-icon icon="mdi:loading" class="nd-spin"></iconify-icon><p>Calculating statistics...</p></div>`;
    _data.metrics = computeMetrics(articles, _data.profile || profileData);

    if (!_data.metrics) {
      content.innerHTML = `<div class="st-empty"><iconify-icon icon="mdi:newspaper-variant-outline" style="font-size:2rem"></iconify-icon><p>No articles found for this user.</p></div>`;
      return;
    }
    saveCachedAnalytics(userId, _data.metrics);
    renderSection();
  } catch (e) {
    console.error("[Studio]", e);
    content.innerHTML = `<div class="st-empty"><iconify-icon icon="mdi:alert-circle-outline" style="font-size:2rem"></iconify-icon><p>Failed to load analytics: ${esc(e.message || "Unknown error")}</p></div>`;
  }
}
