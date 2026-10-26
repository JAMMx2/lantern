import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown as md } from "../src/markdown.js";

test("headings, paragraphs, emphasis and line breaks", () => {
  assert.equal(md("# Plan\n\nDay **one** is *easy*.\nDay two isn't."),
    "<h3>Plan</h3><p>Day <strong>one</strong> is <em>easy</em>.<br>Day two isn&#39;t.</p>");
  assert.equal(md("## Learn C#"), "<h4>Learn C#</h4>");
  assert.equal(md("call my_var_name and 2*3*4"), "<p>call my_var_name and 2*3*4</p>", "snake_case and maths stay plain");
});

test("lists: bullets, numbers with a start, and nesting", () => {
  assert.equal(md("- eggs\n- milk\n  - oat\n- bread"), "<ul><li>eggs</li><li>milk<ul><li>oat</li></ul></li><li>bread</li></ul>");
  assert.equal(md("3. three\n4. four"), '<ol start="3"><li>three</li><li>four</li></ol>');
  assert.equal(md("1. step\n   still step one\n2. next"), "<ol><li>step still step one</li><li>next</li></ol>");
  assert.equal(md("- a\n    - deep\n  - shallow"), "<ul><li>a<ul><li>deep</li></ul><ul><li>shallow</li></ul></li></ul>", "uneven indents keep every item");
});

test("tables with alignment, quotes, rules and code", () => {
  assert.equal(md("| Item | Cost |\n|---|--:|\n| Tea | $2 |"),
    '<div class="tbl"><table><thead><tr><th>Item</th><th style="text-align:right">Cost</th></tr></thead><tbody><tr><td>Tea</td><td style="text-align:right">$2</td></tr></tbody></table></div>');
  assert.equal(md("> note **this**"), "<blockquote><p>note <strong>this</strong></p></blockquote>");
  assert.equal(md("a\n\n---\n\nb"), "<p>a</p><hr><p>b</p>");
  assert.equal(md("```js\nif (a < b) *x*\n```"), "<pre><code>if (a &lt; b) *x*</code></pre>");
  assert.equal(md("use `**not bold**` here"), "<p>use <code>**not bold**</code> here</p>");
});

test("a code block still streaming in renders as code", () => {
  assert.equal(md("Here:\n```\nline 1"), "<p>Here:</p><pre><code>line 1</code></pre>");
});

test("links: http(s) and mailto only, opened safely", () => {
  assert.equal(md("[docs](https://example.com/a_b_c?x=1&y=2)"),
    '<p><a href="https://example.com/a_b_c?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">docs</a></p>');
  assert.equal(md("see https://example.com/_page_."),
    '<p>see <a href="https://example.com/_page_" target="_blank" rel="noopener noreferrer">https://example.com/_page_</a>.</p>');
  assert.equal(md("[mail](mailto:hi@example.com)"), '<p><a href="mailto:hi@example.com" target="_blank" rel="noopener noreferrer">mail</a></p>');
  assert.equal(md("[click](javascript:alert(1))"), "<p>[click](javascript:alert(1))</p>");
  assert.equal(md("[x](data:text/html,hi)"), "<p>[x](data:text/html,hi)</p>");
});

test("nothing the model writes becomes live HTML", () => {
  const out = md('<script>alert(1)</script> <img src=x onerror=alert(1)> [a](https://x.com/"onmouseover="alert(1)) | `<b>`');
  assert.equal(/<script|<img|<b>/.test(out), false);
  assert.equal(out.includes('"onmouseover'), false, "quotes in a URL can't break out of href");
  assert.equal(md("# <i>hi</i>"), "<h3>&lt;i&gt;hi&lt;/i&gt;</h3>");
  assert.equal(md("- <svg onload=x>"), "<ul><li>&lt;svg onload=x&gt;</li></ul>");
  assert.equal(md("| <b>x</b> |\n|---|\n| y |").includes("<b>"), false);
});
