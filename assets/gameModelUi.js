(function(root) {
  'use strict';
  let panel, select, status, apply, refresh, details, data, serial = 0, busy = false, controller;
  function describe() {
    const row = (data?.all || data?.models || []).find(row => row.id === select.value);
    details.textContent = row ? (row.status && row.status !== 'ready' ? '[' + row.status + '] ' : '') + (row.note ? row.note + '. ' : '') + row.description + (row.id === 'groq-gpt-oss-120b' || row.id === 'gpt-oss-20b' || row.id === 'holodek-1' ? '. Reasoning low.' : '. Reasoning off.') + (row.shutdownDate ? ' Scheduled retirement: ' + row.shutdownDate + '.' : '') :
      'Restores the original per-task models (primarily GPT-4.1 Mini and GPT-4o Mini).';
    apply.disabled = busy || !data || select.value === data.current.id;
  }
  function setBusy(value) {
    busy = value; panel.setAttribute('aria-busy', String(value)); select.disabled = value;
    refresh.disabled = value; describe();
  }
  function render(value) {
    data = value; select.replaceChildren();
    const add = (id, name, disabled = false) => {
      const option = document.createElement('option'); option.value = id; option.textContent = name; option.disabled = disabled; select.appendChild(option);
    };
    add('original', 'Original settings (restore)');
    const order = { local: 0, groq: 1, xai: 2, openai: 3 }, group = { local: 'Local', openai: 'OpenAI', xai: 'xAI', groq: 'Groq' };
    const all = [...(data.all || data.models)].sort((a, b) => (order[a.provider || 'openai'] ?? 3) - (order[b.provider || 'openai'] ?? 3)); // Local, xAI, OpenAI
    for (const row of all) add(row.id, (group[row.provider] ? group[row.provider] + ': ' : '') + row.name + (row.status && row.status !== 'ready' ? ' (' + row.status + ')' : '') + (row.shutdownDate ? ' (retiring ' + row.shutdownDate + ')' : ''));
    if (data.current.id !== 'original' && !all.some(row => row.id === data.current.id)) add(data.current.id, data.current.name + ' (access not verified)', true);
    select.value = data.current.id;
    document.getElementById('open-game-model-button').textContent = 'Game Model: ' + data.current.name;
    status.textContent = data.warning || 'Current: ' + data.current.name + ((data.current.id === 'gpt-oss-20b' || data.current.id === 'holodek-1' || data.current.id === 'groq-gpt-oss-120b') ? '. Reasoning low.' : '. Reasoning off.') + (data.startupNote && data.current.revision <= 1 ? ' ' + data.startupNote : '') + (data.localWarning ? ' ' + data.localWarning : '');
    describe();
  }
  async function request(url, options) {
    controller?.abort(); const local = controller = new AbortController();
    const timer = setTimeout(() => local.abort(), 20000);
    try {
      const response = await root.fetch(url, { ...options, signal: local.signal, cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || 'Game model settings are unavailable.');
      return value;
    } finally { clearTimeout(timer); }
  }
  async function load(recheck = false) {
    const token = ++serial; setBusy(true); status.textContent = 'Checking available models...';
    try {
      const value = await request('/game-models' + (recheck ? '?refresh=1' : ''), {});
      if (token === serial && panel.open) render(value);
    } catch (error) { if (token === serial && panel.open) status.textContent = error.name === 'AbortError' ? 'The model check timed out. Try Refresh.' : error.message; }
    finally { if (token === serial) setBusy(false); }
  }
  async function save() {
    if (busy || !data || apply.disabled) return;
    const row = (data.all || []).find(r => r.id === select.value);
    if (row?.status === 'needs key') { // masked key prompt, then select
      if (!root.ModelSelectUi?.askKey || !(await root.ModelSelectUi.askKey(row.provider, panel))) { status.textContent = 'No key saved; the current model is unchanged.'; return; }
      const id = select.value; await load(true); select.value = id; }
    const token = ++serial; setBusy(true); status.textContent = 'Applying model for the next action...';
    try {
      const value = await request('/game-models', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: select.value, revision: data.current.revision }) });
      if (token !== serial || !panel.open) return;
      render({ ...data, current: value.current });
      status.textContent = value.current.name + ' selected. Your next action uses this setting; any action already running keeps its previous model.';
    } catch (error) {
      if (token === serial && panel.open) { select.value = data.current.id; status.textContent = error.name === 'AbortError' ?
        'Confirmation timed out. Refresh to check the server setting before changing it again.' : error.message; }
    } finally { if (token === serial) setBusy(false); }
  }
  function open() {
    if (!panel) return;
    root.GameMenuUi?.setOpen(false);
    if (!panel.open) panel.showModal();
    document.getElementById('open-game-model-button').setAttribute('aria-expanded', 'true');
    load();
  }
  function close() { controller?.abort(); serial++; if (panel.open) panel.close(); }
  function init() {
    panel = document.getElementById('game-model-popup');
    const button = document.getElementById('open-game-model-button');
    if (!panel || !button) return;
    select = document.getElementById('game-model-select'); status = document.getElementById('game-model-status');
    details = document.getElementById('game-model-details'); apply = document.getElementById('game-model-apply'); refresh = document.getElementById('game-model-refresh');
    button.addEventListener('click', open); select.addEventListener('change', describe);
    apply.addEventListener('click', save); refresh.addEventListener('click', () => load(true));
    document.getElementById('game-model-close').addEventListener('click', close);
    panel.addEventListener('cancel', event => { event.preventDefault(); close(); });
    panel.addEventListener('close', () => { button.setAttribute('aria-expanded', 'false'); document.getElementById('game-menu-toggle')?.focus(); });
    panel.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } });
  }
  root.GameModelUi = { open, close };
  document.addEventListener('DOMContentLoaded', init, { once: true });
})(window);
