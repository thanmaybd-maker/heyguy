// The dynamic notch: a black island at the top centre of the screen.
// Collapsed it is a small pill. It widens to show live status (listening,
// thinking, speaking captions) and opens into a home panel on hover or click:
// greeting, quick actions, the Google account HeyGuy is using, and the last answer.
// Its shape is animated with clip-path on registered custom properties, so
// nothing reflows and the clipped-away area doesn't catch clicks.
import type { BuddyState, NotchAction, NotchState } from '../../shared/types';

type Mode = 'rest' | 'status' | 'open';

const SIZES: Record<Exclude<Mode, 'open'>, { w: number; h: number }> = {
  rest: { w: 132, h: 30 },
  status: { w: 340, h: 38 },
};
const OPEN_W = 440;
const HOVER_OPEN_MS = 260;
const HOVER_CLOSE_MS = 650;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from overlay HTML`);
  return el as T;
}

function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  return name ? `${part}, ${name}.` : `${part}.`;
}

const PROVIDER_NAMES: Record<string, string> = {
  antigravity: 'Google account',
  anthropic: 'Claude API key',
  gemini: 'Gemini API key',
  openai: 'OpenAI API key',
  deepseek: 'DeepSeek API key',
};

export class Notch {
  private readonly root = byId('notch');
  private readonly pill = byId<HTMLButtonElement>('notch-pill');
  private readonly line = byId('notch-line');
  private readonly panel = byId('notch-panel');
  private readonly greet = byId('notch-greet');
  private readonly hint = byId('notch-hint');
  private readonly account = byId('notch-account');
  private readonly accountName = byId('notch-account-name');
  private readonly accountMeta = byId('notch-account-meta');
  private readonly connect = byId('notch-connect');
  private readonly connectTitle = byId('notch-connect-title');
  private readonly connectBody = byId('notch-connect-body');
  private readonly connectBtn = byId<HTMLButtonElement>('notch-connect-btn');
  private readonly card = byId('notch-card');
  private readonly cardQ = byId('notch-card-q');
  private readonly cardA = byId('notch-card-a');
  private readonly report = byId('notch-report');
  private mode: Mode = 'rest';
  private pinned = false;
  private hoverTimer = 0;
  private phase: BuddyState = 'idle';
  private statusText = '';
  private state: NotchState | null = null;
  private talkKey = 'Ctrl+Shift+Space';

  constructor(private readonly handlers: { action: (kind: NotchAction) => Promise<{ ok: boolean; message: string }>; onOpenChange: (open: boolean) => void }) {
    this.pill.addEventListener('click', () => {
      this.pinned = this.mode !== 'open';
      this.setMode(this.pinned ? 'open' : this.restingMode());
    });
    this.root.addEventListener('pointerenter', () => {
      clearTimeout(this.hoverTimer);
      if (this.mode !== 'open') this.hoverTimer = window.setTimeout(() => this.setMode('open'), HOVER_OPEN_MS);
    });
    this.root.addEventListener('pointerleave', () => {
      clearTimeout(this.hoverTimer);
      if (!this.pinned) this.hoverTimer = window.setTimeout(() => this.setMode(this.restingMode()), HOVER_CLOSE_MS);
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      btn.addEventListener('click', () => void this.run(btn.dataset.action as NotchAction, btn));
    }
    this.connectBtn.addEventListener('click', () => void this.run((this.connectBtn.dataset.action as NotchAction) || 'connect-google', this.connectBtn));
    this.render();
  }

  private async run(kind: NotchAction, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      const r = await this.handlers.action(kind);
      if (kind === 'usage' || kind === 'sign-out' || !r.ok) this.showReport(r.message);
      if (kind === 'explain' || kind === 'draw-demo' || kind === 'settings' || kind === 'history') this.close();
    } finally {
      btn.disabled = false;
    }
  }

  private showReport(text: string): void {
    this.report.textContent = text;
    this.report.hidden = !text;
    this.measure();
  }

  get isOpen(): boolean {
    return this.mode === 'open';
  }

  close(): void {
    this.pinned = false;
    this.setMode(this.restingMode());
  }

  open(): void {
    this.pinned = true;
    this.setMode('open');
  }

  setTalkKey(k: string): void {
    this.talkKey = k;
    this.render();
  }

  /** Buddy phase + one-line status ("Listening…", a caption, an error). */
  setPhase(phase: BuddyState, text: string): void {
    this.phase = phase;
    this.statusText = text;
    this.root.dataset.phase = phase;
    this.line.textContent = text || 'HeyGuy';
    if (this.mode !== 'open') this.setMode(this.restingMode());
  }

  setAnswer(question: string, answer: string): void {
    this.cardQ.textContent = question || 'About your screen';
    this.cardA.textContent = answer;
    this.card.hidden = !answer;
    this.measure();
  }

  setState(s: NotchState): void {
    this.state = s;
    this.render();
  }

  private restingMode(): Mode {
    const busy = this.phase !== 'idle' || (this.state && this.state.status !== 'ready' && this.state.status !== 'api-key');
    return busy ? 'status' : 'rest';
  }

  private render(): void {
    const s = this.state;
    this.greet.textContent = greeting(s?.userName ?? '');
    this.hint.textContent = `Press ${this.talkKey} and ask about anything on your screen.`;
    if (!s) return;
    this.root.dataset.brain = s.status;
    const google = s.provider === 'antigravity';
    this.accountName.textContent = google ? s.account || 'Google account' : PROVIDER_NAMES[s.provider] ?? s.provider;
    const usage = s.requests ? ` · ${s.requests} ${s.requests === 1 ? 'reply' : 'replies'}, ${s.totalTokens.toLocaleString()} tokens` : '';
    this.accountMeta.textContent = `${s.model}${usage}`;
    this.account.dataset.status = s.status;
    const avatar = this.account.querySelector('.avatar');
    if (avatar) avatar.textContent = (google ? s.account || 'G' : s.provider).slice(0, 1).toUpperCase();

    const needsConnect = s.status === 'signed-out' || s.status === 'missing' || s.status === 'error' || s.status === 'connecting';
    this.connect.hidden = !needsConnect;
    this.root.querySelector<HTMLElement>('[data-google-only]')?.toggleAttribute('hidden', !google);
    if (needsConnect) {
      const copy: Record<string, [string, string, string, NotchAction]> = {
        'signed-out': ['Connect your Google account', 'HeyGuy uses Gemini 3.8 Flash through your own Antigravity sign-in. Your password never touches HeyGuy.', 'Sign in with Google', 'connect-google'],
        missing: ['Install the Antigravity CLI', 'HeyGuy talks to Gemini through Google’s official agy tool. Install it from antigravity.google, then come back here.', 'I installed it', 'retry'],
        connecting: ['Connecting…', s.detail || 'Waking up Gemini on your account.', 'Check again', 'retry'],
        error: ['Gemini didn’t answer', s.detail || 'Something went wrong talking to the Antigravity CLI.', 'Try again', 'retry'],
      };
      const [title, body, cta, act] = copy[s.status]!;
      this.connectTitle.textContent = title;
      this.connectBody.textContent = body;
      this.connectBtn.textContent = cta;
      this.connectBtn.dataset.action = act;
      this.connectBtn.disabled = s.status === 'connecting' && !s.detail.includes('Finish');
    }
    if (this.mode !== 'open') {
      this.line.textContent = this.statusText || this.idleLine(s);
      this.setMode(this.restingMode());
    } else {
      this.measure();
    }
  }

  private idleLine(s: NotchState): string {
    if (s.status === 'signed-out') return 'Connect Google to start';
    if (s.status === 'missing') return 'Antigravity CLI needed';
    if (s.status === 'connecting') return 'Connecting…';
    if (s.status === 'error') return 'Gemini didn’t answer';
    return 'HeyGuy';
  }

  private setMode(m: Mode): void {
    const changed = m !== this.mode;
    this.mode = m;
    this.root.dataset.mode = m;
    this.pill.setAttribute('aria-expanded', String(m === 'open'));
    this.panel.toggleAttribute('inert', m !== 'open');
    if (m === 'open') this.measure();
    else {
      const sz = SIZES[m];
      this.root.style.setProperty('--nw', `${sz.w}px`);
      this.root.style.setProperty('--nh', `${sz.h}px`);
    }
    if (changed) this.handlers.onOpenChange(m === 'open');
  }

  /** Open height follows the content. */
  private measure(): void {
    if (this.mode !== 'open') return;
    const h = Math.min(window.innerHeight - 40, this.panel.scrollHeight + 34);
    this.root.style.setProperty('--nw', `${OPEN_W}px`);
    this.root.style.setProperty('--nh', `${h}px`);
  }

  /** Screen area the notch covers right now (for keeping the bubble clear). */
  rect(): { x: number; y: number; width: number; height: number } {
    const w = parseFloat(this.root.style.getPropertyValue('--nw')) || SIZES.rest.w;
    const h = parseFloat(this.root.style.getPropertyValue('--nh')) || SIZES.rest.h;
    return { x: (window.innerWidth - w) / 2, y: 0, width: w, height: h };
  }
}
