import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, fetchCached, unwrap } from "../core/api.js";
import { fmtDate } from "../core/utils.js";
import { resolveUsers } from "./filters.js";
import { resolveContentLinks } from "../core/resolver.js";
import { highlightUserData } from "../core/profileHighlighter.js";

export function setArticleStatus(msg,type="info") { if(!E.articleStatusBox) return; E.articleStatusBox.hidden=false; E.articleStatusBox.textContent=msg; E.articleStatusBox.classList.toggle("error",type==="error"); }
export function clearArticleStatus() { if(!E.articleStatusBox) return; E.articleStatusBox.hidden=true; E.articleStatusBox.textContent=""; E.articleStatusBox.classList.remove("error"); }

function populateArticleFilters(articles) {
  const langs = new Set(); const cats = new Set();
  for (const a of articles) {
    if (a.language) langs.add(a.language);
    if (a.category) cats.add(a.category);
  }
  const langSel = document.getElementById("articleLangFilter");
  const catSel = document.getElementById("articleCatFilter");
  if (langSel) {
    const cur = langSel.value;
    langSel.innerHTML = '<option value="">All languages</option>';
    for (const l of [...langs].sort()) {
      langSel.innerHTML += `<option value="${l}"${l===cur?" selected":""}>${l}</option>`;
    }
  }
  if (catSel) {
    const cur = catSel.value;
    catSel.innerHTML = '<option value="">All categories</option>';
    for (const c of [...cats].sort()) {
      catSel.innerHTML += `<option value="${c}"${c===cur?" selected":""}>${c}</option>`;
    }
  }
}

export async function loadArticles(reset=true) {
  const k = apiKey(); if (!k) return;
  if (reset) { S.articleCursor=null; S.articles=[]; }
  if (!reset && !S.articleCursor) return;
  try {
    // Try cache first
    const cached = await fetchCached("articles");
    if (cached.length && reset) {
      S.articles = cached;
      await resolveUsers(cached.map(a=>a.author).filter(Boolean), k);
      populateArticleFilters(S.articles);
      clearArticleStatus();
      renderArticles();
    }

    const result = await fetchTrpc("article.getArticlesPaginated", { type:"last", limit:100, cursor:reset?undefined:S.articleCursor }, k);
    const data = unwrap(result);
    const items = data?.items||[];
    await resolveUsers(items.map(a=>a.author).filter(Boolean), k);
    S.articleCursor = data?.nextCursor||null;
    S.articles = reset ? items : [...S.articles, ...items];
    if (reset) populateArticleFilters(S.articles);
    clearArticleStatus();
    renderArticles();
  } catch (e) {
    setArticleStatus(e.message||"Could not load articles.", "error");
  }
}

export function renderArticles() {
  const kw=E.articleSearch.value.trim().toLowerCase();
  let arts=kw?S.articles.filter(a=>(a.title||"").toLowerCase().includes(kw)||(a.content||"").toLowerCase().includes(kw)):S.articles;
  const artLang = document.getElementById("articleLangFilter")?.value || "";
  const artCat = document.getElementById("articleCatFilter")?.value || "";
  if (artLang) arts = arts.filter(a => a.language === artLang);
  if (artCat) arts = arts.filter(a => a.category === artCat);
  const af=S.articleTimeFrom, at=S.articleTimeTo;
  if(af||at){
    const fromMs=af?new Date(af).getTime():0;
    const toMs=at?new Date(at).getTime():Infinity;
    arts=arts.filter(a=>{
      const ms=new Date(a.createdAt).getTime();
      if(isNaN(ms)) return true;
      return ms>=fromMs&&ms<=toMs;
    });
  }
  const aSort=S.articleSort||"date";
  arts=[...arts].sort((a,b)=>{
    if(aSort==="score"){
      const sa=(a.stats?.score??0), sb=(b.stats?.score??0);
      return sb-sa;
    }
    return new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime();
  });
  E.articleList.innerHTML="";
  for(const a of arts) {
    const node=E.tplArticle.content.firstElementChild.cloneNode(true);
    const stats = a.stats || {};
    node.querySelector(".ac-cat").textContent=a.category||"General";
    node.querySelector(".ac-title").textContent=a.title||"Untitled";
    node.querySelector(".ac-meta").textContent=`${(S.lookups.usersById.get(a.author)?.username||S.lookups.usersById.get(a.author)?.name)||"Unknown"} · ${a.language||"?"} · ${fmtDate(a.createdAt)}`;
    node.querySelector(".ac-stats").textContent = `👁 ${stats.views ?? 0} • Score ${stats.score ?? 0}`;
    node.querySelector(".ac-open").addEventListener("click",()=>window.open(`https://app.warera.io/article/${a._id||a.id}`,"_blank","noopener"));
    node.querySelector(".ac-read").addEventListener("click",()=>{
      E.readerTitle.textContent=a.title||"Untitled";
      E.readerAuthor.textContent=`By ${(S.lookups.usersById.get(a.author)?.username||S.lookups.usersById.get(a.author)?.name)||"Unknown"} | 👁 ${stats.views ?? 0} • ✯ ${stats.score ?? 0} • 🖒 ${stats.likes ?? 0} • 🖓 ${stats.dislikes ?? 0} • 🗪 ${stats.comments ?? 0}`;
      E.readerContent.innerHTML=a.content||"<p>No content available.</p>";
      E.readerContent.querySelectorAll("a").forEach(l=>{ l.target="_blank"; l.rel="noopener noreferrer"; });
      E.readerContent.querySelectorAll("iframe").forEach(f=>{ f.style.width="100%"; f.style.aspectRatio="16/9"; f.style.height="auto"; });
      const openBtn = document.getElementById("openArticleBtn");
      if (openBtn) openBtn.dataset.id = a._id || a.id;
      E.readerModal.classList.remove("hidden");
      resolveContentLinks(E.readerContent);
    });
    E.articleList.append(node);
  }

  if(S.articleLimiter<10) {
    E.articleFeedMeta.classList.remove("loaded"); void E.articleFeedMeta.offsetWidth;
    E.articleFeedMeta.textContent="Indexing…"; E.articleFeedMeta.classList.add("indexing");
  } else {
    E.articleFeedMeta.classList.remove("indexing"); void E.articleFeedMeta.offsetWidth;
    E.articleFeedMeta.textContent=`${arts.length} articles loaded`;
    E.articleFeedMeta.classList.add("loaded");
    E.articleFeedMeta.addEventListener("animationend",()=>E.articleFeedMeta.classList.remove("loaded"),{once:true});
  }
  E.loadMoreArticlesBtn.hidden=!S.articleCursor;
  highlightUserData();
}

export async function copyArticles() {
  const kw=E.articleSearch.value.trim().toLowerCase();
  let arts=kw?S.articles.filter(a=>(a.title||"").toLowerCase().includes(kw)||(a.content||"").toLowerCase().includes(kw)):S.articles;
  const artLang = document.getElementById("articleLangFilter")?.value || "";
  const artCat = document.getElementById("articleCatFilter")?.value || "";
  if (artLang) arts = arts.filter(a => a.language === artLang);
  if (artCat) arts = arts.filter(a => a.category === artCat);
  const af=S.articleTimeFrom, at=S.articleTimeTo;
  if(af||at){
    const fromMs=af?new Date(af).getTime():0;
    const toMs=at?new Date(at).getTime():Infinity;
    arts=arts.filter(a=>{
      const ms=new Date(a.createdAt).getTime();
      if(isNaN(ms)) return true;
      return ms>=fromMs&&ms<=toMs;
    });
  }
  const aSort=S.articleSort||"date";
  arts=[...arts].sort((a,b)=>{
    if(aSort==="score"){
      const sa=(a.stats?.score??0), sb=(b.stats?.score??0);
      return sb-sa;
    }
    return new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime();
  });
  const lines=arts.map(a=>{
    const author=(S.lookups.usersById.get(a.author)?.username||S.lookups.usersById.get(a.author)?.name)||"Unknown";
    return `[${fmtDate(a.createdAt)}] ${a.category||"General"} — 👤${author} — ☆${a.stats?.score??0} — ${a.title||"Untitled"}`;
  });
  await navigator.clipboard.writeText(lines.join("\n"));
}
