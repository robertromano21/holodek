(function(root) {
  'use strict';
  function open(name) {
    if (root.GameCommandGate?.busy() || root.gamePaused || root.actionDiceState?.active) return false;
    const source = root.latestUpdatedData || {}, text = root.lastServerGameConsole || '';
    const names = source.inventory ?? text.match(/^Inventory:[ \t]*([^\r\n]*)/m)?.[1] ?? root.inventory ?? [];
    const items = root.getInventoryGiveItems?.() || root.InventoryUi?.inventoryItems(names, source.inventoryProperties) || [];
    document.querySelectorAll('.popup-container').forEach(p => p.remove());
    const popup = document.createElement('div'); popup.className = 'popup-container item-give-actions';
    popup.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:17000;width:min(400px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto';
    const heading = document.createElement('p'); heading.textContent = 'Give an inventory item to ' + name; popup.appendChild(heading);
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Item to give'); select.style.cssText = 'width:100%;margin-bottom:12px';
    for (const item of items) { const option = document.createElement('option'); option.value = item.name; option.textContent = item.name; select.appendChild(option); }
    const detail = document.createElement('p'); detail.textContent = items.length ? 'Confirming transfers one item. Equipped items must be unequipped first.' : 'No carried items. Unequip an item first if needed.';
    popup.append(select, detail);
    const give = document.createElement('button'); give.type = 'button'; give.className = 'popup-button'; give.id = 'confirm-give-item'; give.textContent = 'Give'; give.disabled = !items.length;
    give.addEventListener('click', () => {
      const input = document.getElementById('chatuserinput');
      if (!input || root.GameCommandGate?.busy() || root.gamePaused || root.actionDiceState?.active || !select.value) return;
      if (input.value.trim()) { detail.textContent = 'Your command draft was preserved. Submit or clear it, then confirm the handoff.'; return; }
      input.value = `give ${select.value} to ${name}`; popup.remove(); root.chatbotprocessinput();
    });
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'popup-button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => popup.remove());
    popup.append(give, cancel); document.body.appendChild(popup); return true;
  }
  root.ItemGiveUi = { open };
})(window);
