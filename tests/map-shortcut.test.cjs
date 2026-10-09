const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { placement } = require('../assets/mapShortcutUi');
test('small parchment button occupies the gap between command prompt and game log, including CSS zoom', () => {
  for (const zoom of [1, 1.75, 2]) {
    const command = { left: 800, right: 1550, top: 900, bottom: 1096 };
    const log = { left: 1900, width: 450, top: 560 };
    const p = placement(command, 38, { width: 2400, height: 1100 }, log, zoom);
    assert.equal(p.left * zoom, command.right + 8 * zoom);
    assert.ok((p.left + 38) * zoom < log.left);
    assert.ok(p.bottom * zoom >= 4);
  }
});
test('tight screens place the shortcut above the panels rather than covering command entry', () => {
  const command = { right: 500, top: 700, bottom: 896 }, log = { left: 100, top: 360, width: 400 };
  const p = placement(command, 38, { width: 540, height: 900 }, log, 1.75);
  assert.ok(900 - p.bottom * 1.75 < log.top);
  assert.ok((p.left + 38) * 1.75 <= 540);
});
test('shortcut uses a real parchment SVG and opens the same overhead map', () => {
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  assert.match(html, /id="dungeon-map-shortcut"[^>]+aria-controls="exploration-map-popup"/);
  assert.match(html, /src="\/assets\/adventurers-map\.svg"/);
  const script = fs.readFileSync(require.resolve('../assets/mapShortcutUi'), 'utf8');
  assert.match(script, /root\.DungeonExplorationMap\?\.toggle\(\)/);
  const svg = fs.readFileSync(require.resolve('../assets/adventurers-map.svg'), 'utf8');
  assert.match(svg, /linearGradient/); assert.match(svg, /stroke-dasharray/);
});
