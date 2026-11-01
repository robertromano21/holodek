(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResourceLabelUi = api;
})(typeof window === 'object' ? window : globalThis, function(root) {
  'use strict';
  // Display only. The engine and saved JSON continue to use their canonical Magic/magic keys.
  function relabelText(value, label = 'Magic') {
    const name = String(label || 'Magic');
    if (name === 'Magic') return String(value);
    return String(value).replace(/\bMagic(?=\s*:)/g, () => name)
      .replace(/(["'])magic\1(?=\s*:)/gi, (_match, quote) => quote + name + quote);
  }
  let label = root.HolodekFlags?.RESOURCE_NAME || 'Magic';
  const Money=typeof module==='object'&&module.exports?require('./currencyLanguage'):root.CurrencyLanguage;
  let currency=root.HolodekFlags?.CURRENCY||Money?.forWorld(null);
  const originals = new WeakMap();
  const selector = '.character-table, #party-popup, .party-icons, #party-roster, .combat-character-card, #phaser-container, #review-character-details, #inventory-silver, #game-console, #game-log, .popup-container';
  const excluded = '#chatuserinput, textarea, input, #campaign-builder, script, style';
  function relabel(node) {
    if (!node) return;
    const walker = root.document.createTreeWalker(node, root.NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      if (t.parentElement?.closest(excluded)) continue;
      const old = originals.get(t);
      const source = old && t.nodeValue === old.rendered ? old.source : t.nodeValue;
      const rendered = Money?.relabelText(relabelText(source, label),currency)||relabelText(source,label);
      if (rendered !== source || old) originals.set(t, { source, rendered });
      if (t.nodeValue !== rendered) t.nodeValue = rendered;
    }
  }
  const targets = () => [...root.document.querySelectorAll(selector)];
  async function refresh() {
    try {
      const f = await (await root.fetch('/world1-flags')).json();
      if (f.RESOURCE_NAME && f.RESOURCE_NAME !== label) { label = f.RESOURCE_NAME; targets().forEach(relabel); }
      if(f.CURRENCY&&JSON.stringify(f.CURRENCY)!==JSON.stringify(currency)){currency=f.CURRENCY;targets().forEach(relabel);}
      root.HolodekFlags ||= {};
      root.HolodekFlags.RESOURCE_NAME = label; root.HolodekFlags.GM_NAME = f.GM_NAME;
      root.HolodekFlags.CURRENCY=currency;
    } catch { /* Keep the last verified display label during reconnects. */ }
    if (root.HolodekFlags?.RANGED_COMBAT) try {
      const r = await (await root.fetch('/ranged/readouts')).json();
      if (r.rows?.length) root.RangedFx?.readout(r.rows[0].name, r.rows.map(x => x.text).join(' | '));
    } catch { /* Ammo readouts do not prevent resource labels from updating. */ }
  }
  function start() {
    const obs = new root.MutationObserver(ms => {
      for (const m of ms) {
        const node = m.target.nodeType === 3 ? m.target.parentNode : m.target;
        if (node?.matches?.(selector) || node?.closest?.(selector)) relabel(node);
        else for (const added of m.addedNodes || []) {
          if (added.nodeType === 1) { if (added.matches?.(selector)) relabel(added); added.querySelectorAll?.(selector).forEach(relabel); }
        }
      }
    });
    obs.observe(root.document.body, { subtree: true, childList: true, characterData: true });
    targets().forEach(relabel); refresh(); root.setInterval(refresh, 5000);
  }
  if (root.document && (root.HolodekFlags?.HOMEBREW || root.HolodekFlags?.RANGED_COMBAT)) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
  return { label: () => label, relabelText, relabel, refresh };
});
