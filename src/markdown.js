// Markdown -> HTML for the chat, shared by both pages (embedded between
// // <markdown> markers by `npm run sync`). Everything is escaped first, and the
// only tags produced are the ones written here; links must be http(s) or mailto.
// It runs on every streamed chunk, so an unfinished code fence or table is fine.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

// Code spans and link tags are set aside as \u0000n\u0000 tokens so emphasis
// markers inside them (a_b_c in a URL, *args in code) are left alone.
function inline(raw) {
  const kept = [];
  const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
  const open = (url) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">`);
  let s = String(raw).replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  s = esc(s);
  s = s.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (m, text, url) => (SAFE_URL.test(url) ? open(url) + text + keep("</a>") : m));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]*[^\s<.,;:!?)'"\u0000])/g, (_, pre, url) => pre + open(url) + keep(url + "</a>"));
  s = s.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(?=\S)([^_\n]+?)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_(?=\S)([^_\n]+?)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~(?=\S)([^~\n]+?)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i]);
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,4}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function renderList(items) {
  let html = "", i = 0;
  while (i < items.length) {
    const base = items[i].indent, ordered = items[i].ordered;
    const start = ordered && items[i].num !== 1 ? ` start="${items[i].num}"` : "";
    html += ordered ? `<ol${start}>` : "<ul>";
    while (i < items.length && items[i].indent === base && items[i].ordered === ordered) {
      let li = inline(items[i].text);
      i++;
      const kids = [];
      while (i < items.length && items[i].indent > base) kids.push(items[i++]);
      if (kids.length) li += renderList(kids);
      html += `<li>${li}</li>`;
    }
    html += ordered ? "</ol>" : "</ul>";
  }
  return html;
}

/** Render chat Markdown to safe HTML. */
export function renderMarkdown(src) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").split("\n");
  let html = "", para = [], i = 0;
  const flush = () => {
    if (para.length) html += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    let m = /^\s*(```|~~~)\s*([\w+#.-]*)/.exec(line);
    if (m) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(m[1]); i++) code.push(lines[i]);
      i++;
      html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    if ((m = /^\s*(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line))) {
      flush();
      const level = Math.min(6, m[1].length + 2);
      html += `<h${level}>${inline(m[2])}</h${level}>`;
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html += "<hr>"; i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      html += `<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : ""));
      const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${inline(c)}</${tag}>`;
      html += `<div class="tbl"><table><thead><tr>${head.map((c, k) => td("th", c, k)).join("")}</tr></thead><tbody>`;
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) {
        html += `<tr>${cells(lines[i]).map((c, k) => td("td", c, k)).join("")}</tr>`;
      }
      html += "</tbody></table></div>";
      continue;
    }
    if ((m = LIST_ITEM.exec(line))) {
      flush();
      const items = [];
      while (i < lines.length) {
        const lm = LIST_ITEM.exec(lines[i]);
        if (lm) {
          items.push({ indent: lm[1].replace(/\t/g, "  ").length, ordered: /\d/.test(lm[2]), num: parseInt(lm[2], 10) || 1, text: lm[3] });
          i++;
        } else if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1].text += " " + lines[i++].trim();
        } else break;
      }
      const base = Math.min(...items.map((it) => it.indent));
      html += renderList(items.map((it) => ({ ...it, indent: it.indent - base })));
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return html;
}
