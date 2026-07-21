#!/usr/bin/env node

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCssPath = path.resolve(scriptDir, "../assets/document.css");

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

export function slugify(value) {
  const slug = String(value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function safeHref(value) {
  const href = String(value || "").trim();
  if (/^(https?:\/\/|#|\.\.?\/)/i.test(href) || (!href.includes(":") && !href.startsWith("//"))) {
    return escapeHtml(href);
  }
  return "#";
}

export function inlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) =>
    `<a href="${safeHref(href)}">${label}</a>`);
  return text;
}

function stripFrontmatter(lines) {
  if (lines[0]?.trim() !== "---") return lines;
  const end = lines.slice(1).findIndex((line) => line.trim() === "---");
  return end === -1 ? lines : lines.slice(end + 2);
}

function isTableSeparator(line) {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function blockAttrs(context) {
  return ` data-study-id="${escapeHtml(context.studyId)}" data-study-source="${escapeHtml(context.source)}" data-study-heading="${escapeHtml(context.heading)}"`;
}

export function renderMarkdown(markdown, source) {
  const lines = stripFrontmatter(String(markdown).replace(/\r\n?/g, "\n").split("\n"));
  const html = [];
  const navigation = [];
  const usedIds = new Map();
  const fileId = `file:${source}`;
  let current = { studyId: fileId, source, heading: path.basename(source) };
  let index = 0;

  const uniqueId = (heading) => {
    const base = `${source}#${slugify(heading)}`;
    const count = (usedIds.get(base) || 0) + 1;
    usedIds.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

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
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      html.push(`<pre${blockAttrs(current)}><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      const id = uniqueId(title);
      current = { studyId: id, source, heading: title };
      html.push(`<h${level} id="${escapeHtml(id)}"${blockAttrs(current)}>${inlineMarkdown(title)}</h${level}>`);
      if (level <= 2) navigation.push({ id, title, level, source });
      index += 1;
      continue;
    }

    if (line.trim().startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote${blockAttrs(current)}>${inlineMarkdown(quote.join(" "))}</blockquote>`);
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index++]));
      }
      const headHtml = header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("");
      const bodyHtml = rows.map((row) => `<tr>${header.map((_cell, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("");
      html.push(`<div class="study-table-wrap"${blockAttrs(current)}><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}${blockAttrs(current)}>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      html.push(`<hr${blockAttrs(current)}>`);
      index += 1;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim()) break;
      if (/^(#{1,4})\s+/.test(next) || /^```/.test(next) || next.trim().startsWith(">")) break;
      if (/^\s*(?:[-*+]|\d+\.)\s+/.test(next)) break;
      if (index + 1 < lines.length && next.includes("|") && isTableSeparator(lines[index + 1])) break;
      paragraph.push(next.trim());
      index += 1;
    }
    html.push(`<p${blockAttrs(current)}>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return { html: html.join("\n"), navigation };
}

async function listMarkdownFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "study.html") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(absolute);
    }
  }
  await walk(root);
  const priority = new Map([
    ["index.md", 0], ["progress.md", 1], ["system-map.md", 2], ["requirements-clarification.md", 2],
    ["requirements-user-flow.md", 3], ["pedagogical-roadmap.md", 4], ["architecture-implementation.md", 4],
    ["risk-radar.md", 5], ["symbol-index.md", 7], ["concept-notes.md", 8], ["construction-learning-log.md", 8],
    ["learning-log.md", 9], ["implementation-summary.md", 10], ["learning-retrospective.md", 11], ["reusable-patterns.md", 12],
  ]);
  return files.sort((a, b) => {
    const ra = path.relative(root, a).split(path.sep).join("/");
    const rb = path.relative(root, b).split(path.sep).join("/");
    const pa = ra.startsWith("modules/") ? 6 : (priority.get(ra) ?? 50);
    const pb = rb.startsWith("modules/") ? 6 : (priority.get(rb) ?? 50);
    return pa - pb || ra.localeCompare(rb);
  });
}

export async function buildStudyHtml({ studyDir, output, title }) {
  const root = path.resolve(studyDir);
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error(`Study path is not a directory: ${root}`);
  const files = await listMarkdownFiles(root);
  if (files.length === 0) throw new Error(`No Markdown study artifacts found in: ${root}`);
  const css = await readFile(defaultCssPath, "utf8");
  const sections = [];
  const navigation = [];

  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const markdown = await readFile(file, "utf8");
    const rendered = renderMarkdown(markdown, relative);
    navigation.push(...rendered.navigation);
    sections.push(`<section class="study-file" data-study-file="${escapeHtml(relative)}">
      <div class="study-file-label">${escapeHtml(relative)}</div>
      <div class="study-content">${rendered.html}</div>
    </section>`);
  }

  const documentTitle = title || path.basename(root).replace(/[-_]+/g, " ");
  const navHtml = navigation.map((item) =>
    `<a href="#${escapeHtml(item.id)}" data-level="${item.level}">${escapeHtml(item.title)}</a>`).join("\n");
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="codex-study-source" content="${escapeHtml(root)}">
  <title>${escapeHtml(documentTitle)} · Codex Study</title>
  <style>${css}</style>
</head>
<body>
  <div class="study-shell">
    <nav class="study-nav">
      <div class="study-kicker">Codex Study Surface</div>
      <h1>${escapeHtml(documentTitle)}</h1>
      <div class="study-nav-links">${navHtml}</div>
    </nav>
    <main class="study-main">
      <header class="study-hero">
        <div class="study-kicker">Interactive understanding document</div>
        <h1>${escapeHtml(documentTitle)}</h1>
        <p>这是一份由 Markdown 学习档案生成的只读投影。通过 Codex Study Surface 打开后，可以选择文字或元素并在原位提问。</p>
      </header>
      ${sections.join("\n")}
    </main>
  </div>
</body>
</html>\n`;
  const outputPath = path.resolve(output || path.join(root, "study.html"));
  await writeFile(outputPath, html, "utf8");
  return { output: outputPath, files: files.length, anchors: navigation.length };
}

function parseArgs(argv) {
  const args = [...argv];
  const studyDir = args.shift();
  if (!studyDir || studyDir === "--help" || studyDir === "-h") return { help: true };
  const options = { studyDir };
  while (args.length) {
    const flag = args.shift();
    if (flag === "--out") options.output = args.shift();
    else if (flag === "--title") options.title = args.shift();
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: build-study-html.mjs <study-directory> [--out <file>] [--title <title>]\n");
    return;
  }
  const result = await buildStudyHtml(options);
  process.stdout.write(`${JSON.stringify({ status: "built", ...result }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
