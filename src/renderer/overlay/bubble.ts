// The speech bubble: anchored near the buddy, draggable (then pinned),
// renders streamed text with light formatting (bold, `code`, line breaks, lists).
import type { Pt } from '../../shared/types';
import { intersects, type Rect } from '../../shared/geometry';

const OFFSET = { x: 34, y: 30 };
const MARGIN = 12;

export type BubbleTone = 'normal' | 'error' | 'notice';

export class Bubble {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly you: HTMLElement;
  private readonly reply: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private anchor: Pt = { x: 0, y: 0 };
  /** set when the user drags the bubble */
  private pinned: Pt | null = null;
  /** set when we move the bubble out of the way of drawings */
  private parked: Pt | null = null;
  private text = '';
  private streaming = false;
  hovered = false;
  private dragging = false;

  constructor(
    private readonly handlers: {
      onSubmit: (q: string) => void;
      onClose: () => void;
      onSettings: () => void;
      onTypingEnd: () => void;
      onDragChange: (dragging: boolean) => void;
    },
  ) {
    this.root = byId('bubble');
    this.status = byId('status');
    this.you = byId('you');
    this.reply = byId('reply');
    this.form = byId('ask-form') as HTMLFormElement;
    this.input = byId('ask-input') as HTMLInputElement;

    byId('btn-close').addEventListener('click', () => handlers.onClose());
    byId('btn-settings').addEventListener('click', () => handlers.onSettings());
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = this.input.value.trim();
      if (!q) return;
      this.input.value = '';
      this.hideInput();
      handlers.onSubmit(q);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hideInput();
        if (!this.text) this.hide();
      }
    });
    this.root.addEventListener('mouseenter', () => (this.hovered = true));
    this.root.addEventListener('mouseleave', () => (this.hovered = false));
    this.setupDrag(byId('bubble-head'));
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  get typing(): boolean {
    return !this.form.classList.contains('hidden');
  }

  private setupDrag(handle: HTMLElement): void {
    let start: Pt = { x: 0, y: 0 };
    let origin: Pt = { x: 0, y: 0 };
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button')) return;
      this.dragging = true;
      this.handlers.onDragChange(true);
      handle.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      const r = this.root.getBoundingClientRect();
      origin = { x: r.left, y: r.top };
      this.root.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.pinned = { x: origin.x + e.clientX - start.x, y: origin.y + e.clientY - start.y };
      this.layout();
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.handlers.onDragChange(false);
      handle.releasePointerCapture(e.pointerId);
      this.root.classList.remove('dragging');
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  setAnchor(p: Pt): void {
    this.anchor = p;
    if (!this.pinned && !this.parked) this.layout();
  }

  /** Let the bubble follow the buddy again (new interaction). */
  unpark(): void {
    this.parked = null;
  }

  /** If the bubble covers any of `rects`, move it to the nearest free spot. */
  avoid(rects: Rect[]): void {
    if (this.pinned || !this.visible || rects.length === 0) return;
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cur = this.root.getBoundingClientRect();
    const free = (x: number, y: number) => !rects.some((r) => intersects(r, { x, y, width: w, height: h }));
    if (free(cur.left, cur.top)) return;
    const a = this.anchor;
    const candidates: Pt[] = [
      { x: a.x + OFFSET.x, y: a.y + OFFSET.y },
      { x: a.x - w - OFFSET.x, y: a.y + OFFSET.y },
      { x: a.x + OFFSET.x, y: a.y - h - OFFSET.y },
      { x: a.x - w - OFFSET.x, y: a.y - h - OFFSET.y },
      { x: W - w - 24, y: H - h - 24 },
      { x: 24, y: H - h - 24 },
      { x: W - w - 24, y: 24 },
      { x: 24, y: 24 },
    ].map((p) => ({ x: Math.max(MARGIN, Math.min(W - w - MARGIN, p.x)), y: Math.max(MARGIN, Math.min(H - h - MARGIN, p.y)) }));
    const spot = candidates.find((p) => free(p.x, p.y));
    if (!spot) return;
    this.parked = spot;
    this.layout();
  }

  /** Keep the bubble inside the screen, flipping sides near edges. */
  layout(): void {
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    let x: number;
    let y: number;
    const fixed = this.pinned ?? this.parked;
    if (fixed) {
      ({ x, y } = fixed);
    } else {
      x = this.anchor.x + OFFSET.x;
      y = this.anchor.y + OFFSET.y;
      if (x + w > W - MARGIN) x = this.anchor.x - w - OFFSET.x * 0.6;
      if (y + h > H - MARGIN) y = this.anchor.y - h - 10;
    }
    x = Math.max(MARGIN, Math.min(W - w - MARGIN, x));
    y = Math.max(MARGIN, Math.min(H - h - MARGIN, y));
    this.root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.layout();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.hideInput();
    this.pinned = null;
    this.parked = null;
    this.hovered = false;
  }

  setStatus(label: string, kind: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'): void {
    this.status.textContent = label;
    this.root.dataset.state = kind;
  }

  setYou(text: string): void {
    this.you.textContent = text;
    this.you.classList.toggle('hidden', !text);
    this.layout();
  }

  /** Replace the reply area with a one-off message (error, notice, hint). */
  setMessage(text: string, tone: BubbleTone): void {
    this.text = text;
    this.streaming = false;
    this.reply.dataset.tone = tone;
    renderRich(this.reply, text, false);
    this.layout();
  }

  clearReply(): void {
    this.text = '';
    this.streaming = false;
    this.reply.dataset.tone = 'normal';
    this.reply.replaceChildren();
  }

  startReply(): void {
    this.text = '';
    this.streaming = true;
    this.reply.dataset.tone = 'normal';
    renderRich(this.reply, '', true);
    this.layout();
  }

  appendReply(delta: string): void {
    this.text += delta;
    renderRich(this.reply, this.text.trimStart(), this.streaming);
    this.reply.scrollTop = this.reply.scrollHeight;
    this.layout();
  }

  endReply(finalText: string): void {
    this.streaming = false;
    this.text = finalText;
    renderRich(this.reply, finalText, false);
    this.layout();
  }

  showInput(): void {
    this.show();
    this.form.classList.remove('hidden');
    this.layout();
    // focus after the window has become focusable
    setTimeout(() => this.input.focus(), 30);
  }

  hideInput(): void {
    if (this.form.classList.contains('hidden')) return;
    this.form.classList.add('hidden');
    this.input.blur();
    this.handlers.onTypingEnd();
    this.layout();
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from overlay HTML`);
  return el;
}

/** Safe tiny formatter: builds DOM nodes (never innerHTML) for **bold**, `code`, lines and list items. */
export function renderRich(el: HTMLElement, text: string, caret: boolean): void {
  const frag = document.createDocumentFragment();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const row = document.createElement('div');
    const listItem = /^\s*(\d+[.)]|[-•*])\s+/.exec(line);
    row.className = listItem ? 'line li' : line.trim() ? 'line' : 'line gap';
    const body = listItem ? line.slice(listItem[0].length) : line;
    if (listItem) {
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = /\d/.test(listItem[1]!) ? listItem[1]!.replace(')', '.') : '•';
      row.append(mark);
    }
    const content = document.createElement('span');
    for (const tok of body.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (!tok) continue;
      if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
        const b = document.createElement('strong');
        b.textContent = tok.slice(2, -2);
        content.append(b);
      } else if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
        const c = document.createElement('code');
        c.textContent = tok.slice(1, -1);
        content.append(c);
      } else {
        content.append(document.createTextNode(tok));
      }
    }
    row.append(content);
    if (caret && i === lines.length - 1) {
      const c = document.createElement('span');
      c.className = 'caret';
      row.append(c);
    }
    frag.append(row);
  });
  el.replaceChildren(frag);
}
