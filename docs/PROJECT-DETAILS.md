# HeyGuy: Complete Project Overview, Architecture & Implementation Blueprint

> **For External AI & Human Engineers**: This document contains the full context, architecture, operational invariants, verification gates, and code contracts for **HeyGuy** — an open-source, Clicky-style desktop AI cursor companion and execution harness for Windows. Use this to immediately continue development, perform deep code reviews, or extend features without hallucinating assumptions.

---

## 1. Project Mission & Identity

HeyGuy is an AI desktop companion that lives adjacent to the user's mouse cursor on Windows.
1. **Perception**: Takes a single, non-continuous screenshot (`desktopCapturer`, $\le 1568\text{px}$ JPEG) only when requested via hotkey or voice.
2. **Expression**: Speaks via speech bubbles, reads text aloud with OS speech synthesis (`speechSynthesis`), and flies across the screen to point, circle, box, underline, or highlight coordinates on the exact GUI element discussed.
3. **Interactive Visual Engine**: Streams validated declarative visual scenes in 3 layers:
   - **Canvas 2D**: Screen markers (`[POINT:...]`, `[CIRCLE:...]`, `[BOX:...]`, `[ARROW:...]`, `[UNDERLINE:...]`).
   - **SVG / DOM Explanatory Diagrams**: Layered flows, radial, grid diagrams with automatic layout (`layout2d.ts`), zero coordinate guessing, and step walkthroughs.
   - **Interactive 3D (Three.js)**: 13 vetted geometric shapes (`box`, `sphere`, `cylinder`, `cone`, `torus`, `capsule`, `tube`, `ring`, `prism`, `wedge`, `ellipsoid`, `extrude`, `lathe`) with auto-mirroring across $x = 0$, raycast click-selection, explode view, and step highlights.
   - **Declarative Interactive UI (`SceneUI`)**: Safe DOM/SVG widgets (`metric`, `chart`, `slider`, `table`, `checklist`, `card`, `code`, `callout`) allowing interaction without `eval()`.
4. **Autonomous Agent Harness**: Backed by a SQLite job engine, scoped tool registry, draft connectors (RFC822 emails & markdown), native browser bridge, and Windows UI Automation takeover detection.
5. **Multi-Model Support**:
   - **Antigravity (`agy` CLI)**: Harnesses the user's signed-in Google account (`gemini-3.8-flash-high`, `gemini-4-argon`, `claude-opus-5-5`, etc.) with zero credential scraping.
   - **BYOK Providers**: Claude (`streamClaude`), Gemini (`streamGemini`), OpenAI (`streamOpenAI`), DeepSeek (`streamDeepSeek`).

---

## 2. Hard Architectural Rules & Non-Negotiable Decisions

Before writing or modifying any code, all agents must adhere to these decisions recorded in `docs/DECISIONS.md`:

- **D1: Visuals are Data, Never Code**: The model describes visuals using declarative `<scene>{json}</scene>` or `<scene-patch>{json}</scene-patch>` blocks. The application parses, sanitizes, and renders them. Arbitrary HTML/JS from the model is never `eval()`'d.
- **D2: Layout Ownership**: 2D diagrams carry no $(x, y)$ coordinates from the model. `layout2d.ts` determines placement to eliminate overlap. 3D scenes undergo automatic geometry linting (`scene3d-lint.ts`) and auto-normalization (`normalise3D`) to center and scale assemblies.
- **D3: Capture Timing**: For voice queries, screen capture occurs when the user **starts** speaking (presses hotkey), not after speech-to-text finishes, ensuring visual context matches user intent.
- **D4: Fail Closed on Secrets**: API keys are stored via Windows DPAPI (`safeStorage.encryptStringAsync`). If DPAPI is unavailable, keys remain in session RAM only and are never written as plaintext or Base64 to disk.
- **D5: Single Turn Ownership**: `TurnManager` enforces that starting turn $B$ instantly aborts turn $A$. Stale streaming events are dropped in main and overlay.
- **D6: Primitives-First 3D**: No arbitrary Blender scripts or Python execution in the application. Parts use 13 vetted geometric primitives.
- **D7: Native SQLite**: Backed by Node 24's built-in `node:sqlite` inside Electron (`userData/heyguy.db`). Zero native compilation toolchain needed.
- **D8: Sandboxed Renderers**: Every BrowserWindow (`overlay`, `workspace`, `settings`) runs with `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. All IPC passes through preloads with sender checks (`fromWorkspace`, `fromOverlay`, `fromSettingsOrOverlay`).
- **D9: Sanctioned Account Auth**: HeyGuy never scrapes Google session tokens. It executes `openAgyInteractive` to open an interactive terminal where `agy` manages its own authentication.

---

## 3. Directory Layout & Key Modules

```
heyguy/
├── docs/
│   ├── FULL-PRODUCT-PLAN.md      # Master vision, milestones M0-M8
│   ├── REFERENCE-AND-GAPS.md     # Feature IDs F01-F27 vs HeyClicky
│   ├── DECISIONS.md              # Architectural decisions (D1-D13)
│   ├── BUILD-STATE.md            # Live implementation ledger & verified gates
│   └── TEST-REPORT.md            # Execution pass rates and benchmarks
├── src/
│   ├── main/
│   │   ├── main.ts               # Electron composition root, window lifecycles, IPC routing
│   │   ├── capture.ts            # Desktop capture, DPI transforms, multi-monitor bounds
│   │   ├── settings.ts           # DPAPI encrypted storage & defaults
│   │   ├── turns.ts              # TurnManager, turn abort controllers, sequence IDs
│   │   ├── ai/
│   │   │   ├── antigravity.ts    # agy CLI stream runner, session caching, usage telemetry
│   │   │   ├── anthropic.ts      # Claude Messages API SSE vision streaming
│   │   │   ├── gemini.ts         # Gemini REST SSE streaming & STT audio transcription
│   │   │   ├── openai.ts         # OpenAI chat completions vision streaming
│   │   │   ├── deepseek.ts       # DeepSeek streaming & reasoning_content filtering
│   │   │   ├── image-gen.ts      # OpenAI gpt-image-1 & SVG synthesizer fallback
│   │   │   └── prompt.ts         # System prompts, coordinate contracts, user preambles
│   │   ├── storage/db.ts         # node:sqlite sessions, messages, scenes, memories, routines
│   │   ├── tools/                # ToolRegistry, host permission gating (read-only vs consequential)
│   │   ├── jobs/engine.ts        # Durable state machine for multi-step agent jobs
│   │   ├── memory/store.ts       # Cross-day fact/preference store & prompt injection
│   │   ├── scheduler/engine.ts   # Timezone-aware interval/daily/cron scheduler
│   │   └── control/windows.ts    # Windows UI Automation inspection & 25ms mouse takeover abort
│   ├── preload/
│   │   ├── overlay.ts            # Sandboxed bridge for transparent cursor overlay
│   │   ├── workspace.ts          # Sandboxed bridge for Workspace Studio
│   │   └── settings.ts           # Sandboxed bridge for Settings UI
│   ├── renderer/
│   │   ├── overlay/              # Transparent overlay: character, marks, speech bubble, 2D/3D panels
│   │   │   ├── buddy.ts          # Canvas 2D animated cursor character
│   │   │   ├── annotations.ts    # Screen marks (point, circle, box, arrow, underline)
│   │   │   ├── bubble.ts         # Speech bubble with drag & markdown formatting
│   │   │   ├── tts.ts            # Speech synthesis speaker with sentence boundary sync
│   │   │   ├── scene2d.ts        # SVG diagram renderer
│   │   │   ├── scene3d.ts        # Three.js interactive 3D renderer
│   │   │   └── scene-ui.ts       # Declarative SceneUI widget renderer
│   │   ├── workspace/            # Workspace Studio: History, Jobs, Artifacts, Routines, Memory
│   │   └── settings/             # Settings UI: Provider selection, hotkeys, models, auth
│   └── shared/
│       ├── types.ts              # Protocol envelopes, scene schemas, widget definitions
│       ├── scene.ts              # Validators, clamping, repair salvage, scene-patch engine
│       ├── scene3d-lint.ts       # 3D bounding-box collisions, floating component detection
│       ├── layout2d.ts           # Deterministic graph layout (layered, radial, grid)
│       ├── tags.ts               # Streaming incremental tag parser for screen marks
│       └── hotkeys.ts            # Windows accelerator normalization & conflict checks
└── test/                         # node:test unit & integration suites (88/88 passing)
```

---

## 4. Visual Scene Specification Contract

When the AI model outputs `<scene>{json}</scene>`, it adheres to one of three schemas:

### Layer A: 2D Diagram (`kind: '2d'`)
```json
{
  "kind": "2d",
  "id": "transformer-flow",
  "title": "Transformer Attention Flow",
  "layout": "flow-right",
  "nodes": [
    { "id": "input", "label": "Token Input", "detail": "Raw text embeddings", "shape": "box", "tone": "default" },
    { "id": "qkv", "label": "Q, K, V Projections", "detail": "Linear transformation", "shape": "diamond", "tone": "accent" }
  ],
  "edges": [
    { "from": "input", "to": "qkv", "label": "Embeddings", "animated": true }
  ],
  "steps": [
    { "caption": "Tokens are converted into Query, Key, and Value vectors.", "focus": ["input", "qkv"] }
  ]
}
```

### Layer B: 3D Assembly (`kind: '3d'`)
```json
{
  "kind": "3d",
  "id": "f22-raptor",
  "title": "F-22 Raptor Airframe",
  "parts": [
    { "id": "fuselage", "label": "Fuselage", "detail": "Main radar-absorbent body", "shape": "ellipsoid", "size": [0.8, 0.4, 4.2], "position": [0, 0, 0], "rotation": [0, 0, 0], "color": "#475569", "opacity": 1.0 },
    { "id": "wing", "label": "Diamond Wing", "detail": "Swept leading edge", "shape": "extrude", "points": [[0.5, 0.5], [2.8, -0.6], [2.2, -1.6], [0.5, -1.2]], "size": [0.06], "position": [0.4, 0, 0], "rotation": [0, 0, 0], "color": "#334155", "opacity": 1.0, "mirror": "x" }
  ],
  "animations": [
    { "part": "fuselage", "kind": "swing", "axis": "y", "amount": 10, "speed": 0.5, "phase": 0 }
  ],
  "steps": [
    { "caption": "The diamond wings provide stealth and supercruise lift.", "focus": ["wing"] }
  ]
}
```
*Note: Declaring `"mirror": "x"` automatically duplicates the part reflected across $x = 0$, negating $y$ and $z$ rotations and handling mirrored animations automatically.*

### Layer C: Declarative Interactive UI (`kind: 'ui'`)
```json
{
  "kind": "ui",
  "id": "inference-metrics",
  "title": "Inference Latency Monitor",
  "layout": "dashboard",
  "widgets": [
    { "id": "w1", "kind": "metric", "label": "Latency", "value": "12.4 ms", "delta": "-8%", "trend": "up", "tone": "good", "span": 1 },
    { "id": "w2", "kind": "chart", "label": "Token Throughput", "chartType": "bar", "data": [{ "label": "Prompt", "value": 120 }, { "label": "Gen", "value": 85 }], "tone": "accent", "span": 2 },
    { "id": "w3", "kind": "slider", "label": "Concurrency", "min": 1, "max": 64, "initial": 16, "unit": "threads", "span": 1 }
  ]
}
```

---

## 5. Verification Commands & Health Checklist

To run tests and compile bundles:

```bash
# 1. Full check (TypeScript typecheck + 88 automated unit tests + esbuild production bundles)
npm run check

# 2. Start live desktop companion
npm start

# 3. Test interactive demos without needing any cloud API keys
npm run demo            # Pointer & speech bubble demo
npm run demo:diagram    # 2D diagram demo (Transformer flow)
npm run demo:3d         # 3D interactive model demo (Rotatable engine)
npm run demo:ui         # Declarative interactive UI demo (Dashboard)
```

---

## 6. Current Verified State

- **TypeScript Compilation**: `tsc -p tsconfig.json --noEmit` exits with **0 errors**.
- **Test Suite**: **88 passing tests, 0 failures** across all modules.
- **Production Bundles**: All bundles (`dist/main/main.js`, preloads, and renderers) compile via `scripts/build.mjs`.

