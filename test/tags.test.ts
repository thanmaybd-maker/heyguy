import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TagStream, parseTagBody, stripTags } from '../src/shared/tags';

test('parses every tag kind', () => {
  assert.deepEqual(parseTagBody('POINT', '640,380:Save button'), { kind: 'point', x: 640, y: 380, label: 'Save button' });
  assert.deepEqual(parseTagBody('circle', ' 10 , 20 , 30 : x'), { kind: 'circle', x: 10, y: 20, r: 30, label: 'x' });
  assert.deepEqual(parseTagBody('BOX', '1,2,3,4'), { kind: 'box', x1: 1, y1: 2, x2: 3, y2: 4, label: '' });
  assert.deepEqual(parseTagBody('ARROW', '1,2,3,4:a:b'), { kind: 'arrow', x1: 1, y1: 2, x2: 3, y2: 4, label: 'a:b' });
  assert.deepEqual(parseTagBody('UNDERLINE', '5,6,7:u'), { kind: 'underline', x1: 5, y: 6, x2: 7, label: 'u' });
});

test('rejects malformed tags', () => {
  assert.equal(parseTagBody('POINT', '1:oops'), null);
  assert.equal(parseTagBody('BOX', '1,2,3,x'), null);
  assert.equal(parseTagBody('WAVE', '1,2'), null);
});

test('stream extracts tags split across arbitrary chunk boundaries', () => {
  const full = 'Click the button [POINT:640,380:Save] then [CIRCLE:10,20,30:err] done. See [1] and a[b].';
  for (let size = 1; size <= full.length; size++) {
    const s = new TagStream();
    let text = '';
    const tags: unknown[] = [];
    for (let i = 0; i < full.length; i += size) {
      const r = s.push(full.slice(i, i + size));
      text += r.text;
      tags.push(...r.tags);
    }
    text += s.flush().text;
    assert.equal(text, 'Click the button  then  done. See [1] and a[b].', `chunk size ${size}`);
    assert.equal(tags.length, 2, `chunk size ${size}`);
  }
});

test('unterminated bracket is released on flush', () => {
  const s = new TagStream();
  const a = s.push('price is [POINT:12');
  assert.equal(a.text, 'price is ');
  assert.equal(s.flush().text, '[POINT:12');
});

test('stripTags cleans spacing', () => {
  assert.equal(stripTags('Hit Save [POINT:1,2:s] . Then go [ARROW:1,2,3,4] home'), 'Hit Save. Then go home');
});
