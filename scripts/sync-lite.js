#!/usr/bin/env node
// Copies src/spark.js into lantern-lite.html between its // <spark> markers,
// wrapped as a `Spark` namespace, so Lite stays one file with no build step.
//   node scripts/sync-lite.js          rewrite the block
//   node scripts/sync-lite.js --check  exit 1 if the block is out of date
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LITE_FILE = join(ROOT, "lantern-lite.html");
export const SPARK_FILE = join(ROOT, "src", "spark.js");
const START = "// <spark>";
const END = "// </spark>";

export function liteBlock(source) {
  const names = [...source.matchAll(/^export (?:async )?(?:function|const|let) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = source.replace(/^export /gm, "").trimEnd();
  return `${START} generated from src/spark.js by \`npm run sync-lite\`. Edit that file, not this block.
const Spark = (() => {
${body}
return { ${names.join(", ")} };
})();
${END}`;
}

export function extractBlock(html) {
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < a) throw new Error("lantern-lite.html is missing its // <spark> … // </spark> markers.");
  return { before: html.slice(0, a), block: html.slice(a, b + END.length), after: html.slice(b + END.length) };
}

export function syncLite(html, source) {
  const { before, after } = extractBlock(html);
  return before + liteBlock(source) + after;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const html = readFileSync(LITE_FILE, "utf8");
  const next = syncLite(html, readFileSync(SPARK_FILE, "utf8"));
  if (process.argv.includes("--check")) {
    if (next !== html) {
      console.error("lantern-lite.html is out of date with src/spark.js. Run: npm run sync-lite");
      process.exit(1);
    }
    console.log("lantern-lite.html is in sync.");
  } else if (next !== html) {
    writeFileSync(LITE_FILE, next);
    console.log("Updated the Spark block in lantern-lite.html.");
  } else {
    console.log("lantern-lite.html already in sync.");
  }
}
