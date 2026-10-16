(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.GameCommandGate = api; document.addEventListener('DOMContentLoaded', api.init); }
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  let submitting = false, pending = false, installed = false;
  const disabled = new Map();
  const busy = () => pending || !!root._characterStartupPending;
  const route = url => String(url || '').split('?')[0];
  function refresh() {
    if (typeof document === 'undefined' || !document.body) return;
    const loading = busy();
    document.body.classList.toggle('game-command-loading', loading);
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
      if ((submitting || busy()) && !input?.completedStartResult) return;
      if (input?.completedStartResult) return submit.apply(this, arguments);
      submitting = true; refresh();
      try { return await submit.apply(this, arguments); }
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
      if (!busy() || !event.target.closest?.('#phaser-container a, #phaser-container [class*="clickable-"], #chatbotcontainer button')) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    const style = document.createElement('style');
    style.textContent = '.game-command-loading #chatbotcontainer button:not([data-read-only-reference]){opacity:.5;cursor:wait}.game-command-loading #phaser-container [class*="clickable-"]{cursor:wait;text-decoration:none;opacity:.65}.game-combat-targeting #phaser-container :is(.clickable-pc,.clickable-npc,.clickable-monster){cursor:pointer;text-decoration:underline;opacity:1}';
    document.head.appendChild(style);
    if (root.jQuery) root.jQuery(document)
      .on('ajaxSend.commandGate', (_event, _xhr, settings) => transportStarted(settings.url))
      .on('ajaxSuccess.commandGate', (_event, _xhr, settings, response) => transportFinished(settings.url, response))
      .on('ajaxError.commandGate', (_event, _xhr, settings) => transportFinished(settings.url, null, true));
    setInterval(refresh, 100); refresh();
  }
  return { busy, begin, end, wrap, transportStarted, transportFinished, init };
});
