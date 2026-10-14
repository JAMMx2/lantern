import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseToolArgs, trimConversation, loadProjectContext } from "../src/agent.js";

test("parseToolArgs handles clean, empty, double-encoded and junk-wrapped JSON", () => {
  assert.deepEqual(parseToolArgs('{"path":"a.txt"}'), { path: "a.txt" });
  assert.deepEqual(parseToolArgs(""), {});
  assert.deepEqual(parseToolArgs(undefined), {});
  assert.deepEqual(parseToolArgs('"{\\"path\\":\\"b\\"}"'), { path: "b" });
  assert.deepEqual(parseToolArgs('garbage {"command":"ls -la"} trailing'), { command: "ls -la" });
  assert.deepEqual(parseToolArgs('{"content":"has } brace","path":"x"} extra'), { content: "has } brace", path: "x" });
  assert.deepEqual(parseToolArgs("[1,2]"), [1, 2]);
  assert.deepEqual(parseToolArgs({ already: true }), { already: true });
  assert.deepEqual(parseToolArgs("{broken"), {});
});

test("trimConversation cuts to half the budget and drops orphan tool messages", () => {
  const conv = [];
  for (let i = 0; i < 10; i++) {
    conv.push({ role: "user", content: "u".repeat(100) });
    conv.push({ role: "assistant", content: "a".repeat(100), tool_calls: [{ id: "c" + i }] });
    conv.push({ role: "tool", tool_call_id: "c" + i, content: "t".repeat(100) });
  }
  trimConversation(conv, 1500);
  const size = conv.reduce((n, m) => n + m.content.length, 0);
  assert.ok(size <= 750, "trimmed to half the budget");
  assert.notEqual(conv[0].role, "tool");
});

test("loadProjectContext reads LANTERN.md when present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lantern-ctx-"));
  try {
    assert.equal(await loadProjectContext(dir), "");
    await writeFile(join(dir, "LANTERN.md"), "  Use tabs.\n");
    assert.equal(await loadProjectContext(dir), "Use tabs.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
