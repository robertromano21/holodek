const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function mount(scale, commandBounds, viewport = { width: 2000, height: 1100 }) {
  const events = {}, observed = [];
  let resize;
  const nodes = new Map();
  function node() { return { style: {}, children: [], addEventListener() {}, appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; }, setAttribute() {}, classList: { toggle() {} } }; }
  const command = { getBoundingClientRect: () => commandBounds };
  const panel = {
    style: {}, offsetWidth: 86,
    getBoundingClientRect: () => ({ width: 86 * scale }),
    setAttribute() {},
    querySelector: selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); }
  };
  const document = {
    getElementById: id => id === 'chatbotcontainer' ? command : null,
    createElement: tag => tag === 'div' ? panel : node(),
    body: { appendChild() {} },
    addEventListener: (name, callback) => { events[name] = callback; }
  };
  const window = {
    innerWidth: viewport.width, innerHeight: viewport.height,
    addEventListener: (name, callback) => { events[name] = callback; },
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe(element) { observed.push(element); }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/compassUi'), 'utf8'), { window, document });
  events.DOMContentLoaded();
  return { panel, command, events, observed, resize };
}

for (const scale of [1, 1.75, 2]) {
  test(`compass is left of the command prompt at ${scale}x CSS zoom`, () => {
    const r = { left: 600, right: 1400, top: 900, bottom: 1096 };
    const { panel } = mount(scale, r);
    const physicalRight = (parseFloat(panel.style.left) + panel.offsetWidth) * scale;
    assert.equal(physicalRight, r.left - 8 * scale);
    assert.equal(parseFloat(panel.style.bottom) * scale, 4);
    assert.equal(panel.style.right, 'auto');
  });
}

test('narrow screens put the compass above the input rather than overlapping it', () => {
  const r = { left: 20, right: 300, top: 400, bottom: 550 };
  const { panel } = mount(1.75, r, { width: 320, height: 560 });
  assert.equal(panel.style.left, '8px');
  const physicalBottom = 560 - parseFloat(panel.style.bottom) * 1.75;
  assert.equal(physicalBottom, r.top - 8 * 1.75);
});

test('compass follows resized commands and observes its own size', () => {
  const r = { left: 600, right: 1400, top: 900, bottom: 1096 };
  const ui = mount(1.75, r);
  assert.deepEqual(ui.observed, [ui.command, ui.panel]);
  r.left = 500;
  ui.events.resize();
  assert.equal(parseFloat(ui.panel.style.left), (500 - 86 * 1.75) / 1.75 - 8);
  r.top = 800;
  r.left = 20;
  ui.resize();
  assert.equal(parseFloat(ui.panel.style.bottom), (1100 - 800) / 1.75 + 8);
});

test('start transcript uses natural left alignment and exit prompts keep original popup placement', () => {
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  const transcript = html.match(/#chatlog-background-content\s*\{([^}]+)\}/)[1];
  assert.match(transcript, /text-align:\s*left/);
  const popup = html.match(/\.popup-container\s*\{([^}]+)\}/)[1];
  assert.match(popup, /top:\s*310px/);
  assert.match(popup, /right:\s*5px/);
  const game = fs.readFileSync(require.resolve('../assets/game'), 'utf8');
  const exitPlacement = game.split('popup.dataset.dungeonExit = exitDirection;')[1].split('// Go -> move')[0];
  assert.doesNotMatch(exitPlacement, /popup\.style\.(?:top|position)/);
});
