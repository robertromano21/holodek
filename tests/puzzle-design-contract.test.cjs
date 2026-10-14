'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../assets/physicalPuzzles'), Art = require('../assets/surfaceArt');
const { designPrompt, generateDesign } = require('../retort/physicalPuzzleDesign');
const context = { roomName: 'Ruined Temple Entrance', seed: 'contract-test', quest: 'None' };
const clone = value => JSON.parse(JSON.stringify(value));
const painting = { kind: 'fresco', surface: 'wall', label: 'The Keeper of the Dead',
  description: 'A historical depiction of Mortacia judging the dead.', motifs: ['Mortacia', 'scales'], pigments: 'ochre' };
function valid() {
  return { ...P.fallback(context.seed, context.roomName), title: 'The Custodians Apparatus',
    context: 'Three carved controls preserve the reception ritual.', lore: 'The temple once kept records of souls awaiting judgment.', roomArt: [clone(painting)] };
}
function agent(responses) {
  const prompts = [], calls = [];
  return { prompts, calls, user(parts, ...values) { prompts.push(String.raw({ raw: parts }, ...values)); },
    assistant: { async generation(options) { calls.push(options); return { content: JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]) }; } } };
}

test('puzzle contract explicitly documents the limits and required artwork schema missing from the logged attempt', () => {
  const prompt = designPrompt(context);
  assert.match(prompt, /context: nonempty text <=300 CHARACTERS/);
  assert.match(prompt, /lore: nonempty text <=320 CHARACTERS/);
  assert.match(prompt, /label \(NOT name\), description and motifs/);
  assert.match(prompt, /pigments is ONE palette-name string, never an array/);
  assert.match(prompt, /FINAL SCHEMA CHECK BEFORE ANSWERING/);
  const examples = [...prompt.matchAll(/Example of a valid decorative entry: (\{[^\n]*?\})\./g)];
  assert.equal(examples.length, 1);
  for (const example of examples) assert.equal(Art.validate([JSON.parse(example[1])]).length, 1);
});

test('the latest logged context/lore sizes fail with field-specific lengths instead of a generic rejection', () => {
  for (const [contextLength, loreLength] of [[374, 357], [465, 335]]) {
    assert.throws(() => P.compile({ ...valid(), context: 'x'.repeat(contextLength), lore: 'x'.repeat(loreLength) }), error => {
      assert.match(error.message, new RegExp(`context.*max 300 characters.*received ${contextLength} characters`));
      assert.match(error.message, new RegExp(`lore.*max 320 characters.*received ${loreLength} characters`));
      return true;
    });
  }
  assert.throws(() => P.compile({}), /kind must be one of/);
  assert.throws(() => P.compile(null), /expected one JSON object/);
});

test('logged artwork mistakes produce actionable feedback without discarding validation', () => {
  const bad = { kind: 'fresco', surface: 'wall', name: 'The Measure of Keeping', pigments: ['vermilion', 'lapis', 'ochre'] };
  assert.throws(() => Art.validate([bad]), error => {
    for (const field of [/roomArt\[0\]/, /label is required \(not name\)/, /description is required/, /motifs is required/, /pigments must be ONE string/])
      assert.match(error.message, field);
    return true;
  });
  assert.throws(() => Art.validate([{ ...painting, pigments: ['ochre'] }]), /not an array/);
});

test('a corrected model-authored design is accepted on retry and retains its own lore and controls', async t => {
  const reports = []; t.mock.method(console, 'warn', (...args) => reports.push(args));
  const good = valid(), a = agent([{ ...good, context: 'x'.repeat(465), lore: 'x'.repeat(335) }, good]);
  const result = await generateDesign(a, context);
  assert.equal(a.calls.length, 2); assert.equal(result.title, good.title); assert.equal(result.lore, good.lore);
  assert.deepEqual(result.controls, good.controls); assert.equal(result.roomArt[0].label, painting.label);
  assert.match(a.prompts[1], /previous design was rejected: Invalid physical puzzle design: context/);
  assert.match(a.prompts[1], /received 465 characters/);
  const report = JSON.parse(reports.find(([tag]) => tag === '[PuzzleDesignAttempt]')[1]);
  assert.equal(report.attempt, 1); assert.match(report.reason, /max 300 characters/);
});

test('invalid decorative metadata receives field-specific feedback on the existing second attempt', async t => {
  t.mock.method(console, 'warn', () => {});
  const good = valid(), bad = { ...good, roomArt: [{ kind: 'mosaic', surface: 'wall', name: 'The First Welcome' }] };
  const a = agent([bad, good]), result = await generateDesign(a, context);
  assert.equal(a.calls.length, 2); assert.equal(result.title, good.title);
  assert.match(a.prompts[1], /roomArt\[0\].*label is required/);
  assert.match(a.prompts[1], /description is required.*motifs is required/);
});

test('unrepaired model output still uses the verified solvable fallback after exactly two attempts', async t => {
  const reports = []; t.mock.method(console, 'warn', (...args) => reports.push(args));
  const a = agent([{ kind: 'not_a_supported_mechanism' }]), result = await generateDesign(a, context);
  assert.equal(a.calls.length, 2); assert.equal(result.title, P.fallback(context.seed, context.roomName).title);
  assert.ok(P.findSolution(result)); assert.ok(result.controls.length >= 2);
  assert.ok(reports.some(([tag, json]) => tag === '[PuzzleDesign]' && JSON.parse(json).source === 'validated-fallback'));
});
