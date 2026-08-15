import { getBookmarks as loadAll, saveBookmark, deleteBookmark } from "./libraryStore.js";

const L = {
  current: null,
  records: [],
  ids: new Set(),
  loaded: false,
};

export async function ensureBookmarksLoaded() {
  if (L.loaded) return;
  L.loaded = true;
  L.records = await loadAll();
  L.ids = new Set(L.records.map(r => r._id || r.id));
}

export function getBookmarkRecords() {
  return L.records;
}

export function isBookmarked(id) {
  return id != null && L.ids.has(id);
}

export function setCurrentArticle(a) {
  L.current = a || null;
  updateButton();
}

export function getCurrentArticle() {
  return L.current;
}

export async function toggleBookmark() {
  const a = L.current;
  if (!a) return;
  const id = a._id || a.id;
  if (!id) return;
  if (L.ids.has(id)) {
    L.ids.delete(id);
    L.records = L.records.filter(r => (r._id || r.id) !== id);
    await deleteBookmark(id);
  } else {
    const rec = { ...a, _id: id, bookmarkedAt: Date.now() };
    L.records = [rec, ...L.records.filter(r => (r._id || r.id) !== id)];
    L.ids.add(id);
    await saveBookmark(rec);
  }
  updateButton();
  document.dispatchEvent(new CustomEvent("nd:bookmarks-changed"));
}

function updateButton() {
  const btn = document.getElementById("bookmarkArticleBtn");
  if (!btn) return;
  const a = L.current;
  const on = a ? isBookmarked(a._id || a.id) : false;
  btn.classList.toggle("bookmarked", on);
  const icon = btn.querySelector("iconify-icon");
  if (icon) icon.setAttribute("icon", on ? "mdi:bookmark" : "mdi:bookmark-outline");
  btn.title = on ? "Remove bookmark" : "Bookmark article";
}

export function initBookmarkButton() {
  document.getElementById("bookmarkArticleBtn")?.addEventListener("click", () => toggleBookmark());
}
