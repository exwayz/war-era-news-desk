import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, unwrap } from "../core/api.js";
import { fmtDate } from "../core/utils.js";
import { resolveUsers } from "./filters.js";
import { resolveContentLinks } from "../core/resolver.js";
import { highlightUserData } from "../core/profileHighlighter.js";

const LANG_NAMES = {
  en:"English",de:"Deutsch",es:"Español",fr:"Français",pt:"Português",ru:"Русский",
  zh:"中文",ja:"日本語",ko:"한국어",it:"Italiano",pl:"Polski",tr:"Türkçe",
  nl:"Nederlands",sv:"Svenska",cs:"Čeština",ro:"Română",hu:"Magyar",uk:"Українська",
  ar:"العربية",vi:"Tiếng Việt",th:"ไทย",id:"Bahasa Indonesia",ms:"Bahasa Melayu",
  hi:"हिन्दी",bn:"বাংলা",fa:"فارسی",he:"עברית",el:"Ελληνικά",fi:"Suomi",
  da:"Dansk",no:"Norsk",nb:"Norsk Bokmål",nn:"Nynorsk",bg:"Български",hr:"Hrvatski",
  sk:"Slovenčina",sl:"Slovenščina",et:"Eesti",lv:"Latviešu",lt:"Lietuvių",
  ca:"Català",gl:"Galego",eu:"Euskara",cy:"Cymraeg",ga:"Gaeilge",mt:"Malti",
  is:"Íslenska",mk:"Македонски",sq:"Shqiptar",sr:"Српски",bs:"Bosanski",
  sw:"Kiswahili",am:"አማርኛ",my:"မြန်မာ",ka:"ქართული",hy:"Հայերեն",
  tl:"Filipino",haw:"ʻŌlelo Hawaiʻi",mi:"Te Reo Māori",sm:"Gagana Samoa",
  zu:"isiZulu",af:"Afrikaans",st:"Sesotho",tn:"Setswana",ss:"siSwati",
  ve:"Tshivenḓa",ts:"Xitsonga",nr:"isiNdebele",nso:"Sepedi",
  rw:"Kinyarwanda",rn:"Kirundi",lg:"Luganda",ak:"Akan",ee:"Ewe",
  ha:"Hausa",ig:"Igbo",yo:"Yorùbá",sn:"chiShona",ny:"Chichewa",
  mn:"Монгол",ne:"नेपाली",si:"සිංහල",km:"ភាសាខ្មែរ",lo:"ລາວ",
  ta:"தமிழ்",te:"తెలుగు",kn:"ಕನ್ನಡ",ml:"മലയാളം",mr:"मराठी",
  gu:"ગુજરાતી",pa:"ਪੰਜਾਬੀ",ur:"اردو",
};
function langName(code) { return LANG_NAMES[code] || (code ? code.toUpperCase() : "?"); }

function getActiveLangs() { return S.articleLangs || []; }
function isLangActive(code) { return getActiveLangs().includes(code); }

export function setArticleStatus(msg,type="info") { if(!E.articleStatusBox) return; E.articleStatusBox.hidden=false; E.articleStatusBox.textContent=msg; E.articleStatusBox.classList.toggle("error",type==="error"); }
export function clearArticleStatus() { if(!E.articleStatusBox) return; E.articleStatusBox.hidden=true; E.articleStatusBox.textContent=""; E.articleStatusBox.classList.remove("error"); }

export function refreshLangDropdown() { populateLangDropdown(S.articles); }

function updateLangTrigger() {
  const cont = document.getElementById("articleLangFilter");
  if (!cont) return;
  const trigger = cont.querySelector(".lang-dropdown-trigger");
  if (!trigger) return;
  const sel = getActiveLangs();
  if (sel.length === 0) trigger.textContent = "All Languages";
  else if (sel.length === 1) trigger.textContent = langName(sel[0]);
  else trigger.textContent = `${sel.length} selected`;
}

function populateLangDropdown(articles) {
  const langs = new Set();
  for (const a of articles) { if (a.language) langs.add(a.language); }
  const cont = document.getElementById("articleLangFilter");
  if (!cont) return;
  const menu = cont.querySelector(".lang-dropdown-menu");
  if (!menu) return;
  let html = `<div class="lang-dropdown-item${getActiveLangs().length===0?" selected":""}" data-lang=""><span class="ld-check">${getActiveLangs().length===0?"✓":"&nbsp;"}</span>All</div>`;
  for (const l of [...langs].sort()) {
    const active = isLangActive(l);
    html += `<div class="lang-dropdown-item${active?" selected":""}" data-lang="${l}"><span class="ld-check">${active?"✓":"&nbsp;"}</span>${langName(l)}</div>`;
  }
  menu.innerHTML = html;
  updateLangTrigger();
}

function populateArticleFilters(articles) {
  const cats = new Set();
  for (const a of articles) { if (a.category) cats.add(a.category); }
  populateLangDropdown(articles);
  const catSel = document.getElementById("articleCatFilter");
  if (catSel) {
    const cur = catSel.value;
    catSel.innerHTML = '<option value="">All categories</option>';
    for (const c of [...cats].sort()) {
      catSel.innerHTML += `<option value="${c}"${c===cur?" selected":""}>${c}</option>`;
    }
  }
}

let _loadingArticles = false;
export function isLoadingArticles() { return _loadingArticles; }

function hasActiveFilters() {
  const langs = getActiveLangs();
  const cat = document.getElementById("articleCatFilter")?.value || "";
  const kw = E.articleSearch?.value?.trim() || "";
  return !!(langs.length || cat || S.articleTimeFrom || S.articleTimeTo || kw);
}

function filterByLang(arts) {
  const langs = getActiveLangs();
  if (!langs.length) return arts;
  return arts.filter(a => langs.includes(a.language));
}

export async function loadArticles(reset=true) {
  if (_loadingArticles) return;
  const k = apiKey(); if (!k) return;
  _loadingArticles = true;
  if (reset) { S.articleCursor=null; S.articles=[]; }
  if (!reset && !S.articleCursor) { _loadingArticles = false; return; }
  try {
    const limit = reset && hasActiveFilters() ? 1000 : 100;
    const result = await fetchTrpc("article.getArticlesPaginated", { type:"last", limit, cursor:reset?undefined:S.articleCursor }, k);
    const data = unwrap(result);
    const items = data?.items||[];
    await resolveUsers(items.map(a=>a.author).filter(Boolean), k);
    S.articleCursor = data?.nextCursor||null;
    if (reset) {
      S.articles = items;
    } else {
      const existingIds = new Set(S.articles.map(a => a._id || a.id));
      const deduped = items.filter(a => !existingIds.has(a._id || a.id));
      S.articles = [...S.articles, ...deduped];
    }
    populateLangDropdown(S.articles);
    if (reset) {
      const catSel = document.getElementById("articleCatFilter");
      if (catSel) {
        const cats = new Set();
        for (const a of S.articles) { if (a.category) cats.add(a.category); }
        const cur = catSel.value;
        catSel.innerHTML = '<option value="">All categories</option>';
        for (const c of [...cats].sort()) {
          catSel.innerHTML += `<option value="${c}"${c===cur?" selected":""}>${c}</option>`;
        }
      }
    }
    clearArticleStatus();
    renderArticles();
  } catch (e) {
    setArticleStatus(e.message||"Could not load articles.", "error");
  } finally {
    _loadingArticles = false;
  }
}

export async function silentRefreshArticles() {
  const k = apiKey(); if (!k) return;
  try {
    const result = await fetchTrpc("article.getArticlesPaginated", { type:"last", limit:20 }, k);
    const data = unwrap(result);
    const items = data?.items||[];
    if (!items.length) return;
    const existingIds = new Set(S.articles.map(a => a._id || a.id));
    const fresh = items.filter(a => !existingIds.has(a._id || a.id));
    if (!fresh.length) return;
    await resolveUsers(fresh.map(a=>a.author).filter(Boolean), k);
    S.articles = [...fresh, ...S.articles];
    populateLangDropdown(S.articles);
    renderArticles();
  } catch {}
}

export function renderArticles() {
  const kw=E.articleSearch.value.trim().toLowerCase();
  let arts=kw?S.articles.filter(a=>(a.title||"").toLowerCase().includes(kw)||(a.content||"").toLowerCase().includes(kw)):S.articles;
  arts = filterByLang(arts);
  const artCat = document.getElementById("articleCatFilter")?.value || "";
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
    node.querySelector(".ac-meta").textContent=`${(S.lookups.usersById.get(a.author)?.username||S.lookups.usersById.get(a.author)?.name)||"Unknown"} · ${langName(a.language)} · ${fmtDate(a.createdAt)}`;
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

  E.articleFeedMeta.classList.remove("indexing", "loaded"); void E.articleFeedMeta.offsetWidth;
  E.articleFeedMeta.textContent=`${arts.length} articles shown (${S.articles.length} loaded)`;
  E.articleFeedMeta.classList.add("loaded");
  E.articleFeedMeta.addEventListener("animationend",()=>E.articleFeedMeta.classList.remove("loaded"),{once:true});
  E.loadMoreArticlesBtn.hidden=!S.articleCursor;
  highlightUserData();
}

export async function copyArticles() {
  const kw=E.articleSearch.value.trim().toLowerCase();
  let arts=kw?S.articles.filter(a=>(a.title||"").toLowerCase().includes(kw)||(a.content||"").toLowerCase().includes(kw)):S.articles;
  arts = filterByLang(arts);
  const artCat = document.getElementById("articleCatFilter")?.value || "";
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
