import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseStore } from '../src/main/storage/db';
import type { Scene } from '../src/shared/scene';

test('DatabaseStore: session lifecycle and message storage', () => {
  const store = new DatabaseStore(':memory:');
  try {
    const s1 = store.getOrCreateActiveSession();
    assert.ok(s1.id);
    assert.equal(s1.messageCount, 0);

    store.addMessage(s1.id, 1, 'user', 'How does a transformer work?', 'How does a transformer work?', false);
    store.addMessage(s1.id, 1, 'assistant', 'A transformer uses self-attention.', 'A transformer uses self-attention.', true);

    const updated = store.getSession(s1.id);
    assert.ok(updated);
    assert.equal(updated.session.title, 'How does a transformer work?');
    assert.equal(updated.messages.length, 2);
    assert.equal(updated.messages[0].role, 'user');
    assert.equal(updated.messages[1].role, 'assistant');
    assert.equal(updated.messages[1].hasScene, true);

    const recent = store.getRecentTurns(s1.id);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].text, 'How does a transformer work?');
  } finally {
    store.close();
  }
});

test('DatabaseStore: scene persistence and retrieval', () => {
  const store = new DatabaseStore(':memory:');
  try {
    const s = store.createSession('Scene Test');
    const demoScene: Scene = {
      kind: '2d',
      id: 'scene-test-1',
      title: 'Attention Flow',
      layout: 'flow-right',
      nodes: [
        { id: 'q', label: 'Query', detail: 'Vector Q', shape: 'box', tone: 'accent' },
        { id: 'k', label: 'Key', detail: 'Vector K', shape: 'box', tone: 'default' },
      ],
      edges: [{ id: 'e1', from: 'q', to: 'k', label: 'dot-product', dashed: false, flow: true }],
      steps: [{ focus: ['q'], caption: 'Project query vector' }],
    };

    store.saveScene(s.id, 1, demoScene);
    const retrieved = store.getSceneById('scene-test-1');
    assert.ok(retrieved);
    assert.equal(retrieved.kind, '2d');
    assert.equal(retrieved.title, 'Attention Flow');
    if (retrieved.kind === '2d') {
      assert.equal(retrieved.nodes.length, 2);
      assert.equal(retrieved.edges[0].label, 'dot-product');
    }

    const sessionData = store.getSession(s.id);
    assert.ok(sessionData);
    assert.equal(sessionData.scenes.length, 1);
    assert.equal(sessionData.scenes[0].id, 'scene-test-1');
  } finally {
    store.close();
  }
});

test('DatabaseStore: search across sessions', () => {
  const store = new DatabaseStore(':memory:');
  try {
    const s1 = store.createSession('Session 1');
    const s2 = store.createSession('Session 2');

    store.addMessage(s1.id, 1, 'user', 'What is an crankshaft in an engine?', 'What is an crankshaft in an engine?', false);
    store.addMessage(s2.id, 2, 'user', 'Explain quantum computing basics', 'Explain quantum computing basics', false);

    const res = store.search('crankshaft');
    assert.equal(res.length, 1);
    assert.equal(res[0].sessionId, s1.id);
    assert.ok(res[0].matchedSnippet.includes('crankshaft'));

    const empty = store.search('nonexistent');
    assert.equal(empty.length, 0);
  } finally {
    store.close();
  }
});

test('DatabaseStore: deleteSession cascades to messages and scenes', () => {
  const store = new DatabaseStore(':memory:');
  try {
    const s = store.createSession('To Delete');
    store.addMessage(s.id, 1, 'user', 'Hello', 'Hello', false);
    store.saveScene(s.id, 1, {
      kind: '2d',
      id: 'sc-del',
      title: 'T',
      layout: 'grid',
      nodes: [{ id: 'n', label: 'N', detail: '', shape: 'box', tone: 'default' }],
      edges: [],
      steps: [],
    });

    assert.equal(store.listSessions().length, 1);
    const ok = store.deleteSession(s.id);
    assert.equal(ok, true);
    assert.equal(store.listSessions().length, 0);
    assert.equal(store.getSession(s.id), null);
    assert.equal(store.getSceneById('sc-del'), null);
  } finally {
    store.close();
  }
});
