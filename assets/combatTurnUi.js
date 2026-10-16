(function(root) {
  'use strict';
  let prompt = null, panel = null, submitting = false, error = '', targeting = false;
  function render() {
    if (!document.body) return;
    if (!panel) {
      panel = document.createElement('section'); panel.id = 'combat-turn-popup'; panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', 'Your combat turn');
      panel.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:16000;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:20px;box-sizing:border-box;border:1px solid #a48d62;border-radius:10px;background:linear-gradient(135deg,#29231e,#111);color:#eee;font:17px Georgia,serif;box-shadow:0 10px 45px #000b';
      (document.getElementById('combat-ledger') || document.getElementById('combat-popup') || document.body).appendChild(panel);
    }
    const inLedger = !!document.getElementById('combat-ledger');
    panel.hidden = !prompt || inLedger && !error; panel.replaceChildren(); if (!prompt) return;
    if (!document.getElementById('combat-ledger')) {
      const heading = document.createElement('h2'); heading.style.margin = '0 0 12px';
      heading.textContent = `${prompt.combatant}: Round ${prompt.round}`; panel.appendChild(heading);
      const order = document.createElement('small');
      order.textContent = 'Initiative: ' + (prompt.initiative || []).map(a => `${a.name} (${a.roll})`).join(', '); panel.appendChild(order);
      const note = document.createElement('p'); note.style.margin = '8px 0 0';
      note.textContent = prompt.tactical ? `Movement: ${prompt.movement.remaining}/${prompt.movement.total} tiles left. Click a square to move or a character for actions. Hold/Retreat: lower left.` : 'Your turn. Click a character for actions, or Hold Position beside your party.';
      note.title = 'Unavailable squares explain the restriction. Leaving enemy reach risks a free attack.'; panel.appendChild(note);
    }
    if (error) { const message = document.createElement('p'); message.setAttribute('role', 'status'); message.textContent = error; panel.appendChild(message); }
  }
  function addCharacterActions(popup, actor) {
    if (root.actionDiceState?.active?.kind !== 'combat') return false;
    const current = prompt;
    if (!current) { const message = document.createElement('p'); message.textContent = 'Wait for your turn to choose a combat action.'; popup.appendChild(message); return true; }
    const disabled = submitting || prompt.movement?.busy || root.gamePaused || root.actionDiceState?.paused;
    const before = popup.children.length;
    const button = (label, action, target, option, unavailable = false) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'popup-button'; b.textContent = label;
      b.disabled = !!disabled || unavailable;
      b.addEventListener('click', () => {
        if (prompt?.turnId !== current.turnId) { notice('That turn has changed. Select the character again.'); return; }
        submit(action, target, option); if (action !== 'cast' || !option?.destroysItem) popup.remove();
      }); popup.appendChild(b);
    };
    if (prompt.targets.includes(actor.name)) {
      const name = actor.name;
      const approach = prompt.approachTargets?.find(t => t.name === name);
      const reachable = !prompt.tactical || prompt.attackTargets.includes(name) || !!approach;
      button((approach ? `Move + Attack ${name} (${approach.cost} tiles)` : 'Attack ' + name) + (reachable ? '' : ' (out of range/sight)'), 'attack', name, null, !reachable);
    }
    for (const spell of (prompt.spells || []).filter(s => s.target === actor.name)) {
      button(`${spell.name} (${spell.cost} Magic from ${spell.itemName}; ${spell.magic} left)` + (spell.destroysItem ? ' [turns to ash]' : ''), 'cast', spell.target, spell);
    }
    for (const care of (prompt.care || []).filter(c => c.target === actor.name)) button(care.label + ' (one turn)', 'care', care.target, care);
    if (popup.children.length === before) {
      const message = document.createElement('p'); message.textContent = 'No actions available for this character this turn. First aid requires an adjacent living ally.'; popup.appendChild(message);
    }
    return true;
  }
  function renderDockControls(dock) {
    if (!prompt || !prompt.allowRetreat && !prompt.spells?.length && !prompt.care?.length) return;
    const current = prompt;
    const controls = document.createElement('div'); controls.className = 'combat-end-controls';
    const disabled = !!(submitting || prompt.movement?.busy || root.gamePaused || root.actionDiceState?.paused);
    const attack = document.createElement('button'); attack.type = 'button'; attack.id = 'combat-attack-button';
    attack.className = 'popup-button combat-attack-button' + (!disabled ? ' awaiting-action' : ''); attack.textContent = 'Attack';
    attack.title = 'Choose an enemy to attack or move into range and attack'; attack.disabled = disabled || !prompt.targets?.length;
    attack.setAttribute('aria-expanded', String(targeting)); attack.setAttribute('aria-controls', 'combat-attack-targets');
    attack.addEventListener('click', () => {
      if (prompt?.turnId !== current.turnId || disabled) return;
      targeting = !targeting; root.renderPartyIconDock?.();
    }); controls.appendChild(attack);
    const hold = document.createElement('button'); hold.type = 'button'; hold.className = 'popup-button combat-hold-position';
    hold.id = 'combat-hold-position'; hold.textContent = 'Hold Position'; hold.title = 'End this turn without moving or attacking';
    hold.disabled = disabled;
    hold.addEventListener('click', () => { if (prompt?.turnId === current.turnId) submit('hold'); }); controls.appendChild(hold);
    if (prompt.allowRetreat) {
      const retreat = document.createElement('button'); retreat.type = 'button'; retreat.className = 'popup-button'; retreat.id = 'combat-retreat-button';
      retreat.textContent = 'Retreat Party'; retreat.disabled = hold.disabled;
      retreat.title = 'Retreat together; nearby enemies may get a free attack';
      retreat.addEventListener('click', () => { if (prompt?.turnId === current.turnId) submit('retreat'); }); controls.appendChild(retreat);
    }
    dock.appendChild(controls);
    if (!targeting) return;
    const chooser = document.createElement('section'); chooser.id = 'combat-attack-targets'; chooser.className = 'combat-target-controls';
    const select = document.createElement('select'); select.id = 'combat-attack-select'; select.setAttribute('aria-label', 'Enemy to attack'); select.disabled = disabled;
    const approach = name => current.approachTargets?.find(t => t.name === name);
    const weaponAvailable = name => !current.tactical || current.attackTargets?.includes(name) || !!approach(name);
    const spellAvailable = name => current.spells?.some(s => s.target === name);
    const available = name => weaponAvailable(name) || spellAvailable(name);
    for (const name of current.targets) {
      const option = document.createElement('option'); option.value = name;
      option.textContent = name + (approach(name) ? ` (move ${approach(name).cost} tiles + attack)` : weaponAvailable(name) ? '' : spellAvailable(name) ? ' (spell available)' : ' (out of range/sight)');
      option.disabled = !available(name); select.appendChild(option);
    }
    const confirm = document.createElement('button'); confirm.id = 'combat-attack-confirm'; confirm.type = 'button'; confirm.className = 'popup-button';
    const update = () => {
      confirm.disabled = disabled || !current.targets.includes(select.value) || !available(select.value);
      confirm.textContent = weaponAvailable(select.value) ? approach(select.value) ? 'Move + Attack' : 'Attack' : 'Choose Spell';
    };
    select.addEventListener('change', update); update();
    confirm.addEventListener('click', () => {
      if (prompt?.turnId !== current.turnId) { notice('That turn has changed. Choose a target again.'); return; }
      if (!confirm.disabled) {
        const name = select.value;
        if (weaponAvailable(name)) submit('attack', name);
        else { targeting = false; root.renderPartyIconDock?.(); root.CombatCharacterUi?.open({ name }); }
      }
    });
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'popup-button'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { targeting = false; root.renderPartyIconDock?.(); });
    chooser.appendChild(select); chooser.appendChild(confirm); chooser.appendChild(cancel); dock.appendChild(chooser);
  }
  function notice(message) { error = message; render(); }
  async function submit(action, target, spell) {
    const current = prompt;
    if (!current || submitting || current.movement?.busy || root.gamePaused || root.actionDiceState?.paused) return;
    submitting = true; error = ''; targeting = false; render(); root.renderPartyIconDock?.();
    try {
      if (action === 'attack' || action === 'cast' && !['heal', 'ward'].includes(spell?.effect)) root.faceDungeonCombatTarget?.(target);
      if (spell?.destroysItem && root.confirm && !root.confirm('This cast consumes the last Magic and destroys ' + spell.itemName + '. Continue?')) return;
      const response = await fetch('/submit-target2', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combatant: current.combatant, actionId: current.actionId, turnId: current.turnId, action, target,
          cancelled: action === 'hold', itemId: spell?.itemId, spellId: spell?.spellId, kind: spell?.kind, item: spell?.item }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || 'Could not submit your turn.');
      if (prompt?.turnId === current.turnId) prompt = null;
    } catch (err) { if (prompt?.turnId === current.turnId) error = err.message; }
    finally { submitting = false; render(); root.renderPartyIconDock?.(); }
  }
  function receive(next) {
    const incoming = next?.turnId ? next : null;
    if (incoming?.turnId !== prompt?.turnId) { error = ''; submitting = false; targeting = false; }
    prompt = incoming; render(); root.renderPartyIconDock?.();
  }
  root.CombatTurnUi = { receive, submit, notice, addCharacterActions, renderDockControls };
  document.addEventListener('DOMContentLoaded', render, { once: true });
})(window);
