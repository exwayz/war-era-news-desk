import { E } from "../core/dom.js";

export function toast(msg) {
  document.querySelectorAll(".toast").forEach(t=>t.remove());
  const el=document.createElement("div"); el.className="toast"; el.textContent=msg;
  document.body.append(el); setTimeout(()=>el.remove(),2800);
}

export function setStatus(msg,type="info") { E.statusBox.hidden=false; E.statusBox.textContent=msg; E.statusBox.classList.toggle("error",type==="error"); }
export function clearStatus() { E.statusBox.hidden=true; E.statusBox.textContent=""; E.statusBox.classList.remove("error"); }
export function setArticleStatus(msg,type="info") { if(!E.articleStatusBox) return; E.articleStatusBox.hidden=false; E.articleStatusBox.textContent=msg; E.articleStatusBox.classList.toggle("error",type==="error"); }
export function clearArticleStatus() { if(!E.articleStatusBox) return; E.articleStatusBox.hidden=true; E.articleStatusBox.textContent=""; E.articleStatusBox.classList.remove("error"); }
