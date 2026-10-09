(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.InventoryUi = api; document.addEventListener('DOMContentLoaded', api.init); }
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  const CATEGORIES = [['weapon', 'Weapons'], ['armor', 'Armor'], ['shield', 'Shields'], ['other', 'Other']];
  const key = name => String(name || '').trim().toLowerCase();
  const valid = name => !!key(name) && !/^(none|empty|nothing|null|undefined)\.?$/i.test(key(name));
  const identity = name => String(name || '').trim().replace(/^Name:\s*/i, '');

  // Read the existing console's object literals without executing them or changing its format.
  function parseProperties(value) {
    const records = [];
    const chunks = Array.isArray(value) ? value : String(value || '').match(/\{[^{}]*\}/g) || [];
    for (const chunk of chunks) {
      if (chunk && typeof chunk === 'object') { records.push({ ...chunk }); continue; }
      try { records.push(JSON.parse(chunk)); continue; } catch {}
      const record = {};
      for (const match of String(chunk).matchAll(/(?:^|[,{])\s*(\w+)\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^,}]+))/g)) {
        const raw = match[2] ?? match[3] ?? match[4].trim();
        let value = raw;
        if (match[2] !== undefined) { try { value = JSON.parse(`"${raw}"`); } catch {} }
        else if (match[3] === undefined && Number.isFinite(Number(raw))) value = Number(raw);
        record[match[1]] = value;
      }
      if (valid(record.name)) records.push(record);
    }
    return records.filter(record => record && valid(record.name));
  }

  function inventoryItems(names, properties) {
    const list = Array.isArray(names) ? names : String(names || '').split(/,\s*/);
    const metadata = new Map(parseProperties(properties).map(record => [key(record.name), record]));
    const items = new Map();
    for (const raw of list) {
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (!valid(name)) continue;
      const id = key(name);
      if (items.has(id)) { items.get(id).quantity++; continue; }
      const props = metadata.get(id) || {};
      const type = CATEGORIES.some(([type]) => type === props.type) ? props.type : 'other';
      items.set(id, { ...props, id, name, type, quantity: 1 });
    }
    return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  function equippedName(sheet, type) {
    const slot = { weapon: 'Weapon', armor: 'Armor', shield: 'Shield', other: 'Other' }[type] || 'Other';
    const line = String(sheet || '').match(/^[ \t]*Equipped:[ \t]*([^\r\n]*)/m)?.[1] || '';
    const name = line.match(new RegExp(`(?:^|[,{}])[ \\t]*${slot}:[ \\t]*([^,}]+)`, 'i'))?.[1]?.trim();
    return valid(name) ? name : null;
  }

  let panel, groups, detail, equip, open = false, selected = null, dragged = null, replacement = null;
  let items = [], state = {}, signature = '';
  function busy() { return !!(root._characterStartupPending || root._combatCommandPending || root.actionDiceState?.active); }
  function party() {
    return typeof root.getPartyInfoEntries === 'function' ? root.getPartyInfoEntries() : [];
  }
  function inventoryLink(name) {
    return [...document.querySelectorAll('#phaser-container .clickable-inventory')]
      .find(link => key(link.getAttribute('data-object')) === key(name));
  }
  function occupiedSlot(name, type) {
    const sheets = [...(root.PartyRoster?.parseSheets(state.pc, 'pc') || []), ...(root.PartyRoster?.parseSheets(state.npcs, 'npc') || [])];
    const entry = sheets.find(entry => key(identity(entry.name)) === key(identity(name)));
    return equippedName(entry?.sheet || party().find(entry => key(identity(entry.label)) === key(identity(name)))?.source?.sheet, type);
  }
  function message(text) { if (detail) detail.textContent = text; }
  function clearTargetHighlights() {
    document.getElementById('party-icon-dock')?.classList.remove('inventory-targeting');
    for (const button of document.querySelectorAll('.inventory-drop-hover')) button.classList.remove('inventory-drop-hover');
  }
  function selectItem(name) {
    selected = items.find(item => item.id === key(name)) || null;
    for (const button of groups?.querySelectorAll('[data-inventory-item]') || []) {
      const active = !!selected && key(button.dataset.inventoryItem) === selected.id;
      button.classList.toggle('inventory-selected', active); button.setAttribute('aria-pressed', String(active));
    }
    document.getElementById('party-icon-dock')?.classList.toggle('inventory-targeting', !!selected);
    if (equip) equip.disabled = !selected;
    if (!selected) { message('Drag an item onto a party icon, or select it and click a character.'); return; }
    const stats = [['Attack', 'attack_modifier'], ['Damage', 'damage_modifier'], ['Armor', 'ac'], ['Magic', 'magic']]
      .filter(([, field]) => Number.isFinite(Number(selected[field])) && Number(selected[field]) !== 0)
      .map(([label, field]) => `${label} ${Number(selected[field]) > 0 ? '+' : ''}${selected[field]}`);
    message(`${selected.name}${stats.length ? ' | ' + stats.join(' | ') : ''}`);
  }

  function requestEquip(name, targetName) {
    if (busy()) { message('Finish the current action before equipping.'); return false; }
    const item = items.find(item => item.id === key(name)), link = item && inventoryLink(item.name);
    const target = targetName == null ? null : party().find(entry => key(identity(entry.label)) === key(identity(targetName)));
    if (!link || targetName != null && !target) { message('That item or character is no longer available.'); return false; }
    const oldName = target && occupiedSlot(target.label, item.type);
    if (oldName) {
      const oldLink = [...document.querySelectorAll('#phaser-container .clickable-equipped')].find(link =>
        key(link.getAttribute('data-item')) === key(oldName) && key(identity(link.getAttribute('data-character'))) === key(identity(target.label)));
      if (!oldLink) { message(`Unequip ${oldName} from ${target.label} first.`); return false; }
      const pending = { name: item.name, target: target.label, type: item.type, waiting: false };
      replacement = pending;
      oldLink.click();
      const button = document.getElementById('unequip-button'), cancel = document.getElementById('cancel-button');
      if (!button) { replacement = null; return false; }
      button.closest('.popup-container').dataset.inventoryReplacement = 'true';
      button.addEventListener('click', event => {
        if (busy()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        if (replacement === pending) pending.waiting = true;
      }, { capture: true });
      cancel?.addEventListener('click', () => { if (replacement === pending) replacement = null; }, { once: true });
      toggle(false); button.focus();
      return true;
    }
    // Reuse Drop/Equip -> character selection -> the original text-command confirmation.
    link.click();
    const equipButton = document.getElementById('equip-button');
    if (!equipButton) return false;
    equipButton.click();
    const picker = document.getElementById('character-select');
    if (!picker) return false;
    if (target) {
      const option = [...picker.options].find(option => key(identity(option.value)) === key(identity(target.label)));
      if (!option) { picker.closest('.popup-container')?.remove(); message('That character is no longer available.'); return false; }
      picker.value = option.value;
    }
    toggle(false);
    picker.focus();
    return true;
  }

  function render() {
    if (!groups || !open) return;
    groups.replaceChildren();
    for (const [type, label] of CATEGORIES) {
      const section = document.createElement('section'), heading = document.createElement('h3'), grid = document.createElement('div');
      section.className = 'inventory-category'; grid.className = 'inventory-grid';
      const members = items.filter(item => item.type === type);
      heading.textContent = `${label} (${members.reduce((n, item) => n + item.quantity, 0)})`;
      section.append(heading, grid); groups.appendChild(section);
      for (const item of members) {
        const button = document.createElement('button'), canvas = document.createElement('canvas'), name = document.createElement('span');
        button.type = 'button'; button.className = 'inventory-item'; button.draggable = true;
        button.dataset.inventoryItem = item.name; button.title = item.name; button.setAttribute('aria-label', `${item.name}${item.quantity > 1 ? ', ' + item.quantity + ' carried' : ''}`);
        canvas.width = canvas.height = 32; canvas.setAttribute('aria-hidden', 'true');
        const image = root.SceneItems?.createItemCanvas(item, { scale: 1 });
        if (image) canvas.getContext('2d').drawImage(image, 0, 0, 32, 32);
        name.className = 'inventory-item-name'; name.textContent = item.name;
        button.append(canvas, name);
        if (item.quantity > 1) { const count = document.createElement('span'); count.className = 'inventory-quantity'; count.textContent = item.quantity; button.appendChild(count); }
        button.addEventListener('click', () => selectItem(item.name));
        button.addEventListener('dragstart', event => {
          if (busy()) { event.preventDefault(); return; }
          dragged = item.name; selectItem(item.name);
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('application/x-cotg-inventory-item', item.name);
          event.dataTransfer.setData('text/plain', item.name);
        });
        button.addEventListener('dragend', () => { dragged = null; clearTargetHighlights(); if (selected && open) document.getElementById('party-icon-dock')?.classList.add('inventory-targeting'); });
        grid.appendChild(button);
      }
      if (!members.length) { const empty = document.createElement('span'); empty.className = 'inventory-category-empty'; empty.textContent = 'None'; grid.appendChild(empty); }
    }
    selectItem(selected?.name);
  }

  function fit() {
    if (!panel || !open) return;
    const bounds = panel.getBoundingClientRect(), zoom = panel.offsetWidth ? bounds.width / panel.offsetWidth : 1;
    const width = Math.max(1, Math.min(390, root.innerWidth / zoom - 16));
    panel.style.width = width + 'px'; panel.style.left = (root.innerWidth / zoom - width) / 2 + 'px';
    const command = document.getElementById('chatbotcontainer')?.getBoundingClientRect();
    const menu = document.getElementById('game-menu-toggle')?.getBoundingClientRect();
    const top = menu ? menu.bottom / zoom + 6 : 42;
    const bottom = command?.height ? Math.min(root.innerHeight / zoom - 8, command.top / zoom - 8) : root.innerHeight / zoom - 8;
    const available = Math.max(1, bottom - top);
    panel.style.maxHeight = available + 'px';
    panel.style.top = top + Math.max(0, available - panel.offsetHeight) / 2 + 'px';
  }
  function toggle(value) {
    if (!panel) return;
    open = typeof value === 'boolean' ? value : !open;
    panel.hidden = !open;
    document.getElementById('dungeon-inventory-shortcut')?.setAttribute('aria-expanded', String(open));
    if (open) { root.DungeonExplorationMap?.toggle(false); render(); fit(); }
    else { selected = dragged = null; clearTargetHighlights(); }
  }
  function update(data) {
    state = data || {};
    const next = JSON.stringify([state.inventory || '', state.inventoryProperties || '']);
    if (next !== signature) {
      signature = next; items = inventoryItems(state.inventory, state.inventoryProperties);
      if (selected && !items.some(item => item.id === selected.id)) selected = null;
      render(); fit();
    }
    // Continue only after the original Unequip command has refreshed the console.
    if (replacement?.waiting && !occupiedSlot(replacement.target, replacement.type)) {
      const pending = replacement;
      replacement = null;
      root.queueMicrotask(() => { if (items.some(item => item.id === key(pending.name))) requestEquip(pending.name, pending.target); });
    }
  }
  function reset() {
    state = {}; signature = ''; items = []; replacement = null; toggle(false);
    document.querySelector('.popup-container[data-inventory-replacement]')?.remove();
  }
  function init() {
    panel = document.getElementById('inventory-popup'); groups = document.getElementById('inventory-groups');
    detail = document.getElementById('inventory-detail'); equip = document.getElementById('inventory-equip');
    if (!panel || !groups || !detail || !equip) return;
    document.getElementById('dungeon-inventory-shortcut')?.addEventListener('click', () => toggle());
    document.getElementById('inventory-close').addEventListener('click', () => toggle(false));
    equip.addEventListener('click', () => { if (selected) requestEquip(selected.name); });
    document.addEventListener('click', event => {
      if (!open || !selected) return;
      const button = event.target.closest?.('#party-icon-dock .party-icon-button');
      const index = Number(button?.closest('[data-party-slot]')?.dataset.partySlot);
      if (!button || !Number.isSafeInteger(index)) return;
      const target = party()[index];
      if (!target) return;
      event.preventDefault(); event.stopImmediatePropagation(); requestEquip(selected.name, target.label);
    }, true);
    document.addEventListener('dragover', event => {
      if (!dragged || busy()) return;
      const button = event.target.closest?.('#party-icon-dock .party-icon-button');
      if (!button) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; button.classList.add('inventory-drop-hover');
    });
    document.addEventListener('dragleave', event => event.target.closest?.('.party-icon-button')?.classList.remove('inventory-drop-hover'));
    document.addEventListener('drop', event => {
      const button = event.target.closest?.('#party-icon-dock .party-icon-button');
      if (!button || !dragged) return;
      event.preventDefault();
      const name = dragged, target = party()[Number(button.closest('[data-party-slot]')?.dataset.partySlot)];
      dragged = null; clearTargetHighlights();
      if (target) requestEquip(name, target.label);
    });
    document.addEventListener('keydown', event => {
      if (!open) return;
      if (event.key === 'Escape') { event.preventDefault(); toggle(false); }
      else if (event.target.closest?.('#inventory-popup') && /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|[wasdqe])$/i.test(event.key)) event.stopPropagation();
    }, true);
    root.addEventListener('resize', fit);
  }
  return { CATEGORIES, parseProperties, inventoryItems, equippedName, init, update, toggle, reset, requestEquip, isOpen: () => open };
});
