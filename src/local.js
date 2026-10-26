// AI apps already on this computer: which are installed, starting the ones
// that can be started without a terminal, and downloading an Ollama model.
// Nothing here runs on its own; each action is a button the user clicks in
// setup, and every command is fixed (no user text reaches a command line).
import { existsSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { homedir, totalmem } from "node:os";
import { SPARK_PROVIDERS } from "./spark.js";

const OLLAMA_API = "http://127.0.0.1:11434";
export const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._/-]{0,80}(:[a-z0-9._-]{1,40})?$/i;

// Where each app usually lives. "~" is the home folder; %LOCALAPPDATA% is the
// per-user programs folder on Windows. Best effort: a miss only means the app
// isn't mentioned until it's running.
const PLACES = {
  ollama: {
    darwin: ["/Applications/Ollama.app"],
    win32: ["%LOCALAPPDATA%/Programs/Ollama/ollama app.exe"],
    linux: ["/usr/local/bin/ollama", "/usr/bin/ollama", "~/.local/bin/ollama"],
  },
  lmstudio: {
    all: ["~/.lmstudio/bin/lms", "~/.lmstudio/bin/lms.exe", "~/.cache/lm-studio/bin/lms"],
    darwin: ["/Applications/LM Studio.app"],
    win32: ["%LOCALAPPDATA%/Programs/LM Studio/LM Studio.exe"],
  },
  jan: {
    darwin: ["/Applications/Jan.app"],
    win32: ["%LOCALAPPDATA%/Programs/jan/Jan.exe", "%LOCALAPPDATA%/Programs/Jan/Jan.exe"],
    linux: ["~/.config/Jan"],
  },
  gpt4all: { all: ["~/gpt4all"], darwin: ["/Applications/gpt4all"] },
  msty: {
    darwin: ["/Applications/Msty.app", "/Applications/Msty Studio.app"],
    win32: ["%LOCALAPPDATA%/Programs/Msty/Msty.exe", "%LOCALAPPDATA%/Programs/Msty Studio/Msty Studio.exe"],
  },
  docker: { darwin: ["/Applications/Docker.app"], win32: ["C:/Program Files/Docker/Docker/Docker Desktop.exe"] },
};

const labelOf = (id) => (SPARK_PROVIDERS.find((p) => p.id === id) || {}).label || id;

function context(opts) {
  return {
    platform: opts.platform || process.platform,
    home: opts.home || homedir(),
    env: opts.env || process.env,
    exists: opts.exists || existsSync,
  };
}

function expand(path, { home, env }) {
  return path
    .replace(/^~(?=\/|$)/, home)
    .replace("%LOCALAPPDATA%", env.LOCALAPPDATA || `${home}/AppData/Local`);
}

function where(id, ctx) {
  const spots = [...(PLACES[id]?.all || []), ...(PLACES[id]?.[ctx.platform] || [])];
  return spots.map((p) => expand(p, ctx)).find((p) => ctx.exists(p)) || "";
}

/** { appId: path } for each AI app found installed on this computer. */
export function installedApps(opts = {}) {
  const ctx = context(opts);
  const out = {};
  for (const id of Object.keys(PLACES)) {
    const at = where(id, ctx);
    if (at) out[id] = at;
  }
  return out;
}

/**
 * What a button can do for an installed app that isn't answering yet:
 * { label, cmd, args }, or null when only the app's own window can switch it on.
 */
export function startPlan(id, opts = {}) {
  const ctx = context(opts);
  const at = where(id, ctx);
  if (!at) return null;
  if (id === "ollama") {
    if (ctx.platform === "darwin") return { label: "Start Ollama", cmd: "open", args: [at] };
    return { label: "Start Ollama", cmd: at, args: ctx.platform === "win32" ? [] : ["serve"] };
  }
  if (id === "lmstudio" && /\/lms(\.exe)?$/.test(at)) {
    return { label: "Start LM Studio's server", cmd: at, args: ["server", "start"] };
  }
  if (ctx.platform === "darwin" && at.endsWith(".app")) return { label: `Open ${labelOf(id)}`, cmd: "open", args: [at] };
  if (ctx.platform === "win32" && at.endsWith(".exe")) return { label: `Open ${labelOf(id)}`, cmd: at, args: [] };
  return null;
}

/** Run an app's start plan, detached so it keeps running after Lantern closes. */
export function startApp(id, opts = {}) {
  const plan = startPlan(id, opts);
  if (!plan) return Promise.reject(new Error(`Lantern can't start ${labelOf(id)} from here. ${SPARK_PROVIDERS.find((p) => p.id === id)?.howTo || ""}`.trim()));
  const spawn = opts.spawn || nodeSpawn;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(plan.cmd, plan.args, { detached: true, stdio: "ignore", windowsHide: true });
    } catch (e) {
      reject(new Error(`Couldn't start ${labelOf(id)}: ${e.message}`));
      return;
    }
    child.on("error", (e) => reject(new Error(`Couldn't start ${labelOf(id)}: ${e.message}`)));
    child.on("spawn", () => { child.unref(); resolve(plan); });
  });
}

/** This computer's memory in GB, for sizing the model download. */
export function ramGB() {
  return Math.round(totalmem() / 2 ** 30);
}

/**
 * Download a model into Ollama through its own API, the same thing
 * `ollama pull` does. onProgress({status, total, completed}) fires as it goes.
 */
export async function pullOllama(model, { base = OLLAMA_API, onProgress = () => {}, signal } = {}) {
  if (!MODEL_NAME_RE.test(String(model || ""))) throw new Error("That doesn't look like an Ollama model name.");
  let res;
  try {
    res = await fetch(`${base}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, name: model, stream: true }),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("Ollama isn't running. Open the Ollama app, then try again.");
  }
  if (!res.ok) throw new Error(`Ollama refused the download (HTTP ${res.status}).`);
  const handle = (line) => {
    if (!line.trim()) return;
    let evt;
    try { evt = JSON.parse(line); } catch { return; }
    if (evt.error) throw new Error(`Ollama: ${evt.error}`);
    onProgress({ status: String(evt.status || ""), total: Number(evt.total) || 0, completed: Number(evt.completed) || 0 });
  };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  handle(buf);
}
