'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Feedback = require('../assets/actionFeedback');
const Inventory = require('../assets/inventoryUi');
const gateSource = fs.readFileSync('assets/commandGate.js', 'utf8');
const uiSource = fs.readFileSync('assets/actionNoticeUi.js', 'utf8');
const source = fs.readFileSync('retort/retortWithUserInput.js', 'utf8');
const quiet = { info() {}, warn() {} };

test('puzzle completion notice derives the cabinet and XP only from the committed transition', () => {
  const partial = Feedback.puzzle({ allowed: true, nextState: { status: 'ready' }, message: 'West dial clicks to Moon.' },
    { title: 'Archive' }, { id: 'west', label: 'West dial' }, { name: 'Hero' });
  assert.equal(partial.kind, 'puzzle-control'); assert.equal(partial.result, 'partial'); assert.match(partial.message, /Moon/);
  const solved = Feedback.puzzle({ allowed: true, nextState: { status: 'complete' }, outcomes: { xp_awarded: { Hero: 250 } } },
    { title: 'Archive' }, {}, { name: 'Hero' });
  assert.equal(solved.kind, 'puzzle-complete'); assert.match(solved.message, /cabinet opens.*250 XP.*Game Log/);
  const inspect = Feedback.puzzle({ allowed: true, inspect: true, message: 'The cabinet was solved earlier.' }, { title: 'Archive' }, {}, {});
  assert.equal(inspect.kind, 'puzzle-control'); assert.equal(inspect.result, 'observed');
});

test('defeat and adjudication notices retain the exact victim killer actor roll and committed outcome', () => {
  assert.deepEqual(Feedback.defeat({ name: 'Guard' }, { name: 'Mortacia' }), { kind: 'defeat', title: 'Guard',
    actor: 'Mortacia', subject: 'Guard', message: 'Killed by Mortacia.', result: 'defeated' });
  const rows = Feedback.adjudication({ Action: 'Search', Outcomes: [{ character: 'Hero', outcome: 'The tablet is still unreadable.' }],
    metadata: [{ actor: 'Hero', activity: 'Search', result: 'failure' }], 'Dice Rolls': [{ character: 'Hero', roll: 2 }] });
  assert.equal(rows[0].result, 'failure'); assert.equal(rows[0].roll, 2); assert.equal(rows[0].activity, 'Search');
  assert.deepEqual(Feedback.adjudication({ Outcomes: [] }), []);
});

test('feedback publication is uniquely identified and scoped to the current run and room', () => {
  const state = { getLastCoords: () => ({ x: -1, y: 2, z: 0 }), getDungeonRunId: () => 'run' }, events = [];
  Feedback.publish(event => events.push(event), state, Feedback.defeat({ name: 'Guard' }, { name: 'Hero' }));
  Feedback.publish(event => events.push(event), state, Feedback.defeat({ name: 'Guard' }, { name: 'Hero' }));
  assert.equal(events[0].type, 'action_notice'); assert.equal(events[0].geoKey, '-1,2,0');
  assert.equal(events[0].runId, 'run'); assert.notEqual(events[0].id, events[1].id);
  assert.equal(Feedback.publish(null, state, {}), null);
});

test('adjudication notices show only committed XP trap damage item and exit receipts', () => {
  const initial = { Action: 'Search', Outcomes: [{ character: 'Hero', outcome: 'The lid shifts.' }] };
  const rows = Feedback.adjudication(initial, { xp_awarded: { Hero: 250 }, trap_damage: { Hero: 3 }, new_objects: ['silver key'], new_exit: 'east' });
  assert.match(rows[0].message, /250 XP.*3 trap damage.*silver key.*east exit/);
  assert.equal(Feedback.adjudication(initial)[0].message, 'The lid shifts.');
});

function browserFixture() {
  let now = 1000, paused = false;
  const elements = new Map(), listeners = {};
  const element = tag => ({ tagName: tag, hidden: false, style: {}, dataset: {}, children: [], textContent: '', listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, blur() {},
    click() { this.listeners.click?.({ preventDefault() {}, stopPropagation() {} }); },
    setAttribute() {}, append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); },
    getBoundingClientRect: () => ({ top: 650, left: 250, width: 500, height: 80 }) });
  const input = element('textarea'); input.offsetWidth = 500; elements.set('chatuserinput', input);
  const ctx = { dungeon: { geoKey: '0,0,0' }, actors: [{ name: 'Guard', hp: 0, state: 'Dead', mazeRoomKey: '0,0,0', sprite: { dataUrl: 'data:image/png,guard' } }] };
  const root = { dungeonRunId: 'run', getDungeonLifeContext: () => ctx, DungeonLife: { time: () => now },
    addEventListener() {}, innerWidth: 1000, innerHeight: 800, InventoryUi: Inventory };
  Object.defineProperty(root, 'gamePaused', { get: () => paused });
  const document = { createElement: element, getElementById: id => elements.get(id),
    head: element('head'), body: element('body'), addEventListener: (name, fn) => listeners[name] = fn };
  vm.runInNewContext(uiSource, { window: root, document, setInterval() {}, console: quiet });
  listeners.DOMContentLoaded();
  return { root, ctx, elements, advance: ms => { now += ms; root.DungeonActionNotices.tick(); }, pause: value => paused = value };
}

test('death notices display even for a dead actor; stale room/run and duplicate events do not display', () => {
  const f = browserFixture(), api = f.root.DungeonActionNotices;
  const event = { id: 'kill-1', runId: 'run', geoKey: '0,0,0', ...Feedback.defeat({ name: 'Guard' }, { name: 'Hero' }) };
  assert.equal(api.receive({ ...event, runId: 'other' }), false);
  assert.equal(api.receive({ ...event, geoKey: '9,9,9' }), false);
  assert.equal(api.receive(event), true); assert.equal(api.receive(event), false);
  const panel = f.elements.get('dungeon-action-notice');
  assert.equal(panel.hidden, false); assert.equal(panel.children[0].src, 'data:image/png,guard');
  assert.equal(panel.children[1].children[2].textContent, 'Killed by Hero.');
  f.ctx.dungeon.geoKey = '0,1,0'; api.tick(); assert.equal(panel.hidden, true);
});

test('completion notices never enter the speech queue and pause until gameplay resumes', () => {
  const f = browserFixture(), api = f.root.DungeonActionNotices; let spoken = 0;
  f.root.DungeonLife.receiveDialogue = () => spoken++;
  f.pause(true);
  api.receive({ id: 'solve', runId: 'run', geoKey: '0,0,0', kind: 'puzzle-complete', title: 'Archive', message: 'The cabinet opens. Check the Game Log.' });
  assert.equal(f.elements.get('dungeon-action-notice').hidden, true);
  f.pause(false); api.tick(); assert.equal(f.elements.get('dungeon-action-notice').hidden, false);
  assert.equal(spoken, 0); f.advance(7501); assert.equal(f.elements.get('dungeon-action-notice').hidden, true);
});

test('new completion notices immediately replace old control feedback instead of waiting behind clicks', () => {
  const f = browserFixture(), api = f.root.DungeonActionNotices;
  for (let i = 0; i < 3; i++) api.receive({ id: `dial-${i}`, runId: 'run', geoKey: '0,0,0', kind: 'puzzle-control', title: 'West dial', message: 'Click.' });
  api.receive({ id: 'solved', runId: 'run', geoKey: '0,0,0', kind: 'puzzle-complete', title: 'Archive', message: 'The cabinet opens.' });
  assert.equal(f.elements.get('dungeon-action-notice').dataset.kind, 'puzzle-complete');
});

test('dismissing an action notice hides it immediately, retains queued notices and never replays a dismissed event', () => {
  const f = browserFixture(), api = f.root.DungeonActionNotices;
  const first = { id: 'first', runId: 'run', geoKey: '0,0,0', kind: 'item-taken', title: 'Sword', message: 'Added to your backpack.' };
  api.receive(first); api.receive({ ...first, id: 'second', title: 'Shield' });
  api.dismiss(); assert.equal(f.elements.get('dungeon-action-notice').hidden, true);
  assert.equal(api.receive(first), false);
  api.tick(); assert.equal(f.elements.get('dungeon-action-notice').children[1].children[0].textContent, 'Shield');
  api.dismiss(); api.tick(); assert.equal(f.elements.get('dungeon-action-notice').hidden, true);
});

test('action notice dismissal remains available while paused without clearing the next notice', () => {
  const f = browserFixture(), api = f.root.DungeonActionNotices;
  const event = { id: 'first', runId: 'run', geoKey: '0,0,0', kind: 'item-taken', title: 'Sword', message: 'Taken.' };
  api.receive(event); api.receive({ ...event, id: 'second' }); f.pause(true);
  api.dismiss(); api.tick(); assert.equal(f.elements.get('dungeon-action-notice').hidden, true);
  f.pause(false); api.tick(); assert.equal(f.elements.get('dungeon-action-notice').hidden, false);
});

test('readings and examinations wait for X, never auto-advance or enter the speech queue', () => {
  for (const details of [{ kind: 'document-read', result: 'observed' }, { kind: 'writing-discovered' },
    { kind: 'art-examined' }, { kind: 'puzzle-control', result: 'observed' }]) {
    const f = browserFixture(), api = f.root.DungeonActionNotices; let spoken = 0;
    f.root.DungeonLife.receiveDialogue = () => spoken++;
    const event = { runId: 'run', geoKey: '0,0,0', id: 'read-1', title: 'An Unfinished Covenant', message: 'Retrieve the plate, then speak with Nera.', ...details };
    api.receive(event); api.receive({ ...event, id: 'read-2', message: 'The next page.' });
    const panel = f.elements.get('dungeon-action-notice'); f.advance(3600000);
    assert.equal(panel.hidden, false); assert.equal(panel.dataset.dismissal, 'manual');
    assert.equal(panel.children[1].children[2].textContent, event.message);
    assert.match(panel.children[1].children[1].textContent, /Close with X/);
    assert.equal(spoken, 0);
    f.elements.get('dungeon-action-notice-close').click(); assert.equal(panel.hidden, true);
    api.tick(); assert.equal(panel.children[1].children[2].textContent, 'The next page.');
  }
});

test('important readings cannot be evicted by puzzle completion or a backlog of notices', () => {
  const f = browserFixture(), api = f.root.DungeonActionNotices;
  const event = { runId: 'run', geoKey: '0,0,0', kind: 'puzzle-control', result: 'observed', title: 'Clue', message: 'Do not lose these instructions.' };
  for (let i = 0; i < 25; i++) api.receive({ ...event, id: 'clue-' + i, title: 'Clue ' + i });
  api.receive({ ...event, id: 'solved', kind: 'puzzle-complete', result: 'success', title: 'Solved' });
  const panel = f.elements.get('dungeon-action-notice'); f.advance(90001);
  assert.equal(panel.children[1].children[0].textContent, 'Clue 0');
  api.dismiss(); api.tick(); assert.equal(panel.children[1].children[0].textContent, 'Solved');
  for (let i = 1; i < 25; i++) {
    api.dismiss(); api.tick(); assert.equal(panel.children[1].children[0].textContent, 'Clue ' + i);
  }
});

test('manual readings remain dismissible while paused and clear on a room change or game reset', () => {
  const f = browserFixture(), api = f.root.DungeonActionNotices;
  const event = { id: 'read', runId: 'run', geoKey: '0,0,0', kind: 'document-read', title: 'Tablet', message: 'Instructions.' };
  api.receive(event); f.pause(true); f.advance(90000);
  const panel = f.elements.get('dungeon-action-notice'); assert.equal(panel.hidden, false);
  f.elements.get('dungeon-action-notice-close').click(); assert.equal(panel.hidden, true);
  f.pause(false); api.receive({ ...event, id: 'next' });
  f.ctx.dungeon.geoKey = '1,0,0'; api.tick(); assert.equal(panel.hidden, true);
  api.receive({ ...event, id: 'new-room', geoKey: '1,0,0' }); assert.equal(panel.hidden, false);
  api.reset(); assert.equal(panel.hidden, true);
});

test('confirmed pickups require room removal plus an inventory increase, not despawns equips or room transitions', () => {
  const f = browserFixture(), api = f.root.DungeonActionNotices;
  const snapshot = { geoKey: '0,0,0', objects: 'bronze sword, silver ring', inventory: 'None' };
  assert.deepEqual(Array.from(api.observeItems(snapshot)), []);
  assert.equal(api.observeItems({ ...snapshot, objects: 'silver ring', inventory: 'bronze sword' }).length, 1);
  assert.equal(api.observeItems({ ...snapshot, objects: 'None', inventory: 'bronze sword' }).length, 0);
  assert.equal(api.observeItems({ ...snapshot, objects: 'None', inventory: 'bronze sword, silver ring' }).length, 0);
  f.ctx.dungeon.geoKey = '0,1,0';
  assert.equal(api.observeItems({ geoKey: '0,1,0', objects: 'None', inventory: 'bronze sword, silver ring' }).length, 0);
});

function commandGate() {
  const root = {};
  vm.runInNewContext(gateSource, { window: root, document: { addEventListener() {} } });
  return { root, api: root.GameCommandGate };
}

test('loading gate blocks duplicate commands until final polling result, without setting pause or movement flags', async () => {
  const f = commandGate(); let calls = 0, release;
  const submit = f.api.wrap(async () => { calls++; f.api.transportStarted('/processInput7'); await new Promise(resolve => release = resolve); });
  const first = submit(); assert.equal(f.api.busy(), true); await submit(); assert.equal(calls, 1);
  release(); await first; assert.equal(f.api.busy(), true);
  f.api.transportFinished('/processInput7', { taskId: '1' }); assert.equal(f.api.busy(), true);
  f.api.transportFinished('/poll-task2/1', { status: 'processing' }); assert.equal(f.api.busy(), true);
  f.api.transportFinished('/poll-task2/1', { status: 'complete' }); assert.equal(f.api.busy(), false);
  assert.equal(f.root.gamePaused, undefined); assert.equal(f.root._combatCommandPending, undefined);
});

test('inline mechanical results network errors and local failures all release the loading gate', async () => {
  for (const [url, response, failed] of [['/processInput7', { completedStartResult: {} }, false],
    ['/processInput7', null, true], ['/poll-task2/1', null, true], ['/poll-task2/1', { status: 'error' }, false]]) {
    const f = commandGate(); f.api.transportStarted('/processInput7'); f.api.transportFinished(url, response, failed);
    assert.equal(f.api.busy(), false);
  }
  const f = commandGate();
  await assert.rejects(f.api.wrap(async () => { throw Error('sync failed'); })(), /sync failed/);
  assert.equal(f.api.busy(), false);
});

test('startup results may still be applied while normal commands are blocked during first-room construction', async () => {
  const f = commandGate(); let calls = 0;
  f.root._characterStartupPending = true;
  const submit = f.api.wrap(async () => calls++);
  await submit(); assert.equal(calls, 0);
  await submit({ completedStartResult: {} }); assert.equal(calls, 1);
});

test('all three combat modes and committed action adjudication publish notices at resolution, not planning', () => {
  assert.equal((source.match(/ActionFeedback\.defeat\(target, combatant\)/g) || []).length, 3);
  const start = source.indexOf('async function resolveActionWithSimulation('), end = source.indexOf('async function adjudicateActionWithPythonSimulation(', start);
  const resolver = source.slice(start, end);
  assert.ok(resolver.indexOf('processGameUpdate(') < resolver.indexOf('ActionFeedback.adjudication('));
  assert.doesNotMatch(source.slice(source.indexOf('async function generateAdditionalOutcomes('), source.indexOf('// LLM-only gate')), /ActionFeedback/);
});
