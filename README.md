# HeyGuy

A Clicky-style AI buddy for Windows. A little blue cursor character lives next to your mouse. Press a hotkey and ask out loud (or type). It takes **one** screenshot, answers in a speech bubble, reads the answer aloud, and **flies over to point at, circle, box, underline or draw arrows** on the exact thing it's talking about.

Ask it *how something works* and it also **draws an interactive explanation** in a panel: a 2D diagram with animated flow, or a 3D model you can rotate, explode and click. Click any box or part and your next question is about that exact thing.

Built with Electron + TypeScript, using Canvas 2D for the buddy and marks, SVG for diagrams, and Three.js for 3D. No UI framework, no SDKs: every part of the pipeline is in this repo, so you can learn from it and change it.

## Run it (Windows)

1. Install **Node.js 22 or newer** from nodejs.org.
2. In this folder:
   ```
   npm install
   npm run demo
   ```
   `demo` plays a scripted answer, so you can see the buddy point and draw before you add any API key. `npm run demo:diagram` and `npm run demo:3d` show the explanation panel (an animated transformer diagram, and a 3D engine you can rotate and click).
3. Real use: `npm start`, then open **Settings** from the tray icon (bottom-right, near the clock) and paste a key:
   - **Gemini key** (free tier works, from aistudio.google.com). It powers voice input and can also be the brain.
   - **Claude key** (console.anthropic.com), optional. Pick "Claude" as the brain if you add one.
4. Build an installer: `npm run dist`. The installer goes in `release/`.

## Hotkeys

| Keys | What it does |
|---|---|
| `Ctrl+Shift+Space` | Talk. Speak, and it sends when you pause (or press again to send now). |
| `Ctrl+Shift+Y` | Explain my screen ("why?"). Use this for errors. |
| `Ctrl+Shift+U` | Type a question. |
| `Ctrl+Shift+Backspace` | Dismiss / stop talking. |

To change any of them, open Settings → Hotkeys, click a shortcut and press the new keys. If another app already owns a combination, HeyGuy marks it **taken** in Settings and the tray menu. The defaults avoid Ctrl+Alt because HeyClicky (and AltGr on many keyboard layouts) grabs those.

You can also drag the bubble by its header. Once dragged, it stays where you put it.

## How it works

```
 hotkey ──► main process ──► overlay hides itself ──► desktopCapturer (1 frame, ≤1568px JPEG)
               │                                              │
   mic (AudioWorklet → 16 kHz WAV) ──► Gemini speech-to-text  │
               │                                              ▼
               └──────────► Claude / Gemini vision, streamed over SSE
                                              │
                    TagStream pulls [POINT:x,y:label] etc. out of the text
                                              │
              screenshot px ──► overlay px (shared/geometry.ts)
                                              │
 overlay renderer: bubble streams the text · Speaker reads sentences aloud ·
 buddy flies along a curve to each target · AnnotationLayer draws marker-style strokes
```

- **Overlay**: one transparent, always-on-top, click-through window that covers the screen. Mouse events pass through to your apps, except over the bubble (`setIgnoreMouseEvents` with `forward: true`). It moves to whichever monitor your mouse is on.
- **Pointing**: the system prompt (`src/main/ai/prompt.ts`) tells the model the screenshot's exact size and your cursor position. It then embeds tags such as `[CIRCLE:812,344,30:error icon]` in its reply. The tags are removed from the visible and spoken text and turned into drawings.
- **Voice out**: Windows' built-in voices through `speechSynthesis`. This is free, works offline, and starts speaking as each sentence arrives.
- **Privacy**: the screen is captured only when you press a hotkey. Screenshots are never written to disk. API keys are encrypted with `safeStorage` (Windows DPAPI).

## Diagrams and 3D

When a question calls for a picture, the model adds a `<scene>{…}</scene>` JSON block at the end of its reply. The block is never shown or spoken. It is validated by `src/shared/scene.ts`: unknown fields are dropped, sizes clamped and bad references removed. Then our own renderers draw it. The model never sends code.

- **2D** (`scene2d.ts`): nodes and links only. Positions come from `layout2d.ts` (layered flow, radial or grid), so nothing overlaps. There are animated flow dots, pan/zoom, and steps that walk through it.
- **3D** (`scene3d.ts`): parts built from box/sphere/cylinder/cone/torus/capsule. You get orbit, explode, labels and spin/slide/swing animation. Clicking a part uses raycasting to identify it.
- Selecting an item adds it to your next question. Asking a follow-up such as "make the piston red" re-sends the scene with the same id, and it updates in place.

## Project layout

```
src/
  main/            Electron main process
    main.ts          windows, tray, hotkeys, request pipeline, demo
    capture.ts       one-shot screenshot of a display
    settings.ts      settings + encrypted keys
    ai/              anthropic.ts, gemini.ts (REST + SSE), prompt.ts, sse.ts, http.ts
  preload/         contextBridge APIs (sandboxed)
  renderer/overlay buddy.ts (character), annotations.ts (drawing), bubble.ts,
                   voice.ts (mic + VAD + WAV), tts.ts, overlay.ts (state machine)
  renderer/settings settings window
  shared/          tags.ts (streaming tag parser), geometry.ts, sentences.ts, types.ts
test/              node:test unit tests (parser, geometry, SSE, WAV, providers)
```

## Developing

```
npm run check     # typecheck + unit tests + build + build (run this before every commit)
npm run demo      # see it without API keys
```

To change the character, edit `Buddy.draw()` in `src/renderer/overlay/buddy.ts`. Everything is plain Canvas 2D. To add a new kind of drawing, add a tag to `shared/tags.ts` and the prompt, then add a path builder in `annotations.ts`.

## Troubleshooting

- **Hotkey does nothing, or another app opens instead**: another app owns that combination. Change it in Settings → Hotkeys. The tray menu always works.
- **"Microphone is blocked"**: go to Windows Settings → Privacy & security → Microphone and turn on *Let desktop apps access your microphone*.
- **The pointer lands a bit off**: vision models are good at pointing but not perfect. Claude is usually more precise than Flash models. Larger UI scaling also helps.
- **Model not found**: model names change. Update them in Settings, for example `claude-sonnet-5-5`, `claude-haiku-5-5`, `gemini-3.8-flash`, or `gemini-flash-latest`.

## Roadmap ideas

- Streaming speech-to-text for instant transcripts (Gemini Live / AssemblyAI).
- Nicer voices (Gemini TTS / ElevenLabs), with the buddy's mouth synced to the audio.
- A small Cloudflare Worker proxy so the shipped app doesn't need users' keys. This is how Clicky does it.
- Multi-step "show me how" walkthroughs that wait for the user to click each step.
- See `docs/FULL-PRODUCT-PLAN.md` (full roadmap) and `docs/BUILD-STATE.md` (what's verified).
- Agent mode (it clicks for you), behind an explicit confirmation for every action.

Inspired by [Clicky](https://github.com/farzaa/clicky) (MIT) by Farza.
