'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync('assets/index.html', 'utf8');
const source = html.slice(html.indexOf('    function positionPartyIconDock()'), html.indexOf('    function renderPartyInfoPopup()'));
function mount(scale = 1.75, width = 2048, height = 1095, overrides = {}) {
  const css = {}, style = { setProperty: (key, value) => css[key] = value };
  const dock = { style, get offsetWidth() { return parseFloat(style.width) || 252; }, getBoundingClientRect() {
    const w = this.offsetWidth * scale, h = Math.min(340 * scale, parseFloat(style.maxHeight || '1000') * scale);
    const bottom = height - parseFloat(style.bottom || '6') * scale;
    return { left: 8 * scale, right: 8 * scale + w, width: w, height: h, top: bottom - h, bottom };
  } };
  const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  const panels = { chatbotcontainer: rect(606, height - 172, 836, 170), 'dungeon-compass': rect(418, height - 260, 178, 258),
    'combat-popup': rect(4, 80, 315, 462), 'game-menu-toggle': rect(14, 21, 137, 47), ...overrides };
  const context = { window: { innerWidth: width, innerHeight: height }, document: {
    getElementById: id => id === 'party-icon-dock' ? dock : panels[id] ? { getBoundingClientRect: () => panels[id] } : null } };
  vm.runInNewContext(source, context);
  return { dock, css, panels, position: context.positionPartyIconDock };
}

for (const scale of [1, 1.3125, 1.75, 2]) test(`party avatars fit the bottom-left gap instead of being lifted above the compass at ${scale}x zoom`, () => {
  const f = mount(scale); f.position();
  const r = f.dock.getBoundingClientRect();
  assert.equal(parseFloat(f.dock.style.bottom), 6);
  assert.ok(r.right <= f.panels['dungeon-compass'].left - 6 * scale);
  assert.ok(r.top >= f.panels['combat-popup'].bottom);
  assert.equal(f.css['--party-slot-width'], 'calc(50% - 2px)');
  assert.ok(r.height <= 1095 - f.panels['combat-popup'].bottom);
});

test('small left gaps use one column and scrolling without shrinking the portraits or clipping names', () => {
  const f = mount(1.75, 1100, 900, { 'dungeon-compass': { left: 300, right: 478, top: 640, bottom: 898, width: 178, height: 258 } });
  f.position();
  assert.equal(f.css['--party-slot-width'], '100%');
  assert.equal(parseFloat(f.dock.style.bottom), 6);
  assert.ok(f.dock.getBoundingClientRect().right < 300);
  assert.match(html, /\.party-icon-canvas\s*\{\s*width: 36px;\s*height: 36px;/);
});

test('narrow viewports stack the dock above controls without moving off-screen', () => {
  const f = mount(1.3125, 540, 900, { chatbotcontainer: { left: 20, right: 520, top: 700, bottom: 898, width: 500, height: 198 },
    'dungeon-compass': { left: 10, right: 140, top: 430, bottom: 690, width: 130, height: 260 } });
  f.position();
  const r = f.dock.getBoundingClientRect();
  assert.ok(r.bottom < 430);
  assert.ok(r.left >= 0 && r.right <= 540 && r.top >= 0);
});

test('resizing or hiding the compass restores bottom anchoring and the available width', () => {
  const f = mount(); f.position();
  const before = parseFloat(f.dock.style.width);
  Object.assign(f.panels['dungeon-compass'], { width: 0, height: 0 });
  f.position();
  assert.ok(parseFloat(f.dock.style.width) > before);
  assert.equal(parseFloat(f.dock.style.bottom), 6);
  f.position();
  assert.equal(parseFloat(f.dock.style.bottom), 6);
});
