// Durable, timezone-aware scheduled routines engine.
// Executes recurring background tasks and handles wake/sleep missed-run policies without duplicate runs.
import type { DatabaseStore } from '../storage/db';
import type { JobEngine } from '../jobs/engine';
import type { RoutineRecord, ScheduleType, MissedRunPolicy } from '../../shared/types';

export interface CreateRoutineInput {
  title: string;
  prompt: string;
  scheduleType: ScheduleType;
  scheduleValue: string;
  timezone?: string;
  allowedTools?: string[];
  budgetTokens?: number;
  missedRunPolicy?: MissedRunPolicy;
}

export class SchedulerEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly checkIntervalMs = 15_000; // Check every 15s

  constructor(
    private readonly db: DatabaseStore,
    private readonly jobEngine?: JobEngine,
    private readonly onRoutineTriggered?: (routine: RoutineRecord, jobId: string) => void
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;

    // First, process any runs missed while the application/PC was off or sleeping
    this.catchUpMissedRuns();

    // Start periodic timer
    this.timer = setInterval(() => {
      this.checkAndRunDueRoutines();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /**
   * Evaluates any routines that were scheduled to run in the past.
   * If policy is 'run_once_on_wake', executes exactly once and re-schedules next run.
   * If policy is 'skip', skips execution and advances next run time into the future.
   */
  catchUpMissedRuns(now: number = Date.now()): void {
    const due = this.db.getDueRoutines(now);
    for (const routine of due) {
      if (routine.missedRunPolicy === 'run_once_on_wake') {
        this.executeRoutine(routine, now);
      } else {
        // Skip past run, advance next_run_at into the future
        const next = this.computeNextRun(routine.scheduleType, routine.scheduleValue, now, routine.timezone);
        this.db.updateRoutine(routine.id, {
          nextRunAt: next,
        });
      }
    }
  }

  checkAndRunDueRoutines(now: number = Date.now()): void {
    const due = this.db.getDueRoutines(now);
    for (const routine of due) {
      this.executeRoutine(routine, now);
    }
  }

  async executeRoutine(routine: RoutineRecord, now: number = Date.now()): Promise<string | null> {
    const nextRun = this.computeNextRun(routine.scheduleType, routine.scheduleValue, now, routine.timezone);

    // Update routine record immediately to prevent race conditions
    this.db.updateRoutine(routine.id, {
      lastRunAt: now,
      nextRunAt: nextRun,
    });

    if (!this.jobEngine) return null;

    // Launch a job for the routine
    const job = this.jobEngine.createJob(
      `[Routine] ${routine.title}`,
      routine.prompt,
      [
        {
          description: `Execute scheduled routine: ${routine.title}`,
          toolName: routine.allowedTools[0] ?? undefined,
        },
      ]
    );

    if (this.onRoutineTriggered) {
      this.onRoutineTriggered(routine, job.id);
    }

    // Run job in background
    this.jobEngine.startJob(job.id).catch((err) => {
      console.error(`[Scheduler] Job execution failed for routine "${routine.title}":`, err);
    });

    return job.id;
  }

  createRoutine(input: CreateRoutineInput): RoutineRecord {
    const now = Date.now();
    const tz = input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const nextRunAt = this.computeNextRun(input.scheduleType, input.scheduleValue, now, tz);

    return this.db.createRoutine({
      title: input.title,
      prompt: input.prompt,
      scheduleType: input.scheduleType,
      scheduleValue: input.scheduleValue,
      timezone: tz,
      allowedTools: input.allowedTools ?? ['search_workspace', 'create_document'],
      budgetTokens: input.budgetTokens,
      status: 'active',
      missedRunPolicy: input.missedRunPolicy ?? 'run_once_on_wake',
      nextRunAt,
    });
  }

  pauseRoutine(id: string): RoutineRecord | null {
    return this.db.updateRoutine(id, { status: 'paused' });
  }

  resumeRoutine(id: string): RoutineRecord | null {
    const r = this.db.getRoutine(id);
    if (!r) return null;
    const now = Date.now();
    const nextRun = r.nextRunAt > now ? r.nextRunAt : this.computeNextRun(r.scheduleType, r.scheduleValue, now, r.timezone);
    return this.db.updateRoutine(id, { status: 'active', nextRunAt: nextRun });
  }

  runNow(id: string): Promise<string | null> {
    const r = this.db.getRoutine(id);
    if (!r) return Promise.resolve(null);
    return this.executeRoutine(r, Date.now());
  }

  deleteRoutine(id: string): boolean {
    return this.db.deleteRoutine(id);
  }

  listRoutines(): RoutineRecord[] {
    return this.db.listRoutines();
  }

  /**
   * Computes the next timestamp (in ms) when the routine should run.
   */
  computeNextRun(scheduleType: ScheduleType, scheduleValue: string, fromTimestamp: number, _timezone: string): number {
    if (scheduleType === 'interval') {
      // e.g. "3600000" or "15m", "1h", "24h"
      let ms = Number(scheduleValue);
      if (isNaN(ms)) {
        const match = scheduleValue.match(/^(\d+)\s*(m|h|d|s)$/i);
        if (match && match[1] && match[2]) {
          const num = parseInt(match[1], 10);
          const unit = match[2].toLowerCase();
          if (unit === 's') ms = num * 1000;
          else if (unit === 'm') ms = num * 60 * 1000;
          else if (unit === 'h') ms = num * 60 * 60 * 1000;
          else if (unit === 'd') ms = num * 24 * 60 * 60 * 1000;
        } else {
          ms = 3600_000; // default 1 hour
        }
      }
      return fromTimestamp + Math.max(1000, ms);
    }

    if (scheduleType === 'daily') {
      // e.g. "09:00" or "17:30"
      const [hStr, mStr] = scheduleValue.split(':');
      const targetHour = parseInt(hStr ?? '9', 10);
      const targetMin = parseInt(mStr ?? '0', 10);

      const candidate = new Date(fromTimestamp);
      candidate.setHours(targetHour, targetMin, 0, 0);

      if (candidate.getTime() <= fromTimestamp) {
        // Already passed today, advance to tomorrow
        candidate.setDate(candidate.getDate() + 1);
      }
      return candidate.getTime();
    }

    if (scheduleType === 'cron') {
      // Simple standard cron parser (minute hour dom month dow)
      // e.g. "0 9 * * 1-5" (every weekday at 9:00 AM)
      const parts = scheduleValue.trim().split(/\s+/);
      if (parts.length >= 5) {
        const targetMin = parts[0] === '*' ? 0 : parseInt(parts[0]!, 10) || 0;
        const targetHour = parts[1] === '*' ? 9 : parseInt(parts[1]!, 10) || 0;

        const candidate = new Date(fromTimestamp);
        candidate.setSeconds(0, 0);
        candidate.setHours(targetHour, targetMin, 0, 0);

        while (candidate.getTime() <= fromTimestamp) {
          candidate.setDate(candidate.getDate() + 1);
        }
        return candidate.getTime();
      }
      // Fallback: 24h
      return fromTimestamp + 24 * 3600_000;
    }

    return fromTimestamp + 3600_000;
  }
}
