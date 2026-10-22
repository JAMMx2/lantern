// Spark: turn whatever the user pastes (keys, a .env file, endpoint URLs, a
// Lantern Pass) into a tested, ordered relay chain.
// Lantern Pass: a whole chain as one string, sealed with a passphrase.
//
// Shared by both builds. The app imports this file; lantern-lite.html embeds
// a copy between its <spark> markers — run `npm run sync-lite` after editing.
// Keep it free of Node and DOM APIs: web standards only (WebCrypto is passed in).

// kind: "free" cloud tiers come first, then custom endpoints, then AI running
// on this computer, and "paid" APIs last, so money is only spent when nothing
// free can answer. Local apps are found by their default port; howTo says, in
// clicks, how to switch each one's server on.
export const SPARK_PROVIDERS = [
  { id: "cerebras", label: "Cerebras", kind: "free", baseUrl: "https://api.cerebras.ai/v1", key: /\bcsk-[A-Za-z0-9]{20,}(?![A-Za-z0-9])/, hint: /cerebras/i, domains: ["cerebras.ai"], signup: "https://cloud.cerebras.ai/", note: "~1M tokens/day free · fastest" },
  { id: "groq", label: "Groq", kind: "free", baseUrl: "https://api.groq.com/openai/v1", key: /\bgsk_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/, hint: /groq/i, domains: ["groq.com"], signup: "https://console.groq.com/keys", note: "14.4k requests/day free · very fast" },
  { id: "sambanova", label: "SambaNova", kind: "free", baseUrl: "https://api.sambanova.ai/v1", key: null, hint: /samba/i, domains: ["sambanova.ai"], signup: "https://cloud.sambanova.ai/", note: "free tier · big models, fast" },
  { id: "gemini", label: "Gemini", kind: "free", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", key: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/, hint: /gemini|google|ai ?studio/i, domains: ["googleapis.com", "aistudio.google.com"], signup: "https://aistudio.google.com/apikey", note: "generous free tier" },
  { id: "mistral", label: "Mistral", kind: "free", baseUrl: "https://api.mistral.ai/v1", key: null, hint: /mistral|codestral|devstral/i, domains: ["mistral.ai"], signup: "https://console.mistral.ai/api-keys", note: "free Experiment plan · Devstral" },
  { id: "openrouter", label: "OpenRouter", kind: "free", baseUrl: "https://openrouter.ai/api/v1", key: /\bsk-or-v1-[A-Za-z0-9]{32,}(?![A-Za-z0-9])/, hint: /openrouter/i, domains: ["openrouter.ai"], signup: "https://openrouter.ai/keys", note: ":free models from many labs" },
  { id: "nvidia", label: "NVIDIA", kind: "free", baseUrl: "https://integrate.api.nvidia.com/v1", key: /\bnvapi-[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/, hint: /nvidia|nvapi/i, domains: ["nvidia.com"], signup: "https://build.nvidia.com/", note: "free developer credits · open models" },
  { id: "huggingface", label: "Hugging Face", kind: "free", baseUrl: "https://router.huggingface.co/v1", key: /\bhf_[A-Za-z0-9]{30,}(?![A-Za-z0-9])/, hint: /hugging ?face/i, domains: ["huggingface.co", "hf.co"], signup: "https://huggingface.co/settings/tokens", note: "free monthly credits · open models" },

  { id: "ollama", label: "Ollama", kind: "local", baseUrl: "http://localhost:11434/v1", key: null, hint: /ollama/i, domains: ["ollama.com"], signup: "https://ollama.com/download", note: "on this computer · free forever", howTo: "Open the Ollama app. It runs quietly in the menu bar or system tray." },
  { id: "lmstudio", label: "LM Studio", kind: "local", baseUrl: "http://localhost:1234/v1", key: null, hint: /lm ?studio/i, domains: ["lmstudio.ai"], signup: "https://lmstudio.ai/download", note: "on this computer · desktop app", howTo: "In LM Studio, open the Developer tab, switch the server to Running, and load a model." },
  { id: "jan", label: "Jan", kind: "local", baseUrl: "http://localhost:1337/v1", key: null, hint: /jan\.ai|\bjan app\b/i, domains: ["jan.ai"], signup: "https://jan.ai/download", note: "on this computer · desktop app", howTo: "In Jan, open Settings, then Local API Server, and press Start Server." },
  { id: "gpt4all", label: "GPT4All", kind: "local", baseUrl: "http://localhost:4891/v1", key: null, hint: /gpt4all/i, domains: ["nomic.ai", "gpt4all.io"], signup: "https://www.nomic.ai/gpt4all", note: "on this computer · desktop app", howTo: "In GPT4All, open Settings and tick Enable Local API Server. (Its server can chat but may not use tools.)" },
  { id: "msty", label: "Msty", kind: "local", baseUrl: "http://localhost:10000/v1", key: null, hint: /msty/i, domains: ["msty.app", "msty.ai"], signup: "https://msty.ai", note: "on this computer · desktop app", howTo: "Open Msty and make sure its Local AI service is installed (Settings, Local AI)." },
  { id: "koboldcpp", label: "KoboldCpp", kind: "local", baseUrl: "http://localhost:5001/v1", key: null, hint: /kobold/i, domains: [], signup: "https://github.com/LostRuins/koboldcpp/releases", note: "on this computer · one-file app", howTo: "Open KoboldCpp, choose a model file, and press Launch." },
  { id: "llamafile", label: "llamafile / llama.cpp", kind: "local", baseUrl: "http://localhost:8080/v1", key: null, hint: /llamafile|llama\.cpp|llama-server/i, domains: [], signup: "https://github.com/mozilla-ai/llamafile", note: "on this computer · one-file app", howTo: "Double-click your .llamafile (on Windows, rename it to end in .exe first)." },
  { id: "docker", label: "Docker Model Runner", kind: "local", baseUrl: "http://localhost:12434/engines/v1", key: null, hint: /docker model/i, domains: [], signup: "https://docs.docker.com/ai/model-runner/", note: "on this computer · Docker Desktop", howTo: "In Docker Desktop, open Settings, then AI, and enable Docker Model Runner with host-side TCP support." },
  { id: "textgen", label: "Text Generation WebUI", kind: "local", baseUrl: "http://localhost:5000/v1", key: null, hint: /oobabooga|text-generation-webui/i, domains: [], signup: "https://github.com/oobabooga/text-generation-webui", note: "on this computer", howTo: "Start it with the API switched on (the Session tab, or the --api option)." },
  { id: "vllm", label: "vLLM / local server", kind: "local", baseUrl: "http://localhost:8000/v1", key: null, hint: /vllm|lemonade/i, domains: [], signup: "https://docs.vllm.ai/", note: "on this computer", howTo: "Start your server on port 8000 with its OpenAI-compatible API." },

  { id: "deepseek", label: "DeepSeek", kind: "paid", baseUrl: "https://api.deepseek.com/v1", key: null, hint: /deepseek/i, domains: ["deepseek.com"], signup: "https://platform.deepseek.com/api_keys", note: "paid · very low cost" },
  { id: "openai", label: "OpenAI", kind: "paid", baseUrl: "https://api.openai.com/v1", key: /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}(?![A-Za-z0-9])/, hint: /openai|chatgpt/i, domains: ["openai.com"], signup: "https://platform.openai.com/api-keys", note: "paid · GPT models" },
  { id: "xai", label: "xAI", kind: "paid", baseUrl: "https://api.x.ai/v1", key: /\bxai-[A-Za-z0-9]{40,}(?![A-Za-z0-9])/, hint: /\bxai\b|\bgrok\b/i, domains: ["x.ai"], signup: "https://console.x.ai/", note: "paid · Grok" },
  { id: "together", label: "Together AI", kind: "paid", baseUrl: "https://api.together.xyz/v1", key: /\btgp_v1_[A-Za-z0-9_-]{30,}(?![A-Za-z0-9_-])/, hintKeys: true, hint: /together[ _.]?(ai|xyz|api)/i, domains: ["together.xyz", "together.ai"], signup: "https://api.together.ai/settings/api-keys", note: "paid credits · open models" },
  { id: "fireworks", label: "Fireworks", kind: "paid", baseUrl: "https://api.fireworks.ai/inference/v1", key: /\bfw_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/, hint: /fireworks/i, domains: ["fireworks.ai"], signup: "https://fireworks.ai/account/api-keys", note: "paid · fast open models" },
];

// Ollama models Lantern can download with one click, smallest first. Every one
// supports tool calling; minRam is the memory (GB) it runs comfortably in.
export const OLLAMA_MODELS = [
  { name: "qwen2.5-coder:1.5b", size: "1.0 GB", minRam: 0 },
  { name: "qwen2.5-coder:3b", size: "1.9 GB", minRam: 8 },
  { name: "qwen2.5-coder:7b", size: "4.7 GB", minRam: 16 },
  { name: "qwen2.5-coder:14b", size: "9.0 GB", minRam: 32 },
  { name: "qwen3-coder:30b", size: "19 GB", minRam: 48 },
];

/** The biggest one-click Ollama model that fits this much memory (GB). */
export function recommendOllamaModel(ramGB) {
  const fits = OLLAMA_MODELS.filter((m) => (Number(ramGB) || 0) >= m.minRam);
  return (fits.length ? fits[fits.length - 1] : OLLAMA_MODELS[0]).name;
}

const PASS_SRC = "lantern1\\.[sr]\\.[A-Za-z0-9_-]{8,}";
const URL_SRC = "https?:\\/\\/[^\\s\"'<>`]+";
const SECRET_SRC = "[A-Za-z0-9][A-Za-z0-9_-]{18,}[A-Za-z0-9]";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

export const MIN_PASSPHRASE = 10;
export const PASS_ITERATIONS = 600_000;

const trimUrl = (u) => String(u || "").trim().replace(/\/+$/, "");
const sameUrl = (a, b) => trimUrl(a) === trimUrl(b);
const providerById = (id) => SPARK_PROVIDERS.find((p) => p.id === id);
const mask = (s) => (s.length > 12 ? s.slice(0, 4) + "…" + s.slice(-4) : "…");

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

export function isLoopback(url) {
  return LOOPBACK.has(hostOf(url));
}

const portOf = (url) => { try { return new URL(url).port; } catch { return ""; } };
// A local app is recognised by its default port on this machine.
function localAppAt(u) {
  if (!LOOPBACK.has(u.hostname.toLowerCase())) return null;
  return SPARK_PROVIDERS.find((p) => p.kind === "local" && portOf(p.baseUrl) === u.port) || null;
}

/** The catalog provider an endpoint URL belongs to, or null. */
export function providerForUrl(url) {
  const u = trimUrl(url);
  const exact = SPARK_PROVIDERS.find((p) => p.baseUrl === u);
  if (exact) return exact;
  try { return localAppAt(new URL(u)); } catch { return null; }
}

// A pasted URL is either one of ours (a hint, or a local app's endpoint) or a
// custom OpenAI-compatible endpoint. Random links in a pasted file are ignored
// unless they look like an API base (…/v1, …/openai) or point at this machine.
function classifyUrl(raw) {
  let u;
  try { u = new URL(raw.replace(/[),.;:'"\]]+$/, "")); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const app = localAppAt(u);
  if (app) {
    const path = u.pathname.replace(/\/+$/, "") || new URL(app.baseUrl).pathname;
    return { provider: app, baseUrl: `${u.protocol}//${u.host}${path}` };
  }
  for (const p of SPARK_PROVIDERS) {
    if (p.domains.some((d) => host === d || host.endsWith("." + d))) return { hint: p };
  }
  const path = u.pathname.replace(/\/+$/, "");
  if (LOOPBACK.has(host) || /\/(v\d+(beta\d*)?|openai)(\/|$)/i.test(path + "/")) {
    return { custom: `${u.protocol}//${u.host}${path}` };
  }
  return null;
}

// Earliest provider name mentioned on a line ("SAMBANOVA_API_KEY=", "groq:").
function hintOf(line) {
  let best = null, at = Infinity;
  for (const p of SPARK_PROVIDERS) {
    const m = p.hint.exec(line);
    if (m && m.index < at) { best = p; at = m.index; }
  }
  return best;
}

// Long, mixed letters+digits, with one long unbroken run: keys look like that,
// model names ("llama-3.3-70b-versatile") and env var names don't.
function looksSecret(tok) {
  if (UUID_RE.test(tok)) return true;
  if (!/[0-9]/.test(tok) || !/[A-Za-z]/.test(tok)) return false;
  return tok.split(/[-_]/).some((part) => part.length >= 16);
}

/**
 * Find everything usable in a blob of pasted text. Keys are attributed by
 * their format (csk-, gsk_, AIza, sk-or-v1-), then by a provider named on the
 * same or previous line. A key is only ever matched to one provider: nothing
 * here guesses by trying a key against several services.
 * @returns {{pass:string|null, links:object[], unknown:string[], notes:string[]}}
 */
export function detectInput(text) {
  const out = { pass: null, links: [], unknown: [], notes: [] };
  const src = String(text || "");
  const passMatch = new RegExp(PASS_SRC).exec(src);
  if (passMatch) out.pass = passMatch[0];

  const seenKeys = new Set();
  const add = (link) => {
    if (link.apiKey) {
      if (seenKeys.has(link.apiKey)) return;
      seenKeys.add(link.apiKey);
    }
    const prev = out.links.find((l) => sameUrl(l.baseUrl, link.baseUrl));
    if (!prev) { out.links.push(link); return; }
    if (!prev.apiKey && link.apiKey) prev.apiKey = link.apiKey;
    else if (link.apiKey) out.notes.push(`More than one ${link.name} key; kept the first.`);
  };
  const mk = (p, apiKey, source, baseUrl) => ({ name: p.id, baseUrl: baseUrl || p.baseUrl, apiKey: apiKey || "", model: "", source });
  const custom = (baseUrl, apiKey) => ({ name: "custom", baseUrl, apiKey: apiKey || "", model: "", source: "url" });

  // A line that only names a provider ("SambaNova:") or only holds an endpoint
  // lends that context to the next line, where the key usually sits.
  let pending = null;
  for (const rawLine of src.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const line = rawLine.replace(new RegExp(PASS_SRC, "g"), " ");
    const words = line.replace(new RegExp(URL_SRC, "g"), " ");
    let rest = words;
    let keys = 0;

    for (const p of SPARK_PROVIDERS) {
      if (!p.key) continue;
      for (const m of rest.matchAll(new RegExp(p.key.source, "g"))) {
        add(mk(p, m[0], "key"));
        rest = rest.replace(m[0], " ");
        keys++;
      }
    }

    let ownEndpoint = null, urlHint = null;
    for (const m of line.matchAll(new RegExp(URL_SRC, "g"))) {
      const c = classifyUrl(m[0]);
      if (!c) continue;
      if (c.provider) { add(mk(c.provider, "", "url", c.baseUrl)); keys++; }
      else if (c.custom) ownEndpoint = ownEndpoint || c.custom;
      else if (c.hint) urlHint = urlHint || c.hint;
    }

    const ownHint = hintOf(rest) || urlHint;
    const endpoint = ownEndpoint || (!ownHint && pending && pending.custom) || null;
    const hint = ownHint || (!ownEndpoint && pending && pending.hint) || null;

    let secrets = 0;
    for (const m of rest.matchAll(new RegExp(SECRET_SRC, "g"))) {
      const tok = m[0];
      if (!looksSecret(tok) || seenKeys.has(tok)) continue;
      secrets++;
      if (endpoint) add(custom(endpoint, tok));
      else if (hint && hint.kind !== "local" && (!hint.key || hint.hintKeys)) add(mk(hint, tok, "hint"));
      else if (!hint && UUID_RE.test(tok)) add(mk(providerById("sambanova"), tok, "guess"));
      else out.unknown.push(mask(tok));
    }

    if (pending) {
      const consumed = secrets > 0 && ((pending.custom && endpoint === pending.custom) || (pending.hint && hint === pending.hint));
      if (!consumed && pending.custom) add(custom(pending.custom));
      pending = null;
    }
    if (!secrets && !keys) {
      if (ownEndpoint) pending = { custom: ownEndpoint };
      else if (ownHint) pending = { hint: ownHint };
    } else if (ownEndpoint && !secrets) {
      add(custom(ownEndpoint));
    }
  }
  if (pending && pending.custom) add(custom(pending.custom));
  return out;
}

// Ranked by how well each model drives a tool-calling coding loop on free
// tiers. Model menus change constantly; anything unmatched falls back to the
// first listed model, and the user can always pick another.
const MODEL_PREFS = [
  /qwen-?3-coder/i, /gpt-oss-120b/i, /devstral/i, /gemini-[3-9][\d.]*-flash(?!-lite)/i,
  /gemini-2\.5-flash(?!-lite)/i, /kimi-k2/i, /deepseek-v3/i, /llama-?3\.3-70b/i, /qwen-?3-235b/i,
  /glm-4\.[5-9]/i, /llama-4-maverick/i, /codestral/i, /qwen-?3-32b/i, /mistral-(large|medium)/i,
  /llama-4-scout/i, /qwen2\.5-coder/i, /qwen-?3/i, /llama-?3\.[123]/i,
  // Paid APIs: the cheaper capable model, since they're the last resort.
  /deepseek-chat/i, /gpt-5-mini/i, /gpt-4\.1-mini/i, /gpt-4o-mini/i, /grok-code-fast/i, /grok-4/i,
];
const UNSTABLE = /preview|experimental|\bexp\b|-exp-|beta/i;

/** Pick the model Spark would choose for a provider from its live model list. */
export function bestModel(models, providerId = "") {
  const list = (models || []).filter(Boolean);
  if (!list.length) return "";
  let pool = list;
  if (providerId === "openrouter") {
    const free = list.filter((m) => /:free$/.test(m));
    if (free.length) pool = free;
  }
  for (const re of MODEL_PREFS) {
    const hits = pool.filter((m) => re.test(m));
    if (hits.length) return hits.find((m) => !UNSTABLE.test(m)) || hits[0];
  }
  return pool[0];
}

/** Free cloud tiers fastest-first, then custom endpoints, then this computer, then paid APIs. */
export function orderChain(links) {
  const band = { free: 0, local: 200, paid: 300 };
  const rank = (l) => {
    const i = SPARK_PROVIDERS.findIndex((p) => p.id === l.name);
    return i < 0 ? 100 : band[SPARK_PROVIDERS[i].kind] + i;
  };
  return links.map((l, i) => [l, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

// ---- Lantern Pass ----
// lantern1.r.<base64url(json)>                      recipe: endpoints + models, no keys
// lantern1.s.<base64url(salt16 | iv12 | ciphertext)> sealed: AES-256-GCM, PBKDF2-SHA256 key

const AAD = new TextEncoder().encode("lantern1.s");

function b64u(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function cryptoOf(c) {
  const impl = c || globalThis.crypto;
  if (!impl || !impl.subtle) throw new Error("Sealed passes need WebCrypto. Open Lantern over https, localhost, or from a file.");
  return impl;
}
async function passKey(passphrase, salt, c) {
  const base = await c.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return c.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PASS_ITERATIONS },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}
function passError(message, code) {
  const e = new Error(message);
  if (code) e.code = code;
  return e;
}

/** A random passphrase like "K7QM-2XTP-9WRE-HN4D" (~78 bits, no look-alike characters). */
export function generatePassphrase(c) {
  const abc = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const impl = c || globalThis.crypto;
  let out = "";
  while (out.length < 16) {
    for (const b of impl.getRandomValues(new Uint8Array(24))) {
      if (b < 240 && out.length < 16) out += abc[b % abc.length];
    }
  }
  return out.match(/.{4}/g).join("-");
}

/**
 * Pack a chain into a pass. Sealed passes carry the keys, encrypted;
 * recipes carry only endpoints and models, so they're safe to share.
 */
export async function makePass(chain, { passphrase = "", sealed = true, crypto } = {}) {
  const links = (chain || []).filter((p) => p && p.baseUrl).map((p) => {
    const link = { name: p.name || "custom", baseUrl: trimUrl(p.baseUrl), model: p.model || "" };
    if (sealed && p.apiKey && p.apiKey !== "local") link.apiKey = p.apiKey;
    return link;
  });
  if (!links.length) throw passError("There's no chain to pack yet. Save one first.");
  const body = new TextEncoder().encode(JSON.stringify({ v: 1, links }));
  if (!sealed) return "lantern1.r." + b64u(body);
  if (String(passphrase).length < MIN_PASSPHRASE) {
    throw passError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`, "WEAK_PASSPHRASE");
  }
  const c = cryptoOf(crypto);
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await passKey(String(passphrase), salt, c);
  const ct = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, body));
  const all = new Uint8Array(salt.length + iv.length + ct.length);
  all.set(salt, 0); all.set(iv, 16); all.set(ct, 28);
  return "lantern1.s." + b64u(all);
}

// Whatever a pass claims, a link's provider is decided by its URL — so a
// shared recipe can't label a stranger's server "groq" and collect your key.
function cleanLink(l) {
  if (!l || typeof l.baseUrl !== "string" || !/^https?:\/\//i.test(l.baseUrl) || l.baseUrl.length > 300) return null;
  const baseUrl = trimUrl(l.baseUrl);
  const p = providerForUrl(baseUrl);
  const link = { name: p ? p.id : "custom", baseUrl, model: typeof l.model === "string" ? l.model.slice(0, 200) : "", apiKey: "" };
  if (typeof l.apiKey === "string" && l.apiKey.length <= 500) link.apiKey = l.apiKey;
  return link;
}

/** Open a pass. Throws with code NEED_PASSPHRASE / BAD_PASSPHRASE for sealed passes. */
export async function openPass(pass, { passphrase = "", crypto } = {}) {
  const m = new RegExp(PASS_SRC).exec(String(pass || ""));
  if (!m) throw passError("That isn't a Lantern Pass.");
  const [, kind, data] = m[0].split(".");
  const damaged = () => passError("This Lantern Pass is damaged. Copy it again, all the way to the end.");
  let bytes;
  try { bytes = unb64u(data); } catch { throw damaged(); }
  let json;
  if (kind === "r") {
    json = new TextDecoder().decode(bytes);
  } else {
    if (!passphrase) throw passError("This pass is sealed. Enter its passphrase.", "NEED_PASSPHRASE");
    if (bytes.length < 16 + 12 + 16) throw damaged();
    const c = cryptoOf(crypto);
    const key = await passKey(String(passphrase), bytes.slice(0, 16), c);
    try {
      json = new TextDecoder().decode(await c.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(16, 28), additionalData: AAD }, key, bytes.slice(28)));
    } catch {
      throw passError("Wrong passphrase, or the pass was altered.", "BAD_PASSPHRASE");
    }
  }
  let obj;
  try { obj = JSON.parse(json); } catch { throw damaged(); }
  if (!obj || obj.v !== 1 || !Array.isArray(obj.links)) throw passError("This pass was made by a newer Lantern. Update and try again.");
  const links = obj.links.map(cleanLink).filter(Boolean);
  if (kind === "r") for (const l of links) l.apiKey = "";
  return { sealed: kind === "s", links };
}

export function passLink(base, pass) {
  return String(base || "").replace(/#.*$/, "") + "#pass=" + pass;
}

export function passFromHash(hash) {
  const m = /(?:^#|&)pass=([^&]+)/.exec(String(hash || ""));
  if (!m) return null;
  let v;
  try { v = decodeURIComponent(m[1]); } catch { return null; }
  const p = new RegExp("^" + PASS_SRC + "$").exec(v);
  return p ? p[0] : null;
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`No answer after ${Math.round(ms / 1000)}s.`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

async function checkLink(link, test, ms) {
  if (!link.apiKey && link.name !== "custom" && !isLoopback(link.baseUrl)) {
    link.ok = false;
    link.needsKey = true;
    link.error = `Paste your ${link.name} key here, then Test.`;
    return;
  }
  try {
    const models = await withTimeout(Promise.resolve(test(link)), ms);
    link.models = models;
    link.model = link.model && models.includes(link.model) ? link.model : bestModel(models, link.name);
    link.ok = true;
  } catch (e) {
    link.ok = false;
    link.error = String((e && e.message) || e);
  }
}

/**
 * Look for AI apps running on this computer by asking each known local port
 * for its model list. probe(link) resolves to the models (an empty list means
 * the app is running but has none loaded) or throws when nothing answers.
 * @returns {Promise<{id,label,baseUrl,running,models,model,howTo,signup}[]>}
 */
export async function discoverLocal({ probe, timeoutMs = 2500 } = {}) {
  const apps = SPARK_PROVIDERS.filter((p) => p.kind === "local");
  return Promise.all(apps.map(async (p) => {
    const found = { id: p.id, label: p.label, baseUrl: p.baseUrl, running: false, models: [], model: "", howTo: p.howTo, signup: p.signup };
    try {
      const models = await withTimeout(Promise.resolve(probe({ name: p.id, baseUrl: p.baseUrl, apiKey: "" })), timeoutMs);
      found.running = true;
      found.models = Array.isArray(models) ? models : [];
      found.model = bestModel(found.models, p.id);
    } catch { /* not running here */ }
    return found;
  }));
}

/**
 * The whole Spark flow: detect, open any pass, reuse saved keys, test every
 * link in parallel, pick models, look for AI running on this computer, order the chain.
 * @param {object} o
 * @param {string} o.text  whatever the user pasted
 * @param {string} [o.passphrase]  for a sealed pass
 * @param {object[]} [o.existing]  the saved chain; its keys fill gaps (marked keyFrom:"saved")
 * @param {(link:object)=>Promise<string[]>} [o.test]  list a link's models, or throw
 * @param {boolean} [o.probeLocal]  also look for AI apps running on this computer
 * @param {(link:object)=>Promise<string[]>} [o.probe]  like test, for local apps (defaults to test)
 * @param {boolean} [o.verify]  false = don't contact anything, just parse
 * @param {Crypto} [o.crypto]  WebCrypto implementation (defaults to globalThis.crypto)
 */
export async function spark({ text = "", passphrase = "", existing = [], test, probe, probeLocal = false, verify = true, crypto, timeoutMs = 15_000 } = {}) {
  const found = detectInput(text);
  let links = found.links.map((l) => ({ ...l }));
  let from = "paste";
  if (found.pass) {
    const opened = await openPass(found.pass, { passphrase, crypto });
    from = opened.sealed ? "sealed pass" : "recipe pass";
    const merged = opened.links.map((l) => ({ ...l, source: "pass" }));
    for (const l of links) {
      const twin = merged.find((x) => sameUrl(x.baseUrl, l.baseUrl));
      if (!twin) merged.push(l);
      else if (!twin.apiKey && l.apiKey) twin.apiKey = l.apiKey;
    }
    links = merged;
  }
  for (const l of links) {
    if (l.apiKey) continue;
    const saved = (existing || []).find((x) => x && sameUrl(x.baseUrl, l.baseUrl) && x.apiKey && x.apiKey !== "local");
    if (saved) { l.apiKey = saved.apiKey; l.keyFrom = "saved"; }
  }

  const live = verify && typeof test === "function";
  const scan = live && probeLocal ? discoverLocal({ probe: probe || test }) : Promise.resolve([]);
  const checks = live ? Promise.all(links.map((l) => checkLink(l, test, timeoutMs))) : Promise.resolve();
  const [local] = await Promise.all([scan, checks]);
  const localFound = [];
  for (const app of local) {
    if (!app.running || !app.models.length || links.some((l) => portOf(l.baseUrl) === portOf(app.baseUrl) && isLoopback(l.baseUrl))) continue;
    links.push({ name: app.id, baseUrl: app.baseUrl, apiKey: "", model: app.model, models: app.models, ok: true, source: "detected" });
    localFound.push(app.label);
  }

  return { links: orderChain(links), unknown: found.unknown, notes: found.notes, from, localFound, local };
}
