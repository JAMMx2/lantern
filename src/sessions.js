// Persistent conversation history: one JSON file per session under
// ~/.lantern/sessions/. Lets you close the browser and pick a chat back up,
// and carries the /undo stack for file changes made in that chat.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.js";

const DIR = join(CONFIG_DIR, "sessions");
export const MAX_SESSIONS = 100;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function validId(id) {
  return ID_RE.test(String(id || ""));
}

function fileFor(id) {
  if (!validId(id)) throw new Error("Bad session id.");
  return join(DIR, `${id}.json`);
}

export function newSession(id, cwd = "") {
  const now = Date.now();
  return { id, title: "", cwd, createdAt: now, updatedAt: now, messages: [], undo: [], usage: { prompt: 0, completion: 0 } };
}

export async function loadSession(id) {
  try {
    const raw = await fs.readFile(fileFor(id), "utf8");
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.messages)) return null;
    s.undo = Array.isArray(s.undo) ? s.undo : [];
    s.usage = s.usage && typeof s.usage === "object" ? s.usage : { prompt: 0, completion: 0 };
    return s;
  } catch {
    return null;
  }
}

export function titleOf(session) {
  if (session.title) return session.title;
  const first = session.messages.find((m) => m.role === "user" && m.content);
  return first ? String(first.content).replace(/\s+/g, " ").slice(0, 70) : "(empty chat)";
}

export async function saveSession(session) {
  if (!session.messages.length) return; // nothing worth keeping yet
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  session.updatedAt = Date.now();
  session.title = titleOf(session);
  await fs.writeFile(fileFor(session.id), JSON.stringify(session), { mode: 0o600 });
  await prune();
}

export async function deleteSession(id) {
  try { await fs.rm(fileFor(id), { force: true }); return true; } catch { return false; }
}

export async function listSessions() {
  let names = [];
  try { names = await fs.readdir(DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const s = await loadSession(n.slice(0, -5));
    if (!s) continue;
    out.push({
      id: s.id,
      title: titleOf(s),
      cwd: s.cwd || "",
      updatedAt: s.updatedAt,
      createdAt: s.createdAt,
      messages: s.messages.filter((m) => m.role === "user" || m.role === "assistant").length,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

async function prune() {
  const all = await listSessions();
  for (const s of all.slice(MAX_SESSIONS)) await deleteSession(s.id);
}
