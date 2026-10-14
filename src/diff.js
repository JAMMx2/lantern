// Tiny line-based unified diff. Zero deps, used for the approval card so the
// user sees exactly what will change in an existing file before saying yes.
//
// LCS over lines is O(n*m); files past DIFF_LINE_CAP lines on either side get
// a "too large to diff" note instead of a 100 MB table.

export const DIFF_LINE_CAP = 3000;

function splitLines(s) {
  const lines = String(s ?? "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Returns a list of ops: { t: " " | "-" | "+", s: line }.
 */
export function diffLines(a, b) {
  const A = splitLines(a), B = splitLines(b);
  // Trim common prefix/suffix first: most edits touch a small region.
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length, endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) { endA--; endB--; }

  const n = endA - start, m = endB - start;
  if (n > DIFF_LINE_CAP || m > DIFF_LINE_CAP) return null;

  // LCS table on the middle section.
  const W = m + 1;
  const L = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = A[start + i] === B[start + j]
        ? L[(i + 1) * W + j + 1] + 1
        : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  const ops = [];
  for (let k = 0; k < start; k++) ops.push({ t: " ", s: A[k] });
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[start + i] === B[start + j]) { ops.push({ t: " ", s: A[start + i] }); i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { ops.push({ t: "-", s: A[start + i] }); i++; }
    else { ops.push({ t: "+", s: B[start + j] }); j++; }
  }
  while (i < n) { ops.push({ t: "-", s: A[start + i++] }); }
  while (j < m) { ops.push({ t: "+", s: B[start + j++] }); }
  for (let k = endA; k < A.length; k++) ops.push({ t: " ", s: A[k] });
  return ops;
}

/**
 * Unified-diff text with `context` lines around each change.
 * Returns "" when there is no change, or a note when the file is too big.
 */
export function unifiedDiff(a, b, path = "file", context = 3) {
  if (a === b) return "";
  const ops = diffLines(a, b);
  if (!ops) return `(file too large to diff: ${splitLines(a).length} -> ${splitLines(b).length} lines)`;
  const changed = ops.some((o) => o.t !== " ");
  if (!changed) return "";

  // Group into hunks.
  const keep = new Array(ops.length).fill(false);
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].t === " ") continue;
    for (let c = Math.max(0, k - context); c <= Math.min(ops.length - 1, k + context); c++) keep[c] = true;
  }
  const out = [`--- a/${path}`, `+++ b/${path}`];
  let k = 0, oldLine = 1, newLine = 1;
  while (k < ops.length) {
    if (!keep[k]) {
      if (ops[k].t !== "+") oldLine++;
      if (ops[k].t !== "-") newLine++;
      k++;
      continue;
    }
    const hunkStart = k;
    const oStart = oldLine, nStart = newLine;
    let oCount = 0, nCount = 0;
    const body = [];
    while (k < ops.length && keep[k]) {
      const o = ops[k];
      body.push(o.t + o.s);
      if (o.t !== "+") { oCount++; oldLine++; }
      if (o.t !== "-") { nCount++; newLine++; }
      k++;
    }
    void hunkStart;
    out.push(`@@ -${oStart},${oCount} +${nStart},${nCount} @@`);
    out.push(...body);
  }
  return out.join("\n");
}

/** Count added/removed lines for a one-line summary. */
export function diffStats(a, b) {
  const ops = diffLines(a, b);
  if (!ops) return { added: null, removed: null };
  let added = 0, removed = 0;
  for (const o of ops) { if (o.t === "+") added++; else if (o.t === "-") removed++; }
  return { added, removed };
}
