#!/usr/bin/env node
// Copies the shared modules into the single-file pages, each between its
// // <tag> … // </tag> markers and wrapped as a namespace, so every page stays
// one file with no build step for users.
//   node scripts/sync-shared.js          rewrite the blocks
//   node scripts/sync-shared.js --check  exit 1 if any block is out of date
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SHARED = [
  { module: "src/spark.js", tag: "spark", name: "Spark", pages: ["lantern-lite.html"] },
  { module: "src/markdown.js", tag: "markdown", name: "Markdown", pages: ["lantern-lite.html", "public/index.html"] },
];

export function block(shared, source) {
  const names = [...source.matchAll(/^export (?:async )?(?:function|const|let) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = source.replace(/^export /gm, "").trimEnd();
  return `// <${shared.tag}> generated from ${shared.module} by \`npm run sync\`. Edit that file, not this block.
const ${shared.name} = (() => {
"use strict";
${body}
return { ${names.join(", ")} };
})();
// </${shared.tag}>`;
}

export function extractBlock(html, tag) {
  const start = `// <${tag}>`, end = `// </${tag}>`;
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`Missing its ${start} … ${end} markers.`);
  return { before: html.slice(0, a), block: html.slice(a, b + end.length), after: html.slice(b + end.length) };
}

/** Every page as it should read, keyed by path: { page: { current, next } }. */
export function syncAll(read = (p) => readFileSync(join(ROOT, p), "utf8")) {
  const pages = {};
  for (const shared of SHARED) {
    const source = read(shared.module);
    for (const page of shared.pages) {
      pages[page] ??= { current: read(page) };
      const html = pages[page].next ?? pages[page].current;
      let parts;
      try { parts = extractBlock(html, shared.tag); } catch (e) { throw new Error(`${page}: ${e.message}`); }
      pages[page].next = parts.before + block(shared, source) + parts.after;
    }
  }
  return pages;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const stale = Object.entries(syncAll()).filter(([, p]) => p.next !== p.current);
  if (process.argv.includes("--check")) {
    if (stale.length) {
      console.error(`Out of date with src/: ${stale.map(([page]) => page).join(", ")}. Run: npm run sync`);
      process.exit(1);
    }
    console.log("Shared code is in sync.");
  } else {
    for (const [page, p] of stale) writeFileSync(join(ROOT, page), p.next);
    console.log(stale.length ? `Updated ${stale.map(([page]) => page).join(", ")}.` : "Already in sync.");
  }
}
