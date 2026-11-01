'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const UI = require('../assets/windowUi'), core = ['phaser-popup', 'game-log-popup', 'combat-popup'];
function fixture(scale = 1.75) {
  const handlers = {}, callbacks = {}, panels = [], notices = [];
  const root = { innerWidth: 1600, innerHeight: 1000, scale, CombatTacticalUi: { resized: width => notices.push(width) },
    getComputedStyle: panel => ({ position: panel.position || 'fixed', getPropertyValue: p => panel.padding?.[p] || '0px' }) };
  const camel = s => s.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
  function node(tag = 'DIV') {
    const style = {}, children = [], listeners = {}, attributes = {};
    Object.defineProperties(style, { setProperty: { value(p, v) { style[p] = v; } }, getPropertyValue: { value: p => style[p] || style[camel(p)] || '' } });
    const n = { tagName: tag, style, children, listeners, dataset: {}, className: '', open: tag === 'DIALOG', hidden: false, isConnected: true,
      getAttribute: p => attributes[p], setAttribute(p, value) { attributes[p] = value; }, addEventListener: (type, fn) => listeners[type] = fn,
      classList: { add: value => n.className += ' ' + value, contains: value => n.className.split(/\s+/).includes(value) },
      appendChild(c) { children.push(c); c.parentNode = n; }, append(...items) { items.forEach(c => n.appendChild(c)); },
      prepend(c) { children.unshift(c); c.parentNode = n; }, close() { n.open = false; }, remove() { n.isConnected = false; },
      dispatchEvent(event) { listeners[event.type]?.(event); return !event.defaultPrevented; }, setPointerCapture() {},
      matches(selector) { return selector.includes('dialog') && tag === 'DIALOG' || selector.includes('[role="dialog"]') && attributes.role === 'dialog' ||
        selector.includes('.popup-container') && n.classList.contains('popup-container') || selector.includes('#character-sprite-review') && n.id === 'character-sprite-review'; },
      querySelectorAll(selector) { return children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); },
      querySelector(selector) {
        if (selector.startsWith(':scope >')) return children.find(c => c.header || c.className === 'window-menu-tab');
        if (selector === 'h1, h2') return children.find(c => ['H1', 'H2'].includes(c.tagName));
        const all = children.flatMap(c => [c, ...c.descendants()]);
        return selector.startsWith('#') ? all.find(c => c.id === selector.slice(1)) : all.find(c => c.tagName === selector.toUpperCase());
      },
      descendants: () => children.flatMap(c => [c, ...c.descendants()]),
      getBoundingClientRect() {
        let width = 500 * root.scale, height = 500 * root.scale, left = 100, top = 70;
        if (n.id === 'dungeon-popup') return { left: 0, top: 0, width: root.innerWidth, height: root.innerHeight, right: root.innerWidth, bottom: root.innerHeight };
        if (core.includes(n.id)) {
          width = (n.id === 'combat-popup' ? 170 : n.id === 'phaser-popup' ? 200 : 260) * root.scale;
          height = Math.min(300 * root.scale, root.innerHeight / 2 - 10 * root.scale);
          left = n.id === 'combat-popup' ? 5 * root.scale : root.innerWidth - width - 5 * root.scale;
          top = n.id === 'combat-popup' ? 42 * root.scale : n.id === 'phaser-popup' ? 5 * root.scale : root.innerHeight - height - 5 * root.scale;
        }
        if (style.width) width = parseFloat(style.width) * root.scale;
        if (style.height) height = parseFloat(style.height) * root.scale;
        if (style.left && style.left !== 'auto') left = parseFloat(style.left) * root.scale;
        else if (style.right && style.right !== 'auto') left = root.innerWidth - parseFloat(style.right) * root.scale - width;
        if (style.top && style.top !== 'auto') top = parseFloat(style.top) * root.scale;
        else if (style.bottom && style.bottom !== 'auto') top = root.innerHeight - parseFloat(style.bottom) * root.scale - height;
        return { left, top, width, height, right: left + width, bottom: top + height };
      } };
    Object.defineProperty(n, 'offsetWidth', { get: () => n.getBoundingClientRect().width / root.scale });
    return n;
  }
  for (const id of ['dungeon-popup', ...core, 'save-game-dialog', 'art-dialog', 'embedded-actions']) {
    const panel = node(id.endsWith('dialog') ? 'DIALOG' : 'DIV'); panel.id = id;
    if (core.includes(id) || id === 'art-dialog') { const header = node('HEADER'); header.header = true; panel.appendChild(header); }
    if (id === 'save-game-dialog') { panel.padding = { 'padding-top': '22px', 'padding-left': '16px', 'padding-right': '28px' }; panel.setAttribute('aria-label', 'Save and load adventure'); }
    if (id === 'embedded-actions') { panel.position = 'static'; panel.setAttribute('role', 'dialog'); }
    panels.push(panel);
  }
  const document = { head: node('HEAD'), body: node('BODY'), createElement: tag => node(tag.toUpperCase()),
    querySelector: selector => panels.find(p => p.id === selector.slice(1)), querySelectorAll: selector => panels.filter(p => p.matches(selector)),
    addEventListener: (type, fn, capture) => handlers[type] = { fn, capture } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/windowUi'), 'utf8'), { window: root, document, Event,
    MutationObserver: class { constructor(fn) { callbacks.mutation = fn; } observe(target, options) { callbacks.observed = options; } } });
  root.WindowUi.init();
  function resize(panel, edge, dx, dy) {
    const grip = panel.children.find(c => c.className === 'window-resize-grip window-resize-' + edge);
    grip.listeners.pointerdown({ button: 0, pointerId: 7, currentTarget: grip, clientX: 200, clientY: 100, preventDefault() {}, stopPropagation() {} });
    handlers.pointermove.fn({ pointerId: 7, clientX: 200 + dx, clientY: 100 + dy, preventDefault() {} });
    handlers.pointerup.fn({ pointerId: 7 });
  }
  return { root, panels, handlers, callbacks, resize, node, notices, styles: document.head.children };
}

test('initialization leaves fullscreen and all default panel geometry and headers untouched', () => {
  const f = fixture();
  for (const panel of f.panels) assert.deepEqual(Object.keys(panel.style), [], panel.id + ' must not receive geometry overrides.');
  const world = f.panels[0]; assert.equal(world.children.length, 0); assert.equal(world.className, '');
  for (const panel of f.panels.filter(p => core.includes(p.id))) {
    assert.equal(panel.children.length, 9); assert.equal(panel.children[0].tagName, 'HEADER');
    assert.deepEqual(Object.keys(panel.children[0].style), []);
    assert.equal(panel.children[0].listeners.pointerdown, undefined, 'Do not replace existing header dragging.');
  }
  assert.equal(f.root.WindowUi.fit, undefined); assert.equal(f.root.WindowUi.restore, undefined);
});

test('every resize edge keeps the opposite edge fixed and respects viewport boundaries', () => {
  const initial = { left: 100, top: 100, width: 400, height: 300 };
  assert.deepEqual(UI.bounds(initial, 1200, 900, 'nw', -20, -30), { left: 80, top: 70, width: 420, height: 330 });
  assert.deepEqual(UI.bounds(initial, 1200, 900, 'se', 20, 30), { left: 100, top: 100, width: 420, height: 330 });
  for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) for (const delta of [-3000, -10, 10, 3000]) {
    const r = UI.bounds(initial, 1200, 900, edge, delta, delta);
    assert.ok(r.left >= 0 && r.top >= 0 && r.width >= 140 && r.height >= 90 && r.left + r.width <= 1200 && r.top + r.height <= 900);
    if (edge.includes('w')) assert.equal(r.left + r.width, initial.left + initial.width);
    if (edge.includes('n')) assert.equal(r.top + r.height, initial.top + initial.height);
    if (edge.includes('e')) assert.equal(r.left, initial.left);
    if (edge.includes('s')) assert.equal(r.top, initial.top);
  }
});

test('only active resize gestures change geometry, on all eight edges at every UI zoom', () => {
  for (const scale of [1, 1.75, 2.25]) for (const id of core) for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const f = fixture(scale), panel = f.panels.find(p => p.id === id), initial = panel.getBoundingClientRect();
    const expected = UI.bounds(initial, f.root.innerWidth, f.root.innerHeight, edge, -10, -10);
    f.resize(panel, edge, -10, -10);
    for (const k of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(panel.getBoundingClientRect()[k] - expected[k]) < 1e-8, id + '/' + edge + '/' + k);
    const settled = { ...panel.style };
    f.handlers.pointermove.fn({ pointerId: 7, clientX: -500, clientY: -500 });
    f.callbacks.mutation([{ target: panel, addedNodes: [f.node()] }]);
    assert.deepEqual({ ...panel.style }, settled, 'Content refreshes must not reapply bounds or shake a resized panel.');
    for (const other of f.panels.filter(p => p !== panel)) assert.deepEqual(Object.keys(other.style), []);
    assert.equal(f.handlers.pointermove.capture, true); assert.equal(f.handlers.pointerup.capture, true);
  }
});

test('console/log retain right and bottom anchors during resizing; compact map keeps top-left anchoring', () => {
  for (const id of core) {
    const f = fixture(), panel = f.panels.find(p => p.id === id), before = panel.getBoundingClientRect();
    f.resize(panel, 'nw', 15, 20);
    const after = panel.getBoundingClientRect();
    assert.equal(after.right, before.right); assert.equal(after.bottom, before.bottom);
    if (id === 'combat-popup') assert.equal(panel.style.right, 'auto');
    else assert.equal(panel.style.left, 'auto');
    if (id === 'game-log-popup') assert.equal(panel.style.top, 'auto');
  }
});

test('menu tabs span their padding without resizing or moving any menu and do not duplicate existing headers', () => {
  const f = fixture(), panel = f.panels.find(p => p.id === 'save-game-dialog'), header = panel.children[0];
  assert.equal(header.className, 'window-menu-tab');
  for (const [side, value] of Object.entries({ top: '22px', left: '16px', right: '28px' }))
    assert.equal(header.style.getPropertyValue('--menu-padding-' + side), value);
  assert.equal(header.children[0].textContent, 'Save and load adventure');
  f.callbacks.mutation([{ target: panel, addedNodes: [f.node()] }]);
  assert.equal(panel.children.length, 1); assert.deepEqual(Object.keys(panel.style), []);
  assert.equal(f.panels.find(p => p.id === 'art-dialog').children.length, 1);
  assert.equal(f.panels.find(p => p.id === 'embedded-actions').children.length, 0);
  const css = f.styles.map(s => s.textContent).join('');
  assert.ok(css.includes('position:sticky;top:calc(-1 * var(--menu-padding-top,0px))'));
  assert.ok(css.includes('width:calc(100% + var(--menu-padding-left,0px) + var(--menu-padding-right,0px))'));
  assert.ok(css.includes('calc(-1 * var(--menu-padding-top,0px))'));
  assert.equal(f.callbacks.observed.attributes, undefined, 'Do not observe style changes or create resize feedback loops.');
});

test('menu close tabs respect cancellation while a save/load operation is working', () => {
  const f = fixture(), panel = f.panels.find(p => p.id === 'save-game-dialog'), close = panel.children[0].children[1];
  panel.listeners.cancel = event => event.preventDefault(); close.listeners.click(); assert.equal(panel.open, true);
  delete panel.listeners.cancel; close.listeners.click(); assert.equal(panel.open, false);
});

test('new menus receive one tab without applying layout to the world or existing panels', () => {
  const f = fixture(), panel = f.node('DIALOG'); panel.id = 'new-menu';
  f.callbacks.mutation([{ target: f.node(), addedNodes: [panel] }]);
  assert.equal(panel.children[0].className, 'window-menu-tab'); assert.deepEqual(Object.keys(panel.style), []);
  f.callbacks.mutation([{ target: panel, addedNodes: [panel.children[0]] }]);
  assert.equal(panel.children.length, 1);
  for (const existing of f.panels) assert.deepEqual(Object.keys(existing.style), []);
});

test('window helper cannot automatically fit, drag, restore or relayout the fullscreen view and core panels', () => {
  const source = fs.readFileSync(require.resolve('../assets/windowUi'), 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|placed|function fit\(|function restore\(|attributes:\s*true|addEventListener\('resize'/);
  for (const file of ['index.html', 'combatTacticalUi.js', 'combatCharacterUi.js', 'campaignBuilderUi.js', 'partySpellbookUi.js', 'adventureJournalUi.js'])
    assert.doesNotMatch(fs.readFileSync(require.resolve('../assets/' + file), 'utf8'), /WindowUi\?\.restore/);
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  assert.match(html, /#dungeon-popup\s*\{[^}]*position: fixed;[^}]*inset: 0;/);
  for (const [id, anchor] of [['phaser-popup', /top: 5px;[^}]*right: 5px;/], ['game-log-popup', /right: 5px;[^}]*bottom: 5px;/], ['combat-popup', /top: 42px;[^}]*left: 5px;/]]) {
    const rules = [...html.matchAll(new RegExp('#' + id + '\\s*\\{[^}]*\\}', 'g'))].map(m => m[0]);
    assert.ok(rules.some(rule => anchor.test(rule)), id + ' keeps its original anchor rule.');
  }
});
