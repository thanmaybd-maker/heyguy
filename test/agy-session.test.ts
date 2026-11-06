import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AgySession, type Spawner } from '../src/main/ai/agy-session';

/** A fake `agy --input-format stream-json` that echoes each prompt back in two deltas. */
function fakeAgy(opts: { hang?: boolean } = {}) {
  const spawned: string[][] = [];
  let kills = 0;
  const spawner: Spawner = (_bin, args) => {
    spawned.push(args);
    const child = new EventEmitter() as any;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      kills++;
      setImmediate(() => child.emit('close', null));
    };
    let first = true;
    let buf = '';
    child.stdin.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        const text: string = msg.message.content;
        const out = (o: unknown) => child.stdout.write(JSON.stringify(o) + '\n');
        if (first) out({ event: 'init', conversation_id: 'c1', init: {} });
        first = false;
        if (opts.hang && text.includes('hang')) continue;
        out({ event: 'step_update', step_update: { step_type: 'agent_response', state: 'ACTIVE', text_delta: 'echo:' } });
        out({ event: 'step_update', step_update: { step_type: 'agent_response', state: 'DONE', text_delta: text.slice(0, 12) } });
        out({ event: 'result', result: { status: 'SUCCESS', response: 'echo:' + text.slice(0, 12), usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } });
      }
    });
    return child;
  };
  return { spawner, spawned, kills: () => kills };
}

test('one warm process serves many turns, streaming deltas, in order', async () => {
  const f = fakeAgy();
  const s = new AgySession('agy', 'gemini-3.8-flash-high', f.spawner);
  const deltas: string[] = [];
  const [a, b] = await Promise.all([
    s.turn('first question', new AbortController().signal, (d) => deltas.push(d)),
    s.turn('second question', new AbortController().signal, (d) => deltas.push(d)),
  ]);
  assert.equal(a.text, 'echo:first questi');
  assert.equal(b.text, 'echo:second quest');
  assert.equal(a.usage?.totalTokens, 7);
  assert.deepEqual(deltas, ['echo:', 'first questi', 'echo:', 'second quest']);
  assert.equal(f.spawned.length, 1, 'no new process per turn');
  assert.deepEqual(f.spawned[0]!.slice(0, 6), ['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', 'gemini-3.8-flash-high']);
  s.stop();
});

test('abort kills the stuck turn; the next turn starts a fresh process', async () => {
  const f = fakeAgy({ hang: true });
  const s = new AgySession('agy', 'm', f.spawner);
  const ac = new AbortController();
  const stuck = s.turn('please hang', ac.signal, () => undefined);
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(stuck, /Abort/);
  assert.equal(f.kills(), 1);
  const ok = await s.turn('after', new AbortController().signal, () => undefined);
  assert.equal(ok.text, 'echo:after');
  assert.equal(f.spawned.length, 2);
  s.stop();
});

test('changing model restarts the session', async () => {
  const f = fakeAgy();
  const s = new AgySession('agy', 'a', f.spawner);
  await s.turn('x', new AbortController().signal, () => undefined);
  s.setModel('b');
  await s.turn('y', new AbortController().signal, () => undefined);
  assert.equal(f.spawned.length, 2);
  assert.equal(f.spawned[1]![5], 'b');
  s.stop();
});
