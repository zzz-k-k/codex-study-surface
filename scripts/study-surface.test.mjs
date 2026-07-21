import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";

import { buildStudyHtml, renderMarkdown } from "./build-study-html.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(scriptDir, "study-surface.mjs");
const markdownScript = path.resolve(scriptDir, "../assets/markdown.js");

test("renderer escapes source HTML and emits semantic anchors", () => {
  const rendered = renderMarkdown("# 登录流程\n\n验证 `token`。\n\n<script>alert(1)</script>", "modules/auth.md");
  assert.match(rendered.html, /data-study-id="modules\/auth\.md#登录流程"/);
  assert.match(rendered.html, /data-study-source="modules\/auth\.md"/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>alert/);
});

test("answer Markdown parser keeps structure and rejects unsafe links", async () => {
  const source = await readFile(markdownScript, "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const blocks = context.window.CodexStudyMarkdown.parse([
    "**verified**",
    "",
    "- `IL` 指令",
    "- [官方文档](https://docs.unity3d.com/)",
    "- [危险链接](javascript:alert(1))",
    "",
    "<img src=x onerror=alert(1)>",
  ].join("\n"));
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[0].children[0].type, "strong");
  assert.equal(blocks[1].type, "list");
  assert.equal(blocks[1].items[0][0].type, "code");
  assert.equal(blocks[1].items[1][0].type, "link");
  assert.equal(blocks[1].items[2][0].type, "text");
  assert.equal(blocks[2].children[0].text, "<img src=x onerror=alert(1)>");
});

test("surface serves an artifact and sends sequential questions through one Codex thread", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "codex-study-surface-test-"));
  const repo = path.join(temporary, "repo");
  const study = path.join(repo, "docs", "codebase-study", "demo");
  const stateDir = path.join(temporary, "state");
  const mockLog = path.join(temporary, "mock-codex.jsonl");
  const mockCodex = path.join(temporary, "mock-codex.mjs");
  await mkdir(study, { recursive: true });
  await execFileAsync("git", ["init", repo]);
  await writeFile(path.join(study, "system-map.md"), "# 系统地图\n\n## 登录流程\n\n入口调用认证服务。\n", "utf8");
  await writeFile(mockCodex, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOCK_CODEX_LOG, JSON.stringify(args) + "\\n");
const outputIndex = args.indexOf("--output-last-message");
writeFileSync(args[outputIndex + 1], "verified：回答来自 mock Codex。\\n");
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "019f-test-thread" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "verified：回答来自 mock Codex。" } }) + "\\n");
`, "utf8");
  await chmod(mockCodex, 0o755);
  const built = await buildStudyHtml({ studyDir: study });
  const port = await availablePort();
  const env = { ...process.env, CODEX_STUDY_SURFACE_STATE_DIR: stateDir, MOCK_CODEX_LOG: mockLog };
  t.after(async () => {
    await runCli(["stop"], env).catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  });

  const opened = JSON.parse(await runCli([
    "open", built.output, "--workspace", repo, "--port", String(port), "--codex-bin", mockCodex, "--no-open",
  ], env));
  assert.equal(opened.status, "open");
  assert.equal(opened.token, undefined);

  const state = JSON.parse(await readFile(path.join(stateDir, "session.json"), "utf8"));
  const page = await fetch(opened.url).then((response) => response.text());
  assert.match(page, /window\.__CODEX_STUDY_SURFACE__/);
  assert.match(page, /\/__codex-study\/markdown\.js/);
  assert.match(page, /data-study-id="system-map\.md#登录流程"/);

  const first = await ask(opened.url, state.token, "为什么入口先调用认证服务？");
  assert.equal(first.status, "complete");
  assert.equal(first.threadId, "019f-test-thread");
  assert.match(first.answer, /mock Codex/);

  const second = await ask(opened.url, state.token, "这与上一问有什么关系？");
  assert.equal(second.status, "complete");
  const invocations = (await readFile(mockLog, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations[0].slice(0, 2), ["--ask-for-approval", "never"]);
  assert.ok(invocations[0].includes("read-only"));
  assert.ok(invocations[0].includes("never"));
  assert.ok(invocations[0].includes("exec"));
  assert.ok(invocations[0].includes("--json"));
  assert.ok(invocations[0].includes("gpt-5.4"));
  assert.deepEqual(invocations[1].slice(0, 3), ["exec", "resume", "--json"]);
  assert.ok(invocations[1].includes("019f-test-thread"));
});

async function ask(baseUrl, token, question) {
  const response = await fetch(`${baseUrl}api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-codex-study-token": token },
    body: JSON.stringify({
      annotationId: crypto.randomUUID(),
      studyId: "system-map.md#登录流程",
      source: "system-map.md",
      heading: "登录流程",
      selectedText: "入口调用认证服务",
      elementText: "入口调用认证服务。",
      question,
      pageTitle: "测试学习页面",
    }),
  });
  assert.equal(response.status, 202);
  const queued = await response.json();
  for (let index = 0; index < 100; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const jobResponse = await fetch(`${baseUrl}api/jobs/${queued.id}`, { headers: { "x-codex-study-token": token } });
    const job = await jobResponse.json();
    if (job.status === "complete" || job.status === "failed") return job;
  }
  throw new Error("Timed out waiting for mock Codex job");
}

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverScript, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `CLI exited ${code}`)));
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
