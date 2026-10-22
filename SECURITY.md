# Security Policy

Lantern is a local agent that can write files and run shell commands with the
user's approval. That makes its security model worth stating plainly.

## Threat model

**What Lantern defends against**

- **Path escape.** File tools are confined to the folder you picked. Paths are resolved to their real location (symlinks included) and rejected if they land outside it.
- **Drive-by control (CSRF / DNS rebinding).** The local server binds to localhost, checks the `Host` header, and requires a per-run session token that is injected into the served page. A malicious website in your browser can send requests to localhost, but it can't read the token, so it can't forge an approved action.
- **Silent mutation.** Every file write and every shell command is shown to you — full content, exact command — and waits for explicit approval. A denial is reported to the model as a denial; there is no retry-around-it path.
- **Supply chain.** There are zero npm dependencies. The only network destinations are the providers you put in your relay chain (Cerebras by default), each authenticated with your key.
- **Blind edits.** Changes to an existing file are shown as a diff, and `/undo` reverts the last write, so an approved-but-wrong change is cheap to take back.
- **Keys sent to the wrong place during setup.** Spark assigns each pasted key to one provider by its published format, or by a provider named on the same or previous line, and sends it only to that provider. It never tries a key against several services to see which accepts it. Keys it can't place are shown masked and sent nowhere.
- **Leaked setup.** A sealed Lantern Pass is AES-256-GCM with a key from PBKDF2-SHA256 (600,000 iterations, random 16-byte salt and 12-byte IV, authenticated with a fixed associated-data label). The passphrase is never stored and never put in a pass or a link. Pass links carry the pass in the URL fragment, which browsers don't send to servers, and Lite strips it from the address bar on open.
- **Forged recipes.** A pass can't relabel an endpoint: each link's provider is decided from its URL, never from the name inside the pass, and recipe passes are stripped of any keys they claim to carry. A shared recipe can't make a stranger's server look like "groq" to collect your key.
- **Surprise programs.** Setup's Start buttons run one fixed command per app (open the Ollama app, `lms server start` from LM Studio's own folder, open Jan/Msty/Docker Desktop), chosen from an allowlist by app id. No text from the page, a pasted file or the model reaches a command line, and the agent can't press these buttons. Model downloads go only to Ollama on `127.0.0.1`, with the model name checked against a strict pattern.
- **Keys echoed to the page.** `/api/config` and `/api/spark` never return a saved key. Exporting a sealed pass is the one route by which saved keys leave `config.json`, encrypted under the passphrase you chose.

**What Lantern does not defend against**

- **Approved commands.** If you click Allow on a command, it runs with your user's permissions. The approval card is the defense; read it.
- **A hostile local machine.** If something else on your computer can already read your files, it can read `~/.lantern/config.json` (your API key) and `~/.lantern/sessions/` (your chat transcripts, which may quote your files). Both are written with owner-only permissions, but local malware is out of scope.
- **A weak passphrase.** Anyone holding a sealed pass can try passphrases offline. The suggested passphrase has about 78 bits of entropy; one you pick yourself is only as strong as you make it. Browsers may also keep a pass link you opened in their history; the pass inside stays encrypted.
- **Prompt injection in the folder you open.** Files in your working folder are fed to the model as context. A malicious file could try to talk the model into proposing something harmful — which is exactly why writes and commands always stop for your approval, even mid-task.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private reporting: **Security → Report a vulnerability** on
<https://github.com/JAMMx2/lantern>, and include steps to reproduce.
You'll get a response as quickly as possible, and credit in the fix notes
unless you'd rather stay anonymous.

## Scope notes for researchers

Most interesting areas, in rough order:

1. Escaping the working-folder confinement in `src/tools.js` (or the Lite equivalents in `lantern-lite.html`).
2. Driving the agent without the session token (`src/server.js`).
3. Getting a write or command to execute without an approval card being resolved.
4. Recovering keys from a sealed Lantern Pass without its passphrase, or getting Spark or a pass to send a key to a provider it doesn't belong to (`src/spark.js`).
5. Making `/api/local/start` or `/api/local/pull` run anything other than their fixed commands and Ollama's download API (`src/local.js`).
