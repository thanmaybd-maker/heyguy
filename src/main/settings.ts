// Settings persisted in userData/settings.json. API keys are encrypted with Electron safeStorage (DPAPI on Windows); if encryption is unavailable
// they are kept in memory for this session only (see secrets.ts).
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { HotkeyCommand, HotkeyStatus, Provider, PublicSettings, SettingsUpdate } from '../shared/types';
import { DEFAULT_HOTKEYS, HOTKEY_COMMANDS, validateAccelerator } from '../shared/hotkeys';
import { decodeSecret, encodeSecret, type Cipher } from './secrets';
import { resolveAgyBinary, normalizeAntigravityModel } from './ai/antigravity';

type KeyName = 'anthropicKeyEnc' | 'geminiKeyEnc' | 'openaiKeyEnc' | 'deepseekKeyEnc';

const cipher: Cipher = {
  available: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptStringAsync(plain),
  decrypt: async (data) => (await safeStorage.decryptStringAsync(data)).result,
};

interface Stored {
  provider: Provider;
  anthropicModel: string;
  geminiModel: string;
  openaiModel: string;
  deepseekModel: string;
  antigravityModel: string;
  googleAccountEmail: string;
  userName: string;
  anthropicKeyEnc: string;
  geminiKeyEnc: string;
  openaiKeyEnc: string;
  deepseekKeyEnc: string;
  voiceReplies: boolean;
  captionsEnabled: boolean;
  ttsVoice: string;
  ttsRate: number;
  hotkeys: Record<HotkeyCommand, string>;
}

const DEFAULTS: Stored = {
  provider: 'antigravity',
  anthropicModel: 'claude-sonnet-5-5',
  geminiModel: 'gemini-3.8-flash',
  openaiModel: 'gpt-4o',
  deepseekModel: 'deepseek-chat',
  antigravityModel: 'gemini-3.8-flash-high',
  googleAccountEmail: 'thanmaybd@gmail.com',
  userName: '',
  anthropicKeyEnc: '',
  geminiKeyEnc: '',
  openaiKeyEnc: '',
  deepseekKeyEnc: '',
  voiceReplies: true,
  captionsEnabled: false,
  ttsVoice: '',
  ttsRate: 1.05,
  hotkeys: { ...DEFAULT_HOTKEYS },
};

/** Tiny .env reader (KEY=value lines) so `npm start` picks up keys during development. */
function loadDotEnv(): void {
  const file = path.join(app.getAppPath(), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2]!.replace(/^['"]|['"]$/g, '');
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
}

export class SettingsStore {
  private data: Stored;
  private readonly file: string;
  /** decrypted keys/tokens, held in memory */
  private readonly plain: Record<KeyName, string> = {
    anthropicKeyEnc: '',
    geminiKeyEnc: '',
    openaiKeyEnc: '',
    deepseekKeyEnc: '',
  };
  private encryption = false;

  /** Settings need async decryption, so build them with `await SettingsStore.load()`. */
  static async load(): Promise<SettingsStore> {
    const store = new SettingsStore();
    await store.unlock();
    return store;
  }

  private constructor() {
    loadDotEnv();
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    if (existsSync(this.file)) {
      try {
        const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stored>;
        this.data = {
          ...DEFAULTS,
          ...saved,
          antigravityModel: saved.antigravityModel?.trim() || DEFAULTS.antigravityModel,
          googleAccountEmail: saved.googleAccountEmail?.trim() || DEFAULTS.googleAccountEmail,
          hotkeys: { ...DEFAULT_HOTKEYS, ...saved.hotkeys },
        };
      } catch (err) {
        console.error('[settings] settings.json unreadable, using defaults:', err);
      }
    }
    const envModel = process.env.HEYGUY_PROVIDER;
    if (
      envModel === 'anthropic' ||
      envModel === 'gemini' ||
      envModel === 'openai' ||
      envModel === 'deepseek' ||
      envModel === 'antigravity'
    ) {
      this.data.provider = envModel;
    }
  }

  private async unlock(): Promise<void> {
    this.encryption = await cipher.available();
    let dirty = false;
    for (const name of [
      'anthropicKeyEnc',
      'geminiKeyEnc',
      'openaiKeyEnc',
      'deepseekKeyEnc',
    ] as const) {
      const { value, legacyPlain } = await decodeSecret(this.data[name] || '', cipher);
      this.plain[name] = value;
      if (legacyPlain) {
        this.data[name] = (await encodeSecret(value, cipher)) ?? '';
        dirty = true;
      }
    }
    if (dirty) this.persist();
  }

  private async setKey(name: KeyName, value: string): Promise<void> {
    this.plain[name] = value;
    this.data[name] = (await encodeSecret(value, cipher)) ?? '';
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  anthropicKey(): string {
    return this.plain.anthropicKeyEnc || process.env.ANTHROPIC_API_KEY || '';
  }

  geminiKey(): string {
    return this.plain.geminiKeyEnc || process.env.GEMINI_API_KEY || '';
  }

  openaiKey(): string {
    return this.plain.openaiKeyEnc || process.env.OPENAI_API_KEY || '';
  }

  deepseekKey(): string {
    return this.plain.deepseekKeyEnc || process.env.DEEPSEEK_API_KEY || '';
  }

  get raw(): Readonly<Stored> {
    return this.data;
  }

  /** Provider to use: the chosen one if it has a key / OAuth / CLI, otherwise whichever is ready. */
  activeProvider(): Provider | null {
    const hasAgy = !!resolveAgyBinary() || !!this.geminiKey();
    const has = {
      antigravity: hasAgy,
      anthropic: !!this.anthropicKey(),
      gemini: !!this.geminiKey(),
      openai: !!this.openaiKey(),
      deepseek: !!this.deepseekKey(),
    };
    if (has[this.data.provider]) return this.data.provider;
    if (has.antigravity) return 'antigravity';
    if (has.anthropic) return 'anthropic';
    if (has.gemini) return 'gemini';
    if (has.openai) return 'openai';
    if (has.deepseek) return 'deepseek';
    return null;
  }

  public(hotkeyStatus: Record<HotkeyCommand, HotkeyStatus>): PublicSettings {
    const hasCli = !!resolveAgyBinary();
    return {
      provider: this.data.provider,
      anthropicModel: this.data.anthropicModel || DEFAULTS.anthropicModel,
      geminiModel: this.data.geminiModel || DEFAULTS.geminiModel,
      openaiModel: this.data.openaiModel || DEFAULTS.openaiModel,
      deepseekModel: this.data.deepseekModel || DEFAULTS.deepseekModel,
      antigravityModel: this.data.antigravityModel || DEFAULTS.antigravityModel,
      googleAccountEmail: this.data.googleAccountEmail || DEFAULTS.googleAccountEmail,
      userName: this.data.userName ?? '',
      hasAnthropicKey: !!this.anthropicKey(),
      hasGeminiKey: !!this.geminiKey(),
      hasOpenaiKey: !!this.openaiKey(),
      hasDeepseekKey: !!this.deepseekKey(),
      hasAntigravityCli: hasCli,
      voiceReplies: this.data.voiceReplies,
      captionsEnabled: this.data.captionsEnabled,
      ttsVoice: this.data.ttsVoice,
      ttsRate: this.data.ttsRate,
      hotkeys: { ...this.data.hotkeys },
      hotkeyStatus,
      keyStorage: this.encryption ? 'encrypted' : 'session-only',
    };
  }

  /** Applies a settings change. Returns true if the hotkeys changed (main must re-register them). */
  async update(u: SettingsUpdate): Promise<boolean> {
    const d = this.data;
    if (
      u.provider === 'anthropic' ||
      u.provider === 'gemini' ||
      u.provider === 'openai' ||
      u.provider === 'deepseek' ||
      u.provider === 'antigravity'
    ) {
      d.provider = u.provider;
    }
    if (typeof u.anthropicModel === 'string' && u.anthropicModel.trim()) d.anthropicModel = u.anthropicModel.trim();
    if (typeof u.geminiModel === 'string' && u.geminiModel.trim()) d.geminiModel = u.geminiModel.trim();
    if (typeof u.openaiModel === 'string' && u.openaiModel.trim()) d.openaiModel = u.openaiModel.trim();
    if (typeof u.deepseekModel === 'string' && u.deepseekModel.trim()) d.deepseekModel = u.deepseekModel.trim();
    if (typeof u.antigravityModel === 'string' && u.antigravityModel.trim()) {
      d.antigravityModel = normalizeAntigravityModel(u.antigravityModel);
    }
    if (typeof u.userName === 'string') d.userName = u.userName.trim().slice(0, 40);
    if (typeof u.googleAccountEmail === 'string' && u.googleAccountEmail.trim()) {
      d.googleAccountEmail = u.googleAccountEmail.trim();
    }
    if (typeof u.anthropicKey === 'string') await this.setKey('anthropicKeyEnc', u.anthropicKey.trim());
    if (typeof u.geminiKey === 'string') await this.setKey('geminiKeyEnc', u.geminiKey.trim());
    if (typeof u.openaiKey === 'string') await this.setKey('openaiKeyEnc', u.openaiKey.trim());
    if (typeof u.deepseekKey === 'string') await this.setKey('deepseekKeyEnc', u.deepseekKey.trim());
    if (typeof u.voiceReplies === 'boolean') d.voiceReplies = u.voiceReplies;
    if (typeof u.captionsEnabled === 'boolean') d.captionsEnabled = u.captionsEnabled;
    if (typeof u.ttsVoice === 'string') d.ttsVoice = u.ttsVoice;
    if (typeof u.ttsRate === 'number' && Number.isFinite(u.ttsRate)) d.ttsRate = Math.min(2, Math.max(0.6, u.ttsRate));
    let hotkeysChanged = false;
    for (const cmd of HOTKEY_COMMANDS) {
      const next = u.hotkeys?.[cmd];
      if (typeof next === 'string' && !validateAccelerator(next) && next !== d.hotkeys[cmd]) {
        d.hotkeys[cmd] = next;
        hotkeysChanged = true;
      }
    }
    this.persist();
    return hotkeysChanged;
  }
}
