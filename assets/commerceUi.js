(function(root) {
  'use strict';
  let pending = false, currentClose = null;
  const blocked = () => pending || root.GameCommandGate?.busy() || root.gamePaused || root.actionDiceState?.active || root._combatCommandPending || root._characterStartupPending;
  const key = s => String(s || '').trim().toLowerCase();
  function observer() {
    const ctx = root.getDungeonLifeContext?.();
    if (!ctx?.dungeon || !ctx.player) throw Error('The room is not ready.');
    return { runId: root.dungeonRunId, geoKey: ctx.dungeon.geoKey, player: { ...ctx.player }, objectView: root.ObjectDiscovery?.snapshot(ctx.dungeon),
      actors: ctx.actors.map(a => ({ name: a.name, mazeX: a.mazeX, mazeY: a.mazeY, mazePoint: a.mazePoint, discoveryRevision: a.discoveryRevision })) };
  }
  async function post(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'That action is unavailable.'); return result;
  }
  function notice(message) {
    root.DungeonActionNotices?.receive?.({ id: 'commerce:' + Date.now(), runId: root.dungeonRunId, geoKey: root.currentDungeon?.geoKey,
      kind: 'economy', title: 'Silver and Supplies', message });
  }
  function sameRoom(ctx) { return ctx.runId === root.dungeonRunId && ctx.geoKey === root.currentDungeon?.geoKey; }
  async function transact(request) {
    const ctx = observer();
    if (request.kind === 'take' && !root.ObjectDiscovery?.isVisible(root.currentDungeon, request.item)) throw Error('That object is no longer in view.');
    const selected = request.kind === 'take' ? root.currentDungeon.sceneObjects?.find(item => key(item.name) === key(request.item)) : null;
    const placement = selected ? { x:selected.x, y:selected.y } : null;
    // Capture the valid browser observation before persistence/network waits.
    await root.prepareEconomyState?.();
    if (!sameRoom(ctx)) throw Error('The room or game changed.');
    const balance = await post('/economy/view', ctx);
    if (balance.economyResult && sameRoom(ctx)) await root.applyRealtimeCombatResult?.(balance.economyResult);
    if (!sameRoom(ctx)) throw Error('The room or game changed.');
    if (Array.isArray(balance.sceneObjects)) {
      root.currentDungeon.sceneObjects = balance.sceneObjects;
      root.renderDungeonView?.();
    }
    if (placement) {
      const current = root.currentDungeon.sceneObjects?.find(item => key(item.name) === key(request.item));
      if (!current || current.x !== placement.x || current.y !== placement.y) throw Error('That object moved. Approach it again before taking it.');
    }
    const event = await post('/economy/action', { ...(request.kind === 'take' ? ctx : observer()), ...request, revision: balance.revision,
      nonce: root.crypto?.randomUUID?.() || 'transaction:' + Date.now() + ':' + Math.random().toString(36).slice(2) });
    if (sameRoom(ctx)) await root.applyRealtimeCombatResult?.(event);
    return event;
  }
  function popup(title, text) {
    const origin = observer();
    currentClose?.();
    document.querySelectorAll('.popup-container').forEach(p => p.remove());
    const box = document.createElement('div'); box.className = 'popup-container commerce-actions';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
    box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:17000;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto';
    const heading = document.createElement('h3'), info = document.createElement('p'), rows = document.createElement('div');
    heading.textContent = title; info.textContent = text; info.style.whiteSpace = 'pre-wrap'; box.append(heading, info, rows);
    function close() { box.remove(); document.removeEventListener('keydown', escape); if (currentClose === close) currentClose = null; }
    const escape = event => { if (event.key === 'Escape' && !pending) close(); };
    const add = (label, request, reopen) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button'; button.textContent = label;
      rows.appendChild(button);
      button.addEventListener('click', async () => {
        if (!request) { if (!pending) close(); return; }
        if (!sameRoom(origin)) { close(); notice('That menu belonged to another room or game.'); return; }
        if (blocked()) return;
        pending = true; box.querySelectorAll('button').forEach(b => b.disabled = true);
        try { await transact(request); close(); pending = false; if (reopen) await open(request.actor); }
        catch (error) { info.textContent = error.message; }
        finally { pending = false; box.querySelectorAll('button').forEach(b => b.disabled = false); }
      });
      return button;
    };
    currentClose = close; document.addEventListener('keydown', escape); document.body.appendChild(box);
    return { add, info, close };
  }
  async function open(actor) {
    if (blocked()) return false;
    pending = true;
    try {
      await root.prepareEconomyState?.();
      const ctx = observer(), data = await post('/economy/view', { ...ctx, actor });
      if (!sameRoom(ctx)) return false;
      if (data.economyResult) await root.applyRealtimeCombatResult?.(data.economyResult);
      const box = popup(data.divine ? 'Divine Audience: ' + data.divine.name : data.service?.name || 'Local Contracts',
        `Silver Pieces: ${data.silver}` + (data.divine ? `\n${data.divine.domain}\n${data.divine.interest}\nVisit ${data.divine.visits}. This deity travels independently and cannot join the party.` : ''));
      for (const item of data.divine?.possessions || []) box.add('Receive ' + item.name, { kind: 'receive', actor, item: item.name }, true);
      if (data.service) {
        for (const item of data.service.stock) {
          const buy = box.add(`Buy ${item.name} (${item.price} silver; ${item.quantity} in stock)`, { kind: 'buy', item: item.name, actor }, true);
          buy.title = item.description || '';
          if (item.description) { const detail = document.createElement('p'); detail.textContent = item.description; buy.after(detail); }
        }
        if (data.service.kind === 'shop') for (const item of data.saleItems) box.add(`Sell ${item.name} (${item.salePrice} silver)`, { kind: 'sell', item: item.name, actor }, true);
        else for (const target of data.party) {
          if (target.hp <= 0 && !['Unconscious', 'Dying'].includes(target.state)) box.add(`Resurrect ${target.name} (${target.resurrectPrice} silver; returns at 1 HP)`, { kind: 'resurrect', target: target.name, actor }, true);
          else if (target.hp < target.maxHp) box.add(`Heal ${target.name} (${target.hp}/${target.maxHp}; ${target.healPrice} silver)`, { kind: 'heal', target: target.name, actor }, true);
        }
      }
      for (const mission of data.missions) {
        const line = document.createElement('p'); line.textContent = `${mission.status}: ${mission.description}${mission.pendingReward ? '\nRequirements verified; free an inventory slot to receive your payment.' : ''}`; box.info.after(line);
        if (mission.status === 'offered') box.add('Accept Local Contract', { kind: 'accept-mission', actor, missionId: mission.id }, true);
        if (mission.status === 'accepted' && mission.item) {
          const give = document.createElement('button'); give.type = 'button'; give.className = 'popup-button'; give.textContent = 'Give Requested Item';
          give.textContent = 'Give Requested Item to ' + mission.recipient;
          give.addEventListener('click', () => { if (!blocked()) { box.close(); root.ItemGiveUi?.open(mission.recipient); } }); box.info.after(give);
        }
      }
      box.add('Close'); return true;
    } catch (error) { notice(error.message); return false; }
    finally { pending = false; }
  }
  function metadata(name) {
    return root.InventoryUi?.parseProperties(root.latestUpdatedData?.inventoryProperties || '').find(i => key(i.name) === key(name));
  }
  function drinkable(name) { return !!root.EconomyRules?.isHealingPotion(metadata(name)); }
  function drink(name, targetName) {
    if (blocked() || !drinkable(name)) return false;
    const info = root.getPartyInfoEntries?.() || [];
    const box = popup('Drink ' + name, `Magic: ${metadata(name).magic}. Restore that many HP, up to maximum HP. One potion is consumed.`);
    for (const member of info.filter(a => !targetName || key(a.label) === key(targetName))) box.add('Drink: ' + member.label, { kind: 'drink', item: name, target: member.label });
    box.add('Cancel'); return true;
  }
  function addDrinkAction(box, name) {
    if (!box || !drinkable(name) || box.querySelector('[data-drink-action]')) return null;
    const equip = box.querySelector('#equip-button'); if (equip) { equip.hidden = true; equip.disabled = true; }
    const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button'; button.dataset.drinkAction = name; button.textContent = 'Drink';
    button.addEventListener('click', () => { root.InventoryUi?.toggle(false); drink(name); }); box.appendChild(button); return button;
  }
  function addAction(box, name) {
    const business = root.getEconomyResidentInfo?.(name); if (!box || !business) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button';
    button.textContent = business.kind === 'divine' ? 'Divine Audience' : business.kind === 'temple' ? 'Temple Services' : business.kind === 'shop' ? 'Trade' : 'Local Contract';
    button.addEventListener('click', () => open(name)); box.appendChild(button);
  }
  async function handleCommand(command) {
    command = String(command).trim();
    const take = /^(?:take|pick\s+up|collect)\b/i.test(command), consume = /^(?:drink|quaff)\s+(.+?)(?:\s+(?:by|for)\s+(.+))?$/i.exec(command);
    const drop = /^drop\s+(.+)$/i.exec(command), equip = /^equip\s+(.+?)(?:\s+to\s+(.+))?$/i.exec(command);
    const unequip = /^unequip\s+(.+?)(?:\s+from\s+(.+))?$/i.exec(command);
    if (equip && drinkable(equip[1])) { notice('Use Drink for healing potions; they cannot be equipped.'); return true; }
    if (consume && !drinkable(consume[1])) {
      if (/\b(potion|elixir|vial|draught)\b/i.test(consume[1])) { notice('That potion is not in inventory or has no supported healing Magic.'); return true; }
      return false;
    }
    if (!take && !consume && !equip && !unequip && !drop) return false;
    if (blocked()) { notice('Finish the current action first.'); return true; }
    if (consume && !consume[2]) { drink(consume[1]); return true; }
    pending = true;
    try {
      if (equip || unequip) {
        const gear = equip || unequip;
        await transact({ kind: equip ? 'equip' : 'unequip', item: gear[1], ...(gear[2] ? { target: gear[2] } : {}) });
      } else if (consume) await transact({ kind: 'drink', item: consume[1], target: consume[2] });
      else if (drop) await transact(/^all$/i.test(drop[1]) ? { kind: 'drop-all' } : { kind: 'drop', item: drop[1] });
      else {
        const ctx = root.getDungeonLifeContext(), selection = root.ObjectDiscovery?.takeRequest(ctx.dungeon, command);
        if (!selection || selection.error) throw Error(selection?.error || 'The current object view is not ready.');
        const { names, all } = selection;
        for (const name of names) {
          if (!root.ObjectDiscovery.isVisible(ctx.dungeon, name)) { if (!all) throw Error('That object is not currently in view.'); continue; }
          try { await transact({ kind: 'take', item: name }); } catch (error) { if (!all && names.length === 1) throw error; notice(error.message); }
        }
      }
    } catch (error) { notice(error.message); }
    finally { pending = false; }
    return true;
  }
  root.CommerceUi = { open, addAction, addDrinkAction, drinkable, drink, handleCommand };
})(window);
