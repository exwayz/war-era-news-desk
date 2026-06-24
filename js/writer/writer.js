import { E } from "../core/dom.js";

const DRAFTS_KEY = "wa-nd-drafts";
const IMAGES_KEY = "wa-nd-images";
const TRUSTED_DOMAINS = [
  "imgur.com", "giphy.com", "tenor.com", "cloudinary.com",
  "postimages.org", "postimg.cc", "imgbb.com", "imagebam.com",
];

let quill = null;
let pendingPasteUrlCheck = false;

const FONT_CLASS_MAP = {
  'times-new-roman': "'Times New Roman', serif",
  'arial': "Arial, sans-serif",
  'helvetica': "Helvetica, sans-serif",
  'courier-new': "'Courier New', monospace",
  'georgia': "Georgia, serif",
  'verdana': "Verdana, sans-serif",
  'monospace': "monospace",
  'caesar-dressing': "'Caesar Dressing', cursive",
  'kode-mono': "'Kode Mono', monospace",
  'lacquer': "Lacquer, cursive",
  'pixelify-sans': "'Pixelify Sans', sans-serif",
  'skranji': "Skranji, cursive",
  'texturina': "Texturina, serif",
  'tiny5': "Tiny5, monospace",
};

const FONT_WHITELIST = [
  '', 'times-new-roman', 'arial', 'helvetica', 'courier-new',
  'georgia', 'verdana', 'monospace', 'caesar-dressing', 'kode-mono',
  'lacquer', 'pixelify-sans', 'skranji', 'texturina', 'tiny5',
];

function initQuill() {
  if (quill || !E.writerEditor || typeof Quill === 'undefined') return;
  if (typeof Quill.debug === 'function') Quill.debug('error');
  const Embed = Quill.import('blots/embed');
  class MentionBlot extends Embed {
    static create(data) {
      const node = super.create();
      node.setAttribute('contenteditable', 'false');
      node.classList.add('wa-mention');
      node.dataset.entityType = data.entityType;
      node.dataset.entityId = data.entityId;
      node.dataset.entityName = data.entityName || '';
      node.textContent = data.entityName || '';
      return node;
    }
    static value(node) {
      return { entityType: node.dataset.entityType, entityId: node.dataset.entityId, entityName: node.dataset.entityName };
    }
  }
  MentionBlot.blotName = 'mention';
  MentionBlot.tagName = 'span';
  Quill.register(MentionBlot);

  const Font = Quill.import('formats/font');
  Font.whitelist = FONT_WHITELIST;
  Quill.register(Font, true);

  const BlockEmbed = Quill.import('blots/block/embed');

  class HrBlot extends BlockEmbed {
    static create(value) {
      const node = super.create(value);
      node.setAttribute('style', 'height:0px; margin-top:10px; margin-bottom:10px;');
      return node;
    }
  }
  HrBlot.blotName = 'hr';
  HrBlot.tagName = 'hr';
  Quill.register(HrBlot);

  class VideoBlot extends BlockEmbed {
    static create(value) {
      const node = super.create();
      node.setAttribute('src', value);
      node.setAttribute('frameborder', '0');
      node.setAttribute('allowfullscreen', true);
      node.setAttribute('width', '640');
      node.setAttribute('height', '360');
      return node;
    }
    static value(node) {
      return node.getAttribute('src');
    }
  }
  VideoBlot.blotName = 'video';
  VideoBlot.tagName = 'iframe';
  Quill.register(VideoBlot, true);

  class TiktokBlot extends BlockEmbed {
    static create(value) {
      const node = super.create();
      node.setAttribute('src', value);
      node.setAttribute('frameborder', '0');
      node.setAttribute('allowfullscreen', true);
      node.setAttribute('width', '640');
      node.setAttribute('height', '360');
      return node;
    }
    static value(node) {
      return node.getAttribute('src');
    }
  }
  TiktokBlot.blotName = 'tiktok';
  TiktokBlot.tagName = 'iframe';
  Quill.register(TiktokBlot);

  quill = new Quill(E.writerEditor, {
    theme: 'snow',
    placeholder: 'Start write here... type @ to mention an entity, read the detail on User Manual',
    modules: {
      toolbar: {
        container: '#writerToolbarInner',
        handlers: {
          undo: function () { quill.history.undo(); },
          redo: function () { quill.history.redo(); },
          hr: function () { const r = quill.getSelection(true); if (r) { quill.insertEmbed(r.index, 'hr', true, 'user'); quill.setSelection(r.index + 1, 0, 'user'); } },
          youtube: function () { showYoutubeDialog(); },
          tiktok: function () { showTiktokDialog(); },
          find: function () { showFindReplace(); },
          clear: function () { if (confirm('Clear all content?')) { quill.setText(''); updateWriterWordCount(); } },
        },
      },
      keyboard: true,
      clipboard: { matchVisual: false },
    },
  });
  const tb = document.getElementById('writerToolbarInner');
  tb?.querySelectorAll('button').forEach(btn => {
    btn.setAttribute('tabindex', '-1');
    btn.addEventListener('mousedown', e => e.preventDefault());
  });
  quill.on('text-change', (delta, oldDelta, source) => {
    if (source !== 'user') { closeMentionPopup(); return; }
    handleMentionTrigger();
    updateWriterWordCount();
    updateAssistance();
    if (pendingPasteUrlCheck) {
      pendingPasteUrlCheck = false;
      resolvePastedUrls();
    }
  });
  E.writerEditor.addEventListener('paste', handleQuillPaste, { capture: true });
  E.writerEditor.addEventListener('keydown', handleEditorKeydown, { capture: true });
  E.writerEditor.addEventListener('click', closeMentionPopup);
  document.addEventListener('scroll', closeMentionPopup, true);
  // ── Keyboard shortcuts ──
  const kb = quill.getModule('keyboard');
  if (kb) {
    kb.addBinding({ key: 'S', shiftKey: true, shortKey: true }, function () { this.quill.format('strike', !(this.quill.getFormat()['strike'])); });
    kb.addBinding({ key: 'I', shiftKey: true, shortKey: true }, function () { this.quill.format('code', !(this.quill.getFormat()['code'])); });
    kb.addBinding({ key: 'G', shortKey: true }, function () { this.quill.format('code-block', !(this.quill.getFormat()['code-block'])); });
    kb.addBinding({ key: 'Q', shortKey: true }, function () { this.quill.format('blockquote', !(this.quill.getFormat()['blockquote'])); });
    kb.addBinding({ key: '1', shortKey: true }, function () { const f = this.quill.getFormat()['list']; this.quill.format('list', f === 'ordered' ? false : 'ordered'); });
    kb.addBinding({ key: 'O', shortKey: true }, function () { const f = this.quill.getFormat()['list']; this.quill.format('list', f === 'bullet' ? false : 'bullet'); });
    kb.addBinding({ key: 'L', altKey: true, shortKey: true }, function () { this.quill.format('align', 'left'); });
    kb.addBinding({ key: 'E', shortKey: true }, function () { this.quill.format('align', 'center'); });
    kb.addBinding({ key: 'R', shortKey: true }, function () { this.quill.format('align', 'right'); });
    kb.addBinding({ key: 'J', shortKey: true }, function () { this.quill.format('align', 'justify'); });
    kb.addBinding({ key: 'H', shortKey: true }, function () { const r = quill.getSelection(true); if (r) { quill.insertEmbed(r.index, 'hr', true, 'user'); quill.setSelection(r.index + 1, 0, 'user'); } });
    kb.addBinding({ key: 'Y', shiftKey: true, shortKey: true }, function () { showYoutubeDialog(); });
    kb.addBinding({ key: 'N', altKey: true, shortKey: true }, function () { toggleNotes(); });
    kb.addBinding({ key: 'C', altKey: true, shortKey: true }, function () { toggleCalculator(); });
    kb.addBinding({ key: 'T', altKey: true, shortKey: true }, function () { toggleTranslator(); });
  }
  // ── Floating toolbar on selection ──
  const ft = document.getElementById('floatToolbar');
  if (ft) {
    const FLOAT_BTNS = [
      { h: '<b>B</b>', f: 'bold' },
      { h: '<i>I</i>', f: 'italic' },
      { h: '<u>U</u>', f: 'underline' },
      { h: '<s>S</s>', f: 'strike' },
      { s: 1 },
      { h: 'H2', f: 'header', v: '2' },
      { h: 'H3', f: 'header', v: '3' },
      { s: 1 },
      { h: '&#x1F517;', f: 'link', v: true },
    ];
    FLOAT_BTNS.forEach(item => {
      if (item.s) { const el = document.createElement('span'); el.style.cssText = 'color:#666;font-size:11px;padding:0 3px'; el.textContent = '|'; ft.appendChild(el); return; }
      const btn = document.createElement('button');
      btn.innerHTML = item.h;
      btn.dataset.format = item.f;
      if (item.v !== undefined) btn.dataset.value = item.v;
      btn.setAttribute('tabindex', '-1');
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => {
        if (!quill) return;
        const r = quill.getSelection(true);
        if (!r || !r.length) return;
        const v = btn.dataset.value !== undefined ? (btn.dataset.value === 'true' ? true : btn.dataset.value === 'false' ? false : btn.dataset.value) : true;
        quill.format(btn.dataset.format, v);
      });
      ft.appendChild(btn);
    });
    quill.on('selection-change', (range) => {
      if (range && range.length > 0) {
        const b = quill.getBounds(range.index);
        const er = E.writerEditor.getBoundingClientRect();
        ft.style.display = 'flex';
        ft.style.left = Math.max(10, Math.min(er.left + b.left + b.width / 2, window.innerWidth - 10)) + 'px';
        ft.style.top = Math.max(10, er.top + b.top) + 'px';
      } else {
        ft.style.display = 'none';
      }
    });
  }
  // ── User Manual modal ──
  const umBtn = document.getElementById('userManualBtn');
  const umModal = document.getElementById('userManualModal');
  if (umBtn && umModal) {
    umBtn.addEventListener('click', () => umModal.classList.remove('hidden'));
    document.getElementById('closeUserManualBtn')?.addEventListener('click', () => umModal.classList.add('hidden'));
    umModal.addEventListener('click', e => { if (e.target === umModal) umModal.classList.add('hidden'); });
  }
}

export function initWriterToolbar() {
  if (!E.writerToolbar) return;
  initQuill();
}

function updateWriterWordCount() {
  if (!E.writerWordCount) return;
  const text = quill ? quill.getText() : "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  E.writerWordCount.textContent = `${words} word${words === 1 ? "" : "s"}`;
}

function showFindReplace() {
  const existing = document.getElementById("wrFindReplaceBar");
  if (existing) { existing.remove(); return; }
  const bar = document.createElement("div");
  bar.id = "wrFindReplaceBar";
  bar.className = "wr-find-bar";
  bar.innerHTML = `
    <input type="text" id="wrFindInput" placeholder="Find…">
    <label><input type="checkbox" id="wrMatchCase"> Match Case</label>
    <label><input type="checkbox" id="wrWholeWord"> Whole Word</label>
    <label><input type="checkbox" id="wrExactPhrase"> Exact Phrase</label>
    <button class="wr-find-btn" id="wrFindNext">▼</button>
    <input type="text" id="wrReplaceInput" placeholder="Replace with…">
    <button class="wr-find-btn" id="wrReplaceOne">Replace</button>
    <button class="wr-find-btn" id="wrReplaceAll">Replace All</button>
    <button class="wr-find-btn" id="wrFindClose">✕</button>
  `;
  E.writerToolbar.after(bar);
  document.getElementById("wrFindClose").onclick = () => bar.remove();
  document.getElementById("wrFindNext").onclick = () => findInEditor();
  document.getElementById("wrReplaceOne").onclick = () => replaceInEditor(false);
  document.getElementById("wrReplaceAll").onclick = () => replaceInEditor(true);
  document.getElementById("wrFindInput").focus();
}

function findInEditor() {
  const q = document.getElementById("wrFindInput")?.value;
  if (!q || !quill) return;
  const content = quill.getText();
  const matchCase = document.getElementById("wrMatchCase")?.checked;
  const wholeWord = document.getElementById("wrWholeWord")?.checked;
  const exactPhrase = document.getElementById("wrExactPhrase")?.checked;
  let pattern = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (wholeWord || exactPhrase) pattern = `\\b${pattern}\\b`;
  const flags = matchCase ? "g" : "gi";
  const re = new RegExp(pattern, flags);
  const match = re.exec(content);
  if (match) quill.setSelection(match.index, match[0].length);
}

function replaceInEditor(all) {
  const q = document.getElementById("wrFindInput")?.value;
  const r = document.getElementById("wrReplaceInput")?.value;
  if (!q || !quill) return;
  if (all) {
    const matchCase = document.getElementById("wrMatchCase")?.checked;
    const wholeWord = document.getElementById("wrWholeWord")?.checked;
    const exactPhrase = document.getElementById("wrExactPhrase")?.checked;
    let pattern = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWord || exactPhrase) pattern = `\\b${pattern}\\b`;
    const flags = matchCase ? "g" : "gi";
    const text = quill.getText();
    let m;
    const re = new RegExp(pattern, flags);
    let offset = 0;
    while ((m = re.exec(text)) !== null) {
      quill.deleteText(m.index - offset, m[0].length);
      quill.insertText(m.index - offset, r);
      offset += m[0].length - r.length;
    }
    updateWriterWordCount();
  } else {
    const sel = quill.getSelection(true);
    if (!sel) return;
    quill.deleteText(sel.index, sel.length || 0);
    quill.insertText(sel.index, r);
    quill.setSelection(sel.index + r.length, 0);
  }
}

function showYoutubeDialog() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:420px">
      <h2 style="margin-bottom:12px">Insert YouTube Video</h2>
      <input type="text" id="wrYtUrl" placeholder="Paste YouTube URL…" style="width:100%;margin-bottom:10px">
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:.84rem">
        <input type="checkbox" id="wrYtAutoplay"> Autoplay
      </label>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:12px;font-size:.84rem">
        <input type="checkbox" id="wrYtLoop"> Loop
      </label>
      <div class="btn-row">
        <button class="btn-primary" id="wrYtInsert">Insert</button>
        <button class="btn-secondary" id="wrYtCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#wrYtCancel").onclick = () => overlay.remove();
  overlay.querySelector("#wrYtInsert").onclick = () => {
    const url = overlay.querySelector("#wrYtUrl").value.trim();
    const autoplay = overlay.querySelector("#wrYtAutoplay").checked;
    const loop = overlay.querySelector("#wrYtLoop").checked;
    const id = extractYtId(url);
    if (id && quill) {
      let src = `https://www.youtube.com/embed/${id}`;
      const params = [];
      if (autoplay) { params.push("autoplay=1"); params.push("playsinline=1"); }
      if (loop) { params.push("loop=1"); params.push(`playlist=${id}`); }
      if (params.length) src += "?" + params.join("&");
      const sel = quill.getSelection(true);
      quill.insertEmbed(sel.index, 'video', src);
      quill.insertText(sel.index + 1, '\n');
      quill.setSelection(sel.index + 2, 0);
    }
    overlay.remove();
  };
  overlay.querySelector("#wrYtUrl").focus();
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

function showTiktokDialog() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:420px">
      <h2 style="margin-bottom:12px">Insert TikTok Video</h2>
      <input type="text" id="wrTtUrl" placeholder="Paste TikTok URL…" style="width:100%;margin-bottom:12px">
      <div class="btn-row">
        <button class="btn-primary" id="wrTtInsert">Insert</button>
        <button class="btn-secondary" id="wrTtCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#wrTtCancel").onclick = () => overlay.remove();
  overlay.querySelector("#wrTtInsert").onclick = () => {
    const url = overlay.querySelector("#wrTtUrl").value.trim();
    if (url && quill) {
      const sel = quill.getSelection(true);
      quill.insertEmbed(sel.index, 'tiktok', url);
      quill.insertText(sel.index + 1, '\n');
      quill.setSelection(sel.index + 2, 0);
    }
    overlay.remove();
  };
  overlay.querySelector("#wrTtUrl").focus();
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

function extractYtId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ═══════════════════════════════════════════════════════
//  DRAFT LIBRARY
// ═══════════════════════════════════════════════════════
function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || []; } catch { return []; }
}

function saveDrafts(drafts) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

export function renderDrafts() {
  const list = E.writerDraftsList;
  if (!list) return;
  const drafts = loadDrafts();
  if (!drafts.length) { list.innerHTML = '<p style="font-size:.78rem;color:var(--ink-dim)">No drafts yet.</p>'; return; }
  list.innerHTML = drafts.map(d => `
    <div class="wr-draft-card" data-draft-id="${d.id}">
      <div class="wr-draft-info">
        <span class="wr-draft-title">${escapeHtml(d.title || "Untitled")}</span>
        <span class="wr-draft-date">${fmtDate(d.updatedAt)}</span>
      </div>
      <div class="wr-draft-actions">
        <button class="wr-draft-btn" data-draft-edit="${d.id}" title="Edit title">✏️</button>
        <button class="wr-draft-btn" data-draft-del="${d.id}" title="Delete">🗑</button>
      </div>
    </div>
  `).join("");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function saveCurrentDraft() {
  const title = (E.writerTitleInput?.value || "").trim() || "Untitled";
  const content = quill ? quill.root.innerHTML : "";
  if (!content || content === "<br>" || content === "<p><br></p>") return;
  const drafts = loadDrafts();
  const existing = drafts.find(d => d.title === title && d.content === content);
  if (existing) { existing.updatedAt = Date.now(); }
  else { drafts.unshift({ id: crypto.randomUUID?.() || Date.now().toString(36), title, content, updatedAt: Date.now() }); }
  saveDrafts(drafts);
  renderDrafts();
  if (E.writerSaveStatus) E.writerSaveStatus.textContent = "Saved";
}

function deleteDraft(id) {
  let drafts = loadDrafts();
  drafts = drafts.filter(d => d.id !== id);
  saveDrafts(drafts);
  renderDrafts();
}

function editDraftTitle(id) {
  const card = document.querySelector(`[data-draft-id="${id}"]`);
  if (!card) return;
  const titleEl = card.querySelector(".wr-draft-title");
  if (!titleEl) return;
  const current = titleEl.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "wr-draft-title-input";
  input.value = current;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const done = () => {
    const drafts = loadDrafts();
    const d = drafts.find(x => x.id === id);
    if (d) { d.title = input.value.trim() || "Untitled"; saveDrafts(drafts); }
    renderDrafts();
  };
  input.addEventListener("blur", done);
  input.addEventListener("keydown", e => { if (e.key === "Enter") { input.blur(); } if (e.key === "Escape") { input.value = current; input.blur(); } });
}

function loadDraftIntoEditor(id) {
  const drafts = loadDrafts();
  const d = drafts.find(x => x.id === id);
  if (!d || !quill) return;
  if (E.writerTitleInput) E.writerTitleInput.value = d.title;
  quill.root.innerHTML = d.content;
  updateWriterWordCount();
  if (E.writerSaveStatus) E.writerSaveStatus.textContent = "Saved";
}

export function initDraftLibrary() {
  renderDrafts();
  E.addDraftBtn?.addEventListener("click", saveCurrentDraft);
  E.writerDraftsList?.addEventListener("click", e => {
    const delBtn = e.target.closest("[data-draft-del]");
    const editBtn = e.target.closest("[data-draft-edit]");
    const card = e.target.closest(".wr-draft-card");
    if (delBtn) { deleteDraft(delBtn.dataset.draftDel); return; }
    if (editBtn) { editDraftTitle(editBtn.dataset.draftEdit); return; }
    if (card && !e.target.closest(".wr-draft-actions")) loadDraftIntoEditor(card.dataset.draftId);
  });
}

// ═══════════════════════════════════════════════════════
//  IMAGE LIBRARY
// ═══════════════════════════════════════════════════════
function loadImages() {
  try { return JSON.parse(localStorage.getItem(IMAGES_KEY)) || []; } catch { return []; }
}

function saveImages(images) {
  localStorage.setItem(IMAGES_KEY, JSON.stringify(images));
}

function isValidImageUrl(url) {
  try {
    const u = new URL(url);
    return TRUSTED_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith("." + d));
  } catch { return false; }
}

function renderImageLibrary() {
  const tile = document.getElementById("writerImageLibrary");
  if (!tile) return;
  const images = loadImages();
  const thumbs = images.map(img => `
    <div class="wr-img-thumb-wrap">
      <img class="wr-img-thumb" src="${escapeHtml(img.url)}" alt="" loading="lazy" data-img-url="${escapeHtml(img.url)}">
      <button class="wr-img-del" data-img-id="${img.id}" title="Remove">✕</button>
    </div>
  `).join("");
  const head = tile.querySelector(".writer-section-head");
  const body = `<div class="wr-img-input-row">
    <input type="text" id="wrImgUrl" placeholder="Paste image URL…">
    <button class="btn-icon-sm" id="wrImgAdd" style="min-width:auto;min-height:auto;padding:2px 8px">+</button>
  </div>
  <div class="wr-img-grid" id="wrImgGrid">${thumbs}</div>`;
  tile.innerHTML = head.outerHTML + body;
  tile.querySelector("#wrImgAdd")?.addEventListener("click", addImageFromInput);
  tile.querySelector("#wrImgUrl")?.addEventListener("keydown", e => { if (e.key === "Enter") addImageFromInput(); });
}

function addImageFromInput() {
  const input = document.getElementById("wrImgUrl");
  if (!input) return;
  const url = input.value.trim();
  if (!url) return;
  if (!isValidImageUrl(url)) { toast("Image domain not trusted. Allowed: " + TRUSTED_DOMAINS.join(", ")); return; }
  const images = loadImages();
  if (images.some(i => i.url === url)) { input.value = ""; return; }
  images.unshift({ id: crypto.randomUUID?.() || Date.now().toString(36), url, addedAt: Date.now() });
  saveImages(images);
  renderImageLibrary();
  input.value = "";
}

function deleteImage(id) {
  let images = loadImages();
  images = images.filter(i => i.id !== id);
  saveImages(images);
  renderImageLibrary();
}

function insertImageAtCaret(url) {
  if (!quill) return;
  const sel = quill.getSelection(true);
  quill.insertEmbed(sel.index, 'image', url);
  quill.insertText(sel.index + 1, '\n');
  quill.setSelection(sel.index + 2, 0);
}

export function initImageLibrary() {
  renderImageLibrary();
  const tile = document.getElementById("writerImageLibrary");
  tile?.addEventListener("click", e => {
    const del = e.target.closest("[data-img-id]");
    if (del) { deleteImage(del.dataset.imgId); return; }
    const thumb = e.target.closest(".wr-img-thumb");
    if (thumb) insertImageAtCaret(thumb.dataset.imgUrl);
  });
}

// ═══════════════════════════════════════════════════════
//  TOAST (inline, no dependency on ui/toast.js)
// ═══════════════════════════════════════════════════════
function toast(msg) {
  const existing = document.querySelector(".wr-toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "wr-toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ═══════════════════════════════════════════════════════
//  ENTITY @MENTIONS
// ═══════════════════════════════════════════════════════
import { S } from "../core/state.js";

import { resolveEntityByType } from "../core/resolver.js";
import { typeLabel, entityDisplayName } from "../core/utils.js";

const ENTITY_URL_RE = /https?:\/\/app\.warera\.io\/(user|country|region|company|battle|mu|alliance|article|party)\/([a-zA-Z0-9]+)/i;
let mentionPopup = null;
let mentionQuery = "";
let mentionStartOffset = -1;
const mentionCache = new Map();

function searchEntities(query) {
  const q = query.toLowerCase().trim();
  const results = [];

  function add(type, id, name, sub) {
    if (!name) return;
    if (!name.toLowerCase().includes(q)) return;
    results.push({ type, id, name, sub: sub || typeLabel(type) });
  }

  for (const [id, c] of S.lookups.countriesById) add("country", id, c?.name);
  for (const [id, r] of S.lookups.regionsById) add("region", id, r?.name);
  for (const [id, u] of S.lookups.usersById) add("user", id, u?.username || u?.name);
  for (const [id, c] of S.lookups.companiesById) add("company", id, c?.name || c?.companyName);
  for (const [id, m] of S.lookups.muById) add("mu", id, m?.name || m?.muName || m?.displayName);
  for (const [id, b] of S.lookups.battlesById) {
    const n = entityDisplayName("battle", id, b);
    if (n !== "Battle") add("battle", id, n);
  }
  for (const [id, a] of S.lookups.alliancesById) add("alliance", id, a?.name || a?.alliance || a?.allianceName);
  for (const [id, a] of S.lookups.articlesById) add("article", id, a?.title);

  results.sort((a, b) => {
    const aExact = a.name.toLowerCase() === q ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2;
    const bExact = b.name.toLowerCase() === q ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2;
    return aExact - bExact || a.name.localeCompare(b.name);
  });
  return results.slice(0, 20);
}

function getCursorPos() {
  if (!quill) return null;
  const sel = quill.getSelection();
  if (!sel) return null;
  return quill.getBounds(sel.index);
}

function showMentionPopup(results, query) {
  closeMentionPopup();
  const pos = getCursorPos();
  if (!pos || !E.writerEditor) return;

  mentionPopup = document.createElement("div");
  mentionPopup.className = "wr-mention-popup";
  mentionPopup.innerHTML = results.length
    ? results.map((r, i) => `
      <div class="wr-mention-item${i === 0 ? " active" : ""}" data-index="${i}" data-type="${r.type}" data-id="${r.id}" data-name="${escapeHtml(r.name)}">
        <span class="wr-mention-name">${escapeHtml(r.name)}</span>
        <span class="wr-mention-type">${r.sub}</span>
      </div>
    `).join("")
    : '<div class="wr-mention-empty">No matches</div>';

  let top = pos.bottom + 4;
  let left = pos.left;
  if (left < 0) left = 0;

  mentionPopup.style.top = top + "px";
  mentionPopup.style.left = left + "px";
  E.writerEditor.appendChild(mentionPopup);

  mentionPopup.addEventListener('mousedown', e => { if (!e.target.closest('.wr-mention-item')) return; e.preventDefault(); });
  mentionPopup.addEventListener('click', e => {
    const item = e.target.closest('.wr-mention-item');
    if (item) insertMention(item.dataset.type, item.dataset.id, item.dataset.name);
  });

  mentionPopup.querySelector(".wr-mention-item")?.scrollIntoView({ block: "nearest" });
}

function closeMentionPopup() {
  if (mentionPopup) { mentionPopup.remove(); mentionPopup = null; }
  mentionQuery = "";
  mentionStartOffset = -1;
}

function insertMention(type, id, name) {
  closeMentionPopup();
  if (!quill) return;
  const key = type + ':' + id;
  if (!mentionCache.has(key)) mentionCache.set(key, name);
  const sel = quill.getSelection(true);
  const text = quill.getText();
  const cursorPos = sel.index;
  const atPos = text.lastIndexOf('@', cursorPos - 1);
  if (atPos === -1) return;
  quill.deleteText(atPos, cursorPos - atPos, 'user');
  quill.insertEmbed(atPos, 'mention', { entityType: type, entityId: id, entityName: name }, 'user');
  quill.insertText(atPos + 1, ' ', 'user');
  quill.setSelection(atPos + 2, 0, 'user');
  updateWriterWordCount();
}

export function insertMentionAtCaret(type, id, name) {
  if (!quill) return;
  const key = type + ':' + id;
  if (!mentionCache.has(key)) mentionCache.set(key, name);
  const sel = quill.getSelection(true);
  quill.insertEmbed(sel.index, 'mention', { entityType: type, entityId: id, entityName: name }, 'user');
  quill.insertText(sel.index + 1, ' ', 'user');
  quill.setSelection(sel.index + 2, 0, 'user');
  updateWriterWordCount();
}

function handleMentionTrigger() {
  if (!quill) return;
  const sel = quill.getSelection();
  if (!sel) { closeMentionPopup(); return; }
  const text = quill.getText();
  const cursorPos = sel.index;
  const atPos = text.lastIndexOf('@', cursorPos - 1);
  if (atPos !== -1 && cursorPos - atPos <= 30 && cursorPos > atPos) {
    const query = text.slice(atPos + 1, cursorPos).replace(/\n$/, '');
    if (query.length > 0) {
      mentionQuery = query;
      mentionStartOffset = atPos;
      const results = searchEntities(query);
      showMentionPopup(results, query);
      return;
    }
  }
  closeMentionPopup();
}

function handleEditorKeydown(e) {
  if (!mentionPopup) return;

  const items = mentionPopup.querySelectorAll(".wr-mention-item");
  let active = mentionPopup.querySelector(".wr-mention-item.active");
  let activeIdx = active ? parseInt(active.dataset.index) : -1;

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      break;
    case "ArrowUp":
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      break;
    case "Enter":
    case "Tab":
      e.preventDefault();
      if (active) insertMention(active.dataset.type, active.dataset.id, active.dataset.name);
      return;
    case "Escape":
      e.preventDefault();
      closeMentionPopup();
      return;
  }

  items.forEach((item, i) => item.classList.toggle("active", i === activeIdx));
  if (activeIdx >= 0) items[activeIdx]?.scrollIntoView({ block: "nearest" });
}

async function handleQuillPaste(e) {
  try {
    const text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    const urlRegex = /https?:\/\/app\.warera\.io\/(user|country|region|company|battle|mu|alliance|article|party)\/([a-zA-Z0-9]+)/gi;
    if (!urlRegex.test(text) || !quill) return;
    pendingPasteUrlCheck = true;
  } catch {}
}

async function resolvePastedUrls() {
  const content = quill.getText();
  const re = /https?:\/\/app\.warera\.io\/(user|country|region|company|battle|mu|alliance|article|party)\/([a-zA-Z0-9]+)/gi;
  const found = [];
  let match;
  while ((match = re.exec(content)) !== null) {
    found.push({ full: match[0], type: match[1], id: match[2], index: match.index });
  }
  if (!found.length) return;
  for (let i = found.length - 1; i >= 0; i--) {
    const f = found[i];
    const key = f.type + ':' + f.id;
    let name = mentionCache.get(key);
    if (!name) {
      try {
        const data = await resolveEntityByType(f.type, f.id);
        name = entityDisplayName(f.type, f.id, data);
        mentionCache.set(key, name);
      } catch { continue; }
    }
    quill.deleteText(f.index, f.full.length, 'user');
    quill.insertEmbed(f.index, 'mention', { entityType: f.type, entityId: f.id, entityName: name }, 'user');
    quill.insertText(f.index + 1, ' ', 'user');
  }
  updateWriterWordCount();
}

function convertMentionsToUrls(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll(".wa-mention").forEach(el => {
    const type = el.dataset.entityType;
    const id = el.dataset.entityId;
    if (type && id) {
      const url = `https://app.warera.io/${type}/${id}`;
      const a = document.createElement("a");
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      a.className = "tiptap-link";
      a.href = url;
      a.textContent = url;
      el.replaceWith(a);
    }
  });
  return div.innerHTML;
}

export function initMentions() {
  // Quill event handlers are set up in initQuill()
}

export function copyWriterHtml() {
  if (!quill) return;
  let html = convertMentionsToUrls(quill.root.innerHTML);
  // Strip inline styles from headings (reference format)
  const wrapDiv = document.createElement("div");
  wrapDiv.innerHTML = html;
  wrapDiv.querySelectorAll("h1, h2, h3").forEach(h => {
    h.removeAttribute("style");
    if (!h.querySelector(":scope > span")) {
      const span = document.createElement("span");
      while (h.firstChild) span.appendChild(h.firstChild);
      h.appendChild(span);
    }
  });
  // Convert Quill font classes to inline font-family styles for downstream compat
  wrapDiv.querySelectorAll("span[class*='ql-font-']").forEach(span => {
    for (const cls of span.className.split(' ')) {
      const match = cls.match(/^ql-font-(.+)$/);
      if (match && FONT_CLASS_MAP[match[1]]) {
        span.style.fontFamily = FONT_CLASS_MAP[match[1]];
        break;
      }
    }
    span.classList.remove(...Array.from(span.classList).filter(c => c.startsWith('ql-font-')));
  });
  // Unwrap <img> from <p> containers (reference: images are standalone siblings)
  wrapDiv.querySelectorAll("p:has(> img.tiptap-image:only-child)").forEach(p => {
    p.replaceWith(p.firstChild);
  });
  html = wrapDiv.innerHTML;
  const title = (E.writerTitleInput?.value || "").trim();
  const fullHtml = title ? `<h1><span>${escapeHtml(title)}</span></h1>\n${html}` : html;
  const wrapped = `<div class="tiptap-editor">\n${fullHtml}\n</div>`;
  try { navigator.clipboard.writeText(wrapped).then(() => toast("HTML copied to clipboard.")); } catch (_) {}
}

// ═══════════════════════════════════════════════════════
//  HELPER APPS — Sticky Notes, Calculator, Translator
// ═══════════════════════════════════════════════════════
let helperWindows = [];

function makeDraggable(header, win) {
  let offX = 0, offY = 0, dragging = false;
  header.addEventListener("mousedown", e => {
    if (e.target.closest("button, input, select, textarea")) return;
    dragging = true;
    const r = win.getBoundingClientRect();
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    win.style.position = "fixed";
    win.style.left = r.left + "px";
    win.style.top = r.top + "px";
    e.preventDefault();
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    win.style.left = (e.clientX - offX) + "px";
    win.style.top = Math.max(20, e.clientY - offY) + "px";
  });
  document.addEventListener("mouseup", () => { dragging = false; });
}

function closeHelper(win) {
  win.remove();
  helperWindows = helperWindows.filter(w => w !== win);
}

function toggleNotes() {
  const existing = helperWindows.find(w => w.dataset.app === "notes");
  if (existing) { closeHelper(existing); return; }
  const win = document.createElement("div");
  win.dataset.app = "notes";
  win.className = "wr-helper-win";
  win.innerHTML = `
    <div class="wr-helper-head">
      <span>📝 Sticky Notes</span>
      <button class="wr-helper-close" title="Close">✕</button>
    </div>
    <div class="wr-helper-body">
      <div class="wr-notes-toolbar">
        <button class="wr-notes-btn" data-notes-add title="New Note">+ New</button>
        <button class="wr-notes-btn" data-notes-lock title="Toggle Lock">🔓</button>
        <button class="wr-notes-btn" data-notes-clear title="Clear All">🗑</button>
      </div>
      <div class="wr-notes-grid" id="wrNotesGrid"></div>
    </div>
  `;
  document.body.appendChild(win);
  win.style.left = "60px";
  win.style.top = "100px";
  makeDraggable(win.querySelector(".wr-helper-head"), win);
  win.querySelector(".wr-helper-close").onclick = () => closeHelper(win);
  win.querySelector("[data-notes-add]").onclick = () => addNote();
  win.querySelector("[data-notes-lock]").onclick = () => {
    const locked = win.querySelector(".wr-notes-grid").classList.toggle("locked");
    win.querySelector("[data-notes-lock]").textContent = locked ? "🔒" : "🔓";
  };
  win.querySelector("[data-notes-clear]").onclick = () => {
    if (confirm("Clear all notes?")) win.querySelector(".wr-notes-grid").innerHTML = "";
  };
  helperWindows.push(win);
  addNote(win);
}

function addNote(win) {
  win = win || document.querySelector('[data-app="notes"] .wr-notes-grid');
  if (!win) return;
  const grid = win.tagName === "DIV" ? win : win.querySelector(".wr-notes-grid");
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;gap:4px;align-items:flex-start";
  const note = document.createElement("div");
  note.className = "wr-note";
  note.style.flex = "1";
  note.contentEditable = true;
  note.innerHTML = "Type here…";
  note.addEventListener("focus", () => { if (note.textContent === "Type here…") note.textContent = ""; });
  note.addEventListener("blur", () => { if (!note.textContent.trim()) note.textContent = "Type here…"; });
  const del = document.createElement("button");
  del.textContent = "✕";
  del.title = "Delete note";
  del.style.cssText = "width:22px;height:22px;padding:0;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--ink-dim);cursor:pointer;font-size:.64rem;display:flex;align-items:center;justify-content:center;flex-shrink:0";
  del.addEventListener("mouseenter", () => del.style.color = "var(--red)");
  del.addEventListener("mouseleave", () => del.style.color = "var(--ink-dim)");
  del.addEventListener("click", () => wrap.remove());
  wrap.appendChild(note);
  wrap.appendChild(del);
  grid.appendChild(wrap);
  note.focus();
}

function toggleCalculator() {
  const existing = helperWindows.find(w => w.dataset.app === "calc");
  if (existing) { closeHelper(existing); return; }
  const win = document.createElement("div");
  win.dataset.app = "calc";
  win.className = "wr-helper-win wr-calc-win";
  let mode = "basic";
  let hist = [];

  function render() {
    const body = win.querySelector(".wr-helper-body");
    body.innerHTML = `
      <div class="wr-calc-mode-bar">
        <button class="wr-calc-mode-btn${mode === "basic" ? " active" : ""}" data-calc-mode="basic">Basic</button>
        <button class="wr-calc-mode-btn${mode === "econ" ? " active" : ""}" data-calc-mode="econ">Economic</button>
      </div>
      <div class="wr-calc-display" id="wrCalcDisplay">0</div>
      <div class="wr-calc-buttons" id="wrCalcButtons"></div>
      <div class="wr-calc-hist" id="wrCalcHist">${hist.map(h => `<div>${escapeHtml(h)}</div>`).join("")}</div>
    `;
    const btns = mode === "basic"
      ? ["7","8","9","÷","4","5","6","×","1","2","3","−","0",".","=","+","C","±","%","⌫"]
      : ["1","2","3","+","4","5","6","−","7","8","9","×","0",".","=","÷","C","⌫","(",")"];
    const grid = body.querySelector("#wrCalcButtons");
    grid.innerHTML = btns.map(b => `<button class="wr-calc-btn">${escapeHtml(b)}</button>`).join("");
    grid.addEventListener("click", e => {
      const btn = e.target.closest(".wr-calc-btn");
      if (!btn) return;
      calcPress(btn.textContent);
    });
  }

  function calcPress(val) {
    const display = win.querySelector("#wrCalcDisplay");
    if (!display) return;
    if (val === "C") { display.textContent = "0"; return; }
    if (val === "⌫") { display.textContent = display.textContent.slice(0, -1) || "0"; return; }
    if (val === "±") { display.textContent = display.textContent.startsWith("-") ? display.textContent.slice(1) : "-" + display.textContent; return; }
    if (val === "%") { display.textContent = String(parseFloat(display.textContent || "0") / 100); return; }
    if (val === "=") {
      try {
        const expr = display.textContent.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
        const result = Function('"use strict"; return (' + expr + ')')();
        hist.unshift(display.textContent + " = " + result);
        if (hist.length > 20) hist.pop();
        display.textContent = String(result);
        render();
      } catch { display.textContent = "Error"; }
      return;
    }
    display.textContent = display.textContent === "0" ? val : display.textContent + val;
  }

  win.innerHTML = `<div class="wr-helper-head"><span>🔢 Calculator</span><button class="wr-helper-close">✕</button></div><div class="wr-helper-body"></div>`;
  document.body.appendChild(win);
  win.style.left = "60px";
  win.style.top = "280px";
  makeDraggable(win.querySelector(".wr-helper-head"), win);
  win.querySelector(".wr-helper-close").onclick = () => closeHelper(win);
  render();
  win.addEventListener("click", e => {
    const modeBtn = e.target.closest("[data-calc-mode]");
    if (modeBtn) { mode = modeBtn.dataset.calcMode; render(); }
  });
  helperWindows.push(win);
}

function toggleTranslator() {
  const existing = helperWindows.find(w => w.dataset.app === "trans");
  if (existing) { closeHelper(existing); return; }
  const win = document.createElement("div");
  win.dataset.app = "trans";
  win.className = "wr-helper-win wr-trans-win";
  win.innerHTML = `
    <div class="wr-helper-head">
      <span>🌐 Translator</span>
      <button class="wr-helper-close" title="Close">✕</button>
    </div>
    <div class="wr-helper-body">
      <select class="wr-trans-src" id="wrTransSrc"><option value="auto">Detect</option><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="it">Italian</option><option value="pt">Portuguese</option><option value="ru">Russian</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="zh">Chinese</option><option value="ar">Arabic</option></select>
      <span style="color:var(--ink-dim);font-size:.7rem">→</span>
      <select class="wr-trans-dst" id="wrTransDst"><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="it">Italian</option><option value="pt">Portuguese</option><option value="ru">Russian</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="zh">Chinese</option><option value="ar">Arabic</option></select>
      <textarea class="wr-trans-input" id="wrTransInput" placeholder="Type or paste text to translate…" rows="3"></textarea>
      <button class="wr-trans-btn" id="wrTransGo">Translate</button>
      <textarea class="wr-trans-output" id="wrTransOutput" placeholder="Translation…" rows="3" readonly></textarea>
      <button class="wr-trans-btn" id="wrTransCopy">Copy to Editor</button>
    </div>
  `;
  document.body.appendChild(win);
  win.style.left = "60px";
  win.style.top = "460px";
  makeDraggable(win.querySelector(".wr-helper-head"), win);
  win.querySelector(".wr-helper-close").onclick = () => closeHelper(win);
  win.querySelector("#wrTransGo").onclick = async () => {
    const src = win.querySelector("#wrTransSrc").value;
    const dst = win.querySelector("#wrTransDst").value;
    const text = win.querySelector("#wrTransInput").value.trim();
    if (!text) return;
    win.querySelector("#wrTransGo").textContent = "…";
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${src}&tl=${dst}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      const data = await res.json();
      const translated = data[0]?.map(s => s[0]).join("") || "";
      win.querySelector("#wrTransOutput").value = translated;
    } catch {
      win.querySelector("#wrTransOutput").value = "Translation failed.";
    }
    win.querySelector("#wrTransGo").textContent = "Translate";
  };
  win.querySelector("#wrTransCopy").onclick = () => {
    const text = win.querySelector("#wrTransOutput").value;
    if (text && quill) {
      const sel = quill.getSelection(true);
      quill.insertText(sel.index, text);
      quill.setSelection(sel.index + text.length, 0);
    }
  };
  helperWindows.push(win);
}

export function initHelperApps() {
  const tile = document.getElementById("writerHelperApps");
  if (!tile) return;
  const head = tile.querySelector(".writer-section-head");
  if (!head) return;
  const btns = document.createElement("div");
  btns.style.cssText = "display:flex;gap:4px";
  btns.innerHTML = `
    <button class="wr-helper-toggle" data-app="notes" title="Sticky Notes">📝</button>
    <button class="wr-helper-toggle" data-app="calc" title="Calculator">🔢</button>
    <button class="wr-helper-toggle" data-app="trans" title="Translator">🌐</button>
  `;
  head.appendChild(btns);
  tile.addEventListener("click", e => {
    const btn = e.target.closest("[data-app]");
    if (!btn) return;
    switch (btn.dataset.app) {
      case "notes": toggleNotes(); break;
      case "calc": toggleCalculator(); break;
      case "trans": toggleTranslator(); break;
    }
  });
}

// ═══════════════════════════════════════════════════════
//  SPELL CHECK (compact common English dictionary)
// ═══════════════════════════════════════════════════════
const COMMON_WORDS = new Set([
  "a","about","above","across","act","active","activity","add","afraid","after","again","age","ago","agree","ahead","aid","aim","air","all","allow","almost","alone","along","already","also","although","always","am","among","amount","an","and","anger","angle","animal","announce","another","answer","any","anyone","anything","anyway","apart","appear","apply","approach","area","argue","arm","army","around","arrange","arrive","art","article","ask","assume","attack","attempt","attend","attention","attract","audience","author","available","average","avoid","award","away","back","bad","bag","balance","ball","ban","band","bank","bar","base","basic","battle","be","bear","beat","beautiful","become","bed","been","before","begin","behavior","behind","believe","bell","belong","below","beneath","benefit","best","better","between","beyond","big","bill","bind","bird","birth","bit","bite","black","blade","blame","blank","blast","bleed","blind","block","blood","blow","blue","board","boat","body","bomb","bone","bonus","book","boost","border","born","boss","both","bother","bottle","bottom","bound","bow","bowl","box","brain","branch","brand","brave","bread","break","breath","breed","brick","bridge","brief","bright","bring","broad","broken","brother","brown","brush","buck","budget","build","bullet","bunch","burden","burn","burst","bus","business","busy","but","button","buy","call","calm","came","camp","campaign","can","cancel","cancer","candidate","cap","capable","capacity","capital","captain","capture","car","carbon","card","care","career","careful","carry","case","cash","cast","cat","catch","category","cause","ceiling","cell","center","central","century","chain","chair","challenge","champion","chance","change","channel","chapter","charge","chart","chase","cheap","check","chest","chief","child","choice","choose","church","circle","citizen","city","civil","claim","class","classic","clean","clear","climb","clock","close","clothe","cloud","club","coach","coalition","coast","code","coffee","cold","collapse","collect","college","colonial","color","column","combat","combine","come","comfort","command","comment","commission","committee","common","communicate","community","company","compare","compete","complete","complex","computer","concern","condition","conduct","conference","confidence","confirm","conflict","confront","congress","connect","conscious","consequence","conservative","consider","consistent","constant","constitution","construct","consumer","contact","contain","contemporary","content","contest","context","contract","contrast","contribute","control","convention","conversation","convince","cook","cool","cooperate","cope","copy","core","corner","corporate","correct","cost","cotton","council","count","counter","country","county","couple","course","court","cousin","cover","crack","craft","crash","crazy","create","creative","credit","crew","crime","crisis","criteria","critical","crop","cross","crowd","crucial","cultural","culture","cup","current","curve","custom","cut","cycle","dad","damage","danger","dangerous","dare","dark","data","date","daughter","day","dead","deal","death","debate","debt","decade","decide","decision","deck","declare","decline","deep","defeat","defend","defense","deficit","define","degree","delay","deliver","demand","democracy","demonstrate","deny","department","departure","depend","dependent","deploy","deposit","describe","desert","deserve","design","desire","desk","despite","destroy","destruction","detail","detect","determine","develop","device","devote","dialogue","die","diet","differ","difference","different","difficult","dig","digital","dimension","dinner","direct","direction","director","dirt","disappear","discipline","discover","discrimination","discuss","disease","dismiss","disorder","display","dispute","distance","distant","distinct","distinction","distribute","district","divide","division","divorce","doctor","document","dog","domestic","dominant","dominate","door","double","doubt","down","draft","drag","drama","dramatic","draw","drawing","dream","dress","drink","drive","driver","drop","drug","dry","due","during","dust","duty","dynamic","each","eager","ear","early","earn","earth","ease","east","eastern","easy","eat","economic","economy","edge","edition","editor","educate","education","effect","effective","efficient","effort","egg","eight","either","elbow","elder","elect","election","element","elevator","eliminate","else","embrace","emerge","emission","emotion","emotional","emphasis","empire","employ","employee","employer","employment","empty","enable","encounter","encourage","end","enemy","energy","enforce","engage","engine","engineer","english","enhance","enjoy","enormous","enough","ensure","enter","enterprise","entertainment","entire","entirely","entrance","entry","environment","episode","equal","equally","equipment","era","error","escape","especially","essay","essential","establish","estate","estimate","ethnic","evaluate","even","evening","event","eventually","ever","every","everybody","everyone","everything","evidence","evil","evolution","evolve","exact","examine","example","exceed","excellent","except","exception","excess","exchange","excite","exclude","excuse","execute","executive","exercise","exhibit","exhibition","exist","existence","existing","expand","expansion","expect","expense","expensive","experience","experiment","expert","explain","explicit","exploit","exploration","explore","explosion","export","expose","exposure","express","expression","extend","extension","extensive","extent","external","extra","extraordinary","extreme","eye","fabric","face","facility","fact","factor","factory","faculty","fade","fail","failure","fair","faith","fall","false","familiar","family","famous","fan","fantasy","far","farm","farmer","fashion","fast","fat","fatal","father","fault","favor","favorite","fear","feature","federal","fee","feed","feel","fellow","female","fence","few","fiber","fiction","field","fifteen","fifth","fifty","fight","figure","file","fill","film","final","financial","find","fine","finger","finish","fire","firm","first","fish","fit","five","fix","flag","flame","flat","fleet","flesh","flexible","flight","float","flood","floor","flow","flower","fly","focus","fold","folk","follow","food","foot","football","for","force","foreign","forest","forever","forget","form","formal","former","formula","forth","fortunate","fortune","forward","found","foundation","founder","four","frame","framework","free","freedom","freeze","frequency","frequent","fresh","friend","front","frozen","fruit","fuel","full","fully","fun","function","fund","fundamental","funeral","funny","furniture","further","future","gain","galaxy","gallery","game","gang","gap","garage","garden","gas","gate","gather","gene","general","generate","generation","genetic","gentle","gentleman","genuine","gesture","get","giant","gift","girl","give","glad","glance","glass","global","glove","go","goal","god","gold","golden","good","goods","govern","government","governor","grab","grade","gradually","grain","grand","grandfather","grandmother","grant","grass","grateful","grave","great","green","greet","grew","ground","group","grow","growth","guarantee","guard","guess","guest","guide","guilt","gun","gut","guy","habit","habitat","hair","half","hall","hand","handle","hang","happen","happy","harbor","hard","hardly","harm","hat","hate","have","head","headline","headquarters","health","healthy","hear","heart","heat","heaven","heavy","height","helicopter","hell","help","hence","her","heritage","hero","hers","herself","hesitate","hide","high","highlight","highly","highway","hill","him","himself","hip","hire","his","historical","history","hit","hold","hole","holiday","hollow","holy","home","honest","honor","hook","hope","horizon","horror","horse","hospital","host","hot","hotel","hour","house","household","housing","how","however","huge","human","humor","hundred","hunt","hurt","husband","hypothesis","ice","idea","ideal","identify","identity","ideology","if","ignore","ill","illegal","image","imagination","imagine","immediate","immigrant","impact","implement","implication","imply","import","importance","important","impose","impossible","impress","impression","improve","in","incentive","incident","include","including","income","incorporate","increase","increasingly","incredible","indeed","independence","independent","index","indicate","indication","individual","industrial","industry","inevitable","infant","infection","inflation","influence","inform","information","initial","initiative","injection","injure","injury","ink","inner","innocent","innovation","input","inquiry","insect","inside","insight","insist","inspect","inspiration","install","instance","instead","institution","instruction","instrument","insurance","intact","integrate","intellectual","intelligence","intend","intense","intention","interaction","interest","internal","international","internet","interpret","intervention","interview","intimate","into","introduction","invade","invasion","invest","investigate","investment","investor","invisible","invitation","invite","involve","involved","involvement","iron","is","island","isolate","issue","it","item","its","itself","jacket","jail","jet","jewelry","job","join","joint","joke","journal","journalist","journey","joy","judge","judgment","juice","jump","junior","jury","just","justice","justify","keen","keep","key","kick","kid","kill","kind","king","kiss","kitchen","knee","knife","knock","know","knowledge","label","labor","laboratory","lack","lady","lake","land","landscape","language","large","largely","last","late","later","latest","latter","laugh","launch","law","lawn","lawsuit","lawyer","lay","layer","lead","leader","leadership","leading","leaf","league","lean","learn","least","leather","leave","lecture","left","leg","legacy","legal","legend","legislation","legitimate","leisure","lend","length","lesson","let","letter","level","liberal","library","license","lie","life","lifestyle","lifetime","lift","light","like","likely","limit","limitation","limited","line","link","lip","list","listen","literally","literary","literature","little","live","living","load","loan","local","locate","location","lock","log","logic","logical","long","look","loop","loose","lord","lose","loss","lost","lot","lottery","loud","love","lovely","lower","loyal","luck","lucky","lunch","lung","machine","mad","magazine","magic","magnetic","magnificent","main","mainly","maintain","maintenance","major","majority","make","maker","makeup","male","mall","man","manage","management","manager","manner","manufacturer","many","map","march","margin","mark","market","marketing","marriage","married","marry","mask","mass","massive","master","match","material","matter","mature","maximum","may","maybe","mayor","me","meal","mean","meaning","means","meanwhile","measure","meat","mechanism","media","medical","medium","meet","meeting","member","membership","memory","mental","mention","menu","mere","merely","message","metal","meter","method","metropolitan","middle","midnight","might","mild","mile","military","militia","milk","mind","mine","minister","minor","minority","minute","miracle","mirror","miss","missile","mission","mistake","mix","mixture","mode","model","moderate","modern","modest","modify","mom","moment","momentum","money","monitor","month","mood","moon","moral","more","moreover","morning","mortgage","most","mostly","mother","motion","motivation","motor","mount","mountain","mouse","mouth","move","movement","movie","much","multiple","municipal","murder","muscle","museum","music","musical","musician","mutual","my","myself","mysterious","mystery","myth","nail","naked","name","narrative","narrow","nation","national","native","natural","naturally","nature","navy","near","nearby","nearly","necessarily","necessary","neck","need","negative","negotiate","negotiation","neighbor","neighborhood","neither","nerve","nervous","net","network","neutral","never","new","news","newspaper","next","nice","night","nine","no","nobody","nod","noise","nomination","none","nonetheless","nor","normal","normally","north","northern","nose","not","note","nothing","notice","notion","novel","now","nowhere","nuclear","number","numerous","nurse","nut","object","objection","objective","obligation","observe","obstacle","obtain","obvious","occasion","occasional","occupation","occupy","occur","ocean","odd","odds","of","off","offense","offensive","offer","office","officer","official","often","oil","old","on","once","one","ongoing","onion","online","only","onto","open","opening","operate","operating","operation","operator","opinion","opponent","opportunity","oppose","opposite","opposition","option","or","oral","orbit","order","ordinary","organ","organization","organize","orientation","origin","original","other","others","otherwise","our","ours","ourselves","out","outcome","outside","overall","overcome","overlook","overnight","overseas","overwhelming","own","owner","ownership","pace","pack","package","page","pain","painful","paint","painter","painting","pair","palace","palm","pan","panel","panic","paper","parade","paragraph","parallel","parent","park","parliament","part","participant","participate","participation","particular","particularly","partly","partner","partnership","party","pass","passage","passenger","passion","past","patch","path","patience","patient","pattern","pause","pay","payment","peace","peak","peer","penalty","people","per","perceive","percent","percentage","perception","perfect","perfectly","perform","performance","perhaps","period","permanent","permission","permit","persist","person","personal","personality","personally","personnel","perspective","persuade","petition","phase","phenomenon","philosophy","phone","photo","photograph","photographer","phrase","physical","physically","physician","piano","pick","picture","piece","pile","pilot","pine","pipeline","pit","pitch","place","plain","plan","plane","planet","planning","plant","plastic","plate","platform","play","player","plea","pleasant","please","pleasure","plenty","plot","plus","pocket","poem","poet","poetry","point","pole","police","policy","political","politician","politics","poll","pollution","pool","poor","pop","popular","population","port","portion","portrait","pose","position","positive","possess","possession","possibility","possible","possibly","post","potato","potential","potentially","pound","pour","poverty","powder","power","powerful","practical","practice","pray","prayer","precisely","predict","prediction","prefer","pregnant","premise","premium","preparation","prepare","prescription","presence","present","presentation","preserve","president","presidential","press","pressure","presumably","pretend","pretty","prevent","prevention","previous","previously","price","pride","priest","primarily","primary","prime","principal","principle","print","prior","priority","prison","prisoner","privacy","private","probably","problem","procedure","proceed","process","produce","producer","product","production","productive","productivity","profession","professional","professor","profile","profit","profound","program","progress","project","prominent","promise","promote","promotion","prompt","proof","proper","properly","property","proportion","proposal","propose","proposed","prosecution","prospect","protect","protection","protein","protest","proud","prove","provide","provider","province","provision","psychological","psychologist","psychology","public","publication","publicity","publish","published","publisher","pull","punishment","purchase","pure","purpose","pursue","push","put","qualify","quality","quarter","quarterback","question","quick","quickly","quiet","quietly","quit","quite","quote","race","racial","radical","radio","rail","raise","rally","random","range","rank","rapid","rapidly","rare","rarely","rate","rather","rating","ratio","raw","reach","react","reaction","read","reader","reading","ready","real","reality","realize","really","reason","reasonable","recall","receive","recent","recently","recipe","recognition","recognize","recommend","record","recover","recovery","recruit","red","reduce","reduction","refer","reference","reflect","reform","refugee","refuse","regard","regime","region","regional","register","regular","regularly","regulate","regulation","reinforce","reject","relate","relation","relationship","relative","relatively","relax","release","relevant","relief","religion","religious","reluctant","rely","remain","remaining","remarkable","remedy","remember","remind","remote","remove","render","rent","repair","repeat","replace","replacement","report","reporter","represent","representation","representative","republic","reputation","request","require","requirement","rescue","research","researcher","resemble","reservation","reserve","residence","resident","residential","resign","resist","resistance","resolution","resolve","resort","resource","respond","response","responsibility","responsible","rest","restaurant","restore","restriction","result","resume","retail","retain","retire","retirement","retreat","return","reveal","revenue","reversal","reverse","review","revolution","revolutionary","reward","rhetoric","rhythm","rib","rice","rich","rid","ride","rifle","right","ring","riot","rise","risk","ritual","rival","river","road","rock","rocket","rod","role","roll","romantic","roof","room","root","rope","rose","rough","roughly","round","route","routine","row","royal","rub","rule","run","runner","running","rural","rush","sacred","sacrifice","sad","safe","safety","sake","salad","salary","sale","sales","salt","same","sample","sanction","sand","satellite","satisfaction","satisfy","sauce","save","saving","scale","scandal","scare","scattered","scenario","scene","schedule","scheme","scholar","scholarship","school","science","scientific","scientist","scope","score","scream","screen","script","search","season","seat","second","secret","secretary","section","sector","secure","security","see","seed","seek","segment","select","selection","self","sell","senate","senator","send","senior","sense","sensitive","sentence","separate","sequence","serial","series","serious","seriously","servant","serve","service","session","set","setting","settle","settlement","setup","seven","several","severe","sex","sexual","shade","shadow","shake","shall","shape","share","sharp","sheet","shell","shelter","shift","shine","ship","shirt","shock","shoe","shoot","shooting","shop","shopping","shore","short","shortly","shot","should","shoulder","shout","show","shower","shrug","shut","sick","side","sight","sign","signal","signature","significance","significant","significantly","silence","silent","silver","similar","similarity","simple","simply","simultaneously","sin","since","sing","singer","single","sink","sir","sister","sit","site","situation","six","size","skill","skin","sky","slave","sleep","slice","slide","slight","slightly","slip","slow","slowly","small","smart","smell","smile","smoke","smooth","snap","snow","so","so-called","soccer","social","society","soft","software","soil","solar","soldier","solid","solution","solve","some","somebody","somehow","someone","something","sometimes","somewhat","son","song","soon","sophisticated","sorry","sort","soul","sound","source","south","southern","sovereignty","space","speak","speaker","special","specialist","species","specific","specifically","speech","speed","spend","spin","spirit","spiritual","split","spokesman","sponsor","sport","spot","spread","spring","square","stable","staff","stage","stair","stake","stand","standard","standing","star","stare","start","state","statement","station","statistics","status","stay","steady","steal","steel","step","stick","still","stock","stomach","stone","stop","storage","store","storm","story","straight","strange","stranger","strategic","strategy","stream","street","strength","strengthen","stress","stretch","strike","string","strip","stroke","strong","strongly","structure","struggle","student","studio","study","stuff","stupid","style","subject","submit","subsequent","substance","substantial","substitute","subtle","suburb","succeed","success","successful","successfully","such","sudden","suddenly","sue","suffer","sufficient","sufficiently","sugar","suggest","suggestion","suicide","suit","sum","summary","summer","summit","sun","super","superior","supermarket","supply","support","supporter","suppose","supreme","sure","surely","surface","surgery","surplus","surprise","surprised","surprising","surprisingly","surrender","surround","survey","survival","survive","survivor","suspect","suspend","suspicion","sustain","swallow","swear","sweep","sweet","swim","swing","switch","symbol","sympathy","symptom","system","table","tackle","tactic","tail","take","tale","talent","talk","tall","tank","tap","tape","target","task","taste","tax","taxpayer","teach","teacher","teaching","team","tear","technical","technique","technology","telephone","television","tell","temperature","temple","temporary","ten","tend","tendency","tension","tent","term","terms","terrain","terrible","territory","terror","terrorism","terrorist","test","testify","testing","text","thank","thanks","that","the","theater","theft","their","them","theme","themselves","then","theory","therapist","therapy","there","therefore","these","they","thick","thin","thing","think","thinking","third","this","thorough","though","thought","thousand","threat","threaten","three","thrive","throat","through","throughout","throw","thumb","thus","ticket","tide","tight","tighten","till","timber","time","tiny","tip","tire","tired","tissue","title","to","tobacco","today","together","told","tolerance","tolerate","tomorrow","tone","tongue","tonight","too","tool","tooth","top","topic","toss","total","totally","touch","tough","tour","tourism","tourist","tournament","toward","towards","tower","town","track","trade","trademark","tradition","traditional","traffic","tragedy","trail","train","training","transfer","transform","transformation","transition","translate","transport","transportation","trap","trash","travel","treasure","treat","treatment","treaty","tree","tremendous","trend","trial","tribe","trick","trigger","troop","trophy","trouble","truck","true","truly","trust","truth","try","tube","turn","twice","twin","twist","two","type","typical","typically","ugly","ultimate","ultimately","unable","uncle","uncover","under","undergo","understand","understanding","undertake","unemployment","unexpected","unfold","unfortunately","uniform","union","unique","unit","unite","united","unity","universal","universe","university","unknown","unless","unlike","unlikely","unnecessary","unpleasant","until","unusual","up","upon","upper","urban","urge","us","use","used","useful","user","usual","usually","utility","vacation","valid","valley","valuable","value","variable","variation","variety","various","vary","vast","vehicle","venture","version","versus","very","vessel","veteran","via","victim","victory","video","view","viewer","village","violate","violation","violence","violent","virtually","virtue","virus","visible","vision","visit","visitor","visual","vital","vitamin","voice","volume","voluntary","vote","voter","vulnerable","wage","wait","wake","walk","wall","wander","want","war","ware","warm","warmth","warn","warning","warrant","warrior","wash","waste","watch","water","wave","way","we","weak","wealth","wealthy","weapon","wear","weather","web","wedding","week","weekend","weekly","weigh","weight","welcome","welfare","well","west","western","wet","what","whatever","wheel","when","whenever","where","whereas","whether","which","while","whisper","white","who","whole","whom","whose","why","wide","widely","widespread","wife","wild","will","willing","win","wind","window","wine","wing","winner","winter","wipe","wire","wisdom","wise","wish","with","withdraw","within","without","witness","woman","wonder","wonderful","wood","wooden","word","work","worker","workforce","working","workshop","world","worldwide","worry","worse","worship","worst","worth","worthwhile","would","wound","wrap","write","writer","writing","written","wrong","yard","yeah","year","yell","yellow","yes","yesterday","yet","yield","you","young","your","yours","yourself","youth","zone",
]);

function spellCheck(text) {
  const words = text.toLowerCase().split(/\s+/).filter(w => /[a-z]{2,}/.test(w));
  const issues = [];
  const seen = new Set();
  for (const w of words) {
    const clean = w.replace(/[^a-z]/g, "");
    if (clean.length < 2 || seen.has(clean)) continue;
    seen.add(clean);
    if (!COMMON_WORDS.has(clean)) issues.push(clean);
  }
  return issues;
}

// ═══════════════════════════════════════════════════════
//  ASSISTANCE — Readability Stats
// ═══════════════════════════════════════════════════════
function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  if (word.length <= 3) return 1;
  const vowels = word.match(/[aeiouy]+/g);
  let count = vowels ? vowels.length : 0;
  if (word.endsWith("e")) count--;
  if (word.endsWith("le") && word.length > 3 && !/[aeiouy]/.test(word[word.length - 3])) count++;
  if (count < 1) count = 1;
  return count;
}

export function updateAssistance() {
  const toggle = document.getElementById("assistToggle");
  const body = document.getElementById("wrAssistBody");
  const content = document.getElementById("writerAssistContent");
  if (!body) return;

  // Show/hide based on toggle
  const enabled = !toggle || toggle.checked;
  body.style.display = enabled ? "" : "none";

  const text = quill ? quill.getText() : "";
  const clean = text.trim();
  const words = clean ? clean.split(/\s+/).filter(w => /[a-zA-Z0-9]/.test(w)) : [];
  const wordCount = words.length;
  const charCount = clean.length;
  const sentences = clean ? clean.split(/[.!?]+/).filter(s => s.trim().length > 0) : [];
  const sentenceCount = sentences.length || 1;
  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);

  const elWords = document.getElementById("wrAssistWords");
  const elChars = document.getElementById("wrAssistChars");
  const elSentences = document.getElementById("wrAssistSentences");
  const elSyllables = document.getElementById("wrAssistSyllables");
  const elEase = document.getElementById("wrAssistEase");
  const elGrade = document.getElementById("wrAssistGrade");
  const elDiff = document.getElementById("wrAssistDiff");
  const elIssues = document.getElementById("wrAssistIssues");
  if (elWords) elWords.textContent = wordCount;
  if (elChars) elChars.textContent = charCount;
  if (elSentences) elSentences.textContent = sentenceCount;
  if (elSyllables) elSyllables.textContent = totalSyllables;

  if (wordCount < 3) {
    if (elEase) elEase.textContent = "—";
    if (elGrade) elGrade.textContent = "—";
    if (elDiff) elDiff.textContent = "—";
    if (elIssues) elIssues.textContent = "—";
    return;
  }

  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = totalSyllables / wordCount;
  const ease = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

  let diff;
  if (ease >= 90) diff = "Very Easy";
  else if (ease >= 80) diff = "Easy";
  else if (ease >= 70) diff = "Fairly Easy";
  else if (ease >= 60) diff = "Standard";
  else if (ease >= 50) diff = "Fairly Difficult";
  else if (ease >= 30) diff = "Difficult";
  else diff = "Very Confusing";

  if (elEase) elEase.textContent = ease.toFixed(1);
  if (elGrade) elGrade.textContent = grade.toFixed(1);
  if (elDiff) elDiff.textContent = diff;

  if (elIssues) {
    const issues = spellCheck(clean);
    elIssues.textContent = issues.length;
    if (issues.length) elIssues.title = issues.slice(0, 30).join(", ");
    else elIssues.title = "";
  }
}

export { updateWriterWordCount };
