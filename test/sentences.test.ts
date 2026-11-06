import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SentenceChunker, speakable } from '../src/shared/sentences';

test('emits sentences as they complete, holds trailing fragment', () => {
  const c = new SentenceChunker();
  assert.deepEqual(c.push('This is the first sentence here. And the sec'), ['This is the first sentence here.']);
  assert.deepEqual(c.push('ond one is right here too! Version 3.'), ['And the second one is right here too!']);
  assert.deepEqual(c.push('5 is out'), []);
  assert.deepEqual(c.flush(), ['Version 3.5 is out']);
});

test('short sentences are merged until long enough', () => {
  const c = new SentenceChunker();
  assert.deepEqual(c.push('Hi. Ok. Now this is longer text. '), ['Hi. Ok. Now this is longer text.']);
});

test('speakable strips markdown', () => {
  assert.equal(speakable('Press **Ctrl** + `S` # now'), 'Press Ctrl + S now');
});
