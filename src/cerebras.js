// Provider relay: any number of OpenAI-compatible endpoints, tried in order.
// Cerebras, Groq, SambaNova, Gemini (OpenAI mode), Ollama, LM Studio — all
// speak the same protocol, so "which AI" is just a base URL and a key.
//
// Kept the historical filename so imports stay stable.

export const DEFAULT_BASE_URL = "https://api.cerebras.ai/v1";

const baseOf = (u) => String(u || DEFAULT_BASE_URL).replace(/\/+$/, "");

// Models that show up on /models but can't hold a tool-calling chat.
// Also excludes Gemini-listed models that can't do function calling
// (gemma, veo, imagen, aqa, learnlm, live/audio variants) and OpenAI's
// realtime/transcribe/search/codex models, which don't take chat completions.
const NON_CHAT = /whisper|tts|embed|moderation|rerank|guard|audio|image|vision-preview|dall-e|paraphrase|distil|gemma|veo|imagen|aqa|learnlm|live|dialog|realtime|transcribe|search|computer-use|codex|babbage|davinci|sora|deep-research/i;

// Shown only if the live /models call fails (no key yet, offline, etc.).
export const FALLBACK_MODELS = [
  "llama-3.3-70b",
  "llama-4-scout-17b-16e-instruct",
  "qwen-3-32b",
  "gpt-oss-120b",
];

export async function listModels(apiKey, baseUrl) {
  let res;
  try {
    res = await fetch(`${baseOf(baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    throw new Error(describeNetworkError(e, baseOf(baseUrl)));
  }
  if (!res.ok) {
    throw await errorFrom(res, baseOf(baseUrl));
  }
  const data = await res.json();
  const ids = (data?.data || [])
    .map((m) => m.id)
    .filter(Boolean)
    .filter((id) => !NON_CHAT.test(id))
    .sort();
  if (ids.length) return ids;
  // An empty list usually means a fresh local app with no model loaded yet.
  if (/localhost|127\.0\.0\.1/.test(baseOf(baseUrl))) {
    throw new Error(/:11434/.test(baseOf(baseUrl))
      ? "Ollama has no models yet. In Settings, under AI on this computer, Lantern can download one for you."
      : "No model is loaded yet. Load one in the app, then Test again.");
  }
  return FALLBACK_MODELS;
}

/**
 * Is an OpenAI-compatible server answering here? Resolves to its chat models
 * ([] = running, nothing loaded) and throws when nothing that looks like a
 * model API answers. Keyless and quick, for finding apps on this computer.
 */
export async function probeModels(baseUrl, timeoutMs = 2000) {
  const res = await fetch(`${baseOf(baseUrl)}/models`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.data)) throw new Error("Not an OpenAI-compatible model list.");
  return data.data.map((m) => m && m.id).filter(Boolean).filter((id) => !NON_CHAT.test(id)).sort();
}

/**
 * One streaming chat completion against one provider.
 * onDelta(text) fires for each content chunk. Returns the assembled reply
 * { role, content, tool_calls? } exactly like the old non-streaming call,
 * so the agent loop doesn't care that it streamed.
 */
// Some providers (Gemini's OpenAI-compat layer, notably) reject assistant
// turns that carry tool_calls with an empty content string: 400
// "contents.parts must not be empty". Omit empty content on the wire.
function sanitizeMessages(messages) {
  return messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls && !m.content) {
      const { content, ...rest } = m;
      return rest;
    }
    if (m.role === "tool" && !m.content) {
      return { ...m, content: "(no output)" };
    }
    return m;
  });
}

/**
 * Turn an HTTP status + provider detail into something a non-programmer can act on.
 */
export function describeError(status, detail = "", providerName = "the provider") {
  const d = String(detail || "").trim();
  switch (status) {
    case 401:
    case 403:
      return `${providerName} rejected your API key (HTTP ${status}). Open settings and check the key is pasted correctly and still active.`;
    case 404:
      return `${providerName} says that model or endpoint doesn't exist (HTTP 404). Pick another model in the dropdown.${d ? " Detail: " + d : ""}`;
    case 429:
      return `${providerName} is rate-limiting you (HTTP 429). Lantern will hop to the next provider in your chain if you have one, or you can wait a minute and retry.`;
    case 400:
      return `${providerName} refused the request (HTTP 400).${d ? " " + d : ""}`;
    case 413:
      return `The conversation is too long for ${providerName} (HTTP 413). Start a new chat.`;
    case 500:
    case 502:
    case 503:
    case 504:
      return `${providerName} is having trouble right now (HTTP ${status}). Lantern will try the next provider, or retry in a moment.`;
    default:
      return `${providerName} error ${status || ""}${d ? ": " + d : ""}`.trim();
  }
}

export function describeNetworkError(e, providerName = "the provider") {
  const code = e?.cause?.code || e?.code || "";
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return `Couldn't look up ${providerName}'s address. Check your internet connection.`;
  if (/ECONNREFUSED/.test(code)) return `Nothing is listening at ${providerName}'s address (connection refused). If this is Ollama, make sure it is running.`;
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/.test(code)) return `Timed out connecting to ${providerName}.`;
  if (/CERT|SSL|TLS/i.test(code)) return `TLS certificate problem talking to ${providerName} (${code}).`;
  return `Couldn't reach ${providerName}: ${e?.message || "network error"}`;
}

async function postChat(baseUrl, apiKey, body) {
  return fetch(`${baseOf(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function errorFrom(res, providerName) {
  let detail = "";
  try {
    const err = await res.json();
    detail = err?.error?.message || (typeof err === "string" ? err : JSON.stringify(err));
  } catch {
    try { detail = await res.text(); } catch { detail = ""; }
  }
  const e = new Error(describeError(res.status, detail.slice(0, 300), providerName));
  e.status = res.status;
  e.detail = detail;
  return e;
}

/**
 * One streaming chat completion. Resolves to { role, content, tool_calls?, usage? }.
 * usage = { prompt_tokens, completion_tokens, total_tokens } when the provider reports it.
 */
export async function chatCompletionStream({ apiKey, baseUrl, model, messages, tools, onDelta, providerName }) {
  const name = providerName || baseOf(baseUrl);
  const body = { model, messages: sanitizeMessages(messages), stream: true };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  // Ask for a usage block on the final chunk (OpenAI, Cerebras, Groq honour it).
  body.stream_options = { include_usage: true };

  let res;
  try {
    res = await postChat(baseUrl, apiKey, body);
    // A few compat layers 400 on stream_options; retry once without it.
    if (res.status === 400) {
      const peek = await res.clone().text().catch(() => "");
      if (/stream_options/i.test(peek)) {
        delete body.stream_options;
        res = await postChat(baseUrl, apiKey, body);
      }
    }
  } catch (e) {
    const err = new Error(describeNetworkError(e, name));
    err.status = 0;
    throw err;
  }

  if (!res.ok) throw await errorFrom(res, name);

  let content = "";
  const toolCalls = []; // assembled by stream index
  let streamedSome = false;
  let usage = null;

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  const handleLine = (line) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let evt;
    try { evt = JSON.parse(payload); } catch { return; }
    if (evt.usage && typeof evt.usage === "object") usage = evt.usage;
    const delta = evt.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      content += delta.content;
      streamedSome = true;
      if (onDelta) onDelta(delta.content);
    }
    for (const tc of delta.tool_calls || []) {
      const i = tc.index ?? 0;
      if (!toolCalls[i]) {
        toolCalls[i] = { id: tc.id || `call_${i}`, type: "function", function: { name: "", arguments: "" } };
      }
      if (tc.id) toolCalls[i].id = tc.id;
      if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
      if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
      }
    }
    if (buf.trim()) handleLine(buf.trim());
  } catch (e) {
    e.streamedSome = streamedSome;
    throw e;
  }

  const assembled = toolCalls.filter(Boolean);
  return {
    role: "assistant",
    content,
    tool_calls: assembled.length ? assembled : undefined,
    usage: usage || undefined,
  };
}

// ---- the relay ----
// After a failure, a provider sits out for a bit so we don't hammer it.
const cooldowns = new Map(); // baseUrl -> retry-after timestamp (ms)
const benchReasons = new Map(); // baseUrl -> short reason, for the relay lights

function benched(p) {
  return (cooldowns.get(baseOf(p.baseUrl)) || 0) > Date.now();
}
function bench(p, ms, reason) {
  cooldowns.set(baseOf(p.baseUrl), Date.now() + ms);
  benchReasons.set(baseOf(p.baseUrl), reason);
}

/** A few words on why a provider was skipped: "rate-limited", "rejected the key"… */
export function hopReason(e) {
  const s = e?.status | 0;
  if (s === 429) return "rate-limited";
  if (s === 401 || s === 403) return "rejected the key";
  if (s === 404) return "doesn't have that model";
  if (s === 413) return "said the chat is too long";
  if (s === 400) return "refused the request";
  if (s >= 500) return `had a server error (${s})`;
  return "unreachable";
}

/** Per-link state for the relay lights: ready, or benched until a time. */
export function relayStatus(providers = []) {
  const now = Date.now();
  return providers.map((p) => {
    const b = baseOf(p.baseUrl);
    const until = cooldowns.get(b) || 0;
    return until > now
      ? { name: p.name || b, state: "benched", until, reason: benchReasons.get(b) || "" }
      : { name: p.name || b, state: "ready", until: 0, reason: "" };
  });
}

/**
 * Try each provider in order until one completes the request.
 * providers: [{ name, baseUrl, apiKey, model }]
 * onProvider(p) fires when a provider is about to be tried.
 * onHop({from, to, reason}) fires when a failure hands the request down the chain.
 * Never fails over mid-stream: once text reached the user, an error surfaces.
 */
export async function relayChat({ providers, messages, tools, onDelta, onProvider, onHop }) {
  if (!providers || !providers.length) {
    throw new Error("No providers configured.");
  }
  const fresh = providers.filter((p) => !benched(p));
  const order = fresh.length ? fresh : providers; // everyone benched? try anyway
  let lastErr;

  for (const p of order) {
    try {
      if (onProvider) onProvider(p);
      const reply = await chatCompletionStream({
        apiKey: p.apiKey || "local",
        baseUrl: p.baseUrl,
        model: p.model,
        messages,
        tools,
        onDelta,
        providerName: p.name,
      });
      cooldowns.delete(baseOf(p.baseUrl));
      return { ...reply, provider: p };
    } catch (e) {
      lastErr = e;
      if (e.streamedSome) throw e; // user already saw partial text — don't duplicate
      const s = e.status | 0;
      const reason = hopReason(e);
      if (s === 429) bench(p, 60_000, reason);            // rate limited: sit out a minute
      else if (s === 401 || s === 403) bench(p, 5 * 60_000, reason); // bad key: back off hard
      else bench(p, 20_000, reason);                      // network/5xx: brief bench
      const next = order[order.indexOf(p) + 1];
      if (next && onHop) onHop({ from: p, to: next, reason });
    }
  }
  throw new Error(
    `All ${order.length} provider(s) failed. Last error: ${lastErr ? lastErr.message : "unknown"}`
  );
}
