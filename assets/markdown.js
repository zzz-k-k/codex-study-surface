(() => {
  "use strict";

  function textToken(value) {
    return { type: "text", text: String(value || "") };
  }

  function pushText(tokens, value) {
    if (!value) return;
    const previous = tokens.at(-1);
    if (previous?.type === "text") previous.text += value;
    else tokens.push(textToken(value));
  }

  function safeHref(value) {
    const href = String(value || "").trim();
    return /^(https?:\/\/|#)/i.test(href) ? href : "";
  }

  function parseInline(value) {
    const source = String(value || "");
    const tokens = [];
    const pattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^\s)]+\))/g;
    let cursor = 0;
    let match;

    while ((match = pattern.exec(source))) {
      pushText(tokens, source.slice(cursor, match.index));
      const raw = match[0];
      if (raw.startsWith("**") || raw.startsWith("__")) {
        tokens.push({ type: "strong", children: parseInline(raw.slice(2, -2)) });
      } else if (raw.startsWith("`")) {
        tokens.push({ type: "code", text: raw.slice(1, -1) });
      } else if (raw.startsWith("*") || raw.startsWith("_")) {
        tokens.push({ type: "emphasis", children: parseInline(raw.slice(1, -1)) });
      } else {
        const link = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const href = safeHref(link?.[2]);
        if (link && href) tokens.push({ type: "link", href, children: parseInline(link[1]) });
        else pushText(tokens, raw);
      }
      cursor = match.index + raw.length;
    }
    pushText(tokens, source.slice(cursor));
    return tokens;
  }

  function startsBlock(line) {
    return /^```/.test(line)
      || /^#{1,4}\s+/.test(line)
      || /^>\s?/.test(line)
      || /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
      || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
  }

  function parse(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^```\s*([\w+-]*)\s*$/);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index += 1;
        blocks.push({ type: "code-block", language: fence[1] || "", text: code.join("\n") });
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2].trim()) });
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
        blocks.push({ type: "blockquote", children: parseInline(quote.join(" ")) });
        continue;
      }

      const listItem = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
      if (listItem) {
        const ordered = Boolean(listItem[2]);
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
          if (!item || Boolean(item[2]) !== ordered) break;
          items.push(parseInline(item[3].trim()));
          index += 1;
        }
        blocks.push({ type: "list", ordered, items });
        continue;
      }

      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        blocks.push({ type: "rule" });
        index += 1;
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    }

    return blocks;
  }

  window.CodexStudyMarkdown = Object.freeze({ parse, parseInline });
})();
