# HeyGuy Test & Evaluation Report

Execution Date: 2026-11-05  
Platform: Windows 11 (win32 x64)  
Node.js: v24.20.0  
Electron: 45.2.2  
Test Runner: `node:test` + TypeScript (`npm run check`)

---

## 1. Summary

- **Total Tests**: 74
- **Passed**: 74 (100%)
- **Failed**: 0
- **Skipped**: 0
- **TypeScript Errors**: 0 (`tsc -p tsconfig.json --noEmit`)
- **Bundle Output**: Main (`185.0 kB`), Preloads (`workspace.js` `6.0 kB`, `overlay.js` `4.6 kB`, `settings.js` `3.5 kB`), Renderers (`overlay.js` `621.8 kB`, `workspace.js` `32.0 kB`, `settings.js` `9.1 kB`)

---

## 2. Test Suites and Coverage

| Category | Test File | Tests | Status | Scope |
|---|---|---:|---|---|
| Antigravity Google Account Harness | `antigravity.test.ts` | 7 | PASS | `gemini-3.8-flash` normalization, exact `agy models` ID check, `agy` NDJSON stream parsing, `thanmaybd@gmail.com` token telemetry, loud failure on empty output, no embedded secrets/private endpoints |
| Native Browser Messaging | `browser.test.ts` | 1 | PASS | 32-bit framed IPC encode/decode |
| Turns & Context | `core.test.ts` | 6 | PASS | Turn cancellation, screen capture identity, DPAPI secret encryption, spatial selection, systemPrompt contract |
| Connectors & Drafts | `drafts.test.ts` | 2 | PASS | RFC822 MIME formatting, SQLite artifact storage with SHA-256 |
| Coordinate Geometry | `geometry.test.ts` | 5 | PASS | DIP mapping, clamp/normalize, box bounds, circle visibility |
| Hotkeys & Shortcuts | `hotkeys.test.ts` | 4 | PASS | Keydown to accelerator, conflict prevention (Ctrl+Alt reserved) |
| Image Gen & Vector Synth | `image-gen.test.ts` | 2 | PASS | OpenAI `gpt-image-1` generation & keyless deterministic SVG fallback |
| Tool Broker & Jobs | `jobs.test.ts` | 3 | PASS | Read-only vs consequential gating, step state machine, cancellation |
| AI Providers | `providers.test.ts` | 5 | PASS | Claude, Gemini, OpenAI, and DeepSeek SSE streaming & `reasoning_content` filtering, 401 handling |
| Scene Schema, 3D & UI Harness | `scene.test.ts` | 15 | PASS | JSON validation, repair salvage, layered layouts, extended 3D shapes, `SceneUI` (`kind: 'ui'`) widgets, and transactional scene patches (`2d-patch`, `3d-patch`, `ui-patch`) |
| Memory, Scheduler & Assistants | `scheduler-memory.test.ts` | 6 | PASS | Cross-day memory extraction/search, routine wake recovery, quiet mode |
| Audio & Sentence Parsing | `sentences.test.ts` | 3 | PASS | Punctuation boundary segmentation, markdown stripping |
| SSE Protocol | `sse.test.ts` | 1 | PASS | Multi-line events, comments, chunked data streams |
| Durable Storage | `storage.test.ts` | 4 | PASS | SQLite sessions, cascades, full-text LIKE search, scene persistence |
| Incremental Tags | `tags.test.ts` | 5 | PASS | Streaming tag parser, chunk split boundaries, bracket flush |
| Walkthroughs | `walkthrough.test.ts` | 1 | PASS | Tutorial step progression, target bounds, cancellation |
| Voice & Audio PCM | `wav.test.ts` | 2 | PASS | 48kHz -> 16kHz downsampling, RIFF WAV header encoding |

---

## 3. Mandatory Safety & Architecture Gates

1. **Renderer Isolation & Security**:
   - `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
   - IPC channels enforce sender origin verification (`fromWorkspace`, `fromOverlay`, `fromSettingsOrOverlay`).
   - Consequential tools (`desktop_click`, `desktop_type`, etc.) halt background jobs until explicit user approval in Workspace.

2. **Immediate User Takeover**:
   - Monitored 25ms physical mouse deviation loop.
   - Any physical mouse movement instantly aborts synthetic desktop actions.

3. **Storage & Durability**:
   - SQLite backed by native `node:sqlite` in Electron.
   - Cross-day memory retention with user deletion ("forget") controls.
   - Timezone-aware routines with missed-run wake recovery.

