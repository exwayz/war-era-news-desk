import { S } from "../core/state.js";
import { E } from "../core/dom.js";
import { fetchFromServer } from "../core/api.js";
import { STORE } from "../core/storage.js";
import { evtData, evtTime, buildTitle, buildSummary, fmtType } from "./events.js";

function buildContext() {
  const visible = S.events.filter(e => {
    const ts = evtTime(e);
    if (!ts) return false;
    const t = new Date(ts).getTime();
    if (isNaN(t)) return false;
    if (S.startTime && t < new Date(S.startTime).getTime()) return false;
    if (S.endTime && t > new Date(S.endTime).getTime()) return false;
    return true;
  }).slice(0, 30);
  return {
    filter: { country: E.countryInput?.value || "", type: E.eventTypeSelect?.value || "all" },
    totalEvents: S.events.length,
    visibleEvents: visible.length,
    events: visible.map(e => {
      const ed = evtData(e);
      const type = e.type || ed.type || "event";
      return {
        type, label: fmtType(type),
        title: buildTitle(e, type, ed),
        summary: buildSummary(e, type, ed),
        time: evtTime(e),
        countryId: e.countryId || ed.country || ed.countryId,
        data: ed,
      };
    }),
  };
}

function buildMessages() {
  const system = "You are WarPulse, an AI analyst for the War Era intelligence dashboard. Summarize events concisely. Highlight trends, escalating conflicts, diplomatic shifts, and notable economic activity. Keep responses under 400 words. Use plain text with short paragraphs.";
  const user = `Summarize these War Era global events. Identify patterns, escalating conflicts, diplomatic shifts, and notable economic activity. End with a brief strategic outlook.\n\nContext data:\n${JSON.stringify(buildContext(), null, 2)}`;
  return { system, user };
}

// ── Server proxy ──
async function callServer() {
  const { system, user } = buildMessages();
  const result = await fetchFromServer("/api/ai", {
    method: "POST", timeout: 30000,
    body: JSON.stringify({ prompt: user, context: { system } }),
  });
  return result || { error: "Server unreachable" };
}

// ── OpenAI-compatible (DeepSeek / Groq) ──
async function callOpenAI(base, key, model) {
  const { system, user } = buildMessages();
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 700, temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (r.status === 402) return { error: "402" };
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return { error: `${r.status}: ${body.slice(0, 120)}` };
  }
  const j = await r.json();
  if (j?.error) return { error: j.error.message || JSON.stringify(j.error) };
  return { response: j?.choices?.[0]?.message?.content || "" };
}

// ── Google Gemini (truly free) ──
async function callGemini(key) {
  const { system, user } = buildMessages();
  const encoded = encodeURIComponent(key);
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encoded}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 700, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );
  const body = await r.text().catch(() => "");
  if (!r.ok) {
    let msg = body;
    try { const e = JSON.parse(body); msg = e?.error?.message || e?.error?.status || body; } catch {}
    return { error: `Gemini ${r.status}: ${msg.slice(0, 200)}` };
  }
  const j = JSON.parse(body);
  if (j?.error) return { error: j.error.message || JSON.stringify(j.error) };
  return { response: j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "" };
}

export async function generateBriefing() {
  const btn = document.getElementById("aiBriefingBtn");
  const output = document.getElementById("aiBriefingOutput");
  if (!output || !btn) return;
  btn.disabled = true;
  btn.title = "Thinking…";
  output.classList.remove("error");
  output.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>`;
  output.hidden = false;

  try {
    // 1) Try server proxy
    let result = await callServer();

    // 2) Server not configured → try client direct
    if (!result || result.error === "Server unreachable" || result.error?.includes("not configured on server")) {
      const raw = localStorage.getItem(STORE.aiKey) || "";
      const trimmed = raw.trim();
      const isGemini = /^(AIza|AQ\.)/.test(trimmed) || trimmed.startsWith("gemini|");
      const isGroq = trimmed.startsWith("gsk_");
      const key = isGemini ? trimmed.replace(/^gemini\|/, "") : trimmed;

      if (!key) {
        result = { error: "no-key" };
      } else if (isGemini) {
        result = await callGemini(key);
      } else if (isGroq) {
        result = await callOpenAI("https://api.groq.com/openai/v1", key, "llama-3.3-70b-versatile");
      } else {
        result = await callOpenAI("https://api.deepseek.com/v1", key, "deepseek-chat");
        if (result?.error?.startsWith("402")) {
          result = { error: "DeepSeek requires payment. Get a free Gemini key at aistudio.google.com or a Groq key at console.groq.com (starts with gsk_) and paste it in Settings." };
        }
      }
    }

    if (!result || result.error) {
      if (result?.error === "no-key") {
        output.innerHTML = `<div class="ai-error">No AI key set. Get a free Gemini API key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a> (starts with AIza), then paste it in Settings → AI Key.</div>`;
      } else {
        output.innerHTML = `<div class="ai-error">${result.error}</div>`;
      }
      output.classList.add("error");
      return;
    }

    output.innerHTML = `<div class="ai-response">${result.response.replace(/\n/g, "<br>")}</div>`;
  } catch (err) {
    output.innerHTML = `<div class="ai-error">${err.message}</div>`;
    output.classList.add("error");
  } finally {
    btn.disabled = false;
    btn.title = "AI Briefing";
  }
}
