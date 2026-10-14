# Changelog

All notable changes to Lantern. Versions follow [semver](https://semver.org).

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
