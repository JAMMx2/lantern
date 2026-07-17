// Any OpenAI-compatible endpoint works: Cerebras cloud, a local Ollama
// (http://localhost:11434/v1), LM Studio, Groq, OpenRouter, etc.
export const DEFAULT_BASE_URL = "https://api.cerebras.ai/v1";
const baseOf = (u) => String(u || process.env.CEREBRAS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

// Shown only if the live /models call fails (no key yet, offline, etc.).
// Not authoritative — the real list is always fetched from the user's key.
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
    .sort();
  if (ids.length) return ids;
  // An empty list usually means a fresh local server with nothing pulled yet.
  if (/localhost|127\.0\.0\.1/.test(baseOf(baseUrl))) {
    throw new Error("No models installed yet. Try: ollama pull qwen2.5-coder:7b");
  }
  return FALLBACK_MODELS;
}

export async function chatCompletion({ apiKey, baseUrl, model, messages, tools }) {
  const body = { model, messages };
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
      detail = await res.text();
    }
    throw new Error(`Provider error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message ?? { role: "assistant", content: "" };
}
