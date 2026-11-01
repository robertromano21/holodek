'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events'), Feedback = require('../retort/completionFeedback');
test('quest subtitles require committed completion, distinguish steps and final quests, and do not invent payouts', () => {
  const events = [], state = { emitter: new EventEmitter(), getDungeonRunId: () => 'run', getUpdatedGameConsole: () => 'Current Quest: Safe Passage' };
  state.emitter.on('game_action_notice', notice => events.push(notice));
  assert.equal(Feedback.task(state, { desc: 'Reach the gate', status: 'In Progress' }, 0), false);
  const task = { id: 'gate', desc: 'Reach the gate', status: 'Completed' };
  assert.equal(Feedback.task(state, task, 0), true); assert.equal(Feedback.task(state, task, 0), false);
  Feedback.task(state, { ...task, id: 'final' }, 2);
  assert.equal(events.length, 2); assert.equal(events[0].title, 'Quest Step Completed'); assert.equal(events[1].title, 'Quest Completed');
  assert.doesNotMatch(JSON.stringify(events), /paid|payment|silver|reward/i);
});
