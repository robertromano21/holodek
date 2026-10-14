'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), { EventEmitter } = require('node:events');
const Logs = require('../retort/campaignPlanningLog'), Campaign = require('../retort/campaignSetting');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'holodek-planning-'));
  t.after(async () => { for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file)); await fs.rmdir(directory); });
  let runId = 'campaign-one', tasks = [], quest = 'Recover Sepulchra';
  let db = { '0,0,0': { campaignAtlas: { runId, source: 'validated-campaign-plan', regions: Campaign.REGIONS, factions: Campaign.FACTIONS } } };
  const state = { emitter: new EventEmitter(), getDungeonRunId: () => runId, getRoomNameDatabase: () => JSON.stringify(db),
    getCurrentTasks: () => tasks, getCurrentQuest: () => quest, getUpdatedGameConsole: () => 'Next Boss: Ash Regent\nNext Boss Room: Real Sanctuary\nBoss Room Coordinates: X: 4, Y: 2, Z: 0\nNext Artifact: Sepulchra' };
  const logger = Logs.createLogger({ directory, now: () => new Date('2026-10-14T10:00:00Z') });
  const stop = logger.watch(state); t.after(stop);
  return { directory, state, logger, db: () => db, tasks: value => tasks = value, quest: value => quest = value,
    run: value => runId = value, read: () => fs.readFile(path.join(directory, Logs.filename(runId)), 'utf8') };
}
test('one readable log per generated game retains geography, factions, exact quest requirements and every completion', async t => {
  const f = await fixture(t); await f.logger.capture(f.state, 'new-game campaign plan');
  const first = { id: 'first', type: 'Retrieve', desc: 'Find the real maul in Stone Hall and give it to Edrin.', status: 'Pending',
    requiredElements: [{ name: 'real maul', placement: '2,1,0' }], hardRequirements: [{ check: 'item_delivered', value: 'real maul' }] };
  f.tasks([first]); f.state.emitter.emit('quest:tasks');
  first.status = 'Completed'; first.progress = { checks: [{ check: 'item_delivered', passed: true }] }; f.state.emitter.emit('quest:tasks');
  f.tasks([]); f.quest('Reopen the ferry');
  const second = { id: 'second', type: 'Rescue', desc: 'Escort the ferryman home.', status: 'Pending' };
  f.tasks([second]); f.state.emitter.emit('quest:tasks'); second.status = 'Completed'; f.state.emitter.emit('quest:taskIndex');
  await f.logger.flush(); const content = await f.read();
  for (const value of ['Tartarus Frontier', 'Lower Riverlands', 'Cistern Compact', 'real maul', 'Stone Hall', 'Edrin', '2,1,0', 'item_delivered', 'Escort the ferryman home.']) assert.ok(content.includes(value), value);
  assert.equal((content.match(/QUEST TASK COMPLETED/g) || []).length, 2);
  assert.ok(content.indexOf('"status": "Pending"') < content.indexOf('"status": "Completed"'));
  assert.ok(content.indexOf('Find the real maul') < content.indexOf('Escort the ferryman'));
  const before = content; await f.logger.capture(f.state); assert.equal(await f.read(), before, 'Repeated reads must not duplicate unchanged plans');
  f.run('campaign-two'); await f.logger.capture(f.state, 'new game');
  assert.equal((await fs.readdir(f.directory)).length, 2); assert.match(await f.read(), /Game run: campaign-two/);
  assert.equal(await fs.readFile(path.join(f.directory, Logs.filename('campaign-one')), 'utf8'), before);
});
test('first regional plan includes its dialogue, staged encounters, rescue, actual room names and readable clues', async t => {
  const f = await fixture(t), story = { id: 'regional-first', title: 'The Water Debt', stages: [
    { id: 'hook', actor: 'Edrin', text: 'Our well surveyor is missing.' },
    { id: 'road', kind: 'encounter', roomKey: '2,1,0', targets: ['Marl', 'Kelan'] },
    { id: 'rescue', kind: 'escort', actor: 'Varo', roomKey: '2,0,0' },
    { id: 'resolution', options: [{ id: 'shared-wells', factionEffects: { wellkeepers: 2 } }] }] };
  f.db()['0,0,0'].regionalAdventure = { storyId: story.id, rooms: ['2,0,0', '2,1,0'] };
  f.db()['2,0,0'] = { name: 'Amber Spring Gardens', regionalSite: { actors: [{ name: 'Varo', history: 'Refused an unjust levy.' }] }, inscriptions: [{ name: 'oasis charter', text: 'The wells belong to the households.' }] };
  f.db()['2,1,0'] = { name: 'Cinder Caravan Road' };
  f.tasks([{ id: 'regional-task', story, status: 'Pending', hardRequirements: [{ check: 'quest_story_complete', value: story.id }] }]);
  await f.logger.capture(f.state, 'first connected adventure installed'); const content = await f.read();
  for (const value of ['FIRST CONNECTED ADVENTURE', 'Amber Spring Gardens', 'Cinder Caravan Road', 'Marl', 'Kelan', 'Varo', 'The wells belong', 'Refused an unjust levy', 'shared-wells', 'quest_story_complete']) assert.ok(content.includes(value), value);
});
test('fallback decisions, failed quests and local mission completion stay in the same append-only history', async t => {
  const f = await fixture(t);
  f.db()['0,0,0'].campaignAtlas.source = 'seeded-campaign-fallback';
  f.db()['0,0,0'].regionalAdventureAttempt = { status: 'fallback', reason: 'No suitable connected route.' };
  f.tasks([{ id: 'failed-delivery', desc: 'Deliver the charged sword.', status: 'Failed', failureReason: 'The sword turned to ash.' }]);
  f.db()['0,0,0'].minorMissions = { local: { id: 'local', description: 'Bring the keeper a real token.', status: 'accepted', rewardSilver: 3 } };
  await f.logger.capture(f.state);
  f.db()['0,0,0'].minorMissions.local.status = 'completed'; f.state.emitter.emit('quest:minorMission'); await f.logger.flush();
  const content = await f.read(); for (const value of ['seeded-campaign-fallback', 'No suitable connected route', 'QUEST TASK FAILED', 'sword turned to ash', 'LOCAL MISSION COMPLETED']) assert.ok(content.includes(value));
});
test('restart appends rather than overwriting existing history, and hostile run IDs cannot escape logs', async t => {
  const f = await fixture(t); await f.logger.capture(f.state); const before = await f.read();
  const restarted = Logs.createLogger({ directory: f.directory }); await restarted.capture(f.state, 'server resumed');
  assert.ok((await f.read()).startsWith(before)); assert.equal(((await f.read()).match(/CHILDREN OF THE GRAVE/g) || []).length, 1);
  for (const runId of ['../outside', 'C:\\elsewhere', '../../logs/foo', '']) assert.match(Logs.filename(runId), /^campaign-planning-[a-z0-9_-]+\.txt$/i);
});
test('diagnostic write failure never changes gameplay or rejects a quest event', async () => {
  const warnings = [], state = { getDungeonRunId: () => 'readonly', getRoomNameDatabase: () => '{}', getCurrentTasks: () => [{ status: 'Completed', desc: 'Done' }] };
  const before = JSON.stringify(state.getCurrentTasks());
  const logger = Logs.createLogger({ files: { mkdir: async () => { throw Error('read only disk'); } }, warn: message => warnings.push(message) });
  assert.equal(await logger.capture(state), null); assert.equal(warnings.length, 1); assert.equal(JSON.stringify(state.getCurrentTasks()), before);
  const sparse = []; sparse[2] = { desc: 'A valid final boss task', status: 'Pending' };
  state.getCurrentTasks = () => sparse;
  assert.equal(await logger.capture(state), null, 'Sparse legacy task arrays must never throw through event emitters');
});
