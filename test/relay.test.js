import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeProvider } from "./fake-provider.js";
import { relayChat, relayStatus, hopReason } from "../src/cerebras.js";
import { runAgent } from "../src/agent.js";
import { newSession } from "../src/sessions.js";

let fake;
before(async () => { fake = await startFakeProvider(); });
after(() => fake.server.close());

test("a 429 hops to the next link and benches the limited one", async () => {
  // Distinct paths so module-level cooldowns from other tests don't interfere.
  const providers = [
    { name: "first", baseUrl: fake.url("limited-a"), apiKey: "k", model: "m" },
    { name: "second", baseUrl: fake.url("ok"), apiKey: "k", model: "m" },
  ];
  const hops = [], tried = [];
  let text = "";
  const reply = await relayChat({
    providers,
    messages: [{ role: "user", content: "hi" }],
    onDelta: (t) => (text += t),
    onProvider: (p) => tried.push(p.name),
    onHop: (h) => hops.push([h.from.name, h.to.name, h.reason]),
  });
  assert.equal(reply.content, "Hello from ok.");
  assert.equal(text, reply.content);
  assert.deepEqual(tried, ["first", "second"]);
  assert.deepEqual(hops, [["first", "second", "rate-limited"]]);
  const [first, second] = relayStatus(providers);
  assert.equal(first.state, "benched");
  assert.equal(first.reason, "rate-limited");
  assert.ok(first.until > Date.now() + 50_000);
  assert.equal(second.state, "ready");
});

test("hopReason names the failure in plain words", () => {
  assert.equal(hopReason({ status: 401 }), "rejected the key");
  assert.equal(hopReason({ status: 503 }), "had a server error (503)");
  assert.equal(hopReason({ status: 0 }), "unreachable");
});

test("the agent streams relay lights and hop notes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lantern-relay-"));
  try {
    const events = [];
    await runAgent({
      providers: [
        { name: "dead", baseUrl: fake.url("badkey"), apiKey: "x", model: "m" },
        { name: "alive", baseUrl: fake.url("ok-b"), apiKey: "k", model: "m" },
      ],
      root: dir,
      session: newSession("relay-test", dir),
      message: "say hi",
      emit: (e) => events.push(e),
      requestApproval: async () => false,
    });
    const hop = events.find((e) => e.type === "hop");
    assert.deepEqual(hop, { type: "hop", from: "dead", to: "alive", reason: "rejected the key" });
    const lights = events.filter((e) => e.type === "relay");
    assert.deepEqual(lights.map((e) => [e.active, e.state]), [[0, "live"], [1, "live"], [1, "ok"]]);
    assert.equal(lights.at(-1).links[0].state, "benched");
    assert.equal(events.at(-1).type, "done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
