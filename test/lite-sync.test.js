import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";
import { syncLite, extractBlock, LITE_FILE, SPARK_FILE } from "../scripts/sync-lite.js";
import * as spark from "../src/spark.js";

const html = readFileSync(LITE_FILE, "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
// Lite's copy runs as a classic strict-mode script; evaluate it the same way.
const LiteSpark = new Function(`"use strict";\n${extractBlock(html).block}\nreturn Spark;`)();

test("lantern-lite.html embeds the current src/spark.js (run `npm run sync-lite` if this fails)", () => {
  assert.ok(syncLite(html, readFileSync(SPARK_FILE, "utf8")) === html);
});

test("Lite's Spark exposes everything the module exports", () => {
  assert.deepEqual(Object.keys(LiteSpark).sort(), Object.keys(spark).sort());
});

test("Lite and the app read the same paste the same way", () => {
  const paste = `CEREBRAS_API_KEY=csk-${"a1".repeat(20)}\nMistral:\n${["Ab3dEf6h", "Ij9kLm2n", "Op5qRs8t", "Uv1wXy4z"].join("")}\nhttp://localhost:1234/v1`;
  assert.deepEqual(LiteSpark.detectInput(paste), spark.detectInput(paste));
  const models = ["llama-3.3-70b", "gpt-oss-120b"];
  assert.equal(LiteSpark.bestModel(models, "groq"), spark.bestModel(models, "groq"));
});

test("a pass sealed by the app opens in Lite, and the other way round", async () => {
  const chain = [{ name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk_secret", model: "m" }];
  const fromApp = await spark.makePass(chain, { passphrase: "shared passphrase", crypto });
  assert.equal((await LiteSpark.openPass(fromApp, { passphrase: "shared passphrase", crypto })).links[0].apiKey, "gsk_secret");
  const fromLite = await LiteSpark.makePass(chain, { passphrase: "shared passphrase", crypto });
  assert.equal((await spark.openPass(fromLite, { passphrase: "shared passphrase", crypto })).links[0].apiKey, "gsk_secret");
});

test("Lite's version matches package.json", () => {
  assert.match(html, new RegExp(`const LITE_VERSION = "${pkg.version.replace(/\./g, "\\.")}"`));
  assert.match(html, new RegExp(`<meta name="version" content="${pkg.version.replace(/\./g, "\\.")}"`));
});
