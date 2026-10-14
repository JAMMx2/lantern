import { test } from "node:test";
import assert from "node:assert/strict";
import { unifiedDiff, diffLines, diffStats, DIFF_LINE_CAP } from "../src/diff.js";

test("identical text produces no diff", () => {
  assert.equal(unifiedDiff("a\nb\n", "a\nb\n", "x.txt"), "");
  assert.deepEqual(diffStats("a\nb", "a\nb"), { added: 0, removed: 0 });
});

test("single line change yields one hunk with context", () => {
  const a = "one\ntwo\nthree\nfour\nfive\n";
  const b = "one\ntwo\nTHREE\nfour\nfive\n";
  const d = unifiedDiff(a, b, "f.txt", 1);
  assert.match(d, /^--- a\/f\.txt\n\+\+\+ b\/f\.txt\n@@ -2,3 \+2,3 @@\n two\n-three\n\+THREE\n four$/);
  assert.deepEqual(diffStats(a, b), { added: 1, removed: 1 });
});

test("additions at end and removals at start", () => {
  const ops = diffLines("x\ny", "y\nz");
  assert.deepEqual(ops.map((o) => o.t + o.s), ["-x", " y", "+z"]);
});

test("oversized inputs return a note instead of a table", () => {
  const big = Array.from({ length: DIFF_LINE_CAP + 10 }, (_, i) => "l" + i).join("\n");
  const other = Array.from({ length: DIFF_LINE_CAP + 10 }, (_, i) => "m" + i).join("\n");
  assert.equal(diffLines(big, other), null);
  assert.match(unifiedDiff(big, other, "f"), /too large to diff/);
});
