// Persistent Assistant Profile Manager for HeyGuy.
// Manages distinct roles, personalities, and prompt constraints for named assistants.
import type { DatabaseStore } from '../storage/db';
import type { AssistantProfile } from '../../shared/types';

export class AssistantProfileManager {
  private activeAssistantId: string = 'default';

  constructor(private readonly db: DatabaseStore) {}

  list(): AssistantProfile[] {
    return this.db.listAssistants();
  }

  get(id: string): AssistantProfile | null {
    return this.db.getAssistant(id);
  }

  getActive(): AssistantProfile {
    const a = this.db.getAssistant(this.activeAssistantId);
    if (a) return a;
    const all = this.db.listAssistants();
    return all[0] ?? {
      id: 'default',
      name: 'HeyGuy',
      role: 'Companion',
      systemPrompt: 'You are HeyGuy, a helpful AI companion.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  setActive(id: string): boolean {
    const existing = this.db.getAssistant(id);
    if (!existing) return false;
    this.activeAssistantId = id;
    return true;
  }

  create(profile: Omit<AssistantProfile, 'id' | 'createdAt' | 'updatedAt'>): AssistantProfile {
    return this.db.createAssistant(profile);
  }
}

