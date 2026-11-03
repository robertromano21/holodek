(function(root) {
  'use strict';
  let pending = false, currentClose = null, interaction = null;
  const actionBlocked = () => !!(root.gamePaused || root.actionDiceState?.active || root._combatCommandPending || root._characterStartupPending ||
    root._combatRoundActiveUntil > Date.now() || root._gameOver || root._playerUnconscious || root._deathSceneActive);
  const blocked = () => !!(pending || root.GameCommandGate?.busy() || actionBlocked());
  const track = work => root.GameCommandGate?.trackNative ? root.GameCommandGate.trackNative(work) : work();
  const blockedMessage = () => root.gamePaused ? 'Resume the game before trading.' : 'Finish the current action or arrival story before trading.';
  const key = s => String(s || '').trim().toLowerCase();
  const serviceVenues = new Set(['shop','temple','clinic','inn','bar','foodhall','workshop','warehouse','guild','library','civic','court','transit','theatre','bathhouse','arena']);
  const starterRoom = () => root.EconomyRules?.isStarterRoom(root.currentDungeon?.geoKey,root.currentDungeon);
  function observer() {
    const ctx = root.getDungeonLifeContext?.();
    if (!ctx?.dungeon || !ctx.player) throw Error('The room is not ready.');
    return { runId: root.dungeonRunId, geoKey: ctx.dungeon.geoKey, floorToken:root.CityFloorScope?.token(),
      ...(interaction?.counterId&&sameRoom(interaction)?{counterId:interaction.counterId}:{}),player: { ...ctx.player }, objectView: root.ObjectDiscovery?.snapshot(ctx.dungeon),
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
  function sameRoom(ctx) { return ctx.runId === root.dungeonRunId && ctx.geoKey === root.currentDungeon?.geoKey && ctx.floorToken===root.CityFloorScope?.token(); }
  function isInteracting(name) {
    if (!interaction) return false;
    if (!sameRoom(interaction) || root.actionDiceState?.active || root._gameOver || root._playerUnconscious || root._deathSceneActive ||
      interaction.element?.isConnected === false) { interaction = null; return false; }
    return interaction.actor === name;
  }
  function beginInteraction(actor) {
    currentClose?.();
    interaction = { ...observer(), actor, element: null };
    return interaction;
  }
  async function transact(request) {
    return track(async () => {
    const ctx = observer();
    if (request.kind === 'take' && !root.ObjectDiscovery?.isVisible(root.currentDungeon, request.item)) throw Error('That object is no longer in view.');
    const selected = request.kind === 'take' ? root.currentDungeon.sceneObjects?.find(item => key(item.name) === key(request.item)) : null;
    const placement = selected ? { x:selected.x, y:selected.y } : null;
    // Capture the valid browser observation before persistence/network waits.
    await root.prepareEconomyState?.();
    if (!sameRoom(ctx)) throw Error('The room or game changed.');
    if (request.kind === 'request-commission') {
      const event = await post('/city/commissions/request', { ...observer(), actor: request.actor });
      if (sameRoom(ctx)) await root.applyRealtimeCombatResult?.(event);
      return event;
    }
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
      nonce: request.nonce || root.crypto?.randomUUID?.() || 'transaction:' + Date.now() + ':' + Math.random().toString(36).slice(2) });
    if (sameRoom(ctx)) await root.applyRealtimeCombatResult?.(event);
    return event;
    });
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
    function close() {
      box.remove(); document.removeEventListener('keydown', escape);
      if (interaction?.element === box) interaction = null;
      if (currentClose === close) currentClose = null;
    }
    const escape = event => { if (event.key === 'Escape' && !pending && interaction?.phase!=='loading') close(); };
    const add = (label, request, reopen) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button'; button.textContent = label;
      rows.appendChild(button);
      button.addEventListener('click', async () => {
        if (!request) { if (!pending) close(); return; }
        if (!sameRoom(origin)) { close(); notice('That menu belonged to another room or game.'); return; }
        if (blocked()) { info.textContent = blockedMessage(); return; }
        pending = true; box.querySelectorAll('button').forEach(b => b.disabled = true);
        try { await transact(request); close(); pending = false; if (reopen) await open(request.actor,{counterId:origin.counterId}); }
        catch (error) { info.textContent = error.message; }
        finally { pending = false; box.querySelectorAll('button').forEach(b => b.disabled = false); }
      });
      return button;
    };
    currentClose = close; document.addEventListener('keydown', escape); document.body.appendChild(box);
    return { add, info, close, rows, element: box };
  }
  function invitation(actor, accept, jobs = false, inquiries = false) {
    if (blocked()) { notice(blockedMessage()); return true; }
    const held = beginInteraction(actor);
    // This is interface text. Authored dialogue and the encounter begin only after acceptance.
    const box = popup(actor, jobs ? 'Would you like to view this resident\'s job offers?' : inquiries ?
      'Would you like to ask about local work? This desk has no shop, treatment or lodging service; jobs may not be available.' : 'Would you like to access services?');
    held.element = box.element; held.phase = 'offer';
    const access = document.createElement('button'); access.type = 'button'; access.className = 'popup-button'; access.textContent = jobs ? 'View Job Offers' : inquiries ? 'Work Inquiries' : 'Access Services';
    access.addEventListener('click', async () => {
      if (!sameRoom(held)) { box.close(); notice('That invitation belonged to another room or game.'); return; }
      if(held.phase==='loading')return;
      if (actionBlocked() || blocked() && !root.GameCommandGate?.waitForIdle) { box.info.textContent = blockedMessage(); return; }
      held.phase='loading';box.info.textContent=inquiries?'Opening the work desk...':'Preparing services and the resident introduction...';
      box.element.setAttribute('aria-busy','true');box.element.querySelectorAll('button').forEach(b=>b.disabled=true);
      try {
        if (root.GameCommandGate?.waitForIdle) await root.GameCommandGate.waitForIdle({includeCommands:true});
        if(currentClose!==box.close)return;
        if(!sameRoom(held))throw Error('That invitation belonged to another room or game.');
        if(blocked())throw Error(blockedMessage());
        const opened=await accept();
        if(currentClose===box.close){if(opened===false)box.info.textContent='The menu could not open. Check the action notice and try again.';else box.close();}
      } catch(error){if(currentClose===box.close)box.info.textContent=error.message;else notice(error.message);}
      finally{if(currentClose===box.close){held.phase='offer';box.element.setAttribute('aria-busy','false');box.element.querySelectorAll('button').forEach(b=>b.disabled=false);}}
    });
    box.rows.appendChild(access);
    root.CombatCharacterUi?.addRecruitAction?.(box.rows,actor,{close:box.close,blocked});
    const later=document.createElement('button');later.type='button';later.className='popup-button';later.textContent='Not Now';
    later.addEventListener('click',()=>{
      if(pending)return;
      box.close();
      if(sameRoom(held))root.CombatCharacterUi?.open?.({name:actor},{services:false});
    });box.rows.appendChild(later);
    return true;
  }
  function invite(actor) {
    if(starterRoom())return false;
    const business = root.getEconomyResidentInfo?.(actor);
    if (!business || !business.jobs && !business.venue && !['shop', 'temple', 'venue', 'divine'].includes(business.kind)) return false;
    return invitation(actor, () => open(actor), business.jobs && (business.kind === 'mission'||business.inquiries),business.inquiries);
  }
  function inviteAmbient(actor, accept) {
    if(starterRoom())return false;
    const row=root.currentDungeon?.cityCrowd?.actors?.[actor.crowdId];
    if(!row||row.status!=='ambient'||row.name!==actor.name||row.occupation?.mode!=='work'||
      !serviceVenues.has(row.occupation.venueType)||typeof accept!=='function')return false;
    return invitation(actor.name,accept,false,root.CityEstablishments? !root.CityEstablishments.profile(row.occupation.venueType)?.service:false);
  }
  async function openCounter(counterId) {
    if(starterRoom())return false;
    if(blocked()){notice(blockedMessage());return false;}
    const origin=observer();pending=true;
    return track(async()=>{
    try{
      await root.prepareEconomyState?.();if(!sameRoom(origin))return false;
      const result=await post('/city/services/counter',{...observer(),counterId});
      if(!sameRoom(origin))return false;
      pending=false;
      if(result.citizen)return await root.CityCrowdUi?.open(result.citizen,{services:true,counterId});
      return await open(result.actor,{counterId});
    }catch(error){if(sameRoom(origin))notice(error.message);return false;}
    finally{pending=false;}
    });
  }
  async function open(actor,{counterId}={}) {
    if(starterRoom())return false;
    if (blocked()) { notice(blockedMessage()); return false; }
    pending = true; let held,loading;
    return track(async()=>{
    try {
      held = beginInteraction(actor);
      if(counterId)held.counterId=counterId;
      loading=popup(actor,'Opening the saved services menu...');held.element=loading.element;held.phase='loading';
      loading.element.setAttribute('aria-busy','true');
      await root.prepareEconomyState?.();
      if (!sameRoom(held)) return false;
      if(root.getEconomyResidentInfo?.(actor)?.introduced===false){
        const encounter=await post('/city/services/encounter',{...observer(),actor});
        if(!sameRoom(held))return false;
        await root.applyRealtimeCombatResult?.(encounter);
        if(encounter.story)root.DungeonLife?.receiveEncounter?.(encounter.story);
        if(!sameRoom(held))return false;
      }
      const ctx = observer(), data = await post('/economy/view', { ...ctx, actor });
      if (!sameRoom(ctx)) return false;
      if (data.economyResult) await root.applyRealtimeCombatResult?.(data.economyResult);
      if (!sameRoom(ctx) || root.GameCommandGate?.waitingNative?.()) return false;
      const box = popup(data.divine ? 'Divine Audience: ' + data.divine.name : data.venue?.name || data.service?.name || 'Local Contracts',
        `Silver Pieces: ${data.silver}` + (data.divine ? `\n${data.divine.domain}\n${data.divine.interest}\nVisit ${data.divine.visits}. This deity travels independently and cannot join the party.` : ''));
      held.element = box.element;held.phase='menu';interaction=held;
      for (const item of data.divine?.possessions || []) box.add('Receive ' + item.name, { kind: 'receive', actor, item: item.name }, true);
      if (data.venue) {
        const detail = document.createElement('p');
        detail.textContent = `Level ${data.venue.floor}: ${data.venue.use || data.venue.type}`;
        box.info.after(detail);
        const currency = root.HolodekFlags?.CURRENCY?.plural || 'silver pieces';
        if (data.venue.capabilities.includes('lodging')) box.add(`Rest Party (${data.venue.lodgingPrice} ${currency}; conscious members only)`, { kind: 'lodge', actor }, true);
        if (data.venue.capabilities.includes('commission') && !data.missions.some(m => m.patron === actor && m.type === 'delivery'))
          box.add('Ask About Local Work', { kind: 'request-commission', actor }, true);
        if(!data.service&&!data.divine&&data.venue.capabilities.every(c=>c==='commission'))
          box.info.textContent+='\nWork inquiries only; no shop, treatment or lodging services.'+
            (!data.missions.some(m=>m.status==='offered'||m.status==='accepted')?'\nNo local jobs are currently posted. Asking about work checks whether a valid commission can be offered.':'');
      }
      if (data.service) {
        for (const item of data.service.stock) {
          const buy = box.add(`Buy ${item.name} (${item.price} silver; ${item.quantity} in stock)`, { kind: 'buy', item: item.name, actor }, true);
          const stats = [['Attack','attack_modifier'],['Damage','damage_modifier'],['Armor','ac'],[root.HolodekFlags?.RESOURCE_NAME || 'Magic','magic']]
            .filter(([,field]) => Number(item[field]) !== 0 && Number.isFinite(Number(item[field])))
            .map(([label,field]) => `${label} +${item[field]}`).join(' | ');
          const description = [item.description, item.consumable_kind === 'healing' ? `Restores up to ${item.magic} HP; consumed after use.` : stats].filter(Boolean).join('\n');
          buy.title = description;
          if (description) { const detail = document.createElement('p'); detail.style.whiteSpace = 'pre-wrap'; detail.textContent = description; buy.after(detail); }
        }
        if (data.service.kind === 'shop') for (const item of data.saleItems) box.add(`Sell ${item.name} (${item.salePrice} silver)`, { kind: 'sell', item: item.name, actor }, true);
        else for (const target of data.party) {
          if (target.hp <= 0 && !['Unconscious', 'Dying'].includes(target.state)) box.add(`Resurrect ${target.name} (${target.resurrectPrice} silver; returns at 1 HP)`, { kind: 'resurrect', target: target.name, actor }, true);
          else if (target.hp < target.maxHp) box.add(`Heal ${target.name} (${target.hp}/${target.maxHp}; ${target.healPrice} silver)`, { kind: 'heal', target: target.name, actor }, true);
        }
      }
      for (const mission of data.missions) {
        const line = document.createElement('p'); line.textContent = `${mission.status}: ${mission.description}${mission.pendingReward ? '\nRequirements verified; free an inventory slot to receive your payment.' : ''}`; box.info.after(line);
        if (mission.status === 'offered'&&(mission.type!=='delivery'||mission.patron===actor)) box.add('Accept Local Contract', { kind: 'accept-mission', actor, missionId: mission.id }, true);
        if (mission.status === 'accepted' && mission.item&&(mission.type!=='delivery'||mission.recipient===actor)) {
          const give = document.createElement('button'); give.type = 'button'; give.className = 'popup-button'; give.textContent = 'Give Requested Item';
          give.textContent = 'Give Requested Item to ' + mission.recipient;
          give.addEventListener('click', () => { if (!blocked()) { box.close(); root.ItemGiveUi?.open(mission.recipient); } }); box.info.after(give);
        }
      }
      root.CombatCharacterUi?.addRecruitAction?.(box.rows,actor,{close:box.close,blocked});
      box.add('Close'); return true;
    } catch (error) { notice(error.message); return false; }
    finally { if(held?.phase==='loading')loading?.close();if (interaction === held && !held?.element) interaction = null; pending = false; }
    });
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
    button.textContent = business.venue ? 'Venue Services and Local Work' : business.kind === 'divine' ? 'Divine Audience' : business.kind === 'temple' ? 'Temple Services' : business.kind === 'shop' ? 'Trade' : 'Local Contract';
    button.addEventListener('click', () => open(name)); box.appendChild(button);
  }
  function trader(requested) {
    const ctx = root.getDungeonLifeContext?.();
    const candidates = (ctx?.actors || []).filter(actor => actor.type === 'monster' && (actor.hp ?? 1) > 0 &&
      ['shop', 'temple'].includes(root.getEconomyResidentInfo?.(actor.name)?.kind));
    if (requested) {
      const found = candidates.find(actor => key(actor.name) === key(requested));
      if (!found) throw Error('That trader is not available here. Click the resident to open Trade.');
      return found.name;
    }
    const near = candidates.filter(actor => {
      const reach = root.DungeonInhabitants?.dialogueReach(ctx.dungeon, actor, ctx.player);
      return reach?.canSpeak && reach.lineOfSight && reach.distance <= 3;
    });
    if (near.length !== 1) throw Error(near.length ? 'Choose a trader: use buy [item] from [name] or click Trade.' : 'Move close to a trader and click Trade, or use buy [item] from [name].');
    return near[0].name;
  }
  async function handleCommand(command,options={}) {
    command = String(command).trim();
    const trade = /^(?:trade|shop)(?:\s+(?:with\s+)?(.+))?$/i.exec(command);
    const purchase = /^(buy|purchase|sell)\b(?:\s+(.+?))?(?:\s+(?:from|to)\s+(.+))?$/i.exec(command);
    const take = /^(?:take|pick\s+up|collect)\b/i.test(command), consume = /^(?:drink|quaff)\s+(.+?)(?:\s+(?:by|for)\s+(.+))?$/i.exec(command);
    const drop = /^drop\s+(.+)$/i.exec(command), equip = /^equip\s+(.+?)(?:\s+to\s+(.+))?$/i.exec(command);
    const unequip = /^unequip\s+(.+?)(?:\s+from\s+(.+))?$/i.exec(command);
    if (equip && drinkable(equip[1])) { notice('Use Drink for healing potions; they cannot be equipped.'); return true; }
    if (consume && !drinkable(consume[1])) {
      if (/\b(potion|elixir|vial|draught)\b/i.test(consume[1])) { notice('That potion is not in inventory or has no supported healing Magic.'); return true; }
      return false;
    }
    if (!take && !consume && !equip && !unequip && !drop && !purchase && !trade) return false;
    if (blocked()) { if(!options.quietBusy)notice('Finish the current action first.'); return options.receipt?{status:'busy',retryable:true}:true; }
    if (consume && !consume[2]) { drink(consume[1]); return true; }
    if (trade || purchase && !purchase[2]) {
      try { await open(trader(trade?.[1] || purchase?.[3])); } catch (error) { notice(error.message); }
      return true;
    }
    pending = true;let receipt={status:'failed',retryable:false};
    try {
      if (purchase) {
        await transact({ kind: /^sell$/i.test(purchase[1]) ? 'sell' : 'buy', item: purchase[2], actor: trader(purchase[3]) });
      } else if (equip || unequip) {
        const gear = equip || unequip;
        await transact({ kind: equip ? 'equip' : 'unequip', item: gear[1], ...(gear[2] ? { target: gear[2] } : {}) });
        root.HolodekSfx?.gear?.(equip ? 'equip' : 'unequip');
      } else if (consume) { await transact({ kind: 'drink', item: consume[1], target: consume[2] }); root.HolodekSfx?.gear?.('drink'); }
      else if (drop) { await transact(/^all$/i.test(drop[1]) ? { kind: 'drop-all' } : { kind: 'drop', item: drop[1] }); root.HolodekSfx?.gear?.('drop'); }
      else {
        const ctx = root.getDungeonLifeContext(), selection = root.ObjectDiscovery?.takeRequest(ctx.dungeon, command);
        if (!selection || selection.error) throw Error(selection?.error || 'The current object view is not ready.');
        const { names, all } = selection;
        for (const name of names) {
          if (!root.ObjectDiscovery.isVisible(ctx.dungeon, name)) { if (!all) throw Error('That object is not currently in view.'); continue; }
          try { await transact({ kind: 'take', item: name,...(options.nonce?{nonce:options.nonce}:{}) });receipt={status:'taken',retryable:false}; } catch (error) { if (!all && names.length === 1) throw error; notice(error.message); }
        }
      }
    } catch (error) {
      receipt={status:'failed',retryable:/current action|wait for the current room console|console is not ready|fetch|network|temporar|try again/i.test(error.message)};
      if(!options.quietBusy||!receipt.retryable)notice(error.message);
    }
    finally { pending = false; }
    return options.receipt?receipt:true;
  }
  const hasInteraction=()=>!!interaction&&isInteracting(interaction.actor);
  root.CommerceUi = { open, openCounter, invite, inviteAmbient, isInteracting, hasInteraction,
    invitationPending:()=>hasInteraction()&&interaction.phase==='offer',
    addAction, addDrinkAction, drinkable, drink, handleCommand,isBusy:blocked,
    takeItem:(name,options)=>handleCommand('take '+name,{...options,receipt:true,quietBusy:true}) };
})(window);
