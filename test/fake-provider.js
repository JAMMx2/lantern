// A tiny OpenAI-compatible server for tests and local UI checks.
// Each first path segment is its own "provider", behaving by prefix:
// /ok…/v1, /limited…/v1 (429s on chat), /badkey…/v1 (401 everywhere).
// Chat replies stream as SSE; a user message containing "write" gets a
// write_file tool call first.
import http from "node:http";

const MODELS = ["llama-3.3-70b", "qwen-3-coder-480b", "text-embedding-3"];

function sse(res, chunks) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end("data: [DONE]\n\n");
}

export function startFakeProvider(port = 0) {
  const server = http.createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const [, name, , route] = req.url.split("?")[0].split("/");
    const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", ...cors }); res.end(JSON.stringify(body)); };
    if (name.startsWith("badkey")) return json(401, { error: { message: "Invalid API key" } });
    if (route === "models") return json(200, { data: MODELS.map((id) => ({ id })) });
    if (route !== "chat") return json(404, { error: { message: "not found" } });
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (name.startsWith("limited")) return json(429, { error: { message: "Too many requests" } });
      const body = JSON.parse(raw || "{}");
      const last = (body.messages || []).at(-1) || {};
      const usage = { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 };
      if (last.role === "user" && /write/i.test(last.content || "")) {
        return sse(res, [
          { choices: [{ delta: { content: "I'll create hello.txt." } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "write_file", arguments: "" } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: "hello.txt", content: "hi from lantern\n" }) } }] } }] },
          { choices: [], usage },
        ]);
      }
      const text = last.role === "tool" ? "Done. hello.txt is ready." : `Hello from ${name}.`;
      sse(res, [...text.match(/.{1,6}/g).map((t) => ({ choices: [{ delta: { content: t } }] })), { choices: [], usage }]);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, base, url: (name) => `${base}/${name}/v1` });
  }));
}

// `node test/fake-provider.js 4499` runs it standalone for manual UI checks.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { base } = await startFakeProvider(Number(process.argv[2]) || 4499);
  console.log(`fake provider at ${base}/{ok,limited,badkey}/v1`);
}
