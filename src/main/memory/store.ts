// Memory manager for HeyGuy.
// Maintains user preferences, learned facts, and contextual instructions across days.
// Injects relevant memories into conversation system prompts without unbounded token growth.
import type { DatabaseStore } from '../storage/db';
import type { MemoryCategory, MemoryRecord } from '../../shared/types';

export class MemoryStore {
  constructor(private readonly db: DatabaseStore) {}

  /**
   * Adds or updates a memory record.
   */
  remember(
    category: MemoryCategory,
    key: string,
    content: string,
    confidence: number = 0.9,
    provenance?: string
  ): MemoryRecord {
    // Check if an existing memory with the same key and category exists
    const existing = this.db.listMemories(category).find((m) => m.key.toLowerCase() === key.toLowerCase());
    if (existing) {
      const updated = this.db.updateMemory(existing.id, {
        content,
        confidence: Math.max(existing.confidence, confidence),
        provenance,
      });
      if (updated) return updated;
    }

    return this.db.addMemory({
      category,
      key,
      content,
      confidence,
      provenance,
    });
  }

  forget(id: string): boolean {
    return this.db.deleteMemory(id);
  }

  get(id: string): MemoryRecord | null {
    return this.db.getMemory(id);
  }

  list(category?: MemoryCategory, limit?: number): MemoryRecord[] {
    return this.db.listMemories(category, limit);
  }

  search(query: string, limit?: number): MemoryRecord[] {
    return this.db.searchMemories(query, limit);
  }

  /**
   * Extracts explicit preferences or facts from conversational user turns.
   * Recognizes patterns like "I prefer X", "Remember that X", "My name is X", "Always do X".
   */
  extractFromConversation(text: string, provenance?: string): MemoryRecord[] {
    const extracted: MemoryRecord[] = [];
    const trimmed = text.trim();

    // "Remember that <fact>" or "Remember: <fact>"
    const rememberMatch = trimmed.match(/remember(?:\s+that|:)\s+([^.!?\n]+)/i);
    if (rememberMatch && rememberMatch[1]) {
      const fact = rememberMatch[1].trim();
      extracted.push(this.remember('fact', fact.slice(0, 30), fact, 0.95, provenance));
    }

    // "I prefer <preference>"
    const preferMatch = trimmed.match(/i\s+prefer\s+([^.!?\n]+)/i);
    if (preferMatch && preferMatch[1]) {
      const pref = `User prefers ${preferMatch[1].trim()}`;
      extracted.push(this.remember('preference', 'preference', pref, 0.9, provenance));
    }

    // "My name is <name>"
    const nameMatch = trimmed.match(/my\s+name\s+is\s+([A-Za-z]+)/i);
    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();
      extracted.push(this.remember('fact', 'user_name', `User's name is ${name}`, 1.0, provenance));
    }

    // "Always <instruction>"
    const alwaysMatch = trimmed.match(/always\s+([^.!?\n]+)/i);
    if (alwaysMatch && alwaysMatch[1] && !trimmed.toLowerCase().startsWith('is it always')) {
      const inst = `Always ${alwaysMatch[1].trim()}`;
      extracted.push(this.remember('instruction', inst.slice(0, 30), inst, 0.85, provenance));
    }

    return extracted;
  }

  /**
   * Retrieves contextually relevant memories for a user prompt to inject into LLM system prompts.
   */
  formatContextForPrompt(prompt: string, maxItems: number = 5): string {
    const words = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const candidates = new Map<string, { memory: MemoryRecord; score: number }>();

    // Direct search for matching words
    for (const word of words) {
      const matches = this.db.searchMemories(word, 10);
      for (const m of matches) {
        const cur = candidates.get(m.id);
        const score = (cur ? cur.score : 0) + m.confidence;
        candidates.set(m.id, { memory: m, score });
      }
    }

    // Also include high-confidence preferences and instructions
    const staticHighPriority = this.db.listMemories(undefined, 20).filter(
      (m) => (m.category === 'preference' || m.category === 'instruction') && m.confidence >= 0.9
    );
    for (const m of staticHighPriority) {
      if (!candidates.has(m.id)) {
        candidates.set(m.id, { memory: m, score: m.confidence * 0.5 });
      }
    }

    if (candidates.size === 0) return '';

    const sorted = Array.from(candidates.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems)
      .map((c) => c.memory);

    const lines = sorted.map((m) => `- [${m.category.toUpperCase()}] ${m.content}`);
    return `\n\n[Persistent User Context & Preferences]\n${lines.join('\n')}\n`;
  }
}

