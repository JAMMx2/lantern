// The agent's hands: everything it can do to the folder you picked.
//
// Confinement: every path is resolved against the working folder and its
// real location (symlinks followed) must stay inside it. Mutating tools
// (write_file, edit_file, run_command) are listed in NEEDS_APPROVAL and the
// agent loop stops for an Allow/Deny card before calling them.

import { promises as fs } from "node:fs";
import { execFile, exec } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { unifiedDiff, diffStats } from "./diff.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const READ_CAP = 100_000;        // chars returned by read_file
export const OUTPUT_CAP = 20_000;       // chars returned by run_command / search
export const COMMAND_TIMEOUT_MS = 120_000;
export const SEARCH_MAX_FILES = 4000;
export const SEARCH_MAX_HITS = 200;
export const SKIP_DIRS = new Set([".git", "node_modules", ".hg", ".svn", "dist", "build", ".next", "__pycache__", ".venv", "venv"]);

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and folders inside the working folder. Folders end with '/'.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path. Defaults to the root of the working folder." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the text contents of a file in the working folder.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create a new file or completely overwrite an existing one. Requires the user's approval. For small changes to an existing file prefer edit_file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string", description: "The full new contents of the file." } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace an exact snippet of text inside an existing file. old_text must appear exactly once (or set replace_all). Requires the user's approval; they see a diff.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string", description: "Exact text to find (include enough surrounding lines to be unique)." },
          new_text: { type: "string", description: "Replacement text." },
          replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring exactly one." },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for text (or a regular expression) across files in the working folder. Returns 'path:line: text' matches. Skips .git and node_modules.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text or regex to search for." },
          path: { type: "string", description: "Relative folder to search in. Defaults to the root." },
          regex: { type: "boolean", description: "Treat query as a regular expression." },
          case_sensitive: { type: "boolean" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command inside the working folder (install packages, run scripts, tests, git commits...). Requires the user's approval; they see the exact command.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
  },
  {
    type: "function",
    function: {
      name: "git",
      description: "Read-only git info for the working folder: 'status' (short status), 'diff' (unstaged changes, optionally for one path), or 'log' (last 20 commits). No approval needed because nothing changes.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["status", "diff", "log"] },
          path: { type: "string", description: "Optional relative path to limit diff/log to." },
        },
        required: ["action"],
      },
    },
  },
];

export const NEEDS_APPROVAL = new Set(["write_file", "edit_file", "run_command"]);

export function summarize(name, args = {}) {
  switch (name) {
    case "list_dir": return `List ${args.path && args.path !== "." ? args.path : "the working folder"}`;
    case "read_file": return `Read the file ${args.path}`;
    case "write_file": return `Create or overwrite the file ${args.path}`;
    case "edit_file": return `Edit the file ${args.path}`;
    case "search_files": return `Search for "${String(args.query ?? "").slice(0, 60)}"${args.path ? " in " + args.path : ""}`;
    case "run_command": return `Run: ${String(args.command ?? "").slice(0, 80)}`;
    case "git": return `git ${args.action}${args.path ? " " + args.path : ""}`;
    default: return name;
  }
}

// ---- confinement ----

async function realpathOfExisting(p) {
  // Real path of the deepest existing ancestor (the file itself may not exist yet).
  let cur = p;
  const tail = [];
  for (;;) {
    try {
      const real = await fs.realpath(cur);
      return join(real, ...tail.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) throw new Error("Cannot resolve path.");
      tail.push(cur.slice(parent.length).replace(/^[\\/]/, ""));
      cur = parent;
    }
  }
}

/**
 * Resolve `rel` inside `root`, following symlinks, and refuse anything that
 * lands outside. Returns the absolute path.
 */
export async function resolveInside(root, rel = ".") {
  const r = String(rel ?? ".").trim() || ".";
  if (/\0/.test(r)) throw new Error("Invalid path.");
  const rootReal = await fs.realpath(root);
  const target = resolve(rootReal, r);
  const targetReal = await realpathOfExisting(target);
  if (targetReal !== rootReal && !targetReal.startsWith(rootReal + sep)) {
    throw new Error(`Path is outside the working folder: ${rel}`);
  }
  return targetReal;
}

// ---- tools ----

export async function listDir(root, rel = ".") {
  const abs = await resolveInside(root, rel);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const out = entries
    .map((e) => (e.isDirectory() ? e.name + "/" : e.name))
    .sort((a, b) => a.localeCompare(b));
  return out.join("\n") || "(empty folder)";
}

export async function readFile(root, rel) {
  const abs = await resolveInside(root, rel);
  const st = await fs.stat(abs);
  if (st.isDirectory()) throw new Error(`${rel} is a folder, not a file. Use list_dir.`);
  let text = await fs.readFile(abs, "utf8");
  if (text.length > READ_CAP) text = text.slice(0, READ_CAP) + `\n...(truncated at ${READ_CAP} characters)`;
  return text;
}

async function readIfExists(abs) {
  try { return await fs.readFile(abs, "utf8"); } catch { return null; }
}

/**
 * Build what the approval card shows for a mutating tool. For file writes this
 * includes a unified diff against the current contents when the file exists.
 */
export async function previewFor(name, root, args = {}) {
  if (name === "run_command") return { command: String(args.command ?? "") };
  if (name === "write_file") {
    const abs = await resolveInside(root, args.path);
    const before = await readIfExists(abs);
    const after = String(args.content ?? "");
    const isNew = before === null;
    const stats = isNew ? { added: after.split("\n").length, removed: 0 } : diffStats(before, after);
    return {
      path: args.path,
      isNew,
      preview: isNew ? after.slice(0, 4000) : undefined,
      diff: isNew ? undefined : unifiedDiff(before, after, args.path).slice(0, 6000),
      stats,
    };
  }
  if (name === "edit_file") {
    const abs = await resolveInside(root, args.path);
    const before = await readIfExists(abs);
    if (before === null) return { path: args.path, error: `No such file: ${args.path}` };
    let after;
    try { after = applyEdit(before, args); } catch (e) { return { path: args.path, error: e.message }; }
    return { path: args.path, isNew: false, diff: unifiedDiff(before, after, args.path).slice(0, 6000), stats: diffStats(before, after) };
  }
  return {};
}

export function applyEdit(before, { old_text, new_text, replace_all }) {
  const oldText = String(old_text ?? "");
  const newText = String(new_text ?? "");
  if (!oldText) throw new Error("old_text must not be empty.");
  const first = before.indexOf(oldText);
  if (first < 0) throw new Error("old_text was not found in the file. Read the file again and copy the exact text.");
  if (replace_all) return before.split(oldText).join(newText);
  const second = before.indexOf(oldText, first + oldText.length);
  if (second >= 0) throw new Error("old_text appears more than once. Include more surrounding lines so it is unique, or set replace_all.");
  return before.slice(0, first) + newText + before.slice(first + oldText.length);
}

/**
 * Write a file. `undo` (optional array) receives { path, before } so the
 * change can be reverted with /undo. `before` is null for new files.
 */
export async function writeFile(root, rel, content, undo) {
  const abs = await resolveInside(root, rel);
  const before = await readIfExists(abs);
  await fs.mkdir(dirname(abs), { recursive: true });
  await fs.writeFile(abs, String(content ?? ""), "utf8");
  if (undo) undo.push({ path: rel, before, at: Date.now() });
  const text = String(content ?? "");
  return `${before === null ? "Created" : "Updated"} ${rel} (${text.length} characters, ${text.split("\n").length} lines)`;
}

export async function editFile(root, args, undo) {
  const abs = await resolveInside(root, args.path);
  const before = await readIfExists(abs);
  if (before === null) throw new Error(`No such file: ${args.path}`);
  const after = applyEdit(before, args);
  await fs.writeFile(abs, after, "utf8");
  if (undo) undo.push({ path: args.path, before, at: Date.now() });
  const s = diffStats(before, after);
  return `Edited ${args.path} (+${s.added ?? "?"} / -${s.removed ?? "?"} lines)`;
}

/** Revert the most recent write/edit. Returns a description, or null when nothing to undo. */
export async function undoLast(root, undo) {
  if (!undo || !undo.length) return null;
  const last = undo.pop();
  const abs = await resolveInside(root, last.path);
  if (last.before === null) {
    await fs.rm(abs, { force: true });
    return `Removed ${last.path} (it was created by Lantern)`;
  }
  await fs.writeFile(abs, last.before, "utf8");
  return `Restored ${last.path} to its previous contents`;
}

export async function searchFiles(root, { query, path: rel = ".", regex = false, case_sensitive = false } = {}) {
  if (!query) throw new Error("query is required.");
  const base = await resolveInside(root, rel);
  const rootReal = await fs.realpath(root);
  let re;
  try {
    re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), case_sensitive ? "" : "i");
  } catch (e) {
    throw new Error(`Bad regular expression: ${e.message}`);
  }
  const hits = [];
  let scanned = 0;
  async function walk(dir) {
    if (hits.length >= SEARCH_MAX_HITS || scanned >= SEARCH_MAX_FILES) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (hits.length >= SEARCH_MAX_HITS || scanned >= SEARCH_MAX_FILES) return;
      const abs = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(abs); continue; }
      if (!e.isFile()) continue;
      scanned++;
      let text;
      try {
        const st = await fs.stat(abs);
        if (st.size > 1_500_000) continue;
        text = await fs.readFile(abs, "utf8");
      } catch { continue; }
      if (text.includes("\0")) continue; // binary
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push(`${relative(rootReal, abs).split(sep).join("/")}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          if (hits.length >= SEARCH_MAX_HITS) break;
        }
      }
    }
  }
  const st = await fs.stat(base);
  if (st.isFile()) {
    scanned = 1;
    const text = await fs.readFile(base, "utf8");
    text.split("\n").forEach((l, i) => { if (re.test(l) && hits.length < SEARCH_MAX_HITS) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 200)}`); });
  } else {
    await walk(base);
  }
  if (!hits.length) return `No matches for "${query}" (${scanned} files searched).`;
  const note = hits.length >= SEARCH_MAX_HITS ? `\n...(stopped at ${SEARCH_MAX_HITS} matches)` : "";
  return hits.join("\n") + note;
}

function cap(s, n = OUTPUT_CAP) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + `\n...(truncated at ${n} characters)` : s;
}

export async function runCommand(root, command) {
  const cmd = String(command ?? "").trim();
  if (!cmd) throw new Error("Empty command.");
  const cwd = await fs.realpath(root);
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LANTERN: "1" },
    });
    const out = [stdout, stderr].filter((s) => s && s.trim()).join("\n");
    return { ok: true, content: cap(out) || "(no output)" };
  } catch (e) {
    const out = [e.stdout, e.stderr].filter((s) => s && String(s).trim()).join("\n");
    const why = e.killed ? `timed out after ${COMMAND_TIMEOUT_MS / 1000}s` : `exit code ${e.code ?? "?"}`;
    return { ok: false, content: cap(`Command failed (${why}).\n${out || e.message}`) };
  }
}

export async function gitInfo(root, { action, path: rel } = {}) {
  const cwd = await fs.realpath(root);
  const args = { status: ["status", "--short", "--branch"], diff: ["diff", "--no-color"], log: ["log", "--oneline", "-n", "20", "--no-color"] }[action];
  if (!args) throw new Error("action must be status, diff or log.");
  if (rel) { await resolveInside(root, rel); args.push("--", rel); }
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    return cap(stdout.trim() || (action === "status" ? "(clean working tree)" : "(nothing to show)"));
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("git is not installed or not on PATH.");
    throw new Error(cap((e.stderr || e.message || "git failed").toString().trim()));
  }
}

/**
 * Dispatch a tool call. Returns { ok, content }. Throws only on programmer error;
 * user-facing failures come back as { ok:false } so the model can adapt.
 * @param {string} name
 * @param {string} root working folder
 * @param {object} args parsed tool arguments
 * @param {{undo?: Array}} ctx
 */
export async function runTool(name, root, args = {}, ctx = {}) {
  try {
    switch (name) {
      case "list_dir": return { ok: true, content: await listDir(root, args.path) };
      case "read_file": return { ok: true, content: await readFile(root, args.path) };
      case "write_file": return { ok: true, content: await writeFile(root, args.path, args.content, ctx.undo) };
      case "edit_file": return { ok: true, content: await editFile(root, args, ctx.undo) };
      case "search_files": return { ok: true, content: await searchFiles(root, args) };
      case "run_command": return await runCommand(root, args.command);
      case "git": return { ok: true, content: await gitInfo(root, args) };
      default: return { ok: false, content: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, content: e.message };
  }
}
