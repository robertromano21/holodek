(function(root) {
  'use strict';
  let pending = false, currentClose = null, currentElement = null, interaction = null;
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
    return interaction.actor === name || interaction.actors?.includes(name);
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
  function popup(title, text, {pauseDialogue=false,fixedActions=false}={}) {
    const origin = observer();
    currentClose?.();
    const resumeDialogue=pauseDialogue?root.DungeonLife?.holdDialogue?.():null;
    document.querySelectorAll('.popup-container').forEach(p => p.remove());
    const box = document.createElement('div'); box.className = 'popup-container commerce-actions';
    if (fixedActions) box.className += ' recruitment-dialog';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
    box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:17000;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto';
    const heading = document.createElement('h3'), info = document.createElement('p'), rows = document.createElement('div'), content = document.createElement('div');
    content.className = 'commerce-dialog-content'; rows.className = 'commerce-dialog-actions';
    if (fixedActions) { content.tabIndex = 0; content.setAttribute('role', 'region'); content.setAttribute('aria-label', 'Request details'); }
    heading.textContent = title; info.textContent = text; info.style.whiteSpace = 'pre-wrap'; content.append(heading, info); box.append(content, rows);
    function close() {
      resumeDialogue?.();
      box.remove(); document.removeEventListener('keydown', escape);
      if (interaction?.element === box) interaction = null;
      if (currentClose === close) {currentClose = null;currentElement=null;}
    }
    const escape = event => { if (event.key === 'Escape' && !pending && interaction?.phase!=='loading') close(); };
    const add = (label, request, reopen) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button'; button.textContent = label;
      rows.appendChild(button);
      button.addEventListener('click', async () => {
        if (!request) { if (!pending) close(); return; }
        if (!sameRoom(origin)) { close(); notice('That menu belonged to another room or game.'); return; }
        if (blocked()) { info.textContent = blockedMessage(); return; }
        const listeners=interaction?.actors || [request.actor];
        pending = true; box.querySelectorAll('button').forEach(b => b.disabled = true);
        try { await transact(request); if(['accept-mission','decline-favor','report-favor','complete-recruitment'].includes(request.kind))for(const name of listeners)root.DungeonLife?.releaseAttention?.(name);close(); pending = false; if (reopen) await open(request.actor,{counterId:origin.counterId}); }
        catch (error) { info.textContent = error.message; }
        finally { pending = false; box.querySelectorAll('button').forEach(b => b.disabled = false); }
      });
      return button;
    };
    currentClose = close;currentElement=box; document.addEventListener('keydown', escape); document.body.appendChild(box);
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
  function invite(actor,{characterClick=false}={}) {
    const business = root.getEconomyResidentInfo?.(actor);
    const request=requestFor(actor);
    if(characterClick && (request || business?.recruitmentCondition || reviewedActors.has(actorReviewKey(actor))))return false;
    if(request){
      if(request.status!=='offered' || shownFavors.has(shownKey(request)) || reviewedActors.has(actorReviewKey(actor)))return false;
      if(blocked()){notice(blockedMessage());return true;}
      return showRecruitment(request);
    }
    if(business?.recruitmentCondition){if(reviewedActors.has(actorReviewKey(actor)))return false;void open(actor);return true;}
    if(starterRoom()&&!business?.starterRecruitment)return false;
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
    const business=root.getEconomyResidentInfo?.(actor);
    const request=requestFor(actor);
    if(starterRoom()&&!request&&!business?.starterRecruitment&&!business?.recruitmentCondition){notice('There is no saved request available for this resident.');return false;}
    if (blocked()) { notice(blockedMessage()); return false; }
    if(!counterId && !business?.venue && !['shop','temple','divine'].includes(business?.kind) && request)
      return showRecruitment(request);
    pending = true; let held,loading;
    return track(async()=>{
    try {
      held = beginInteraction(actor);
      if(counterId)held.counterId=counterId;
      loading=popup(actor,'Opening the saved services menu...');held.element=loading.element;held.phase='loading';
      loading.element.setAttribute('aria-busy','true');
      await root.prepareEconomyState?.();
      if (!sameRoom(held)) return false;
      if(!business?.recruitmentCondition && root.getEconomyResidentInfo?.(actor)?.introduced===false){
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
      const recruitment=data.missions.find(m=>m.recipient===actor && validRecruitment(m));
      if(!data.service && !data.venue && !data.divine && recruitment)return showRecruitment(recruitment);
      const box = popup(data.divine ? 'Divine Audience: ' + data.divine.name : data.venue?.name || data.service?.name || 'Local Contracts',
        `Silver Pieces: ${data.silver}` + (data.divine ? `\n${data.divine.domain}\n${data.divine.interest}\nVisit ${data.divine.visits}. This deity travels independently and cannot join the party.` : ''));
      held.element = box.element;held.phase='menu';held.offeredMissionIds=data.missions.filter(m=>m.status==='offered').map(m=>m.id);interaction=held;
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
        const line = document.createElement('p'); line.textContent = `${mission.type==='resident-favor'?'Recruitment Invitation ('+mission.status+')':mission.status}: ${mission.description}${mission.pendingReward ? '\nRequirements verified; free an inventory slot to receive your payment.' : ''}`; box.info.after(line);
        if (mission.status === 'offered'&&(mission.type!=='delivery'||mission.patron===actor)) box.add(mission.type==='resident-favor'?'Accept Request':'Accept Local Contract', { kind: 'accept-mission', actor, missionId: mission.id });
        if (mission.type === 'resident-favor') {
          if(mission.status!=='offered' && mission.progress){const progress = document.createElement('p'); progress.textContent = mission.progress; box.info.after(progress);}
          if (mission.status === 'offered') box.add('Decline Request', { kind: 'decline-favor', actor, missionId: mission.id });
          if (mission.status === 'accepted') box.add('Complete Request', { kind: 'complete-recruitment', actor, missionId: mission.id }, true);
        }
        if (mission.status === 'accepted' && mission.item&&(mission.type!=='delivery'||mission.recipient===actor)) {
          const give = document.createElement('button'); give.type = 'button'; give.className = 'popup-button'; give.textContent = 'Give Requested Item';
          give.textContent = 'Give Requested Item to ' + mission.recipient;
          give.addEventListener('click', () => { if (!blocked()) { box.close(); root.ItemGiveUi?.open(mission.recipient); } }); box.info.after(give);
        }
      }
      root.CombatCharacterUi?.addRecruitAction?.(box.rows,actor,{close:box.close,blocked,recruitmentCondition:data.recruitmentCondition ||
        data.missions.find(m=>m.type==='resident-favor'&&m.recipient===actor&&['offered','accepted'].includes(m.status))});
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
    const business = root.getEconomyResidentInfo?.(name),request=requestFor(name); if (!box || !business&&!request) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button';
    button.textContent = request ? (request.invitationPending?(request.status!=='offered'||shownFavors.has(shownKey(request))?'Recruitment Progress':'Recruitment Invitation'):'Local Request') : business.venue ? 'Venue Services and Local Work' : business.kind === 'divine' ? 'Divine Audience' : business.kind === 'temple' ? 'Temple Services' : business.kind === 'shop' ? 'Trade' : business.recruitmentCondition ? 'Recruitment Progress' : 'Local Contract';
    button.addEventListener('click', () => request?showRecruitment(requestFor(name) || request):open(name)); box.appendChild(button);
    if(request?.invitationPending && request.status!=='offered'){
      const finish=document.createElement('button');finish.type='button';finish.className='popup-button';finish.textContent='Complete Party Invitation';
      finish.disabled=!completionReady(request);finish.title=finish.disabled?'Complete every agreed condition first; see Recruitment Progress.':'';
      finish.addEventListener('click',async()=>{
        const current=requestFor(name);if(!current || !completionReady(current) || blocked())return;
        pending=true;finish.disabled=true;
        try{await transact({kind:'complete-recruitment',actor:current.recipient,missionId:current.id});root.CombatCharacterUi?.open?.({name},{services:false});}
        catch(error){notice(error.message);}finally{pending=false;finish.disabled=!completionReady(requestFor(name));}
      });box.appendChild(finish);
    }
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
  const favorOffers=new Map(),knownRequests=new Map(),shownFavors=new Set(),reviewedActors=new Set(),reports=[],reported=new Set();let favorScope=null,lastFavorScan=0;
  function report(phase,m,reason='') {
    const row={version:'group-recruitment-1',phase,reason,runId:root.dungeonRunId,geoKey:root.currentDungeon?.geoKey,
      actor:m?.recipient || '',requestId:m?.id || '',floor:floorIdentity(),at:Date.now()};
    const signature=[row.runId,row.geoKey,row.floor,phase,row.requestId,m?.status,!!m?.invitationPending,reason].join('|');if(reported.has(signature))return;reported.add(signature);if(reported.size>256)reported.delete(reported.values().next().value);
    reports.push(row);if(reports.length>64)reports.shift();root.console?.info?.('[RecruitmentUi]',row);
    if(row.runId&&row.geoKey)root.fetch?.('/debug/recruitment-ui',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)})?.catch(()=>{});
  }
  const floorIdentity=()=>root.CityFloorScope?.identity?.(root.currentDungeon?.cityFloorContext) ||
    (root.currentDungeon?.cityFloorContext?`${root.currentDungeon.cityFloorContext.hostKey}|${root.currentDungeon.cityFloorContext.buildingId}|${root.currentDungeon.cityFloorContext.floor}`:'street');
  function syncFavorScope() {
    const scope=root.dungeonRunId+'|'+root.currentDungeon?.geoKey+'|'+floorIdentity()+'|'+root.CityFloorScope?.token();
    if(scope!==favorScope){
      if(interaction?.favorId && interaction.favorScope!==scope)currentClose?.();
      if(favorScope && !favorScope.startsWith(root.dungeonRunId+'|')){shownFavors.clear();reviewedActors.clear();}
      favorScope=scope;favorOffers.clear();knownRequests.clear();lastFavorScan=0;
    }
  }
  const offerContext=()=>({runId:root.dungeonRunId,geoKey:root.currentDungeon?.geoKey,floorToken:root.CityFloorScope?.token()});
  function validRecruitment(m) {
    return !!(m?.source==='engine-resident-favor-v1' && m.type==='resident-favor' &&
      !/\b(?:observe|observations?|report(?:s|ing)?)\b/i.test(m.description || '') &&
      (['offered','accepted'].includes(m.status) || m.status==='completed'&&m.invitationPending&&!m.recruitedAt) &&
      m.runId===root.dungeonRunId && m.roomKey===root.currentDungeon?.geoKey && m.floor===floorIdentity() && m.id && m.recipient && m.description);
  }
  function completionReady(m){
    if(!m?.invitationPending)return false;
    if(m.recruitmentGroup)return m.recruitmentGroup.status==='accepted' && m.recruitmentGroup.members.every(member=>
      member.outcome!=='pending' && (member.outcome!=='conditional' || member.status==='completed' || member.readyToReport));
    return m.status==='completed' || m.status==='accepted'&&m.readyToReport;
  }
  function requestFor(name) {
    syncFavorScope();const m=knownRequests.get(name) || root.getEconomyResidentInfo?.(name)?.recruitmentCondition;
    return validRecruitment(m) && (!starterRoom() || m.starterRecruitment===true)?m:null;
  }
  const shownKey=m=>root.dungeonRunId+'|'+(m.recruitmentGroup?.id || m.id);
  const actorReviewKey=name=>[root.dungeonRunId,root.currentDungeon?.geoKey,floorIdentity(),name].join('|');
  function rememberReview(m){
    shownFavors.add(shownKey(m));reviewedActors.add(actorReviewKey(m.recipient));
    while(shownFavors.size>512)shownFavors.delete(shownFavors.values().next().value);
    while(reviewedActors.size>512)reviewedActors.delete(reviewedActors.values().next().value);
  }
  function showRecruitment(m,{automatic=false}={}) {
    if(!validRecruitment(m) || starterRoom()&&!m.starterRecruitment){report('unavailable',m,'invalid-request-or-scope');if(!automatic)notice('This request is not available in the current room.');return false;}
    const ctx=root.getDungeonLifeContext?.(),actor=ctx?.actors?.find(a=>a.name===m.recipient && (a.type==='monster'||a.type==='npc'&&a.recruitmentLease) && (a.hp??1)>0 &&
      a.discoveryState!=='pending' && !['Hostile','Dead','Dying','Unconscious'].includes(a.allegiance || a.state));
    const actorRoom=actor?.mazeRoomKey && (root.DungeonInhabitants?.roomKey?.(actor.mazeRoomKey) || actor.mazeRoomKey);
    if(!actor || actorRoom && actorRoom!==root.currentDungeon?.geoKey){report('unavailable',m,'resident-not-present');if(!automatic)notice('This request is saved, but its resident is not available in this room.');return false;}
    const group=m.recruitmentGroup;
    if(group?.status==='collecting' || root.DungeonLife?.hasPendingTurnSpeech?.()){
      queueFavor(m,{...offerContext(),awaitDialogue:true,dialogueQueued:true});report('waiting',m,'group-dialogue');return true;
    }
    syncFavorScope();
    for(const [id,offer]of favorOffers)if(shownKey(offer.mission)===shownKey(m))favorOffers.delete(id);
    const offered=group?group.status==='review':m.status==='offered';
    const held=beginInteraction(m.recipient),status=offered?'Review the complete request before deciding.':'Request accepted. Fulfill the listed requirements.';
    const localHelpers=group?.members.some(member=>member.participation==='help-here');
    const description=group?group.members.map(member=>`${member.name}: ${member.description ||
      (member.outcome==='ready'?'Willing to join after the group conditions are approved and completed.':member.outcome==='pending'?'Still considering the invitation.':'Remaining here; not part of the recruitment reward.')}${member.participation==='help-here'?' Helps here after acceptance; stays behind if you leave before the group task is finished.':''}`).join('\n\n')+
      (localHelpers?'\n\nLocal helpers accompany you here after acceptance. Complete every agreed condition for the willing group to remain together.':'\n\nThe willing members join together after every agreed condition is verified.'):m.invitationPending?m.description:m.requestDescription || m.description;
    const box=popup(group?(offered?'Group Recruitment Invitation':'Recruitment Progress'):m.invitationPending?(offered?'Recruitment Invitation':'Recruitment Progress'):'Local Request',`${group?'Encountered Group':m.recipient}\n${status}\n\n${description}`+
      (!offered && m.progress && !m.description.includes(m.progress)?'\n\n'+m.progress:''),{pauseDialogue:true,fixedActions:true});
    rememberReview(m);report('shown',m);
    const sheet=document.getElementById('party-popup');if(sheet?.style)sheet.style.display='none';
    held.element=box.element;held.phase='menu';held.actors=group?.members.map(member=>member.name);held.offeredMissionIds=offered?(group?.members.map(member=>member.missionId).filter(Boolean) || [m.id]):[];held.favorId=m.id;held.favorScope=favorScope;
    if(group)for(const member of group.members)reviewedActors.add(actorReviewKey(member.name));
    if(offered){
      const contact=group?.members.find(member=>member.status==='offered' && member.missionId) || {name:m.recipient,missionId:m.id};
      box.add(group?'Accept Group Request':'Accept Request',{kind:'accept-mission',actor:contact.name,missionId:contact.missionId});
      box.add(group?'Decline Group Request':'Decline Request',{kind:'decline-favor',actor:contact.name,missionId:contact.missionId});
      const later=box.add('Not Now');later.addEventListener('click',()=>{if(!pending){box.close();root.DungeonLife?.releaseAttention?.(m.recipient);root.CombatCharacterUi?.open?.({name:m.recipient},{services:false});}});
    }else{
      const finish=box.add(m.invitationPending?'Complete Party Invitation':'Complete Request',{kind:'complete-recruitment',actor:m.recipient,missionId:m.id});
      if(m.invitationPending)finish.disabled=!completionReady(m);
      box.add('Close');
    }
    const business=root.getEconomyResidentInfo?.(m.recipient);
    if(business?.venue || ['shop','temple','divine'].includes(business?.kind)){
      const services=document.createElement('button');services.type='button';services.className='popup-button';services.textContent='Access Services';
      services.addEventListener('click',async()=>{if(!blocked())await open(m.recipient);});box.rows.appendChild(services);
    }
    return true;
  }
  function queueFavor(m,ctx) {
    if(!m || m.source!=='engine-resident-favor-v1' || m.type!=='resident-favor' || m.status!=='offered')return;
    ctx ||= offerContext();
    if(m.runId!==ctx.runId || m.roomKey!==ctx.geoKey || m.floor!==floorIdentity() || !m.id || !m.recipient || !m.description)return;
    syncFavorScope();knownRequests.set(m.recipient,m);const id=ctx.runId+'|'+m.id;
    if(!shownFavors.has(shownKey(m))){favorOffers.set(id,{queuedAt:Date.now(),...favorOffers.get(id),...ctx,mission:m});report('queued',m);}
  }
  function dialogueQueued(event) {
    if(event.runId && event.runId!==root.dungeonRunId || event.geoKey!==root.currentDungeon?.geoKey)return;
    for(const offer of favorOffers.values())if(event.speakers?.includes(offer.mission.recipient))offer.dialogueQueued=true;
  }
  function onFrame() {
    const d=root.currentDungeon;if(!d)return false;
    syncFavorScope();if(currentElement?.isConnected===false)currentClose?.();
    const openPopup=[...document.querySelectorAll('.popup-container')].some(node=>!node.hidden && node.style?.display!=='none' &&
      (typeof node.getClientRects!=='function'||node.getClientRects().length>0));
    const waiting=blocked()?'action-busy':hasInteraction()||currentClose||openPopup?'popup-open':root.RoomEntry?.isPending?.()?'arrival-pending':root.GameCommandGate?.isSubmitting?.()?'command-submitting':null;
    if(waiting){for(const offer of favorOffers.values())report('waiting',offer.mission,waiting);return false;}
    const ctx=root.getDungeonLifeContext?.();if(!ctx?.player || ctx.dungeon?.geoKey!==d.geoKey)return false;
    if(Date.now()-lastFavorScan>500){lastFavorScan=Date.now();
      for(const actor of ctx.actors || [])if(actor.type==='monster' && (actor.hp??1)>0 && actor.discoveryState!=='pending' &&
        !['Hostile','Dead','Dying','Unconscious'].includes(actor.allegiance || actor.state))
        queueFavor(root.getEconomyResidentInfo?.(actor.name)?.recruitmentCondition);
    }
    for(const [id,offer]of favorOffers){
      if(!sameRoom(offer) || offer.mission.floor!==floorIdentity()){favorOffers.delete(id);continue;}
      const actor=ctx.actors?.find(a=>a.name===offer.mission.recipient && a.type==='monster' && (a.hp??1)>0 && a.discoveryState!=='pending' &&
        !['Hostile','Dead','Dying','Unconscious'].includes(a.allegiance || a.state));
      const actorRoom=actor?.mazeRoomKey && (root.DungeonInhabitants?.roomKey?.(actor.mazeRoomKey) || actor.mazeRoomKey);
      if(!actor || actorRoom && actorRoom!==d.geoKey){report('waiting',offer.mission,'resident-not-present');continue;}
      if(offer.mission.recruitmentGroup?.status==='collecting'){report('waiting',offer.mission,'group-still-responding');continue;}
      if(offer.awaitDialogue && (!offer.dialogueQueued || root.DungeonLife?.hasPendingTurnSpeech?.())){
        if(!offer.dialogueQueued && Date.now()-offer.queuedAt>30000)report('waiting',offer.mission,'speech-handoff-timeout');
        else{report('waiting',offer.mission,offer.dialogueQueued?'resident-speaking':'speech-not-queued');continue;}
      }
      return showRecruitment(offer.mission,{automatic:true});
    }
    return false;
  }
  function receiveResult(event) {
    if(event?.runId!==root.dungeonRunId || event.geoKey!==root.currentDungeon?.geoKey) return;
    let jobs=event.recruitmentRequests;
    if(!Array.isArray(jobs)){let database;try{database=JSON.parse(event.roomNameDatabaseString);}catch{return;}
      const room=database?.[event.geoKey];jobs=Object.values(room?.minorMissions || {}).map(m=>{
        const group=room.recruitmentInvitations?.[m.recruitmentGroupId];
        return group?{...m,recruitmentGroup:{...group,members:group.members.map(member=>{
          const task=room.minorMissions?.[member.missionId];return {...member,...(task?{status:task.status,readyToReport:!!task.readyToReport,description:task.requestDescription || task.description}:{})};})}}:m;
      });}
    syncFavorScope();const ctx=offerContext();
    for(const m of jobs){
      if(m.source==='engine-resident-favor-v1' && m.runId===ctx.runId && m.roomKey===ctx.geoKey && m.floor===floorIdentity() &&
        ['accepted','declined','completed','withdrawn','failed'].includes(m.status))rememberReview(m);
      if(validRecruitment(m)){
        knownRequests.set(m.recipient,m);report('received',m);
        for(const member of m.recruitmentGroup?.members || [])if(member.outcome==='ready')knownRequests.set(member.name,m);
      }else for(const [name,request]of knownRequests)if(request.id===m?.id)knownRequests.delete(name);
      if(m.status==='offered')queueFavor(m,{...ctx,...(event.dialogue?.some(row=>row.speaker===m.recipient)?{awaitDialogue:true}:{})});else favorOffers.delete(ctx.runId+'|'+m.id);
    }
    if(!interaction || interaction.phase!=='menu' || !sameRoom(interaction))return;
    if(jobs.some(m=>interaction.offeredMissionIds?.includes(m.id) && ['accepted','completed','withdrawn','declined','failed'].includes(m.status)))currentClose?.();
  }
  root.CommerceUi = { open, openCounter, invite, inviteAmbient, isInteracting, hasInteraction,
    receiveResult,onFrame,dialogueQueued,requestFor,diagnostics:()=>reports.map(row=>({...row})),
    invitationPending:()=>hasInteraction()&&interaction.phase==='offer',
    addAction, addDrinkAction, drinkable, drink, handleCommand,isBusy:blocked,
    takeItem:(name,options)=>handleCommand('take '+name,{...options,receipt:true,quietBusy:true}) };
})(window);
