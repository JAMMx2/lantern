// Provider relay: any number of OpenAI-compatible endpoints, tried in order.
// Cerebras, Groq, SambaNova, Gemini (OpenAI mode), Ollama, LM Studio — all
// speak the same protocol, so "which AI" is just a base URL and a key.
//
// Kept the historical filename so imports stay stable.

export const DEFAULT_BASE_URL = "https://api.cerebras.ai/v1";

const baseOf = (u) => String(u || DEFAULT_BASE_URL).replace(/\/+$/, "");

// Models that show up on /models but can't hold a tool-calling chat.
const NON_CHAT = /whisper|tts|embed|moderation|rerank|guard|audio|image|vision-preview|dall-e|paraphrase|distil/i;

// Shown only if the live /models call fails (no key yet, offline, etc.).
export const FALLBACK_MODELS = [
  "llama-3.3-70b",
  "llama-4-scout-17b-16e-instruct",
  "qwen-3-32b",
  "gpt-oss-120b",
];

export async function listModels(apiKey, baseUrl) {
  const res = await fetch(`${baseOf(baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`${baseOf(baseUrl)}/models returned ${res.status}`);
  }
  const data = await res.json();
  const ids = (data?.data || [])
    .map((m) => m.id)
    .filter(Boolean)
    .filter((id) => !NON_CHAT.test(id))
    .sort();
  if (ids.length) return ids;
  // An empty list usually means a fresh local server with nothing pulled yet.
  if (/localhost|127\.0\.0\.1/.test(baseOf(baseUrl))) {
    throw new Error("No models installed yet. Try: ollama pull qwen2.5-coder:7b");
  }
  return FALLBACK_MODELS;
}

/**
 * One streaming chat completion against one provider.
 * onDelta(text) fires for each content chunk. Returns the assembled reply
 * { role, content, tool_calls? } exactly like the old non-streaming call,
 * so the agent loop doesn't care that it streamed.
 */
export async function chatCompletionStream({ apiKey, baseUrl, model, messages, tools, onDelta }) {
  const body = { model, messages, stream: true };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${baseOf(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      try { detail = await res.text(); } catch { detail = ""; }
    }
    const e = new Error(`Provider error ${res.status}: ${detail}`.trim());
    e.status = res.status;
    throw e;
  }

  let content = "";
  const toolCalls = []; // assembled by stream index
  let streamedSome = false;

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  const handleLine = (line) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let evt;
    try { evt = JSON.parse(payload); } catch { return; }
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
  };
}

// ---- the relay ----
// After a failure, a provider sits out for a bit so we don't hammer it.
const cooldowns = new Map(); // baseUrl -> retry-after timestamp (ms)

function benched(p) {
  return (cooldowns.get(baseOf(p.baseUrl)) || 0) > Date.now();
}
function bench(p, ms) {
  cooldowns.set(baseOf(p.baseUrl), Date.now() + ms);
}

/**
 * Try each provider in order until one completes the request.
 * providers: [{ name, baseUrl, apiKey, model }]
 * onProvider(p) fires when a provider is about to be tried.
 * Never fails over mid-stream: once text reached the user, an error surfaces.
 */
export async function relayChat({ providers, messages, tools, onDelta, onProvider }) {
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
      });
      cooldowns.delete(baseOf(p.baseUrl));
      return { ...reply, provider: p };
    } catch (e) {
      lastErr = e;
      if (e.streamedSome) throw e; // user already saw partial text — don't duplicate
      const s = e.status | 0;
      if (s === 429) bench(p, 60_000);            // rate limited: sit out a minute
      else if (s === 401 || s === 403) bench(p, 5 * 60_000); // bad key: back off hard
      else bench(p, 20_000);                      // network/5xx: brief bench
    }
  }
  throw new Error(
    `All ${order.length} provider(s) failed. Last error: ${lastErr ? lastErr.message : "unknown"}`
  );
}
