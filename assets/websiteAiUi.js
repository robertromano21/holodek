(function(root) {
  'use strict';
  let panel, status, form, key, busy = false;
  const fields = {};
  const el = (tag, values = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), values);
    for (const child of children) node.append(child); return node;
  };
  async function request(url, body) {
    const response = await root.fetch(url, { cache: 'no-store', ...(body ? { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(url === '/website-ai/connect' ? 480000 : 100000) });
    const value = await response.json(); if (!response.ok) throw Error(value.error || 'Website AI is unavailable.'); return value;
  }
  function render(value) {
    for (const [name, input] of Object.entries(fields)) {
      if (input.type === 'checkbox') input.checked = !!value[name]; else input.value = value[name] ?? '';
    }
    const worker = value.worker;
    status.textContent = value.connected ? 'Connected: ' + worker.cpus + ' CPUs, ' + worker.memoryGB + ' GB RAM. Worker ports ' + (worker.pool?.map(node => node.port).join(', ') || worker.port) +
      (value.remoteBuild ? '. Full room engine: ' + (worker.roomWorkers || 0) + ' web workers' : '') +
      '. holodek-1: ' + (worker.models?.some(m => /^holodek-1(?::latest)?$/.test(m.name)) ? 'installed.' : 'not installed on website.') :
      value.enabled ? 'Saved; connection has not been verified in this server session.' : 'Website AI is off. Your game model is unchanged.';
  }
  async function action(work) {
    if (busy) return; busy = true; panel.setAttribute('aria-busy', 'true');
    for (const button of form.querySelectorAll('button')) button.disabled = true;
    try { await work(); } catch (e) { status.textContent = e.name === 'TimeoutError' ? 'Connection timed out. Check status before retrying installation.' : e.message; }
    finally { busy = false; panel.setAttribute('aria-busy', 'false'); for (const button of form.querySelectorAll('button')) button.disabled = false; }
  }
  function build() {
    document.head.append(el('style', { textContent: `
#website-ai-popup{box-sizing:border-box;width:min(600px,calc(100vw / var(--game-ui-scale,1) - 24px));max-height:calc(100vh / var(--game-ui-scale,1) - 32px);padding:0;border:2px solid #ccc;background:#000;color:#eee;font:inherit}
#website-ai-popup::backdrop{background:#000b}#website-ai-popup form{padding:14px;overflow:auto}#website-ai-popup p{line-height:1.5}
#website-ai-popup label{display:block;margin:10px 0;color:#e5bd72}#website-ai-popup input:not([type=checkbox]),#website-ai-popup textarea{box-sizing:border-box;display:block;width:100%;margin-top:5px;font:inherit;font-size:.85em}
#website-ai-popup textarea{min-height:90px;overflow-wrap:anywhere}#website-ai-popup .wai-actions{display:flex;flex-wrap:wrap;gap:8px}#website-ai-popup button{font:inherit}` }));
    panel = el('dialog', { id: 'website-ai-popup' }); panel.setAttribute('aria-labelledby', 'website-ai-title');
    const close = el('button', { type: 'button', textContent: 'X', ariaLabel: 'Close Website AI settings' });
    close.addEventListener('click', () => panel.close());
    panel.append(el('div', { className: 'inventory-header' }, [el('span', { id: 'website-ai-title', textContent: 'Website AI' }), close]));
    form = el('form'); form.addEventListener('submit', event => event.preventDefault());
    form.append(el('p', { textContent: 'Three private website workers can build geometry, textures, procedural art and music while the PC runs the game. Independent stages overlap after their room facts are established. Adjacent rooms are built only after their parent is visited. The PC retains authoritative game state and the renderer. API calls still incur charges; extra ports do not speed up an individual model response. Settings stay on this PC, outside Git.' }));
    for (const [name, label, type, placeholder] of [
      ['host', 'Insert website IP address or hostname', 'text', 'Your server address'],
      ['sshPort', 'SSH port', 'number', '22'], ['username', 'Non-root SSH account', 'text', 'holodek-agent'],
      ['fingerprint', 'Verified SSH host fingerprint', 'text', 'SHA256:...'],
      ['enabled', ' Enable Website AI', 'checkbox', ''], ['background', ' Prepare complete adjacent rooms after room load', 'checkbox', ''],
      ['remoteBuild', ' Offload room construction to three website workers', 'checkbox', ''],
      ['useForGameModels', ' Use website worker for current-room generation (same selected model)', 'checkbox', '']]) {
      const input = el('input', { type, placeholder, autocomplete: 'off', spellcheck: false }); fields[name] = input;
      if (type === 'number') { input.min = '1'; input.max = '65535'; }
      form.append(el('label', {}, type === 'checkbox' ? [input, label] : [label, input]));
    }
    const keyButton = el('button', { type: 'button', className: 'popup-button', textContent: 'Show / Create SSH Public Key' });
    key = el('textarea', { readOnly: true, hidden: true, ariaLabel: 'Public SSH key to install on website' });
    keyButton.addEventListener('click', () => action(async () => { key.value = (await request('/website-ai/key', {})).publicKey; key.hidden = false;
      status.textContent = 'Install this PUBLIC key for the non-root SSH account. Never paste a private key or root password here. Setup: docs/website-ai.md.'; }));
    const connect = el('button', { type: 'button', className: 'popup-button', textContent: 'Install / Connect Worker' });
    connect.addEventListener('click', () => action(async () => {
      status.textContent = 'Verifying SSH and this account\'s worker. Existing website services are not stopped.';
      const value = Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.type === 'checkbox' ? input.checked : name === 'sshPort' ? Number(input.value) : input.value]));
      render(await request('/website-ai/connect', { ...value, deploy: true }));
      root.dispatchEvent(new CustomEvent('holodek:website-ai-changed'));
    }));
    const check = el('button', { type: 'button', className: 'popup-button', textContent: 'Check Status' });
    check.addEventListener('click', () => action(async () => render(await request('/website-ai/status', {}))));
    const off = el('button', { type: 'button', className: 'popup-button', textContent: 'Disable' });
    off.addEventListener('click', () => action(async () => { render(await request('/website-ai/disconnect', {})); root.dispatchEvent(new CustomEvent('holodek:website-ai-changed')); }));
    status = el('p', { role: 'status', ariaLive: 'polite' });
    form.append(keyButton, key, el('p', { textContent: 'Provider keys use your existing PC environment / keys folder. They travel through verified SSH for each job and are never stored by the website worker. Installing holodek-1 additionally requires its own GGUF model file.' }),
      el('div', { className: 'wai-actions' }, [connect, check, off]), status);
    panel.append(form); document.body.append(panel);
    panel.addEventListener('keydown', event => event.stopPropagation());
  }
  async function open() {
    if (!panel) build(); root.GameMenuUi?.setOpen(false); if (!panel.open) panel.showModal();
    await action(async () => render(await request('/website-ai')));
  }
  root.WebsiteAiUi = { open };
  document.addEventListener('DOMContentLoaded', () => document.getElementById('open-website-ai-button')?.addEventListener('click', open), { once: true });
})(window);
