(function(root) {
  'use strict';
  let panel, lastMessage = '', runId;
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
  function receive(data) {
    if (data.runId !== root.dungeonRunId) return;
    if (runId !== data.runId) { runId = data.runId; lastMessage = ''; root._gameOver = false; document.getElementById('game-over-panel')?.remove(); }
    const id = data.runId + ':' + data.messageRevision;
    if (data.message && id !== lastMessage) {
      lastMessage = id;
      root.DungeonActionNotices?.receive({ id, runId, geoKey: root.currentDungeon?.geoKey, kind: 'survival', title: 'Divine Intervention', message: data.message });
    }
    root._gameOver = !!data.gameOver;
    if (data.gameOver && !document.getElementById('game-over-panel')) {
      root.gamePaused = true;
      const box = document.createElement('section'); box.id = 'game-over-panel'; box.setAttribute('role', 'alertdialog');
      box.style.cssText = 'position:fixed;inset:15% 15%;z-index:25000;background:#17120ff2;border:2px solid #ae8b51;padding:36px;color:#eee;font:24px Georgia,serif';
      const heading = document.createElement('h1'), text = document.createElement('p'); heading.textContent = 'Game Over'; text.textContent = data.gameOver.reason;
      box.append(heading, text); document.body.appendChild(box);
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
      const choices = await post('/combat/care/view', origin);
      for (const choice of choices.care.filter(c => c.target === target)) {
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
  root.CombatLifeUi = { receive, open, addAction, laidDownPixels };
})(window);
