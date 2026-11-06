// Hotkey defaults, validation and display helpers (shared by main + settings UI).
import type { HotkeyCommand } from './types';

/**
 * Defaults avoid Ctrl+Alt entirely: HeyClicky (and AltGr on many keyboard layouts)
 * treat any Ctrl+Alt combination as their own, so they would steal our keys.
 */
export const DEFAULT_HOTKEYS: Record<HotkeyCommand, string> = {
  talk: 'Control+Shift+Space',
  explain: 'Control+Shift+Y',
  type: 'Control+Shift+U',
  dismiss: 'Control+Shift+Backspace',
  snip: 'Control+Shift+D',
};

export const HOTKEY_COMMANDS: HotkeyCommand[] = ['talk', 'explain', 'type', 'dismiss', 'snip'];

const MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Super']);
const NAMED_KEYS = new Set([
  'Space', 'Backspace', 'Enter', 'Tab', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'Up', 'Down', 'Left', 'Right', 'Plus', '-', '=', ',', '.', '/', ';', "'", '[', ']', '\\', '`',
]);

function isKey(k: string): boolean {
  return /^[A-Z0-9]$/.test(k) || /^F([1-9]|1\d|2[0-4])$/.test(k) || NAMED_KEYS.has(k);
}

/** Returns an error message, or null if `accel` is a usable global hotkey. */
export function validateAccelerator(accel: string): string | null {
  const parts = accel.split('+').filter(Boolean);
  // "Plus" is spelled out, so splitting on "+" is safe
  const mods = parts.slice(0, -1);
  const key = parts[parts.length - 1] ?? '';
  if (!key || MODIFIERS.has(key)) return 'Add a normal key after the modifiers.';
  if (!isKey(key)) return `"${key}" can't be used as a hotkey.`;
  if (mods.length === 0) return 'Use at least one of Ctrl, Alt, Shift or Win.';
  if (mods.some((m) => !MODIFIERS.has(m))) return 'Unknown modifier.';
  if (new Set(mods).size !== mods.length) return 'Repeated modifier.';
  if (mods.length === 1 && mods[0] === 'Shift') return 'Shift alone would block normal typing — add Ctrl, Alt or Win.';
  return null;
}

/** "Control+Shift+Space" → "Ctrl+Shift+Space" */
export function prettyAccelerator(accel: string): string {
  return accel.replace(/\bControl\b/g, 'Ctrl').replace(/\bSuper\b/g, 'Win');
}

const CODE_MAP: Record<string, string> = {
  Space: 'Space', Backspace: 'Backspace', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Delete: 'Delete',
  Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
};

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** Turn a keydown into an Electron accelerator; null while only modifiers are held. */
export function acceleratorFromKey(e: KeyLike): string | null {
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else key = CODE_MAP[e.code];
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return [...mods, key].join('+');
}
