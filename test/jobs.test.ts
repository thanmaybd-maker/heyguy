import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseStore } from '../src/main/storage/db';
import { ToolRegistry } from '../src/main/tools/registry';
import { JobEngine } from '../src/main/jobs/engine';

test('ToolRegistry: executes read-only tool and gates consequential tool without approval', async () => {
  const registry = new ToolRegistry();

  registry.register({
    definition: {
      name: 'get_time',
      description: 'Get current time',
      risk: 'read-only',
      parameters: {},
    },
    async execute() {
      return { time: 12345 };
    },
  });

  registry.register({
    definition: {
      name: 'delete_file',
      description: 'Delete file',
      risk: 'consequential',
      parameters: { path: { type: 'string' } },
    },
    async execute(input) {
      return { deleted: input.path };
    },
  });

  const signal = new AbortController().signal;

  // 1. Read-only executes directly
  const res1 = await registry.execute('get_time', {}, { signal });
  assert.equal(res1.success, true);
  assert.deepEqual(res1.data, { time: 12345 });

  // 2. Consequential without approval pauses and requires approval
  const res2 = await registry.execute('delete_file', { path: '/tmp/test' }, { signal }, false);
  assert.equal(res2.success, false);
  assert.equal(res2.requiresApproval, true);

  // 3. Consequential with approval executes
  const res3 = await registry.execute('delete_file', { path: '/tmp/test' }, { signal }, true);
  assert.equal(res3.success, true);
  assert.deepEqual(res3.data, { deleted: '/tmp/test' });
});

test('JobEngine: executes steps, pauses on consequential tool, and resumes upon approval', async () => {
  const db = new DatabaseStore(':memory:');
  const registry = new ToolRegistry();

  registry.register({
    definition: {
      name: 'step1_tool',
      description: 'Safe step',
      risk: 'read-only',
      parameters: {},
    },
    async execute() {
      return { ok: 1 };
    },
  });

  registry.register({
    definition: {
      name: 'step2_tool',
      description: 'Dangerous action',
      risk: 'consequential',
      parameters: {},
    },
    async execute() {
      return { performed: true };
    },
  });

  const engine = new JobEngine(db, registry);

  const job = engine.createJob('Delegated Research', 'Find and delete files', [
    { description: 'Step 1: Check files', toolName: 'step1_tool' },
    { description: 'Step 2: Dangerous delete', toolName: 'step2_tool' },
  ]);

  assert.equal(job.status, 'queued');

  // Start job
  await engine.startJob(job.id);

  // Job should pause at step 2 awaiting approval
  const pausedJob = engine.getJob(job.id);
  assert.ok(pausedJob);
  assert.equal(pausedJob.status, 'awaiting-approval');
  assert.equal(pausedJob.currentStepIndex, 1);
  assert.equal(pausedJob.steps[0]?.status, 'completed');
  assert.equal(pausedJob.steps[1]?.status, 'running');

  // Approve and resume
  const resumed = await engine.approveAndResume(job.id);
  assert.equal(resumed, true);

  // Wait brief tick for async completion
  await new Promise((r) => setTimeout(r, 40));

  const completedJob = engine.getJob(job.id);
  assert.ok(completedJob);
  assert.equal(completedJob.status, 'completed');
  assert.equal(completedJob.steps[1]?.status, 'completed');

  db.close();
});

test('JobEngine: supports cancellation', async () => {
  const db = new DatabaseStore(':memory:');
  const registry = new ToolRegistry();
  const engine = new JobEngine(db, registry);

  const job = engine.createJob('Cancel Test', 'Should cancel', [
    { description: 'Step 1' },
    { description: 'Step 2' },
  ]);

  const cancelled = engine.cancelJob(job.id);
  assert.equal(cancelled, true);

  const after = engine.getJob(job.id);
  assert.equal(after?.status, 'cancelled');

  db.close();
});
