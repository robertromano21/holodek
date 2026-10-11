'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/game.js'), 'utf8');
const start = source.indexOf('function getRecentPromptsAndResponsesForConversation(');
const code = source.slice(start, source.indexOf('var previousResponse =', start));
const context = {};
vm.createContext(context); vm.runInContext(code, context);
const history = context.boundedConversationHistory;
const words = value => (value.match(/\S+/g) || []).length;
const row = (n, response = `Answer ${n}`) => ({ prompt: `$.user \`Question ${n}\``, response: `$.assistant \`\n\n${response}\``,
  gameConsole: 'Never transmit the stored console here', personalNarrative: 'Do not recurse' });

test('history selects up to 15 recent exchanges in chronological order with intact roles', () => {
  const rows = Array.from({ length: 25 }, (_, n) => row(n)), before = JSON.stringify(rows);
  const text = history(rows);
  assert.equal((text.match(/\$\.user `/g) || []).length, 15);
  assert.equal((text.match(/\$\.assistant `/g) || []).length, 15);
  assert.ok(text.startsWith('$.user `Question 10`'));
  assert.ok(text.endsWith('$.assistant `Answer 24`'));
  assert.doesNotMatch(text, /Never transmit|Do not recurse/);
  assert.equal(JSON.stringify(rows), before);
});

test('the word budget is enforced, newest exchanges have priority, and oversized old turns cannot crowd them out', () => {
  const rows = Array.from({ length: 15 }, (_, n) => row(n, (`Turn${n} `).repeat(100)));
  const text = history(rows);
  assert.ok(words(text) <= 700);
  assert.ok(text.includes('Question 14'));
  assert.ok(!text.includes('Question 0'));
  assert.ok(text.indexOf('Question 13') < text.indexOf('Question 14'));
});

test('a giant newest response is excerpted without losing its command or valid role wrappers', () => {
  const rows = [row(0), row(1, 'word '.repeat(100000))], before = JSON.stringify(rows);
  const text = history(rows, 60);
  assert.ok(words(text) <= 60);
  assert.ok(text.length <= 720);
  assert.match(text, /\$\.user `Question 1`/);
  assert.match(text, /\$\.assistant `.*\[excerpt\]`/);
  assert.equal(JSON.stringify(rows), before);
});

test('a giant unbroken token, missing fields and invalid budgets cannot overflow history', () => {
  const text = history([{}, null, row(1, 'x'.repeat(200000))]);
  assert.ok(text.length <= 8400);
  assert.ok(words(text) <= 700);
  for (const budget of [0, -1, 2]) assert.equal(history([row(1)], budget), '');
  assert.equal(history(null), '');
});

test('IndexedDB retrieval visits only 15 newest records using a readonly reverse cursor', async () => {
  const rows = Array.from({ length: 100 }, (_, n) => row(n)), requests = [];
  let count = 0;
  const context = { IDBKeyRange: { only: id => id }, localStorage: { getItem: () => 'current-game' },
    db: { transaction(stores, mode) {
      requests.push({ stores: Array.from(stores), mode });
      return { objectStore: () => ({ index: () => ({ openCursor(id, direction) {
        requests.push({ id, direction });
        const request = {};
        function next() {
          const value = rows[rows.length - 1 - count++];
          queueMicrotask(() => request.onsuccess({ target: { result: value ? { value, continue: next } : null } }));
        }
        next(); return request;
      } }) }) };
    } } };
  vm.createContext(context); vm.runInContext(code, context);
  const text = await context.performDynamicSearch('Question');
  assert.equal(count, 15);
  assert.deepEqual(requests, [{ stores: ['conversation'], mode: 'readonly' }, { id: 'current-game', direction: 'prev' }]);
  assert.match(text, /Question 85/);
  assert.match(text, /Question 99/);
});
