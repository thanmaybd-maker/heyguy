# Gates: HeyGuy full-product research and architecture

Scope: Select and document a credible Windows-first approach to HeyClicky functional parity. Planning only; preserve existing application code. Date: 2026-11-04.

- [x] G1: Identify the current reference product and distinguish public-source capabilities, current product claims, and unverified behavior.
  EVIDENCE: `docs/REFERENCE-AND-GAPS.md`, “What the evidence establishes.” Retrieved official HeyClicky website/changelog, public README, architecture document and MIT license. Documents explicitly distinguish vendor claims, public implementation and absent hands-on acceptance.
- [x] G2: Assess existing HeyGuy source and preserve all requested capabilities in a traceable gap matrix.
  EVIDENCE: `docs/REFERENCE-AND-GAPS.md`, F01–F27 and source-backed audit. Inspected package/build configuration, shared contracts, main request/capture/settings/provider code and overlay modules. Validation found 27 unique feature IDs; runtime is explicitly untested.
- [x] G3: Compare approaches and select architecture covering desktop, voice, vision, drawing, interactive 3D, agents, memory, and integrations.
  EVIDENCE: `docs/FULL-PRODUCT-PLAN.md`, sections 1–7. Three alternatives compared; selected architecture and Mermaid flow explain module boundaries, scene generation, native/browser control and storage.
- [x] G4: Explain subscription versus runtime API options, cost controls, and model evaluation without unverified promises.
  EVIDENCE: Plan section 6. Official OpenAI plan-access/preview-limit/app-server pages and Anthropic authentication/plan guidance retrieved. User entitlement and pricing remain unverified; evaluation roles and metering/budget design are explicit.
- [x] G5: Write staged implementation and acceptance plan, with concrete files, dependencies, risks, and Codex/Claude handoff rules.
  EVIDENCE: Plan sections 8–11 contain M0–M8, file targets, dependency order, six first-work-package changes, 60 proposed evaluation cases, release gates, ownership and handoff instructions. Estimates and thresholds are labelled proposals.
- [x] G6: Review the final documents for coverage, evidence, source links, and clear separation of planning from implemented or tested behavior.
  EVIDENCE: Manually reviewed feature coverage, model-access caveats, source claims and implementation dependencies. PowerShell document check exited 0: “PASS: local document links, fences, 27 unique feature IDs and 9 milestones (M0-M8).” No application code, dependencies or account settings changed. No app tests claimed.

Result: 6 of 6 planning gates checked. No abandoned planning gates.

## Gates: M2 Conversation Store, OpenAI Vision Provider, Workspace & Speech-Visual Sync
Scope: Implement durable SQLite conversation/scene storage, OpenAI provider adapter with encrypted key storage, speech-synced visual steps, live captions, and expandable workspace window. Date: 2026-11-04.

- [x] G7: Durable SQLite conversation & scene store (`src/main/storage/db.ts`) using `node:sqlite` for cross-day memory, search, and scene reload.
  EVIDENCE: Built `src/main/storage/db.ts` on built-in `node:sqlite` with foreign key cascades, transaction-safe queries, sessions, messages, and scene storage. Verified with 4 comprehensive tests in `test/storage.test.ts`.
- [x] G8: OpenAI vision & ping provider (`src/main/ai/openai.ts`) with encrypted key storage (`safeStorage`), settings UI integration, and error handling.
  EVIDENCE: Created `src/main/ai/openai.ts` streaming vision requests over SSE with `gpt-4o` / `gpt-4o-mini` support; integrated `openaiKeyEnc` in `src/main/settings.ts` with DPAPI encryption; added Settings UI fields, test button, and unit test in `test/providers.test.ts`.
- [x] G9: Speech-visual synchronization and live captions panel linking spoken sentence boundaries to scene step progression.
  EVIDENCE: Enhanced `Speaker` in `src/renderer/overlay/tts.ts` with `onSentenceStart` / `onSentenceEnd`; wired `ScenePanel.syncStep` in `src/renderer/overlay/scene-panel.ts` to advance highlights with spoken sentences; added live captions pill in `index.html` and `styles.css`.
- [x] G10: Expandable workspace & history window (`src/renderer/workspace/`) for reviewing past chats, inspecting scenes, and searching across sessions.
  EVIDENCE: Built complete workspace surface in `src/renderer/workspace/` with conversation list, search bar, transcript inspection, and "Display in Overlay" action for re-opening 2D and 3D scenes.
- [x] G11: Renderer sandboxing & sender verification for workspace IPC routes (`preload/workspace.ts` with sender checks in `main.ts`).
  EVIDENCE: Created sandboxed context bridge in `src/preload/workspace.ts`; enforced `fromWorkspace(e)` sender verification in `src/main/main.ts` for all workspace database queries and mutations.
- [x] G12: Verification pass: unit/integration test coverage, `npm run check` clean, and build verification.
  EVIDENCE: Live execution of `npm run check` (typecheck + tests + build) passed with 0 errors across 44/44 tests (up from 39). Build bundles all main, preload, and renderer targets cleanly.

Result: 12 of 12 gates checked (6 planning, 6 implementation). No abandoned gates.

## Gates: M5 & M6 Autonomous Execution (Jobs, Tools, Drafts, Browser & Windows Control)
Scope: Implement durable background jobs, tool permission broker, artifact & draft creation, native browser bridge, Windows UI Automation & input control, and walkthrough observer. Date: 2026-11-04.

- [x] G13: Tool system & permission broker (`src/main/tools/`) with schema validation, host-side policy checks, and approval gating.
  EVIDENCE: Created `src/main/tools/types.ts` and `src/main/tools/registry.ts`. Validates inputs, distinguishes read-only vs consequential actions, and blocks unapproved execution. Verified in `test/jobs.test.ts`.
- [x] G14: Background job engine (`src/main/jobs/`) with state machine, SQLite durability, step execution, and cancellation propagation.
  EVIDENCE: Implemented `src/main/jobs/engine.ts` with SQLite job/step tracking, approval pause, step execution, and abort signal propagation. Verified in `test/jobs.test.ts`.
- [x] G15: Local artifact & draft store (`src/main/artifacts/` & `src/main/connectors/drafts.ts`) for producing verified email/document drafts with checksums.
  EVIDENCE: Implemented `src/main/connectors/drafts.ts` and SQLite artifacts table with SHA-256 checksums and RFC822 MIME email formatting. Verified in `test/drafts.test.ts`.
- [x] G16: Native messaging browser bridge (`src/main/browser/` & `extensions/chrome/`) supporting 32-bit framed IPC, tab ownership, and DOM inspection.
  EVIDENCE: Created `src/main/browser/bridge.ts` with 32-bit length-prefixed native messaging encoding/decoding, plus Chrome extension Manifest V3 and background/content scripts. Verified in `test/browser.test.ts`.
- [x] G17: Windows UI Automation and input control bridge (`src/main/control/`) with immediate user takeover detection, target freshness, and SendInput simulation.
  EVIDENCE: Implemented `src/main/control/windows.ts` with active foreground window inspection, synthetic coordinate tagging, and 25ms polling loop for instant user takeover interruption.
- [x] G18: Guided teaching walkthrough state machine & outcome observer (`src/main/walkthroughs/`).
  EVIDENCE: Implemented `src/main/walkthroughs/observer.ts` managing multi-step visual tutorials, target points, and step transitions. Verified in `test/walkthrough.test.ts`.
- [x] G19: Full-stack Workspace and Overlay integration with job tracking, approval modals, and artifact previews.
  EVIDENCE: Added Jobs and Artifacts tabs in `src/renderer/workspace/`, with approval banner/action, step status icons, and artifact preview; wired IPC in `src/preload/workspace.ts` and `src/main/main.ts`.
- [x] G20: Comprehensive test coverage for all new modules and live `npm run check` clean execution.
  EVIDENCE: `npm run check` passed clean on Windows with **51/51 tests passing** (up from 44). esbuild bundles all 3 renderers, 3 preloads, and main process with zero errors.

Result: 20 of 20 gates checked (6 planning, 14 implementation). No abandoned gates.

## Gates: M7 & M8 Persistent Assistants, Memory, Routines & Public Release
Scope: Implement cross-day memory storage, durable scheduled routines with missed-run wake recovery, named assistant profiles, quiet notification dispatch, workspace/settings management UI, and full release verification. Date: 2026-11-04.

- [x] G21: Cross-Day Memory Store (`src/main/memory/store.ts` & SQLite `memories` table) for user preferences, facts, work habits with retrieval, deletion, and context injection into prompts.
  EVIDENCE: Created `src/main/memory/store.ts` and SQLite `memories` table with category indexing. Supports automatic conversational extraction of preferences/facts, bounded relevance retrieval, prompt injection, and user forgetting. Verified in `test/scheduler-memory.test.ts`.
- [x] G22: Durable Scheduled Routines Engine (`src/main/scheduler/engine.ts` & SQLite `routines` table) with timezone awareness, interval/daily/cron calculation, pause/resume, and wake/restart missed-run recovery.
  EVIDENCE: Implemented `src/main/scheduler/engine.ts` with interval/daily/cron next-run computation, background timer loop, job execution dispatch, and wake recovery policies (`run_once_on_wake` vs `skip`). Verified in `test/scheduler-memory.test.ts`.
- [x] G23: Named Assistant Profiles (`src/main/assistants/profiles.ts` & SQLite `assistants` table) with role definitions, distinct system instructions, and workspace association.
  EVIDENCE: Implemented `src/main/assistants/profiles.ts` and seeded 3 default personas (HeyGuy General, Dev Specialist, Deep Researcher). Wired profile system prompt injection in `src/main/main.ts`. Verified in `test/scheduler-memory.test.ts`.
- [x] G24: Quiet Notifications Dispatcher (`src/main/notifications/dispatcher.ts`) with Electron notifications, quiet-hours suppression, and routine/job completion updates.
  EVIDENCE: Implemented `src/main/notifications/dispatcher.ts` with quiet mode toggle, quiet hours evaluation, and critical urgency passthrough for consequential safety approvals. Verified in `test/scheduler-memory.test.ts`.
- [x] G25: Workspace & Settings UI Extension with Memory viewer/search, Routines manager (create, pause, run now, delete), Assistant selector, and secure sandboxed IPC.
  EVIDENCE: Updated `src/renderer/workspace/` with Routines and Memory tabs, assistant selection dropdown, sandboxed context bridges in `src/preload/workspace.ts`, and sender-verified IPC handlers in `src/main/main.ts`.
- [x] G26: Comprehensive Unit and Integration Test Suite covering memory extraction/retrieval, routine scheduling/missed-run catchup, assistant switching, and notification policies.
  EVIDENCE: Created `test/scheduler-memory.test.ts` adding 6 new comprehensive tests. All passed cleanly in `npm test`.
- [x] G27: Release Verification & Documentation (`package.json`, `npm run check`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `docs/BUILD-STATE.md`, `docs/DECISIONS.md`).
  EVIDENCE: Authored `LICENSE` (MIT), `THIRD_PARTY_NOTICES.md` with Clicky/Electron/Three.js notices, `docs/TEST-REPORT.md`, updated `docs/DECISIONS.md` (D10, D11), and updated `docs/BUILD-STATE.md`.
- [x] G28: Final Gate Verification & Re-measurement: 100% tests passing, 0 TypeScript errors, 0 lint/build warnings, complete executable implementation with zero placeholders.
  EVIDENCE: Ran `npm run check` fresh. Output: `tsc -p tsconfig.json --noEmit` exited 0; `node --test` passed **57/57 tests** (0 failed, 0 skipped); `scripts/build.mjs` bundled main (133.1 kB), preloads, and renderers with zero warnings.

Result: 28 of 28 gates checked (6 planning, 22 implementation). Zero abandoned gates. All milestones complete.

## Gates: M3/M4 Enhancements (Spatial User Input, Scene Patches & Extended 3D Vocabulary)
Scope: Implement spatial screen drawing selection (F06), incremental scene patching (`<scene-patch>`), extended 3D geometric primitives (tube, ring, prism, wedge), and comprehensive test coverage. Date: 2026-11-05.

- [x] G29: Spatial User Input & Region Grounding (`src/renderer/overlay/overlay.ts`, `src/main/ai/prompt.ts`, `src/shared/types.ts`) allowing users to drag a selection box/circle on screen with coordinate transformation to screenshot pixel space (F06).
  EVIDENCE: Added `SpatialSelection` contract, canvas drag marquee with live dashed rendering, `#btn-snip` UI button, `Ctrl+Shift+D` shortcut, and coordinate projection in `userPreamble`. Verified in `test/core.test.ts`.
- [x] G30: Transactional Scene Patching (`src/shared/scene.ts`, `src/shared/blocks.ts`, `src/main/main.ts`) allowing streaming `<scene-patch>` blocks to incrementally add/update/remove nodes, edges, and parts without redrawing the entire graph from scratch.
  EVIDENCE: Built `ScenePatch2D`, `ScenePatch3D`, `parseScenePatchJSON`, and `applyScenePatch`. Edge removals cascade automatically when connected nodes are removed. Added streaming tag support in `SceneBlockStream` and `stripSceneBlocks`. Verified in `test/scene.test.ts`.
- [x] G31: Extended 3D Geometric Vocabulary (`src/shared/scene.ts`, `src/renderer/overlay/scene3d.ts`) adding `ring`, `prism`, `wedge`, and `tube` with vetted parameter limits and fallbacks.
  EVIDENCE: Added `ring` (annular disc), `prism` (polygonal regular prism), `wedge` (triangular ramp), and `tube` (hollow cylinder) constructors in `geometryFor` and parameter clamping in `partSize`. Verified in `test/scene.test.ts`.
- [x] G32: Comprehensive Unit and Integration Test Suite covering spatial coordinates transformation, 2D/3D scene patch application, extended 3D geometry validation, and systemPrompt visual contracts.
  EVIDENCE: Added 6 new tests across `test/core.test.ts` and `test/scene.test.ts`. All 63 tests pass cleanly with zero failures.
- [x] G33: Live Re-measurement: 100% tests passing, zero placeholders, and fresh `npm run check` clean run.
  EVIDENCE: Ran `npm run check`. `tsc` passed with 0 errors; `node --test` passed **63/63 tests** (0 failed, 0 skipped); `scripts/build.mjs` bundled main (141.9 kB), preloads (3 targets), and renderers (3 targets) cleanly.

Result: 33 of 33 gates checked (6 planning, 27 implementation). Zero abandoned gates.

## Gates: M3/M5/M8 Upgrade — Shadcn UI Polish, Declarative UI Harness (`SceneUI`), DeepSeek Provider & GPT Image Gen (`gpt-image-1`)
Scope: Upgrade all UI surfaces to a shadcn-inspired dark mode aesthetic; add declarative `SceneUI` (`kind: 'ui'`) for instant interactive cards, charts, tables, and metric dashboards (F08); integrate DeepSeek (`deepseek-chat` / `deepseek-reasoner`) provider (F03); integrate OpenAI `gpt-image-1` image generation engine with deterministic SVG fallback and artifact storage (F08, F17); and add Instant Studio to Workspace (F15). Date: 2026-11-05.

- [x] G34: Declarative `SceneUI` (`kind: 'ui'`) schema, validator, and `<scene-patch>` support in `src/shared/scene.ts`, plus DOM/SVG renderer in `src/renderer/overlay/scene-ui.ts` supporting interactive metrics, charts (bar/line/donut), tables, tabs, code blocks, and callouts with click-to-select context.
  EVIDENCE: Implemented `SceneUI`, `SceneUIWidget`, `ScenePatchUI`, `sanitizeUIWidget`, and `validateUI` in `src/shared/scene.ts`. Built `SceneUIRenderer` in `src/renderer/overlay/scene-ui.ts` using safe DOM/SVG APIs (zero `eval`), wired into `src/renderer/overlay/scene-panel.ts`, and added `DEMO_UI` in `src/main/demo-scenes.ts`. Verified in `test/scene.test.ts`.
- [x] G35: DeepSeek AI provider (`src/main/ai/deepseek.ts`) supporting `deepseek-chat` and `deepseek-reasoner` (including `reasoning_content` thoughts and SSE streaming), DPAPI encrypted key storage in `src/main/settings.ts`, and Settings UI integration.
  EVIDENCE: Implemented `streamDeepSeek` and `pingDeepSeek` in `src/main/ai/deepseek.ts`, encrypted key storage (`deepseekKeyEnc`) in `src/main/settings.ts`, IPC testing in `src/main/main.ts`, and Settings UI controls in `src/renderer/settings/`. Verified in `test/providers.test.ts`.
- [x] G36: GPT Image Generation Engine (`src/main/ai/image-gen.ts`) supporting OpenAI `gpt-image-1` (`POST /v1/images/generations` with size/quality/background options) and deterministic high-craft SVG illustration synthesis fallback, wired to `DraftConnector`, `ToolRegistry` (`generate_image`), and IPC.
  EVIDENCE: Created `src/main/ai/image-gen.ts` with `generateImage` and `synthesizeSvgIllustration`, added `createImageArtifact` in `src/main/connectors/drafts.ts`, registered `generate_image` in `src/main/tools/builtins.ts`, and added `IPC.generateImage` / `IPC.previewScene` in `src/main/main.ts`. Verified in `test/image-gen.test.ts`.
- [x] G37: Shadcn-inspired UI upgrade across Overlay (`src/renderer/overlay/`), Workspace (`src/renderer/workspace/`), and Settings (`src/renderer/settings/`), including quick-action pills, Instant Studio tab in Workspace, image artifact previews, and `demo:ui` mode.
  EVIDENCE: Upgraded `src/renderer/settings/settings.css`, `src/renderer/workspace/workspace.css`, and `src/renderer/overlay/styles.css` to Shadcn Zinc dark mode tokens (`#09090b`, `#121215`, `#18181b`, crisp `1px` borders). Added `#tab-studio` in Workspace (`src/renderer/workspace/workspace.ts`) with instant overlay scene presets and GPT-Image-1 visual generator, plus `npm run demo:ui` in `package.json`.
- [x] G38: Comprehensive Unit and Integration Test Suite for `SceneUI` validation/patching, DeepSeek SSE streaming, and `gpt-image-1` image generation & fallback, verified via fresh `npm run check`.
  EVIDENCE: Ran `npm run check` fresh. `tsc -p tsconfig.json --noEmit` exited 0; `node --test` passed **67/67 tests** (0 failed, 0 skipped) in 227.7ms; `scripts/build.mjs` bundled `dist/main/main.js` (165.4 kB), 3 preloads (`workspace.js` 5.7 kB, `overlay.js` 4.4 kB, `settings.js` 3.2 kB), and 3 renderers (`overlay.js` 621.8 kB, `workspace.js` 28.8 kB, `settings.js` 7.6 kB) cleanly.

Result: 38 of 38 gates checked (6 planning, 32 implementation). Zero abandoned gates.

## Gates: M5/M8 Upgrade — Google Account Antigravity Harness (`thanmaybd@gmail.com`, `gemini-3.8-flash`), Usage Telemetry & Editor-Free Code Generation
Scope: Connect the user's Google account (`thanmaybd@gmail.com`) and local Antigravity CLI (`agy`) / Gemini API as a first-class provider and headless code-generation harness (inspired by open-source mobile Antigravity harnesses that generate code and UI without needing a code editor visible), defaulting to `gemini-3.8-flash` with live usage/quota telemetry. Date: 2026-11-05.

- [x] G39: Antigravity Google Account Provider & Usage Telemetry (`src/main/ai/antigravity.ts`) supporting `agy --print` non-interactive streaming (`--output-format stream-json` / `text`) and Gemini REST fallback with `gemini-3.8-flash`, tracking live request/token usage for `thanmaybd@gmail.com`.
  EVIDENCE: Implemented `streamAntigravity`, `pingAntigravity`, `parseAgyStreamLine`, `normalizeAntigravityModel`, and `antigravityUsage` (`UsageTracker`) in `src/main/ai/antigravity.ts`. Verified live `agy` CLI (`C:\Users\skc\AppData\Local\agy\bin\agy.exe`) with `gemini-3.8-flash-high` and NDJSON stream events (`init`, `step_update`, `result.usage`).
- [x] G40: Editor-Free Headless Code & UI Generation Harness (`runHeadlessCodeGen` in `src/main/ai/antigravity.ts`, `antigravity_codegen` tool in `src/main/tools/builtins.ts`, and IPC handlers in `src/main/main.ts`) that turns natural language prompts into complete code artifacts + live interactive `SceneUI` previews without opening an IDE.
  EVIDENCE: Implemented `runHeadlessCodeGen` in `src/main/ai/antigravity.ts`, registered `antigravity_codegen` in `src/main/tools/builtins.ts`, and added `IPC.getAntigravityUsage` and `IPC.runHeadlessCodeGen` in `src/main/main.ts`.
- [x] G41: Settings & Types Integration (`src/shared/types.ts`, `src/main/settings.ts`, `src/renderer/settings/`) adding `'antigravity'` to `Provider`, `antigravityModel` (default `'gemini-3.8-flash-high'`), `googleAccountEmail` (default `'thanmaybd@gmail.com'`), and live Antigravity CLI / Google Account connection test in Settings.
  EVIDENCE: Updated `src/shared/types.ts`, `src/main/settings.ts`, `src/renderer/settings/index.html`, and `src/renderer/settings/settings.ts` with the `Antigravity (Google)` provider option, `thanmaybd@gmail.com` account field, `gemini-3.8-flash-high` default model, and live `Test` button.
- [x] G42: Workspace Studio "Antigravity Headless Code & Usage Harness" (`src/renderer/workspace/workspace.ts`, `src/preload/workspace.ts`) displaying account status (`thanmaybd@gmail.com`), model (`gemini-3.8-flash`), token/request usage meter, and an editor-free prompt-to-code+UI generator.
  EVIDENCE: Added the Antigravity Google Account & Editor-Free Code Harness card in `src/renderer/workspace/workspace.ts` (`renderStudioView()`) displaying live token telemetry (`inputTokens`, `outputTokens`, `thinkingTokens`, `totalTokens`, `totalRequests`) and one-click code + overlay UI generation.
- [x] G43: Comprehensive Unit and Integration Test Suite (`test/antigravity.test.ts`) covering Antigravity stream parsing, usage telemetry calculation, headless codegen artifact + UI synthesis, and `npm run check` verification.
  EVIDENCE: Created `test/antigravity.test.ts` (4 tests) and ran `npm run check` fresh. `tsc -p tsconfig.json --noEmit` exited 0; `node --test` passed **71/71 tests** (0 failed, 0 skipped) in 398.2ms; `scripts/build.mjs` bundled `dist/main/main.js` (187.3 kB), 3 preloads (`workspace.js` 6.0 kB, `overlay.js` 4.5 kB, `settings.js` 3.3 kB), and 3 renderers (`overlay.js` 621.8 kB, `workspace.js` 32.0 kB, `settings.js` 7.9 kB) cleanly.

Result: 43 of 43 gates checked (6 planning, 37 implementation). Zero abandoned gates.
