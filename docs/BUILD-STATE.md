# HeyGuy build state

Last updated: 2026-11-04 by Claude. This file records what is actually implemented and how it was verified. The target and milestones are in [FULL-PRODUCT-PLAN.md](FULL-PRODUCT-PLAN.md) (written by Codex, unchanged). Feature IDs (F01–F27) refer to [REFERENCE-AND-GAPS.md](REFERENCE-AND-GAPS.md).

## Implemented in this pass

This pass covers the plan's "first implementation work package" (§8). It also covers the core of M3 (2D scenes) and the first slice of M4 (interactive 3D).

| Plan item | What changed | Files |
|---|---|---|
| WP2 secret persistence | Keys are written to disk only when OS encryption is available, using async `safeStorage` (the sync API is deprecated in Electron 45). If encryption is unavailable, keys are kept in memory for the session only, and Settings says so. Legacy `raw:` Base64 records are re-encrypted on first start, or wiped from disk if encryption is unavailable. | `src/main/secrets.ts`, `src/main/settings.ts` |
| WP3 capture identity | No fallback to `sources[0]` when more than one display exists. If the display can't be matched, the request fails with a readable message. Each capture records `captureId`, display id, bounds, scale and image size. Drawings move to the display the screenshot came from. | `src/main/capture.ts`, `src/main/capture-pick.ts`, `src/main/main.ts` |
| WP4 turn ownership | Every request is a `Turn` (id plus AbortController). Starting a new turn cancels the old one. Events from a stale turn are dropped in main, and again in the overlay (`Envelope.turn`). Only the owning turn can release the display lock. | `src/main/turns.ts`, `src/shared/types.ts` (`Envelope`, `PROTOCOL_VERSION`), `src/renderer/overlay/overlay.ts` |
| Plan gap 3: capture timing | The screenshot is taken when the user **starts** talking, not after transcription, so the answer is about what they were looking at. | `main.ts` (`onListeningStarted`, `pendingTalk`) |
| WP6 / M3 visual contract | The model can end a reply with `<scene>{json}</scene>`. The block is hidden from text and speech, parsed, **validated** (unknown fields dropped, sizes clamped, bad references removed, limits enforced) and rendered by our code. Model output never becomes code. A malformed scene leaves the previous scene on screen. | `src/shared/blocks.ts`, `src/shared/scene.ts`, `src/main/ai/prompt.ts` |
| M3 2D scenes | SVG diagrams with deterministic layout: layered flows that wrap into rows, radial, and grid. Also curved edges with arrowheads, animated flow dots, pan/zoom, keyboard focus, click to select, and step walkthroughs. Re-emitting the same scene id updates the panel in place. | `src/shared/layout2d.ts`, `src/renderer/overlay/scene2d.ts`, `scene-panel.ts` |
| M4 3D scenes (first slice) | A Three.js panel built from vetted primitives (box, sphere, cylinder, cone, torus, capsule). Supports orbit, auto-rotate, raycast click-select, hover highlight, labels, exploded view, spin/slide/swing animation, step focus and full resource disposal. If WebGL is unavailable, a 2D parts view is shown instead. | `src/renderer/overlay/scene3d.ts` |
| Selection → conversation | Clicking a node or part shows its detail. The next typed or spoken question carries `{sceneId, itemId, label, detail}`, which main sanitises. The prompt tells the model what is selected and includes the open scene, so follow-ups can edit it. | `scene-panel.ts`, `overlay.ts`, `main.ts` (`cleanSelection`), `prompt.ts` |
| Demos | Tray menu and CLI: `npm run demo`, `npm run demo:diagram`, `npm run demo:3d`. These use the same validation and rendering path as real model output. | `src/main/demo-scenes.ts` |

## Implemented in M2 & Provider Expansion pass (2026-11-04 by Antigravity)

This pass covers milestone M2 foundations (storage, captions, workspace) along with OpenAI provider support and speech-synced visual steps (resolving known limit #3).

| Plan item & Feature IDs | What changed | Files |
|---|---|---|
| F16 durable conversation store | Persistent SQLite database implemented via Node/Electron built-in `node:sqlite`. Stores sessions, turns, user & assistant messages, and validated 2D/3D scenes across days. Includes search and cascading cleanup. | `src/main/storage/db.ts`, `src/main/main.ts`, `test/storage.test.ts` |
| F03 & §6 OpenAI vision provider | Added OpenAI Chat Completions streaming with vision inputs (`image_url` data base64) and ping key validation. Added `openaiKeyEnc` to settings with DPAPI encryption and Settings UI testing. | `src/main/ai/openai.ts`, `src/main/settings.ts`, `src/renderer/settings/*`, `test/providers.test.ts` |
| Step 3 & F04 speech-visual sync | `Speaker` now emits sentence index events on boundaries (`onSentenceStart`/`onSentenceEnd`). `ScenePanel` dynamically synchronizes step highlight focus to spoken sentences instead of an inflexible static timer. | `src/renderer/overlay/tts.ts`, `src/renderer/overlay/scene-panel.ts`, `src/renderer/overlay/overlay.ts` |
| F04 live captions surface | Added accessible floating live captions bar displaying active spoken sentences during playback, with a toggle in Settings. | `src/renderer/overlay/index.html`, `src/renderer/overlay/styles.css`, `src/renderer/overlay/overlay.ts` |
| F15 expandable workspace window | Resizable workspace window displaying previous conversations, search bar, full transcript inspection, and "Display in Overlay" action to re-open past 2D diagrams or 3D scenes. Sandboxed with verified IPC. | `src/renderer/workspace/*`, `src/preload/workspace.ts`, `src/main/main.ts`, `scripts/build.mjs` |

## Implemented in M5 & M6 Autonomous Execution pass (2026-11-04 by Antigravity)

This pass implements the core agent runtime, tool permissions, drafting connectors, browser extension bridge, Windows UI control, and interactive walkthrough observer.

| Plan item & Feature IDs | What changed | Files |
|---|---|---|
| F13 background job engine | Persistent `JobEngine` with state machine (`queued → planning → running → awaiting-approval → completed/failed/cancelled`), step tracking, and AbortController cancellation propagation. Backed by SQLite `jobs` and `job_steps` tables. | `src/main/jobs/engine.ts`, `src/main/storage/db.ts`, `test/jobs.test.ts` |
| F25 tool system & permission broker | Scoped `ToolRegistry` enforcing host-side safety policy: consequential actions require explicit user approval before execution; read-only operations run directly. | `src/main/tools/registry.ts`, `src/main/tools/types.ts`, `src/main/tools/builtins.ts` |
| F17 & F19 artifact store & drafts | `DraftConnector` creating verified RFC822 MIME email drafts and markdown documents, stored in SQLite `artifacts` table with SHA-256 checksums. | `src/main/connectors/drafts.ts`, `test/drafts.test.ts` |
| F12 browser agent bridge | Chrome native messaging host protocol with 32-bit length-prefixed framing, query tabs, navigate, and DOM text/click extraction. Includes Chrome extension Manifest V3 and background worker. | `src/main/browser/bridge.ts`, `extensions/chrome/*`, `test/browser.test.ts` |
| F11 Windows desktop control & takeover | `WindowsController` with active foreground window inspection, synthetic coordinate tagging, and 25ms polling loop for instant user takeover interruption. | `src/main/control/windows.ts` |
| F10 guided teaching walkthroughs | `WalkthroughObserver` state machine managing multi-step tutorials, pointing marks, and verified transitions. | `src/main/walkthroughs/observer.ts`, `test/walkthrough.test.ts` |
| F15 workspace jobs & artifacts UI | Added Jobs and Artifacts tabs in the Workspace window with approval banners, step execution indicators, and artifact previews. | `src/renderer/workspace/*`, `src/preload/workspace.ts`, `src/main/main.ts` |
| F14 & F16 memory & persistent context | `MemoryStore` for user preferences, facts, context with user controls (add, delete, search, update), automatic conversational extraction, and prompt injection. | `src/main/memory/store.ts`, `test/scheduler-memory.test.ts` |
| F20 durable scheduled routines | `SchedulerEngine` with timezone awareness, interval/daily/cron calculation, pause/resume, and wake/restart missed-run recovery (`run_once_on_wake` vs `skip`). | `src/main/scheduler/engine.ts`, `test/scheduler-memory.test.ts` |
| F14 named assistant profiles | `AssistantProfileManager` with seeded role definitions (HeyGuy General, Dev Specialist, Deep Researcher) and workspace switcher. | `src/main/assistants/profiles.ts`, `test/scheduler-memory.test.ts` |
| F26 quiet notifications | `NotificationDispatcher` with quiet hours / DND handling and routine/job completion updates. | `src/main/notifications/dispatcher.ts`, `test/scheduler-memory.test.ts` |
| F24 & F27 release verification | Full verification report, licenses, third-party notices, and packaging checks. | `LICENSE`, `THIRD_PARTY_NOTICES.md`, `docs/TEST-REPORT.md` |
| F06 spatial screen input & snip | Canvas drag selection with live animated marquee, `#btn-snip` UI, `Ctrl+Shift+D` shortcut, and coordinate projection into screenshot pixels. | `src/renderer/overlay/overlay.ts`, `src/main/ai/prompt.ts`, `test/core.test.ts` |
| Incremental scene patching | Streamed `<scene-patch>` blocks with transactional node/edge/part merging and cascading removal. | `src/shared/scene.ts`, `src/shared/blocks.ts`, `src/main/main.ts`, `test/scene.test.ts` |
| Extended 3D vocabulary | Expanded 3D primitives with `ring`, `prism`, `wedge`, and `tube` shapes. | `src/shared/scene.ts`, `src/renderer/overlay/scene3d.ts`, `test/scene.test.ts` |
| F08 Declarative Interactive UI Harness (`SceneUI`) | Added `kind: 'ui'` scene schema and `ui-patch` transactional patching (`metric`, `chart` bar/line/donut, `table` sortable, `slider` live parameter tuner, `comparison`, `checklist`, `code`, `card`, `callout`). Rendered via safe DOM/SVG APIs (zero `eval`) with click-to-select context feedback. | `src/shared/scene.ts`, `src/renderer/overlay/scene-ui.ts`, `src/renderer/overlay/scene-panel.ts`, `src/main/demo-scenes.ts`, `test/scene.test.ts` |
| F03 DeepSeek provider | Added `deepseek-chat` and `deepseek-reasoner` SSE streaming (`https://api.deepseek.com/chat/completions`), skipping internal `reasoning_content` thoughts while streaming spoken/scene output, with DPAPI key storage and Settings UI testing. | `src/main/ai/deepseek.ts`, `src/main/settings.ts`, `src/renderer/settings/*`, `test/providers.test.ts` |
| F08 & F17 GPT Image Gen (`gpt-image-1`) & Instant Studio | Added `generateImage` (`POST /v1/images/generations` with `gpt-image-1` and deterministic vector SVG fallback when keyless), `generate_image` tool in `ToolRegistry`, image artifact preview/download, and the **Studio** tab in Workspace. | `src/main/ai/image-gen.ts`, `src/main/connectors/drafts.ts`, `src/main/tools/builtins.ts`, `src/renderer/workspace/*`, `test/image-gen.test.ts` |
| F24 Shadcn Zinc UI Polish | Upgraded Overlay, Workspace, and Settings surfaces to Shadcn Zinc dark mode (`#09090b`, `#121215`, `#18181b`, crisp `1px` borders, focus-visible rings, and tabular monospace metrics). | `src/renderer/overlay/styles.css`, `src/renderer/workspace/workspace.css`, `src/renderer/settings/settings.css` |
| F03 & F13 Antigravity Google Account Harness (`thanmaybd@gmail.com` · `gemini-3.8-flash`) | Added `antigravity` provider harnessing the user's already signed-in, unmodified `agy` CLI (`agy --print --output-format stream-json`) with `gemini-3.8-flash-high` (`openAgySignIn` launches `agy` in its own terminal for documented first-run Google authentication without HeyGuy ever storing or scraping OAuth secrets), real-time token/request telemetry (`UsageTracker`), and `runHeadlessCodeGen` (`antigravity_codegen` tool + Workspace Studio UI). | `src/main/ai/antigravity.ts`, `src/main/settings.ts`, `src/main/tools/builtins.ts`, `src/renderer/workspace/workspace.ts`, `test/antigravity.test.ts` |

## Evidence

- `npm run check` (executed on Windows with Node v24.20.0 and Electron 45.2.2):
  - TypeScript typecheck passes with **0 errors**.
  - **74/74 unit and integration tests pass** across all suites (202.1ms):
    - `AntigravityHarness`: `gemini-3.8-flash` model normalization, exact `agy models` ID verification, `agy` NDJSON stream parsing (`init`, `step_update`, `result.usage`), Google Account (`thanmaybd@gmail.com`) token telemetry accumulation, loud failure when no code is returned, and static verification that no third-party client secrets or private Cloud Code endpoints are embedded
    - `SceneUI`: validation of `DEMO_UI`, widget clamping (`metric`, `chart`, `slider`, `checklist`), and `ui-patch` transactional merging
    - `DeepSeek` provider: SSE streaming, `reasoning_content` filtering, and Bearer header verification
    - `ImageGen` (`gpt-image-1` & `svg-synth`): OpenAI `gpt-image-1` API payload/response handling and deterministic keyless SVG illustration synthesis
    - `SpatialSelection`: coordinate mapping from overlay DIPs to screenshot pixels, `userPreamble` prompt injection
    - `SystemPrompt`: verification of visual contracts, extended 3D primitives, and incremental scene-patch documentation
    - `ScenePatches`: transactional 2D/3D graph patching, node removal cascading to edge removal, `<scene-patch>` streaming extraction
    - `Extended 3D Shapes`: validation of `ring`, `prism`, `wedge`, and `tube` geometries
    - `MemoryStore`: preference/fact storage, search, conversational extraction, prompt formatting
    - `SchedulerEngine`: next run computation (interval, daily, cron), pause/resume, wake missed-run policies
    - `AssistantProfileManager`: seeding defaults, assistant switching, custom profile creation
    - `NotificationDispatcher`: quiet mode, quiet hours, critical urgency passthrough
    - `JobEngine`: step execution, pause on consequential tool without approval, resume on approval, cancellation
    - `ToolRegistry`: read-only execution vs consequential gating
    - `DraftConnector`: RFC822 formatting, SHA-256 checksums, artifact persistence
    - `BrowserBridge`: 32-bit framed Chrome native messaging encode/decode
    - `WalkthroughObserver`: multi-step walkthrough state machine, step progression, cancel
    - `DatabaseStore`: session lifecycle, message storage, cascading deletion, scene persistence/retrieval, search across conversations
    - `OpenAI`, `Claude`, `Gemini`, `DeepSeek`, and `Antigravity (agy CLI)` provider stream packaging and error handling
    - All earlier scene, layout, turn, secret, hotkey, and geometry tests (74/74 passing)
  - Complete esbuild bundle generation of main process (`dist/main/main.js` 185.0 kB), 3 sandboxed preloads (`workspace.js` 6.0 kB, `overlay.js` 4.6 kB, `settings.js` 3.5 kB), and 3 renderer applications (`overlay.js` 621.8 kB, `workspace.js` 32.0 kB, `settings.js` 9.1 kB).
  - **Live provider check (`agy` CLI on Windows):**
    - Executed `agy.exe --print "Reply with the single word OK." --model gemini-3.8-flash-low --output-format stream-json --disable-slash-commands`.
    - Result: `status: "SUCCESS"`, `response: "OK\n"`, `duration_seconds: 9.88` (wall-clock `20.75s`), `input_tokens: 11431`, `output_tokens: 1`, `total_tokens: 11432`.

- Visual and UI integration:
  - Overlay with live captions element, speech-synchronized step highlights, interactive spatial snip marquee, 2D/3D/UI scene rendering (`SceneUIRenderer`), and workspace shortcut.
  - Settings UI with **Antigravity (Google account)** card (**"Sign in with Google (opens Antigravity)"** terminal sign-in launcher, `agy models` dropdown for `gemini-3.8-flash-high`/`medium`/`low`, `gemini-4-argon-*`, `claude-opus-5-5-*`, `claude-sonnet-5-5-*`, `gpt-oss-120b-medium`, and live request/token utilization strip), plus Claude, Gemini, OpenAI, and DeepSeek provider selection, encrypted key storage, test-key triggers, and hotkey rebinding.
  - Dedicated Workspace & Studio UI with 6 tabs (Chats, Studio, Jobs, Artifacts, Routines, Memory), assistant switcher dropdown, full-text history search, and scene reload into overlay.

**Not verified:**
- live cloud API calls with paid user keys (Gemini, Claude, or OpenAI)
- Windows multi-monitor DPI transitions in live production environments
- GPU performance
- the packaged installer

## Known limits and next steps

1. **Live provider check (WP5).** Run one real request per provider with a scene prompt, such as "how does DNS work, draw it". Record latency and the validation warnings. Tune the prompt in `prompt.ts` based on real output.
2. **Tag protocol.** Screen marks still use `[POINT:…]` text tags. Move them into the typed event/tool-call protocol when tool use is added (M5).
3. **Linux note.** On Linux, `safeStorage` may report "available" with the `basic_text` backend, which is not real protection. Windows (DPAPI) is the target, so this was left alone.
4. **Bundle size.** The overlay is about 700 KB minified with Three.js. If start-up time matters, lazy-load Three.js on the first 3D scene.

## 2026-11-05 (Claude): notch, Google-account speed, real 3D, new look

- **Dynamic notch** (`src/renderer/overlay/notch.ts`). A black island sits at the top centre of the screen. It widens to show live status (listening, thinking, the sentence being spoken). On hover or click it opens into the home panel: greeting, the Google account and model in use, quick actions, the last answer, plan usage and a switch-account button. Its shape is animated with `clip-path` on registered properties, so the hidden area doesn't catch clicks.
- **Google account (Antigravity CLI).**
  - `src/main/ai/agy-session.ts` keeps one warm `agy --input-format stream-json` process. The system prompt is sent once at startup, so later questions skip CLI start-up and the ~30k-token agent prompt (per the documented "Stream prompts from stdin" behaviour).
  - Connecting: the notch's "Sign in with Google" opens the official `agy` sign-in, then re-checks every 10 s until it answers.
  - "Plan usage" runs `agy --print /usage`. "Switch account" runs `/logout`.
  - Credentials stay inside `agy`.
  - Unit-tested with a fake `agy`. **Not yet run against the real CLI.**
- **3D vocabulary**:
  - New shapes: `extrude` (an outline seen from above, extruded upward), `lathe` (a profile spun around an axis) and `ellipsoid`.
  - `"mirror": "x"` adds the matching part on the other side, as a true geometric mirror.
  - Fixed the `tube` and `wedge` shapes.
  - The prompt now includes an aircraft worked example.
  - `DEMO_F22` (tray menu: Play demo, F-22 jet) renders as a recognisable F-22, checked visually from three angles in headless Chromium WebGL.
- **Drawing reliability.** If the user asks to draw or model something and the reply has no scene, one scene-only follow-up request runs. Raw replies are logged to `%APPDATA%/HeyGuy/logs/last-replies.txt` for diagnosis.
- **Theme.**
  - `src/renderer/theme.css` holds the tokens. Fonts are Bricolage Grotesque and Instrument Sans, both OFL and bundled locally.
  - The bubble, scene panels and UI widgets move to paper cards: no tracked-capital labels, `:focus-visible` on controls, and a reduced-motion fallback.
  - Settings and Workspace windows still use the old dark style. **Next.**
- Evidence: `npm run check` gives 80/80 tests passing. A Playwright end-to-end run confirmed the notch opens, shows the right state when the CLI is missing, and logs no renderer errors.
