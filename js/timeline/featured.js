import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { resolveUsers } from "./filters.js";
import { resolveContentLinks } from "../core/resolver.js";
import { playRead } from "../audio/audio.js";

const MAX_FEATURED = 10;
const AUTO_INTERVAL = 10000;

let articles = [];
let current = 0;
let timer = null;

function extractImgurUrl(content) {
  const m = content.match(/https?:\/\/i\.imgur\.com\/\S+?\.(png|jpg|jpeg|gif|webp)/i);
  return m ? m[0] : null;
}

function renderSlide(index) {
  const img = document.getElementById("featuredImg");
  const title = document.getElementById("featuredTitle");
  const dots = document.getElementById("featuredDots");
  if (!articles.length) {
    img.src = ""; img.alt = "";
    title.textContent = "No featured articles";
    if (dots) dots.innerHTML = "";
    return;
  }
  const a = articles[index];
  const imgUrl = extractImgurUrl(a.content);
  if (imgUrl) {
    img.src = imgUrl;
    img.alt = a.title || "Article image";
    img.style.display = "";
  } else {
    img.src = ""; img.alt = "";
    img.style.display = "none";
  }
  title.textContent = a.title || "Untitled";
  title.dataset.id = a._id || a.id;
  const authorEl = document.getElementById("featuredAuthor");
  if (authorEl) {
    authorEl.textContent = (S.lookups.usersById.get(a.author)?.username || S.lookups.usersById.get(a.author)?.name) || "Unknown";
  }
  if (dots) {
    dots.innerHTML = articles.map((_, i) =>
      `<span class="featured-dot${i === index ? " active" : ""}" data-index="${i}"></span>`
    ).join("");
  }
}

function goTo(index) {
  if (!articles.length) return;
  current = (index + articles.length) % articles.length;
  renderSlide(current);
}

function next() { goTo(current + 1); }
function prev() { goTo(current - 1); }

function resetTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(next, AUTO_INTERVAL);
}

function pickFeatured(items) {
  const en = items.filter(a => a.language === "en");
  const withImgur = en.filter(a => a.content && /https?:\/\/i\.imgur\.com\/\S+/i.test(a.content));
  withImgur.sort((a, b) => (b.stats?.score ?? 0) - (a.stats?.score ?? 0));
  articles = withImgur.slice(0, MAX_FEATURED);
  current = 0;
  renderSlide(current);
  resetTimer();
}

export async function loadFeatured() {
  const k = apiKey();
  if (!k) return;
  try {
    // Share from S.articles if enough loaded
    if (S.articles.length >= 50) {
      pickFeatured(S.articles);
      return;
    }
    const result = await fetchTrpc("article.getArticlesPaginated", { type: "last", limit: 100 }, k);
    const data = unwrap(result);
    const items = data?.items || [];
    if (!items.length) return;
    await resolveUsers(items.map(a => a.author).filter(Boolean), k);
    pickFeatured(items);
  } catch (err) {
    console.error("featured load error:", err);
  }
}

function openReader(a) {
  if (!a) return;
  const stats = a.stats || {};
  E.readerTitle.textContent = a.title || "Untitled";
  E.readerAuthor.textContent = `By ${(S.lookups.usersById.get(a.author)?.username || S.lookups.usersById.get(a.author)?.name) || "Unknown"} | 👁 ${stats.views ?? 0} • ✯ ${stats.score ?? 0} • 🖒 ${stats.likes ?? 0} • 🖓 ${stats.dislikes ?? 0} • 🗪 ${stats.comments ?? 0}`;
  E.readerContent.innerHTML = a.content || "<p>No content available.</p>";
  E.readerContent.querySelectorAll("a").forEach(l => { l.target = "_blank"; l.rel = "noopener noreferrer"; });
  E.readerContent.querySelectorAll("iframe").forEach(f => { f.style.width = "100%"; f.style.aspectRatio = "16/9"; f.style.height = "auto"; });
  const openBtn = document.getElementById("openArticleBtn");
  if (openBtn) openBtn.dataset.id = a._id || a.id;
  E.readerModal.classList.remove("hidden");
  resolveContentLinks(E.readerContent);
  playRead();
}

export function initFeatured() {
  const prevBtn = document.getElementById("featuredPrev");
  const nextBtn = document.getElementById("featuredNext");
  const dots = document.getElementById("featuredDots");
  const title = document.getElementById("featuredTitle");

  prevBtn?.addEventListener("click", () => { prev(); resetTimer(); });
  nextBtn?.addEventListener("click", () => { next(); resetTimer(); });
  dots?.addEventListener("click", (e) => {
    const dot = e.target.closest(".featured-dot");
    if (dot && dot.dataset.index != null) { goTo(Number(dot.dataset.index)); resetTimer(); }
  });
  title?.addEventListener("click", () => {
    const a = articles[current];
    if (a) openReader(a);
  });
}
