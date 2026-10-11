(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ActionFeedback = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  let sequence = 0;
  const text = value => typeof value === 'string' ? value.trim() : '';
  function puzzle(plan, definition, fixture, actor) {
    const completed = plan.allowed && plan.nextState?.status === 'complete';
    const xp = Object.values(plan.outcomes?.xp_awarded || {}).reduce((sum, value) => sum + value, 0);
    return { kind: completed ? 'puzzle-complete' : 'puzzle-control',
      title: completed ? definition.title : fixture?.label || definition.title,
      actor: actor?.name, controlId: fixture?.id,
      message: completed ? `The reading cabinet opens.${xp ? ` ${xp} XP awarded.` : ''} Check the Game Log for the full details.` : plan.message,
      result: completed ? 'success' : !plan.allowed ? 'blocked' : plan.inspect ? 'observed' : 'partial' };
  }
  function defeat(target, attacker) {
    return { kind: 'defeat', title: target.name, actor: attacker.name, subject: target.name,
      message: `Killed by ${attacker.name}.`, result: 'defeated' };
  }
  function adjudication(initial, committed = {}) {
    return (initial?.Outcomes || []).filter(row => text(row.character) && text(row.outcome)).map((row, index) => {
      const metadata = initial.metadata?.find(m => m.actor === row.character);
      const roll = initial['Dice Rolls']?.find(d => d.character === row.character)?.roll;
      const result = ['success', 'partial', 'failure'].includes(metadata?.result) ? metadata.result : 'resolved';
      const receipt = [committed.xp_awarded?.[row.character] > 0 ? `${committed.xp_awarded[row.character]} XP awarded.` : '',
        committed.trap_damage?.[row.character] > 0 ? `${committed.trap_damage[row.character]} trap damage.` : '',
        !index && committed.new_objects?.length ? `Revealed: ${committed.new_objects.join(', ')}.` : '',
        !index && committed.new_exit ? `A ${committed.new_exit} exit is revealed.` : ''].filter(Boolean).join(' ');
      return { kind: 'adjudication', title: row.character, actor: row.character, result,
        activity: text(metadata?.activity) || text(initial.Action),
        message: `${row.outcome.length > 320 ? row.outcome.slice(0, 317) + '...' : row.outcome}${receipt ? ' ' + receipt : ''}`,
        ...(Number.isFinite(roll) ? { roll } : {}) };
    });
  }
  function publish(broadcast, sharedState, notice) {
    if (typeof broadcast !== 'function' || !notice) return null;
    const coords = sharedState.getLastCoords(), runId = sharedState.getDungeonRunId();
    const event = { ...notice, type: 'action_notice', runId,
      geoKey: `${coords.x},${coords.y},${coords.z}`, id: `${runId}:action:${Date.now()}:${++sequence}` };
    broadcast(event);
    return event;
  }
  return { puzzle, defeat, adjudication, publish };
});
