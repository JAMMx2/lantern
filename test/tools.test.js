import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveInside, listDir, readFile as readTool, writeFile as writeTool, editFile, applyEdit,
  searchFiles, runTool, previewFor, undoLast, summarize, TOOL_DEFS, NEEDS_APPROVAL,
} from "../src/tools.js";

let root, outside;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "lantern-root-"));
  outside = await mkdtemp(join(tmpdir(), "lantern-outside-"));
  await writeFile(join(root, "hello.txt"), "hello\nworld\n");
  await mkdir(join(root, "sub"));
  await writeFile(join(root, "sub", "a.js"), "const x = 1;\nconsole.log(x);\n");
  await writeFile(join(outside, "secret.txt"), "nope");
  await symlink(outside, join(root, "escape"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("every tool def has a name and approval set only lists mutators", () => {
  const names = TOOL_DEFS.map((t) => t.function.name);
  assert.deepEqual(names, ["list_dir", "read_file", "write_file", "edit_file", "search_files", "run_command", "git"]);
  assert.deepEqual([...NEEDS_APPROVAL].sort(), ["edit_file", "run_command", "write_file"]);
  for (const n of names) assert.ok(summarize(n, { path: "p", command: "c", query: "q", action: "status" }).length > 0);
});

test("confinement: .. and symlinks cannot escape the root", async () => {
  await assert.rejects(resolveInside(root, "../" + outside.split("/").pop() + "/secret.txt"), /outside/);
  await assert.rejects(resolveInside(root, "escape/secret.txt"), /outside/);
  await assert.rejects(readTool(root, "escape/secret.txt"), /outside/);
  await assert.rejects(writeTool(root, "../x.txt", "x"), /outside/);
  assert.equal(await resolveInside(root, "."), await resolveInside(root, ""));
});

test("list_dir and read_file", async () => {
  const listing = await listDir(root, ".");
  assert.match(listing, /hello\.txt/);
  assert.match(listing, /sub\//);
  assert.equal(await readTool(root, "hello.txt"), "hello\nworld\n");
  await assert.rejects(readTool(root, "sub"), /folder/);
});

test("write_file creates nested files, records undo, and undo removes new files", async () => {
  const undo = [];
  const msg = await writeTool(root, "deep/er/new.txt", "fresh", undo);
  assert.match(msg, /^Created deep\/er\/new\.txt/);
  assert.equal(await readFile(join(root, "deep/er/new.txt"), "utf8"), "fresh");
  assert.equal(undo.length, 1);
  assert.equal(undo[0].before, null);
  const u = await undoLast(root, undo);
  assert.match(u, /Removed deep\/er\/new\.txt/);
  await assert.rejects(readFile(join(root, "deep/er/new.txt")));
  assert.equal(await undoLast(root, undo), null);
});

test("edit_file requires a unique match and is undoable", async () => {
  assert.equal(applyEdit("a b a", { old_text: "b", new_text: "c" }), "a c a");
  assert.throws(() => applyEdit("a b a", { old_text: "a", new_text: "c" }), /more than once/);
  assert.equal(applyEdit("a b a", { old_text: "a", new_text: "c", replace_all: true }), "c b c");
  assert.throws(() => applyEdit("a", { old_text: "z", new_text: "c" }), /not found/);

  const undo = [];
  const msg = await editFile(root, { path: "sub/a.js", old_text: "const x = 1;", new_text: "const x = 2;" }, undo);
  assert.match(msg, /Edited sub\/a\.js \(\+1 \/ -1 lines\)/);
  assert.equal(await readFile(join(root, "sub/a.js"), "utf8"), "const x = 2;\nconsole.log(x);\n");
  await undoLast(root, undo);
  assert.equal(await readFile(join(root, "sub/a.js"), "utf8"), "const x = 1;\nconsole.log(x);\n");
});

test("previewFor returns a diff for existing files and content for new ones", async () => {
  const p1 = await previewFor("write_file", root, { path: "hello.txt", content: "hello\nthere\n" });
  assert.equal(p1.isNew, false);
  assert.match(p1.diff, /-world\n\+there/);
  assert.deepEqual(p1.stats, { added: 1, removed: 1 });
  const p2 = await previewFor("write_file", root, { path: "brand-new.md", content: "# hi\n" });
  assert.equal(p2.isNew, true);
  assert.equal(p2.preview, "# hi\n");
  const p3 = await previewFor("edit_file", root, { path: "missing.txt", old_text: "a", new_text: "b" });
  assert.match(p3.error, /No such file/);
  const p4 = await previewFor("run_command", root, { command: "ls" });
  assert.equal(p4.command, "ls");
});

test("search_files finds matches and escapes literals", async () => {
  const r = await searchFiles(root, { query: "console.log(x)" });
  assert.match(r, /^sub\/a\.js:2: console\.log\(x\);/m);
  const none = await searchFiles(root, { query: "zzz-not-here" });
  assert.match(none, /No matches/);
  const re = await searchFiles(root, { query: "^wor", regex: true });
  assert.match(re, /hello\.txt:2: world/);
  await assert.rejects(searchFiles(root, { query: "(", regex: true }), /Bad regular expression/);
});

test("run_command runs in the root and reports failures without throwing", async () => {
  const ok = await runTool("run_command", root, { command: "echo lantern" });
  assert.equal(ok.ok, true);
  assert.match(ok.content, /lantern/);
  const bad = await runTool("run_command", root, { command: "exit 3" });
  assert.equal(bad.ok, false);
  assert.match(bad.content, /exit code 3/);
});

test("runTool reports user-facing errors as ok:false", async () => {
  const r = await runTool("read_file", root, { path: "nope.txt" });
  assert.equal(r.ok, false);
  const u = await runTool("nonsense", root, {});
  assert.match(u.content, /Unknown tool/);
});
