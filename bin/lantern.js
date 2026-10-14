#!/usr/bin/env node
import { spawn } from "node:child_process";
import { platform } from "node:process";
import { startServer, VERSION } from "../src/server.js";
import { parseArgs, USAGE } from "../src/cli.js";

function openBrowser(url) {
  const cmds = {
    darwin: ["open", [url]],
    win32: ["cmd", ["/c", "start", "", url]],
    linux: ["xdg-open", [url]],
  };
  const entry = cmds[platform];
  if (!entry) return;
  try {
    const child = spawn(entry[0], entry[1], { stdio: "ignore", detached: true });
    child.on("error", () => {}); // fall back to the printed URL
    child.unref();
  } catch {
    /* user can click the printed URL */
  }
}

const args = parseArgs(process.argv.slice(2), process.env);
if (args.help) { console.log(USAGE); process.exit(0); }
if (args.version) { console.log(VERSION); process.exit(0); }
if (args.errors.length) {
  for (const e of args.errors) console.error("  " + e);
  console.error("\n" + USAGE);
  process.exit(2);
}

let port;
try {
  ({ port } = await startServer(args.port, { dir: args.dir, model: args.model }));
} catch (e) {
  console.error("  " + e.message);
  process.exit(1);
}
const url = `http://127.0.0.1:${port}`;

console.log("");
console.log("  \x1b[32m     ╭─╮\x1b[0m");
console.log("  \x1b[32m  ╭──┴─┴──╮\x1b[0m");
console.log("  \x1b[32m  │ ╔═══╗ │\x1b[0m");
console.log("  \x1b[32m  │ ║ ▲ ║ │\x1b[0m");
console.log("  \x1b[32m  │ ║▒█▒║ │\x1b[0m");
console.log("  \x1b[32m  │ ╚═══╝ │\x1b[0m");
console.log("  \x1b[32m  ╰──┬─┬──╯\x1b[0m");
console.log("  \x1b[32m     ╰─╯\x1b[0m");
console.log("");
console.log(`  \x1b[33m✦ Lantern v${VERSION} is running\x1b[0m`);
console.log(`  Open in your browser:  \x1b[36m${url}\x1b[0m`);
if (args.dir) console.log(`  Working folder:        ${args.dir}`);
console.log("  Press Ctrl+C here to stop it.");
console.log("");

if (args.open) openBrowser(url);
