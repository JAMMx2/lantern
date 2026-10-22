import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startFakeProvider } from "./fake-provider.js";
import { installedApps, startPlan, startApp, pullOllama, MODEL_NAME_RE } from "../src/local.js";

let fake;
before(async () => { fake = await startFakeProvider(); });
after(() => fake.server.close());

const fakeDisk = (paths) => (p) => paths.includes(p);

test("installedApps finds apps in their usual places on each OS", () => {
  const mac = installedApps({
    platform: "darwin", home: "/Users/sam", env: {},
    exists: fakeDisk(["/Applications/Ollama.app", "/Users/sam/.lmstudio/bin/lms", "/Applications/Jan.app"]),
  });
  assert.deepEqual(mac, { ollama: "/Applications/Ollama.app", lmstudio: "/Users/sam/.lmstudio/bin/lms", jan: "/Applications/Jan.app" });

  const win = installedApps({
    platform: "win32", home: "C:/Users/sam", env: { LOCALAPPDATA: "C:/Users/sam/AppData/Local" },
    exists: fakeDisk(["C:/Users/sam/AppData/Local/Programs/Ollama/ollama app.exe", "C:/Users/sam/gpt4all"]),
  });
  assert.deepEqual(win, { ollama: "C:/Users/sam/AppData/Local/Programs/Ollama/ollama app.exe", gpt4all: "C:/Users/sam/gpt4all" });
  assert.deepEqual(installedApps({ platform: "linux", home: "/home/sam", env: {}, exists: () => false }), {});
});

test("startPlan uses fixed commands, and only for apps it can really start", () => {
  const disk = fakeDisk(["/Applications/Ollama.app", "/usr/bin/ollama", "/home/sam/.lmstudio/bin/lms", "/Applications/Jan.app", "/Users/sam/gpt4all"]);
  assert.deepEqual(startPlan("ollama", { platform: "darwin", home: "/Users/sam", env: {}, exists: disk }),
    { label: "Start Ollama", cmd: "open", args: ["/Applications/Ollama.app"] });
  assert.deepEqual(startPlan("ollama", { platform: "linux", home: "/home/sam", env: {}, exists: disk }),
    { label: "Start Ollama", cmd: "/usr/bin/ollama", args: ["serve"] });
  assert.deepEqual(startPlan("lmstudio", { platform: "linux", home: "/home/sam", env: {}, exists: disk }),
    { label: "Start LM Studio's server", cmd: "/home/sam/.lmstudio/bin/lms", args: ["server", "start"] });
  assert.equal(startPlan("jan", { platform: "darwin", home: "/Users/sam", env: {}, exists: disk }).label, "Open Jan");
  assert.equal(startPlan("gpt4all", { platform: "darwin", home: "/Users/sam", env: {}, exists: disk }), null, "a folder isn't something to launch");
  assert.equal(startPlan("ollama", { platform: "darwin", home: "/Users/sam", env: {}, exists: () => false }), null);
});

test("startApp launches detached and reports apps it can't start", async () => {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push([cmd, args, opts.detached, opts.stdio]);
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => child.emit("spawn"));
    return child;
  };
  const opts = { platform: "darwin", home: "/Users/sam", env: {}, exists: fakeDisk(["/Applications/Ollama.app"]), spawn };
  const plan = await startApp("ollama", opts);
  assert.equal(plan.label, "Start Ollama");
  assert.deepEqual(calls, [["open", ["/Applications/Ollama.app"], true, "ignore"]]);
  await assert.rejects(startApp("jan", opts), /can't start Jan from here\. In Jan, open Settings/);

  const failing = (cmd) => { const c = new EventEmitter(); setImmediate(() => c.emit("error", new Error("ENOENT"))); return c; };
  await assert.rejects(startApp("ollama", { ...opts, spawn: failing }), /Couldn't start Ollama: ENOENT/);
});

test("pullOllama streams progress and surfaces Ollama's errors", async () => {
  const seen = [];
  await pullOllama("qwen2.5-coder:7b", { base: `${fake.base}/ollama`, onProgress: (p) => seen.push(p) });
  assert.equal(seen[0].status, "pulling manifest");
  assert.equal(seen[1].total, 4_683_073_184, "sizes over 2 GB survive");
  assert.equal(seen.at(-1).status, "success");
  await assert.rejects(pullOllama("nope:latest", { base: `${fake.base}/pullfail` }), /Ollama: pull model manifest/);
  await assert.rejects(pullOllama("x", { base: "http://127.0.0.1:9" }), /Ollama isn't running/);
});

test("model names are checked before anything is sent", async () => {
  for (const ok of ["qwen2.5-coder:7b", "llama3.1", "hf.co/bartowski/Qwen2.5-Coder-7B-GGUF:Q4_K_M"]) assert.ok(MODEL_NAME_RE.test(ok), ok);
  for (const bad of ["--help", "../etc/passwd:x", "two words", "", "a:b:c"]) assert.equal(MODEL_NAME_RE.test(bad), false, bad);
  await assert.rejects(pullOllama("--insecure"), /doesn't look like an Ollama model name/);
});
