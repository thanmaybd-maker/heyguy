# Decisions

Short records of choices that later work should respect. Add new entries at the bottom. Don't rewrite old ones; supersede them instead.

**D1: Scenes are data and use a `<scene>` JSON block for now.** (2026-11-04, Claude)
The model writes one JSON block at the end of its reply. It is validated by `src/shared/scene.ts` and rendered by our own renderers. This works with both current providers' plain streaming today, with no tool-calling dependency. When M5 adds tool calls, the same `validateScene` becomes the tool's input schema. The renderer contract does not change.

**D2: Layout is ours, not the model's.** (2026-11-04, Claude)
2D scenes have no coordinates. The model names nodes and links, and `layout2d.ts` places them. This makes overlap and off-screen nodes impossible and keeps follow-up edits stable. 3D scenes do carry positions, because shape is the point; they are clamped to ±100 units.

**D3: Capture at talk start.** (2026-11-04, Claude)
For voice, the screenshot is taken the moment listening begins, not after transcription. Typed and "explain" requests still capture when sent. See plan gap 3.

**D4: Fail closed on secrets.** (2026-11-04, Claude)
No encryption means session-only keys, never Base64 on disk. Async `safeStorage` is used because the sync API is deprecated in Electron 45.

**D5: One turn owns the companion.** (2026-11-04, Claude)
`TurnManager` decides. A newer request cancels the older one, and stale events are dropped at both ends. Background jobs (M5) will get their own job ids and must not reuse this interactive lock.

**D6: Three.js primitives first, no generated code.** (2026-11-04, Claude)
3D parts come from a fixed geometry vocabulary. Arbitrary model-written Three.js, Python or Blender code is not executed in the app (plan §4).

**D7: SQLite with Node 24 built-in `node:sqlite` for cross-day storage.** (2026-11-04, Antigravity)
Electron 45.2.2 runs Node 24.22.2, which includes `node:sqlite` natively. No external C++ native build toolchain or `better-sqlite3` compilation is required on Windows. The database resides in `userData/heyguy.db` with foreign key cascades and indexed queries.

**D8: Expandable Workspace window for conversation history and scene reload.** (2026-11-04, Antigravity)
Rather than cluttering the transparent overlay with extensive conversation history browsing, a dedicated sandboxed Workspace window (`src/renderer/workspace/`) allows users to search past conversations and load historical 2D/3D scenes back into the active overlay on demand.

**D9: OpenAI BYOK alongside Claude and Gemini.** (2026-11-04, Antigravity)
Users can provide an OpenAI key with `gpt-4o` or `gpt-4o-mini`. The provider uses the standard OpenAI Chat Completions streaming endpoint with Base64 JPEG vision payloads and DPAPI encryption for saved keys.

**D10: User-controlled Persistent Memory & Named Assistant Profiles.** (2026-11-04, Antigravity)
Memories (`preference`, `fact`, `instruction`, `context`) are stored in SQLite and automatically extracted from conversation turns while allowing full user inspection, search, and deletion from the Workspace. Relevant memories are bounded and dynamically injected into prompts alongside named assistant system instructions (General Companion, Dev Specialist, Deep Researcher).

**D11: Durable Timezone-Aware Scheduler with Sleep/Wake Recovery.** (2026-11-04, Antigravity)
Scheduled routines (daily, interval, cron) are persisted in SQLite with the user's timezone. On system wake or app restart, past-due routines execute once if configured with `run_once_on_wake` or advance cleanly if `skip`, preventing duplicate runs or unmetered execution cascades. Non-critical routine alerts respect quiet hours.

**D12: Declarative Interactive UI Harness (`SceneUI`), DeepSeek Provider, and GPT-Image-1 with Vector Synth Fallback.** (2026-11-05, Antigravity)
To support instant interactive UI creation (dashboards, KPI metrics, SVG bar/line/donut charts, sortable tables, parameter sliders, and comparison matrices) without ever violating the no-`eval` security boundary, `SceneUI` (`kind: 'ui'`) is validated in `src/shared/scene.ts` and rendered with safe DOM/SVG nodes in `src/renderer/overlay/scene-ui.ts`. DeepSeek (`deepseek-chat` / `deepseek-reasoner`) streams via `src/main/ai/deepseek.ts` while stripping `reasoning_content` from spoken output. Image generation (`src/main/ai/image-gen.ts`) uses OpenAI `gpt-image-1` when an OpenAI key is present and automatically falls back to a deterministic high-craft SVG vector synthesizer when keyless.

**D13: Google Account Antigravity Harness (`thanmaybd@gmail.com` · `gemini-3.8-flash`) & Editor-Free Code Generation.** (2026-11-05, Antigravity)
Following `docs/FULL-PRODUCT-PLAN.md` §6 ("user-authenticated, unmodified CLI"; "do not implement our own subscription-token proxy"), `src/main/ai/antigravity.ts` invokes the user's already signed-in, unmodified `agy` CLI (`--print --output-format stream-json --model gemini-3.8-flash-high`). Clicking "Sign in with Google (opens Antigravity)" in Settings launches `agy` in its own terminal window (`openAgySignIn`) so authentication stays entirely inside `agy` and HeyGuy never holds or scrapes Google OAuth tokens. It streams `text_delta` responses in real time, records live token usage (`input_tokens`, `output_tokens`, `thinking_tokens`, `total_tokens`) from `result.usage`, and powers `runHeadlessCodeGen` in Workspace Studio without fabricating code or metrics on failure.
