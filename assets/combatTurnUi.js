(function(root) {
  'use strict';
  let prompt = null, panel = null, submitting = false, error = '';
  function render() {
    if (!document.body) return;
    if (!panel) {
      panel = document.createElement('section'); panel.id = 'combat-turn-popup'; panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Your combat turn');
      panel.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:16000;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:20px;box-sizing:border-box;border:1px solid #a48d62;border-radius:10px;background:linear-gradient(135deg,#29231e,#111);color:#eee;font:17px Georgia,serif;box-shadow:0 10px 45px #000b';
      (document.getElementById('combat-popup') || document.body).appendChild(panel);
    }
    panel.hidden = !prompt; panel.replaceChildren(); if (!prompt) return;
    const heading = document.createElement('h2'); heading.style.margin = '0 0 12px';
    heading.textContent = `${prompt.combatant}: Round ${prompt.round}`; panel.appendChild(heading);
    const order = document.createElement('small');
    order.textContent = 'Initiative: ' + (prompt.initiative || []).map(a => `${a.name} (${a.roll})`).join(', '); panel.appendChild(order);
    const note = document.createElement('p'); note.textContent = prompt.tactical ? `Click a highlighted tile to move (${prompt.movement.remaining}/${prompt.movement.total} tiles left), then click an enemy or choose a spell. Leaving enemy reach risks a free attack.` : 'Your turn. Attack or cast one spell.'; panel.appendChild(note);
    const disabled = submitting || prompt.movement?.busy || root.gamePaused || root.actionDiceState?.paused;
    for (const name of prompt.targets) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button';
      button.style.cssText = 'display:block;width:100%;margin:7px 0;text-align:left'; button.textContent = 'Attack ' + name;
      const reachable = !prompt.tactical || prompt.attackTargets.includes(name);
      button.disabled = !!disabled || !reachable; if (!reachable) button.textContent += ' (out of range/sight)';
      button.addEventListener('click', () => submit('attack', name)); panel.appendChild(button);
    }
    for (const spell of prompt.spells || []) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button';
      button.style.cssText = 'display:block;width:100%;margin:7px 0;text-align:left';
      button.textContent = `${spell.name} on ${spell.target} (${spell.cost} Magic from ${spell.itemName}; ${spell.magic} left)` + (spell.destroysItem ? ' [turns to ash]' : '');
      button.title = spell.description; button.disabled = !!disabled;
      button.addEventListener('click', () => submit('cast', spell.target, spell)); panel.appendChild(button);
    }
    for (const care of prompt.care || []) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button';
      button.textContent = care.label + ' (one turn)'; button.disabled = !!disabled;
      button.addEventListener('click', () => submit('care', care.target, care)); panel.appendChild(button);
    }
    const retreat = document.createElement('button'); retreat.type = 'button'; retreat.className = 'popup-button';
    retreat.id = 'combat-retreat-button'; retreat.style.cssText = 'display:block;width:100%;margin-top:16px';
    retreat.textContent = prompt.allowRetreat ? 'Retreat Party' : 'Hold Position'; retreat.disabled = !!disabled;
    retreat.addEventListener('click', () => submit(prompt.allowRetreat ? 'retreat' : 'hold'));
    panel.appendChild(retreat);
    if (prompt.allowRetreat) { const hold = document.createElement('button'); hold.type = 'button'; hold.className = 'popup-button';
      hold.textContent = 'End Turn'; hold.disabled = !!disabled; hold.addEventListener('click', () => submit('hold')); panel.appendChild(hold); }
    const warning = document.createElement('small'); warning.textContent = 'Each hostile in striking distance gets one free attack at a living party member it can reach.';
    if (prompt.allowRetreat) panel.appendChild(warning);
    if (error) { const message = document.createElement('p'); message.setAttribute('role', 'status'); message.textContent = error; panel.appendChild(message); }
  }
  async function submit(action, target, spell) {
    const current = prompt;
    if (!current || submitting || current.movement?.busy || root.gamePaused || root.actionDiceState?.paused) return;
    submitting = true; error = ''; render();
    try {
      if (action === 'attack' || action === 'cast' && !['heal', 'ward'].includes(spell?.effect)) root.faceDungeonCombatTarget?.(target);
      if (spell?.destroysItem && root.confirm && !root.confirm('This cast consumes the last Magic and destroys ' + spell.itemName + '. Continue?')) return;
      const response = await fetch('/submit-target2', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combatant: current.combatant, actionId: current.actionId, turnId: current.turnId, action, target,
          cancelled: action === 'hold', itemId: spell?.itemId, spellId: spell?.spellId, kind: spell?.kind, item: spell?.item }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || 'Could not submit your turn.');
      if (prompt?.turnId === current.turnId) prompt = null;
    } catch (err) { if (prompt?.turnId === current.turnId) error = err.message; }
    finally { submitting = false; render(); }
  }
  function receive(next) {
    const incoming = next?.turnId && (next.allowRetreat || next.spells?.length || next.care?.length) ? next : null;
    if (incoming?.turnId !== prompt?.turnId) { error = ''; submitting = false; }
    prompt = incoming; render();
  }
  root.CombatTurnUi = { receive, submit, notice(message) { error = message; render(); } };
  document.addEventListener('DOMContentLoaded', render, { once: true });
})(window);
