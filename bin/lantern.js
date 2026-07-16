#!/usr/bin/env node
import { spawn } from "node:child_process";
import { platform } from "node:process";
import { startServer } from "../src/server.js";

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

const { port } = await startServer(Number(process.env.PORT) || 4317);
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
console.log("  \x1b[33m✦ Lantern is running\x1b[0m");
console.log(`  Open in your browser:  \x1b[36m${url}\x1b[0m`);
console.log("  Press Ctrl+C here to stop it.");
console.log("");

openBrowser(url);
