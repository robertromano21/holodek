(function (root) {
  'use strict';
  if (root.GameQuitUi) return;
  let panel, slots, label, status, saveButton, quitButton, cancelButton, working = false, wasPaused = false, entries = [];
  async function post(url, body) {
    const response = await root.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404 && url === '/game/quit') throw Error('This running server has not loaded Quit Game support. Stop the old server and start the updated version.');
      throw Error(data.error || `The server could not complete this action (HTTP ${response.status}).`);
    }
    return data;
  }
  async function pause(paused) {
    await post('/game/pause', { runId: root.dungeonRunId, paused });
    root.DungeonLife?.setPaused({ runId: root.dungeonRunId, paused }); root.gamePaused = paused;
  }
  function busy(value) { working = value; quitButton.disabled = cancelButton.disabled = value; saveButton.disabled = value || !root.getDungeonLifeContext?.()?.dungeon; slots.disabled = label.disabled = value; }
  async function quit(saveFirst) {
    if (working) return;
    const slot = entries.find(e => e.slot === Number(slots.value));
    if (saveFirst && !slot) { status.textContent = 'Choose a save slot first.'; return; }
    if (saveFirst && slot.occupied && !root.confirm('Replace Slot ' + slot.slot + ' before quitting? Its previous version will be backed up.')) return;
    if (!saveFirst && !root.confirm('Quit without saving? Any progress since your last save will be lost.')) return;
    busy(true); let saved = false;
    try {
      if (saveFirst) {
        status.textContent = 'Saving and verifying your adventure...';
        const result = await root.HolodekSaveGame.save(slot.slot, label.value || 'Before quitting', { overwrite: !!slot.occupied, expectedChecksum: slot.checksum });
        if (!result.saved) throw Error('The checkpoint was not confirmed.'); saved = true;
      }
      status.textContent = 'Stopping the game server...';
      const result = await post('/game/quit', { runId: root.dungeonRunId, confirm: true });
      if (!result.quitting) throw Error('The server did not confirm shutdown.');
      root.HolodekSfx?.stopSpeech?.(); root.HolodekSfx?.musicPause?.();
      // Navigate off the game document so its timers and reconnecting event
      // streams stop. A blob page needs no HTTP request after port 3000 closes.
      const html = '<!doctype html><html><head><meta charset="utf-8"><title>Game Closed</title><style>body{margin:12vh auto;padding:30px;max-width:650px;background:#171510;color:#ead5a6;font:22px Georgia,serif;line-height:1.6}h1{font-size:36px}</style></head><body><h1>The Adventure Rests</h1><p>' + (saved ? 'Your adventure was saved and verified before quitting.' : 'The game has closed without creating a new save.') + '</p><p>The game server has stopped. You can close this tab and reopen the game using your usual launcher.</p></body></html>';
      root.location.replace(root.URL.createObjectURL(new Blob([html], { type: 'text/html' })));
    } catch (error) {
      status.textContent = (saved ? 'Your save succeeded, but quitting did not: ' : 'Not quit: ') + error.message;
      busy(false);
    }
  }
  async function cancel() {
    if (working) return;
    try { if (!wasPaused && root.getDungeonLifeContext?.()?.dungeon) await pause(false); panel.close(); }
    catch (error) { status.textContent = 'The game remains paused: ' + error.message; }
  }
  async function open() {
    init(); if (!panel || panel.open) return;
    wasPaused = !!root.gamePaused; panel.showModal(); busy(true); status.textContent = 'Checking your save slots...';
    try {
      if (root.getDungeonLifeContext?.()?.busy || root.actionDiceState?.active || root._combatCommandPending) throw Error('Finish the current command or combat round before quitting.');
      const lifecycle = await root.fetch('/game/lifecycle', { cache: 'no-store' });
      if (lifecycle.status === 404) throw Error('This running server has not loaded Quit Game support. Stop the old server and start the updated version. No game has been stopped.');
      if (!lifecycle.ok) throw Error(`Could not check shutdown support (HTTP ${lifecycle.status}).`);
      const capabilities = await lifecycle.json();
      if (!capabilities.canQuit) throw Error('Quit Game can stop only the local server. Open the game through localhost.');
      if (!capabilities.running) throw Error('The game server is already stopping.');
      const response = await root.fetch('/game-saves', { cache: 'no-store' });
      if (!response.ok) throw Error('Save support is unavailable. Keep this game open.');
      entries = (await response.json()).slots; slots.replaceChildren();
      for (const slot of entries) { const option = root.document.createElement('option'); option.value = slot.slot; option.textContent = 'Slot ' + slot.slot + ': ' + (slot.label || (slot.occupied ? 'Saved adventure' : 'Empty')); slots.appendChild(option); }
      slots.value = (entries.find(e => !e.occupied) || entries[0]).slot; updateLabel();
      if (!wasPaused && root.getDungeonLifeContext?.()?.dungeon) await pause(true);
      status.textContent = 'Save before quitting? Quitting stops the local game server and releases its port.';
      busy(false);
    } catch (error) { status.textContent = error.message; busy(false); saveButton.disabled = quitButton.disabled = true; }
  }
  function updateLabel() { label.value = entries.find(e => e.slot === Number(slots.value))?.label || 'Before quitting'; }
  function init() {
    const menu = root.document.getElementById('game-menu'); if (!menu || panel) return;
    const button = root.document.createElement('button'); button.className = 'game-menu-button'; button.id = 'quit-game-button'; button.textContent = 'Quit Game'; button.onclick = open; menu.appendChild(button);
    panel = root.document.createElement('dialog'); panel.id = 'quit-game-dialog'; panel.setAttribute('aria-label', 'Save and quit game');
    const title = root.document.createElement('h2'); title.textContent = 'Leave the Underworld?';
    status = root.document.createElement('p'); status.setAttribute('role', 'status');
    slots = root.document.createElement('select'); slots.setAttribute('aria-label', 'Save slot'); slots.onchange = updateLabel;
    label = root.document.createElement('input'); label.maxLength = 80; label.setAttribute('aria-label', 'Save name');
    saveButton = root.document.createElement('button'); saveButton.textContent = 'Save and Quit'; saveButton.onclick = () => quit(true);
    quitButton = root.document.createElement('button'); quitButton.textContent = 'Quit Without Saving'; quitButton.onclick = () => quit(false);
    cancelButton = root.document.createElement('button'); cancelButton.textContent = 'Cancel'; cancelButton.onclick = cancel;
    panel.append(title, status, slots, label, saveButton, quitButton, cancelButton); root.document.body.appendChild(panel);
    panel.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    for (const name of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'wheel']) panel.addEventListener(name, event => event.stopPropagation());
    const style = root.document.createElement('style'); style.textContent = '#quit-game-dialog{width:min(550px,88vw);max-height:85vh;box-sizing:border-box;overflow:auto;background:#171510;color:#ead5a6;border:2px solid #9b8556;border-radius:10px;padding:24px;font:18px Georgia,serif}#quit-game-dialog::backdrop{background:#000a}#quit-game-dialog h2{margin:0 0 15px}#quit-game-dialog p{line-height:1.5}#quit-game-dialog select,#quit-game-dialog input{display:block;width:100%;box-sizing:border-box;margin:10px 0}#quit-game-dialog button,#quit-game-dialog input,#quit-game-dialog select{font:inherit;padding:9px;background:#33312b;color:#f5e4bb;border:1px solid #89764e;border-radius:4px}#quit-game-dialog button{margin:12px 8px 0 0;cursor:pointer}#quit-game-dialog button:disabled{opacity:.4;cursor:default}'; root.document.head.appendChild(style);
  }
  root.GameQuitUi = { open };
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init();
})(window);
