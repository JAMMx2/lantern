import { promises as fs } from "node:fs";
import { join } from "node:path";
import { relayChat, relayStatus } from "./cerebras.js";
import {
  TOOL_DEFS,
  NEEDS_APPROVAL,
  summarize,
  runTool,
  previewFor,
} from "./tools.js";

export const MAX_STEPS = 30;
export const CONTEXT_FILES = ["LANTERN.md", "lantern.md", ".lantern.md"];
const CONTEXT_CAP = 8_000;

// The date changes once a day, so the prompt stays byte-identical (and
// cacheable by the provider) for every request in between.
export const today = () =>
  new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export const SYSTEM_PROMPT = (root, projectContext, date = today()) =>
  `You are Lantern, a friendly AI helper running on the user's own computer, powered by the AI they chose. Many people who use you have never used AI before, so be warm, clear and practical, use everyday words, and explain any technical term you can't avoid.

Today is ${date}.

Help with anything people ask an AI assistant: answer questions, explain things simply, write and polish text (emails, letters, posts, CVs), summarise, brainstorm, plan, teach and quiz, and build things like web pages, small apps and scripts. Keep answers as short as the question allows, and use headings, lists or a table when they make an answer easier to scan.

You can also work with files in this folder on their computer: ${root}
File paths are relative to it. Tools:
- list_dir, read_file, search_files, git: look around. These run automatically.
- edit_file: change part of an existing file (the user sees exactly what changes).
- write_file: create a new file or rewrite one.
- run_command: run a command (install, test, build, git...).
edit_file, write_file and run_command need the user's approval each time: they see what you intend and click Allow or Deny. If they deny, adapt or ask why; never work around a denial.

Use tools only when the request is about their files or making something; for questions, writing help and conversation, just answer. When you make something they'll open (a web page, a document), save it as a file, then tell them its name and how to open it (for a web page: double-click the .html file). Before using a tool, say in one plain sentence what you're about to do, and afterwards sum up what changed.` +
  (projectContext
    ? `\n\nThe user keeps project notes for you in LANTERN.md. Follow them:\n<project-notes>\n${projectContext}\n</project-notes>`
    : "");

/** Read LANTERN.md (or variants) from the working folder, capped. */
export async function loadProjectContext(root) {
  for (const name of CONTEXT_FILES) {
    try {
      const text = await fs.readFile(join(root, name), "utf8");
      const t = text.trim();
      if (!t) continue;
      return t.length > CONTEXT_CAP ? t.slice(0, CONTEXT_CAP) + "\n...(truncated)" : t;
    } catch {
      /* try next */
    }
  }
  return "";
}

/**
 * Parse a tool call's JSON arguments defensively. Models occasionally emit
 * trailing junk, double-encoded strings, or nothing at all.
 */
export function parseToolArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  const s = String(raw ?? "").trim();
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    if (typeof v === "string") { try { const inner = JSON.parse(v); return inner && typeof inner === "object" ? inner : {}; } catch { return {}; } }
    return v && typeof v === "object" ? v : {};
  } catch {
    // Salvage the first balanced {...} block.
    const start = s.indexOf("{");
    if (start < 0) return {};
    let depth = 0, inStr = false, escp = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (escp) escp = false; else if (c === "\\") escp = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return {}; } } }
    }
    return {};
  }
}

// Keep the running transcript from growing past the model's context budget.
// Trim in one big cut (down to half the budget) instead of shaving one turn
// per request: between cuts the conversation prefix stays byte-identical,
// which is what providers' prompt caches key on.
export const CHAR_BUDGET = 24_000;
export function trimConversation(conv, budget = CHAR_BUDGET) {
  const size = () => conv.reduce((n, m) => n + (m.content ? m.content.length : 0), 0);
  if (size() <= budget) return;
  while (conv.length > 2 && size() > budget / 2) {
    conv.shift();
    // Don't leave a leading orphan tool message.
    while (conv.length && conv[0].role === "tool") conv.shift();
  }
}

/**
 * Run the agent to completion, mutating the session in place.
 * @param {object} o
 * @param {Array}  o.providers  ordered relay chain [{name, baseUrl, apiKey, model}]
 * @param {string} o.root  working directory
 * @param {object} o.session  { messages, undo, usage } persisted for this chat
 * @param {string} o.message  the new user message
 * @param {(evt:object)=>void} o.emit  push an NDJSON event to the client
 * @param {(req:object)=>Promise<boolean>} o.requestApproval  resolve to allow/deny
 * @param {()=>Promise<void>} [o.persist]  called after each step so history survives a crash
 */
export async function runAgent({ providers, root, session, message, emit, requestApproval, persist }) {
  const conversation = session.messages;
  const undo = session.undo;
  const save = async () => { if (persist) { try { await persist(); } catch { /* best effort */ } } };

  conversation.push({ role: "user", content: message });
  trimConversation(conversation);
  const projectContext = await loadProjectContext(root);
  if (projectContext) emit({ type: "context", file: "LANTERN.md", chars: projectContext.length });
  const label = (p) => p.name || p.baseUrl;
  const lights = (p, state) => emit({ type: "relay", active: p ? providers.indexOf(p) : -1, state, links: relayStatus(providers) });
  const date = today();

  for (let step = 0; step < MAX_STEPS; step++) {
    const messages = [{ role: "system", content: SYSTEM_PROMPT(root, projectContext, date) }, ...conversation];

    let reply;
    try {
      reply = await relayChat({
        providers,
        messages,
        tools: TOOL_DEFS,
        onDelta: (text) => emit({ type: "assistant_delta", text }),
        onProvider: (p) => {
          emit({ type: "provider", name: label(p), model: p.model });
          lights(p, "live");
        },
        onHop: ({ from, to, reason }) => emit({ type: "hop", from: label(from), to: label(to), reason }),
      });
    } catch (e) {
      lights(null, "");
      emit({ type: "error", message: e.message });
      await save();
      return;
    }
    lights(reply.provider, "ok");

    if (reply.usage) {
      session.usage.prompt += reply.usage.prompt_tokens | 0;
      session.usage.completion += reply.usage.completion_tokens | 0;
      emit({ type: "usage", step: reply.usage, total: { ...session.usage } });
    }

    const toolCalls = reply.tool_calls || [];

    if (reply.content) {
      // Deltas already streamed the text; this closes the bubble with the
      // final assembled markdown.
      emit({ type: "assistant_done", text: reply.content });
    }

    // No tools requested -> the turn is done.
    if (!toolCalls.length) {
      conversation.push({ role: "assistant", content: reply.content || "" });
      await save();
      emit({ type: "done" });
      return;
    }

    // Keep the assistant message (with its tool_calls) before its results.
    conversation.push({
      role: "assistant",
      content: reply.content || "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call.function?.name;
      const args = parseToolArgs(call.function?.arguments);
      const summary = summarize(name, args);

      let allowed = true;
      let preview = {};
      if (NEEDS_APPROVAL.has(name)) {
        try { preview = await previewFor(name, root, args); } catch (e) { preview = { error: e.message }; }
        emit({ type: "tool_request", id: call.id, name, summary, ...preview });
        // A preview error (bad path, missing file for edit) is reported straight
        // back to the model; nothing to approve.
        allowed = preview.error ? false : await requestApproval({ id: call.id, name });
      } else {
        emit({ type: "tool_activity", name, summary });
      }

      let result;
      if (preview.error) {
        result = { ok: false, content: preview.error };
      } else if (!allowed) {
        result = { ok: false, content: "The user denied this action." };
      } else {
        try {
          result = await runTool(name, root, args, { undo });
        } catch (e) {
          result = { ok: false, content: e.message };
        }
      }

      emit({
        type: "tool_result",
        id: call.id,
        name,
        ok: result.ok,
        detail: result.content,
        undoable: undo.length > 0,
      });

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.content,
      });
    }
    await save();
  }

  emit({
    type: "error",
    message: `Stopped after ${MAX_STEPS} steps to avoid running in circles. Try breaking the task into smaller pieces.`,
  });
}
