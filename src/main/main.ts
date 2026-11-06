// HeyGuy main process: transparent overlay window, tray, global hotkeys,
// one-shot screen capture, turn ownership, and the AI request pipeline
// (text + screen marks + validated 2D/3D scenes).
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  Tray,
  type Display,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SettingsStore } from './settings';
import { HOTKEY_COMMANDS, prettyAccelerator, validateAccelerator } from '../shared/hotkeys';
import { captureDisplay, type Screenshot } from './capture';
import { TurnManager, type Turn } from './turns';
import { SceneBlockStream, stripSceneBlocks } from '../shared/blocks';
import { parseSceneJSON, parseScenePatchJSON, applyScenePatch, sceneForPrompt, type Scene } from '../shared/scene';
import { lint3D, normalise3D, formatLint, type Lint3DReport } from '../shared/scene3d-lint';
import { DEMO_DIAGRAM, DEMO_ENGINE, DEMO_UI, DEMO_F22 } from './demo-scenes';
import { streamClaude, pingClaude } from './ai/anthropic';
import { streamGemini, transcribeGemini, pingGemini } from './ai/gemini';
import { streamOpenAI, pingOpenAI } from './ai/openai';
import { streamDeepSeek, pingDeepSeek } from './ai/deepseek';
import {
  streamAntigravity,
  pingAntigravity,
  antigravityUsage,
  runHeadlessCodeGen,
  openAgySignIn,
  openAgyInteractive,
  resolveAgyBinary,
  warmAntigravity,
  resetAntigravitySession,
  runAgyCommand,
  normalizeAntigravityModel,
} from './ai/antigravity';
import { generateImage } from './ai/image-gen';
import { DatabaseStore } from './storage/db';
import { ToolRegistry } from './tools/registry';
import { JobEngine } from './jobs/engine';
import { DraftConnector } from './connectors/drafts';
import { WindowsController } from './control/windows';
import { BrowserBridge } from './browser/bridge';
import { WalkthroughObserver } from './walkthroughs/observer';
import { registerBuiltinTools } from './tools/builtins';
import { MemoryStore } from './memory/store';
import { SchedulerEngine } from './scheduler/engine';
import { AssistantProfileManager } from './assistants/profiles';
import { NotificationDispatcher } from './notifications/dispatcher';
import { systemPrompt, userPreamble } from './ai/prompt';
import { TagStream, stripTags } from '../shared/tags';
import { mapAnnotation } from '../shared/geometry';
import {
  IPC,
  type Annotation,
  type AskRequest,
  type AudioRequest,
  type ChatTurn,
  type CompanionEvent,
  type Envelope,
  type JobRecord,
  type MemoryCategory,
  type RoutineRecord,
  type SceneSelection,
  type SessionSummary,
  type SpatialSelection,
  type WalkthroughStep,
  PROTOCOL_VERSION,
  type HotkeyCommand,
  type HotkeyStatus,
  type Provider,
  type SettingsUpdate,
  type NotchState,
  type NotchAction,
  type BrainStatus,
} from '../shared/types';

const DIST = path.join(__dirname, '..');
const ASSETS = path.join(app.getAppPath(), 'assets');
const HISTORY_TURNS = 8;
const REQUEST_TIMEOUT_MS = 90_000;
/** Keep the overlay on its display this long after a reply so drawings stay aligned. */
const STAY_AFTER_REPLY_MS = 20_000;

let db: DatabaseStore;
let activeSession: SessionSummary;
let settings: SettingsStore;
const tools = new ToolRegistry();
const windows = new WindowsController();
const browser = new BrowserBridge();
let drafts: DraftConnector;
let jobs: JobEngine;
let memory: MemoryStore;
let scheduler: SchedulerEngine;
let assistants: AssistantProfileManager;
let notifications: NotificationDispatcher;
const walkthroughs = new WalkthroughObserver();
let overlay: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let workspaceWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let overlayDisplay: Display;
const turns = new TurnManager();
let history: ChatTurn[] = [];
/** the scene currently on screen, given to the model so follow-ups can edit it */
let lastScene: Scene | null = null;
/** voice turn in progress: started (and screen captured) when the user began talking */
let pendingTalk: { turn: Turn; shot: Promise<Screenshot>; at: number } | null = null;
let lockedUntil = 0;
let lastCursor = { x: -1, y: -1 };

// ---------------------------------------------------------------- overlay

/** Send an event to the overlay. Events from a turn that is no longer current are dropped. */
function send(event: CompanionEvent, turn?: Turn): void {
  if (turn && !turns.isCurrent(turn)) return;
  const env: Envelope = { v: PROTOCOL_VERSION, turn: turn?.id ?? 0, seq: turn ? turn.seq++ : 0, event };
  overlay?.webContents.send(IPC.event, env);
}

function createOverlay(): void {
  overlayDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const b = overlayDisplay.bounds;
  overlay = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    title: 'HeyGuy',
    webPreferences: {
      preload: path.join(DIST, 'preload', 'overlay.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  // The fixture harness loads ?still=1 so 3D rendering is deterministic (no auto-rotate, t frozen at 0).
  const fixtureQuery = process.env.HEYGUY_FIXTURES ? { query: { still: '1' } } : undefined;
  overlay.loadFile(path.join(DIST, 'renderer', 'overlay', 'index.html'), fixtureQuery);
  overlay.once('ready-to-show', () => overlay?.showInactive());
  overlay.on('closed', () => {
    overlay = null;
  });
}

function moveOverlayTo(d: Display): void {
  if (!overlay) return;
  overlayDisplay = d;
  overlay.setBounds(d.bounds);
}

function pollCursor(): void {
  if (!overlay || !overlay.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  if (p.x === lastCursor.x && p.y === lastCursor.y) return;
  lastCursor = p;
  const d = screen.getDisplayNearestPoint(p);
  if (d.id !== overlayDisplay.id && Date.now() > lockedUntil) moveOverlayTo(d);
  const b = overlayDisplay.bounds;
  overlay.webContents.send(IPC.cursor, { x: p.x - b.x, y: p.y - b.y, width: b.width, height: b.height });
}

/** Ask the overlay to hide itself so it doesn't appear in the screenshot. */
function hideOverlayForCapture(): Promise<void> {
  return new Promise((resolve) => {
    if (!overlay) return resolve();
    const timer = setTimeout(done, 300);
    function done() {
      clearTimeout(timer);
      ipcMain.removeListener(IPC.hiddenForCapture, done);
      // one more frame for the compositor to drop the old pixels
      setTimeout(resolve, 40);
    }
    ipcMain.once(IPC.hiddenForCapture, done);
    overlay.webContents.send(IPC.hideForCapture);
  });
}

// ---------------------------------------------------------------- AI pipeline

function providerStream(provider: Provider, req: Parameters<typeof streamClaude>[1]) {
  if (provider === 'antigravity') {
    return streamAntigravity(
      {
        accountEmail: settings.raw.googleAccountEmail,
        model: settings.raw.antigravityModel,
        geminiKeyFallback: settings.geminiKey(),
        geminiModel: settings.raw.geminiModel,
      },
      req,
    );
  }
  if (provider === 'anthropic') {
    return streamClaude({ apiKey: settings.anthropicKey(), model: settings.raw.anthropicModel }, req);
  }
  if (provider === 'gemini') {
    return streamGemini({ apiKey: settings.geminiKey(), model: settings.raw.geminiModel }, req);
  }
  if (provider === 'deepseek') {
    return streamDeepSeek({ apiKey: settings.deepseekKey(), model: settings.raw.deepseekModel }, req);
  }
  return streamOpenAI({ apiKey: settings.openaiKey(), model: settings.raw.openaiModel }, req);
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

function beginTurn(): Turn {
  pendingTalk = null;
  const turn = turns.begin();
  lockedUntil = Number.POSITIVE_INFINITY;
  return turn;
}

/** Only the turn that still owns the companion may release the display lock. */
function endTurn(turn: Turn): void {
  if (turns.end(turn)) lockedUntil = Date.now() + STAY_AFTER_REPLY_MS;
}

/** Hide the overlay, grab one frame of the display under the cursor, show the overlay again. */
async function captureNow(): Promise<Screenshot> {
  const display = overlayDisplay;
  await hideOverlayForCapture();
  try {
    return await captureDisplay(display, screen.getAllDisplays().length);
  } finally {
    overlay?.webContents.send(IPC.showAfterCapture);
  }
}

/** Keep drawings on the display the screenshot came from. */
function ensureOverlayOn(displayId: number): void {
  if (overlayDisplay.id === displayId) return;
  const d = screen.getAllDisplays().find((x) => x.id === displayId);
  if (d) moveOverlayTo(d);
}

/**
 * Quality pass for every validated scene before it is shown: 3D assemblies are re-centred / re-scaled
 * when needed and linted (floating, duplicate, degenerate, tiny parts). Lint findings are reported as
 * warnings; they never block the drawing.
 */
function qualityPass(scene: Scene, warnings: string[]): { scene: Scene; warnings: string[]; lint: Lint3DReport | null } {
  if (scene.kind !== '3d') return { scene, warnings, lint: null };
  const fixed = normalise3D(scene);
  const lint = lint3D(fixed);
  const lines = formatLint(lint);
  if (lines.length) console.warn('[scene]', lines.join('; '));
  return { scene: fixed, warnings: [...warnings, ...lines], lint };
}

function handleSceneBlock(turn: Turn, json: string): void {
  if (lastScene && json.includes('patch')) {
    const patchRes = parseScenePatchJSON(json);
    if (patchRes.ok) {
      const q = qualityPass(applyScenePatch(lastScene, patchRes.patch), patchRes.warnings);
      lastScene = q.scene;
      if (activeSession && db) db.saveScene(activeSession.id, turn.id, q.scene);
      send({ type: 'scene', scene: q.scene, warnings: q.warnings }, turn);
      return;
    }
  }

  const r = parseSceneJSON(json);
  if (r.ok) {
    const q = qualityPass(r.scene, r.warnings);
    lastScene = q.scene;
    if (activeSession && db) db.saveScene(activeSession.id, turn.id, q.scene);
    if (r.warnings.length) console.warn('[scene]', r.warnings.join('; '));
    send({ type: 'scene', scene: q.scene, warnings: q.warnings }, turn);
  } else {
    console.warn('[scene] rejected:', r.errors.join('; '));
    send({ type: 'scene-error', message: `I tried to draw that but the drawing came out broken (${r.errors[0]}). Ask again?` }, turn);
  }
}

/** Requests that clearly want a picture, diagram or model. */
const WANTS_VISUAL = /\b(draw|sketch|diagram|visuali[sz]e|3d|3-d|model of|render|illustrate|show me (how|what)|build me a (model|diagram))\b/i;

/** Keep the last few raw model replies on disk so "it drew nothing" can be diagnosed. */
function logReply(question: string, raw: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'last-replies.txt');
    let prev = '';
    try {
      prev = readFileSync(file, 'utf8');
    } catch {
      prev = '';
    }
    const entry = `===== ${new Date().toISOString()}\nQ: ${question}\n${raw}\n`;
    writeFileSync(file, (entry + prev).slice(0, 200_000), 'utf8');
  } catch (err) {
    console.warn('[log] could not write reply log', err);
  }
}

/** Second, scene-only request. Returns true if a scene was shown. */
async function sceneOnlyPass(provider: Provider, turn: Turn, question: string, signal: AbortSignal): Promise<boolean> {
  send({ type: 'scene-drawing' }, turn);
  let raw = '';
  try {
    for await (const delta of providerStream(provider, {
      system: systemPrompt(),
      history,
      imageJpegBase64: '',
      prompt: `Output ONLY one <scene>{...}</scene> block (valid JSON, no other text, no code fence) that visually answers: "${question.trim()}". Prefer a 3D model for physical objects and a 2D diagram for processes and ideas.`,
      signal,
    })) {
      if (!turns.isCurrent(turn)) return false;
      raw += delta;
    }
  } catch (err) {
    if (!turns.isCurrent(turn)) return false;
    send({ type: 'scene-error', message: `I couldn't draw that (${err instanceof Error ? err.message : String(err)}).` }, turn);
    return false;
  }
  logReply(`[scene pass] ${question}`, raw);
  const parts = new SceneBlockStream();
  const chunk = parts.push(raw);
  const end = parts.flush();
  const json = chunk.blocks[0] ?? end.unterminated ?? extractBareJSON(raw);
  if (!json) {
    send({ type: 'scene-error', message: 'The model answered but sent no drawing. Try asking again, or pick a stronger model in Settings.' }, turn);
    return false;
  }
  handleSceneBlock(turn, json);
  return true;
}

/** Some models drop the <scene> tags and return bare (or fenced) JSON. */
function extractBareJSON(raw: string): string | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start !== -1 && end > start ? raw.slice(start, end + 1) : null;
}

interface AskOptions {
  selection?: SceneSelection | null;
  spatialSelection?: SpatialSelection | null;
  /** turn already started (voice flow) */
  turn?: Turn;
  /** screenshot captured earlier, at the moment the user started talking */
  shot?: Promise<Screenshot> | null;
}

async function ask(question: string, opts: AskOptions = {}): Promise<void> {
  const provider = settings.activeProvider();
  if (!provider) {
    send({ type: 'error', message: 'Add a Claude, Gemini, or OpenAI API key in Settings first (tray icon → Settings).' });
    openSettings();
    return;
  }
  const turn = opts.turn && turns.isCurrent(opts.turn) ? opts.turn : beginTurn();
  const signal = AbortSignal.any([turn.controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  try {
    send({ type: 'state', state: 'thinking', detail: 'Looking at your screen…' }, turn);
    const shot = (await opts.shot) ?? (await captureNow());
    if (!turns.isCurrent(turn)) return;
    ensureOverlayOn(shot.info.displayId);

    const b = shot.info.bounds;
    const cur = screen.getCursorScreenPoint();
    const k = shot.size.width / b.width;
    const pixelSpatial = opts.spatialSelection ? {
      x: opts.spatialSelection.bounds.x * k,
      y: opts.spatialSelection.bounds.y * k,
      width: opts.spatialSelection.bounds.width * k,
      height: opts.spatialSelection.bounds.height * k,
    } : null;
    const prompt = userPreamble(
      { imageWidth: shot.size.width, imageHeight: shot.size.height, cursorX: (cur.x - b.x) * k, cursorY: (cur.y - b.y) * k },
      question,
      { scene: lastScene ? sceneForPrompt(lastScene) : null, selection: opts.selection ?? null, spatialSelection: pixelSpatial },
    );
    const overlaySize = { width: b.width, height: b.height };
    const blocks = new SceneBlockStream();
    const tags = new TagStream();
    let raw = '';
    let started = false;
    let drawingNoticed = false;
    const emitText = (text: string) => {
      const chunk = tags.push(text);
      if (chunk.text) send({ type: 'reply-delta', text: chunk.text }, turn);
      for (const t of chunk.tags) {
        const annotation: Annotation = mapAnnotation(t, shot.size, overlaySize);
        send({ type: 'annotation', annotation }, turn);
      }
    };

    const activeAssistant = assistants?.getActive();
    const assistantPrompt = activeAssistant ? `${activeAssistant.systemPrompt}\n\n` : '';
    const memContext = memory ? memory.formatContextForPrompt(question) : '';

    for await (const delta of providerStream(provider, {
      system: `${assistantPrompt}${systemPrompt()}${memContext}`,
      history,
      imageJpegBase64: shot.jpegBase64,
      prompt,
      signal,
    })) {
      if (!turns.isCurrent(turn)) return;
      if (!started) {
        started = true;
        send({ type: 'reply-start' }, turn);
      }
      raw += delta;
      const part = blocks.push(delta);
      if (part.text) emitText(part.text);
      for (const json of part.blocks) handleSceneBlock(turn, json);
      if (part.inBlock && !drawingNoticed) {
        drawingNoticed = true;
        send({ type: 'scene-drawing' }, turn);
      }
    }
    const end = blocks.flush();
    if (end.text) emitText(end.text);
    if (end.unterminated !== null) handleSceneBlock(turn, end.unterminated);
    const rest = tags.flush();
    if (rest.text) send({ type: 'reply-delta', text: rest.text }, turn);
    if (!started) send({ type: 'reply-start' }, turn);
    const clean = stripTags(stripSceneBlocks(raw));
    send({ type: 'reply-done', fullText: clean || "Hmm, I didn't get an answer back. Try again?" }, turn);
    logReply(question, raw);
    pushNotch();
    // Asked for a drawing but the model only talked: one focused follow-up that must return the scene.
    if (!drawingNoticed && WANTS_VISUAL.test(question) && turns.isCurrent(turn)) {
      drawingNoticed = await sceneOnlyPass(provider, turn, question, signal);
    }
    const sceneNote = drawingNoticed && lastScene ? ` [showed scene "${lastScene.title}" (id ${lastScene.id})]` : '';
    const asked = question.trim() || 'Explain my screen.';
    const selected = opts.selection ? ` (about "${opts.selection.label}" selected in "${opts.selection.sceneTitle}")` : '';
    const userPromptText = asked + selected;
    if (activeSession && db) {
      db.addMessage(activeSession.id, turn.id, 'user', userPromptText, asked, false);
      db.addMessage(activeSession.id, turn.id, 'assistant', clean + sceneNote, clean, drawingNoticed && !!lastScene);
      history = db.getRecentTurns(activeSession.id, HISTORY_TURNS);
      if (memory) memory.extractFromConversation(userPromptText, `turn:${turn.id}`);
    } else {
      history.push({ role: 'user', text: userPromptText }, { role: 'assistant', text: clean + sceneNote });
      history = history.slice(-HISTORY_TURNS);
    }
  } catch (err) {
    if (!turns.isCurrent(turn)) return;
    console.error('[ask]', err);
    const message = isAbort(err) ? 'That took too long — try again.' : err instanceof Error ? err.message : String(err);
    send({ type: 'error', message }, turn);
  } finally {
    endTurn(turn);
  }
}

/**
 * The user pressed the talk key: start the turn and capture the screen NOW,
 * so the answer is about what they were looking at when they started speaking.
 */
function onListeningStarted(): void {
  if (!settings.activeProvider()) return;
  const turn = beginTurn();
  const shot = captureNow();
  shot.catch(() => undefined); // reported when the audio arrives
  pendingTalk = { turn, shot, at: Date.now() };
}

async function handleAudio(wav: Uint8Array, selection: SceneSelection | null, spatialSelection?: SpatialSelection | null): Promise<void> {
  const talk = pendingTalk && turns.isCurrent(pendingTalk.turn) && Date.now() - pendingTalk.at < 120_000 ? pendingTalk : null;
  pendingTalk = null;
  const apiKey = settings.geminiKey();
  if (!apiKey) {
    if (talk) turns.cancel();
    send({
      type: 'error',
      message: `Voice input uses a Gemini key (free tier works). Add one in Settings — or press ${key('type')} to type instead.`,
    });
    return;
  }
  const turn = talk?.turn ?? beginTurn();
  const signal = AbortSignal.any([turn.controller.signal, AbortSignal.timeout(30_000)]);
  let text = '';
  try {
    send({ type: 'state', state: 'transcribing', detail: 'Got it…' }, turn);
    text = await transcribeGemini({ apiKey, model: settings.raw.geminiModel }, wav, signal);
  } catch (err) {
    if (!turns.isCurrent(turn)) return;
    console.error('[transcribe]', err);
    send({ type: 'error', message: isAbort(err) ? 'Transcription timed out.' : err instanceof Error ? err.message : String(err) }, turn);
    endTurn(turn);
    return;
  }
  if (!turns.isCurrent(turn)) return;
  if (!text) {
    send({ type: 'notice', message: "I didn't catch that — try again?" }, turn);
    endTurn(turn);
    return;
  }
  send({ type: 'user-text', text }, turn);
  await ask(text, { turn, selection, spatialSelection, shot: talk?.shot ?? null });
}

function cancel(): void {
  pendingTalk = null;
  turns.cancel();
  lockedUntil = 0;
}

// ---------------------------------------------------------------- demo (no API key needed)

type DemoKind = 'pointing' | 'diagram' | '3d' | 'ui' | 'jet';

function demoScript(kind: DemoKind, W: number, H: number): { question: string; parts: (string | Annotation | { scene: string })[] } {
  if (kind === 'ui') {
    return {
      question: 'Build an interactive AI inference & latency harness dashboard.',
      parts: [
        'Here is a live interactive UI harness comparing model latency, context token economics, and active system checks. ',
        'Try dragging the context slider, sorting the model table, or clicking any metric card to ask about it.',
        { scene: JSON.stringify(DEMO_UI) },
      ],
    };
  }
  if (kind === 'jet') {
    return {
      question: 'Draw an F-22 Raptor jet in 3D.',
      parts: [
        'Here is an F-22 Raptor. Almost every line on it is there to hide it from radar: ',
        'flat edged body, diamond wings, and twin tails that lean outward. ',
        'Drag to spin it, hit Explode to pull it apart, and click any part to ask about it.',
        { scene: JSON.stringify(DEMO_F22) },
      ],
    };
  }
  if (kind === 'diagram') {
    return {
      question: 'How does a transformer work?',
      parts: [
        'A transformer turns your words into tokens, ',
        'lets every token look at every other token with attention, ',
        'then predicts the next word. Click any box to ask about it.',
        { scene: JSON.stringify(DEMO_DIAGRAM) },
      ],
    };
  }
  if (kind === '3d') {
    return {
      question: 'Show me how an engine piston works in 3D.',
      parts: [
        'Here is a single-cylinder engine. The piston slides up and down, ',
        'the connecting rod turns that into rotation of the crankshaft. ',
        'Drag to rotate it, and click any part to ask about it.',
        { scene: JSON.stringify(DEMO_ENGINE) },
      ],
    };
  }
  return {
    question: 'What can you do?',
    parts: [
      "Hey! I'm HeyGuy. ",
      `Press ${key('talk')} and just ask me about anything on your screen. `,
      "I'll point right at it, like this button",
      { kind: 'point', at: { x: W * 0.78, y: H * 0.18 }, label: 'this button' },
      '. I can circle little things',
      { kind: 'circle', center: { x: W * 0.3, y: H * 0.3 }, radius: 46, label: 'an icon' },
      ', box a whole panel',
      { kind: 'box', from: { x: W * 0.12, y: H * 0.55 }, to: { x: W * 0.46, y: H * 0.82 }, label: 'a panel' },
      ', underline the error line',
      { kind: 'underline', from: { x: W * 0.55, y: H * 0.62 }, to: { x: W * 0.86, y: H * 0.62 }, label: 'the error' },
      ', and show you where to drag',
      { kind: 'arrow', from: { x: W * 0.58, y: H * 0.78 }, to: { x: W * 0.84, y: H * 0.86 }, label: 'drag here' },
      '. I can also draw diagrams and 3D models — try the other demos in the tray menu!',
    ],
  };
}

async function runDemo(kind: DemoKind = 'pointing'): Promise<void> {
  const turn = beginTurn();
  const signal = turn.controller.signal;
  const b = overlayDisplay.bounds;
  const wait = (ms: number) =>
    new Promise<void>((r, j) => {
      const t = setTimeout(r, ms);
      signal.addEventListener('abort', () => (clearTimeout(t), j(new DOMException('Aborted', 'AbortError'))), { once: true });
    });
  const { question, parts } = demoScript(kind, b.width, b.height);
  try {
    send({ type: 'user-text', text: question }, turn);
    send({ type: 'state', state: 'thinking', detail: 'Looking at your screen…' }, turn);
    await wait(1000);
    send({ type: 'reply-start' }, turn);
    let full = '';
    for (const part of parts) {
      if (typeof part === 'string') {
        for (const word of part.split(/(?<= )/)) {
          full += word;
          send({ type: 'reply-delta', text: word }, turn);
          await wait(45);
        }
      } else if ('scene' in part) {
        send({ type: 'scene-drawing' }, turn);
        await wait(300);
        handleSceneBlock(turn, part.scene);
      } else {
        send({ type: 'annotation', annotation: part }, turn);
        await wait(250);
      }
    }
    send({ type: 'reply-done', fullText: full }, turn);
  } catch (err) {
    if (!isAbort(err)) throw err;
  } finally {
    endTurn(turn);
  }
}

// ---------------------------------------------------------------- settings window

function openSettings(): void {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 480,
    minHeight: 560,
    title: 'HeyGuy Settings',
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(DIST, 'preload', 'settings.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(DIST, 'renderer', 'settings', 'index.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// ---------------------------------------------------------------- workspace window

function openWorkspace(): void {
  if (workspaceWin) {
    workspaceWin.show();
    workspaceWin.focus();
    return;
  }
  workspaceWin = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 680,
    minHeight: 480,
    title: 'HeyGuy Workspace & History',
    backgroundColor: '#070d18',
    autoHideMenuBar: true,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(DIST, 'preload', 'workspace.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  workspaceWin.loadFile(path.join(DIST, 'renderer', 'workspace', 'index.html'));
  workspaceWin.on('closed', () => {
    workspaceWin = null;
  });
}

// ---------------------------------------------------------------- tray + hotkeys

function command(cmd: HotkeyCommand): void {
  if (!overlay) return;
  if (!overlay.isVisible()) overlay.showInactive();
  if (cmd === 'explain') {
    void ask('');
    return;
  }
  if (cmd === 'dismiss') cancel();
  if (cmd === 'type') {
    overlay.setFocusable(true);
    overlay.focus();
  }
  overlay.webContents.send(IPC.command, cmd);
}

let hotkeyStatus: Record<HotkeyCommand, HotkeyStatus> = { talk: 'ok', explain: 'ok', type: 'ok', dismiss: 'ok', snip: 'ok' };

/** Human-readable hotkey for messages, e.g. "Ctrl+Shift+Space". */
function key(cmd: HotkeyCommand): string {
  return prettyAccelerator(settings.raw.hotkeys[cmd]);
}

function publicSettings() {
  return settings.public(hotkeyStatus);
}

/** (Re)register all global hotkeys from settings; remembers which ones another app owns. */
function registerHotkeys(): HotkeyCommand[] {
  globalShortcut.unregisterAll();
  const failed: HotkeyCommand[] = [];
  const next = { ...hotkeyStatus };
  for (const cmd of HOTKEY_COMMANDS) {
    const accel = settings.raw.hotkeys[cmd];
    if (validateAccelerator(accel)) {
      next[cmd] = 'invalid';
      failed.push(cmd);
      continue;
    }
    let ok = false;
    try {
      ok = globalShortcut.register(accel, () => command(cmd));
    } catch (err) {
      console.error('[hotkeys] register failed', accel, err);
    }
    next[cmd] = ok ? 'ok' : 'taken';
    if (!ok) failed.push(cmd);
  }
  hotkeyStatus = next;
  buildTrayMenu();
  return failed;
}

function warnTakenHotkeys(failed: HotkeyCommand[]): void {
  if (!failed.length) return;
  const list = failed.map(key).join(', ');
  send({ type: 'notice', message: `Another app (maybe HeyClicky) already uses ${list}. Pick different keys in Settings → Hotkeys.` });
}

function buildTrayMenu(): void {
  if (!tray) return;
  tray.setToolTip(`HeyGuy — ${key('talk')} to talk`);
  const label = (text: string, cmd: HotkeyCommand) =>
    `${text}    ${key(cmd)}${hotkeyStatus[cmd] === 'ok' ? '' : ' (taken)'}`;
  const menu = Menu.buildFromTemplate([
    { label: label('Explain my screen', 'explain'), click: () => command('explain') },
    { label: label('Talk', 'talk'), click: () => command('talk') },
    { label: label('Type a question', 'type'), click: () => command('type') },
    { label: label('Dismiss', 'dismiss'), click: () => command('dismiss') },
    { type: 'separator' },
    { label: 'Play demo: pointing', click: () => void runDemo('pointing') },
    { label: 'Play demo: diagram', click: () => void runDemo('diagram') },
    { label: 'Play demo: 3D model', click: () => void runDemo('3d') },
    { label: 'Play demo: UI harness', click: () => void runDemo('ui') },
    { label: 'Play demo: F-22 jet', click: () => void runDemo('jet') },
    {
      label: 'Show buddy',
      type: 'checkbox',
      checked: overlay?.isVisible() ?? true,
      click: (item) => (item.checked ? overlay?.showInactive() : (cancel(), overlay?.hide())),
    },
    {
      label: 'New conversation',
      click: () => {
        if (db) activeSession = db.createSession();
        history = [];
        resetAntigravitySession();
        void connectBrain();
        command('dismiss');
      },
    },
    { label: 'Workspace & History…', click: openWorkspace },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit HeyGuy', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  buildTrayMenu();
  tray.on('click', () => tray?.popUpContextMenu());
}

// ---------------------------------------------------------------- IPC

/** The selection comes from a renderer: keep only short plain strings. */
function cleanSelection(raw: unknown): SceneSelection | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const sel = { sceneId: s(r.sceneId, 40), sceneTitle: s(r.sceneTitle, 80), itemId: s(r.itemId, 40), label: s(r.label, 60), detail: s(r.detail, 400) };
  return sel.itemId && sel.label ? sel : null;
}

function fromOverlay(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!overlay && e.sender === overlay.webContents;
}
function fromSettingsOrOverlay(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return fromOverlay(e) || (!!settingsWin && e.sender === settingsWin.webContents);
}
function fromWorkspace(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!workspaceWin && e.sender === workspaceWin.webContents;
}

function registerIpc(): void {
  ipcMain.on(IPC.setInteractive, (e, interactive: unknown) => {
    if (!fromOverlay(e) || !overlay) return;
    overlay.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on(IPC.setFocusable, (e, focusable: unknown) => {
    if (!fromOverlay(e) || !overlay) return;
    overlay.setFocusable(!!focusable);
    if (!focusable) overlay.blur();
  });
  ipcMain.on(IPC.ask, (e, req: AskRequest) => {
    if (!fromOverlay(e)) return;
    void ask(typeof req?.question === 'string' ? req.question.slice(0, 2000) : '', {
      selection: cleanSelection(req?.selection),
      spatialSelection: req?.spatialSelection ?? null,
    });
  });
  ipcMain.on(IPC.audio, (e, req: AudioRequest) => {
    if (!fromOverlay(e) || !(req?.wav instanceof Uint8Array)) return;
    if (req.wav.byteLength > 20 * 1024 * 1024) return send({ type: 'error', message: 'Recording too long.' });
    void handleAudio(req.wav, cleanSelection(req.selection), req?.spatialSelection ?? null);
  });
  ipcMain.on(IPC.listeningStarted, (e) => {
    if (fromOverlay(e)) onListeningStarted();
  });
  ipcMain.on(IPC.sceneClosed, (e) => {
    if (fromOverlay(e)) lastScene = null;
  });
  ipcMain.on(IPC.cancel, (e) => {
    if (fromOverlay(e)) cancel();
  });
  ipcMain.on(IPC.openSettings, (e) => {
    if (fromOverlay(e)) openSettings();
  });
  ipcMain.on(IPC.openWorkspace, (e) => {
    if (fromOverlay(e) || fromWorkspace(e) || (!!settingsWin && e.sender === settingsWin.webContents)) openWorkspace();
  });
  ipcMain.handle(IPC.listSessions, (e) => {
    if (!fromWorkspace(e)) throw new Error('forbidden');
    return db.listSessions();
  });
  ipcMain.handle(IPC.getSession, (e, id: string) => {
    if (!fromWorkspace(e) || typeof id !== 'string') throw new Error('forbidden');
    return db.getSession(id);
  });
  ipcMain.handle(IPC.searchHistory, (e, q: string) => {
    if (!fromWorkspace(e) || typeof q !== 'string') throw new Error('forbidden');
    return db.search(q);
  });
  ipcMain.handle(IPC.deleteSession, (e, id: string) => {
    if (!fromWorkspace(e) || typeof id !== 'string') throw new Error('forbidden');
    const ok = db.deleteSession(id);
    if (activeSession?.id === id) {
      activeSession = db.createSession();
      history = [];
    }
    return ok;
  });
  ipcMain.handle(IPC.newSession, (e) => {
    if (!fromWorkspace(e)) throw new Error('forbidden');
    activeSession = db.createSession();
    history = [];
    return activeSession;
  });
  ipcMain.handle(IPC.loadScene, (e, sceneId: string) => {
    if (!fromWorkspace(e) || typeof sceneId !== 'string') throw new Error('forbidden');
    const scene = db.getSceneById(sceneId);
    if (!scene) return false;
    lastScene = scene;
    if (overlay) {
      if (!overlay.isVisible()) overlay.showInactive();
      send({ type: 'scene', scene, warnings: [] });
    }
    return true;
  });

  // Jobs IPC
  ipcMain.handle(IPC.listJobs, (e) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return jobs.listJobs();
  });
  ipcMain.handle(IPC.getJob, (e, jobId: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return jobs.getJob(jobId);
  });
  ipcMain.handle(IPC.createJob, (e, payload: { title: string; goal: string; steps: { description: string; toolName?: string; toolInput?: Record<string, unknown> }[] }) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    const job = jobs.createJob(payload.title, payload.goal, payload.steps);
    void jobs.startJob(job.id);
    return job;
  });
  ipcMain.handle(IPC.approveJob, async (e, jobId: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return await jobs.approveAndResume(jobId);
  });
  ipcMain.handle(IPC.cancelJob, (e, jobId: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return jobs.cancelJob(jobId);
  });

  // Artifacts IPC
  ipcMain.handle(IPC.listArtifacts, (e) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return db.listArtifacts();
  });
  ipcMain.handle(IPC.getArtifact, (e, id: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return db.getArtifact(id);
  });

  // Walkthroughs IPC
  ipcMain.handle(IPC.startWalkthrough, (e, payload: { topic: string; steps: WalkthroughStep[] }) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return walkthroughs.start(payload.topic, payload.steps);
  });
  ipcMain.handle(IPC.nextWalkthroughStep, (e) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return walkthroughs.next();
  });
  ipcMain.handle(IPC.cancelWalkthrough, (e) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return walkthroughs.cancel();
  });

  // Memory IPC
  ipcMain.handle(IPC.listMemories, (e, cat?: MemoryCategory) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return memory.list(cat);
  });
  ipcMain.handle(IPC.addMemory, (e, payload: { category: MemoryCategory; key: string; content: string; confidence?: number; provenance?: string }) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return memory.remember(payload.category, payload.key, payload.content, payload.confidence ?? 0.9, payload.provenance);
  });
  ipcMain.handle(IPC.deleteMemory, (e, id: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return memory.forget(id);
  });
  ipcMain.handle(IPC.searchMemories, (e, query: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return memory.search(query);
  });

  // Routines IPC
  ipcMain.handle(IPC.listRoutines, (e) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return scheduler.listRoutines();
  });
  ipcMain.handle(IPC.createRoutine, (e, payload: Parameters<typeof scheduler.createRoutine>[0]) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return scheduler.createRoutine(payload);
  });
  ipcMain.handle(IPC.updateRoutine, (e, payload: { id: string; updates: Partial<RoutineRecord> }) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return db.updateRoutine(payload.id, payload.updates);
  });
  ipcMain.handle(IPC.deleteRoutine, (e, id: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return scheduler.deleteRoutine(id);
  });
  ipcMain.handle(IPC.runRoutineNow, (e, id: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return scheduler.runNow(id);
  });

  // Assistants IPC
  ipcMain.handle(IPC.listAssistants, (e) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return assistants.list();
  });
  ipcMain.handle(IPC.getActiveAssistant, (e) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    return assistants.getActive();
  });
  ipcMain.handle(IPC.setActiveAssistant, (e, id: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    const ok = assistants.setActive(id);
    if (ok) {
      const active = assistants.getActive();
      send({ type: 'notice', message: `Active assistant switched to ${active.name} (${active.role}).` });
    }
    return ok;
  });

  // Studio IPC (Image Generation & Instant Scene Preview)
  ipcMain.handle(
    IPC.generateImage,
    async (
      e,
      payload: {
        title?: string;
        prompt: string;
        size?: '1024x1024' | '1536x1024' | '1024x1536';
        quality?: 'low' | 'medium' | 'high' | 'auto';
      },
    ) => {
      if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim().slice(0, 2000) : '';
      if (!prompt) throw new Error('Prompt is required.');
      const res = await generateImage(
        { openaiKey: settings.openaiKey() },
        {
          prompt,
          size: payload.size ?? '1024x1024',
          quality: payload.quality ?? 'auto',
        },
        AbortSignal.timeout(60_000),
      );
      const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim().slice(0, 80) : prompt.slice(0, 60);
      return drafts.createImageArtifact({ title, dataUrl: res.dataUrl });
    },
  );

  ipcMain.handle(IPC.previewScene, (e, sceneJson: string) => {
    if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
    if (typeof sceneJson !== 'string') return { ok: false, error: 'Invalid scene JSON string.' };
    const r = parseSceneJSON(sceneJson);
    if (!r.ok) {
      return { ok: false, error: r.errors.join('; ') };
    }
    const q = qualityPass(r.scene, r.warnings);
    lastScene = q.scene;
    if (activeSession && db) db.saveScene(activeSession.id, 0, q.scene);
    if (overlay) {
      if (!overlay.isVisible()) overlay.showInactive();
      send({ type: 'scene', scene: q.scene, warnings: q.warnings });
    }
    return { ok: true, warnings: q.warnings };
  });

  ipcMain.handle(IPC.getAntigravityUsage, (e) => {
    if (!fromWorkspace(e) && !fromSettingsOrOverlay(e)) throw new Error('forbidden');
    return antigravityUsage.snapshot(settings.raw.googleAccountEmail, settings.raw.antigravityModel);
  });

  ipcMain.handle(
    IPC.runHeadlessCodeGen,
    async (
      e,
      payload: {
        prompt: string;
        language?: 'typescript' | 'react-tsx' | 'python' | 'html-app';
      },
    ) => {
      if (!fromWorkspace(e) && !fromOverlay(e)) throw new Error('forbidden');
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim().slice(0, 2000) : '';
      if (!prompt) throw new Error('Prompt is required.');
      const res = await runHeadlessCodeGen(
        {
          prompt,
          language: payload.language ?? 'react-tsx',
          accountEmail: settings.raw.googleAccountEmail,
          model: settings.raw.antigravityModel,
          geminiKeyFallback: settings.geminiKey(),
          geminiModel: settings.raw.geminiModel,
        },
        AbortSignal.timeout(180_000),
      );
      const artifact = drafts.createDocument({
        title: res.title,
        kind: 'code',
        content: res.code,
      });
      lastScene = res.scene;
      if (activeSession && db) db.saveScene(activeSession.id, 0, res.scene);
      if (overlay) {
        if (!overlay.isVisible()) overlay.showInactive();
        send({ type: 'scene', scene: res.scene, warnings: [] });
      }
      return {
        artifact,
        summary: res.summary,
        usage: res.usage,
      };
    },
  );

  ipcMain.handle(IPC.getSettings, (e) => {
    if (!fromSettingsOrOverlay(e)) throw new Error('forbidden');
    return publicSettings();
  });
  ipcMain.handle(IPC.saveSettings, async (e, u: SettingsUpdate) => {
    if (!settingsWin || e.sender !== settingsWin.webContents) throw new Error('forbidden');
    const before = `${settings.activeProvider()}|${settings.raw.antigravityModel}`;
    if (await settings.update(u ?? {})) registerHotkeys();
    const pub = publicSettings();
    overlay?.webContents.send(IPC.settingsChanged, pub);
    if (`${settings.activeProvider()}|${settings.raw.antigravityModel}` !== before) void connectBrain();
    else pushNotch();
    return pub;
  });
  ipcMain.handle(IPC.agySignIn, (e) => {
    if (!settingsWin || e.sender !== settingsWin.webContents) throw new Error('forbidden');
    const r = openAgySignIn();
    if (r.ok) {
      setBrain('connecting', 'Finish signing in in the window that opened. I’ll connect automatically.');
      pollUntilConnected();
    }
    return r;
  });
  ipcMain.handle(IPC.testKey, async (e, provider: Provider) => {
    if (!settingsWin || e.sender !== settingsWin.webContents) throw new Error('forbidden');
    // agy starts a full agent session, so its connectivity check needs far longer than a plain API ping
    const signal = AbortSignal.timeout(provider === 'antigravity' ? 90_000 : 20_000);
    try {
      if (provider === 'antigravity') {
        const msg = await pingAntigravity(
          {
            accountEmail: settings.raw.googleAccountEmail,
            model: settings.raw.antigravityModel,
            geminiKeyFallback: settings.geminiKey(),
            geminiModel: settings.raw.geminiModel,
          },
          signal,
        );
        return { ok: true, message: `Works! ${msg}` };
      } else if (provider === 'anthropic') {
        const key = settings.anthropicKey();
        if (!key) return { ok: false, message: 'No Claude key saved yet.' };
        await pingClaude({ apiKey: key, model: settings.raw.anthropicModel }, signal);
      } else if (provider === 'gemini') {
        const key = settings.geminiKey();
        if (!key) return { ok: false, message: 'No Gemini key saved yet.' };
        await pingGemini({ apiKey: key, model: settings.raw.geminiModel }, signal);
      } else if (provider === 'deepseek') {
        const key = settings.deepseekKey();
        if (!key) return { ok: false, message: 'No DeepSeek key saved yet.' };
        await pingDeepSeek({ apiKey: key, model: settings.raw.deepseekModel }, signal);
      } else {
        const key = settings.openaiKey();
        if (!key) return { ok: false, message: 'No OpenAI key saved yet.' };
        await pingOpenAI({ apiKey: key, model: settings.raw.openaiModel }, signal);
      }
      return { ok: true, message: 'Works!' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ---------------------------------------------------------------- dev snapshot hook

/** HEYGUY_SNAPSHOT=<dir>: run the demo, save overlay PNGs, quit. Used for automated visual checks. */
function snapshotMode(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const shots = [700, 2600, 6200, 9500];
  const kind = (process.env.HEYGUY_SNAPSHOT_DEMO as DemoKind | undefined) ?? 'pointing';
  setTimeout(() => void runDemo(kind), 400);
  shots.forEach((ms, i) =>
    setTimeout(async () => {
      if (!overlay) return;
      const img = await overlay.webContents.capturePage();
      writeFileSync(path.join(dir, `overlay-${i + 1}.png`), img.toPNG());
      if (i === shots.length - 1) app.quit();
    }, ms),
  );
}

// ---------------------------------------------------------------- visual fixture harness

interface FixtureCapture {
  name: string;
  sceneId: string;
  kind: Scene['kind'];
  rect: { x: number; y: number; width: number; height: number } | null;
  pngBytes: number;
  /** 64x64 thumbnail, base64. scripts/visual-harness.mjs compares this between runs. */
  thumb: string;
  stats: {
    triangles: number;
    drawCalls: number;
    geometries: number;
    textures: number;
    parts: number;
    fps: number;
  } | null;
}

const FIXTURE_SCENES: { name: string; demo: unknown; settle: number }[] = [
  { name: '3d-engine', demo: DEMO_ENGINE, settle: 1800 },
  { name: '3d-f22', demo: DEMO_F22, settle: 1800 },
  { name: '2d-diagram', demo: DEMO_DIAGRAM, settle: 800 },
  { name: 'ui-dashboard', demo: DEMO_UI, settle: 800 },
];

/**
 * HEYGUY_FIXTURES=<dir>: render every shipped scene demo with the deterministic overlay
 * (`?still=1`), save one PNG per scene plus report.json (render stats + thumbnails), then quit.
 * `npm run visual` runs this and diffs the thumbnails against the saved baseline.
 */
function fixtureMode(dir: string): void {
  mkdirSync(dir, { recursive: true });
  overlay?.webContents.once('did-finish-load', async () => {
    const captures: FixtureCapture[] = [];
    for (const fixture of FIXTURE_SCENES) {
      // Same validation path as real model output, so a fixture can never bypass the schema.
      const parsed = parseSceneJSON(JSON.stringify(fixture.demo));
      if (!parsed.ok) {
        console.warn(`[fixtures] ${fixture.name} rejected: ${parsed.errors.join('; ')}`);
        continue;
      }
      send({ type: 'scene', scene: parsed.scene, warnings: parsed.warnings });
      await new Promise((resolve) => setTimeout(resolve, fixture.settle));
      const win = overlay;
      if (!win) break;
      const raw = (await win.webContents.executeJavaScript(
        `(() => { const el = document.getElementById('scene-panel'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
      )) as FixtureCapture['rect'];
      const rect = raw && raw.width > 20 && raw.height > 20
        ? { x: Math.round(raw.x), y: Math.round(raw.y), width: Math.round(raw.width), height: Math.round(raw.height) }
        : null;
      const image = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage();
      const png = image.toPNG();
      writeFileSync(path.join(dir, `${fixture.name}.png`), png);
      const thumb = image.resize({ width: 64, height: 64 }).toBitmap();
      const stats = parsed.scene.kind === '3d'
        ? ((await win.webContents.executeJavaScript('window.__heyguy3d ?? null')) as FixtureCapture['stats'])
        : null;
      captures.push({
        name: fixture.name,
        sceneId: parsed.scene.id,
        kind: parsed.scene.kind,
        rect,
        pngBytes: png.length,
        thumb: thumb.toString('base64'),
        stats,
      });
    }
    writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), captures }, null, 2));
    console.log(`[fixtures] wrote ${captures.length} captures + report.json to ${dir}`);
    app.quit();
  });
}

// ---------------------------------------------------------------- brain + notch

let brainStatus: BrainStatus = 'connecting';
let brainDetail = '';
let connectPoll: NodeJS.Timeout | null = null;

function notchState(): NotchState {
  const provider = settings.activeProvider() ?? settings.raw.provider;
  const usage = antigravityUsage.snapshot(settings.raw.googleAccountEmail, settings.raw.antigravityModel);
  const model =
    provider === 'antigravity'
      ? normalizeAntigravityModel(settings.raw.antigravityModel)
      : provider === 'anthropic'
        ? settings.raw.anthropicModel
        : provider === 'gemini'
          ? settings.raw.geminiModel
          : provider === 'openai'
            ? settings.raw.openaiModel
            : settings.raw.deepseekModel;
  return {
    status: provider === 'antigravity' ? brainStatus : 'api-key',
    provider,
    model,
    account: settings.raw.googleAccountEmail,
    userName: settings.raw.userName ?? '',
    detail: brainDetail,
    requests: usage.totalRequests,
    totalTokens: usage.totalTokens,
  };
}

function pushNotch(): void {
  overlay?.webContents.send(IPC.notchState, notchState());
}

function setBrain(status: BrainStatus, detail = ''): void {
  brainStatus = status;
  brainDetail = detail;
  pushNotch();
}

const AUTH_RE = /auth|sign.?in|log.?in|credential|unauthori[sz]ed|401/i;

/**
 * Start the warm Antigravity session and send it the system prompt, so the
 * first question is fast. Doubles as the "are we signed in?" check.
 */
async function connectBrain(): Promise<boolean> {
  if ((settings.activeProvider() ?? settings.raw.provider) !== 'antigravity') {
    pushNotch();
    return true;
  }
  if (!resolveAgyBinary()) {
    if (settings.geminiKey()) {
      setBrain('api-key', 'Antigravity CLI not installed; using your Gemini API key.');
      return true;
    }
    setBrain('missing', 'Install the Antigravity CLI from antigravity.google, then sign in.');
    return false;
  }
  setBrain('connecting', 'Waking up Gemini…');
  try {
    await warmAntigravity({ accountEmail: settings.raw.googleAccountEmail, model: settings.raw.antigravityModel }, systemPrompt());
    setBrain('ready');
    return true;
  } catch (err) {
    resetAntigravitySession();
    const msg = err instanceof Error ? err.message : String(err);
    if (AUTH_RE.test(msg)) setBrain('signed-out', 'Sign in with your Google account to use Gemini.');
    else setBrain('error', msg.slice(0, 160));
    return false;
  }
}

/** After opening the sign-in terminal, keep checking until the CLI answers (max ~4 min). */
function pollUntilConnected(): void {
  if (connectPoll) clearInterval(connectPoll);
  let tries = 0;
  let busy = false;
  connectPoll = setInterval(async () => {
    if (busy) return;
    busy = true;
    tries++;
    const ok = await connectBrain();
    busy = false;
    if (ok || tries >= 24) {
      if (connectPoll) clearInterval(connectPoll);
      connectPoll = null;
      if (ok) send({ type: 'notice', message: 'Connected. Gemini is ready on your Google account.' });
    }
  }, 10_000);
}

async function notchAction(kind: NotchAction): Promise<{ ok: boolean; message: string }> {
  switch (kind) {
    case 'connect-google': {
      const r = openAgySignIn();
      if (r.ok) {
        setBrain('connecting', 'Finish signing in in the window that opened. I’ll connect automatically.');
        pollUntilConnected();
      } else {
        setBrain(resolveAgyBinary() ? 'error' : 'missing', r.message);
      }
      return r;
    }
    case 'use-google':
      await settings.update({ provider: 'antigravity' });
      overlay?.webContents.send(IPC.settingsChanged, publicSettings());
      void connectBrain();
      return { ok: true, message: 'Switched to your Google account.' };
    case 'retry':
      resetAntigravitySession();
      return { ok: await connectBrain(), message: brainDetail };
    case 'sign-out': {
      // agy refuses /logout in non-interactive/print mode because it alters credentials on disk.
      // Launch an interactive terminal with /logout so the user can cleanly switch accounts.
      resetAntigravitySession();
      const r = openAgyInteractive('/logout');
      if (r.ok) {
        setBrain('signed-out', 'Signing out in the terminal window. When done, press Connect Google to sign in with your other account.');
      }
      return r;
    }
    case 'usage':
      try {
        const out = await runAgyCommand('/usage', AbortSignal.timeout(30_000));
        return { ok: true, message: out || 'No usage report returned.' };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    case 'settings':
      openSettings();
      return { ok: true, message: '' };
    case 'history':
      openWorkspace();
      return { ok: true, message: '' };
    case 'explain':
      command('explain');
      return { ok: true, message: '' };
    case 'draw-demo':
      void runDemo('jet');
      return { ok: true, message: '' };
  }
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('dev.thanmay.heyguy');
    settings = await SettingsStore.load();
    const dbPath = path.join(app.getPath('userData'), 'heyguy.db');
    db = new DatabaseStore(dbPath);
    drafts = new DraftConnector(db);
    jobs = new JobEngine(db, tools);
    registerBuiltinTools(tools, {
      db,
      drafts,
      windows,
      browser,
      getOpenaiKey: () => settings.openaiKey(),
      getAntigravityConfig: () => ({
        accountEmail: settings.raw.googleAccountEmail,
        model: settings.raw.antigravityModel,
        geminiKeyFallback: settings.geminiKey(),
        geminiModel: settings.raw.geminiModel,
      }),
    });

    memory = new MemoryStore(db);
    assistants = new AssistantProfileManager(db);
    notifications = new NotificationDispatcher();
    scheduler = new SchedulerEngine(db, jobs, (routine) => {
      notifications.notify({
        title: `Routine: ${routine.title}`,
        body: `Scheduled routine triggered.`,
      });
      send({ type: 'notice', message: `Scheduled routine "${routine.title}" triggered.` });
    });
    scheduler.start();

    jobs.on('job-awaiting-approval', (e: { jobId: string; request: { description: string } }) => {
      send({ type: 'notice', message: `Job needs approval: ${e.request.description}. Open Workspace to review.` });
      openWorkspace();
    });
    jobs.on('job-completed', (job: JobRecord) => {
      send({ type: 'notice', message: `Job "${job.title}" finished.` });
    });

    walkthroughs.on('state-changed', (state) => {
      if (state.active && state.step?.targetPoint) {
        send({
          type: 'annotation',
          annotation: { kind: 'circle', center: state.step.targetPoint, radius: 32, label: state.step.instruction },
        });
      }
    });

    activeSession = db.getOrCreateActiveSession();
    history = db.getRecentTurns(activeSession.id, HISTORY_TURNS);

    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && !!overlay && wc === overlay.webContents));
    ses.setPermissionCheckHandler((wc, permission) => permission === 'media' && !!overlay && wc === overlay.webContents);

    registerIpc();
    ipcMain.handle(IPC.getNotchState, (e) => {
      if (!fromOverlay(e)) throw new Error('forbidden');
      return notchState();
    });
    ipcMain.handle(IPC.notchAction, (e, kind: NotchAction) => {
      if (!fromOverlay(e)) throw new Error('forbidden');
      return notchAction(kind);
    });
    createOverlay();
    overlay?.webContents.once('did-finish-load', () => {
      pushNotch();
      if (!process.env.HEYGUY_SNAPSHOT && !process.env.HEYGUY_FIXTURES) void connectBrain();
    });
    createTray();
    const taken = registerHotkeys();
    overlay?.webContents.once('did-finish-load', () => setTimeout(() => warnTakenHotkeys(taken), 1200));
    setInterval(pollCursor, 16);
    screen.on('display-removed', () => moveOverlayTo(screen.getPrimaryDisplay()));
    screen.on('display-metrics-changed', (_e, d) => {
      if (d.id === overlayDisplay.id) moveOverlayTo(d);
    });

    const snap = process.env.HEYGUY_SNAPSHOT;
    const fixtures = process.env.HEYGUY_FIXTURES;
    // --demo, --demo=diagram, --demo=3d, --demo=ui
    const demoFlag = process.argv.find((a) => a === '--demo' || a.startsWith('--demo='));
    const demoArg: DemoKind | null = demoFlag ? ((['pointing', 'diagram', '3d', 'ui', 'jet'] as const).find((k) => demoFlag === `--demo=${k}`) ?? 'pointing') : null;
    if (fixtures) fixtureMode(fixtures);
    else if (snap) snapshotMode(snap);
    else if (demoArg) overlay?.webContents.once('did-finish-load', () => setTimeout(() => void runDemo(demoArg), 600));
    else if (process.argv.includes('--settings')) {
      openSettings();
    } else if (!settings.activeProvider()) {
      overlay?.webContents.once('did-finish-load', () =>
        setTimeout(() => send({ type: 'notice', message: `Hi! Add an API key (Claude, Gemini, or OpenAI) in Settings (tray icon) and press ${key('explain')}.` }), 800),
      );
      openSettings();
    }
  });
  app.on('will-quit', () => {
    scheduler?.stop();
    globalShortcut.unregisterAll();
    db?.close();
  });
  // Tray app: keep running when the settings window closes.
  app.on('window-all-closed', () => undefined);
}
