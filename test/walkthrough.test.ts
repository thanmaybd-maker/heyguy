import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalkthroughObserver } from '../src/main/walkthroughs/observer';

test('WalkthroughObserver: manages tutorial step progression and cancellation', () => {
  const observer = new WalkthroughObserver();

  assert.equal(observer.getState().active, false);

  const steps = [
    { id: '1', targetDescription: 'Menu button', instruction: 'Click File', expectedOutcome: 'Menu opens', targetPoint: { x: 100, y: 50 } },
    { id: '2', targetDescription: 'Export item', instruction: 'Click Export', expectedOutcome: 'Dialog opens', targetPoint: { x: 120, y: 150 } },
  ];

  // Start walkthrough
  const s1 = observer.start('Export File Guide', steps);
  assert.equal(s1.active, true);
  assert.equal(s1.currentStep, 1);
  assert.equal(s1.totalSteps, 2);
  assert.equal(s1.step?.instruction, 'Click File');

  // Next step
  const s2 = observer.next();
  assert.equal(s2.active, true);
  assert.equal(s2.currentStep, 2);
  assert.equal(s2.step?.instruction, 'Click Export');

  // Finish walkthrough
  const s3 = observer.next();
  assert.equal(s3.active, false);
  assert.equal(s3.completed, true);

  // Cancel walkthrough
  observer.start('Another Guide', steps);
  const cancelled = observer.cancel();
  assert.equal(cancelled.active, false);
  assert.equal(cancelled.completed, false);
});

