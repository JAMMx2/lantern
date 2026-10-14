import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";

test("defaults", () => {
  const a = parseArgs([], {});
  assert.equal(a.port, 4317);
  assert.equal(a.open, true);
  assert.deepEqual(a.errors, []);
});

test("flags in both forms, env PORT, and validation", () => {
  const a = parseArgs(["--port", "5000", "--dir=/tmp", "-m", "llama-3.3-70b", "--no-open"], { PORT: "9" });
  assert.equal(a.port, 5000);
  assert.equal(a.dir, "/tmp");
  assert.equal(a.model, "llama-3.3-70b");
  assert.equal(a.open, false);
  assert.equal(parseArgs([], { PORT: "9" }).port, 9);
  assert.match(parseArgs(["--port", "abc"], {}).errors[0], /--port/);
  assert.match(parseArgs(["--dir"], {}).errors[0], /needs a value/);
  assert.match(parseArgs(["--bogus"], {}).errors[0], /Unknown option/);
  assert.equal(parseArgs(["--help"], {}).help, true);
  assert.equal(parseArgs(["-v"], {}).version, true);
});
