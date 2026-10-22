// Spark: turn whatever the user pastes (keys, a .env file, endpoint URLs, a
// Lantern Pass) into a tested, ordered relay chain.
// Lantern Pass: a whole chain as one string, sealed with a passphrase.
//
// Shared by both builds. The app imports this file; lantern-lite.html embeds
// a copy between its <spark> markers — run `npm run sync-lite` after editing.
// Keep it free of Node and DOM APIs: web standards only (WebCrypto is passed in).

export const SPARK_PROVIDERS = [
  { id: "cerebras", baseUrl: "https://api.cerebras.ai/v1", key: /\bcsk-[A-Za-z0-9]{20,}(?![A-Za-z0-9])/, hint: /cerebras/i, domains: ["cerebras.ai"], signup: "https://cloud.cerebras.ai/", note: "~1M tokens/day free · fastest" },
  { id: "groq", baseUrl: "https://api.groq.com/openai/v1", key: /\bgsk_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/, hint: /groq/i, domains: ["groq.com"], signup: "https://console.groq.com/keys", note: "14.4k requests/day free · very fast" },
  { id: "sambanova", baseUrl: "https://api.sambanova.ai/v1", key: null, hint: /samba/i, domains: ["sambanova.ai"], signup: "https://cloud.sambanova.ai/", note: "free tier · big models, fast" },
  { id: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", key: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/, hint: /gemini|google|ai ?studio/i, domains: ["googleapis.com", "aistudio.google.com"], signup: "https://aistudio.google.com/apikey", note: "generous free tier" },
  { id: "mistral", baseUrl: "https://api.mistral.ai/v1", key: null, hint: /mistral|codestral|devstral/i, domains: ["mistral.ai"], signup: "https://console.mistral.ai/api-keys", note: "free Experiment plan · Devstral" },
  { id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", key: /\bsk-or-v1-[A-Za-z0-9]{32,}(?![A-Za-z0-9])/, hint: /openrouter/i, domains: ["openrouter.ai"], signup: "https://openrouter.ai/keys", note: ":free models from many labs" },
  { id: "ollama", baseUrl: "http://localhost:11434/v1", key: null, hint: /ollama/i, domains: ["ollama.com"], signup: "https://ollama.com/download", note: "local · free forever · no key", local: true },
];

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

/** The catalog provider an endpoint URL belongs to, or null. */
export function providerForUrl(url) {
  const u = trimUrl(url);
  const exact = SPARK_PROVIDERS.find((p) => p.baseUrl === u);
  if (exact) return exact;
  try {
    const parsed = new URL(u);
    if (LOOPBACK.has(parsed.hostname) && parsed.port === "11434") return providerById("ollama");
  } catch { /* not a URL */ }
  return null;
}

// A pasted URL is either one of ours (a hint, or a local Ollama endpoint) or a
// custom OpenAI-compatible endpoint. Random links in a pasted file are ignored
// unless they look like an API base (…/v1, …/openai) or point at this machine.
function classifyUrl(raw) {
  let u;
  try { u = new URL(raw.replace(/[),.;:'"\]]+$/, "")); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (LOOPBACK.has(host) && u.port === "11434") {
    return { provider: providerById("ollama"), baseUrl: `${u.protocol}//${u.host}/v1` };
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
      else if (hint && !hint.key && !hint.local) add(mk(hint, tok, "hint"));
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

/** Cloud tiers fastest-first, custom endpoints next, local Ollama last. */
export function orderChain(links) {
  const rank = (l) => {
    if (l.name === "ollama") return 100;
    const i = SPARK_PROVIDERS.findIndex((p) => p.id === l.name);
    return i < 0 ? 50 : i;
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
 * The whole Spark flow: detect, open any pass, reuse saved keys, test every
 * link in parallel, pick models, look for a local Ollama, order the chain.
 * @param {object} o
 * @param {string} o.text  whatever the user pasted
 * @param {string} [o.passphrase]  for a sealed pass
 * @param {object[]} [o.existing]  the saved chain; its keys fill gaps (marked keyFrom:"saved")
 * @param {(link:object)=>Promise<string[]>} [o.test]  list a link's models, or throw
 * @param {boolean} [o.probeLocal]  also look for Ollama on this machine
 * @param {boolean} [o.verify]  false = don't contact anything, just parse
 * @param {Crypto} [o.crypto]  WebCrypto implementation (defaults to globalThis.crypto)
 */
export async function spark({ text = "", passphrase = "", existing = [], test, probeLocal = false, verify = true, crypto, timeoutMs = 15_000 } = {}) {
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
  const ollama = providerById("ollama");
  const probe = live && probeLocal && !links.some((l) => l.name === ollama.id)
    ? (async () => {
        const cand = { name: ollama.id, baseUrl: ollama.baseUrl, apiKey: "", model: "", source: "detected" };
        try {
          cand.models = await withTimeout(Promise.resolve(test(cand)), 2500);
          cand.model = bestModel(cand.models, cand.name);
          cand.ok = true;
          return cand;
        } catch { return null; }
      })()
    : Promise.resolve(null);
  const checks = live ? Promise.all(links.map((l) => checkLink(l, test, timeoutMs))) : Promise.resolve();
  const [local] = await Promise.all([probe, checks]);
  if (local) links.push(local);

  return { links: orderChain(links), unknown: found.unknown, notes: found.notes, from, localFound: Boolean(local) };
}
