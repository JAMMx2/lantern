import http from "node:http";
import { promises as fs } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { randomUUID, webcrypto } from "node:crypto";

import { loadConfig, saveConfig, nameFor } from "./config.js";
import { listModels } from "./cerebras.js";
import { runAgent } from "./agent.js";
import { undoLast } from "./tools.js";
import { newSession, loadSession, saveSession, listSessions, deleteSession, validId } from "./sessions.js";
import { spark, makePass, passLink, bestModel, SPARK_PROVIDERS } from "./spark.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");
const PKG = JSON.parse(await fs.readFile(join(__dirname, "..", "package.json"), "utf8"));
export const VERSION = PKG.version;
// Where a Lantern Pass link opens: the hosted Lite (a fork's own Pages URL if it changed homepage).
const LITE_URL = PKG.homepage || "https://jammx2.github.io/lantern/";
const CATALOG = SPARK_PROVIDERS.map(({ id, baseUrl, signup, note }) => ({ id, baseUrl, signup, note }));

const MAX_BODY = 5 * 1024 * 1024; // 5 MB request cap

// Per-run secret. Injected into the served page and required on every /api/*
// call. A malicious website in the same browser can POST to localhost, but the
// same-origin policy stops it from reading this token out of our HTML — so it
// can't forge an approved request. Defeats CSRF / DNS-rebinding against a tool
// that can run shell commands.
const SESSION_TOKEN = randomUUID();

// Bridges the streaming /api/chat request and the separate /api/approve request.
const pendingApprovals = new Map(); // id -> resolve(boolean)

// Live sessions (sessionId -> session object). Each is also written to
// ~/.lantern/sessions/<id>.json after every step so history survives restarts.
const sessions = new Map();
const MAX_LIVE = 50;
async function getSession(sessionId, cwd) {
  const id = validId(sessionId) ? sessionId : "default";
  if (!sessions.has(id)) {
    if (sessions.size >= MAX_LIVE) sessions.delete(sessions.keys().next().value);
    sessions.set(id, (await loadSession(id)) || newSession(id, cwd));
  }
  const s = sessions.get(id);
  if (cwd) s.cwd = cwd;
  return s;
}

// Shown as a one-line transcript entry when a chat is resumed.
function publicMessages(session) {
  return session.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content || "", tools: (m.tool_calls || []).map((t) => t.function?.name).filter(Boolean) }));
}

function send(res, code, data, type = "application/json") {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req) {
  return new Promise((res, rej) => {
    let data = "";
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        rej(new Error("Request too large."));
        req.destroy();
        return;
      }
      data += c;
    });
    req.on("end", () => {
      try {
        res(data ? JSON.parse(data) : {});
      } catch (e) {
        rej(e);
      }
    });
    req.on("error", rej);
  });
}

async function serveStatic(req, res) {
  let path = req.url.split("?")[0];
  if (path === "/") path = "/index.html";
  const file = join(PUBLIC, path);
  if (!file.startsWith(PUBLIC) || !existsSync(file)) {
    return send(res, 404, "Not found", "text/plain");
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
  };
  const ext = path.slice(path.lastIndexOf("."));
  if (ext === ".html") {
    let html = await fs.readFile(file, "utf8");
    html = html.replace("%%LANTERN_TOKEN%%", SESSION_TOKEN);
    res.writeHead(200, { "Content-Type": types[ext] });
    return res.end(html);
  }
  const buf = await fs.readFile(file);
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  res.end(buf);
}

async function handleChat(req, res) {
  const cfg = loadConfig();
  if (!cfg.providers || !cfg.providers.length) {
    return send(res, 400, { error: "No provider configured." });
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch {
    return send(res, 400, { error: "Bad request body." });
  }

  const root = cfg.lastCwd && existsSync(cfg.lastCwd) ? cfg.lastCwd : process.cwd();
  // The header dropdown picks the primary provider's model per-request.
  const providers = cfg.providers.map((p, i) =>
    i === 0 && payload.model ? { ...p, model: payload.model } : p
  );
  if (!providers[0].model) return send(res, 400, { error: "No model selected." });

  // Stream newline-delimited JSON events as they happen.
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  const emit = (evt) => {
    res.write(JSON.stringify(evt) + "\n");
  };

  // Track only THIS request's pending approvals, so a disconnect here can't
  // cancel a concurrent chat's pending action.
  const myPending = new Set();
  const requestApproval = ({ id }) =>
    new Promise((resolveApproval) => {
      myPending.add(id);
      pendingApprovals.set(id, (allowed) => {
        myPending.delete(id);
        resolveApproval(allowed);
      });
    });

  req.on("close", () => {
    for (const id of myPending) {
      const fn = pendingApprovals.get(id);
      if (fn) fn(false);
      pendingApprovals.delete(id);
    }
  });

  const session = await getSession(payload.sessionId, root);
  try {
    await runAgent({
      providers,
      root,
      session,
      message: String(payload.message || ""),
      emit,
      requestApproval,
      persist: () => saveSession(session),
    });
  } catch (e) {
    emit({ type: "error", message: e.message });
  }
  res.end();
}

function localHost(req) {
  const host = (req.headers.host || "").split(":")[0];
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

async function router(req, res) {
  const url = req.url.split("?")[0];

  // Guard every API route: reject non-localhost Host headers (anti DNS-rebinding)
  // and require the injected session token (anti CSRF from other browser tabs).
  if (url.startsWith("/api/")) {
    if (!localHost(req)) return send(res, 403, { error: "Forbidden." });
    if (req.headers["x-lantern-token"] !== SESSION_TOKEN) {
      return send(res, 403, { error: "Missing or invalid session token." });
    }
  }

  if (req.method === "GET" && url === "/api/config") {
    const cfg = loadConfig();
    return send(res, 200, {
      version: VERSION,
      configured: Boolean(cfg.providers && cfg.providers.length),
      // Never echo API keys back to the page.
      providers: (cfg.providers || []).map((p) => ({
        name: p.name, baseUrl: p.baseUrl, model: p.model, hasKey: Boolean(p.apiKey && p.apiKey !== "local"),
      })),
      cwd: cfg.lastCwd && existsSync(cfg.lastCwd) ? cfg.lastCwd : process.cwd(),
      catalog: CATALOG,
    });
  }

  // Spark: paste anything (keys, a .env, URLs, a Lantern Pass) -> a tested chain
  // for the page to review. Keys come back only if they arrived in this request
  // (typed, or inside a pass the user unlocked); saved keys stay on disk.
  if (req.method === "POST" && url === "/api/spark") {
    const body = await readBody(req);
    try {
      const out = await spark({
        text: String(body.text || "").slice(0, 100_000),
        passphrase: String(body.passphrase || ""),
        existing: loadConfig().providers || [],
        verify: body.verify !== false,
        probeLocal: true,
        crypto: webcrypto,
        test: (l) => listModels(l.apiKey || "local", l.baseUrl),
      });
      for (const l of out.links) {
        if (l.keyFrom === "saved") { delete l.apiKey; l.hasKey = true; }
      }
      return send(res, 200, out);
    } catch (e) {
      if (e.code === "NEED_PASSPHRASE") return send(res, 200, { needPassphrase: true, message: e.message });
      return send(res, 400, { error: e.message, code: e.code });
    }
  }

  // Lantern Pass from the saved chain. Sealed passes are the one way saved keys
  // leave config.json — encrypted under the passphrase the user chose.
  if (req.method === "POST" && url === "/api/pass") {
    const body = await readBody(req);
    const providers = loadConfig().providers || [];
    try {
      const pass = await makePass(providers, {
        passphrase: String(body.passphrase || ""),
        sealed: body.sealed !== false,
        crypto: webcrypto,
      });
      return send(res, 200, { pass, link: passLink(LITE_URL, pass) });
    } catch (e) {
      return send(res, 400, { error: e.message, code: e.code });
    }
  }

  // Validate one endpoint and list its usable models (no persistence).
  if (req.method === "POST" && url === "/api/provider/test") {
    const body = await readBody(req);
    const baseUrl = String(body.baseUrl || "").trim();
    const apiKey = String(body.apiKey || "").trim() || "local";
    if (!baseUrl) return send(res, 400, { error: "Missing endpoint URL." });
    try {
      const models = await listModels(apiKey, baseUrl);
      return send(res, 200, { ok: true, models, best: bestModel(models, nameFor(baseUrl)) });
    } catch (e) {
      return send(res, 400, { error: `Couldn't connect: ${e.message}` });
    }
  }

  // Save the whole relay chain. Rows may omit apiKey to keep the stored one.
  if (req.method === "POST" && url === "/api/providers") {
    const body = await readBody(req);
    const rows = Array.isArray(body.providers) ? body.providers : [];
    if (!rows.length) return send(res, 400, { error: "Add at least one provider." });
    const prev = loadConfig().providers || [];
    const providers = rows.map((r) => {
      const baseUrl = String(r.baseUrl || "").trim().replace(/\/+$/, "");
      const kept = prev.find((p) => p.baseUrl === baseUrl);
      return {
        name: r.name || nameFor(baseUrl),
        baseUrl,
        apiKey: String(r.apiKey || "").trim() || (kept ? kept.apiKey : "local"),
        model: String(r.model || "").trim() || (kept ? kept.model : ""),
      };
    }).filter((p) => p.baseUrl);
    if (!providers.length) return send(res, 400, { error: "Add at least one provider." });
    saveConfig({ providers });
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url === "/api/models") {
    const cfg = loadConfig();
    const primary = (cfg.providers || [])[0];
    if (!primary) return send(res, 400, { error: "No provider configured." });
    try {
      const models = await listModels(primary.apiKey, primary.baseUrl);
      return send(res, 200, { models });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && url === "/api/model") {
    const { model } = await readBody(req);
    const cfg = loadConfig();
    const providers = cfg.providers || [];
    if (providers.length) {
      providers[0] = { ...providers[0], model: String(model || "") };
      saveConfig({ providers });
    }
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url === "/api/cwd") {
    const { cwd } = await readBody(req);
    const target = resolve(String(cwd || ""));
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      return send(res, 400, { error: "That folder doesn't exist." });
    }
    saveConfig({ lastCwd: target });
    return send(res, 200, { ok: true, cwd: target });
  }

  // ---- history ----
  if (req.method === "GET" && url === "/api/sessions") {
    return send(res, 200, { sessions: await listSessions() });
  }
  if (req.method === "POST" && url === "/api/session/load") {
    const { id } = await readBody(req);
    if (!validId(id)) return send(res, 400, { error: "Bad session id." });
    const session = await getSession(id);
    if (!session.messages.length) return send(res, 404, { error: "No such chat." });
    return send(res, 200, {
      id: session.id, title: session.title, cwd: session.cwd, usage: session.usage,
      undoable: session.undo.length, messages: publicMessages(session),
    });
  }
  if (req.method === "POST" && url === "/api/session/delete") {
    const { id } = await readBody(req);
    if (!validId(id)) return send(res, 400, { error: "Bad session id." });
    sessions.delete(id);
    await deleteSession(id);
    return send(res, 200, { ok: true });
  }
  // /undo — revert the last file change Lantern made in this chat.
  if (req.method === "POST" && url === "/api/undo") {
    const { sessionId } = await readBody(req);
    const session = await getSession(sessionId);
    const cfg = loadConfig();
    const root = session.cwd || (cfg.lastCwd && existsSync(cfg.lastCwd) ? cfg.lastCwd : process.cwd());
    try {
      const msg = await undoLast(root, session.undo);
      if (!msg) return send(res, 200, { ok: false, message: "Nothing to undo in this chat." });
      session.messages.push({ role: "user", content: `(I used /undo: ${msg}.)` });
      session.messages.push({ role: "assistant", content: "Understood, that change was reverted." });
      await saveSession(session);
      return send(res, 200, { ok: true, message: msg, undoable: session.undo.length });
    } catch (e) {
      return send(res, 400, { ok: false, message: e.message });
    }
  }

  if (req.method === "POST" && url === "/api/approve") {
    const { id, allowed } = await readBody(req);
    const fn = pendingApprovals.get(id);
    if (fn) {
      fn(Boolean(allowed));
      pendingApprovals.delete(id);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "No pending action with that id." });
  }

  if (req.method === "POST" && url === "/api/chat") {
    return handleChat(req, res);
  }

  if (req.method === "GET") return serveStatic(req, res);
  return send(res, 404, { error: "Not found" });
}

/**
 * @param {number} port
 * @param {{dir?:string, model?:string}} [opts] CLI overrides, persisted to config.
 */
export function startServer(port = 4317, opts = {}) {
  if (opts.dir) {
    const target = resolve(opts.dir);
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      throw new Error(`--dir: folder does not exist: ${target}`);
    }
    saveConfig({ lastCwd: target });
  }
  if (opts.model) {
    const cfg = loadConfig();
    if (cfg.providers && cfg.providers.length) {
      cfg.providers[0] = { ...cfg.providers[0], model: opts.model };
      saveConfig({ providers: cfg.providers });
    }
  }
  return new Promise((res) => {
    const server = http.createServer((req, rq) =>
      router(req, rq).catch((e) => {
        try {
          send(rq, 500, { error: e.message });
        } catch {}
      })
    );
    server.listen(port, "127.0.0.1", () => res({ server, port }));
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        startServer(port + 1).then(res);  // opts already applied
      } else {
        throw e;
      }
    });
  });
}
