(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CommandAssist = api;
})(typeof window === 'undefined' ? globalThis : window, function(root) {
  'use strict';
  // LLM-first UI command assist. Gating mirrors holodekNarration.invitationHint:
  // a cheap positive hint decides whether to spend a model call; the model decides intent.
  // On model failure, default to none (pass-through), matching adjudication gate safe defaults.
  const CommandIntent = typeof module === 'object' && module.exports ? require('./commandIntent') : null;
  const INTENTS = Object.freeze(['equip', 'unequip', 'cast', 'read', 'give', 'drop', 'drink', 'trade', 'none']);
  const SLOTS = Object.freeze(['armor', 'weapon', 'shield', 'other', 'book', 'scroll', 'any']);
  const key = value => String(value || '').trim().toLowerCase();
  const clean = value => String(value || '').trim().replace(/[.!?]+$/g, '').trim();
  const GENERIC_READABLES = /^(?:a |an |the )?(?:book|tome|codex|ledger|journal|chronicle|scroll|grimoire|spellbook|map|document|text)$/i;
  const none = (source = 'gate') => ({ intent: 'none', itemHint: null, targetHint: null, slotHint: null, complete: false, source });

  function normalize(input) {
    return clean(String(input || '').replace(/[\u2018\u2019]/g, "'")).replace(/\s+/g, ' ');
  }

  function travel(input) {
    return (root.CommandIntent || CommandIntent)?.travelDirection?.(input) || null;
  }

  // Already-valid legacy forms stay on the existing Commerce/Spell/read path (not LLM classification).
  function legacyComplete(input) {
    const text = normalize(input);
    if (/^equip\s+.+/i.test(text)) return 'equip';
    if (/^unequip\s+.+/i.test(text)) return 'unequip';
    if (/^drop\s+.+/i.test(text)) return 'drop';
    if (/^(?:drink|quaff)\s+.+/i.test(text)) return 'drink';
    if (/^give\s+.+\s+to\s+.+/i.test(text)) return 'give';
    if (/^(?:buy|purchase|sell)\s+.+/i.test(text)) return 'trade';
    if (/^cast\s+.+\s+from\s+.+\s+(?:at|on)\s+.+/i.test(text)) return 'cast';
    if (/^read\s+(?:the\s+)?(.+)$/i.test(text)) {
      const name = text.replace(/^read\s+(?:the\s+)?/i, '');
      if (name && !GENERIC_READABLES.test(name) && !/^chapter\s+\d+$/i.test(name)) return 'read';
    }
    return null;
  }

  // Latency gate only (like invitationHint). Never decides the intent.
  function uiAssistHint(input) {
    const text = normalize(input);
    if (!text || travel(text) || legacyComplete(text)) return false;
    if (/\b(?:don't|do not|never)\b[\s\S]{0,60}\b(?:equip|wear|don|cast|read|drop|give|drink|trade)\b/i.test(text)) return false;
    if (/\b(?:equip|unequip|wear|don|put on|take off|strap on|gear up|cast|spell|magic|read|peruse|study|book|tome|codex|ledger|journal|chronicle|scroll|grimoire|spellbook|give|hand over|drop|discard|drink|quaff|trade|shop|buy|sell|prepare spells?)\b/i.test(text)) return true;
    const words = text.split(/\s+/);
    return words.length <= 5 && /^(?:please\s+)?[a-z]/i.test(text) && !/\b(?:search|attack|say|ask|tell|talk|sneak|persuade|north|south|east|west)\b/i.test(text);
  }

  function inventoryRecords() {
    const source = root.latestUpdatedData || {};
    const names = source.inventory ?? root.inventory ?? [];
    const props = source.inventoryProperties;
    return root.getInventoryGiveItems?.() || root.InventoryUi?.inventoryItems?.(names, props) || [];
  }

  function partyNames() {
    const entries = typeof root.getPartyInfoEntries === 'function' ? root.getPartyInfoEntries() : [];
    return [...new Set(entries.map(entry => String(entry.label || entry.name || '').replace(/^Name:\s*/i, '').trim()).filter(Boolean))];
  }

  function filterItems(intent, classification) {
    const items = inventoryRecords();
    const slot = classification.slotHint;
    const hint = key(classification.itemHint);
    let list = items.slice();
    if (intent === 'equip' || intent === 'unequip') {
      if (slot && slot !== 'any' && !['book', 'scroll'].includes(slot)) list = list.filter(item => item.type === slot);
      else if (intent === 'equip') list = list.filter(item => ['weapon', 'armor', 'shield', 'other'].includes(item.type));
    }
    if (intent === 'read') {
      list = list.filter(item => root.WorldInteractionUi?.hasReadableContent?.(item.name));
      if (slot === 'book') list = list.filter(item => /\b(?:book|tome|codex|ledger|journal|chronicle|grimoire|spellbook)\b/i.test(item.name) || item.readable_kind === 'book' || item.readable_kind === 'spellbook');
      if (slot === 'scroll') list = list.filter(item => /\b(?:scroll|map)\b/i.test(item.name) || item.readable_kind === 'scroll' || item.readable_kind === 'map');
    }
    if (intent === 'drink') list = list.filter(item => root.CommerceUi?.drinkable?.(item.name));
    if (intent === 'drop' || intent === 'give') list = items.slice();
    if (hint) {
      const exact = list.filter(item => key(item.name) === hint);
      if (exact.length) return exact;
      const soft = list.filter(item => key(item.name).includes(hint) || hint.includes(key(item.name)));
      if (soft.length) return soft;
    }
    return list;
  }

  function optionsFor(classification) {
    const intent = classification?.intent;
    if (!intent || intent === 'none') return { intent: 'none', title: null, options: [], mode: 'passthrough' };
    if (intent === 'cast') return { intent, title: 'Cast which spell?', options: [], mode: 'spells' };
    if (intent === 'trade') return { intent, title: 'Trade', options: [], mode: 'trade' };
    const items = filterItems(intent, classification);
    const party = partyNames();
    if (intent === 'equip') {
      if (classification.targetHint && items.length === 1)
        return { intent, title: null, options: [{ label: items[0].name, value: items[0].name, target: classification.targetHint }], mode: 'equip-direct' };
      if (items.length === 1 && party.length <= 1)
        return { intent, title: null, options: [{ label: items[0].name, value: items[0].name, target: party[0] || null }], mode: 'equip-direct' };
      if (!items.length) return { intent, title: 'Equip which item?', options: [], mode: 'empty', empty: 'No matching gear is in inventory.' };
      return { intent, title: 'Equip which item?', options: items.map(item => ({ label: item.name, value: item.name })), mode: 'equip-item', party };
    }
    if (intent === 'unequip') {
      return { intent, title: 'Unequip which item?', options: items.map(item => ({ label: item.name, value: item.name })), mode: items.length ? 'unequip-item' : 'empty', empty: 'No matching equipped item is listed in inventory metadata. Use the character sheet unequip controls.', party };
    }
    if (intent === 'read') {
      if (items.length === 1) return { intent, title: null, options: [{ label: items[0].name, value: items[0].name }], mode: 'read-direct' };
      return { intent, title: 'Read which book?', options: items.map(item => ({ label: item.name, value: item.name })), mode: items.length ? 'read-item' : 'empty', empty: 'No readable books or documents are in inventory.' };
    }
    if (intent === 'give') {
      return { intent, title: 'Give which item?', options: items.map(item => ({ label: item.name, value: item.name })), mode: items.length ? 'give-item' : 'empty', empty: 'No carried items to give.', party };
    }
    if (intent === 'drop') {
      return { intent, title: 'Drop which item?', options: items.map(item => ({ label: item.name, value: item.name })), mode: items.length ? 'drop-item' : 'empty', empty: 'Inventory is empty.' };
    }
    if (intent === 'drink') {
      return { intent, title: 'Drink which potion?', options: items.map(item => ({ label: item.name, value: item.name })), mode: items.length ? 'drink-item' : 'empty', empty: 'No drinkable potions are in inventory.' };
    }
    return { intent: 'none', title: null, options: [], mode: 'passthrough' };
  }

  function closePopup() {
    if (typeof document === 'undefined') return;
    document.querySelector('.popup-container[data-command-assist]')?.remove();
  }

  function showChooser(title, options, onPick, emptyMessage) {
    if (typeof document === 'undefined') return false;
    closePopup();
    const popup = document.createElement('div');
    popup.className = 'popup-container';
    popup.dataset.commandAssist = 'true';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', title || 'Choose an action');
    const heading = document.createElement('p');
    heading.textContent = title || 'Choose';
    popup.appendChild(heading);
    if (!options.length) {
      const note = document.createElement('p');
      note.textContent = emptyMessage || 'Nothing available.';
      popup.appendChild(note);
    } else {
      const select = document.createElement('select');
      select.setAttribute('aria-label', title || 'Choice');
      select.style.cssText = 'width:100%;margin-bottom:12px';
      for (const option of options) {
        const row = document.createElement('option');
        row.value = option.value;
        row.textContent = option.label;
        select.appendChild(row);
      }
      popup.appendChild(select);
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'popup-button';
      confirm.textContent = 'Choose';
      confirm.addEventListener('click', () => {
        const chosen = options.find(option => option.value === select.value) || options[0];
        popup.remove();
        onPick(chosen);
      });
      popup.appendChild(confirm);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'popup-button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => popup.remove());
    popup.appendChild(cancel);
    document.body.appendChild(popup);
    return true;
  }

  function runCommand(text) {
    const input = typeof document !== 'undefined' ? document.getElementById('chatuserinput') : null;
    if (!input || typeof root.chatbotprocessinput !== 'function') return false;
    if (input.value.trim()) return false;
    input.value = text;
    root.chatbotprocessinput();
    return true;
  }

  async function classifyWithModel(input) {
    try {
      const response = await fetch('/command-assist/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: normalize(input) }),
        signal: root.AbortSignal?.timeout?.(12000)
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data || !INTENTS.includes(data.intent)) return null;
      return {
        intent: data.intent,
        itemHint: data.itemHint ? String(data.itemHint).slice(0, 80) : null,
        targetHint: data.targetHint ? String(data.targetHint).slice(0, 80) : null,
        slotHint: SLOTS.includes(data.slotHint) ? data.slotHint : null,
        complete: false,
        source: 'llm'
      };
    } catch {
      return null;
    }
  }

  // LLM decides intent when the recruit-style hint fires. Failure => none (no synonym fallback).
  async function classify(input) {
    const text = normalize(input);
    if (!text || travel(text)) return none('gate');
    if (legacyComplete(text)) return { intent: legacyComplete(text), itemHint: null, targetHint: null, slotHint: null, complete: true, source: 'legacy' };
    if (!uiAssistHint(text)) return none('gate');
    const remote = await classifyWithModel(text);
    return remote || none('llm-fallback');
  }

  function continueEquip(itemName, party) {
    const members = party || partyNames();
    if (members.length <= 1) {
      if (root.InventoryUi?.requestEquip) return !!root.InventoryUi.requestEquip(itemName, members[0] || null);
      return runCommand(members[0] ? `equip ${itemName} to ${members[0]}` : `equip ${itemName}`);
    }
    return showChooser('Equip to whom?', members.map(name => ({ label: name, value: name })), chosen => {
      if (root.InventoryUi?.requestEquip) root.InventoryUi.requestEquip(itemName, chosen.value);
      else runCommand(`equip ${itemName} to ${chosen.value}`);
    });
  }

  async function fulfill(classification) {
    const plan = optionsFor(classification);
    if (plan.mode === 'passthrough') return false;
    if (plan.mode === 'spells') {
      await root.SpellUi?.open?.();
      return true;
    }
    if (plan.mode === 'trade') {
      try { await root.CommerceUi?.handleCommand?.('trade'); } catch {}
      return true;
    }
    if (plan.mode === 'equip-direct') {
      const option = plan.options[0];
      if (root.InventoryUi?.requestEquip) return !!root.InventoryUi.requestEquip(option.value, option.target || null);
      return runCommand(option.target ? `equip ${option.value} to ${option.target}` : `equip ${option.value}`);
    }
    if (plan.mode === 'read-direct') {
      if (root.WorldInteractionUi?.requestRead) return !!(await root.WorldInteractionUi.requestRead(plan.options[0].value));
      return runCommand('read ' + plan.options[0].value);
    }
    if (plan.mode === 'empty') return showChooser(plan.title, [], () => {}, plan.empty);
    if (plan.mode === 'equip-item') {
      return showChooser(plan.title, plan.options, chosen => continueEquip(chosen.value, plan.party), plan.empty);
    }
    if (plan.mode === 'read-item') {
      return showChooser(plan.title, plan.options, chosen => {
        if (root.WorldInteractionUi?.requestRead) root.WorldInteractionUi.requestRead(chosen.value);
        else runCommand('read ' + chosen.value);
      }, plan.empty);
    }
    if (plan.mode === 'drop-item') {
      return showChooser(plan.title, plan.options, chosen => runCommand('drop ' + chosen.value), plan.empty);
    }
    if (plan.mode === 'drink-item') {
      return showChooser(plan.title, plan.options, chosen => {
        if (root.CommerceUi?.drink) root.CommerceUi.drink(chosen.value);
        else runCommand('drink ' + chosen.value);
      }, plan.empty);
    }
    if (plan.mode === 'give-item') {
      const party = plan.party || partyNames();
      return showChooser(plan.title, plan.options, chosen => {
        if (party.length === 1 && root.ItemGiveUi?.open) return root.ItemGiveUi.open(party[0]);
        if (party.length) {
          showChooser('Give to whom?', party.map(name => ({ label: name, value: name })), target => {
            runCommand(`give ${chosen.value} to ${target.value}`);
          });
          return;
        }
        runCommand('give ' + chosen.value);
      }, plan.empty);
    }
    if (plan.mode === 'unequip-item') {
      return showChooser(plan.title, plan.options, chosen => runCommand('unequip ' + chosen.value), plan.empty);
    }
    return false;
  }

  async function intercept(input) {
    if (root.gamePaused || root.actionDiceState?.active || root._combatCommandPending || root._characterStartupPending || root.GameCommandGate?.busy?.()) return false;
    const classification = await classify(input);
    if (!classification || classification.intent === 'none' || classification.complete || !classification.intent) return false;
    return fulfill(classification);
  }

  return {
    INTENTS, SLOTS, normalize, travel, legacyComplete, uiAssistHint, classifyWithModel, classify,
    optionsFor, filterItems, inventoryRecords, partyNames, intercept, fulfill, showChooser, closePopup
  };
});
