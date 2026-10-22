import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

// Point config + history at a scratch dir BEFORE importing the server.
const home = await mkdtemp(join(tmpdir(), "lantern-home-"));
process.env.LANTERN_HOME = home;
await writeFile(join(home, "config.json"), JSON.stringify({
  providers: [{ name: "cerebras", baseUrl: "https://api.cerebras.ai/v1", apiKey: "fake-key", model: "llama-3.3-70b" }],
}));
const { startServer, VERSION } = await import("../src/server.js");

let server, port, token;
const url = (p) => `http://127.0.0.1:${port}${p}`;
before(async () => {
  ({ server, port } = await startServer(0));
  port = server.address().port;
});
after(async () => {
  server.close();
  await rm(home, { recursive: true, force: true });
});

test("serves the UI with the session token injected", async () => {
  const res = await fetch(url("/"));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes("%%LANTERN_TOKEN%%"));
  token = html.match(/const TOKEN = "([^"]+)"/)[1];
  assert.ok(token.length > 10);
});

test("api routes refuse requests without the token or from a foreign host", async () => {
  assert.equal((await fetch(url("/api/config"))).status, 403);
  // fetch() strips a custom Host header, so use raw http for the rebinding check.
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/config", headers: { "X-Lantern-Token": token, Host: "evil.example" } }, (r) => { r.resume(); resolve(r.statusCode); });
    req.on("error", reject); req.end();
  });
  assert.equal(status, 403);
});

test("config reports version and never leaks keys", async () => {
  const res = await fetch(url("/api/config"), { headers: { "X-Lantern-Token": token } });
  const j = await res.json();
  assert.equal(j.version, VERSION);
  assert.equal(j.configured, true);
  assert.equal(j.providers[0].hasKey, true);
  assert.equal(JSON.stringify(j).includes("fake-key"), false);
});

test("sessions list is empty at first, undo reports nothing, bad ids rejected", async () => {
  const h = { "X-Lantern-Token": token, "Content-Type": "application/json" };
  const list = await (await fetch(url("/api/sessions"), { headers: h })).json();
  assert.deepEqual(list.sessions, []);
  const undo = await (await fetch(url("/api/undo"), { method: "POST", headers: h, body: JSON.stringify({ sessionId: "s1" }) })).json();
  assert.equal(undo.ok, false);
  const bad = await fetch(url("/api/session/load"), { method: "POST", headers: h, body: JSON.stringify({ id: "../etc" }) });
  assert.equal(bad.status, 400);
});

test("config carries the provider catalog for the setup screen", async () => {
  const j = await (await fetch(url("/api/config"), { headers: { "X-Lantern-Token": token } })).json();
  assert.ok(j.catalog.some((p) => p.id === "groq" && p.baseUrl.startsWith("https://")));
  const ollama = j.catalog.find((p) => p.id === "ollama");
  assert.equal(ollama.kind, "local");
  assert.ok(ollama.howTo && ollama.label === "Ollama");
  assert.equal(j.catalog.at(-1).kind, "paid");
});

test("spark parses a paste and returns the typed keys for review", async () => {
  const h = { "X-Lantern-Token": token, "Content-Type": "application/json" };
  const key = "gsk_" + "Ab12".repeat(10);
  const r = await fetch(url("/api/spark"), { method: "POST", headers: h, body: JSON.stringify({ text: `GROQ=${key}`, verify: false }) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.links.map((l) => [l.name, l.apiKey]), [["groq", key]]);
});

test("pass round trip: recipes reuse saved keys without echoing them, sealed passes need the passphrase", async () => {
  const h = { "X-Lantern-Token": token, "Content-Type": "application/json" };
  const post = async (path, body) => {
    const r = await fetch(url(path), { method: "POST", headers: h, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json() };
  };

  const weak = await post("/api/pass", { sealed: true, passphrase: "short" });
  assert.equal(weak.status, 400);
  assert.equal(weak.j.code, "WEAK_PASSPHRASE");

  const recipe = await post("/api/pass", { sealed: false });
  assert.match(recipe.j.pass, /^lantern1\.r\./);
  assert.match(recipe.j.link, /#pass=lantern1\.r\./);
  const fromRecipe = await post("/api/spark", { text: recipe.j.link, verify: false });
  assert.equal(JSON.stringify(fromRecipe.j).includes("fake-key"), false);
  assert.equal(fromRecipe.j.links[0].hasKey, true);
  assert.equal(fromRecipe.j.from, "recipe pass");

  const sealed = await post("/api/pass", { sealed: true, passphrase: "a long passphrase" });
  assert.match(sealed.j.pass, /^lantern1\.s\./);
  const locked = await post("/api/spark", { text: sealed.j.pass, verify: false });
  assert.equal(locked.j.needPassphrase, true);
  const wrong = await post("/api/spark", { text: sealed.j.pass, passphrase: "not the passphrase", verify: false });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.j.code, "BAD_PASSPHRASE");
  const opened = await post("/api/spark", { text: sealed.j.pass, passphrase: "a long passphrase", verify: false });
  assert.equal(opened.j.links[0].apiKey, "fake-key", "the user unlocked their own pass");
});

test("local AI routes: report every app, refuse unknown ids and bad model names", async () => {
  const h = { "X-Lantern-Token": token, "Content-Type": "application/json" };
  const j = await (await fetch(url("/api/local"), { headers: h })).json();
  assert.ok(j.apps.some((a) => a.id === "lmstudio" && typeof a.running === "boolean" && a.howTo));
  assert.ok(j.ollamaModels.some((m) => m.name === j.recommended));
  assert.equal(typeof j.ramGB, "number");
  const start = await fetch(url("/api/local/start"), { method: "POST", headers: h, body: JSON.stringify({ id: "rm -rf" }) });
  assert.equal(start.status, 400);
  const pull = await fetch(url("/api/local/pull"), { method: "POST", headers: h, body: JSON.stringify({ model: "--help" }) });
  assert.equal(pull.status, 400);
});

test("static files cannot escape public/", async () => {
  const res = await fetch(url("/../package.json"));
  assert.equal(res.status, 404);
});

test("startServer --dir validates the folder", async () => {
  await assert.rejects(async () => startServer(0, { dir: join(home, "does-not-exist") }), /does not exist/);
  const d = join(home, "work"); await mkdir(d);
  const s2 = await startServer(0, { dir: d, model: "qwen-3-32b" });
  s2.server.close();
  const cfg = JSON.parse(await (await import("node:fs/promises")).readFile(join(home, "config.json"), "utf8"));
  assert.equal(cfg.lastCwd, d);
  assert.equal(cfg.providers[0].model, "qwen-3-32b");
});
