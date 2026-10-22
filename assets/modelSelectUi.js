// Startup picker: Grok, OpenAI, Groq, then local; Luna is the new-game default.
// Keys are entered through a masked prompt and stored only in the ignored server-side keys folder.
(function(root) {
  'use strict';
  const KEY = 'holodek.gameModel', GROUPS = [['xai', 'Grok (xAI)'], ['openai', 'OpenAI'], ['groq', 'Groq · Open-weight models'], ['local', 'Local (this PC)']];
  let dlg, list, status, go, data;
  const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) if (k) e.append(k); return e; };
  function style() {
    if (document.getElementById('model-select-style')) return;
    document.head.append(el('style', { id: 'model-select-style', textContent: `
#model-select-screen { box-sizing: border-box; width: min(640px, calc(100vw / var(--game-ui-scale, 1) - 24px)); max-height: calc(100vh / var(--game-ui-scale, 1) - 32px);
  padding: 0; border: 2px solid #ccc; background: #000; color: #eee; font: inherit; overflow: hidden; }
#model-select-screen[open] { display: flex; flex-direction: column; }
#model-select-screen::backdrop { background: rgba(0,0,0,.75); }
#model-select-screen .ms-head { padding: 10px 14px; border-bottom: 1px solid #444; }
#model-select-screen .ms-body { flex: 1; min-height: 0; overflow: auto; padding: 6px 14px; }
#model-select-screen .ms-foot { padding: 10px 14px; border-top: 1px solid #444; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
#model-select-screen fieldset { border: 0; margin: 6px 0; padding: 0; }
#model-select-screen legend { color: #aaa; margin-bottom: 4px; }
#model-select-screen label { display: block; padding: 5px 6px; cursor: pointer; border: 1px solid transparent; }
#model-select-screen label:focus-within, #model-select-screen label:hover { border-color: #888; }
#model-select-screen .ms-note { display: block; color: #aaa; font-size: .85em; margin-left: 1.6em; }
#model-select-screen .ms-hint { color: #aaa; font-size: .85em; margin: 4px 0; }` }));
  }
  // Masked key prompt for a provider with no key; resolves true once saved. Shared with the Game Model menu.
  function askKey(provider, host = document.body, { persistOnly = false } = {}) {
    return new Promise(resolve => {
      const name = provider === 'groq' ? 'Groq' : provider === 'xai' ? 'xAI' : 'OpenAI', d = el('dialog', { id: 'provider-key-prompt' });
      const inp = el('input', { type: 'password', autocomplete: 'off', id: 'provider-key-input', placeholder: name + ' API key' }), msg = el('p', { className: 'ms-hint', role: 'status' });
      const ok = el('button', { className: 'popup-button', textContent: 'Save key', type: 'button' }), no = el('button', { className: 'popup-button', textContent: 'Cancel', type: 'button' });
      d.append(el('p', { textContent: (persistOnly ? name + ' is available for this session, but its key is not stored locally. Enter it once to remember it. The current environment key keeps priority. ' : name + ' needs an API key. ') + 'It is saved locally in keys/' + provider + '.key, outside Git, and loads automatically next time. It is not kept in browser storage or saved on the website.' }), inp, el('div', { className: 'ms-foot' }, [ok, no, msg]));
      const done = v => { inp.value = ''; d.close(); d.remove(); resolve(v); };
      ok.addEventListener('click', async () => { if(ok.disabled)return; ok.disabled=true; msg.textContent = 'Saving...';
        try { const r = await fetch('/provider-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, key: inp.value, persistOnly }) }); const v = await r.json(); inp.value = '';
          if (!r.ok) throw Error(v.error || 'Could not save the key.'); done(true); } catch (e) { msg.textContent = e.message; ok.disabled=false; } });
      no.addEventListener('click', () => done(false));
      d.addEventListener('cancel', e => { e.preventDefault(); done(false); });
      d.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
      style(); host.append(d); d.showModal(); inp.focus();
    });
  }
  const rowsOf = () => data.all || data.models.map(m => ({ ...m, status: 'ready' }));
  const label = m => m.name + (m.status && m.status !== 'ready' ? ' (' + m.status + ')' : '');
  function render() {
    list.replaceChildren();
    const all = rowsOf().filter(m=>m.id!=='holodek-1'), ids = all.map(m => m.id);
    // New games start with Luna selected; in-game provider selection remains independent.
    const pick = ids.includes('gpt-6-luna') ? 'gpt-6-luna' : null;
    for (const [g, title] of GROUPS) {
      const rows = all.filter(m => (m.provider || 'openai') === g), fs = el('fieldset', {}, el('legend', { textContent: title }));
      for (const m of rows) { const r = el('input', { type: 'radio', name: 'ms-model', value: m.id, checked: m.id === pick });
        fs.append(el('label', {}, [r, ' ' + label(m), el('span', { className: 'ms-note', textContent: m.note || '' })])); }
      list.append(fs);
    }
    for (const t of [data.startupNote, data.localWarning, data.warning]) if (t) list.append(el('p', { className: 'ms-hint', textContent: t }));
    go.disabled = false; (list.querySelector('input:checked') || go).focus();
  }
  async function choose() {
    const id = list.querySelector('input:checked')?.value; if (!id) return close();
    const row = rowsOf().find(m => m.id === id);
    if (row?.status === 'needs key' || row?.provider !== 'local' && data.storedKeys?.[row?.provider || 'openai'] === false) {
      if (!(await askKey(row.provider || 'openai', dlg, { persistOnly:data.keys?.[row.provider || 'openai']==='env' }))) {
        status.textContent = 'No local key saved; choose another model or try again.'; return;
      }
      data = await (await fetch('/game-models?refresh=1', { cache: 'no-store' })).json(); }
    go.disabled = true; status.textContent = 'Applying...';
    try {
      if (id !== data.current.id) { const r = await fetch('/game-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, revision: data.current.revision }) });
        const v = await r.json(); if (!r.ok) throw Error(v.error || 'Could not select that model.'); data.current = v.current; }
      root.localStorage?.setItem(KEY, id); close();
    } catch (e) { status.textContent = e.message; go.disabled = false; }
  }
  function close() { if (dlg?.open) dlg.close(); root._modelSelectPending = false; document.getElementById('open-game-model-button') && root.dispatchEvent(new CustomEvent('holodek:model-chosen', { detail: data?.current })); }
  async function open() {
    style(); root._modelSelectPending = true;
    dlg = el('dialog', { id: 'model-select-screen' }); dlg.setAttribute('aria-labelledby', 'ms-title');
    list = el('div', { className: 'ms-body' }); status = el('span', { id: 'model-select-status', role: 'status' });
    go = el('button', { id: 'model-select-continue', className: 'popup-button', textContent: 'Continue', disabled: true });
    dlg.append(el('div', { className: 'ms-head' }, [el('strong', { id: 'ms-title', textContent: 'Choose the Grave Master model' }), el('div', { className: 'ms-hint', textContent: 'You can change this later in Menu > Game Model.' })]), list,
      el('div', { className: 'ms-foot' }, [go, status]));
    go.addEventListener('click', choose);
    dlg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); choose(); } });
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }); // Escape keeps the current model
    document.body.append(dlg); dlg.showModal(); list.textContent = 'Checking available models...';
    try { const r = await fetch('/game-models', { cache: 'no-store' }); data = await r.json(); render(); }
    catch { list.textContent = 'Could not load the model list; the current server model will be used.'; go.disabled = false; data = null; go.onclick = close; }
  }
  root.ModelSelectUi = { open, close, askKey };
  if (!/[?&]nomodelselect\b/.test(root.location?.search || '')) document.addEventListener('DOMContentLoaded', open, { once: true });
})(window);
