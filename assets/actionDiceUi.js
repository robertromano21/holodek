(function() {
  let state = { revision: -1, active: null, pending: null, results: [] };
  let submitting = null;
  let error = '';
  window.actionDiceState = state;

  window.receiveDiceState = function(next) {
    if (!next || next.type !== 'dice_state' ||
        (next.epoch === state.epoch && next.revision < state.revision)) return;
    state = next;
    window.actionDiceState = state;
    error = '';
    window.renderPartyIconDock?.();
  };

  async function submitRoll() {
    const request = state.pending;
    if (!request || submitting === request.id) return;
    submitting = request.id;
    error = '';
    window.renderPartyIconDock?.();
    try {
      const response = await fetch('/action-dice/roll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: request.id, actionId: request.actionId, geoKey: request.geoKey })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Roll failed.');
      window.receiveDiceState(result.state);
    } catch (err) {
      error = `${err.message} You can retry; the same request cannot roll twice.`;
    } finally {
      submitting = null;
      window.renderPartyIconDock?.();
    }
  }

  window.renderPartyDice = function(dock, entries) {
    entries.forEach((entry, index) => {
      const slot = dock.querySelector(`[data-party-slot="${index}"]`);
      if (!slot) return;
      const name = String(entry.label || '').toLowerCase();
      const pending = state.pending && state.pending.actor.toLowerCase() === name ? state.pending : null;
      const result = state.results.filter(r => r.actor.toLowerCase() === name).at(-1);
      const die = document.createElement('button');
      die.className = 'party-d20' + (pending ? ' awaiting-roll' : '');
      die.type = 'button';
      die.disabled = !pending || submitting === pending.id;
      die.textContent = pending ? (submitting ? '...' : 'Roll') : result ? String(result.natural) : 'd20';
      die.title = pending ? `${pending.label}: ${pending.target || 'your action'}`
        : result ? `${result.label}: d20 ${result.natural} + ${result.modifier} = ${result.total}` : 'No roll yet';
      die.setAttribute('aria-label', `${entry.label}: ${die.title}`);
      die.addEventListener('click', submitRoll);
      slot.appendChild(die);
    });
    const status = document.createElement('div');
    status.className = 'party-roll-status';
    status.setAttribute('role', 'status');
    const p = state.pending;
    status.textContent = error || (p
      ? `${p.actor}: ${p.label}${p.target ? ` - ${p.target}` : ''}. ${p.difficulty === null ? '' : `DC ${p.difficulty}, modifier ${p.modifier}. `}Click Roll.`
      : state.active ? 'Resolving actions...' : '');
    // A recoverable prompt even if a party sheet has not arrived yet.
    if (p && !entries.some(e => String(e.label).toLowerCase() === p.actor.toLowerCase())) {
      const button = document.createElement('button');
      button.textContent = 'Roll d20';
      button.disabled = submitting === p.id;
      button.onclick = submitRoll;
      status.appendChild(button);
    }
    dock.appendChild(status);
  };
})();
