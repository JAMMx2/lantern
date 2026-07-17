import http from "node:http";
import { promises as fs } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { loadConfig, saveConfig, nameFor } from "./config.js";
import { listModels } from "./cerebras.js";
import { runAgent } from "./agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");

const MAX_BODY = 5 * 1024 * 1024; // 5 MB request cap

// Per-run secret. Injected into the served page and required on every /api/*
// call. A malicious website in the same browser can POST to localhost, but the
// same-origin policy stops it from reading this token out of our HTML — so it
// can't forge an approved request. Defeats CSRF / DNS-rebinding against a tool
// that can run shell commands.
const SESSION_TOKEN = randomUUID();

// Bridges the streaming /api/chat request and the separate /api/approve request.
const pendingApprovals = new Map(); // id -> resolve(boolean)

// Per-browser-session conversation transcripts (sessionId -> messages[]).
const sessions = new Map();
const MAX_SESSIONS = 50;
function getConversation(sessionId) {
  const id = sessionId || "default";
  if (!sessions.has(id)) {
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    sessions.set(id, []);
  }
  return sessions.get(id);
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

  try {
    await runAgent({
      providers,
      root,
      conversation: getConversation(payload.sessionId),
      message: String(payload.message || ""),
      emit,
      requestApproval,
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
      configured: Boolean(cfg.providers && cfg.providers.length),
      // Never echo API keys back to the page.
      providers: (cfg.providers || []).map((p) => ({
        name: p.name, baseUrl: p.baseUrl, model: p.model, hasKey: Boolean(p.apiKey && p.apiKey !== "local"),
      })),
      cwd: cfg.lastCwd && existsSync(cfg.lastCwd) ? cfg.lastCwd : process.cwd(),
    });
  }

  // Validate one endpoint and list its usable models (no persistence).
  if (req.method === "POST" && url === "/api/provider/test") {
    const body = await readBody(req);
    const baseUrl = String(body.baseUrl || "").trim();
    const apiKey = String(body.apiKey || "").trim() || "local";
    if (!baseUrl) return send(res, 400, { error: "Missing endpoint URL." });
    try {
      const models = await listModels(apiKey, baseUrl);
      return send(res, 200, { ok: true, models });
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

export function startServer(port = 4317) {
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
        startServer(port + 1).then(res);
      } else {
        throw e;
      }
    });
  });
}
