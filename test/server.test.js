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
