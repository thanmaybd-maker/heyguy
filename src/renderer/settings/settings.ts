// Settings window: API keys, models, voice, hotkey reference.
import type { HotkeyCommand, Provider, PublicSettings, SettingsUpdate } from '../../shared/types';
import { DEFAULT_HOTKEYS, HOTKEY_COMMANDS, acceleratorFromKey, prettyAccelerator, validateAccelerator } from '../../shared/hotkeys';

const api = window.heyguySettings;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('form');
const keyInputs = {
  anthropicKey: $<HTMLInputElement>('anthropicKey'),
  geminiKey: $<HTMLInputElement>('geminiKey'),
  openaiKey: $<HTMLInputElement>('openaiKey'),
  deepseekKey: $<HTMLInputElement>('deepseekKey'),
};
const clearFlags = { anthropicKey: false, geminiKey: false, openaiKey: false, deepseekKey: false };
const voiceSel = $<HTMLSelectElement>('ttsVoice');
const rate = $<HTMLInputElement>('ttsRate');
let current: PublicSettings;
/** hotkeys edited in this window but not saved yet */
let draftKeys: Record<HotkeyCommand, string> = { ...DEFAULT_HOTKEYS };
let recording: HotkeyCommand | null = null;
let keyError: { cmd: HotkeyCommand; message: string } | null = null;

const KEY_LABELS: Record<HotkeyCommand, string> = {
  talk: 'Talk — press, speak, it sends when you pause',
  explain: 'Explain my screen',
  type: 'Type a question',
  dismiss: 'Dismiss / stop',
  snip: 'Highlight or box area to ask about',
};

function fill(s: PublicSettings): void {
  current = s;
  const prov = s.provider || 'antigravity';
  const radio = form.querySelector(`input[name="provider"][value="${prov}"]`) as HTMLInputElement | null;
  if (radio) radio.checked = true;
  $<HTMLInputElement>('anthropicModel').value = s.anthropicModel;
  $<HTMLInputElement>('geminiModel').value = s.geminiModel;
  $<HTMLInputElement>('openaiModel').value = s.openaiModel;
  $<HTMLInputElement>('deepseekModel').value = s.deepseekModel;

  const modelSel = $<HTMLSelectElement>('antigravityModel');
  if (!Array.from(modelSel.options).some((o) => o.value === s.antigravityModel)) {
    modelSel.append(new Option(s.antigravityModel, s.antigravityModel));
  }
  modelSel.value = s.antigravityModel;

  const label = s.googleAccountEmail;
  $<HTMLInputElement>('googleAccountEmail').value = label;
  $('googleAvatar').textContent = (label.trim()[0] || '?').toUpperCase();

  setPill('anthropicState', s.hasAnthropicKey);
  setPill('geminiState', s.hasGeminiKey);
  setPill('openaiState', s.hasOpenaiKey);
  setPill('deepseekState', s.hasDeepseekKey);

  // Whether agy is actually signed in can only be proven by a real request, so the pill never claims it.
  const agyEl = $('antigravityState');
  agyEl.textContent = s.hasAntigravityCli ? 'CLI found' : 'CLI not found';
  agyEl.dataset.on = String(s.hasAntigravityCli);
  $('googleAuthModeLabel').textContent = s.hasAntigravityCli
    ? 'Press Test to confirm it is signed in'
    : 'Install Antigravity from antigravity.google';
  $<HTMLButtonElement>('btnGoogleLogin').disabled = !s.hasAntigravityCli;

  void refreshUsage();
  if (s.keyStorage === 'session-only') {
    $('saved').textContent = 'Secure storage is unavailable on this PC, so keys are kept only until HeyGuy quits (never written to disk).';
    $('saved').dataset.tone = 'error';
  }
  keyInputs.anthropicKey.placeholder = s.hasAnthropicKey ? '•••••••• saved — type to replace' : 'sk-ant-…';
  keyInputs.geminiKey.placeholder = s.hasGeminiKey ? '•••••••• saved — type to replace' : 'AIza…';
  keyInputs.openaiKey.placeholder = s.hasOpenaiKey ? '•••••••• saved — type to replace' : 'sk-…';
  keyInputs.deepseekKey.placeholder = s.hasDeepseekKey ? '•••••••• saved — type to replace' : 'sk-…';
  $<HTMLInputElement>('voiceReplies').checked = s.voiceReplies;
  $<HTMLInputElement>('captionsEnabled').checked = s.captionsEnabled;
  rate.value = String(s.ttsRate);
  $('rateOut').textContent = `${s.ttsRate.toFixed(2)}×`;
  draftKeys = { ...s.hotkeys };
  recording = null;
  keyError = null;
  renderKeys();
  fillVoices();
}

function renderKeys(): void {
  const box = $('keys');
  box.replaceChildren();
  for (const cmd of HOTKEY_COMMANDS) {
    const row = document.createElement('div');
    row.className = 'key-row';
    const name = document.createElement('span');
    name.className = 'key-name';
    name.textContent = KEY_LABELS[cmd];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key-btn';
    btn.dataset.recording = String(recording === cmd);
    btn.setAttribute('aria-label', `Change hotkey for ${KEY_LABELS[cmd]}`);
    if (recording === cmd) {
      btn.textContent = 'Press keys… (Esc cancels)';
    } else {
      for (const part of prettyAccelerator(draftKeys[cmd]).split('+')) {
        const k = document.createElement('kbd');
        k.textContent = part;
        btn.append(k);
      }
    }
    btn.addEventListener('click', () => {
      recording = recording === cmd ? null : cmd;
      keyError = null;
      renderKeys();
    });
    row.append(name, btn);
    const unsaved = draftKeys[cmd] !== current.hotkeys[cmd];
    const status = current.hotkeyStatus[cmd];
    const note = document.createElement('span');
    note.className = 'key-note';
    if (keyError?.cmd === cmd) {
      note.textContent = keyError.message;
      note.dataset.tone = 'error';
    } else if (unsaved) {
      note.textContent = 'unsaved';
    } else if (status === 'taken') {
      note.textContent = 'taken by another app — pick other keys';
      note.dataset.tone = 'error';
    } else if (status === 'invalid') {
      note.textContent = 'invalid';
      note.dataset.tone = 'error';
    }
    row.append(note);
    box.append(row);
  }
}

window.addEventListener(
  'keydown',
  (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      recording = null;
      keyError = null;
      return renderKeys();
    }
    const accel = acceleratorFromKey(e);
    if (!accel) return; // only modifiers so far
    const cmd = recording;
    const problem =
      validateAccelerator(accel) ??
      (HOTKEY_COMMANDS.find((c) => c !== cmd && draftKeys[c] === accel)
        ? `Already used for "${KEY_LABELS[HOTKEY_COMMANDS.find((c) => c !== cmd && draftKeys[c] === accel)!]}".`
        : null);
    if (problem) {
      keyError = { cmd, message: problem };
    } else {
      draftKeys[cmd] = accel;
      keyError = null;
      recording = null;
    }
    renderKeys();
  },
  true,
);

$('resetKeys').addEventListener('click', () => {
  draftKeys = { ...DEFAULT_HOTKEYS };
  recording = null;
  keyError = null;
  renderKeys();
});

function setPill(id: string, has: boolean): void {
  const el = $(id);
  el.textContent = has ? 'saved' : 'not set';
  el.dataset.on = String(has);
}

function fillVoices(): void {
  const voices = speechSynthesis.getVoices();
  voiceSel.replaceChildren();
  const auto = new Option('Automatic (best English voice)', '');
  voiceSel.append(auto);
  for (const v of voices) voiceSel.append(new Option(`${v.name} — ${v.lang}`, v.name));
  voiceSel.value = current?.ttsVoice ?? '';
}
speechSynthesis.addEventListener('voiceschanged', fillVoices);

rate.addEventListener('input', () => ($('rateOut').textContent = `${Number(rate.value).toFixed(2)}×`));

$('preview').addEventListener('click', () => {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance("Hey! I'm HeyGuy. Ask me about anything on your screen.");
  const v = speechSynthesis.getVoices().find((x) => x.name === voiceSel.value);
  if (v) u.voice = v;
  u.rate = Number(rate.value);
  speechSynthesis.speak(u);
});

for (const btn of form.querySelectorAll<HTMLButtonElement>('[data-clear]')) {
  btn.addEventListener('click', () => {
    const id = btn.dataset.clear as keyof typeof keyInputs;
    keyInputs[id].value = '';
    clearFlags[id] = true;
    const stateId =
      id === 'anthropicKey'
        ? 'anthropicState'
        : id === 'geminiKey'
          ? 'geminiState'
          : id === 'deepseekKey'
            ? 'deepseekState'
            : 'openaiState';
    setPill(stateId, false);
    $('saved').textContent = 'Key will be removed when you save.';
  });
}

function collect(): SettingsUpdate {
  const u: SettingsUpdate = {
    provider: (form.querySelector('input[name="provider"]:checked') as HTMLInputElement).value as Provider,
    anthropicModel: $<HTMLInputElement>('anthropicModel').value,
    geminiModel: $<HTMLInputElement>('geminiModel').value,
    openaiModel: $<HTMLInputElement>('openaiModel').value,
    deepseekModel: $<HTMLInputElement>('deepseekModel').value,
    antigravityModel: $<HTMLSelectElement>('antigravityModel').value,
    googleAccountEmail: $<HTMLInputElement>('googleAccountEmail').value.trim(),
    voiceReplies: $<HTMLInputElement>('voiceReplies').checked,
    captionsEnabled: $<HTMLInputElement>('captionsEnabled').checked,
    ttsVoice: voiceSel.value,
    ttsRate: Number(rate.value),
    hotkeys: { ...draftKeys },
  };
  for (const id of ['anthropicKey', 'geminiKey', 'openaiKey', 'deepseekKey'] as const) {
    const v = keyInputs[id].value.trim();
    if (v) u[id] = v;
    else if (clearFlags[id]) u[id] = '';
  }
  return u;
}

async function save(): Promise<void> {
  const s = await api.save(collect());
  keyInputs.anthropicKey.value = '';
  keyInputs.geminiKey.value = '';
  keyInputs.openaiKey.value = '';
  keyInputs.deepseekKey.value = '';
  clearFlags.anthropicKey = clearFlags.geminiKey = clearFlags.openaiKey = clearFlags.deepseekKey = false;
  fill(s);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saved = $('saved');
  try {
    await save();
    const taken = HOTKEY_COMMANDS.filter((c) => current.hotkeyStatus[c] !== 'ok');
    saved.textContent = taken.length
      ? `Saved, but ${taken.map((c) => prettyAccelerator(current.hotkeys[c])).join(', ')} is taken by another app.`
      : `Saved. Press ${prettyAccelerator(current.hotkeys.explain)} to try it.`;
    saved.dataset.tone = taken.length ? 'error' : 'ok';
  } catch (err) {
    saved.textContent = `Couldn't save: ${err instanceof Error ? err.message : String(err)}`;
    saved.dataset.tone = 'error';
  }
});

async function refreshUsage(): Promise<void> {
  try {
    if (typeof api.getUsage !== 'function') return;
    const u = await api.getUsage();
    const info = $('antigravityUsageInfo');
    if (info && u) {
      info.textContent = u.totalRequests
        ? `${u.activeModel}: ${u.totalRequests} request(s), ${u.totalTokens.toLocaleString()} tokens reported by agy`
        : 'No requests yet this session.';
    }
  } catch {
    // ignore
  }
}

$<HTMLInputElement>('googleAccountEmail').addEventListener('input', (e) => {
  const v = (e.target as HTMLInputElement).value.trim();
  $('googleAvatar').textContent = (v[0] || '?').toUpperCase();
});

$<HTMLButtonElement>('btnGoogleLogin').addEventListener('click', async () => {
  const out = $('antigravityResult');
  try {
    const r = await api.agySignIn();
    out.textContent = r.message;
    out.dataset.tone = r.ok ? 'ok' : 'error';
  } catch (err) {
    out.textContent = err instanceof Error ? err.message : String(err);
    out.dataset.tone = 'error';
  }
});

$<HTMLButtonElement>('btnRefreshUsage').addEventListener('click', () => {
  void refreshUsage();
});

for (const btn of form.querySelectorAll<HTMLButtonElement>('[data-test]')) {
  btn.addEventListener('click', async () => {
    const p = btn.dataset.test as Provider;
    const out = $(
      p === 'antigravity'
        ? 'antigravityResult'
        : p === 'anthropic'
          ? 'anthropicResult'
          : p === 'gemini'
            ? 'geminiResult'
            : p === 'deepseek'
              ? 'deepseekResult'
              : 'openaiResult',
    );
    btn.disabled = true;
    out.dataset.tone = '';
    out.textContent = 'Saving and testing…';
    try {
      await save();
      const r = await api.test(p);
      out.textContent = r.message;
      out.dataset.tone = r.ok ? 'ok' : 'error';
    } catch (err) {
      out.textContent = err instanceof Error ? err.message : String(err);
      out.dataset.tone = 'error';
    } finally {
      btn.disabled = false;
    }
  });
}

api.get().then(fill, (err) => {
  $('saved').textContent = `Couldn't load settings: ${err instanceof Error ? err.message : String(err)}`;
});
