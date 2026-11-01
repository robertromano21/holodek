(function(root) {
  'use strict';
  let panel, lastMessage = '', runId, recovery = null, recoveryTimer = null, recoveryBusy = false, recoveryLog = '', lastStatus = null;
  function updateRecovery(data) {
    const prior = recovery; recovery = data.recovery || null; root._playerUnconscious = !!recovery;
    document.getElementById('wound-recovery-panel')?.remove();
    if (!recovery || data.gameOver || !document.body) {
      if (recoveryTimer) { clearInterval(recoveryTimer); recoveryTimer = null; }
      if (prior && !recovery && !data.gameOver) { const log = document.getElementById('chatlog'); if (log) { const p = document.createElement('p'); p.textContent = prior.name + ' wakes as consciousness returns.'; log.appendChild(p); } }
      return;
    }
    const box = document.createElement('section'); box.id = 'wound-recovery-panel'; box.setAttribute('role', 'status');
    box.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:22000;padding:12px;max-width:500px;background:#17120ff2;color:#ead29d;border:1px solid #ae8b51';
    const text = document.createElement('p'); text.textContent = recovery.message + (root.actionDiceState?.active ? ' Your companions are still fighting; the encounter continues.' : ' You may wait while time passes.');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'popup-button'; button.textContent = 'Wait / Sleep';
    button.disabled = !recovery.afterBattle || !!root.actionDiceState?.active; button.addEventListener('click', recoverTick); box.append(text, button); document.body.appendChild(box);
    const id = data.runId + ':' + recovery.clock + ':' + recovery.state;
    if (recoveryLog !== id) { recoveryLog = id; const log = document.getElementById('chatlog'); if (log) { const p = document.createElement('p'); p.textContent = text.textContent; log.appendChild(p); } }
    if (!recoveryTimer && typeof setInterval === 'function') recoveryTimer = setInterval(recoverTick, 7000);
  }
  async function recoverTick() {
    if (!recovery?.afterBattle || recoveryBusy || blocked()) return;
    recoveryBusy = true;
    try { await root.applyRealtimeCombatResult?.(await post('/combat/wait', { ...observer(), nonce: nonce() })); }
    catch (error) { const box = document.getElementById('wound-recovery-panel'); if (box) box.title = error.message; }
    finally { recoveryBusy = false; }
  }
  const blocked = () => root.gamePaused || root._gameOver || root.GameCommandGate?.busy() || root.actionDiceState?.active || root._combatCommandPending;
  const nonce = () => root.crypto?.randomUUID?.() || 'aid:' + Date.now() + ':' + Math.random().toString(36).slice(2);
  function observer() {
    const c = root.getDungeonLifeContext?.(); if (!c?.dungeon || !c.player) throw Error('The room is not ready.');
    return { runId: root.dungeonRunId, geoKey: c.dungeon.geoKey, player: c.player,
      actors: c.actors.map(a => ({ name: a.name, mazeX: a.mazeX, mazeY: a.mazeY, mazePoint: a.mazePoint, discoveryRevision: a.discoveryRevision })) };
  }
  async function post(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw Error(data.error || 'First aid unavailable.'); return data;
  }
  function showRecovery(data, id) {
    if (!document.body) return false;
    document.getElementById('revival-popup')?.remove();
    const box = document.createElement('section'); box.id = 'revival-popup';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-labelledby', 'revival-heading');
    box.style.cssText = 'position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:24000;width:min(620px,calc(100vw - 32px));max-height:70vh;overflow:auto;box-sizing:border-box;padding:24px;background:#17120ff5;border:2px solid #ae8b51;color:#eee;font:18px/1.45 Georgia,serif;box-shadow:0 12px 50px #000b';
    const title = document.createElement('h2'); title.id = 'revival-heading'; title.textContent = data.recoveryTitle || 'Returned to Life';
    const story = document.createElement('p'); story.style.whiteSpace = 'pre-wrap'; story.textContent = data.message;
    const remaining = document.createElement('p');
    remaining.textContent = 'Recoveries used: ' + data.rescuesUsed + ' of 2. Remaining recoveries: ' + Math.max(0, 2 - data.rescuesUsed) + '. The third death ends this adventure.';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'popup-button'; close.textContent = data.deathScene ? 'Return to the level entrance' : 'Understood';
    const dismiss = () => {
      if (root.dungeonRunId !== data.runId || root._gameOver || document.getElementById('revival-popup') !== box) return;
      root._deathSceneActive = false; box.remove();
      try { root.sessionStorage?.setItem('holodek-recovery-read', id); } catch {}
    };
    close.addEventListener('click', dismiss);
    box.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    box.append(title, story, remaining, close); document.body.appendChild(box);
    const log = document.getElementById('chatlog');
    if (log && !log.querySelector?.('[data-recovery-id="' + id + '"]')) {
      const entry = document.createElement('p'); entry.setAttribute('data-recovery-id', id); entry.style.whiteSpace = 'pre-wrap';
      entry.textContent = title.textContent + '\n' + data.message + '\n' + remaining.textContent; log.appendChild(entry);
    }
    if (data.deathScene) {
      root._deathSceneActive = true;
      box.style.cssText = 'position:fixed;inset:0;z-index:24000;box-sizing:border-box;overflow:auto;padding:10vh max(24px,12vw);background:#000;color:#ead29d;font:22px/1.55 Georgia,serif';
      box.replaceChildren(); box.setAttribute('aria-label', 'Between lives');
      const dark = document.createElement('p'); dark.textContent = 'Everything goes black.'; box.appendChild(dark);
      const reveal = () => {
        if (document.getElementById('revival-popup') !== box) return;
        box.replaceChildren(); title.textContent = data.deathScene.reviver || data.recoveryTitle;
        const seen = document.createElement('p'); seen.textContent = data.deathScene.description;
        const spoken = document.createElement('p'); spoken.textContent = data.deathScene.words;
        box.append(title, seen, spoken, story, remaining, close);
      };
      if (typeof setTimeout === 'function') setTimeout(reveal, 850); else reveal();
    }
    return true;
  }
  function beginRun(id) {
    if (runId === id) return;
    runId = id; lastMessage = ''; lastStatus = null; recovery = null; recoveryBusy = false; recoveryLog = '';
    if (recoveryTimer) { clearInterval(recoveryTimer); recoveryTimer = null; }
    document.getElementById('revival-popup')?.remove(); document.getElementById('wound-recovery-panel')?.remove();
    document.getElementById('game-over-panel')?.remove();
    root._gameOver = false; root._deathSceneActive = false; root._playerUnconscious = false;
    root.GameOverStartUi?.beginRun(id);
  }
  function receive(data) {
    if (data.runId !== root.dungeonRunId) return;
    beginRun(data.runId);
    lastStatus = data;
    const id = data.runId + ':' + data.messageRevision;
    if (data.message && id !== lastMessage) {
      lastMessage = id;
      let acknowledged = false; try { acknowledged = root.sessionStorage?.getItem('holodek-recovery-read') === id; } catch {}
      if (!data.gameOver && !acknowledged && !showRecovery(data, id)) lastMessage = '';
    }
    updateRecovery(data);
    root.CombatTacticalUi?.refreshHealth?.();
    root._gameOver = !!data.gameOver;
    if (data.gameOver && root.GameOverStartUi?.restore(data)) return;
    if (data.gameOver && !document.getElementById('game-over-panel')) {
      root.gamePaused = true; root._deathSceneActive = true; document.getElementById('revival-popup')?.remove();
      const box = document.createElement('section'); box.id = 'game-over-panel'; box.setAttribute('role', 'alertdialog');
      box.style.cssText = 'position:fixed;inset:15% 15%;z-index:25000;background:#17120ff2;border:2px solid #ae8b51;padding:36px;color:#eee;font:24px Georgia,serif';
      const heading = document.createElement('h1'), text = document.createElement('p'); heading.textContent = 'Game Over'; text.textContent = data.gameOver.reason;
      box.style.cssText = 'position:fixed;inset:0;z-index:25000;overflow:auto;padding:12vh 12vw;box-sizing:border-box;background:#000;color:#ead29d;font:22px/1.5 Georgia,serif';
      const dark = document.createElement('p'); dark.textContent = 'Everything goes black.'; box.appendChild(dark); document.body.appendChild(box);
      const reveal = () => {
        if (document.getElementById('game-over-panel') !== box) return;
        box.replaceChildren();
        const seen = document.createElement('p'); seen.textContent = data.deathScene?.description || '';
        const who = document.createElement('p'); who.textContent = data.deathScene?.reviver || '';
        const close = document.createElement('button'); close.type = 'button'; close.className = 'popup-button'; close.textContent = 'Return to Start Menu';
        close.addEventListener('click', () => {
          try {
            if (root.GameOverStartUi?.returnToMenu(data.runId) !== true) throw Error('The start menu is not ready. Refresh this page and try again.');
            box.remove();
          } catch (error) { text.textContent = data.gameOver.reason + '\n' + error.message; }
        }); box.append(heading, seen, who, text, close);
      };
      if (typeof setTimeout === 'function') setTimeout(reveal, 850); else reveal();
    }
  }
  async function open(target) {
    if (blocked()) return false;
    panel?.remove();
    const box = document.createElement('section'); panel = box; box.className = 'popup-container';
    box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:18000;padding:24px;width:min(500px,calc(100vw - 32px));background:#211c15;color:#eee';
    const title = document.createElement('h2'), info = document.createElement('p'); title.textContent = 'First Aid: ' + target;
    info.textContent = 'Bandaging stabilizes at 0 HP. Healing wakes a living ally. Each action takes one turn.'; box.append(title, info); document.body.appendChild(box);
    try {
      await root.prepareEconomyState?.(); const origin = observer();
      const choices = await post('/combat/care/view', origin), injury = choices.injuries?.find(a => a.name === target);
      const available = choices.care.filter(c => c.target === target);
      info.textContent = (injury?.state === 'Dying' ? `${target} is dying: ${injury.remaining ?? '?'} action${injury.remaining === 1 ? '' : 's'} remain${injury.remaining === 1 ? 's' : ''} for aid. ` : '') +
        'Bandaging stabilizes at 0 HP without a roll. Reading or cancelling this menu takes no turn. ' +
        (available.length ? 'Choose a treatment below; it costs one turn.' : 'No treatment is currently available. Check adjacency, clear access and allegiance; waiting is not treatment.');
      for (const choice of available) {
        const b = document.createElement('button'); b.className = 'popup-button'; b.textContent = choice.label + ' by ' + choice.actor;
        b.addEventListener('click', async () => {
          if (blocked() || origin.runId !== root.dungeonRunId || origin.geoKey !== root.currentDungeon?.geoKey) return;
          box.querySelectorAll('button').forEach(b => b.disabled = true);
          try { await root.applyRealtimeCombatResult?.(await post('/combat/care', { ...observer(), ...choice, nonce: nonce() })); box.remove(); }
          catch (error) { info.textContent = error.message; }
          finally { box.querySelectorAll('button').forEach(b => b.disabled = false); }
        }); box.appendChild(b);
      }
      const wait = document.createElement('button'); wait.className = 'popup-button'; wait.textContent = 'Wait One Turn';
      wait.addEventListener('click', async () => {
        if (blocked() || wait.disabled) return;
        if (injury?.state === 'Dying' && root.confirm && !root.confirm(`${target} is dying. Waiting uses one of the remaining aid actions and may let them die. Wait anyway?`)) return;
        box.querySelectorAll('button').forEach(b => b.disabled = true);
        try { await root.applyRealtimeCombatResult?.(await post('/combat/wait', { ...observer(), nonce: nonce() })); box.remove(); }
        catch (error) { info.textContent = error.message; }
        finally { box.querySelectorAll('button').forEach(b => b.disabled = false); }
      });
      box.appendChild(wait);
    } catch (error) { info.textContent = error.message; }
    const close = document.createElement('button'); close.className = 'popup-button'; close.textContent = 'Cancel'; close.addEventListener('click', () => box.remove()); box.appendChild(close);
    return true;
  }
  function addAction(box, name) {
    const actor = (root.combatCharacters || []).find(a => a.name === name);
    if (!box || !actor || root.DungeonInhabitants?.state(actor) === 'Dead' || actor.hp >= (actor.maxHp ?? actor.maxHP)) return;
    const button = document.createElement('button'); button.className = 'popup-button'; button.textContent = 'First Aid';
    button.addEventListener('click', () => open(name)); box.appendChild(button);
  }
  function condition(actor) {
    const name = typeof actor === 'string' ? actor : actor?.name;
    const injury = lastStatus?.runId === root.dungeonRunId && lastStatus.injuries?.find(a => a.name === name);
    const state = injury?.state || actor?.state || 'Alive';
    if (state !== 'Dying') return state;
    const remaining = injury?.remaining ?? actor?.dyingRounds;
    return `Dying: ${remaining ?? '?'} ${root.actionDiceState?.active?.kind === 'combat' ? 'round' : 'action'}${remaining === 1 ? '' : 's'} for aid`;
  }
  function laidDownPixels(pix) {
    if (!pix?.bounds) return pix;
    const data = new Uint8Array(pix.data.length), w = pix.w, h = pix.h;
    if (w !== h) return pix;
    const shift = h - 1 - (pix.bounds?.maxX ?? w - 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dy = x + shift; if (dy >= h) continue;
      const src = (y * w + x) * 4, dst = (dy * w + h - 1 - y) * 4;
      data.set(pix.data.subarray(src, src + 4), dst);
    }
    return { ...pix, data, bounds: pix.bounds ? { minX: h - 1 - pix.bounds.maxY, maxX: h - 1 - pix.bounds.minY,
      minY: pix.bounds.minX + shift, maxY: h - 1 } : pix.bounds };
  }
  root.CombatLifeUi = { receive, beginRun, condition, refresh: () => { if (lastStatus) updateRecovery(lastStatus); }, open, addAction, laidDownPixels };
})(window);
