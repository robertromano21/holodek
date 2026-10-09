(function() {
  let state = { revision: -1, active: null, pending: null, results: [] };
  let submitting = null;
  let error = '';
  let targetPrompt = null;
  let targetSubmitting = false;
  let targetError = '';
  const animations = new Map();
  const seenRolls = new Set();
  const ROLL_ANIMATION_MS = 1000;

  function animateRoll(request) {
    const key = request.actor.toLowerCase();
    animations.set(key, { id: request.id, startedAt: Date.now(), sides: request.sides || 20 });
    const tick = () => {
      const animation = animations.get(key);
      if (!animation || animation.id !== request.id) return;
      if (Date.now() - animation.startedAt >= ROLL_ANIMATION_MS) {
        animations.delete(key);
        window.renderPartyIconDock?.();
        return;
      }
      // Cosmetic faces only: these never enter the attack/damage calculation or request payload.
      const die = document.querySelector?.(`[data-dice-roll="${request.id}"]`);
      if (die) die.textContent = String(1 + Math.floor(Math.random() * animation.sides));
      setTimeout(tick, 80);
    };
    setTimeout(tick, 80);
  }
  window.actionDiceState = state;

  window.receiveDiceState = function(next) {
    if (!next || next.type !== 'dice_state' ||
        (next.epoch === state.epoch && next.revision < state.revision)) return;
    state = next;
    window.actionDiceState = state;
    for (const result of state.results || []) {
      if (seenRolls.has(result.id)) continue;
      seenRolls.add(result.id);
      if (submitting !== result.id) animateRoll(result);
    }
    if (!state.active) { targetPrompt = null; targetSubmitting = false; targetError = ''; }
    error = '';
    window.renderPartyIconDock?.();
  };

  window.showCombatTargetPrompt = function(prompt) {
    targetPrompt = prompt;
    targetSubmitting = false;
    targetError = '';
    window.renderPartyIconDock?.();
  };

  function renderTargetPrompt(dock) {
    if (!targetPrompt) return;
    const prompt = targetPrompt;
    const panel = document.createElement('section');
    panel.className = 'combat-target-controls';
    panel.setAttribute('aria-label', 'Combat target selection');
    const heading = document.createElement('div');
    heading.textContent = `${prompt.combatant}'s turn: choose a target`;
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Target for ${prompt.combatant}`);
    prompt.targets.forEach((name, index) => {
      const option = document.createElement('option');
      option.value = name;
      const pos = prompt.positions?.[index];
      option.textContent = `${name}${Number.isFinite(pos?.distance) ? ` - ${pos.distance.toFixed(1)} tiles away` : ''}`;
      select.appendChild(option);
    });
    select.disabled = targetSubmitting;
    async function submit(cancelled) {
      if (targetSubmitting || targetPrompt !== prompt) return;
      const target = select.value;
      targetSubmitting = true;
      window.renderPartyIconDock?.();
      try {
        const response = await fetch('/submit-target2', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ combatant: prompt.combatant, target, cancelled, actionId: prompt.actionId }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Target selection failed.');
        if (targetPrompt === prompt) targetPrompt = null;
      } catch (err) { if (targetPrompt === prompt) targetError = err.message; }
      finally { targetSubmitting = false; window.renderPartyIconDock?.(); }
    }
    const confirm = document.createElement('button'), hold = document.createElement('button');
    confirm.type = hold.type = 'button';
    confirm.className = hold.className = 'popup-button';
    confirm.textContent = 'Attack target'; hold.textContent = 'Hold position';
    confirm.disabled = hold.disabled = targetSubmitting;
    confirm.addEventListener('click', () => submit(false));
    hold.addEventListener('click', () => submit(true));
    panel.appendChild(heading); panel.appendChild(select); panel.appendChild(confirm); panel.appendChild(hold);
    if (targetError) {
      const message = document.createElement('div');
      message.setAttribute('role', 'status'); message.textContent = targetError; panel.appendChild(message);
    }
    dock.appendChild(panel);
  }

  async function submitRoll() {
    const request = state.pending;
    if (!request || submitting === request.id) return;
    submitting = request.id;
    error = '';
    animateRoll(request);
    window.renderPartyIconDock?.();
    try {
      await new Promise(resolve => setTimeout(resolve, ROLL_ANIMATION_MS));
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
    renderTargetPrompt(dock);
    entries.forEach((entry, index) => {
      const slot = dock.querySelector(`[data-party-slot="${index}"]`);
      if (!slot) return;
      const name = String(entry.label || '').toLowerCase();
      const pending = state.pending && state.pending.actor.toLowerCase() === name ? state.pending : null;
      slot.classList?.toggle('current-turn', !!pending || targetPrompt?.combatant.toLowerCase() === name);
      const result = state.results.filter(r => r.actor.toLowerCase() === name).at(-1);
      const animation = animations.get(name);
      const rolling = animation && Date.now() - animation.startedAt < ROLL_ANIMATION_MS;
      const die = document.createElement('button');
      die.className = 'party-d20' + (pending ? ' awaiting-roll' : '') + (rolling ? ' rolling' : '');
      die.type = 'button';
      die.disabled = !!rolling || !pending || submitting === pending.id;
      if (rolling) {
        die.setAttribute('data-dice-roll', animation.id);
        die.style.animationDelay = `-${Date.now() - animation.startedAt}ms`;
      }
      die.textContent = pending ? (submitting === pending.id ? '...' : `Roll\n${pending.label.toLowerCase()}`) : result ? String(result.natural) : 'd20';
      if (rolling) die.textContent = String(1 + Math.floor(Math.random() * animation.sides));
      die.title = pending ? `${pending.label}: roll d${pending.sides || 20} for ${pending.target || 'your action'}`
        : result ? `${result.label}: d${result.sides || 20} ${result.natural} + ${result.modifier} = ${result.total}` : 'No roll yet';
      die.setAttribute('aria-label', `${entry.label}: ${die.title}`);
      die.addEventListener('click', submitRoll);
      const wrap = document.createElement('div');
      wrap.className = 'party-dice-wrap';
      wrap.appendChild(die);
      const history = document.createElement('span');
      history.className = 'party-roll-history';
      history.textContent = state.results.filter(r => r.actor.toLowerCase() === name && (!rolling || r.id !== animation.id)).slice(-2)
        .map(r => `${r.label}: ${r.total}`).join('\n');
      wrap.appendChild(history);
      slot.appendChild(wrap);
    });
    const status = document.createElement('div');
    status.className = 'party-roll-status';
    status.setAttribute('role', 'status');
    const p = state.pending;
    status.textContent = error || (p
      ? `${p.actor}: ${p.label}${p.target ? ` - ${p.target}` : ''}. Roll d${p.sides || 20}${p.modifier ? ` + ${p.modifier}` : ''}. ${p.difficulty === null ? '' : `${p.label === 'Attack' ? 'AC' : 'DC'} ${p.difficulty}. `}Click Roll.`
      : state.active ? 'Resolving actions...' : '');
    // A recoverable prompt even if a party sheet has not arrived yet.
    if (p && !entries.some(e => String(e.label).toLowerCase() === p.actor.toLowerCase())) {
      const button = document.createElement('button');
      button.className = 'popup-button';
      button.textContent = `Roll d${p.sides || 20}`;
      button.disabled = submitting === p.id;
      button.onclick = submitRoll;
      status.appendChild(button);
    }
    dock.appendChild(status);
    const enemyRolls = state.results.filter(r => !entries.some(e => String(e.label).toLowerCase() === r.actor.toLowerCase())).slice(-4);
    if (enemyRolls.length) {
      const feed = document.createElement('div');
      feed.className = 'party-roll-status';
      feed.textContent = enemyRolls.map(r => `${r.actor}: ${r.label} ${animations.get(r.actor.toLowerCase())?.id === r.id && Date.now() - animations.get(r.actor.toLowerCase()).startedAt < ROLL_ANIMATION_MS
        ? 'rolling...' : `d${r.sides || 20}=${r.natural}${r.modifier ? ` + ${r.modifier}` : ''}`}`).join(' | ');
      dock.appendChild(feed);
    }
  };
})();
