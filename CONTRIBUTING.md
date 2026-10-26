# Contributing to Lantern

Thanks for wanting to help. Lantern is small on purpose — that's the feature.

## Ground rules

1. **Zero runtime dependencies.** The app uses only what ships with Node 18+ (`http`, `fs`, `child_process`, native `fetch`). Lantern Lite uses only what ships with a browser. PRs that add a package will be asked to do it without one.
2. **The approval gate is sacred.** Anything that writes files or runs commands must go through the Allow/Deny card. No silent writes, ever — not even "harmless" ones.
3. **Two builds, one behavior.** If you change agent behavior in `src/`, check whether `lantern-lite.html` needs the same change (it carries its own copy of the loop). `src/spark.js` and `src/markdown.js` are the exception: they're shared verbatim. Edit them there, run `npm run sync` to refresh the copies embedded in the pages, and commit everything; `npm test` fails if a copy drifts.
4. **No build step for users.** The UI is one HTML file per build, always committed complete. Keep it that way — it's what makes "download and double-click" possible. (`npm run sync` is a contributor tool, not a build.)

## Running from source

```
git clone https://github.com/JAMMx2/lantern.git
cd lantern
node bin/lantern.js     # or: npm start
```

No install step. Set `PORT` or pass `--port` to change the port (default 4317). `npm test` runs the suite.

No API key handy? `node test/fake-provider.js 4499` starts a local OpenAI-compatible stub. Paste `http://127.0.0.1:4499/limited/v1` and `http://localhost:4499/ok/v1` into Spark to get a two-link chain where the first link always rate-limits, which shows the relay lights and failover notes.

For Lantern Lite, just open `lantern-lite.html` in a browser. To test real-folder access you need https or localhost — easiest is `npx serve .` or pushing to your fork's GitHub Pages.

## Adding a tool

1. Implement it in `src/tools.js`.
2. Add its JSON schema to `TOOL_DEFS`.
3. Decide whether it belongs in `NEEDS_APPROVAL` (if it mutates anything or leaves the sandbox: yes). If it changes a file, record `{ path, before }` on the undo stack so `/undo` works.
4. Add a test in `test/tools.test.js`.
5. Mirror it in `lantern-lite.html` if it makes sense in a browser.

## Style

- Vanilla JS, no transpiling, no frameworks.
- Match the existing code: small functions, comments explain *why*, not *what*.
- UI changes should respect the CRT theme (CSS variables at the top of each HTML file) and `prefers-reduced-motion`.
- No emoji in UI labels: use an inline SVG icon or plain text.

## Sending a PR

- One change per PR, with a clear description of what it does and why.
- Test on at least one of: macOS, Linux, Windows — and say which.
- If it touches security-relevant code (path confinement, the token check, approvals), call that out loudly in the description.

## Bugs & ideas

Open an issue: <https://github.com/JAMMx2/lantern/issues>. For security problems, see [SECURITY.md](SECURITY.md) instead.
