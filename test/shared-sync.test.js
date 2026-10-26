import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { webcrypto as crypto } from "node:crypto";
import { syncAll, extractBlock, ROOT } from "../scripts/sync-shared.js";
import * as spark from "../src/spark.js";
import { renderMarkdown } from "../src/markdown.js";

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const pkg = JSON.parse(read("package.json"));
// The pages run these blocks as classic scripts; evaluate them the same way.
const load = (page, tag, name) => new Function(`${extractBlock(read(page), tag).block}\nreturn ${name};`)();
const LiteSpark = load("lantern-lite.html", "spark", "Spark");

test("every page embeds the current shared code (run `npm run sync` if this fails)", () => {
  for (const [page, p] of Object.entries(syncAll())) assert.ok(p.next === p.current, `${page} is out of date`);
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

test("both pages render chat Markdown exactly like the module", () => {
  const sample = "# Hi\n\n- **one**\n- [two](https://example.com)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>x</script>";
  for (const page of ["lantern-lite.html", "public/index.html"]) {
    assert.equal(load(page, "markdown", "Markdown").renderMarkdown(sample), renderMarkdown(sample), page);
  }
});

test("Lite's version matches package.json", () => {
  const v = pkg.version.replace(/\./g, "\\.");
  const lite = read("lantern-lite.html");
  assert.match(lite, new RegExp(`const LITE_VERSION = "${v}"`));
  assert.match(lite, new RegExp(`<meta name="version" content="${v}"`));
});
