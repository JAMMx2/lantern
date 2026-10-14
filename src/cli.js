// Command-line flag parsing for bin/lantern.js. Kept separate so it's testable.

export const USAGE = `Lantern — a private coding agent that asks before it acts.

Usage: lantern [options]

  --port <n>     Port to listen on (default 4317, or $PORT). Auto-increments if busy.
  --dir <path>   Folder the agent works in (saved as the working folder).
  --model <id>   Model for the first provider in your relay chain.
  --no-open      Don't open the browser automatically.
  --version      Print the version and exit.
  --help         Show this help.

Config and chat history live in ~/.lantern (override with $LANTERN_HOME).`;

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @param {object} env     process.env
 * @returns {{port:number, dir?:string, model?:string, open:boolean, help:boolean, version:boolean, errors:string[]}}
 */
export function parseArgs(argv = [], env = {}) {
  const out = { port: Number(env.PORT) || 4317, open: true, help: false, version: false, errors: [] };
  const takeValue = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) { out.errors.push(`${flag} needs a value`); return undefined; }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const value = () => (inline !== undefined ? inline : (i++, takeValue(i - 1, flag)));
    switch (flag) {
      case "--port": case "-p": {
        const v = value();
        const n = Number(v);
        if (v !== undefined && (!Number.isInteger(n) || n < 1 || n > 65535)) out.errors.push(`--port must be 1-65535, got "${v}"`);
        else if (v !== undefined) out.port = n;
        break;
      }
      case "--dir": case "-d": { const v = value(); if (v !== undefined) out.dir = v; break; }
      case "--model": case "-m": { const v = value(); if (v !== undefined) out.model = v; break; }
      case "--no-open": out.open = false; break;
      case "--help": case "-h": out.help = true; break;
      case "--version": case "-v": out.version = true; break;
      default: out.errors.push(`Unknown option: ${a}`);
    }
  }
  return out;
}
