(() => {
  "use strict";

  const config = window.__CODEX_STUDY_SURFACE__ || {};
  if (!config.token) return;

  const maxContext = 8000;
  const storageKey = `codex-study-surface:${config.artifactKey || location.pathname}`;
  let annotate = true;
  let hovered = null;
  let composer = null;
  let ignoreClick = false;
  const records = loadRecords();

  const toolbar = element("div", "codex-study-toolbar", { "data-study-ui": "toolbar" });
  const modeButton = element("button", "codex-study-mode", { type: "button", "data-active": "true" }, "Annotate");
  const presence = element("span", "codex-study-presence", { "data-state": "ready" }, "Codex ready");
  toolbar.append(modeButton, presence);
  document.body.appendChild(toolbar);

  modeButton.addEventListener("click", () => {
    annotate = !annotate;
    modeButton.dataset.active = String(annotate);
    modeButton.textContent = annotate ? "Annotate" : "Explore";
    clearHover();
    closeComposer();
  });

  function element(tag, className, attributes = {}, text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text) node.textContent = text;
    return node;
  }

  function appendInline(parent, tokens) {
    for (const token of tokens || []) {
      if (token.type === "text") {
        parent.appendChild(document.createTextNode(token.text));
        continue;
      }
      if (token.type === "code") {
        parent.appendChild(element("code", "", {}, token.text));
        continue;
      }
      if (token.type === "strong" || token.type === "emphasis") {
        const child = element(token.type === "strong" ? "strong" : "em");
        appendInline(child, token.children);
        parent.appendChild(child);
        continue;
      }
      if (token.type === "link") {
        const link = element("a", "", { href: token.href, target: "_blank", rel: "noopener noreferrer" });
        appendInline(link, token.children);
        parent.appendChild(link);
      }
    }
  }

  function renderAnswer(target, markdown, state = "complete") {
    target.replaceChildren();
    const source = String(markdown || "");
    const parser = window.CodexStudyMarkdown;
    if (state === "failed" || !parser?.parse) {
      target.textContent = source;
      return;
    }
    for (const block of parser.parse(source)) {
      let node;
      if (block.type === "paragraph") {
        node = element("p");
        appendInline(node, block.children);
      } else if (block.type === "heading") {
        node = element(block.level <= 2 ? "h3" : "h4");
        appendInline(node, block.children);
      } else if (block.type === "blockquote") {
        node = element("blockquote");
        appendInline(node, block.children);
      } else if (block.type === "list") {
        node = element(block.ordered ? "ol" : "ul");
        for (const item of block.items) {
          const listItem = element("li");
          appendInline(listItem, item);
          node.appendChild(listItem);
        }
      } else if (block.type === "code-block") {
        node = element("pre");
        const code = element("code", block.language ? `language-${block.language}` : "", {}, block.text);
        node.appendChild(code);
      } else if (block.type === "rule") {
        node = element("hr");
      }
      if (node) target.appendChild(node);
    }
  }

  function loadRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(value)
        ? value.filter((item) => item && item.annotationId && item.studyId).map((item) =>
            item.state === "working"
              ? { ...item, state: "failed", answer: "页面刷新中断了这次等待，请重新提问。" }
              : item)
        : [];
    } catch {
      return [];
    }
  }

  function saveRecords() {
    const compact = records.slice(-100).map(({ annotationId, studyId, source, heading, selectedText, question, answer, state }) => ({
      annotationId, studyId, source, heading, selectedText, question, answer, state,
    }));
    localStorage.setItem(storageKey, JSON.stringify(compact));
  }

  function isUi(node) {
    return node instanceof Element && Boolean(node.closest("[data-study-ui]"));
  }

  function isNativeInteractive(node) {
    return node instanceof Element && Boolean(node.closest("a,button,input,textarea,select,label,summary,[contenteditable='true']"));
  }

  function selectable(node) {
    if (!(node instanceof Element) || isUi(node)) return null;
    return node.closest("[data-study-id]");
  }

  function clearHover() {
    hovered?.classList.remove("codex-study-hover");
    hovered = null;
  }

  function setPresence(state, text) {
    presence.dataset.state = state;
    presence.textContent = text;
  }

  document.addEventListener("mousemove", (event) => {
    if (!annotate || composer || isNativeInteractive(event.target)) return clearHover();
    const target = selectable(event.target);
    if (target === hovered) return;
    clearHover();
    hovered = target;
    hovered?.classList.add("codex-study-hover");
  }, true);

  document.addEventListener("mouseout", (event) => {
    if (event.target === hovered) clearHover();
  }, true);

  document.addEventListener("mouseup", (event) => {
    if (!annotate || isUi(event.target) || isNativeInteractive(event.target)) return;
    const selection = document.getSelection();
    const selectedText = selection?.toString().trim().replace(/\s+/g, " ") || "";
    if (!selectedText || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const target = selectable(range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement);
    if (!target) return;
    ignoreClick = true;
    showComposer(target, selectedText.slice(0, maxContext), range.getBoundingClientRect());
  }, true);

  document.addEventListener("click", (event) => {
    if (!annotate || isUi(event.target) || isNativeInteractive(event.target)) return;
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    const target = selectable(event.target);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    showComposer(target, "", target.getBoundingClientRect());
  }, true);

  function closeComposer() {
    composer?.remove();
    composer = null;
    clearHover();
  }

  function showComposer(target, selectedText, rect) {
    closeComposer();
    target.classList.add("codex-study-hover");
    hovered = target;
    const studyId = target.dataset.studyId || "unknown";
    const source = target.dataset.studySource || "";
    const heading = target.dataset.studyHeading || "";
    composer = element("div", "codex-study-composer", { "data-study-ui": "composer" });
    const label = element("div", "codex-study-composer-label", {}, selectedText ? "Ask about selected text" : "Ask about this section");
    const context = element("div", "codex-study-composer-context", {}, `${source}${heading ? ` · ${heading}` : ""}`);
    const input = element("textarea", "", { placeholder: "这里为什么这样设计？它与运行流的哪一步有关？", maxlength: "4000" });
    const actions = element("div", "codex-study-composer-actions");
    const cancel = element("button", "codex-study-cancel", { type: "button" }, "Cancel");
    const ask = element("button", "codex-study-ask", { type: "button" }, "Ask Codex");
    actions.append(cancel, ask);
    composer.append(label, context, input, actions);
    document.body.appendChild(composer);

    const left = Math.min(Math.max(12, rect.left), window.innerWidth - composer.offsetWidth - 12);
    const top = Math.min(Math.max(68, rect.bottom + 8), window.innerHeight - composer.offsetHeight - 12);
    composer.style.left = `${left}px`;
    composer.style.top = `${top}px`;
    cancel.addEventListener("click", closeComposer);
    ask.addEventListener("click", () => submitQuestion({ target, studyId, source, heading, selectedText, input, ask }));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        ask.click();
      }
    });
    setTimeout(() => input.focus(), 0);
  }

  async function submitQuestion({ target, studyId, source, heading, selectedText, input, ask }) {
    const question = input.value.trim();
    if (!question) return input.focus();
    ask.disabled = true;
    const annotationId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const record = {
      annotationId,
      studyId,
      source,
      heading,
      selectedText,
      question,
      answer: "",
      state: "working",
    };
    records.push(record);
    saveRecords();
    const card = renderRecord(record, target);
    closeComposer();
    setPresence("working", "Codex working…");
    try {
      const response = await api("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          annotationId,
          studyId,
          source,
          heading,
          selectedText,
          elementText: (target.innerText || target.textContent || "").trim().slice(0, maxContext),
          question,
          pageTitle: document.title,
        }),
      });
      await waitForJob(response.id, record, card);
    } catch (error) {
      updateRecord(record, card, "failed", error.message || String(error));
    }
  }

  async function waitForJob(id, record, card) {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 850));
      const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
      if (job.status === "complete") {
        updateRecord(record, card, "complete", job.answer || "Codex returned an empty answer.");
        setPresence("ready", "Codex ready");
        return;
      }
      if (job.status === "failed") {
        updateRecord(record, card, "failed", job.error || "Codex request failed.");
        return;
      }
      card.querySelector(".codex-study-thread-status").textContent = job.status === "queued" ? "Queued for Codex" : "Codex is reading the repository";
    }
  }

  function updateRecord(record, card, state, answer) {
    record.state = state;
    record.answer = answer;
    saveRecords();
    card.dataset.state = state;
    card.querySelector(".codex-study-thread-status").textContent = state === "failed" ? "Codex request failed" : "Codex explanation";
    renderAnswer(card.querySelector(".codex-study-thread-answer"), answer, state);
    setPresence(state === "failed" ? "error" : "ready", state === "failed" ? "Codex error" : "Codex ready");
  }

  function renderRecord(record, target) {
    const card = element("aside", "codex-study-thread", { "data-study-ui": "thread", "data-state": record.state || "complete" });
    const kicker = element("div", "codex-study-thread-kicker", {}, "Codex anchored explanation");
    const question = element("div", "codex-study-thread-question", {}, record.question);
    const status = element("div", "codex-study-thread-status", {}, record.state === "working" ? "Queued for Codex" : "Codex explanation");
    const answer = element("div", "codex-study-thread-answer");
    renderAnswer(answer, record.answer || "", record.state || "complete");
    const close = element("button", "codex-study-thread-close", { type: "button", title: "Remove this local card" }, "×");
    close.addEventListener("click", () => {
      const index = records.findIndex((item) => item.annotationId === record.annotationId);
      if (index !== -1) records.splice(index, 1);
      saveRecords();
      card.remove();
    });
    card.append(kicker, question, status, answer, close);
    target.insertAdjacentElement("afterend", card);
    return card;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-codex-study-token": config.token,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  for (const record of records) {
    const target = document.querySelector(`[data-study-id="${CSS.escape(record.studyId)}"]`);
    if (target) renderRecord(record, target);
  }
})();
