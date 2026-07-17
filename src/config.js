import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = join(homedir(), ".lantern");
const FILE = join(DIR, "config.json");

// v0.3: an ordered relay chain instead of a single provider.
const DEFAULTS = {
  providers: [], // [{ name, baseUrl, apiKey, model }]
  lastCwd: "",
};

export function nameFor(baseUrl = "") {
  if (baseUrl.includes("cerebras")) return "cerebras";
  if (baseUrl.includes("groq")) return "groq";
  if (baseUrl.includes("sambanova")) return "sambanova";
  if (baseUrl.includes("googleapis")) return "gemini";
  if (baseUrl.includes(":11434")) return "ollama";
  return "custom";
}

export function loadConfig() {
  try {
    if (!existsSync(FILE)) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    const cfg = { ...DEFAULTS, ...raw };
    // Migrate a v0.2 single-provider config into a one-link chain.
    if ((!cfg.providers || !cfg.providers.length) && raw.apiKey) {
      cfg.providers = [
        {
          name: nameFor(raw.baseUrl || ""),
          baseUrl: raw.baseUrl || "https://api.cerebras.ai/v1",
          apiKey: raw.apiKey,
          model: raw.model || "",
        },
      ];
    }
    return cfg;
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
