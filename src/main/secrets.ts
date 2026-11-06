// Secret persistence rules. Keys are only written to disk when OS encryption
// (DPAPI on Windows) is available. Otherwise they live in memory for the
// session — never as Base64 "pretend encryption". Pure so it can be tested.

export interface Cipher {
  available(): Promise<boolean>;
  encrypt(plain: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<string>;
}

export type Decoded = { value: string; legacyPlain: boolean };

/** Encode for disk, or null when it must not be persisted. */
export async function encodeSecret(plain: string, cipher: Cipher): Promise<string | null> {
  if (!plain) return '';
  if (!(await cipher.available())) return null;
  return 'enc:' + (await cipher.encrypt(plain)).toString('base64');
}

/**
 * Decode a stored value. Old builds wrote `raw:` (Base64, not encrypted);
 * we still read it once so users don't lose keys, and flag it for migration.
 */
export async function decodeSecret(stored: string, cipher: Cipher): Promise<Decoded> {
  if (!stored) return { value: '', legacyPlain: false };
  const kind = stored.slice(0, 4);
  const data = stored.slice(4);
  if (kind === 'raw:') return { value: Buffer.from(data, 'base64').toString('utf8'), legacyPlain: true };
  if (kind === 'enc:' && (await cipher.available())) {
    try {
      return { value: await cipher.decrypt(Buffer.from(data, 'base64')), legacyPlain: false };
    } catch {
      return { value: '', legacyPlain: false };
    }
  }
  return { value: '', legacyPlain: false };
}
