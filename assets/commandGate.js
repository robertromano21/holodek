(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.GameCommandGate = api; document.addEventListener('DOMContentLoaded', api.init); }
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  let submitting = false, pending = false, installed = false, waiting = 0;
  const nativeTasks = new Set();
  const disabled = new Map();
  const busy = () => pending || waiting > 0 || !!root._characterStartupPending;
  const route = url => String(url || '').split('?')[0];
  // Drain complete native interactions before the legacy command parser captures its snapshot.
  function trackNative(work) {
    const task = Promise.resolve(work());
    nativeTasks.add(task);
    const done = () => nativeTasks.delete(task);
    task.then(done, done);
    return task;
  }
  function scope() { return { run: root.dungeonRunId, room: root.currentDungeon?.geoKey, floor: root.CityFloorScope?.token() }; }
  function assertReady(origin) {
    const current = scope();
    if (current.run !== origin.run || current.room !== origin.room || current.floor !== origin.floor)
      throw Error('The room or game changed. Choose the action again in the current room.');
    if (root.gamePaused || root.actionDiceState?.active || root._combatCommandPending || root._combatRoundActiveUntil > Date.now() ||
        root._gameOver || root._playerUnconscious || root._deathSceneActive || root._characterStartupPending)
      throw Error('Finish the current action or resume the game before continuing.');
  }
  async function waitForIdle({ includeCommands = false, maxWaitMs = 120000 } = {}) {
    const origin = scope(), start = Date.now();
    waiting++; refresh();
    try {
      while (true) {
        assertReady(origin);
        if (!nativeTasks.size && (!includeCommands || !pending)) return;
        if (Date.now() - start >= maxWaitMs) throw Error('The current interaction is still loading. Your action was not sent; please try again.');
        await new Promise(resolve => (root.setTimeout || setTimeout)(resolve, 75));
      }
    } finally { waiting--; refresh(); }
  }
  function refresh() {
    if (typeof document === 'undefined' || !document.body) return;
    const gearReady = root.CombatTurnUi?.canChangeEquipment?.() && /^(?:equip|unequip)\s+/i.test(document.getElementById?.('chatuserinput')?.value || '');
    const loading = busy() && !gearReady;
    document.body.classList.toggle('game-command-loading', loading);
    const status = document.getElementById?.('command-interaction-wait');
    if (status) status.hidden = !waiting;
    document.body.classList.toggle('game-combat-targeting', root.actionDiceState?.active?.kind === 'combat');
    for (const button of document.querySelectorAll('#chatbotcontainer button')) {
      if (button.hasAttribute?.('data-read-only-reference')) continue;
      if (loading) {
        if (!disabled.has(button)) {
          disabled.set(button, button.disabled); button.setAttribute('aria-busy', 'true');
        }
        if (!button.disabled) button.disabled = true;
      }
    }
    if (!loading) {
      for (const [button, original] of disabled) { button.disabled = original; button.removeAttribute('aria-busy'); }
      disabled.clear();
    }
  }
  function transportStarted(url) {
    if (route(url) === '/processInput7') { pending = true; refresh(); }
  }
  function begin() { pending = true; refresh(); }
  function end() { pending = false; refresh(); }
  function transportFinished(url, response, failed = false) {
    const path = route(url);
    if ((path === '/processInput7' && (failed || response?.completedStartResult)) ||
        /^\/poll-task2\//.test(path) && (failed || ['complete', 'error'].includes(response?.status))) {
      pending = false; refresh();
    }
  }
  function wrap(submit) {
    return async function(input) {
      const command = typeof document === 'object' ? document.getElementById?.('chatuserinput')?.value?.trim() : '';
      if (!input?.completedStartResult && root.actionDiceState?.active?.kind === 'combat' && /^(?:equip|unequip)\s+/i.test(command) && root.CombatTurnUi?.handleEquipmentCommand) {
        return root.CombatTurnUi.handleEquipmentCommand(command);
      }
      if ((submitting || busy() && !nativeTasks.size) && !input?.completedStartResult) return;
      if (input?.completedStartResult) return submit.apply(this, arguments);
      submitting = true; refresh();
      try {
        if (nativeTasks.size) {
          const field = typeof document === 'object' ? document.getElementById?.('chatuserinput') : null;
          const draft = field?.value;
          try {
            await waitForIdle({ includeCommands: true });
            if (field?.value !== draft) throw Error('The command changed while waiting. Submit the current command when ready.');
          } catch (error) {
            root.DungeonActionNotices?.receive?.({ id: 'command-wait:' + Date.now(), runId: root.dungeonRunId,
              geoKey: root.currentDungeon?.geoKey, kind: 'action', title: 'Command Not Sent', message: error.message });
            return false;
          }
        }
        return await submit.apply(this, arguments);
      }
      finally { submitting = false; refresh(); }
    };
  }
  function init() {
    if (installed) return; installed = true;
    // Guard the public command entry, leaving its delicate parser and state pipeline untouched.
    if (typeof root.chatbotprocessinput === 'function') root.chatbotprocessinput = wrap(root.chatbotprocessinput);
    document.addEventListener('click', event => {
      if (root.CombatCharacterUi?.openConsoleTarget?.(event.target)) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (event.target.closest?.('[data-read-only-reference]')) return;
      if (root.CombatTurnUi?.canChangeEquipment?.() && event.target.closest?.('#phaser-container .clickable-inventory, #phaser-container .clickable-equipped')) return;
      if (root.CombatTurnUi?.canChangeEquipment?.() && /^(?:equip|unequip)\s+/i.test(document.getElementById?.('chatuserinput')?.value || '') && event.target.closest?.('#chatbotcontainer button')) return;
      if (!busy() || nativeTasks.size && !waiting && !submitting || !event.target.closest?.('#phaser-container a, #phaser-container [class*="clickable-"], #chatbotcontainer button')) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    const style = document.createElement('style');
    style.textContent = '.game-command-loading #chatbotcontainer button:not([data-read-only-reference]){opacity:.5;cursor:wait}.game-command-loading #phaser-container [class*="clickable-"]{cursor:wait;text-decoration:none;opacity:.65}.game-combat-targeting #phaser-container :is(.clickable-pc,.clickable-npc,.clickable-monster){cursor:pointer;text-decoration:underline;opacity:1}';
    document.head.appendChild(style);
    const status = document.createElement('div'); status.id = 'command-interaction-wait'; status.hidden = true;
    status.setAttribute('role', 'status'); status.textContent = 'Finishing the current interaction...';
    status.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:18000;padding:8px 14px;background:#171612;color:#ead7a2;border:1px solid #ad925b';
    document.body.appendChild(status);
    if (root.jQuery) root.jQuery(document)
      .on('ajaxSend.commandGate', (_event, _xhr, settings) => transportStarted(settings.url))
      .on('ajaxSuccess.commandGate', (_event, _xhr, settings, response) => transportFinished(settings.url, response))
      .on('ajaxError.commandGate', (_event, _xhr, settings) => transportFinished(settings.url, null, true));
    setInterval(refresh, 100); refresh();
  }
  return { busy, begin, end, wrap, trackNative, waitForIdle, isSubmitting: () => submitting,
    waitingNative: () => waiting > 0, transportStarted, transportFinished, init };
});
