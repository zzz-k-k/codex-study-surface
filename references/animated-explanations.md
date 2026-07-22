# Animated Explanation Guidelines

## Decision Gate

Use animation only when at least one essential relationship is temporal, spatial, stateful, concurrent, or interactive. Good candidates include:

- a compiler or build pipeline whose intermediate forms change step by step;
- event-loop, queue, scheduler, retry, race, or backpressure behavior;
- memory ownership, allocation, garbage collection, or data movement;
- protocol handshakes and state machines;
- geometry, transforms, rendering, or physical movement;
- algorithms where the important insight is how state changes between steps.

Do not animate definitions, short comparisons, simple hierarchies, static architecture maps, or decorative transitions. Use prose, tables, code, or a static diagram instead.

## Choose The Smallest Medium

1. Use CSS transitions or keyframes for a few known states.
2. Use inline SVG plus CSS when labeled nodes, paths, tokens, or spatial movement matter.
3. Add the Web Animations API or small vanilla JavaScript when the learner needs play, pause, step, reset, speed, or direct manipulation.
4. Use Canvas only for many moving objects or simulation-heavy scenes where SVG becomes impractical.
5. Do not add a framework or animation library unless the study already requires it and the benefit is clear.

## Storyboard Before Coding

Define:

- the single question the animation answers;
- the initial state;
- each meaningful intermediate state;
- the transition that connects each state;
- what the learner should notice at every step;
- the final state and the takeaway;
- the minimum controls required.

Keep one animation focused on one mental model. Split unrelated mechanisms instead of building a dashboard.

## File Contract

- Write a self-contained HTML document to `<study-directory>/visuals/<descriptive-slug>.html`.
- Use no network requests, remote scripts, external fonts, analytics, storage, cookies, or repository reads.
- Scope CSS and JavaScript to one root element.
- Make the first frame meaningful before playback.
- Prefer user-controlled playback. Never create an endless autoplay loop.
- Provide Play/Pause only when continuous motion matters; prefer Previous/Next for conceptual sequences.
- Include Reset when the learner can change state.
- Honor `prefers-reduced-motion` and offer a fully understandable static or stepped state.
- Support widths from 320 px upward without clipped labels or controls.
- Use semantic buttons, visible focus states, direct labels, and an accessible textual summary.
- Never make color or motion the only carrier of meaning.

Add a relative link from an authoritative Markdown artifact:

```markdown
[打开 IL2CPP 编译流程动画](visuals/il2cpp-compilation-pipeline.html)
```

The study server already serves sibling files inside the artifact directory, so the linked animation remains local.

## Security Boundary

Animation files are build-time artifacts created and reviewed by the agent executing the Skill. Inline Codex answers remain Markdown-only and must never inject or execute model-produced HTML, SVG event handlers, JavaScript, `data:` programs, or `javascript:` URLs.

If a browser question would benefit from animation, answer the conceptual question in Markdown and recommend rebuilding the study artifacts with an animated explainer. Do not weaken the read-only server to generate or execute code from that question.

## Verification

Before delivery:

1. open the animation through the same local study server;
2. verify every control and transition;
3. check narrow and wide layouts;
4. check reduced-motion behavior;
5. confirm the animation adds understanding beyond its text summary;
6. inspect console errors and remove unused code.
