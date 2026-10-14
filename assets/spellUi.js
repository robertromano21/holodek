(function(root) {
  'use strict';
  let pending = false, panel = null;
  const key = root.SpellRules.key;
  const blocked = () => pending || root.GameCommandGate?.busy() || root.gamePaused || root.actionDiceState?.active || root._combatCommandPending || root._characterStartupPending;
  function observer() {
    const c = root.getDungeonLifeContext?.();
    if (!c?.dungeon || !c.player) throw Error('The room is not ready.');
    return { runId: root.dungeonRunId, geoKey: c.dungeon.geoKey, player: c.player,
      actors: c.actors.map(a => ({ name: a.name, mazeX: a.mazeX, mazeY: a.mazeY, mazePoint: a.mazePoint, discoveryRevision: a.discoveryRevision })) };
  }
  const sameRoom = c => c.runId === root.dungeonRunId && c.geoKey === root.currentDungeon?.geoKey;
  async function post(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'Spell action unavailable.'); return result;
  }
  const nonce = () => root.crypto?.randomUUID?.() || 'spell:' + Date.now() + ':' + Math.random().toString(36).slice(2);
  function notice(message) {
    root.DungeonActionNotices?.receive?.({ id: nonce(), runId: root.dungeonRunId, geoKey: root.currentDungeon?.geoKey, kind: 'spell', title: 'Spells', message });
  }
  function close() { panel?.remove(); panel = null; }
  function popup(title) {
    close(); const box = document.createElement('section'); panel = box;
    box.className = 'popup-container spell-actions'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
    box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:17000;width:min(650px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:22px;box-sizing:border-box;background:linear-gradient(135deg,#28241c,#10100e);border:1px solid #b4a16c;color:#eee;font:17px Georgia,serif';
    const h = document.createElement('h2'); h.textContent = title; box.appendChild(h); document.body.appendChild(box); return box;
  }
  function line(box, text, tag = 'p') { const p = document.createElement(tag); p.textContent = text; box.appendChild(p); return p; }
  const explanation = spell => `${spell.description} Range: ${spell.range} tile${spell.range === 1 ? '' : 's'}.`;
  function button(box, label, action, disabled = false) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'popup-button'; b.textContent = label; b.disabled = disabled;
    b.addEventListener('click', action); box.appendChild(b); return b;
  }
  async function perform(path, input, origin, reopen) {
    if (blocked()) return;
    if (!sameRoom(origin)) { close(); notice('That spell menu belonged to another room or game.'); return; }
    pending = true; const box = panel; box?.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      if (path === '/spells/cast' && !['heal', 'ward'].includes(input.effect)) root.faceDungeonCombatTarget?.(input.target);
      const event = await post(path, { ...observer(), caster: input.caster, revision: input.revision, nonce: nonce(),
        ...(path === '/spells/cast' ? { itemId: input.itemId, spellId: input.spellId, target: input.target } : { kind: input.kind, item: input.item, spellIds: input.spellIds }) });
      if (sameRoom(origin)) await root.applyRealtimeCombatResult?.(event);
      close(); pending = false; if (reopen && sameRoom(origin)) await open(input.caster);
    } catch (error) { if (box?.isConnected) line(box, error.message); else notice(error.message); }
    finally { pending = false; box?.querySelectorAll('button').forEach(b => b.disabled = false); root.GameCommandGate?.end(); }
  }
  async function load(caster) {
    await root.prepareEconomyState?.(); const origin = observer();
    const data = await post('/spells/view', { ...origin, caster });
    if (!sameRoom(origin)) throw Error('The room or game changed.');
    if (data.spellResult) await root.applyRealtimeCombatResult?.(data.spellResult);
    return { data, origin };
  }
  async function open(casterName, scrollName) {
    if (blocked()) return false; pending = true;
    try {
      const { data, origin } = await load(casterName), box = popup(scrollName ? 'Scribe ' + scrollName : 'Spells and Magic');
      line(box, 'Casting uses one initiative action. Ordinary equipment turns to ash at zero Magic. Campaign artifacts recharge after five turns.');
      for (const caster of data.casters) {
        line(box, caster.name, 'h3');
        for (const item of caster.items) {
          line(box, `${item.name}: ${item.magic}/${item.capacity} Magic` + (item.rechargeIn ? `; recharges in ${item.rechargeIn} turns` : ''), 'h4');
          if (item.classSource) {
            line(box, `${item.tradition} tradition; casting level ${item.castingLevel}.`);
            line(box, root.SpellRules.traditions[item.tradition]);
            if (item.diminished) line(box, `Diminished Mortacia: divine level ${item.divineLevel}, recovered casting level ${item.castingLevel}. Her missing Sepulchra prevents full divine magic.`);
            line(box, `${item.slots} prepared spell slots. Recharge ${item.rechargeAmount} Magic every ${item.rechargeEvery} turns.` + (item.bookRequired && !item.bookPresent ? ' Obtain your spellbook first.' : ''));
            if (item.bookRequired && !item.known.length) line(box, 'No learned spells. Obtain a spell scroll and Scribe it into your book. Reading it does not teach the spell.');
            const picks = [];
            for (const spell of item.learnable) {
              const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.value = spell.id;
              check.checked = item.prepared.includes(spell.id); check.disabled = !spell.available || item.bookRequired && !item.bookPresent;
              label.style.cssText = 'display:block;margin:6px 0'; label.appendChild(check); label.appendChild(document.createTextNode(` ${spell.name} (${spell.cost} Magic; level ${spell.minLevel})${!spell.available ? ' [' + spell.unavailableReason + ']' : ''}`)); box.appendChild(label); picks.push(check);
              line(box, explanation(spell)).style.cssText = 'margin:4px 0 14px 24px;color:#d0c6b0;font-size:15px';
            }
            if (picks.length) button(box, 'Prepare Spells', () => perform('/spells/prepare', { kind: 'prepare', caster: caster.name, revision: data.revision,
              spellIds: picks.filter(p => p.checked && !p.disabled).map(p => p.value) }, origin, true), item.bookRequired && !item.bookPresent);
            if (item.bookRequired) for (const scroll of data.scrolls.filter(s => (!scrollName || key(s.name) === key(scrollName)) && !item.known.includes(s.spell_scroll))) {
              if (!root.SpellRules.canLearn(item.className, scroll.spell_scroll)) {
                if (scrollName) line(box, `${scroll.name} is a ${root.SpellRules.templates[scroll.spell_scroll].tradition} formula, not ${item.tradition}. It can still be equipped and cast once.`);
                continue;
              }
              const minLevel = root.SpellRules.templates[scroll.spell_scroll].minLevel;
              const formula = root.SpellRules.levelSpell(root.SpellRules.recipe(scroll)[0], item.castingLevel);
              line(box, `${scroll.name}: ${scroll.magic} Magic per cast. ${explanation(formula)}`);
              if (minLevel > item.castingLevel) line(box, `You can scribe ${scroll.name} now, but preparation unlocks at casting level ${minLevel}.`);
              button(box, 'Scribe ' + scroll.name + ' for ' + caster.name + ` (${item.scribeTurns}-turn rest; ${scroll.magic} Magic to cast)`, () => {
                if (root.confirm && !root.confirm(`Rest for ${item.scribeTurns} turns and consume this scroll to learn the spell? It cannot also be cast once.`)) return;
                perform('/spells/prepare', { kind: 'scribe', caster: caster.name, item: scroll.name, revision: data.revision }, origin, true);
              }, !item.bookPresent || !item.restSafe);
            }
          }
          for (const spell of item.spells) {
            line(box, `${spell.name} (${spell.cost} Magic): ${explanation(spell)}${spell.lore ? ' ' + spell.lore : ''}`);
            for (const choice of caster.choices.filter(c => c.itemId === item.id && c.spellId === spell.id)) button(box,
              'Cast on ' + choice.target + (choice.destroysItem ? ' [consumes item]' : ''), () => {
                if (choice.destroysItem && root.confirm && !root.confirm('This cast destroys ' + item.name + '. Quest items are not protected. Continue?')) return;
                perform('/spells/cast', choice, origin, false);
              });
          }
        }
        if (!caster.items.length) line(box, 'No charged equipment or class spells. Equip a magical item or spell scroll first.');
      }
      button(box, 'Close', close); return true;
    } catch (error) { notice(error.message); return false; }
    finally { pending = false; root.GameCommandGate?.end(); }
  }
  function addItemAction(box, name) {
    const props = root.InventoryUi?.parseProperties(root.latestUpdatedData?.inventoryProperties || '') || [];
    const item = props.find(p => key(p.name) === key(name));
    if (!box || !root.SpellRules.templates[item?.spell_scroll] || box.querySelector('[data-scribe-action]')) return;
    const b = button(box, 'Scribe (' + root.SpellRules.templates[item.spell_scroll].tradition + ')', () => { root.InventoryUi?.toggle(false); open(null, name); }); b.dataset.scribeAction = name;
    const spell = root.SpellRules.classSpell(item.spell_scroll, root.SpellRules.templates[item.spell_scroll].minLevel);
    line(box, `${spell.name} at its unlock level: ${item.magic} Magic. ${explanation(spell)}`);
    line(box, 'Equip and open Spells to cast this scroll once. Scribe instead consumes it to learn the spell.');
    return b;
  }
  async function handleCommand(text) {
    if (!/^\s*(cast|scribe|prepare\s+spells)\b/i.test(text)) return false;
    const match = root.SpellRules.command(text);
    if (!match) { await open(); return true; }
    if (blocked()) { notice('Use the combat turn popup while initiative is active.'); return true; }
    pending = true;
    try {
      const { data, origin } = await load(match.caster);
      const choice = data.casters.flatMap(c => c.choices).find(c => key(c.name) === key(match.spellName) && key(c.itemName) === key(match.itemName) && key(c.target) === key(match.target));
      if (!choice) throw Error('No such equipped, prepared spell and valid target. Use the Spells menu.');
      pending = false;
      if (choice.destroysItem && root.confirm && !root.confirm('This cast destroys ' + choice.itemName + '. Continue?')) return true;
      await perform('/spells/cast', choice, origin, false);
    } catch (error) { notice(error.message); }
    finally { pending = false; root.GameCommandGate?.end(); }
    return true;
  }
  root.SpellUi = { open, addItemAction, handleCommand, equipmentChanged: close, hydrate: text => root.applySpellEquipment?.(text) };
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !pending) close(); });
})(window);
