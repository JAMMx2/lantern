import { relayChat } from "./cerebras.js";
import {
  TOOL_DEFS,
  NEEDS_APPROVAL,
  summarize,
  runTool,
} from "./tools.js";

const MAX_STEPS = 30;

const SYSTEM_PROMPT = (root) =>
  `You are Lantern, a local coding assistant running on the user's own computer, powered by the user's own AI provider.

You are working inside this folder: ${root}
All file paths you use are relative to that folder.

You have four tools: list_dir, read_file, write_file, run_command.
- Explore with list_dir and read_file before making changes.
- Use write_file to create or change files, and run_command to run shell commands (installing things, running scripts, git, etc.).
- write_file and run_command require the user's approval each time — they will see exactly what you intend to do and click Allow or Deny. If they deny, adapt or ask why; never try to work around a denial.

Work in small, clear steps. Before using a tool, briefly tell the user in plain, non-technical language what you're about to do and why. After finishing, summarize what changed. Assume the user may not be a programmer.`;

// Keep the running transcript from growing past the model's context budget.
// Trim in one big cut (down to half the budget) instead of shaving one turn
// per request: between cuts the conversation prefix stays byte-identical,
// which is what providers' prompt caches key on.
const CHAR_BUDGET = 24_000;
function trimConversation(conv) {
  const size = () => conv.reduce((n, m) => n + (m.content ? m.content.length : 0), 0);
  if (size() <= CHAR_BUDGET) return;
  while (conv.length > 2 && size() > CHAR_BUDGET / 2) {
    conv.shift();
    // Don't leave a leading orphan tool message.
    while (conv.length && conv[0].role === "tool") conv.shift();
  }
}

/**
 * Run the agent to completion, mutating the persisted conversation in place.
 * @param {object} o
 * @param {Array}  o.providers  ordered relay chain [{name, baseUrl, apiKey, model}]
 * @param {string} o.root  working directory
 * @param {Array}  o.conversation  persisted [{role, content, tool_calls?}] for this session
 * @param {string} o.message  the new user message
 * @param {(evt:object)=>void} o.emit  push an NDJSON event to the client
 * @param {(req:object)=>Promise<boolean>} o.requestApproval  resolve to allow/deny
 */
export async function runAgent({ providers, root, conversation, message, emit, requestApproval }) {
  conversation.push({ role: "user", content: message });
  trimConversation(conversation);

  for (let step = 0; step < MAX_STEPS; step++) {
    const messages = [{ role: "system", content: SYSTEM_PROMPT(root) }, ...conversation];

    let reply;
    try {
      reply = await relayChat({
        providers,
        messages,
        tools: TOOL_DEFS,
        onDelta: (text) => emit({ type: "assistant_delta", text }),
        onProvider: (p) => emit({ type: "provider", name: p.name || p.baseUrl }),
      });
    } catch (e) {
      emit({ type: "error", message: e.message });
      return;
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
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      const summary = summarize(name, args);

      let allowed = true;
      if (NEEDS_APPROVAL.has(name)) {
        emit({
          type: "tool_request",
          id: call.id,
          name,
          summary,
          command: name === "run_command" ? args.command : undefined,
          path: name === "write_file" ? args.path : undefined,
          preview: name === "write_file" ? String(args.content ?? "").slice(0, 4000) : undefined,
        });
        allowed = await requestApproval({ id: call.id, name });
      } else {
        emit({ type: "tool_activity", name, summary });
      }

      let result;
      if (!allowed) {
        result = { ok: false, content: "The user denied this action." };
      } else {
        try {
          result = await runTool(name, root, args);
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
      });

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.content,
      });
    }
  }

  emit({
    type: "error",
    message: `Stopped after ${MAX_STEPS} steps to avoid running in circles. Try breaking the task into smaller pieces.`,
  });
}
