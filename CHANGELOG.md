# Changelog

All notable changes to Lantern. Versions follow [semver](https://semver.org).

## 0.5.0 — 2026-10-22

Setup goes from "fill in a form per provider" to "paste once", and your setup now travels between the app, Lite, and other devices.

### Added — both builds
- **Spark: paste anything.** One box at the top of setup takes API keys in any order (a whole `.env` file is fine), endpoint URLs, or a Lantern Pass. Keys are matched to providers by format (`csk-`, `gsk_`, `AIza`, `sk-or-v1-`) or by a provider named on the same or previous line; every link is tested in parallel, a tool-calling coding model is picked for each, and the chain is ordered fastest-first with Ollama last. The app also adds Ollama automatically when it's running locally. Pasting runs Spark immediately; Ctrl/Cmd+Enter re-runs it.
- **Lantern Pass.** Export the saved chain as a **sealed** pass (keys included, AES-256-GCM, PBKDF2-SHA256 600k) or a **recipe** (endpoints and models only). Passes are interchangeable between the app and Lite, and come with a link to the hosted Lite (`…/#pass=…`) that sets it up in one step. A suggested random passphrase (~78 bits) is offered.
- **Relay lights.** One lamp per link in the header (ready, answering, answered last, resting with a countdown). Click to open setup. Failovers show in the chat as `cerebras rate-limited · trying groq`.
- **More free providers:** Mistral and OpenRouter presets (OpenRouter prefers `:free` models).
- **Smarter Test button:** picks a coding model from the list instead of the alphabetically first one.
- `/spark` and `/pass` slash commands.

### Added — the app
- `POST /api/spark` and `POST /api/pass`; `/api/config` now returns the provider catalog the setup screen is built from.
- NDJSON events `relay` and `hop`.
- One-command start documented: `npx github:JAMMx2/lantern`.

### Added — Lantern Lite
- Opening a pass link removes the pass from the address bar and asks for the passphrase if the pass is sealed.
- The footer hint and the model's instructions point to `npx github:JAMMx2/lantern` when a task needs real commands.

### Changed
- Custom endpoints are named by host (`api.together.xyz`) instead of `custom`, so lamps and failover notes say where they point.
- Saved keyless links (Ollama, custom endpoints) no longer have to be re-tested every time setup is reopened.
- The setup card scrolls instead of clipping on short screens.

### Developer
- `src/spark.js` is shared: the app imports it and `npm run sync-lite` embeds it in `lantern-lite.html`. The suite fails if they drift, and also checks that a pass sealed by one build opens in the other.
- `test/fake-provider.js`: a local OpenAI-compatible stub (rate-limited, bad-key and tool-calling providers) used by the new relay tests and handy for UI work.
- CI runs `npm test` on Node 18, 20 and 22.

## 0.4.0 — 2026-10-13

### Fixed
- **The app could not start.** `src/agent.js` imported `src/tools.js`, which was never committed. The module is back, rebuilt with the full tool set below.
- The app's boot screen now shows the provider's real error (for example a rejected key) instead of a generic "couldn't reach your provider", and keeps the saved model selectable so a flaky connection doesn't block the composer.
- Lite: a saved chain whose provider is unreachable no longer bounces you back to the setup screen; it tells you why and keeps the saved model.
- Tool-call arguments that arrive malformed (trailing text, double-encoded JSON) are salvaged instead of silently becoming `{}`.

### Added — the app
- **Tools:** `edit_file` (exact-snippet replace), `search_files` (text/regex across the folder, skips `.git`/`node_modules`), and read-only `git` (status / diff / log) alongside `list_dir`, `read_file`, `write_file`, `run_command`.
- **Diff preview.** Approval cards for `write_file` on an existing file and for every `edit_file` show a unified diff with +/- line counts. New files still show their content.
- **Chat history with resume.** Every chat is saved to `~/.lantern/sessions/<id>.json` after each step. A **History** button lists saved chats; click one to continue it. Delete from the same panel.
- **`/undo`.** Reverts the last file Lantern wrote or edited in the chat (created files are removed, edited files restored). Repeat to step further back. Also `/history`, `/new`, `/help`.
- **Token usage** in the header (prompt / completion for the chat), fed by `stream_options.include_usage`; falls back gracefully on providers that reject the option.
- **`LANTERN.md`** in the working folder is loaded into the system prompt every turn (capped at 8k chars). The transcript notes when it was loaded.
- **CLI flags:** `--port`, `--dir`, `--model`, `--no-open`, `--version`, `--help`. `LANTERN_HOME` overrides `~/.lantern`.
- **Friendlier provider errors** for 401/403, 404, 429, 413, 5xx, DNS/connection failures, and a specific hint when Ollama isn't running.
- **Tests:** `npm test` runs a `node:test` suite covering path confinement (including symlink escapes), edit/undo, search, the diff engine, CLI parsing, and server auth/token checks. Still zero dependencies.
- `/api/config` reports the version; the header shows it.

### Added — Lantern Lite
- **Edit tool with diff preview** (`edit_file`) and **search** (`search_files`) in both real-folder and in-browser workspace modes.
- **Chat history** saved in this browser's `localStorage` (never leaves the device), with a History panel to resume or delete chats.
- **`/undo`** for the last file change, plus `/history`, `/new`, `/export`, `/help`.
- **Export** the current chat as Markdown.
- **Token usage** counter in the header.
- **`LANTERN.md`** project notes loaded from the workspace.
- Friendlier error messages, including the https-page-to-http-endpoint case and the Ollama `OLLAMA_ORIGINS` hint.
- A version string (`v0.4.0`) in the header and `<meta name="version">`.

### Changed
- UI labels use inline SVG icons instead of the `⚙` glyph (Settings, History, Export).
- README, SECURITY and CONTRIBUTING updated for the new tools, history files, flags and tests.

## 0.3.1 and earlier

Relay chain of OpenAI-compatible providers with automatic 429 failover, streaming responses, session token + Host check against drive-by requests, Lantern Lite with real-folder access on Chrome/Edge and an in-browser workspace elsewhere.
