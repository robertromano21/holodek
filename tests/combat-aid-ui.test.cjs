'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  const requests = [], nodes = new Map(); let confirmed = false;
  const element = () => ({ children: [], style: {}, setAttribute() {}, append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); }, addEventListener(type, fn) { this[type] = fn; },
    querySelectorAll() { return []; }, remove() {} });
  const document = { body: element(), createElement: element, getElementById: id => nodes.get(id) };
  const window = { dungeonRunId: 'run', crypto: { randomUUID: () => 'aid-test-12345' }, confirm: () => confirmed, applyRealtimeCombatResult() {},
    getDungeonLifeContext: () => ({ dungeon: { geoKey: '1,0,0' }, player: { x: 1, y: 1 }, actors: [] }) };
  vm.runInNewContext(fs.readFileSync('assets/combatLifeUi.js', 'utf8'), { window, document,
    fetch: async (url, options) => { requests.push(url); return { ok: true, json: async () => url.endsWith('/view') ?
      { care: [], injuries: [{ name: 'Enemy', state: 'Dying', remaining: 1 }] } : { content: 'One turn passes.' } }; } });
  return { window, document, requests, confirm: value => { confirmed = value; } };
}
test('first-aid menu exposes the remaining window, explains unavailable care and confirms a dangerous wait', async () => {
  const f = fixture(); await f.window.CombatLifeUi.open('Enemy');
  const box = f.document.body.children[0], info = box.children[1];
  assert.match(info.textContent, /1 action remains.*Reading or cancelling.*no turn.*No treatment.*waiting is not treatment/);
  const wait = box.children.find(c => c.textContent === 'Wait One Turn');
  await wait.click(); assert.deepEqual(f.requests, ['/combat/care/view']);
  f.confirm(true); await wait.click(); assert.deepEqual(f.requests, ['/combat/care/view', '/combat/wait']);
});
test('dying countdown labels use rounds in combat and actions afterward', () => {
  const f = fixture(), api = f.window.CombatLifeUi;
  api.receive({ runId: 'run', injuries: [{ name: 'Enemy', state: 'Dying', remaining: 1 }] });
  assert.equal(api.condition({ name: 'Enemy', state: 'Dying' }), 'Dying: 1 action for aid');
  f.window.actionDiceState = { active: { kind: 'combat' } };
  assert.equal(api.condition({ name: 'Enemy', state: 'Dying' }), 'Dying: 1 round for aid');
});
