# Claude's review of the Codex plan (short version)

The Codex plan ([FULL-PRODUCT-PLAN.md](FULL-PRODUCT-PLAN.md)) is sound. I kept it unchanged and built on it. This page is the 2-minute version, plus where I added to it or would do things differently.

## The plan in eight lines

1. Keep Electron + TypeScript. Don't rewrite, and don't train a model.
2. Use three visual layers: screen marks (Canvas), explanatory diagrams (SVG/DOM) and interactive 3D (Three.js).
3. The model *describes* visuals as data. Our code validates and draws them.
4. Clicking a part feeds its identity back into the conversation. Visuals are part of reasoning, not decoration.
5. Tasks take the most reliable route: app APIs, then the browser extension, then Windows UI Automation, then pointer/keyboard as a last resort.
6. Only one job may control the desktop at a time. The user can always take over instantly.
7. SQLite holds history, jobs and memory. Secrets stay in OS-encrypted storage.
8. Milestones M0–M8. Nothing is called "done" without evidence.

## What is now built against it

See [BUILD-STATE.md](BUILD-STATE.md): the first work package (secrets, capture identity, turn ownership), M3's core and M4's first slice. Clicking a node or part reaches the model as context, and both directions were tested end to end.

## Where I'd adjust the plan

- **Do M3 and M4 earlier, alongside M1.** The plan already says "put the visual system early". I took that literally: the scene protocol is the product's identity and it needed no new infrastructure. Do it before M2's storage work, not after.
- **Start the scene protocol as a text block, then move to tool calls.** The plan's typed event protocol is the right end state. A `<scene>` block works today with both providers' streaming, with no tool-use plumbing and the same validator (see DECISIONS D1).
- **Own the layout, not just the validation.** The plan says "the model proposes, our engine lays out". I went further: 2D scenes carry no coordinates at all, so overlap can't happen (D2).
- **Keep 60 evaluation cases, but start with 10.** For a solo plus two-assistant team, a 10-case smoke suite run on every change will catch more than a 60-case suite run rarely. Grow it as features land.
- **Windows native helper (M6): prototype UI Automation from Node first.** Before committing to a C# helper, spike it with PowerShell's UIAutomation or a small `edge-js`/FFI bridge. That tests reachability in a day. Write the C# helper once the actions are known.
- **Voice: measure before switching to realtime.** The current chain is: push-to-talk, Gemini transcription, vision model, OS speech. Get latency numbers on the target machine first. Gemini Live or a realtime model is a good upgrade, but only after the chain is reliable.

## Next three tasks (suggested order)

1. Live provider run with scene prompts. Tune `prompt.ts` from real output (BUILD-STATE next step 1).
2. Sync step focus to speech sentence boundaries.
3. M2's conversation store (SQLite) and the expandable home panel, so scenes and chats persist.
