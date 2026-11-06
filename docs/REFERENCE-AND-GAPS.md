# HeyGuy: reference evidence and capability gaps

Research date: 2026-11-04, Asia/Calcutta. Target: the current HeyClicky desktop product, not only its original public repository. Companion plan: [FULL-PRODUCT-PLAN.md](FULL-PRODUCT-PLAN.md).

## What the evidence establishes

The [official website](https://www.heyclicky.com/) identifies HeyClicky as a Mac and Windows companion. The [official changelog](https://www.heyclicky.com/changelog) lists Windows 1.1.4 on November 1 and Mac 1.1.2 on October 30. Its October 23 release describes drawing, interactive 3D, desktop driving, browser work, and a shared conversational interface. These are vendor descriptions, not results from our own hands-on test.

The [public Clicky README](https://github.com/farzaa/clicky/blob/main/README.md) explicitly says the existing code stays open source while newer work is private. Its [architecture document](https://github.com/farzaa/clicky/blob/main/CLAUDE.md) describes a native Swift/AppKit Mac application with a cursor overlay, screenshot input, streamed language-model replies, speech transcription, and speech synthesis through a Worker proxy. That establishes the older implementation; it does not establish how the current commercial application generates scenes or runs agents.

The public repository has an [MIT license](https://github.com/farzaa/clicky/blob/main/LICENSE). If we reuse its code, preserve the applicable notice. Keep HeyGuy's own name and assets. The public license is not evidence that the newer private implementation or all commercial-product assets have the same license. Functional reconstruction should use observed behavior, documented interfaces, and code whose license we have checked.

No HeyClicky binary was installed or operated during this research. No YouTube video was watched end to end. Accordingly, there is no frame-by-frame parity claim, measured competitor latency, or assertion about its private models, prompts, rendering stack, or infrastructure. Those remain reference-validation work for milestone M0.

## Capability matrix

All reference claims below come from the [official changelog](https://www.heyclicky.com/changelog) unless another source is stated. Dates matter: a historical launch does not prove the feature remains enabled. “Source present” describes inspected local code, not runtime acceptance. “Missing” means no implementation was found in the current source inventory for that capability.

| ID | Capability and reference status | Existing HeyGuy evidence | Target and milestone |
|---|---|---|---|
| F01 | Cursor companion; original public implementation | Source present: `src/renderer/overlay/buddy.ts`, state types, animation loop | Preserve blue character and expressive states; M1 |
| F02 | Transparent overlay, pointing, speech bubbles | Source present: `src/main/main.ts`, `bubble.ts`, `annotations.ts` | Accurate, non-obstructing, multi-display overlay; M1 |
| F03 | Voice and typed questions about the screen | Source present: WAV recording, Gemini transcription, two vision adapters | Real provider round trip and input fallback; M1–M2 |
| F04 | Spoken answers and captions | OS TTS and streamed text bubble present; cloud voice and caption surface missing | Streaming speech, interrupt, captions, voice preview; M2 |
| F05 | Multilingual speech and dictation; November release claims 130+ speech languages and 83 dictation options | No measured language acceptance or insert-into-app flow | English and Hindi/code switching first; publish tested language matrix, expand toward reference coverage; M2, M6, M8 |
| F06 | Spatial input: user circles or scribbles to show what they mean; historical launch | Missing user-drawing input | Annotated selection sent as explicit context with coordinate metadata; M3 |
| F07 | Points, circles, boxes, arrows, underline | Five annotation variants present in `src/shared/types.ts` | Preserve existing marks, add stable anchors and stale-screen handling; M1, M3 |
| F08 | Dynamic 2D drawings and explanatory cards, including photos | Missing general scene/card system; annotation tags are insufficient | Diagram scene graph, layout, charts, cards, sourced images; M3 |
| F09 | Interactive 3D explanations: rotate and click parts | Missing | Semantic Three.js scenes with part questions and reliable fallback; M4 |
| F10 | Guided teaching advances after appropriate user interaction | Missing step observer and walkthrough state | Observe actual outcome, re-anchor after UI changes; M6 |
| F11 | Desktop driving with visible handover and interruption | Missing OS action executor | Windows accessibility-first control plus guarded pointer fallback; M6 |
| F12 | Agents working in the user's signed-in browser | Missing extension and browser transport | Chrome extension, native bridge, task-owned tabs; M5 |
| F13 | Background agents with plan, progress, follow-ups and results | Missing durable job engine | Persistent jobs, steering, cancellation, budget and evidence; M5 |
| F14 | Persistent named assistants with role, memory and folders; earlier Clickys retained | Missing | Named workspaces and isolated job histories; M7 |
| F15 | Resizable home/notch, full chat, task sidebar and document pane | Only overlay bubble, tray and settings window present | Compact top-edge home plus expandable workspace; M2, M5 |
| F16 | Recent visual context and conversation memory across days | `main.ts` retains only eight text message entries in memory | Explicit session visual context; editable durable memory and deletion; M2, M7 |
| F17 | File attachments, generated files and document previews | Missing | Local artifact store, attachments, safe previews and exports; M5 |
| F18 | Connected apps, multiple accounts, reconnect and custom MCP | Missing | Gmail first, then calendar/files; account-scoped connectors, MCP adapter; M5, M7 |
| F19 | Drafting text and email; requested by Thanmay, fits reference agent/integration behavior | Chat can produce text; no verified draft saved in an external application | Draft to selected account or active app; verify the saved result; M5–M6 |
| F20 | Scheduled routines with natural-language setup, pause and delete | Missing | Durable, timezone-aware scheduler with missed-run rules; M7 |
| F21 | Proactive suggestions | Historical capability; October 23 says suggestions are paused | Retain in backlog as optional, opt-in read-only proposals; not mislabelled current parity; M7 extension |
| F22 | Skills library | Historical capability; September 12 says it was removed pending redesign | Internal reviewed skills can support tools; public marketplace is a later extension, not a current-parity prerequisite |
| F23 | Long-job recovery, follow-up handling, budgets and readable failures | Basic abort and timeout present; no persistent jobs | Crash recovery, reconnect, safe retries and reconcile unknown outcomes; M5, M8 |
| F24 | Onboarding, shortcut recording, settings, updates | Settings/hotkey source and installer configuration present; no proven installer/update path | Permission tour, health checks, signed release and rollback; M1, M8 |
| F25 | Privacy and user control | On-demand capture and renderer isolation present; key storage has a plaintext-equivalent fallback | Capture grants, account/tool scoping, secure credentials and retention controls; all milestones |
| F26 | Search, archive, pin, unread status and quiet notifications | Missing | Workspace history and job notification controls; M7 |
| F27 | Mac and Windows official downloads | Existing project targets Windows; no Mac acceptance | Windows first. Later Mac adapter and separate acceptance before claiming OS parity |

This is a map of material functional areas, not an exhaustive inventory of every release-note fix or connector. Before using “one-to-one,” complete the reference walkthrough, list exact supported connectors/languages/OS versions, and reconcile this matrix against that frozen reference version. Commercial subscriptions, billing UI and the vendor's marketing/community systems are not part of the selected personal open-source release; hosted commercialization is a separate distribution decision.

## Existing foundation: what to keep and what to investigate

The folder is already an Electron/TypeScript project, not an empty starting point. The inspected `package.json` uses Electron, esbuild, TypeScript, electron-builder and `node:test`; renderers use plain DOM/Canvas. There is no local Git repository, and no `node_modules` directory was present in the inspected folder. No dependency installation, app execution, paid model call, build or test was performed in this planning task.

Keep these pieces subject to baseline tests:

- `src/renderer/overlay/buddy.ts`: blue cursor geometry, follow/fly/perch behavior and animated states.
- `src/renderer/overlay/annotations.ts`: animated marker paths.
- `src/shared/tags.ts`, `geometry.ts`, `sentences.ts`: incremental parsing, coordinate transformation and speech segmentation.
- `src/main/ai/anthropic.ts`, `gemini.ts`, `sse.ts`, `http.ts`: existing provider transport to migrate behind richer contracts.
- `src/preload/*` and window settings in `main.ts`: narrow bridge pattern with context isolation, sandboxing and Node disabled in renderers.
- Existing tests, hotkey conflict handling and development snapshot hook.

Source-backed gaps to handle before adding desktop authority:

1. **Credential persistence:** `src/main/settings.ts:47` uses safeStorage when available, but line 48 falls back to Base64 with a `raw:` prefix. Base64 is not encryption. Fail closed for persistence when encryption is unavailable, or offer session-only secrets. Migrate old records deliberately.
2. **Wrong-monitor capture risk:** `src/main/capture.ts:21` falls back to `sources[0]` when the requested display cannot be matched. Reject or ask for a display choice; never silently capture a different screen.
3. **Capture timing:** `main.ts:230` transcribes audio before calling `ask()`, which captures the screen later. For spoken pointing, freeze the intended context at the declared moment and keep the visible capture indicator aligned with that policy.
4. **Request ownership:** `finishRequest()` clears the current request conditionally but changes the display lock unconditionally. Audit concurrent cancellation/new-request transitions and tag all emitted events with an owning turn ID. This is a source-level concern, not a reproduced runtime failure.
5. **Capture scope:** current `ask()` takes a screenshot for every request, even a purely typed conceptual question. New requests need an explicit context mode: none, selected window/region, selected display, or granted task observation.
6. **Memory scope:** the eight-entry text history is neither cross-day memory nor a retained visual conversation. Do not market it as either.
7. **Provider validation:** model strings in defaults and README are not account entitlement checks. Existing provider tests replace `fetch` with fixtures. They establish transport behavior, not live availability, grounding or latency.
8. **Rendering/resource behavior:** continuous `requestAnimationFrame`, a 16 ms cursor poll and disabled background throttling warrant profiling. Do not replace the renderer without measurement; add idle throttling and cleanup based on observed behavior.
9. **Speech/visual coordination:** annotations currently travel in text tags, and the prompt limits replies to four marks. This is useful for the original feature, not a general interactive graphics protocol.

## Engineering sources used for the recommendation

| Primary source | What it supports; what it does not prove |
|---|---|
| [Electron custom window interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions) | Click-through and draggable-region mechanisms; not reliability on every Windows display configuration |
| [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) | Renderer isolation and privileged-code boundary; not a guarantee that arbitrary generated code is safe |
| [Microsoft UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32) | Programmatic UI inspection/manipulation; not universal accessibility coverage |
| [Windows SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput) | Mouse/keyboard injection and integrity-level restrictions; not access to every elevated or secure surface |
| [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) | Extension/native host transport and explicit extension origins |
| [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html) | Orbit, zoom and pan interaction |
| [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html) | Mapping a click to a scene object; semantic part identity remains our responsibility |
| [Three.js GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html) | Exporting scene assets; not CAD or scientific accuracy |
| [Gmail drafts](https://developers.google.com/workspace/gmail/api/guides/drafts) | Separate draft creation, updating and sending operations |
| [Gemini Live tools](https://ai.google.dev/gemini-api/docs/live-api/tools) | Streaming-session tool calls handled by our application; support varies by model |
| [Sign in with ChatGPT: plan usage](https://developers.openai.com/siwc/token-sharing-open-source) | Eligible open-source/local apps can request ChatGPT-plan inference permission |
| [ChatGPT-plan preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) | Important tool, input and request restrictions; not a full API replacement |
| [Codex app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) | Supported app-server route; a model listing does not prove inference entitlement |
| [Claude Code authentication/compliance](https://code.claude.com/docs/en/legal-and-compliance) | Distinction between unmodified, user-authenticated Claude Code and offering our own Claude login |
| [Claude plan / Agent SDK guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) | Current subscription usage and eligible plan API-credit guidance; actual entitlement still requires account verification |

Three focused Exa searches requested 15 result slots across product identity, Claude authentication and streaming voice. Direct page retrieval and local source inspection followed. Result slots are discovery leads, not 15 independently validated sources. Official product pages and provider/framework documentation supplied the factual conclusions; third-party summaries were not treated as implementation proof. One generic Gemini Live overview fetch timed out; the specific official tool documentation was retrieved successfully.
