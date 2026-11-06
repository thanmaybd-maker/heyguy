import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseStore } from '../src/main/storage/db';
import { DraftConnector } from '../src/main/connectors/drafts';

test('DraftConnector: formats RFC822 email draft and stores artifact', () => {
  const db = new DatabaseStore(':memory:');
  const connector = new DraftConnector(db);

  const { artifact, rawRfc822 } = connector.createEmailDraft({
    to: 'lead@example.com',
    subject: 'Quarterly Update',
    body: 'Here is the summary of project milestones.',
  });

  assert.ok(artifact.id);
  assert.equal(artifact.kind, 'email-draft');
  assert.ok(rawRfc822.includes('To: lead@example.com'));
  assert.ok(rawRfc822.includes('Subject: Quarterly Update'));
  assert.ok(rawRfc822.includes('Here is the summary of project milestones.'));

  const saved = db.getArtifact(artifact.id);
  assert.ok(saved);
  assert.equal(saved.content, rawRfc822);
  assert.ok(saved.checksum.length === 64);

  db.close();
});

test('DraftConnector: saves markdown document artifact with SHA256 checksum', () => {
  const db = new DatabaseStore(':memory:');
  const connector = new DraftConnector(db);

  const art = connector.createDocument({
    title: 'Architecture Overview',
    kind: 'markdown',
    content: '# Architecture\nDetailed plan notes.',
  });

  assert.equal(art.title, 'Architecture Overview');
  assert.equal(art.kind, 'markdown');
  assert.ok(art.checksum.length === 64);

  const list = db.listArtifacts();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, art.id);

  db.close();
});

