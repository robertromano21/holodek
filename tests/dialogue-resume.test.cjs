'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const source = fs.readFileSync(require.resolve('../assets/dungeonLifeUi'), 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function fixture({ unread = false, respond } = {}) {
  let now = Date.now();
  const calls = [];
  const dungeon = { geoKey: '1,1,0', layout: { width: 24, height: 24 }, cells: {} };
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) dungeon.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
  const actors = [{ name: 'Mortacia', type: 'pc', hp: 138, mazeX: 4, mazeY: 4, mazeRoomKey: dungeon.geoKey },
    { name: 'Orro Flintcup', type: 'npc', hp: 20, mazeX: 5, mazeY: 4, mazeRoomKey: dungeon.geoKey }];
  const population = { geoKey: dungeon.geoKey, revision: 1, actors: {}, groups: [], companions: {
    'Orro Flintcup': { dialogue: ['The stone is sound.', 'Let us find the keeper.'], dialogueIndex: unread ? 1 : 2 }
  }, dialogueQueue: [], lastDialogueRefreshAt: now - 120000 };
  const ctx = { dungeon, actors, player: { x: 4.5, y: 4.5 }, busy: false };
  const root = { DungeonInhabitants: I, dungeonRunId: 'run', getDungeonLifeContext: () => ctx, addEventListener() {} };
  const document = { getElementById: () => null, querySelector: () => null, addEventListener() {}, activeElement: null };
  vm.runInNewContext(source, { window: root, Date: { now: () => now }, console: { info() {}, warn() {} },
    document,
    setInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (respond) return respond(url, population, now);
      return { ok: true, json: async () => url.endsWith('/autonomy') ?
        { refreshed: true, population: { ...population, lastDialogueRefreshAt: now } } : { population, dialogue: [] } };
    } });
  return { api: root.DungeonLife, root, document, population, actors, calls, advance: ms => { now += ms; },
    autonomy: () => calls.filter(row => row.url.endsWith('/autonomy')),
    restore() { root.DungeonLife.reset({ paused: true }); root.DungeonLife.restorePopulation({ population, runId: 'run' }); } };
}

test('loading exhausted dialogue refreshes after resume without replaying spent lines or waiting five minutes', async () => {
  const f = fixture(); f.restore(); f.api.tick();
  assert.equal(f.calls.length, 0, 'Loading must remain paused.');
  f.advance(15000); f.api.setPaused({ paused: false }); f.api.tick(); await settle();
  assert.equal(f.autonomy().length, 1);
  assert.equal(f.api.population().companions['Orro Flintcup'].dialogueIndex, 2);
  f.api.tick(); await settle(); assert.equal(f.autonomy().length, 1);
});

test('loading a fresh unread cache preserves its remaining refresh interval', async () => {
  const f = fixture({ unread: true }); f.restore(); f.api.setPaused({ paused: false });
  f.advance(179000); f.api.tick(); await settle(); assert.equal(f.autonomy().length, 0);
  f.advance(1100); f.api.tick(); await settle(); assert.equal(f.autonomy().length, 1);
});

test('a busy refresh retries after thirty seconds instead of waiting another five minutes', async () => {
  const f = fixture({ respond: async (url, population) => url.endsWith('/autonomy') ?
    { ok: false, status: 409 } : { ok: true, json: async () => ({ population, dialogue: [] }) } });
  f.restore(); f.api.setPaused({ paused: false }); f.api.tick(); await settle();
  assert.equal(f.autonomy().length, 1);
  f.advance(29900); f.api.tick(); await settle(); assert.equal(f.autonomy().length, 1);
  f.advance(101); f.api.tick(); await settle(); assert.equal(f.autonomy().length, 2);
});

test('responses from the discarded pre-load timeline cannot replace restored population state', async () => {
  const pending = [];
  const f = fixture({ respond: () => new Promise(resolve => pending.push(resolve)) });
  f.restore(); f.api.setPaused({ paused: false }); f.api.tick();
  assert.equal(pending.length, 2);
  f.api.reset({ paused: true });
  f.api.restorePopulation({ population: { ...f.population, revision: 2 }, runId: 'run' });
  for (const resolve of pending) resolve({ ok: true, json: async () => ({ refreshed: true,
    population: { ...f.population, revision: 999 }, dialogue: [] }) });
  await settle(); assert.equal(f.api.population().revision, 2);
});

test('a distant or absent partner cannot keep an exhausted nearby cache waiting', () => {
  const f = fixture(); f.population.companions.Absent = { dialogue: ['Still waiting.'], dialogueIndex: 0 };
  f.population.dialogueQueue = [{ lines: [{ speaker: 'Orro Flintcup', line: 'Where are you?' }, { speaker: 'Absent', line: 'Here.' }] }];
  assert.equal(I.dialogueRefreshDelay(f.population, [f.actors[1]]), 0);
  f.population.companions['Orro Flintcup'].dialogueIndex = 1;
  assert.ok(I.dialogueRefreshDelay(f.population, [f.actors[1]]) > 170000);
});

test('a focused empty command box does not indefinitely silence idle dialogue after loading', async () => {
  const f = fixture(); f.restore(); f.api.setPaused({ paused: false });
  f.document.activeElement = { tagName: 'TEXTAREA', value: '' };
  f.api.tick(); await settle(); assert.equal(f.autonomy().length, 1);
});

test('an unfinished command draft still defers idle refresh until it is cleared', async () => {
  const f = fixture(); f.restore(); f.api.setPaused({ paused: false });
  f.document.activeElement = { tagName: 'TEXTAREA', value: 'ask Iven about' };
  f.api.tick(); await settle(); assert.equal(f.calls.length, 0);
  f.document.activeElement.value = ''; f.api.tick(); await settle(); assert.equal(f.autonomy().length, 1);
});
