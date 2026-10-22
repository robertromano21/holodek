(function(root) {
  'use strict';
  // world1 HOMEBREW/RANGED_COMBAT: display-only. The engine keeps the sheet line 'Magic:'; the HUD shows the world's
  // resource name (Magic / Tech / Luck / bible override; Children of the Grave always Magic) and a separate ammo line.
  if (!root.HolodekFlags?.HOMEBREW && !root.HolodekFlags?.RANGED_COMBAT) return;
  let label = root.HolodekFlags?.RESOURCE_NAME || 'Magic';
  const relabel = node => { const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let t;
    while ((t = w.nextNode())) { if (label !== 'Magic' && /\bMagic:/.test(t.nodeValue) && !t.parentElement?.closest('#chatuserinput, textarea, #campaign-builder')) t.nodeValue = t.nodeValue.replace(/\bMagic:/g, label + ':'); } };
  const targets = () => [...document.querySelectorAll('.character-table, #party-popup, .party-icons, #party-roster, .combat-character-card')];
  const obs = new MutationObserver(ms => { if (label === 'Magic') return; for (const m of ms) relabel(m.target.nodeType === 3 ? m.target.parentNode : m.target); });
  async function refresh() { try { const f = await (await fetch('/world1-flags')).json(); if (f.RESOURCE_NAME && f.RESOURCE_NAME !== label) { label = f.RESOURCE_NAME; targets().forEach(relabel); } root.HolodekFlags.GM_NAME = f.GM_NAME; } catch {}
    if (root.HolodekFlags?.RANGED_COMBAT) try { const r = await (await fetch('/ranged/readouts')).json(); if (r.rows?.length) root.RangedFx?.readout(r.rows[0].name, r.rows.map(x => x.text).join(' | ')); } catch {} }
  const start = () => { obs.observe(document.body, { subtree: true, childList: true, characterData: true }); targets().forEach(relabel); refresh(); setInterval(refresh, 5000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  root.ResourceLabelUi = { label: () => label, refresh };
})(typeof window === 'object' ? window : globalThis);
