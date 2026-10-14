(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameLogContent = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const roomField = /^Objects in Room(?: Properties| Remaining)?:/i;
  const inventoryField = /^Inventory(?: Properties)?:/i;
  function withoutLootLists(value, { inventory = true } = {}) {
    const parts = String(value || '').split(/(\r?\n|<br\s*\/?>)/i);
    let continuation = false;
    for (let i = 0; i < parts.length; i += 2) {
      const plain = parts[i].replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ');
      const trim = plain.trim();
      const drop = roomField.test(trim) || inventory && inventoryField.test(trim) ||
        continuation && trim && /^(?:\s+|[{}\[\],])/.test(plain) && !/^[ \t]*[A-Za-z][A-Za-z ]+:/.test(plain);
      if (drop) {
        parts[i] = ''; if (i + 1 < parts.length) parts[i + 1] = '';
        continuation = true;
      } else continuation = false;
    }
    return parts.join('');
  }
  return { withoutLootLists };
});
