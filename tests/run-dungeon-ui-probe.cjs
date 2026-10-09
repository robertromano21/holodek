const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'assets/index.html'), 'utf8');
const css = [...index.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const menu = index.slice(index.indexOf('<button id="game-menu-toggle"'), index.indexOf('<!-- Music control button'));
const consoleToggle = index.slice(index.indexOf('function togglePopup()'), index.indexOf('function toggleDungeonPopup()'));
const logToggle = index.slice(index.indexOf('function toggleGameLogPopup()'), index.indexOf('function togglePartyPopup()'));
const inventoryStart = index.indexOf('<button id="dungeon-inventory-shortcut"');
const inventoryMarkup = index.slice(inventoryStart, index.indexOf('</section>', inventoryStart) + '</section>'.length);
const game = fs.readFileSync(path.join(root, 'assets/game.js'), 'utf8');
const actionStart = game.indexOf('// Add event listener to clickable objects inside contentDiv');
const actionHandlers = game.slice(actionStart, game.indexOf('// ---- Exit click handler', actionStart));
const equipmentFunctions = game.slice(game.indexOf('function equipItem('), game.indexOf('function rollDice(', game.indexOf('function equipItem(')));
const scripts = ['renderSceneItems', 'sceneObjectSync', 'partyRoster', 'dungeonCartography', 'compassUi', 'explorationMapUi', 'inventoryUi', 'itemInteractionUi', 'mapShortcutUi', 'gameMenuUi'];
const page = String.raw`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
${scripts.map(name => `<script src="/assets/${name}.js"></script>`).join('')}
</head><body>${menu}<button id="play-music-btn" style="display:none">Play Music</button>
<div id="phaser-popup"><div id="phaser-header">Game Console</div><div id="phaser-container">Fixture room</div></div>
<div id="combat-popup"><div id="combat-header">Combat Map</div></div>
<div id="game-log-popup"><div id="game-log-header">Game Log</div></div>
<div id="chatbotcontainer"><p><textarea id="chatuserinput" placeholder="Type a command"></textarea></p><button>Command</button></div>
<button id="dungeon-map-shortcut" aria-controls="exploration-map-popup"><img src="/assets/adventurers-map.svg" alt=""></button>
${inventoryMarkup}
<div id="party-icon-dock"><div data-party-slot="0"><button class="party-icon-button" onclick="openPartySheet(0)">Mortacia</button></div><div data-party-slot="1"><button class="party-icon-button" onclick="openPartySheet(1)">Zarthul</button></div></div>
<pre id="results"></pre><script>
function syncGameLogTranscript() {}
${consoleToggle}
${logToggle}
const makeCharacter = (Name, type) => ({ Name, type, HP: 20, MaxHP: 20, Attack: 0, Damage: 0, Armor: 0, Magic: 0,
  Equipped: { Weapon: null, Armor: null, Shield: null, Other: null } });
let characters = [makeCharacter('Mortacia', 'pc')], npcs = [makeCharacter('Zarthul the Veiled Sentinel', 'npc')];
const stock = [
  { name: 'bronze sword', type: 'weapon', attack_modifier: 1, damage_modifier: 2, ac: 0, magic: 0 },
  { name: 'iron sword', type: 'weapon', attack_modifier: 3, damage_modifier: 4, ac: 0, magic: 0 },
  { name: 'moon mail', type: 'armor', attack_modifier: 0, damage_modifier: 0, ac: 3, magic: 0 },
  { name: 'round shield', type: 'shield', attack_modifier: 0, damage_modifier: 0, ac: 2, magic: 0 },
  { name: 'silver amulet', type: 'other', attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 2 },
  { name: 'silver dagger', type: 'weapon', attack_modifier: 1, damage_modifier: 1, ac: 0, magic: 0 }
];
let inventory = stock.slice(0, 5).map(item => item.name), inventoryProperties = stock.slice(0, 5).map(item => JSON.stringify(item));
let pc = '', npcText = '', roomItems = ['silver dagger'], pickupDungeon, sheetClicks = 0;
const commands = [], contentDiv = document.getElementById('phaser-container');
function sheet(character) { return [character.Name, 'Female', 'Human', 'Adventurer', 'Level: 1', 'AC: 10', 'XP: 0',
  'HP: ' + character.HP, 'MaxHP: ' + character.MaxHP, 'Equipped: ' + Object.entries(character.Equipped).map(([slot, item]) => slot + ': ' + (item?.name || 'None')).join(', '),
  'Attack: ' + character.Attack, 'Damage: ' + character.Damage, 'Armor: ' + character.Armor, 'Magic: ' + character.Magic].join('\n'); }
window.getPartyInfoEntries = () => [...characters, ...npcs].map(source => ({ label: source.Name, source: { ...source, sheet: sheet(source) } }));
function openPartySheet() { sheetClicks++; }
function refreshFixture() {
  pc = sheet(characters[0]); npcText = npcs.map(sheet).join('\n');
  contentDiv.replaceChildren();
  for (const [names, className, attribute] of [[inventory, 'clickable-inventory', 'data-object'], [roomItems, 'clickable-object', 'data-object']]) {
    for (const name of names) { const link = document.createElement('span'); link.className = className; link.setAttribute(attribute, name); link.textContent = name; contentDiv.appendChild(link); }
  }
  for (const character of [...characters, ...npcs]) for (const item of Object.values(character.Equipped).filter(Boolean)) {
    const link = document.createElement('span'); link.className = 'clickable-equipped'; link.dataset.item = item.name; link.dataset.character = character.Name; link.textContent = item.name; contentDiv.appendChild(link);
  }
  InventoryUi.update({ inventory: inventory.join(', ') || 'Empty', inventoryProperties: inventoryProperties.join(', ') || 'None', pc, npcs: npcText });
  if (pickupDungeon) SceneObjectSync.sync(pickupDungeon, 'Coordinates: X: 0, Y: 0, Z: 0\nObjects in Room: ' + (roomItems.join(', ') || 'None') + '\nObjects in Room Properties: ' + JSON.stringify(stock[5]));
}
${equipmentFunctions}
async function chatbotprocessinput() {
  const input = document.getElementById('chatuserinput').value; commands.push(input);
  if (input.startsWith('unequip ')) { const parts = input.slice(8).split(' from '); unequipItem(parts[0], parts[1] || null); }
  else if (input.startsWith('equip ')) { const parts = input.slice(6).split(' to '); equipItem(parts[0], parts[1] || null); }
  else if (input === 'take silver dagger') { roomItems = []; inventory.push(stock[5].name); inventoryProperties.push(JSON.stringify(stock[5])); }
  await Promise.resolve(); refreshFixture();
}
function bindOriginalActions() { const npcs = npcText; ${actionHandlers} }
window.addEventListener('DOMContentLoaded', async () => {
  const checks = {}, errors = [];
  window.addEventListener('error', e => errors.push(e.message));
  try {
    window.dungeonRunId = 'ui-probe'; window.playerAngle = -Math.PI / 2;
    const d = { geoKey: '0,0,0', _meta: { runId: 'ui-probe' }, layout: { width: 64, height: 64 },
      start: { x: 32, y: 32 }, cells: {}, classification: { indoor: false }, sceneSpec: { source: { roomName: 'UI probe' } },
      roomExits: { markers: [{ direction: 'west', label: 'W', x: 45, y: 32 }, { direction: 'up', label: 'UP', x: 32, y: 15 }] } };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.cells[x + ',' + y] = { tile: 'floor', floorHeight: 0 };
    const player = { x: 32.5, y: 32.5 };
    DungeonCompass.setNavigation(d, player); DungeonCompass.update(playerAngle);
    DungeonExplorationMap.update(d, player, playerAngle, dungeonRunId);
    GameMenuUi.onDungeonReady(d);
    const ids = ['phaser-popup', 'combat-popup', 'game-log-popup'];
    checks.autoOpened = ids.every(id => document.getElementById(id).style.display === 'block');
    const c = document.getElementById('dungeon-compass').getBoundingClientRect(), command = document.getElementById('chatbotcontainer').getBoundingClientRect();
    checks.compassOutsideInput = c.right < command.left || c.bottom < command.top;
    checks.exitPins = document.querySelectorAll('.compass-exit-pin').length === 2;
    checks.distance = document.querySelector('.compass-exit-readout').textContent.includes('13 tiles');
    const log = document.getElementById('game-log-popup').getBoundingClientRect();
    checks.logBottomRight = Math.abs(innerWidth - log.right - 8.75) < 2 && Math.abs(innerHeight - log.bottom - 8.75) < 2;
    const combat = document.getElementById('combat-popup').getBoundingClientRect();
    checks.combatTopLeft = Math.abs(combat.left - 8.75) < 2 && Math.abs(combat.top - 73.5) < 2;
    checks.menuInitiallyHidden = document.getElementById('game-menu').hidden;
    document.getElementById('game-menu-toggle').click();
    checks.menuOpened = !document.getElementById('game-menu').hidden;
    checks.movedControls = document.getElementById('game-menu').contains(document.getElementById('combat-mode-toggle'));
    document.getElementById('open-exploration-map-button').click();
    checks.mapOpenedMenuClosed = document.getElementById('exploration-map-popup').style.display === 'block' && document.getElementById('game-menu').hidden;
    const map = document.getElementById('exploration-map-popup').getBoundingClientRect();
    checks.mapFitsViewport = map.left >= 0 && map.right <= innerWidth && map.bottom <= innerHeight;
    checks.mapCentered = Math.abs((map.left + map.right) / 2 - innerWidth / 2) < 2;
    checks.mapAboveCommand = map.bottom < command.top;
    const mapPanel = document.getElementById('exploration-map-popup');
    checks.mapFullyVisible = mapPanel.scrollHeight <= mapPanel.clientHeight + 1;
    if (innerWidth >= 1000) {
      const consoleBounds = document.getElementById('phaser-popup').getBoundingClientRect();
      checks.mapBetweenSidePanels = map.left > combat.right && map.right < consoleBounds.left;
    }
    const pixel = document.getElementById('exploration-map-canvas').getContext('2d').getImageData(320, 320, 1, 1).data;
    checks.mapPainted = pixel[0] > 8;
    document.getElementById('dungeon-map-shortcut').click();
    checks.parchmentClosesMap = document.getElementById('exploration-map-popup').style.display === 'none';
    document.getElementById('dungeon-map-shortcut').click();
    checks.parchmentOpensMap = document.getElementById('exploration-map-popup').style.display === 'block';
    document.getElementById('game-log-popup').style.display = 'none'; GameMenuUi.onDungeonReady(d);
    checks.userCloseRespected = document.getElementById('game-log-popup').style.display === 'none';
    DungeonExplorationMap.toggle(false);
    refreshFixture(); bindOriginalActions();
    const pack = document.getElementById('dungeon-inventory-shortcut').getBoundingClientRect(), parchment = document.getElementById('dungeon-map-shortcut').getBoundingClientRect();
    checks.inventoryAboveMap = Math.abs(pack.left - parchment.left) < 2 && pack.bottom < parchment.top && pack.top >= 0;
    document.getElementById('dungeon-inventory-shortcut').click();
    checks.inventoryOpened = !document.getElementById('inventory-popup').hidden;
    checks.inventoryGrouped = [...document.querySelectorAll('.inventory-category h3')].map(heading => heading.textContent).join('|') === 'Weapons (2)|Armor (1)|Shields (1)|Other (1)';
    const inventoryBounds = document.getElementById('inventory-popup').getBoundingClientRect();
    checks.inventoryFitsAboveInput = inventoryBounds.top >= 0 && inventoryBounds.bottom < command.top && inventoryBounds.right <= innerWidth;
    const itemCanvas = document.querySelector('.inventory-item canvas');
    checks.inventorySpritesPainted = itemCanvas.getContext('2d').getImageData(0, 0, 32, 32).data.some((value, i) => i % 4 === 3 && value > 0);
    const itemButton = name => [...document.querySelectorAll('.inventory-item')].find(button => button.dataset.inventoryItem === name);
    itemButton('bronze sword').click();
    document.querySelector('[data-party-slot="1"] .party-icon-button').click();
    checks.clickTargetPreselected = document.getElementById('character-select')?.value === 'Zarthul the Veiled Sentinel' && sheetClicks === 0 && commands.length === 0;
    document.getElementById('cancel-equip').click();
    checks.cancelDoesNothing = inventory.includes('bronze sword') && npcs[0].Equipped.Weapon === null && commands.length === 0;
    InventoryUi.toggle(true);
    const transfer = new DataTransfer();
    itemButton('bronze sword').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    document.querySelector('[data-party-slot="1"] .party-icon-button').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    checks.dragTargetPreselected = document.getElementById('character-select')?.value === 'Zarthul the Veiled Sentinel';
    document.getElementById('confirm-equip').click(); await new Promise(resolve => setTimeout(resolve, 5));
    checks.npcEquipUsesOriginalText = commands.at(-1) === 'equip bronze sword to Zarthul the Veiled Sentinel' && npcs[0].Equipped.Weapon?.name === 'bronze sword';
    InventoryUi.requestEquip('iron sword', 'Zarthul the Veiled Sentinel');
    checks.replacementStartsWithUnequip = !!document.getElementById('unequip-button') && !document.getElementById('confirm-equip');
    document.getElementById('cancel-button').click();
    checks.cancelReplacementPreservesGear = npcs[0].Equipped.Weapon.name === 'bronze sword' && inventory.includes('iron sword') && npcs[0].Attack === 1;
    InventoryUi.requestEquip('iron sword', 'Zarthul the Veiled Sentinel'); document.getElementById('unequip-button').click();
    await new Promise(resolve => setTimeout(resolve, 5));
    checks.unequipThenEquipPopup = commands.at(-1) === 'unequip bronze sword from Zarthul the Veiled Sentinel' && npcs[0].Equipped.Weapon === null &&
      inventory.includes('bronze sword') && document.getElementById('character-select')?.value === 'Zarthul the Veiled Sentinel';
    document.getElementById('confirm-equip').click(); await new Promise(resolve => setTimeout(resolve, 5));
    checks.replacementDoesNotStack = commands.at(-1) === 'equip iron sword to Zarthul the Veiled Sentinel' && npcs[0].Attack === 3 && npcs[0].Damage === 4 && inventory.includes('bronze sword');
    InventoryUi.requestEquip('bronze sword', 'Zarthul the Veiled Sentinel'); document.getElementById('unequip-button').click();
    await new Promise(resolve => setTimeout(resolve, 5)); document.getElementById('cancel-equip').click();
    checks.cancelSecondPromptDoesNotEquip = npcs[0].Equipped.Weapon === null && npcs[0].Attack === 0 && inventory.includes('bronze sword') && inventory.includes('iron sword');
    InventoryUi.toggle(true); itemButton('silver amulet').click(); document.querySelector('[data-party-slot="0"] .party-icon-button').click();
    document.getElementById('confirm-equip').click(); await new Promise(resolve => setTimeout(resolve, 5));
    checks.pcEquipUsesOriginalText = commands.at(-1) === 'equip silver amulet' && characters[0].Magic === 2;
    document.getElementById('chatuserinput').value = 'equip bronze sword to Zarthul the Veiled Sentinel';
    await chatbotprocessinput();
    checks.textInterfaceStillEquips = npcs[0].Equipped.Weapon?.name === 'bronze sword' && npcs[0].Attack === 1;
    pickupDungeon = { ...d, sceneObjects: [{ name: 'silver dagger', type: 'weapon', x: 32, y: 32 }], _geometryStamp: 'fixture' };
    const cellsBefore = JSON.stringify(pickupDungeon.cells), beforeCommands = commands.length;
    ItemInteractionUi.update(pickupDungeon, pickupDungeon.sceneObjects, player);
    checks.proximityAsksBeforeTake = !!document.getElementById('take-button') && commands.length === beforeCommands && pickupDungeon.sceneObjects.length === 1;
    document.getElementById('cancel-button').click();
    ItemInteractionUi.update(pickupDungeon, pickupDungeon.sceneObjects, player);
    checks.pickupCancelKeepsItem = !document.getElementById('take-button') && pickupDungeon.sceneObjects.length === 1;
    ItemInteractionUi.update(pickupDungeon, pickupDungeon.sceneObjects, { x: 30, y: 30 });
    ItemInteractionUi.update(pickupDungeon, pickupDungeon.sceneObjects, player);
    document.getElementById('take-button').click(); await new Promise(resolve => setTimeout(resolve, 5));
    checks.takeRemovesOnlyItem = commands.at(-1) === 'take silver dagger' && inventory.includes('silver dagger') && pickupDungeon.sceneObjects.length === 0 &&
      JSON.stringify(pickupDungeon.cells) === cellsBefore && pickupDungeon._geometryStamp === 'fixture';
    await new Promise(resolve => setTimeout(resolve, 20));
  } catch (error) { errors.push(error.stack); }
  document.getElementById('results').textContent = JSON.stringify({ pass: Object.values(checks).every(Boolean) && !errors.length, checks, errors });
});
</script></body></html>`;

for (const [, script] of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script);

(async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(page); return; }
    if (['/assets/adventurers-map.svg', '/assets/adventurers-pack.svg'].includes(request.url)) { response.setHeader('Content-Type', 'image/svg+xml'); response.end(fs.readFileSync(path.join(root, request.url.slice(1)))); return; }
    const name = /^\/assets\/(\w+)\.js$/.exec(request.url)?.[1];
    if (!scripts.includes(name)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'application/javascript'); response.end(fs.readFileSync(path.join(root, 'assets', name + '.js')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = process.env.GPU_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-ui-probe-'));
  const size = process.argv.includes('--narrow') ? '540,900' : '1680,950';
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=' + size,
    '--virtual-time-budget=2500', '--dump-dom', '--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const timeout = setTimeout(() => child.kill(), 30000);
  const error = await new Promise(resolve => { child.once('error', resolve); child.once('close', () => resolve(null)); });
  clearTimeout(timeout); server.close();
  let report;
  try { report = JSON.parse(stdout.match(/<pre id="results">([^<]*)<\/pre>/)?.[1]); }
  catch { report = { pass: false, error: error?.message || 'No browser probe report', stderr: stderr.slice(-2000) }; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.pass ? 0 : 1;
})();
