(function(root) {
  'use strict';
  let panel = null, serial = 0, refreshTimer = null, selected = null, preparing = false, message = '';
  const preparationBlocked = () => preparing || root.gamePaused || root.actionDiceState?.active || root.GameCommandGate?.busy() || root._combatCommandPending || root._characterStartupPending;
  function close() { serial++; panel?.remove(); panel = null; document.getElementById('dungeon-spellbook-shortcut')?.setAttribute('aria-expanded', 'false'); }
  function position() {
    if (!panel) return;
    const z = panel.offsetWidth ? panel.getBoundingClientRect().width / panel.offsetWidth : 1;
    Object.assign(panel.style, { width: Math.min(720, root.innerWidth / z - 24) + 'px', maxHeight: (root.innerHeight / z - 24) + 'px',
      left: root.innerWidth / z / 2 + 'px', top: root.innerHeight / z / 2 + 'px' });
  }
  function render(data, content) {
    content.replaceChildren();
    const guide = document.createElement('p'); guide.textContent = 'Numbers show casts affordable now from prepared class spells or equipped items. Spells share their source\'s Magic: casting one reduces the others\' counts. (0) means unavailable. Level headings use this game\'s spell unlock levels, not full tabletop spell slots.';
    content.appendChild(guide);
    if (message) { const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = message; content.appendChild(status); }
    if (!data.casters.length) { content.textContent = 'No party members currently have class spells or equipped item spells.'; return; }
    if (!data.casters.some(c => c.name === selected)) selected = data.casters[0].name;
    const tabs = document.createElement('div'); tabs.className = 'party-spellbook-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Party characters');
    const entries = root.getPartyInfoEntries?.() || [];
    data.casters.forEach((caster, i) => {
      const tab = document.createElement('button'), icon = document.createElement('canvas'), label = document.createElement('span');
      icon.width = icon.height = 36; icon.setAttribute('aria-hidden', 'true'); label.textContent = caster.name;
      tab.type = 'button'; tab.id = 'spellbook-tab-' + i; tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(caster.name === selected)); tab.setAttribute('aria-controls', 'spellbook-character-page');
      tab.tabIndex = caster.name === selected ? 0 : -1;
      tab.append(icon, label);
      const entry = entries.find(e => e.label === caster.name) || { label: caster.name, source: (root.combatCharacters || []).find(a => a.name === caster.name) || { name: caster.name, type: caster.type } };
      root.drawPartySpriteCanvas?.(icon, entry);
      tab.addEventListener('click', () => { selected = caster.name; render(data, content); document.getElementById('spellbook-tab-' + i)?.focus(); });
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const n = event.key === 'Home' ? 0 : event.key === 'End' ? data.casters.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : data.casters.length - 1)) % data.casters.length;
        selected = data.casters[n].name; render(data, content); document.getElementById('spellbook-tab-' + n)?.focus();
      });
      tabs.appendChild(tab);
    });
    content.appendChild(tabs);
    const caster = data.casters.find(c => c.name === selected);
    {
      const section = document.createElement('section'), title = document.createElement('h3'), info = document.createElement('p');
      section.id = 'spellbook-character-page'; section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', 'spellbook-tab-' + data.casters.indexOf(caster));
      title.textContent = `${caster.name} - ${root.PartyRoster.displaySheet(caster.className)}${caster.hp <= 0 ? ' (dead)' : ''}`;
      info.textContent = `Level ${caster.level}; casting level ${caster.castingLevel}. Class Magic ${caster.magic}/${caster.capacity}; ${caster.slots} preparation slots.` +
        (caster.rechargeEvery ? ` Recharges ${caster.rechargeAmount} Magic every ${caster.rechargeEvery} turns.` : '') +
        (caster.bookRequired && !caster.bookPresent ? ' Spellbook missing: class casting is unavailable.' : '') +
        (!caster.initialized && caster.rechargeEvery ? ' Class records have not yet been initialized.' : '');
      section.append(title, info);
      const sources = new Map(caster.groups.flatMap(g => g.spells).filter(s => !s.classSource).map(s => [s.source, s]));
      if (sources.size) {
        const items = document.createElement('h4'); items.textContent = 'Equipped Item Magic (Separate Pools)'; section.appendChild(items);
        for (const spell of sources.values()) { const budget = document.createElement('p');
          budget.textContent = `${spell.source}: ${spell.magic}/${spell.sourceCapacity ?? spell.magic} item Magic. These spells do not occupy class slots.`; section.appendChild(budget); }
      }
      if (caster.classCaster) {
        const slots = document.createElement('div'); slots.className = 'party-spellbook-slots';
        const count = document.createElement('p'); count.textContent = `Memorized slots: ${caster.prepared.length}/${caster.slots}. Click a learned spell to prepare it; click a filled slot to forget it. Each change takes one turn. Reading takes no turns.`; section.appendChild(count);
        for (let i = 0; i < caster.slots; i++) {
          const id = caster.prepared[i], spell = caster.groups.flatMap(g => g.spells).find(s => s.id === id && ['Prepared', 'Not prepared'].includes(s.status));
          const slot = document.createElement('button'); slot.type = 'button'; slot.textContent = spell?.name || 'Empty slot';
          slot.disabled = !spell || !!preparationBlocked() || !caster.bookPresent || caster.hp <= 0; slot.title = spell ? 'Forget ' + spell.name : 'Click a learned spell below to fill this slot';
          if (spell) slot.addEventListener('click', () => configure(caster.name, spell.id, true, data, content)); slots.appendChild(slot);
        }
        section.appendChild(slots);
      }
      if (!caster.groups.length) { const empty = document.createElement('p'); empty.textContent = 'No class spells or equipped item spells. Any class can cast from suitable equipped magic items or scrolls.'; section.appendChild(empty); }
      for (const group of caster.groups) {
        const heading = document.createElement('h4'); heading.textContent = `Level ${group.level}`; section.appendChild(heading);
        const columns = document.createElement('div'); columns.className = 'spellbook-cost-columns';
        for (const label of ['Spell', 'Memorize MP', 'Cast MP']) { const column = document.createElement('span'); column.textContent = label; columns.appendChild(column); }
        section.appendChild(columns);
        for (const spell of group.spells) {
          const configurable = spell.status === 'Prepared' || spell.status === 'Not prepared';
          const card = document.createElement('article'), name = document.createElement(configurable ? 'button' : 'strong'), detail = document.createElement('p');
          card.className = 'party-spell-entry';
          name.textContent = `${spell.name} (${spell.casts})`;
          const memorize = document.createElement('span'), cost = document.createElement('span');
          memorize.className = cost.className = 'spellbook-magic-cost'; memorize.textContent = spell.classSource ? String(spell.memorizeCost) : 'N/A';
          memorize.title = spell.classSource ? 'Preparation spends one turn, not Magic; casting spends Magic' : 'Equipped item spells do not use memorization slots';
          cost.textContent = String(spell.cost); cost.title = spell.classSource ? 'Spent from class Magic' : 'Spent only from this equipped item';
          if (configurable) { name.type = 'button'; name.className = 'spellbook-prepare'; name.disabled = !!preparationBlocked() || !caster.initialized || !caster.bookPresent || caster.hp <= 0 ||
              spell.status !== 'Prepared' && caster.prepared.length >= caster.slots;
            name.title = spell.status === 'Prepared' ? 'Forget this prepared spell (one turn)' : caster.prepared.length >= caster.slots ? 'All slots are filled; forget a spell first' : 'Prepare this spell in an empty slot (one turn)';
            name.addEventListener('click', () => configure(caster.name, spell.id, spell.status === 'Prepared', data, content)); }
          detail.textContent = `${spell.status}. ${spell.source}; cost ${spell.cost} Magic; range ${spell.range} tiles.\n${spell.description}` +
            (spell.preview ? '\nPreview at the required casting level.' : '') +
            (spell.status === 'Equipped' || spell.status === 'Insufficient Magic' ? `\nItem Magic: ${spell.magic}. ` +
              (spell.artifact ? `Artifact recharges in ${spell.rechargeIn} turns when depleted.` : 'Exhausting this item turns it to ash.') : '');
          detail.style.whiteSpace = 'pre-wrap'; card.append(name, memorize, cost, detail); section.appendChild(card);
        }
      }
      content.appendChild(section);
    }
  }
  async function configure(casterName, spellId, remove, data, content) {
    if (preparationBlocked()) return;
    const token = serial, runId = root.dungeonRunId, origin = root.getDungeonLifeContext?.();
    if (!origin?.dungeon || !origin.player) { message = 'The room is not ready for preparation.'; render(data, content); return; }
    preparing = true; message = ''; render(data, content);
    const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await r.json(); if (!r.ok) throw Error(result.error || 'Preparation failed.'); return result; };
    try {
      await root.prepareEconomyState?.();
      if (runId !== root.dungeonRunId || origin.dungeon.geoKey !== root.getDungeonLifeContext?.().dungeon?.geoKey || root.gamePaused || root.actionDiceState?.active) throw Error('The room or combat state changed; prepare outside combat.');
      const fresh = await post('/spellbook/view', { runId }), caster = fresh.casters.find(c => c.name === casterName);
      const ids = (caster?.prepared || []).filter(id => id !== spellId);
      if (!remove && !caster?.prepared.includes(spellId)) ids.push(spellId);
      else if (!remove) { message = 'That spell is already prepared.'; return; }
      if (remove && !caster?.prepared.includes(spellId)) { message = 'That spell is already unprepared.'; return; }
      if (!caster || ids.length > caster.slots) throw Error('All preparation slots are filled; forget a spell first.');
      const ctx = root.getDungeonLifeContext();
      const result = await post('/spells/prepare', { runId, geoKey: ctx.dungeon.geoKey, player: ctx.player,
        actors: ctx.actors.map(a => ({ name: a.name, mazeX: a.mazeX, mazeY: a.mazeY, mazePoint: a.mazePoint, discoveryRevision: a.discoveryRevision })),
        revision: fresh.revision, nonce: root.crypto?.randomUUID?.() || 'book:' + Date.now() + ':' + Math.random().toString(36).slice(2),
        kind: 'prepare', caster: casterName, spellIds: ids });
      if (runId === root.dungeonRunId) await root.applyRealtimeCombatResult?.(result);
      message = remove ? 'Spell forgotten. The preparation slot is empty.' : 'Spell prepared.';
      data = await post('/spellbook/view', { runId });
    } catch (error) { message = error.message; }
    finally { preparing = false; if (panel && serial === token && runId === root.dungeonRunId) render(data, content);
      else if (panel) root.PartySpellbookUi.refresh(); }
  }
  async function open() {
    close(); const token = ++serial, runId = root.dungeonRunId;
    panel = document.createElement('section'); panel.id = 'party-spellbook-popup'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Party Spellbook');
    const header = document.createElement('div'), title = document.createElement('span'), exit = document.createElement('button'), content = document.createElement('div');
    header.className = 'inventory-header'; title.textContent = 'Party Spellbook'; exit.textContent = 'X'; exit.setAttribute('aria-label', 'Close spellbook'); exit.addEventListener('click', close);
    header.append(title, exit); content.className = 'party-spellbook-content'; content.textContent = 'Reading party spell records...'; panel.append(header, content);
    document.body.appendChild(panel); position();
    document.getElementById('dungeon-spellbook-shortcut')?.setAttribute('aria-expanded', 'true');
    try {
      const response = await fetch('/spellbook/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }) });
      const data = await response.json(); if (serial !== token || root.dungeonRunId !== runId) return;
      if (!response.ok || data.runId !== runId) throw Error(data.error || 'Those spell records are unavailable.');
      render(data, content);
    } catch (error) { if (serial === token) content.textContent = error.message; }
  }
  root.PartySpellbookUi = { open, close, refresh() {
    if (!panel || refreshTimer || preparing) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null; if (!panel) return;
      const token = serial, runId = root.dungeonRunId;
      try { const response = await fetch('/spellbook/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }) });
        const data = await response.json(); if (response.ok && panel && serial === token && runId === root.dungeonRunId && data.runId === runId) render(data, panel.querySelector('.party-spellbook-content'));
      } catch {};
    }, 100);
  } };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  root.addEventListener?.('resize', position);
})(window);
