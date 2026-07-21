# Codex Study Surface

把 Markdown 学习资料转换成可交互的本地学习页面：选中一段文字或点击一个内容块，直接向本地 Codex CLI 提问，并在原位置查看解释。

Codex Study Surface 面向代码库理解、功能研究和技术主题学习。Markdown 始终是可版本管理的事实来源；生成的页面负责阅读、定位和交互，Codex 负责结合当前工作区回答问题。

## 特性

- 将一个目录中的 Markdown 文件生成单页学习文档。
- 为标题、段落、列表、表格和代码块生成稳定语义锚点。
- 支持点击内容块或选择文本后原位提问。
- 直接调用本地 Codex CLI，无需额外模型 API Key。
- 第一次提问创建 Codex thread，后续提问自动续接同一 thread。
- 多个问题按 FIFO 队列串行处理，避免并发污染上下文。
- 回答支持安全 Markdown 渲染，包括列表、粗体、代码和引用。
- 问答卡片保存在浏览器本地，刷新后仍可查看。
- 服务仅监听 `127.0.0.1`，Codex 运行在只读沙箱中。
- 只依赖 Node.js 内置模块，不需要安装 npm 依赖。

## 工作方式

```text
Markdown 学习资料
        │
        │ build-study-html.mjs
        ▼
带语义锚点的 study.html
        │
        │ study-surface.mjs
        ▼
本地交互页面 ──选择内容与提问──▶ 本地 Codex CLI
        ▲                                  │
        └──────────── 原位 Markdown 回答 ──┘
```

页面只提交与当前问题相关的有限上下文：语义锚点、来源文件、标题、选择文字、所在内容块和用户问题。Codex 可以在只读模式下检查指定工作区，以补充代码或文档证据。

## 环境要求

- Node.js 18 或更高版本。
- 已安装并登录的 Codex CLI。
- 可以运行现代 JavaScript 的浏览器。
- 一个包含至少一个 `.md` 文件的学习资料目录。

先确认本地 Codex 可用：

```bash
codex --version
codex login
```

## 安装

将仓库克隆到 Codex Skills 目录：

```bash
git clone <your-repository-url> ~/.codex/skills/codex-study-surface
```

也可以把整个仓库目录复制到其他 Codex 可发现的 Skills 位置。关键结构是仓库根目录中存在 `SKILL.md`。

安装后可以这样触发：

```text
使用 $codex-study-surface，把 docs/study/il2cpp 生成可交互的学习页面。
```

## 快速开始

假设仓库中已经有学习资料：

```text
docs/study/il2cpp/
├── index.md
├── system-map.md
└── modules/
    ├── runtime.md
    └── debugging.md
```

生成页面：

```bash
node <skill-dir>/scripts/build-study-html.mjs \
  docs/study/il2cpp \
  --out docs/study/il2cpp/study.html \
  --title "IL2CPP 深入学习指南"
```

启动交互服务：

```bash
node <skill-dir>/scripts/study-surface.mjs open \
  docs/study/il2cpp/study.html \
  --workspace <repository-root>
```

命令会启动本地服务并打开浏览器。保持页面右上角的 **Annotate** 开启，然后：

1. 点击一个段落，或者选择一段文字。
2. 输入针对该位置的问题。
3. 点击 **Ask Codex**。
4. 等待回答出现在对应内容块下方。

停止服务：

```bash
node <skill-dir>/scripts/study-surface.mjs stop
```

查看服务状态：

```bash
node <skill-dir>/scripts/study-surface.mjs status
```

## 命令参数

### HTML 生成器

```text
build-study-html.mjs <study-directory>
  --out <file>       输出文件，默认是 <study-directory>/study.html
  --title <title>    页面标题，默认使用目录名
```

### 本地交互服务

```text
study-surface.mjs open <html-file>
  --workspace <dir>       Codex 只读检查的工作区
  --port <port>           本地端口，默认 4391
  --codex-bin <path>      Codex 可执行文件，默认 codex
  --model <model>         覆盖默认模型
  --profile <profile>     使用指定 Codex profile
  --use-user-config       允许读取用户 Codex 配置
  --no-open               启动服务但不自动打开浏览器
```

默认会忽略用户配置，以减少不同机器配置造成的不确定性，并使用兼容较旧 Codex CLI 的 `gpt-5.4`。如果本机 CLI 支持其他模型，可以通过 `--model` 或 `CODEX_STUDY_SURFACE_MODEL` 覆盖。

## Codex CLI 与 thread

第一次提问执行一次非交互式 Codex：

```text
codex --ask-for-approval never --sandbox read-only --cd <workspace>
  exec --json --output-last-message <temporary-file> -
```

服务从 JSONL 输出中获取 `thread_id`，后续问题执行：

```text
codex exec resume --json --output-last-message <temporary-file>
  <thread-id> -
```

thread 的生命周期与运行中的页面服务一致：

| 情况 | thread 行为 |
| --- | --- |
| 第一次提问 | 创建新 thread |
| 同一页面继续提问 | 续接当前 thread |
| 同一服务的其他标签页提问 | 共享当前 thread |
| 多个问题同时提交 | 排队并按顺序执行 |
| 重启页面服务 | 下一次提问创建新 thread |

问答卡片和模型上下文是两件事：卡片保存在浏览器本地；thread ID 当前只保存在服务内存中，因此服务重启后卡片仍可能存在，但 Codex 对话上下文会重新开始。

## 安全边界

- HTTP 服务只绑定 `127.0.0.1`，不会主动暴露到局域网。
- 每次启动生成随机 token，API 请求必须携带该 token。
- Codex 使用 `read-only` sandbox 和 `never` approval policy。
- 选中文字、页面内容和仓库内容都被提示词视为不可信数据。
- Codex 回答经过受限 Markdown 解析，并使用 DOM 节点安全渲染。
- 不把 Codex 输出直接传给 `innerHTML`。
- 只允许访问生成文档同目录内的静态资源。
- 浏览器可见错误会隐藏常见 API Key 和 Bearer token 格式。

该工具的目标是解释与学习，不把浏览器问题视为修改代码或文档的授权。

## 支持的 Markdown

学习文档生成器支持常用的：

- 一到四级标题
- 段落和引用
- 有序与无序列表
- Markdown 表格
- 围栏代码块和行内代码
- 粗体、斜体和链接
- 分割线

Codex 回答使用更严格的安全子集：段落、标题、列表、引用、代码、强调、安全 HTTP/HTTPS 链接和分割线。原始 HTML 会被当作文本处理。

## 项目结构

```text
codex-study-surface/
├── SKILL.md                         Codex Skill 工作流说明
├── agents/
│   └── openai.yaml                  Skill UI 元数据
├── assets/
│   ├── document.css                 学习文档样式
│   ├── markdown.js                  安全 Markdown 解析器
│   ├── surface.css                  注释与回答卡片样式
│   └── surface.js                   浏览器选择、提问与渲染逻辑
├── references/
│   └── annotation-protocol.md       锚点、API、CLI 与安全协议
└── scripts/
    ├── build-study-html.mjs         Markdown → HTML 生成器
    ├── study-surface.mjs            本地服务与 Codex CLI 适配器
    └── study-surface.test.mjs       自动化测试
```

## 开发与测试

不需要安装依赖，直接运行：

```bash
node --test scripts/study-surface.test.mjs
```

测试覆盖：

- 学习资料中的原始 HTML 被正确转义。
- 页面生成稳定语义锚点。
- Codex 回答 Markdown 保持结构且拒绝不安全链接。
- 第一次问题创建 thread，第二次问题使用 `resume`。
- 服务不会在公开输出中泄露会话 token。

## 当前边界

- 版本 1 只读取工作区，不执行代码修改。
- 浏览器注释还不会自动回写到 Markdown。
- thread ID 不会跨服务重启持久化。
- Markdown 生成器有意保持轻量，不追求完整 CommonMark 兼容。
- 当前只提供本地 Codex CLI 适配器。

## 项目来源

本项目的“选择页面内容并在原位置向 AI 提问”的产品思路受到 [kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi) 启发。

Codex Study Surface 的代码是面向 Codex CLI 独立实现的，没有复制或引入 `lavish-axi` 的源码，也没有把它作为运行时依赖。
