// Pure capture-source matching (kept free of Electron imports so it can be unit tested).

export interface SourceLike {
  display_id: string;
}

/**
 * Pick the capture source for `display`. Only falls back to the single
 * available source when there is exactly one display, because some drivers
 * report an empty display_id. Pure for testing.
 */
export function pickSource<T extends SourceLike>(sources: T[], displayId: number, displayCount: number): T | null {
  const exact = sources.find((s) => s.display_id === String(displayId));
  if (exact) return exact;
  if (displayCount === 1 && sources.length === 1) return sources[0]!;
  return null;
}
