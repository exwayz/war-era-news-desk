import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { apiKey, fetchTrpc, fetchTrpcApi2, fetchTrpcApi5, unwrap } from "../core/api.js";
import { fmtDate, sanitizeHtml, readerBylineHtml, articleCardStatsHtml } from "../core/utils.js";
import { resolveUsers } from "./filters.js";
import { highlightUserData } from "../core/profileHighlighter.js";
import { setCurrentArticle } from "../library/bookmarks.js";
import { openRootArticle } from "../ui/readerNav.js";

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
  az:"Azerbaijani",be:"Belarusian",cymraeg:"Welsh",gd:"Scottish Gaelic",
  kk:"Kazakh",uz:"Uzbek","zh-hant-tw":"繁體中文",
};
export function langName(code) {
  const c = String(code || "").toLowerCase();
  return LANG_NAMES[c] || (code ? String(code).toUpperCase() : "?");
}

const LANG_FLAG_CODES = {
  en:"uk",de:"de",es:"es",fr:"fr",pt:"pt",ru:"ru",zh:"cn",ja:"jp",ko:"kr",
  it:"it",pl:"pl",tr:"tr",nl:"nl",sv:"se",cs:"cz",ro:"ro",hu:"hu",uk:"ua",
  ar:"sa",vi:"vn",th:"th",id:"id",ms:"my",hi:"in",bn:"bd",fa:"ir",he:"il",
  el:"gr",fi:"fi",da:"dk",no:"no",nb:"no",nn:"no",bg:"bg",hr:"hr",sk:"sk",
  sl:"si",et:"ee",lv:"lv",lt:"lt",ca:"es",gl:"es",eu:"es",ga:"ie",
  mt:"mt",is:"is",mk:"mk",sq:"al",sr:"rs",bs:"ba",sw:"ke",am:"et",my:"mm",
  ka:"ge",hy:"am",tl:"ph",haw:"us",mi:"nz",sm:"ws",zu:"za",af:"za",st:"za",
  tn:"za",ss:"sz",ve:"za",ts:"za",nr:"za",nso:"za",rw:"rw",rn:"bi",lg:"ug",
  ak:"gh",ee:"gh",ha:"ng",ig:"ng",yo:"ng",sn:"zw",ny:"mw",mn:"mn",ne:"np",
  si:"lk",km:"kh",lo:"la",ta:"in",te:"in",kn:"in",ml:"in",mr:"in",gu:"in",
  pa:"in",ur:"pk",az:"az",be:"by",kk:"kz",uz:"uz","zh-hant-tw":"tw",
};
const LANG_ICON_FLAGS = {
  cy: "flagpack:gb-wls",
  cymraeg: "flagpack:gb-wls",
  gd: "flagpack:gb-sct",
  meow: "fluent-emoji-flat:grinning-cat",
};
export function langFlagUrl(code) {
  const c = String(code || "").toLowerCase();
  const cc = LANG_FLAG_CODES[c];
  return cc ? `https://media.warera.io/images/flags/${cc}.svg` : "";
}
export function langFlagHtml(code, cls) {
  const c = String(code || "").toLowerCase();
  const icon = LANG_ICON_FLAGS[c];
  const k = cls || "lang-flag";
  if (icon) return `<iconify-icon icon="${icon}" class="${k}" data-tip="${langName(c)}"></iconify-icon>`;
  const url = langFlagUrl(c);
  return url ? `<img class="${k}" src="${url}" alt="${langName(c)}" data-tip="${langName(c)}" loading="lazy">` : "";
}

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

async function fetchArticlesPaginated(input, k) {
  // gateway article.getArticlesPaginated currently fails (postgres) — api2 first for snappy loads
  try { return await fetchTrpcApi2("article.getArticlesPaginated", input, k); } catch {}
  try { return await fetchTrpc("article.getArticlesPaginated", input, k); } catch {}
  try { return await fetchTrpcApi5("article.getArticlesPaginated", input, k); } catch {}
  return null;
}

function hasActiveFilters() {
  const langs = getActiveLangs();
  const cat = document.getElementById("articleCatFilter")?.value || "";
  const kw = E.articleSearch?.value?.trim() || "";
  return !!(langs.length || cat || kw);
}

function filterByLang(arts) {
  const langs = getActiveLangs();
  if (!langs.length) return arts;
  return arts.filter(a => langs.includes(a.language));
}

export async function loadArticles(reset=true) {
  if (_loadingArticles) { if (reset) S.pendingArticleReload = true; return; }
  const k = apiKey(); if (!k) return;
  _loadingArticles = true;
  if (reset) { S.articleCursor=null; S.articles=[]; }
  if (!reset && !S.articleCursor) { _loadingArticles = false; return; }
  try {
    // api2 caps limit at 100 — paginate to reach the old 1000-article filtered batch
    const wantsFull = reset && hasActiveFilters();
    const target = wantsFull ? 1000 : 100;
    const limit = 100;
    let items = [];
    let cursor = reset ? undefined : S.articleCursor;
    let nextCursor = null;
    while (items.length < target) {
      const result = await fetchArticlesPaginated({ type:"last", limit, cursor }, k);
      const data = unwrap(result);
      const page = data?.items||[];
      if (!page.length) { nextCursor = null; break; }
      items = items.concat(page);
      nextCursor = data?.nextCursor||null;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    await resolveUsers(items.map(a=>a.author).filter(Boolean), k);
    S.articleCursor = nextCursor;
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
    if (S.pendingArticleReload) { S.pendingArticleReload = false; loadArticles(true); }
  }
}

export async function silentRefreshArticles() {
  const k = apiKey(); if (!k) return;
  try {
    const result = await fetchArticlesPaginated({ type:"last", limit:20 }, k);
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
  const aSort=S.articleSort||"date";
  arts=[...arts].sort((a,b)=>{
    if(aSort==="score"){
      const sa=(a.stats?.score??0), sb=(b.stats?.score??0);
      return sb-sa;
    }
    return new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime();
  });
  E.articleList.querySelectorAll(".article-card:not(.pinned-guide-card)").forEach(n => n.remove());
  for(const a of arts) {
    const node=E.tplArticle.content.firstElementChild.cloneNode(true);
    const stats = a.stats || {};
    node.querySelector(".ac-cat").textContent=a.category||"General";
    node.querySelector(".ac-title").textContent=a.title||"Untitled";
    node.querySelector(".ac-meta").textContent=`${(S.lookups.usersById.get(a.author)?.username||S.lookups.usersById.get(a.author)?.name)||"Unknown"} · ${langName(a.language)} · ${fmtDate(a.createdAt)}`;
    node.querySelector(".ac-stats").innerHTML = articleCardStatsHtml(stats);
    node.querySelector(".ac-open").addEventListener("click",()=>window.open(`https://app.warera.io/article/${a._id||a.id}`,"_blank","noopener"));
    node.querySelector(".ac-read").addEventListener("click",()=>{
      setCurrentArticle(a);
      openRootArticle(a);
      E.readerModal.classList.remove("hidden");
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
