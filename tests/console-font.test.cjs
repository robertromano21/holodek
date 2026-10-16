'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function mount(saved, blocked = false) {
  const events = {}, storage = new Map(saved ? [['holodek.consoleFont', saved]] : []);
  const button = { textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, fn) { events[k] = fn; } };
  const document = { documentElement: { dataset: {} }, getElementById: () => button,
    addEventListener(k, fn) { events[k] = fn; } };
  const window = { document, localStorage: { getItem(k) { if (blocked) throw Error('blocked'); return storage.get(k); },
    setItem(k, v) { if (blocked) throw Error('blocked'); storage.set(k, v); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/consoleFontUi'), 'utf8'), { window, document }); events.DOMContentLoaded();
  return { window, document, button, events, storage };
}
test('console/log font defaults to Retro and preserves the original monospace choice across reloads', () => {
  const c = mount(); assert.equal(c.document.documentElement.dataset.consoleFont, 'retro');
  c.events.click(); assert.equal(c.button.textContent, 'Console / Log Font: Classic');
  assert.equal(c.storage.get('holodek.consoleFont'), 'classic'); assert.equal(mount('classic').document.documentElement.dataset.consoleFont, 'classic');
  c.events.click(); assert.equal(c.document.documentElement.dataset.consoleFont, 'retro'); assert.equal(c.button.attrs['aria-pressed'], 'false');
  assert.equal(mount('unknown').document.documentElement.dataset.consoleFont, 'retro');
});
test('blocked local storage does not disable font switching', () => {
  const c = mount(null, true); assert.equal(c.document.documentElement.dataset.consoleFont, 'retro');
  c.events.click(); assert.equal(c.document.documentElement.dataset.consoleFont, 'classic');
});
