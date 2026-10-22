import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto as crypto } from "node:crypto";
import {
  detectInput, bestModel, orderChain, makePass, openPass, passLink, passFromHash,
  generatePassphrase, spark, providerForUrl, SPARK_PROVIDERS,
} from "../src/spark.js";

const CSK = "csk-" + "a1b2c3d4e5".repeat(5);
const GSK = "gsk_" + "Z9y8X7w6V5".repeat(5);
const AIZA = "AIzaSyD" + "x".repeat(20) + "1234567890_-";
const ORK = "sk-or-v1-" + "0123456789abcdef".repeat(4);
const UUID = "3f2b8c1e-9a7d-4e6f-8b5a-1c2d3e4f5a6b";
// Assembled at runtime so secret scanners don't take the fixture for a real key.
const MISTRAL = ["Ab3dEf6h", "Ij9kLm2n", "Op5qRs8t", "Uv1wXy4z"].join("");
const byName = (links) => Object.fromEntries(links.map((l) => [l.name, l]));

test("detectInput recognises keys by format, wherever they sit in the text", () => {
  const text = `my keys!!\nCEREBRAS_API_KEY=${CSK}\nexport GROQ_API_KEY="${GSK}"\ngemini -> ${AIZA}, and ${ORK}`;
  const { links, unknown } = detectInput(text);
  const n = byName(links);
  assert.equal(n.cerebras.apiKey, CSK);
  assert.equal(n.groq.apiKey, GSK);
  assert.equal(n.gemini.apiKey, AIZA);
  assert.equal(n.openrouter.apiKey, ORK);
  assert.equal(n.groq.baseUrl, "https://api.groq.com/openai/v1");
  assert.deepEqual(unknown, []);
});

test("prefix-less keys need a provider named on their line or the line above", () => {
  assert.equal(byName(detectInput(`MISTRAL_API_KEY=${MISTRAL}`).links).mistral.apiKey, MISTRAL);
  assert.equal(byName(detectInput(`Mistral:\n\n${MISTRAL}`).links).mistral.apiKey, MISTRAL);
  const lone = detectInput(MISTRAL);
  assert.equal(lone.links.length, 0, "an unplaceable key is never sent anywhere");
  assert.deepEqual(lone.unknown, ["Ab3d…Xy4z"]);
});

test("a bare UUID is a SambaNova key unless another provider is named", () => {
  assert.equal(detectInput(UUID).links[0].name, "sambanova");
  assert.equal(detectInput(`samba ${UUID}`).links[0].source, "hint");
  assert.equal(detectInput(`mistral ${UUID}`).links[0].name, "mistral");
});

test("model names, env var names and prose are not mistaken for keys", () => {
  const { links, unknown } = detectInput("groq llama-3.3-70b-versatile\nGOOGLE_GENERATIVE_AI_API_KEY\nqwen-3-coder-480b-instruct-2507 rocks");
  assert.equal(links.length, 0);
  assert.deepEqual(unknown, []);
});

test("endpoint URLs become links; keys on the same or next line attach to them", () => {
  const { links } = detectInput(
    `https://api.together.xyz/v1 ${"a1b2c3d4".repeat(8)}\nhttp://localhost:1234/v1\nhttps://my.box:8000/v1\nTOKEN_${"9".repeat(4)}abcdefghijklmnop\nhttp://127.0.0.1:11434\nsee https://console.groq.com/keys and https://example.com/blog`
  );
  const urls = links.map((l) => [l.name, l.baseUrl, l.apiKey]);
  assert.deepEqual(urls, [
    ["custom", "https://api.together.xyz/v1", "a1b2c3d4".repeat(8)],
    ["custom", "http://localhost:1234/v1", ""],
    ["custom", "https://my.box:8000/v1", "TOKEN_9999abcdefghijklmnop"],
    ["ollama", "http://127.0.0.1:11434/v1", ""],
  ]);
});

test("duplicates collapse; a second key for the same provider is noted, not added", () => {
  const other = "gsk_" + "Q".repeat(40) + "123";
  const { links, notes } = detectInput(`${GSK}\n${GSK}\n${other}`);
  assert.equal(links.length, 1);
  assert.equal(links[0].apiKey, GSK);
  assert.match(notes[0], /More than one groq key/);
});

test("passes are found inside text and links", () => {
  assert.equal(detectInput("here: lantern1.r.eyJ2IjoxfQabc rest").pass, "lantern1.r.eyJ2IjoxfQabc");
  assert.equal(passFromHash("#pass=lantern1.s.AAAAAAAAAA"), "lantern1.s.AAAAAAAAAA");
  assert.equal(passFromHash("#x=1&pass=lantern1.r.BBBBBBBBBB"), "lantern1.r.BBBBBBBBBB");
  assert.equal(passFromHash("#pass=nope"), null);
  assert.equal(passLink("https://x.dev/lantern/#old", "lantern1.r.CC"), "https://x.dev/lantern/#pass=lantern1.r.CC");
});

test("bestModel prefers strong tool-calling coders and stable releases", () => {
  assert.equal(bestModel(["llama-3.3-70b", "llama-4-scout-17b-16e-instruct", "qwen-3-coder-480b", "gpt-oss-120b"], "cerebras"), "qwen-3-coder-480b");
  assert.equal(bestModel(["models/gemini-2.5-flash-lite", "models/gemini-2.5-flash-preview-05-20", "models/gemini-2.5-flash"], "gemini"), "models/gemini-2.5-flash");
  assert.equal(bestModel(["qwen/qwen3-coder", "qwen/qwen3-coder:free", "openai/gpt-oss-120b"], "openrouter"), "qwen/qwen3-coder:free");
  assert.equal(bestModel(["llama3.1:8b", "qwen2.5-coder:7b"], "ollama"), "qwen2.5-coder:7b");
  assert.equal(bestModel(["some-new-model"], "custom"), "some-new-model");
  assert.equal(bestModel([], "groq"), "");
});

test("orderChain puts cloud tiers fastest-first, custom next, Ollama last", () => {
  const order = orderChain([
    { name: "ollama" }, { name: "custom" }, { name: "gemini" }, { name: "cerebras" }, { name: "groq" },
  ]).map((l) => l.name);
  assert.deepEqual(order, ["cerebras", "groq", "gemini", "custom", "ollama"]);
});

const CHAIN = [
  { name: "cerebras", baseUrl: "https://api.cerebras.ai/v1", apiKey: CSK, model: "qwen-3-coder-480b" },
  { name: "ollama", baseUrl: "http://localhost:11434/v1", apiKey: "local", model: "qwen2.5-coder:7b" },
];

test("a sealed pass round-trips keys and rejects the wrong passphrase", async () => {
  const pass = await makePass(CHAIN, { passphrase: "correct horse battery", crypto });
  assert.match(pass, /^lantern1\.s\.[A-Za-z0-9_-]+$/);
  assert.equal(pass.includes(CSK), false);
  const opened = await openPass(pass, { passphrase: "correct horse battery", crypto });
  assert.equal(opened.sealed, true);
  assert.equal(opened.links[0].apiKey, CSK);
  assert.equal(opened.links[1].apiKey, "", "the 'local' placeholder isn't packed");
  assert.equal(opened.links[1].model, "qwen2.5-coder:7b");
  await assert.rejects(openPass(pass, { crypto }), (e) => e.code === "NEED_PASSPHRASE");
  await assert.rejects(openPass(pass, { passphrase: "wrong horse battery", crypto }), (e) => e.code === "BAD_PASSPHRASE");
  const flipped = pass.slice(0, -6) + (pass.at(-6) === "A" ? "B" : "A") + pass.slice(-5);
  await assert.rejects(openPass(flipped, { passphrase: "correct horse battery", crypto }), /Wrong passphrase|damaged/);
});

test("sealing demands a real passphrase; recipes carry no keys", async () => {
  await assert.rejects(makePass(CHAIN, { passphrase: "short", crypto }), (e) => e.code === "WEAK_PASSPHRASE");
  const recipe = await makePass(CHAIN, { sealed: false });
  const raw = Buffer.from(recipe.split(".")[2], "base64url").toString();
  assert.equal(raw.includes(CSK), false);
  assert.equal(raw.includes("apiKey"), false);
  const opened = await openPass(recipe);
  assert.equal(opened.sealed, false);
  assert.deepEqual(opened.links.map((l) => l.model), ["qwen-3-coder-480b", "qwen2.5-coder:7b"]);
});

test("a pass can't relabel a stranger's server as a known provider", async () => {
  const body = { v: 1, links: [{ name: "groq", baseUrl: "https://evil.example/v1", model: "x", apiKey: "planted" }, { baseUrl: "javascript:alert(1)" }] };
  const forged = "lantern1.r." + Buffer.from(JSON.stringify(body)).toString("base64url");
  const { links } = await openPass(forged);
  assert.equal(links.length, 1);
  assert.equal(links[0].name, "custom");
  assert.equal(links[0].apiKey, "", "recipes never carry keys, even planted ones");
});

test("generatePassphrase gives four groups of unambiguous characters", () => {
  const a = generatePassphrase(crypto), b = generatePassphrase(crypto);
  assert.match(a, /^[A-HJKMNP-TV-Z2-9]{4}(-[A-HJKMNP-TV-Z2-9]{4}){3}$/);
  assert.notEqual(a, b);
});

test("providerForUrl maps catalog URLs and any loopback :11434 to providers", () => {
  assert.equal(providerForUrl("https://api.groq.com/openai/v1/").id, "groq");
  assert.equal(providerForUrl("http://127.0.0.1:11434/v1").id, "ollama");
  assert.equal(providerForUrl("https://api.groq.com.evil.example/v1"), null);
  assert.equal(SPARK_PROVIDERS.at(-1).id, "ollama");
});

const fakeModels = {
  "https://api.cerebras.ai/v1": ["llama-3.3-70b", "qwen-3-coder-480b"],
  "https://api.groq.com/openai/v1": ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
  "http://localhost:11434/v1": ["qwen2.5-coder:7b"],
};
const fakeTest = async (l) => {
  if (l.apiKey === "bad") throw new Error("groq rejected your API key (HTTP 401).");
  const m = fakeModels[l.baseUrl];
  if (!m) throw new Error("unreachable");
  return m;
};

test("spark tests every link, picks models, finds Ollama and orders the chain", async () => {
  const out = await spark({ text: `${GSK}\n${CSK}`, test: fakeTest, probeLocal: true, crypto });
  assert.deepEqual(out.links.map((l) => [l.name, l.ok, l.model]), [
    ["cerebras", true, "qwen-3-coder-480b"],
    ["groq", true, "openai/gpt-oss-120b"],
    ["ollama", true, "qwen2.5-coder:7b"],
  ]);
  assert.equal(out.localFound, true);
  assert.equal(out.from, "paste");
});

test("spark reports failures per link instead of failing the batch", async () => {
  const out = await spark({ text: `groq: bad\n${CSK}\n${"gsk_" + "b".repeat(30)}`, test: (l) => (l.name === "groq" ? Promise.reject(new Error("nope")) : fakeTest(l)) });
  const n = byName(out.links);
  assert.equal(n.cerebras.ok, true);
  assert.equal(n.groq.ok, false);
  assert.equal(n.groq.error, "nope");
});

test("spark opens a sealed pass, keeps its models, and fills recipe gaps from saved keys", async () => {
  const sealed = await makePass(CHAIN, { passphrase: "a long passphrase", crypto });
  const need = spark({ text: sealed, test: fakeTest, crypto });
  await assert.rejects(need, (e) => e.code === "NEED_PASSPHRASE");
  const out = await spark({ text: sealed, passphrase: "a long passphrase", test: fakeTest, crypto });
  assert.equal(out.from, "sealed pass");
  assert.equal(byName(out.links).cerebras.apiKey, CSK);
  assert.equal(byName(out.links).cerebras.model, "qwen-3-coder-480b");

  const recipe = await makePass(CHAIN, { sealed: false });
  const fresh = await spark({ text: recipe, test: fakeTest, crypto });
  assert.equal(byName(fresh.links).cerebras.needsKey, true);
  const reused = await spark({ text: recipe, test: fakeTest, crypto, existing: [{ baseUrl: "https://api.cerebras.ai/v1/", apiKey: "saved-key" }] });
  assert.equal(byName(reused.links).cerebras.keyFrom, "saved");
  assert.equal(byName(reused.links).cerebras.ok, true);
});

test("spark with verify:false contacts nothing", async () => {
  let calls = 0;
  const out = await spark({ text: CSK, verify: false, probeLocal: true, test: async () => { calls++; return []; } });
  assert.equal(calls, 0);
  assert.equal(out.links[0].ok, undefined);
});

test("a hung provider times out without holding up the rest", async () => {
  const out = await spark({
    text: `${CSK}\n${GSK}`,
    timeoutMs: 50,
    test: (l) => (l.name === "groq" ? new Promise(() => {}) : fakeTest(l)),
  });
  const n = byName(out.links);
  assert.equal(n.cerebras.ok, true);
  assert.match(n.groq.error, /No answer/);
});
