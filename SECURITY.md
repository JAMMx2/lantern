# Security Policy ✦

Lantern is a local agent that can write files and run shell commands with the
user's approval. That makes its security model worth stating plainly.

## Threat model

**What Lantern defends against**

- **Path escape.** File tools are confined to the folder you picked. Paths are resolved to their real location (symlinks included) and rejected if they land outside it.
- **Drive-by control (CSRF / DNS rebinding).** The local server binds to localhost, checks the `Host` header, and requires a per-run session token that is injected into the served page. A malicious website in your browser can send requests to localhost, but it can't read the token, so it can't forge an approved action.
- **Silent mutation.** Every file write and every shell command is shown to you — full content, exact command — and waits for explicit approval. A denial is reported to the model as a denial; there is no retry-around-it path.
- **Supply chain.** There are zero npm dependencies. The only network destination is `api.cerebras.ai`, authenticated with your key.

**What Lantern does not defend against**

- **Approved commands.** If you click Allow on a command, it runs with your user's permissions. The approval card is the defense; read it.
- **A hostile local machine.** If something else on your computer can already read your files, it can read `~/.lantern/config.json` (your API key). The file is written with owner-only permissions, but local malware is out of scope.
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
