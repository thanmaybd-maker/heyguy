// Durable conversation and scene storage using Node/Electron's built-in node:sqlite.
// Persists sessions, turns, messages, and validated 2D/3D scenes across days.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import type {
  ArtifactRecord,
  AssistantProfile,
  ChatTurn,
  JobApprovalRequest,
  JobRecord,
  JobStatus,
  JobStep,
  MemoryCategory,
  MemoryRecord,
  RoutineRecord,
  SearchResult,
  SessionSummary,
  StoredMessage,
  StoredScene,
} from '../../shared/types';
import type { Scene } from '../../shared/scene';

export class DatabaseStore {
  private readonly db: DatabaseSync;

  constructor(location: string = ':memory:') {
    this.db = new DatabaseSync(location);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        clean_text TEXT NOT NULL,
        has_scene INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step_index INTEGER NOT NULL DEFAULT 0,
        requires_approval TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS job_steps (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        description TEXT NOT NULL,
        tool_name TEXT,
        tool_input TEXT,
        tool_output TEXT,
        status TEXT NOT NULL,
        started_at INTEGER,
        finished_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL,
        provenance TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule_value TEXT NOT NULL,
        timezone TEXT NOT NULL,
        allowed_tools TEXT NOT NULL,
        budget_tokens INTEGER,
        status TEXT NOT NULL,
        missed_run_policy TEXT NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assistants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        avatar TEXT,
        color TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_scenes_session ON scenes(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_scenes_id ON scenes(id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_job_steps ON job_steps(job_id, step_index);
      CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);
      CREATE INDEX IF NOT EXISTS idx_memories_cat ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
      CREATE INDEX IF NOT EXISTS idx_routines_status ON routines(status, next_run_at);
    `);

    this.seedDefaultAssistants();
  }

  createSession(title: string = 'New Conversation'): SessionSummary {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      'INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(id, title, now, now);
    return { id, title, createdAt: now, updatedAt: now, messageCount: 0, sceneCount: 0 };
  }

  getOrCreateActiveSession(): SessionSummary {
    const row = this.db.prepare(
      'SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 1'
    ).get() as { id: string; title: string; created_at: number; updated_at: number } | undefined;

    if (row) {
      const counts = this.countsForSession(row.id);
      return {
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messageCount: counts.messages,
        sceneCount: counts.scenes,
      };
    }
    return this.createSession();
  }

  private countsForSession(sessionId: string): { messages: number; scenes: number } {
    const m = this.db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(sessionId) as { c: number } | undefined;
    const s = this.db.prepare('SELECT COUNT(*) as c FROM scenes WHERE session_id = ?').get(sessionId) as { c: number } | undefined;
    return { messages: m?.c ?? 0, scenes: s?.c ?? 0 };
  }

  listSessions(limit: number = 50): SessionSummary[] {
    const rows = this.db.prepare(`
      SELECT s.id, s.title, s.created_at, s.updated_at,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count,
             (SELECT COUNT(*) FROM scenes sc WHERE sc.session_id = s.id) as scene_count
      FROM sessions s
      ORDER BY s.updated_at DESC
      LIMIT ?
    `).all(limit) as {
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
      message_count: number;
      scene_count: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messageCount: r.message_count,
      sceneCount: r.scene_count,
    }));
  }

  getSession(sessionId: string): { session: SessionSummary; messages: StoredMessage[]; scenes: StoredScene[] } | null {
    const s = this.db.prepare('SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?').get(sessionId) as {
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
    } | undefined;
    if (!s) return null;

    const messages = (this.db.prepare(`
      SELECT id, session_id, turn_id, role, text, clean_text, has_scene, created_at
      FROM messages WHERE session_id = ? ORDER BY rowid ASC
    `).all(sessionId) as {
      id: string;
      session_id: string;
      turn_id: number;
      role: 'user' | 'assistant';
      text: string;
      clean_text: string;
      has_scene: number;
      created_at: number;
    }[]).map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      turnId: m.turn_id,
      role: m.role,
      text: m.text,
      cleanText: m.clean_text,
      hasScene: !!m.has_scene,
      createdAt: m.created_at,
    }));

    const scenes = (this.db.prepare(`
      SELECT id, session_id, turn_id, title, kind, json, created_at
      FROM scenes WHERE session_id = ? ORDER BY rowid ASC
    `).all(sessionId) as {
      id: string;
      session_id: string;
      turn_id: number;
      title: string;
      kind: '2d' | '3d' | 'ui';
      json: string;
      created_at: number;
    }[]).map((sc) => ({
      id: sc.id,
      sessionId: sc.session_id,
      turnId: sc.turn_id,
      title: sc.title,
      kind: sc.kind,
      json: sc.json,
      createdAt: sc.created_at,
    }));

    return {
      session: {
        id: s.id,
        title: s.title,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        messageCount: messages.length,
        sceneCount: scenes.length,
      },
      messages,
      scenes,
    };
  }

  deleteSession(sessionId: string): boolean {
    const res = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return Number(res.changes) > 0;
  }

  addMessage(
    sessionId: string,
    turnId: number,
    role: 'user' | 'assistant',
    text: string,
    cleanText: string,
    hasScene: boolean
  ): StoredMessage {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO messages (id, session_id, turn_id, role, text, clean_text, has_scene, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, turnId, role, text, cleanText, hasScene ? 1 : 0, now);

    // Update session updated_at and title if user message and first message
    const msgCount = (this.db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(sessionId) as { c: number })?.c ?? 0;
    if (msgCount <= 2 && role === 'user' && text.trim()) {
      const summary = text.trim().slice(0, 50);
      this.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(summary, now, sessionId);
    } else {
      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    }

    return {
      id,
      sessionId,
      turnId,
      role,
      text,
      cleanText,
      hasScene,
      createdAt: now,
    };
  }

  saveScene(sessionId: string, turnId: number, scene: Scene): void {
    const now = Date.now();
    const json = JSON.stringify(scene);
    this.db.prepare(`
      INSERT OR REPLACE INTO scenes (id, session_id, turn_id, title, kind, json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(scene.id, sessionId, turnId, scene.title, scene.kind, json, now);
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
  }

  getRecentTurns(sessionId: string, limit: number = 8): ChatTurn[] {
    const rows = this.db.prepare(`
      SELECT role, clean_text FROM (
        SELECT rowid, role, clean_text
        FROM messages
        WHERE session_id = ?
        ORDER BY rowid DESC
        LIMIT ?
      ) ORDER BY rowid ASC
    `).all(sessionId, limit) as { role: 'user' | 'assistant'; clean_text: string }[];

    return rows.map((r) => ({ role: r.role, text: r.clean_text }));
  }

  search(query: string, limit: number = 20): SearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const pattern = `%${trimmed}%`;
    const rows = this.db.prepare(`
      SELECT m.id as message_id, m.session_id, m.role, m.clean_text, m.created_at, s.title as session_title
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      WHERE m.clean_text LIKE ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(pattern, limit) as {
      message_id: string;
      session_id: string;
      role: 'user' | 'assistant';
      clean_text: string;
      created_at: number;
      session_title: string;
    }[];

    return rows.map((r) => {
      const idx = r.clean_text.toLowerCase().indexOf(trimmed.toLowerCase());
      const start = Math.max(0, idx - 30);
      const end = Math.min(r.clean_text.length, idx + trimmed.length + 30);
      const snippet = (start > 0 ? '…' : '') + r.clean_text.slice(start, end) + (end < r.clean_text.length ? '…' : '');
      return {
        sessionId: r.session_id,
        sessionTitle: r.session_title,
        messageId: r.message_id,
        role: r.role,
        matchedSnippet: snippet,
        createdAt: r.created_at,
      };
    });
  }

  getSceneById(sceneId: string): Scene | null {
    const row = this.db.prepare('SELECT json FROM scenes WHERE id = ?').get(sceneId) as { json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.json) as Scene;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- Jobs

  createJob(
    title: string,
    goal: string,
    steps: { description: string; toolName?: string; toolInput?: Record<string, unknown> }[]
  ): JobRecord {
    const jobId = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO jobs (id, title, goal, status, current_step_index, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', 0, ?, ?)
    `).run(jobId, title, goal, now, now);

    const stepRecords: JobStep[] = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      const stepId = randomUUID();
      this.db.prepare(`
        INSERT INTO job_steps (id, job_id, step_index, description, tool_name, tool_input, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(stepId, jobId, i, s.description, s.toolName ?? null, s.toolInput ? JSON.stringify(s.toolInput) : null);
      stepRecords.push({
        id: stepId,
        jobId,
        stepIndex: i,
        description: s.description,
        toolName: s.toolName,
        toolInput: s.toolInput,
        status: 'pending',
      });
    }

    return {
      id: jobId,
      title,
      goal,
      status: 'queued',
      steps: stepRecords,
      currentStepIndex: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateJobStatus(
    jobId: string,
    status: JobStatus,
    error?: string,
    approval?: JobApprovalRequest,
    currentStepIndex?: number
  ): void {
    const now = Date.now();
    const completedAt = status === 'completed' || status === 'failed' || status === 'cancelled' ? now : null;
    const approvalStr = approval ? JSON.stringify(approval) : null;
    if (typeof currentStepIndex === 'number') {
      this.db.prepare(`
        UPDATE jobs
        SET status = ?, error = ?, requires_approval = ?, current_step_index = ?, updated_at = ?, completed_at = COALESCE(completed_at, ?)
        WHERE id = ?
      `).run(status, error ?? null, approvalStr, currentStepIndex, now, completedAt, jobId);
    } else {
      this.db.prepare(`
        UPDATE jobs
        SET status = ?, error = ?, requires_approval = ?, updated_at = ?, completed_at = COALESCE(completed_at, ?)
        WHERE id = ?
      `).run(status, error ?? null, approvalStr, now, completedAt, jobId);
    }
  }

  updateJobStep(
    stepId: string,
    status: JobStep['status'],
    output?: unknown
  ): void {
    const now = Date.now();
    const outStr = output !== undefined ? JSON.stringify(output) : null;
    if (status === 'running') {
      this.db.prepare('UPDATE job_steps SET status = ?, started_at = ? WHERE id = ?').run(status, now, stepId);
    } else {
      this.db.prepare('UPDATE job_steps SET status = ?, tool_output = ?, finished_at = ? WHERE id = ?').run(status, outStr, now, stepId);
    }
  }

  getJob(jobId: string): JobRecord | null {
    const j = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as {
      id: string;
      title: string;
      goal: string;
      status: JobStatus;
      current_step_index: number;
      requires_approval: string | null;
      error: string | null;
      created_at: number;
      updated_at: number;
      completed_at: number | null;
    } | undefined;
    if (!j) return null;

    const stepsRaw = this.db.prepare('SELECT * FROM job_steps WHERE job_id = ? ORDER BY step_index ASC').all(jobId) as {
      id: string;
      job_id: string;
      step_index: number;
      description: string;
      tool_name: string | null;
      tool_input: string | null;
      tool_output: string | null;
      status: JobStep['status'];
      started_at: number | null;
      finished_at: number | null;
    }[];

    const steps: JobStep[] = stepsRaw.map((s) => ({
      id: s.id,
      jobId: s.job_id,
      stepIndex: s.step_index,
      description: s.description,
      toolName: s.tool_name ?? undefined,
      toolInput: s.tool_input ? JSON.parse(s.tool_input) : undefined,
      toolOutput: s.tool_output ? JSON.parse(s.tool_output) : undefined,
      status: s.status,
      startedAt: s.started_at ?? undefined,
      finishedAt: s.finished_at ?? undefined,
    }));

    return {
      id: j.id,
      title: j.title,
      goal: j.goal,
      status: j.status,
      steps,
      currentStepIndex: j.current_step_index,
      requiresApprovalFor: j.requires_approval ? JSON.parse(j.requires_approval) : undefined,
      error: j.error ?? undefined,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
      completedAt: j.completed_at ?? undefined,
    };
  }

  listJobs(limit: number = 50): JobRecord[] {
    const rows = this.db.prepare('SELECT id FROM jobs ORDER BY updated_at DESC LIMIT ?').all(limit) as { id: string }[];
    const result: JobRecord[] = [];
    for (const r of rows) {
      const job = this.getJob(r.id);
      if (job) result.push(job);
    }
    return result;
  }

  // ---------------------------------------------------------------- Artifacts

  saveArtifact(title: string, kind: ArtifactRecord['kind'], content: string, jobId?: string): ArtifactRecord {
    const id = randomUUID();
    const now = Date.now();
    const checksum = createHash('sha256').update(content, 'utf8').digest('hex');
    this.db.prepare(`
      INSERT INTO artifacts (id, job_id, title, kind, content, checksum, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, jobId ?? null, title, kind, content, checksum, now, now);

    return {
      id,
      jobId,
      title,
      kind,
      content,
      checksum,
      createdAt: now,
      updatedAt: now,
    };
  }

  listArtifacts(limit: number = 50): ArtifactRecord[] {
    const rows = this.db.prepare(`
      SELECT id, job_id, title, kind, content, checksum, created_at, updated_at
      FROM artifacts ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as {
      id: string;
      job_id: string | null;
      title: string;
      kind: ArtifactRecord['kind'];
      content: string;
      checksum: string;
      created_at: number;
      updated_at: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      jobId: r.job_id ?? undefined,
      title: r.title,
      kind: r.kind,
      content: r.content,
      checksum: r.checksum,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getArtifact(id: string): ArtifactRecord | null {
    const r = this.db.prepare(`
      SELECT id, job_id, title, kind, content, checksum, created_at, updated_at
      FROM artifacts WHERE id = ?
    `).get(id) as {
      id: string;
      job_id: string | null;
      title: string;
      kind: ArtifactRecord['kind'];
      content: string;
      checksum: string;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!r) return null;
    return {
      id: r.id,
      jobId: r.job_id ?? undefined,
      title: r.title,
      kind: r.kind,
      content: r.content,
      checksum: r.checksum,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ---------------------------------------------------------------- Memory

  addMemory(record: Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'>): MemoryRecord {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO memories (id, category, key, content, confidence, provenance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, record.category, record.key, record.content, record.confidence, record.provenance ?? null, now, now);

    return {
      id,
      category: record.category,
      key: record.key,
      content: record.content,
      confidence: record.confidence,
      provenance: record.provenance,
      createdAt: now,
      updatedAt: now,
    };
  }

  getMemory(id: string): MemoryRecord | null {
    const r = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as {
      id: string;
      category: MemoryCategory;
      key: string;
      content: string;
      confidence: number;
      provenance: string | null;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!r) return null;
    return {
      id: r.id,
      category: r.category,
      key: r.key,
      content: r.content,
      confidence: r.confidence,
      provenance: r.provenance ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listMemories(category?: MemoryCategory, limit: number = 100): MemoryRecord[] {
    let rows: {
      id: string;
      category: MemoryCategory;
      key: string;
      content: string;
      confidence: number;
      provenance: string | null;
      created_at: number;
      updated_at: number;
    }[];

    if (category) {
      rows = this.db.prepare(`
        SELECT id, category, key, content, confidence, provenance, created_at, updated_at
        FROM memories WHERE category = ? ORDER BY updated_at DESC LIMIT ?
      `).all(category, limit) as typeof rows;
    } else {
      rows = this.db.prepare(`
        SELECT id, category, key, content, confidence, provenance, created_at, updated_at
        FROM memories ORDER BY updated_at DESC LIMIT ?
      `).all(limit) as typeof rows;
    }

    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      key: r.key,
      content: r.content,
      confidence: r.confidence,
      provenance: r.provenance ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  searchMemories(query: string, limit: number = 20): MemoryRecord[] {
    const trimmed = query.trim();
    if (!trimmed) return this.listMemories(undefined, limit);

    const pattern = `%${trimmed}%`;
    const rows = this.db.prepare(`
      SELECT id, category, key, content, confidence, provenance, created_at, updated_at
      FROM memories
      WHERE content LIKE ? OR key LIKE ?
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `).all(pattern, pattern, limit) as {
      id: string;
      category: MemoryCategory;
      key: string;
      content: string;
      confidence: number;
      provenance: string | null;
      created_at: number;
      updated_at: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      key: r.key,
      content: r.content,
      confidence: r.confidence,
      provenance: r.provenance ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  updateMemory(id: string, updates: Partial<Pick<MemoryRecord, 'content' | 'confidence' | 'category' | 'key' | 'provenance'>>): MemoryRecord | null {
    const existing = this.getMemory(id);
    if (!existing) return null;

    const now = Date.now();
    const content = updates.content ?? existing.content;
    const confidence = updates.confidence ?? existing.confidence;
    const category = updates.category ?? existing.category;
    const key = updates.key ?? existing.key;
    const provenance = updates.provenance !== undefined ? updates.provenance : existing.provenance;

    this.db.prepare(`
      UPDATE memories SET content = ?, confidence = ?, category = ?, key = ?, provenance = ?, updated_at = ? WHERE id = ?
    `).run(content, confidence, category, key, provenance ?? null, now, id);

    return {
      ...existing,
      content,
      confidence,
      category,
      key,
      provenance,
      updatedAt: now,
    };
  }

  deleteMemory(id: string): boolean {
    const res = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  // ---------------------------------------------------------------- Routines

  createRoutine(r: Omit<RoutineRecord, 'id' | 'createdAt' | 'updatedAt'>): RoutineRecord {
    const id = randomUUID();
    const now = Date.now();
    const toolsStr = JSON.stringify(r.allowedTools);

    this.db.prepare(`
      INSERT INTO routines (
        id, title, prompt, schedule_type, schedule_value, timezone,
        allowed_tools, budget_tokens, status, missed_run_policy,
        last_run_at, next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, r.title, r.prompt, r.scheduleType, r.scheduleValue, r.timezone,
      toolsStr, r.budgetTokens ?? null, r.status, r.missedRunPolicy,
      r.lastRunAt ?? null, r.nextRunAt, now, now
    );

    return {
      id,
      ...r,
      createdAt: now,
      updatedAt: now,
    };
  }

  getRoutine(id: string): RoutineRecord | null {
    const r = this.db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as {
      id: string;
      title: string;
      prompt: string;
      schedule_type: RoutineRecord['scheduleType'];
      schedule_value: string;
      timezone: string;
      allowed_tools: string;
      budget_tokens: number | null;
      status: RoutineRecord['status'];
      missed_run_policy: RoutineRecord['missedRunPolicy'];
      last_run_at: number | null;
      next_run_at: number;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!r) return null;
    return {
      id: r.id,
      title: r.title,
      prompt: r.prompt,
      scheduleType: r.schedule_type,
      scheduleValue: r.schedule_value,
      timezone: r.timezone,
      allowedTools: JSON.parse(r.allowed_tools),
      budgetTokens: r.budget_tokens ?? undefined,
      status: r.status,
      missedRunPolicy: r.missed_run_policy,
      lastRunAt: r.last_run_at ?? undefined,
      nextRunAt: r.next_run_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listRoutines(): RoutineRecord[] {
    const rows = this.db.prepare('SELECT * FROM routines ORDER BY next_run_at ASC').all() as {
      id: string;
      title: string;
      prompt: string;
      schedule_type: RoutineRecord['scheduleType'];
      schedule_value: string;
      timezone: string;
      allowed_tools: string;
      budget_tokens: number | null;
      status: RoutineRecord['status'];
      missed_run_policy: RoutineRecord['missedRunPolicy'];
      last_run_at: number | null;
      next_run_at: number;
      created_at: number;
      updated_at: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      prompt: r.prompt,
      scheduleType: r.schedule_type,
      scheduleValue: r.schedule_value,
      timezone: r.timezone,
      allowedTools: JSON.parse(r.allowed_tools),
      budgetTokens: r.budget_tokens ?? undefined,
      status: r.status,
      missedRunPolicy: r.missed_run_policy,
      lastRunAt: r.last_run_at ?? undefined,
      nextRunAt: r.next_run_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getDueRoutines(now: number = Date.now()): RoutineRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM routines WHERE status = 'active' AND next_run_at <= ? ORDER BY next_run_at ASC
    `).all(now) as {
      id: string;
      title: string;
      prompt: string;
      schedule_type: RoutineRecord['scheduleType'];
      schedule_value: string;
      timezone: string;
      allowed_tools: string;
      budget_tokens: number | null;
      status: RoutineRecord['status'];
      missed_run_policy: RoutineRecord['missedRunPolicy'];
      last_run_at: number | null;
      next_run_at: number;
      created_at: number;
      updated_at: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      prompt: r.prompt,
      scheduleType: r.schedule_type,
      scheduleValue: r.schedule_value,
      timezone: r.timezone,
      allowedTools: JSON.parse(r.allowed_tools),
      budgetTokens: r.budget_tokens ?? undefined,
      status: r.status,
      missedRunPolicy: r.missed_run_policy,
      lastRunAt: r.last_run_at ?? undefined,
      nextRunAt: r.next_run_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  updateRoutine(id: string, updates: Partial<RoutineRecord>): RoutineRecord | null {
    const existing = this.getRoutine(id);
    if (!existing) return null;

    const now = Date.now();
    const merged: RoutineRecord = {
      ...existing,
      ...updates,
      updatedAt: now,
    };

    this.db.prepare(`
      UPDATE routines SET
        title = ?, prompt = ?, schedule_type = ?, schedule_value = ?, timezone = ?,
        allowed_tools = ?, budget_tokens = ?, status = ?, missed_run_policy = ?,
        last_run_at = ?, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      merged.title, merged.prompt, merged.scheduleType, merged.scheduleValue, merged.timezone,
      JSON.stringify(merged.allowedTools), merged.budgetTokens ?? null, merged.status, merged.missedRunPolicy,
      merged.lastRunAt ?? null, merged.nextRunAt, now, id
    );

    return merged;
  }

  deleteRoutine(id: string): boolean {
    const res = this.db.prepare('DELETE FROM routines WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  // ---------------------------------------------------------------- Assistants

  seedDefaultAssistants(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM assistants').get() as { c: number })?.c ?? 0;
    if (count > 0) return;

    const now = Date.now();
    const defaults: AssistantProfile[] = [
      {
        id: 'default',
        name: 'HeyGuy General',
        role: 'Visual Companion',
        systemPrompt: 'You are HeyGuy, a fast, visual, friendly AI companion for Windows. You answer clearly and generate concise 2D/3D visual diagrams to explain complex concepts.',
        avatar: '🤖',
        color: '#3b82f6',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'coder',
        name: 'Dev Specialist',
        role: 'Systems & Code Architect',
        systemPrompt: 'You are HeyGuy Dev Specialist. You specialize in full-stack architecture, rigorous code debugging, git workflows, and system inspection. You provide concrete, runnable solutions without truncation.',
        avatar: '💻',
        color: '#10b981',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'researcher',
        name: 'Deep Researcher',
        role: 'Knowledge & Document Analyst',
        systemPrompt: 'You are HeyGuy Deep Researcher. You synthesize technical papers, cross-reference documentation, review email drafts and artifacts with meticulous attention to accuracy and provenance.',
        avatar: '📚',
        color: '#8b5cf6',
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const a of defaults) {
      this.db.prepare(`
        INSERT INTO assistants (id, name, role, system_prompt, avatar, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(a.id, a.name, a.role, a.systemPrompt, a.avatar ?? null, a.color ?? null, a.createdAt, a.updatedAt);
    }
  }

  createAssistant(profile: Omit<AssistantProfile, 'id' | 'createdAt' | 'updatedAt'>): AssistantProfile {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO assistants (id, name, role, system_prompt, avatar, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, profile.name, profile.role, profile.systemPrompt, profile.avatar ?? null, profile.color ?? null, now, now);

    return {
      id,
      ...profile,
      createdAt: now,
      updatedAt: now,
    };
  }

  listAssistants(): AssistantProfile[] {
    const rows = this.db.prepare('SELECT * FROM assistants ORDER BY created_at ASC').all() as {
      id: string;
      name: string;
      role: string;
      system_prompt: string;
      avatar: string | null;
      color: string | null;
      created_at: number;
      updated_at: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      systemPrompt: r.system_prompt,
      avatar: r.avatar ?? undefined,
      color: r.color ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getAssistant(id: string): AssistantProfile | null {
    const r = this.db.prepare('SELECT * FROM assistants WHERE id = ?').get(id) as {
      id: string;
      name: string;
      role: string;
      system_prompt: string;
      avatar: string | null;
      color: string | null;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      role: r.role,
      systemPrompt: r.system_prompt,
      avatar: r.avatar ?? undefined,
      color: r.color ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  close(): void {
    this.db.close();
  }
}
