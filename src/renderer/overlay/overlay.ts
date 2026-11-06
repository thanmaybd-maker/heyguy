// Overlay renderer: render loop + interaction state machine tying together the
// buddy, annotations, bubble, microphone and speech.
import { Buddy } from './buddy';
import { AnnotationLayer } from './annotations';
import { Bubble } from './bubble';
import { Recorder, type StopReason } from './voice';
import { Speaker } from './tts';
import { ScenePanel } from './scene-panel';
import { Notch } from './notch';
import { SentenceChunker } from '../../shared/sentences';
import { annotationBounds, focusPoint, type Rect } from '../../shared/geometry';
import { DEFAULT_HOTKEYS, prettyAccelerator } from '../../shared/hotkeys';
import type { Annotation, BuddyState, CompanionEvent, Envelope, HotkeyCommand, Pt, PublicSettings, SpatialSelection } from '../../shared/types';

const api = window.heyguy;
const closeBtn = document.getElementById('btn-close') as HTMLButtonElement;
const snipBtn = document.getElementById('btn-snip') as HTMLButtonElement;
const workspaceBtn = document.getElementById('btn-workspace') as HTMLButtonElement;
const captionsEl = document.getElementById('live-captions') as HTMLElement;
const captionsTextEl = document.getElementById('captions-text') as HTMLElement;
let captionsEnabled = false;

workspaceBtn?.addEventListener('click', () => api.openWorkspace());
snipBtn?.addEventListener('click', () => startSnip());

const HOME_AFTER_MS = 1800;
const FADE_DRAWINGS_AFTER_MS = 9000;
const HIDE_BUBBLE_AFTER_MS = 22000;
const DWELL_MS = 1100;

// ------------------------------------------------------------------ canvas

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let dpr = 1;
function resize(): void {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}
window.addEventListener('resize', () => {
  resize();
  bubble.layout();
});
resize();

// ------------------------------------------------------------------ actors

const buddy = new Buddy();
const drawings = new AnnotationLayer();
let interactive = false;
let dragging = false;

function setInteractive(v: boolean): void {
  if (v === interactive) return;
  interactive = v;
  api.setInteractive(v);
}

let snipMode = false;
let snipStart: Pt | null = null;
let snipCurrent: Pt | null = null;
let activeSpatialSelection: SpatialSelection | null = null;

function startSnip(): void {
  snipMode = true;
  snipStart = null;
  snipCurrent = null;
  setInteractive(true);
  canvas.style.cursor = 'crosshair';
  showTransient(`Drag across your screen to highlight an area (${key('dismiss')} to cancel)`, 'notice');
}

const bubble = new Bubble({
  onSubmit: (q) => {
    beginInteraction(q);
    pendingYouShown = q;
    setPhase('thinking', 'Looking at your screen…');
    api.ask(q, panel.selection, activeSpatialSelection);
    activeSpatialSelection = null;
  },
  onClose: () => dismiss(),
  onSettings: () => api.openSettings(),
  onTypingEnd: () => api.setFocusable(false),
  onDragChange: (d) => {
    dragging = d;
    if (d) setInteractive(true);
  },
});

const panel = new ScenePanel({
  onClose: () => api.sceneClosed(),
  onSelectionChange: () => undefined,
  askHint: () => key('talk'),
});

/** Everything the bubble should stay clear of: drawings on screen and the scene panel. */
function busyAreas(): Rect[] {
  const r = panel.rect();
  const areas = [...drawnAreas, notch.rect()];
  return r ? [...areas, r] : areas;
}

const notch = new Notch({
  action: (kind) => api.notchAction(kind),
  onOpenChange: () => undefined,
});
api.onNotchState((st) => notch.setState(st));
api.getNotchState().then((st) => notch.setState(st), () => undefined);

let phase: BuddyState = 'idle';
const speaker = new Speaker({
  onStart: () => {
    if (phase !== 'error') setPhase('speaking');
  },
  onEnd: () => {
    captionsEl.classList.add('hidden');
    maybeWrapUp();
  },
  onBoundary: () => buddy.pulse(),
  onSentenceStart: (sentence, index) => {
    notchCaption = sentence.length > 60 ? sentence.slice(0, 59) + '…' : sentence;
    if (phase === 'speaking') notch.setPhase('speaking', notchCaption);
    if (captionsEnabled) {
      captionsTextEl.textContent = sentence;
      captionsEl.classList.remove('hidden');
    }
    panel.syncStep(index);
  },
});

const recorder = new Recorder({
  onLevel: (l) => (buddy.level = buddy.level * 0.6 + l * 0.4),
  onAutoStop: (reason) => void stopListening(reason),
});

// ------------------------------------------------------------------ state

let chunker = new SentenceChunker();
let queue: Annotation[] = [];
let flying = false;
let replyDone = true;
let wrapTimers: number[] = [];
/** areas drawn on during the current reply; the bubble keeps clear of them */
let drawnAreas: Rect[] = [];
/** transcript that arrived before the main process starts the request */
let pendingYou: string | null = null;
/** last question, for the notch's answer card */
let pendingYouShown = '';

/** current hotkeys, for on-screen hints */
let keys: Record<HotkeyCommand, string> = { ...DEFAULT_HOTKEYS };
const key = (c: HotkeyCommand) => prettyAccelerator(keys[c]);

const STATUS: Record<BuddyState, string> = {
  idle: 'HeyGuy',
  listening: 'Listening…',
  transcribing: 'Got it…',
  thinking: 'Thinking…',
  speaking: 'HeyGuy',
  error: 'Hmm, a problem',
};

function setPhase(p: BuddyState, detail?: string): void {
  phase = p;
  buddy.state = p;
  const kind = p === 'transcribing' ? 'thinking' : p;
  const label = p === 'listening' && !detail ? `Listening… (${key('talk')} to send)` : (detail ?? STATUS[p]);
  bubble.setStatus(label, kind);
  notch.setPhase(p, p === 'idle' ? '' : p === 'speaking' ? notchCaption : label);
}

/** sentence being spoken, shown in the notch */
let notchCaption = '';

function clearWrapTimers(): void {
  wrapTimers.forEach((t) => clearTimeout(t));
  wrapTimers = [];
}

/** Reset everything for a fresh question. */
function beginInteraction(youText: string): void {
  clearWrapTimers();
  speaker.stop();
  chunker = new SentenceChunker();
  queue = [];
  flying = false;
  replyDone = false;
  drawnAreas = [];
  drawings.fadeAll(performance.now());
  buddy.home();
  bubble.unpark();
  bubble.setYou(youText);
  bubble.clearReply();
  bubble.setAnchor(buddy.pos);
  bubble.show();
}

function processQueue(): void {
  if (flying) return;
  const next = queue.shift();
  if (!next) return maybeWrapUp();
  flying = true;
  buddy.flyTo(focusPoint(next), performance.now(), () => {
    drawings.add(next, performance.now());
    drawnAreas.push(annotationBounds(next));
    bubble.avoid(busyAreas());
    window.setTimeout(() => {
      flying = false;
      processQueue();
    }, DWELL_MS);
  });
}

/** After the reply, drawings and speech are all finished: go home, fade, hide. */
function maybeWrapUp(): void {
  if (!replyDone || flying || queue.length || speaker.speaking) return;
  if (phase === 'speaking') setPhase('idle');
  clearWrapTimers();
  wrapTimers.push(
    window.setTimeout(() => buddy.home(), HOME_AFTER_MS),
    window.setTimeout(() => drawings.fadeAll(performance.now()), FADE_DRAWINGS_AFTER_MS),
    window.setTimeout(function hideLater() {
      if (bubble.hovered || bubble.typing) {
        wrapTimers.push(window.setTimeout(hideLater, 3000));
        return;
      }
      bubble.hide();
      setInteractive(false);
    }, HIDE_BUBBLE_AFTER_MS),
  );
}

function dismiss(): void {
  clearWrapTimers();
  captionsEl.classList.add('hidden');
  if (recorder.active) void recorder.stop();
  speaker.stop();
  api.cancel();
  queue = [];
  flying = false;
  replyDone = true;
  drawings.fadeAll(performance.now());
  buddy.home();
  bubble.hide();
  panel.close();
  setPhase('idle');
  setInteractive(false);
  api.setFocusable(false);
}

function showTransient(text: string, tone: 'notice' | 'error'): void {
  clearWrapTimers();
  bubble.setAnchor(buddy.pos);
  bubble.setMessage(text, tone);
  bubble.show();
  replyDone = true;
  maybeWrapUp();
}

// ------------------------------------------------------------------ voice

async function startListening(): Promise<void> {
  beginInteraction('');
  replyDone = true;
  api.cancel();
  setPhase('listening');
  bubble.setMessage('Go ahead, I’m listening. I’ll send when you pause.', 'notice');
  // main captures the screen right now, so the answer matches what you were looking at
  api.listeningStarted();
  try {
    await recorder.start();
  } catch (err) {
    console.error(err);
    api.cancel();
    setPhase('error');
    buddy.flashError();
    const name = err instanceof Error ? err.name : '';
    showTransient(
      name === 'NotAllowedError'
        ? 'Microphone is blocked. Windows Settings → Privacy & security → Microphone → allow desktop apps.'
        : name === 'NotFoundError'
          ? `No microphone found. Plug one in, or press ${key('type')} to type.`
          : `Couldn't start the microphone: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  }
}

async function stopListening(reason: StopReason): Promise<void> {
  if (!recorder.active) return;
  const wav = await recorder.stop();
  buddy.level = 0;
  if (!wav) {
    api.cancel();
    setPhase('idle');
    showTransient(reason === 'no-speech' ? `I didn't hear anything. Press ${key('talk')} and try again.` : 'Okay, cancelled.', 'notice');
    return;
  }
  setPhase('transcribing');
  bubble.setMessage('', 'normal');
  api.sendAudio(wav, panel.selection, activeSpatialSelection);
  activeSpatialSelection = null;
}

// ------------------------------------------------------------------ main → overlay

/** Newest turn we have seen; events from older turns are stale and ignored. */
let activeTurn = 0;

function onEnvelope(env: Envelope): void {
  if (env.turn !== 0) {
    if (env.turn < activeTurn) return;
    activeTurn = env.turn;
  }
  onEvent(env.event);
}

function onEvent(e: CompanionEvent): void {
  switch (e.type) {
    case 'scene-drawing':
      panel.showDrawing();
      bubble.avoid(busyAreas());
      break;
    case 'scene':
      panel.show(e.scene);
      bubble.avoid(busyAreas());
      break;
    case 'scene-error':
      panel.showError(e.message);
      if (!panel.visible) showTransient(e.message, 'notice');
      break;
    case 'state':
      if (e.state === 'thinking' && phase !== 'transcribing' && phase !== 'thinking') {
        beginInteraction(pendingYou ?? '');
      }
      pendingYou = null;
      setPhase(e.state, e.detail);
      bubble.show();
      break;
    case 'user-text':
      pendingYou = e.text;
      pendingYouShown = e.text;
      bubble.setYou(e.text);
      bubble.show();
      break;
    case 'reply-start':
      setPhase('speaking');
      bubble.startReply();
      bubble.show();
      break;
    case 'reply-delta':
      bubble.appendReply(e.text);
      bubble.avoid(busyAreas());
      for (const s of chunker.push(e.text)) speaker.say(s);
      break;
    case 'annotation':
      queue.push(e.annotation);
      processQueue();
      break;
    case 'reply-done':
      bubble.endReply(e.fullText);
      notch.setAnswer(pendingYouShown, e.fullText);
      for (const s of chunker.flush()) speaker.say(s);
      replyDone = true;
      maybeWrapUp();
      break;
    case 'error':
      speaker.stop();
      setPhase('error');
      buddy.flashError();
      buddy.home();
      showTransient(e.message, 'error');
      break;
    case 'notice':
      if (phase === 'transcribing') setPhase('idle');
      showTransient(e.message, 'notice');
      break;
  }
}

function onCommand(c: HotkeyCommand): void {
  switch (c) {
    case 'talk':
      if (recorder.active) void stopListening('manual');
      else void startListening();
      break;
    case 'type':
      if (!bubble.visible) {
        beginInteraction('');
        replyDone = true;
        setPhase('idle', 'Ask me about your screen');
      }
      bubble.setAnchor(buddy.pos);
      bubble.showInput();
      setInteractive(true);
      break;
    case 'dismiss':
      if (snipMode) {
        snipMode = false;
        snipStart = null;
        snipCurrent = null;
        canvas.style.cursor = 'default';
        setInteractive(false);
        showTransient('Selection cancelled.', 'notice');
      } else {
        dismiss();
      }
      break;
    case 'snip':
      startSnip();
      break;
    case 'explain':
      break; // handled in main (it starts the request directly)
  }
}

function applySettings(s: PublicSettings): void {
  speaker.enabled = s.voiceReplies;
  speaker.rate = s.ttsRate;
  speaker.setVoice(s.ttsVoice);
  if (!s.voiceReplies) speaker.stop();
  captionsEnabled = !!s.captionsEnabled;
  if (!captionsEnabled) captionsEl.classList.add('hidden');
  keys = { ...s.hotkeys };
  notch.setTalkKey(key('talk'));
  closeBtn.title = `Close (${key('dismiss')})`;
}

api.onEvent(onEnvelope);
api.onCommand(onCommand);
api.onSettingsChanged(applySettings);
api.getSettings().then(applySettings, (err) => console.error('getSettings failed', err));
api.onCursor((c) => {
  buddy.setCursor({ x: c.x, y: c.y });
  if (Math.abs(c.width - window.innerWidth) > 1 || Math.abs(c.height - window.innerHeight) > 1) resize();
});
api.onHideForCapture(() => {
  document.documentElement.classList.add('capturing');
  requestAnimationFrame(() => requestAnimationFrame(() => api.hiddenForCapture()));
});
api.onShowAfterCapture(() => document.documentElement.classList.remove('capturing'));

// Click-through everywhere except the bubble and interactive surfaces.
document.addEventListener('mousemove', (e) => {
  if (dragging) return;
  const over = !!(e.target as Element | null)?.closest?.('[data-interactive]');
  setInteractive(over || bubble.typing || snipMode);
});

// Spatial lasso / box selection
window.addEventListener('pointerdown', (e) => {
  if (!snipMode) return;
  if ((e.target as Element | null)?.closest?.('#bubble')) return;
  snipStart = { x: e.clientX, y: e.clientY };
  snipCurrent = snipStart;
});

window.addEventListener('pointermove', (e) => {
  if (!snipMode || !snipStart) return;
  snipCurrent = { x: e.clientX, y: e.clientY };
});

window.addEventListener('pointerup', (e) => {
  if (!snipMode || !snipStart) return;
  const x = Math.min(snipStart.x, e.clientX);
  const y = Math.min(snipStart.y, e.clientY);
  const w = Math.max(16, Math.abs(e.clientX - snipStart.x));
  const h = Math.max(16, Math.abs(e.clientY - snipStart.y));

  snipMode = false;
  snipStart = null;
  snipCurrent = null;
  canvas.style.cursor = 'default';

  activeSpatialSelection = {
    bounds: { x, y, width: w, height: h },
    normalized: { x: x / window.innerWidth, y: y / window.innerHeight, width: w / window.innerWidth, height: h / window.innerHeight },
  };

  drawings.add({ kind: 'box', from: { x, y }, to: { x: x + w, y: y + h }, label: 'highlighted area' }, performance.now());
  drawnAreas.push({ x, y, width: w, height: h });

  bubble.setAnchor({ x: Math.min(window.innerWidth - 300, x + w + 16), y: Math.max(20, y) });
  bubble.showInput();
  bubble.setStatus('Area highlighted — ask what you want to know about it', 'idle');
  api.setFocusable(true);
  setInteractive(true);
});

// ------------------------------------------------------------------ render loop

let last = performance.now();
let avoidTick = 0;
function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  buddy.update(dt, now);
  if (!bubble.typing && phase !== 'idle' && buddy.isHome && bubble.visible) bubble.setAnchor(buddy.pos);
  // keep the bubble clear of the scene panel / drawings (cheap: a few rect checks)
  if (bubble.visible && ++avoidTick % 12 === 0) bubble.avoid(busyAreas());
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  drawings.draw(ctx, now, { width: window.innerWidth, height: window.innerHeight });

  // Render live snip drag marquee
  if (snipMode && snipStart && snipCurrent) {
    ctx.save();
    const sx = Math.min(snipStart.x, snipCurrent.x);
    const sy = Math.min(snipStart.y, snipCurrent.y);
    const sw = Math.abs(snipCurrent.x - snipStart.x);
    const sh = Math.abs(snipCurrent.y - snipStart.y);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.restore();
  }

  buddy.draw(ctx, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
