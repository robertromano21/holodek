'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const Placement = require('../retort/questPlacement');
function options(patch = {}) { return { coordinates: ['0,0,0', '0,0,30', '0,1,0', '9,9,0'], currentRoomKey: '0,0,30',
  bossKey: '9,9,0', elementType: 'monster', hasMonstersInCurrent: true, preferElsewhere: true, ...patch }; }
test('the two-session current-room regression keeps the requested resident location inside the enum', () => {
  const selection = Placement.plan(options()); assert.ok(selection.candidates.includes('0,0,30'));
  assert.ok(selection.data.preference.includes('reuse')); assert.ok(!selection.candidates.includes('9,9,0'));
  assert.deepEqual(JSON.parse(selection.brief.match(/Read-only data: (.*)\. Prefer/)[1]).candidates, selection.candidates);
});
test('elsewhere is a soft preference, not a contradictory exclusion of the current room', () => {
  for (const elementType of ['object', 'key', 'monster']) {
    const value = Placement.plan(options({ elementType, hasMonstersInCurrent: false }));
    assert.ok(value.candidates.includes(value.data.currentRoomKey)); assert.match(value.instruction, /preference, not an exclusion/);
    assert.doesNotMatch(value.instruction, /reuse an existing/i);
  }
});
test('a current boss room or an absent current room is never proposed as an inhabitant placement', () => {
  for (const currentRoomKey of ['9,9,0', '8,8,0']) {
    const value = Placement.plan(options({ currentRoomKey })); assert.equal(value.data.currentRoomKey, undefined);
    assert.doesNotMatch(value.data.preference, /reuse/); assert.ok(!value.candidates.includes('9,9,0'));
  }
});
test('coordinate aliases normalize and invalid/boss-only enums fail before authoring', () => {
  assert.deepEqual(Placement.plan(options({ coordinates: ['X: 0, Y: 1, Z: 0', '0,1,0', 'bad'] })).candidates, ['0,1,0']);
  assert.throws(() => Placement.plan(options({ coordinates: ['9,9,0', 'bad'] })), /no allowed/);
});
test('valid choices use one authoring request with the exact prompt enum', async () => {
  let calls = 0; const selection = Placement.plan(options());
  const $ = { assistant: { async generation(config) { calls++; assert.deepEqual(config.parameters.placement.enum, selection.candidates); return { content: '{"placement":"0,0,30"}' }; } } };
  assert.deepEqual(await Placement.request($, selection), { content: '{"placement":"0,0,30"}' }); assert.equal(calls, 1);
});
test('schema-rejected placement retries only the small selection, never room construction', async () => {
  let calls = 0; const hints = [], selection = Placement.plan(options());
  const error = Object.assign(Error('placement does not match the answer schema'), { code: 'MODEL_SCHEMA',
    rejectedAnswer: { placement: '88,88,88' }, issues: [{ path: '$.placement', message: 'not in enum' }] });
  const $ = { user(parts, ...values) { hints.push(parts.reduce((s, p, i) => s + p + (values[i] || ''), '')); },
    assistant: { async generation() { if (++calls === 1) throw error; return { content: '{"placement":"0,1,0"}' }; } } };
  assert.deepEqual(await Placement.request($, selection), { content: '{"placement":"0,1,0"}' }); assert.equal(calls, 2);
  assert.equal(hints.length, 1); assert.match(hints[0], /exact enum/);
});
test('permanent provider failures do not invent a placement or start retry loops', async () => {
  let calls = 0; const error = Object.assign(Error('invalid api key'), { status: 401 });
  const $ = { assistant: { async generation() { calls++; throw error; } } };
  await assert.rejects(Placement.request($, Placement.plan(options())), error); assert.equal(calls, 1);
});
test('the actual quest pipeline uses matching prompt data and enums for both model paths', () => {
  const source = fs.readFileSync(require.resolve('../retort/retortWithUserInput'), 'utf8');
  assert.ok(source.includes('const enumList = placementPlan.candidates'));
  assert.ok(source.includes('placementPlan.data, placementPlan.instruction'));
  assert.ok(source.includes("require('./questPlacement').request($, placementPlan)"));
  assert.ok(!source.includes('If the element is a monster and there are monsters here, prefer the current room'));
});
