'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const { templateContent } = require('retort-js/dist/message');
const I = require('../assets/dungeonInhabitants');
const Profiles = require('../assets/characterProfiles');
const Authorship = require('../retort/characterProfiles');
const { generateInhabitants } = require('../retort/inhabitantGeneration');
const { describeCharacters } = require('../retort/characterDialogue');
const Runtime = require('../retort/gameRetort');
const Protocol = require('../retort/graveMasterProtocol');
const { createModelService } = require('../retort/gameModels');
const inhabitants = require('./fixtures/inhabitants.cjs');
const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8').replace(/\r\n/g, '\n');
const original = templateContent({ raw: [source.match(/\$\.user`(Instructions for the Grave Master:[\s\S]*?Backend Integration: Programmatic vs\. Narrative Handling)`;/)[1]] });
const rules = { level: () => 1, random: min => min, sex: () => 'Female', xp: () => 0, equipment: async () => null };
const context = { geoKey: '0,0,0', roomName: 'Ruined Temple Entrance', roomDescription: 'A ruined temple vault.', indoor: true, partyNames: ['Mortacia'] };
const authored = name => ({ name, personality: 'Patient and curious.', voice: 'Warm practical observations.',
  history: 'Restored a memorial bridge. Trained the local apprentices.', motivation: 'Finish rebuilding the bridge.' });
function agent(reply) {
  const prompts = [], requests = [];
  return { prompts, requests, user: (parts, ...values) => prompts.push(templateContent(parts, ...values)),
    assistant: { generation: async options => { requests.push(options); return { content: typeof reply === 'string' ? reply : JSON.stringify(reply) }; } } };
}

test('party biography-writing prompt is identical to the pre-Luna source', () => {
  const text = fs.readFileSync(require.resolve('../retort/characterProfiles'), 'utf8').replace(/\r\n/g, '\n');
  const prompt = text.match(/await \$\.user`(Create compact[\s\S]*?)`;/)[1];
  assert.equal(crypto.createHash('sha256').update(prompt).digest('hex'), '91bb5fbae9fdab5e9f1a2202ec52f60a2baff3a125b1eb2526d4ca58a7dc82b3');
});

test('actual Ruined Temple creation delegates to the regional generator, while party opening and boss exceptions remain', async () => {
  const start = source.indexOf('async function generateMonstersForRoomUsingGPT(');
  const code = source.slice(start, source.indexOf('async function generateRoomInhabitantPopulation(', start));
  const requests = [], sandbox = { updatedGameConsole: 'Coordinates: X: 0, Y: 0, Z: 0\nNPCs in Party: None',
    generateRoomInhabitantPopulation: async (...args) => requests.push(args), console: { log() {}, error() {} } };
  vm.runInNewContext(code, sandbox);
  const $ = {};
  await sandbox.generateMonstersForRoomUsingGPT($, context.roomName, context.roomDescription);
  assert.equal(requests.length, 1); assert.equal(requests[0][0], $); assert.equal(requests[0][3], '0,0,0');
  sandbox.updatedGameConsole = 'Coordinates: X: 0, Y: 0, Z: 0\nNPCs in Party: Mortacia';
  await sandbox.generateMonstersForRoomUsingGPT($, context.roomName, context.roomDescription);
  assert.equal(requests.length, 1, 'Party awakening retains its no-extra-residents opening.');
  sandbox.updatedGameConsole = 'Coordinates: X: 2, Y: 0, Z: 0\nNPCs in Party: None';
  await sandbox.generateMonstersForRoomUsingGPT($, 'Crossing', 'A crossing.');
  assert.equal(requests.at(-1)[3], '2,0,0');
  sandbox.updatedGameConsole += '\nBoss Room Coordinates: X: 2, Y: 0, Z: 0';
  sandbox.getRandomInt = () => { throw Error('legacy boss branch'); };
  await assert.rejects(sandbox.generateMonstersForRoomUsingGPT($, 'Lair', 'A lair.'), /legacy boss branch/);
});

for (const count of [1, 4]) test(`Ruined Temple's ${count} friendly residents receive authored histories, voices and persistent profiles in one call`, async () => {
  const rows = inhabitants(count), a = agent({ inhabitants: rows });
  const result = await generateInhabitants(a, { ...context, quest: 'Existing quest', questSeed: true }, { ...rules,
    random: (min, max) => max === 5 ? count : min });
  assert.equal(a.requests.length, 1); assert.ok(a.requests[0].parameters.inhabitants);
  assert.equal(a.requests[0].strictParameters, true, 'Validate authored identities through the strict contract.');
  assert.equal(result.population.starting, true); assert.equal(result.population.questIntroduction, undefined);
  assert.equal(Object.keys(result.population.actors).length, count);
  const saved = JSON.parse(JSON.stringify(result.population)), roster = I.parseBlocks(result.sheets).map(a => ({ ...a, type: 'monster' }));
  I.attach(roster, saved);
  for (const row of rows) {
    const record = saved.actors[row.name];
    assert.equal(record.allegiance, 'Friendly'); assert.equal(record.profile.source, 'llm');
    assert.equal(record.profile.voice, row.voice); assert.equal(record.profile.history, row.history);
    assert.equal(Profiles.complete(record.profile), true);
    assert.equal(describeCharacters(roster, saved).find(a => a.name === row.name).background.history, row.history);
  }
  assert.equal(await Authorship.ensurePopulationProfiles({ assistant: { generation() { throw Error('Must reuse biographies.'); } } }, saved, roster), 0);
});

for (const [label, mutate, expected] of [
  ['empty array', () => [], /exactly 1 inhabitants/],
  ['missing biography', rows => { delete rows[0].history; return rows; }, /Slot 0.history/],
  ['missing voice', rows => { delete rows[0].voice; return rows; }, /Slot 0.voice/],
  ['blank personality', rows => { rows[0].personality = ''; return rows; }, /Slot 0.personality/],
  ['invalid slot', rows => { rows[0].slot = 2; return rows; }, /Unknown or duplicate inhabitant slot/],
  ['reserved deity', rows => { rows[0].name = 'Artihus'; return rows; }, /reserved name/],
  ['party collision', rows => { rows[0].name = 'Mortacia'; return rows; }, /reserved name/],
  ['missing greeting', rows => { rows[0].dialogue = []; return rows; }, /dialogue requires/]
]) test(`invalid inhabitant generation: ${label} raises a diagnostic error, never a replacement resident`, async () => {
  const a = agent({ inhabitants: mutate(inhabitants(1)) }); let rolls = 0;
  await assert.rejects(generateInhabitants(a, context, { ...rules, level: () => { rolls++; return 1; } }), expected);
  assert.equal(a.requests.length, 1); assert.equal(rolls, 0, 'Validate complete cast before allocating stats or equipment.');
});

test('malformed inhabitant JSON and API failures propagate rather than returning stock residents', async () => {
  await assert.rejects(generateInhabitants(agent('{broken'), context, rules), /Inhabitant generation failed/);
  const a = agent(''); a.assistant.generation = async () => { throw Error('provider unavailable'); };
  await assert.rejects(generateInhabitants(a, context, rules), /provider unavailable/);
});

test('duplicate resident identities cannot be silently replaced with Ash Pilgrims', async () => {
  const rows = inhabitants(8); rows[1].name = rows[0].name;
  await assert.rejects(generateInhabitants(agent({ inhabitants: rows }), { ...context, geoKey: '1,0,0' }, rules), /duplicate or reserved name/);
  rows[1].name = 'Unique Resident'; rows[1].slot = 0;
  await assert.rejects(generateInhabitants(agent({ inhabitants: rows }), { ...context, geoKey: '1,0,0' }, rules), /duplicate inhabitant slot/);
});

test('missing or malformed party biographies fail visibly, without overwriting saved characters', async () => {
  const cast = [{ Name: 'Mortacia' }, { Name: 'Mason', Race: 'Dwarf', Class: 'Mason', HP: 20, sprite: { dataUrl: 'unchanged' } }];
  const before = JSON.stringify(cast);
  for (const reply of ['{broken', { profiles: [] }, { profiles: [{ name: 'Mason', history: 'Only one field.' }] },
    { profiles: [authored('Mason'), authored('Mason')] }, { profiles: [authored('Wrong Name')] }]) {
    const a = agent(reply);
    await assert.rejects(Authorship.generateProfiles(a, cast, 'run'), /Character history generation failed/);
    assert.equal(a.requests.length, 1); assert.equal(JSON.stringify(cast), before);
  }
});

test('legacy stock biographies request real authorship once, without regenerating complete profiles on model switches', async () => {
  const population = I.createPopulation('0,0,0', [{ name: 'Mason', allegiance: 'Friendly' }], { starting: true });
  population.actors.Mason.profile = { history: "Mason's past is tied to a forgotten harbor. That memory still shapes how this individual treats strangers and obligations.",
    motivation: 'Resolve the regret associated with a forgotten harbor, while avoiding another betrayal.' };
  const roster = [{ name: 'Mason', type: 'monster', hp: 20, race: 'Dwarf', className: 'Mason', sprite: { dataUrl: 'unchanged' } }];
  const a = agent({ profiles: [authored('Mason')] });
  assert.equal(await Authorship.ensurePopulationProfiles(a, population, roster, { runId: 'run' }), 1);
  assert.equal(a.requests.length, 1); assert.equal(population.actors.Mason.profile.source, 'llm');
  assert.equal(roster[0].hp, 20); assert.equal(roster[0].sprite.dataUrl, 'unchanged');
  const saved = JSON.parse(JSON.stringify(population)), next = agent('invalid');
  assert.equal(await Authorship.ensurePopulationProfiles(next, saved, roster, { runId: 'run' }), 0);
  assert.equal(next.requests.length, 0); assert.equal(saved.actors.Mason.profile.history, authored('Mason').history);
});

test('completing a previously authored partial biography preserves its established personal facts', async () => {
  const actor = { name: 'Mason', race: 'Dwarf', className: 'Mason', originProfile: { history: 'Built the basalt bridge with her sister.',
    personality: 'Patient and curious.', motivation: 'Find her missing sister.' } };
  const a = agent({ profiles: [authored('Mason')] }), [profile] = await Authorship.generateProfiles(a, [actor], 'run');
  assert.equal(profile.history, actor.originProfile.history); assert.equal(profile.motivation, actor.originProfile.motivation);
  assert.equal(profile.voice, authored('Mason').voice); assert.equal(Profiles.complete(profile), true);
  assert.match(a.prompts[0], /basalt bridge with her sister/);
});

test('4.1 Mini and Luna send identical character-writing prompts and inputs for the same starting or regional cast', async () => {
  for (const geoKey of ['0,0,0', '1,0,0']) {
    const captures = [];
    for (const id of ['gpt-4.1-mini', 'gpt-6-luna']) {
      const requests = [], content = JSON.stringify({ inhabitants: inhabitants(geoKey === '0,0,0' ? 1 : 8).map(row => ({
        ...row, allegiance: geoKey === '0,0,0' ? 'Friendly' : row.slot < 3 ? 'Neutral' : 'Hostile',
        encounterId: 'local-' + Math.floor(row.slot / 3), homeSite: 'commons'
      })) });
      const client = { chat: { completions: { create: async body => {
        requests.push(body);
        return (async function* () {
          yield { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'authored_cast', type: 'function', function: { name: 'answer', arguments: content } }] }, finish_reason: null }] };
          yield { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
        })();
      } } } };
      const models = createModelService({ initial: id, clientFor: () => client });
      const state = { getCurrentPC: () => ({ Name: 'Mortacia' }) };
      const runtime = Runtime.createRuntime({ models, client, log() {},
        prepareMessages: Protocol.enabled(models) ? Protocol.createProtocol(state) : undefined });
      await runtime.run(runtime.retort(async $ => {
        $.user(original);
        const nestedRun = $.run;
        $.run = (work, params, options) => nestedRun(work, params, { ...options, shouldSaveToLog: false });
        return Authorship.runWithLore($, child => generateInhabitants(child, { ...context, geoKey }, rules));
      }), null, { shouldSaveToLog: false });
      assert.equal(requests.length, 1); assert.equal(requests[0].model, id);
      assert.equal(requests[0].tools[0].function.strict, true); assert.equal(requests[0].temperature, .85);
      captures.push(requests[0].messages.filter(m => m.content === original || m.role === 'user').map(m => m.content));
    }
    assert.deepEqual(captures[0], captures[1], 'Only the model-specific backend role adapter may differ, never character instructions or world data.');
  }
});
