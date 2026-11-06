import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseStore } from '../src/main/storage/db';
import { MemoryStore } from '../src/main/memory/store';
import { SchedulerEngine } from '../src/main/scheduler/engine';
import { AssistantProfileManager } from '../src/main/assistants/profiles';
import { NotificationDispatcher } from '../src/main/notifications/dispatcher';

test('MemoryStore: stores, retrieves, searches and deletes memories', () => {
  const db = new DatabaseStore(':memory:');
  const memory = new MemoryStore(db);

  // Store preference
  const p1 = memory.remember('preference', 'editor_theme', 'User prefers dark mode with high contrast', 0.95);
  assert.equal(p1.category, 'preference');
  assert.equal(p1.key, 'editor_theme');

  // Store fact
  const f1 = memory.remember('fact', 'project_name', 'The current project is named HeyGuy', 1.0);
  assert.equal(f1.category, 'fact');

  // List
  const all = memory.list();
  assert.equal(all.length, 2);

  const prefs = memory.list('preference');
  assert.equal(prefs.length, 1);
  assert.equal(prefs[0]!.key, 'editor_theme');

  // Search
  const searchResults = memory.search('dark mode');
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0]!.id, p1.id);

  // Forget (delete)
  const ok = memory.forget(f1.id);
  assert.equal(ok, true);
  assert.equal(memory.get(f1.id), null);
  assert.equal(memory.list().length, 1);

  db.close();
});

test('MemoryStore: extracts facts and preferences from conversation text', () => {
  const db = new DatabaseStore(':memory:');
  const memory = new MemoryStore(db);

  const t1 = 'My name is Thanmay and I am working on Windows.';
  const extracted1 = memory.extractFromConversation(t1, 'turn:1');
  assert.ok(extracted1.some((m) => m.content.includes("User's name is Thanmay")));

  const t2 = 'Remember that we always use TypeScript and strict types.';
  const extracted2 = memory.extractFromConversation(t2, 'turn:2');
  assert.ok(extracted2.some((m) => m.content.includes('always use TypeScript')));

  const t3 = 'I prefer clean minimal UI without clutter.';
  const extracted3 = memory.extractFromConversation(t3, 'turn:3');
  assert.ok(extracted3.some((m) => m.content.includes('User prefers clean minimal UI')));

  // Check formatContextForPrompt
  const context = memory.formatContextForPrompt('Can you write some TypeScript code for me?');
  assert.ok(context.includes('[Persistent User Context & Preferences]'));
  assert.ok(context.includes('TypeScript'));

  db.close();
});

test('SchedulerEngine: computes next runs for intervals, daily, and cron schedules', () => {
  const db = new DatabaseStore(':memory:');
  const scheduler = new SchedulerEngine(db);

  const base = new Date('2026-11-04T10:00:00.000Z').getTime();

  // 1. Interval
  const nextInterval = scheduler.computeNextRun('interval', '15m', base, 'UTC');
  assert.equal(nextInterval, base + 15 * 60 * 1000);

  const next1h = scheduler.computeNextRun('interval', '1h', base, 'UTC');
  assert.equal(next1h, base + 3600 * 1000);

  // 2. Daily (17:30)
  const nextDaily = scheduler.computeNextRun('daily', '17:30', base, 'UTC');
  assert.ok(nextDaily > base);
  const dailyDate = new Date(nextDaily);
  assert.equal(dailyDate.getHours(), 17);
  assert.equal(dailyDate.getMinutes(), 30);

  // 3. Cron (0 9 * * 1-5 -> 9:00 AM)
  const nextCron = scheduler.computeNextRun('cron', '0 9 * * 1-5', base, 'UTC');
  assert.ok(nextCron > base);
  const cronDate = new Date(nextCron);
  assert.equal(cronDate.getHours(), 9);
  assert.equal(cronDate.getMinutes(), 0);

  db.close();
});

test('SchedulerEngine: lifecycle, pause, resume, and missed-run catchup policies', async () => {
  const db = new DatabaseStore(':memory:');
  const executed: string[] = [];

  const scheduler = new SchedulerEngine(db, undefined, (routine) => {
    executed.push(routine.id);
  });

  const now = Date.now();

  // Create routine scheduled in the past (missed run)
  const pastTime = now - 60_000;
  const routineWake = scheduler.createRoutine({
    title: 'Morning Sync',
    prompt: 'Sync open windows',
    scheduleType: 'interval',
    scheduleValue: '3600000',
    missedRunPolicy: 'run_once_on_wake',
  });

  // Force nextRunAt into the past to simulate missed run during sleep
  db.updateRoutine(routineWake.id, { nextRunAt: pastTime });

  const routineSkip = scheduler.createRoutine({
    title: 'Hourly Ping',
    prompt: 'Check ping',
    scheduleType: 'interval',
    scheduleValue: '3600000',
    missedRunPolicy: 'skip',
  });
  db.updateRoutine(routineSkip.id, { nextRunAt: pastTime });

  // Catch up missed runs
  scheduler.catchUpMissedRuns(now);

  // routineWake executed once, routineSkip skipped execution and advanced nextRunAt
  const updatedWake = db.getRoutine(routineWake.id);
  assert.ok(updatedWake!.lastRunAt! >= now);
  assert.ok(updatedWake!.nextRunAt > now);

  const updatedSkip = db.getRoutine(routineSkip.id);
  assert.equal(updatedSkip!.lastRunAt, undefined); // Was skipped, never ran
  assert.ok(updatedSkip!.nextRunAt > now);

  // Pause and resume
  scheduler.pauseRoutine(routineWake.id);
  assert.equal(db.getRoutine(routineWake.id)!.status, 'paused');

  scheduler.resumeRoutine(routineWake.id);
  assert.equal(db.getRoutine(routineWake.id)!.status, 'active');

  // Delete
  assert.equal(scheduler.deleteRoutine(routineSkip.id), true);
  assert.equal(scheduler.listRoutines().length, 1);

  db.close();
});

test('AssistantProfileManager: seeds default profiles and handles assistant switching', () => {
  const db = new DatabaseStore(':memory:');
  const manager = new AssistantProfileManager(db);

  const list = manager.list();
  assert.ok(list.length >= 3);
  assert.ok(list.some((a) => a.id === 'default'));
  assert.ok(list.some((a) => a.id === 'coder'));
  assert.ok(list.some((a) => a.id === 'researcher'));

  // Active assistant
  assert.equal(manager.getActive().id, 'default');

  // Switch assistant
  const ok = manager.setActive('coder');
  assert.equal(ok, true);
  assert.equal(manager.getActive().id, 'coder');
  assert.ok(manager.getActive().systemPrompt.includes('Dev Specialist'));

  // Create custom assistant
  const custom = manager.create({
    name: 'Writing Coach',
    role: 'Editorial & Tone Reviewer',
    systemPrompt: 'You review documents and emails for professional clarity.',
    avatar: '✍️',
    color: '#eab308',
  });
  assert.ok(custom.id);
  assert.equal(manager.list().length, list.length + 1);

  db.close();
});

test('NotificationDispatcher: handles quiet mode, quiet hours, and urgency filtering', () => {
  const sent: { title: string; body: string; silent: boolean }[] = [];
  const mockAdapter = {
    isSupported: () => true,
    show: (title: string, body: string, silent: boolean) => {
      sent.push({ title, body, silent });
      return true;
    },
  };

  // Test quiet mode
  const dispatcher = new NotificationDispatcher({ quietMode: true }, mockAdapter);
  assert.equal(dispatcher.isQuietTime(), true);

  // Normal notification suppressed in quiet mode
  const normalResult = dispatcher.notify({
    title: 'Background Task',
    body: 'Step 1 complete',
    urgency: 'normal',
  });
  assert.equal(normalResult, false);
  assert.equal(sent.length, 0);

  // Critical notification allowed even in quiet mode
  const criticalResult = dispatcher.notify({
    title: 'Approval Required',
    body: 'Consequential action needs review',
    urgency: 'critical',
  });
  assert.equal(criticalResult, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.title, 'Approval Required');

  // Outside quiet mode
  const activeDispatcher = new NotificationDispatcher({ quietMode: false, quietHoursStart: undefined, quietHoursEnd: undefined }, mockAdapter);
  assert.equal(activeDispatcher.isQuietTime(), false);
  const activeResult = activeDispatcher.notify({
    title: 'Job Finished',
    body: 'Research summary completed',
    urgency: 'normal',
  });
  assert.equal(activeResult, true);
  assert.equal(sent.length, 2);
});
