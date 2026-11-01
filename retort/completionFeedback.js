'use strict';
const sent = new WeakMap();
function task(state, task, index) {
  if (!task || task.status !== 'Completed') return false;
  const runId = state.getDungeonRunId?.() || '', quest = String(state.getUpdatedGameConsole?.() || '').match(/^Current Quest:[ \t]*(.*)$/m)?.[1] || '';
  const id = JSON.stringify([runId, quest, index, task.id || task.story?.id || task.desc]);
  let seen = sent.get(state); if (!seen) sent.set(state, seen = new Set());
  if (seen.has(id)) return false;
  seen.add(id); if (seen.size > 256) seen.delete(seen.values().next().value);
  const complete = index >= 2;
  state.emitter?.emit('game_action_notice', { kind: 'quest-complete', title: complete ? 'Quest Completed' : 'Quest Step Completed',
    activity: complete ? quest : `Step ${index + 1}`, result: 'success',
    message: `${complete ? 'Quest completed' : 'Quest step completed'}: ${task.desc || task.story?.title || 'The verified objective is fulfilled.'}` });
  return true;
}
module.exports = { task };
