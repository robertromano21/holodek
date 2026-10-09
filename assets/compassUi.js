(function(root) {
  'use strict';
  function heading(angle) {
    const degrees = ((angle * 180 / Math.PI + 90) % 360 + 360) % 360;
    return { degrees, label: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8] };
  }
  let panel, rose, readout, pins, select, exitReadout, last = null;
  let navigation = null, pinKey = '', selected = '', lastNavigation = '';
  const pinNodes = new Map();
  function setNavigation(dungeon, player) {
    navigation = dungeon && player ? { dungeon, player } : null;
  }
  function selectExit(direction) {
    selected = direction || '';
    if (select) select.value = selected;
    lastNavigation = '';
    update(root.playerAngle ?? -Math.PI / 2);
  }
  function position() {
    const command = document.getElementById('chatbotcontainer');
    if (!panel || !command) return;
    const r = command.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    // Screen rectangles include the page's CSS zoom; fixed offsets do not.
    const scale = panel.offsetWidth ? bounds.width / panel.offsetWidth : 1;
    const left = (r.left - bounds.width) / scale - 8;
    panel.style.right = 'auto';
    panel.style.left = Math.max(8, left) + 'px';
    panel.style.bottom = left >= 8
      ? Math.max(2, (root.innerHeight - r.bottom) / scale) + 'px'
      : Math.max(8, (root.innerHeight - r.top) / scale + 8) + 'px';
  }
  function update(angle) {
    if (!panel || !Number.isFinite(angle)) return;
    const h = heading(angle), d = Math.round(h.degrees);
    const exits = navigation && root.DungeonCartography ? root.DungeonCartography.bearings(navigation.dungeon, navigation.player, angle) : [];
    const key = `${navigation?.dungeon._meta?.runId || ''}:${navigation?.dungeon.geoKey || ''}:` +
      exits.map(e => `${e.direction}:${e.x},${e.y}`).sort().join('|');
    if (key !== pinKey && pins && select) {
      pinKey = key; pinNodes.clear(); pins.replaceChildren(); select.replaceChildren(); selected = '';
      const nearest = document.createElement('option'); nearest.value = ''; nearest.textContent = 'Nearest exit'; select.appendChild(nearest);
      for (const exit of exits.slice().sort((a, b) => a.direction.localeCompare(b.direction))) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'compass-exit-pin';
        button.textContent = exit.label; button.addEventListener('click', () => selectExit(exit.direction));
        pins.appendChild(button); pinNodes.set(exit.direction, button);
        const option = document.createElement('option'); option.value = exit.direction; option.textContent = `${exit.label} exit`; select.appendChild(option);
      }
      select.hidden = !exits.length;
    }
    const target = exits.find(e => e.direction === selected) || exits[0];
    const signature = exits.map(e => `${e.direction}:${Math.round(e.distance)}:${Math.round(e.relative * 90)}`).join('|') + selected;
    if (d === last && signature === lastNavigation) return;
    last = d;
    lastNavigation = signature;
    rose.style.transform = `rotate(${-h.degrees}deg)`;
    readout.textContent = `${h.label} ${d % 360}\u00b0`;
    panel.setAttribute('aria-label', `Compass: facing ${h.label}, ${d % 360} degrees`);
    for (const exit of exits) {
      const button = pinNodes.get(exit.direction);
      if (!button) continue;
      button.style.left = `${50 + exit.ringX * 44}%`;
      button.style.top = `${50 + exit.ringY * 44}%`;
      button.classList.toggle('compass-exit-active', exit === target);
      button.title = `${exit.direction} exit: ${Math.round(exit.distance)} tiles away. Direct bearing; obstacles may require a detour.`;
      button.setAttribute('aria-label', button.title);
    }
    if (exitReadout) exitReadout.textContent = target ? `${target.label}: ${Math.round(target.distance)} tiles` : 'No exits yet';
  }
  function init() {
    if (document.getElementById('dungeon-compass')) return;
    panel = document.createElement('div'); panel.id = 'dungeon-compass'; panel.setAttribute('role', 'group');
    panel.innerHTML = '<div class="compass-dial"><div class="compass-rose"><span class="compass-n">N</span><span class="compass-e">E</span><span class="compass-s">S</span><span class="compass-w">W</span></div><div class="compass-pointer"></div><div class="compass-exit-pins"></div></div><small class="compass-readout"></small><small class="compass-exit-readout"></small><select class="compass-exit-select" aria-label="Track an exit"></select>';
    document.body.appendChild(panel);
    rose = panel.querySelector('.compass-rose'); readout = panel.querySelector('.compass-readout');
    pins = panel.querySelector('.compass-exit-pins'); select = panel.querySelector('.compass-exit-select'); exitReadout = panel.querySelector('.compass-exit-readout');
    select.addEventListener('change', () => selectExit(select.value));
    position(); update(root.playerAngle ?? -Math.PI / 2);
    root.addEventListener('resize', position);
    const command = document.getElementById('chatbotcontainer');
    if (root.ResizeObserver && command) {
      const observer = new root.ResizeObserver(position);
      observer.observe(command);
      observer.observe(panel);
    }
  }
  const api = { heading, update, setNavigation, selectExit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DungeonCompass = api; document.addEventListener('DOMContentLoaded', init); }
})(typeof window === 'undefined' ? globalThis : window);
