import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = join(homedir(), ".lantern");
const FILE = join(DIR, "config.json");

const DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.cerebras.ai/v1",
  model: "",
  lastCwd: "",
};

export function loadConfig() {
  try {
    if (!existsSync(FILE)) return { ...DEFAULTS };
    const raw = readFileSync(FILE, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export { FILE as CONFIG_PATH };
