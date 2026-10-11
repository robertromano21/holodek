const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('../assets/dungeonInhabitants');
const C = require('../assets/dungeonCartography');
const continued = require('./fixtures/continued-dialogue.cjs');
const zharok = require('./fixtures/zharok-dialogue.cjs');

function fixture() {
  let now = 1000;
  const nodes = new Map(), reports = [], timers = [], posts = [];
  function element() {
    const node = { style: {}, hidden: true, textContent: '', offsetWidth: 500, children: [],
      setAttribute() {}, removeAttribute() {}, addEventListener() {}, blur() {}, append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      getBoundingClientRect: () => ({ left: 300, top: 750, width: 500, height: 80 }) };
    Object.defineProperty(node, 'id', { get: () => node._id, set: id => { node._id = id; nodes.set(id, node); } });
    return node;
  }
  nodes.set('chatuserinput', element());
  const d = { geoKey: '1,0,0', layout: { width: 32, height: 32 }, cells: {} };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) d.cells[`${x},${y}`] = { tile: 'floor', floorHeight: 0, ceilHeight: 6 };
  const actor = { name: 'Vyrixa Shadowtide', type: 'monster', hp: 20, mazeX: 5, mazeY: 4, mazeRoomKey: d.geoKey };
  const ctx = { dungeon: d, player: { x: 4.5, y: 4.5 }, actors: [actor], busy: true };
  const root = { DungeonInhabitants: I, dungeonRunId: 'run', innerWidth: 1280, innerHeight: 900,
    getDungeonLifeContext: () => ctx, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync('assets/dungeonLifeUi.js', 'utf8'), { window: root,
    Date: { now: () => now }, console: { info: (label, report) => reports.push({ label, ...report }), warn() {} },
    document: { createElement: element, getElementById: id => nodes.get(id), querySelector: () => null,
      head: { appendChild() {} }, body: { appendChild() {} }, addEventListener: (event, callback) => { if (event === 'DOMContentLoaded') callback(); } },
    setInterval() {}, setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
    fetch: async (url, options) => { posts.push({ url, body: JSON.parse(options.body) }); return { ok: true }; }
  });
  const event = { geoKey: d.geoKey, runId: 'run', dialogue: [{ speaker: actor.name, line: 'The wards here falter.' }] };
  return { root, ctx, actor, event, nodes, reports, posts, advance: ms => { now += ms; }, flush: () => { while (timers.length) timers.shift()(); } };
}

test('subtitle logging distinguishes queued lines from exact text actually displayed, without duplicating delivery', () => {
  const f = fixture(); f.root.DungeonLife.receiveDialogue(f.event);
  assert.equal(f.reports.filter(row => row.stage === 'displayed').length, 1);
  f.root.DungeonLife.receiveDialogue(f.event); f.root.DungeonLife.tick();
  const shown = f.reports.filter(row => row.stage === 'displayed');
  assert.equal(shown.length, 1); assert.equal(shown[0].speaker, f.actor.name);
  assert.equal(shown[0].line, f.nodes.get('dungeon-dialogue-words').textContent);
  assert.equal(f.nodes.get('dungeon-dialogue').hidden, false);
  assert.equal(shown[0].distance, 1); assert.equal(shown[0].lineOfSight, true);
  f.flush(); assert.equal(f.posts[0].url, '/debug/dialogue-subtitles');
  assert.ok(f.posts[0].body.reports.some(row => row.stage === 'displayed'));
});

test('dismissing a subtitle hides the card immediately, logs its reason and retains the next queued line', () => {
  const f = fixture();
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [f.event.dialogue[0], { speaker: f.actor.name, line: 'Mind the cracked arch.' }] });
  f.root.DungeonLife.dismissSubtitle();
  assert.equal(f.nodes.get('dungeon-dialogue').hidden, true);
  assert.ok(f.reports.some(row => row.stage === 'dismissed' && row.reason === 'player-dismissed'));
  assert.equal(f.posts.length, 0);
  f.root.DungeonLife.tick();
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, 'Mind the cracked arch.');
  f.root.DungeonLife.dismissSubtitle(); f.root.DungeonLife.tick();
  assert.equal(f.nodes.get('dungeon-dialogue').hidden, true);
  f.root.DungeonLife.receiveDialogue(f.event);
  assert.equal(f.nodes.get('dungeon-dialogue').hidden, true);
});

test('quick-dismiss advances through every sentence card without deleting the rest of a monologue', () => {
  const f = fixture(), line = Array.from({ length: 12 }, (_, i) => `Remember passage ${i}: the old watch kept these stones safe through all the long years.`).join(' ');
  const chunks = I.splitSpeech(line); assert.ok(chunks.length > 1);
  const event = { ...f.event, dialogue: [{ speaker: f.actor.name, line }] };
  f.root.DungeonLife.receiveDialogue(event);
  for (const chunk of chunks) {
    assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, chunk);
    f.root.DungeonLife.dismissSubtitle(); assert.equal(f.nodes.get('dungeon-dialogue').hidden, true);
    f.root.DungeonLife.tick();
  }
  assert.equal(f.nodes.get('dungeon-dialogue').hidden, true);
  assert.equal(f.reports.filter(row => row.stage === 'displayed').map(row => row.line).join(' '), line);
  assert.equal(event.dialogue[0].line, line); assert.equal(f.posts.length, 0);
});

test('paused subtitle dismissal retains unread cards until resuming and does not alter pause state', () => {
  const f = fixture(), line = Array.from({ length: 12 }, (_, i) => `Passage ${i} recalls the old gate and its long forgotten keeper.`).join(' ');
  const chunks = I.splitSpeech(line); assert.ok(chunks.length > 1);
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [{ speaker: f.actor.name, line }] });
  f.root.DungeonLife.setPaused({ paused: true, runId: 'run' });
  f.root.DungeonLife.dismissSubtitle(); f.advance(60000); f.root.DungeonLife.tick();
  assert.equal(f.root.gamePaused, true); assert.equal(f.nodes.get('dungeon-dialogue').hidden, true);
  f.root.DungeonLife.setPaused({ paused: false, runId: 'run' }); f.root.DungeonLife.tick();
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, chunks[1]);
});

test('distance, occlusion and death suppress subtitles and record specific reasons', () => {
  for (const [change, reason] of [
    [f => { f.actor.mazeX = 10; }, 'out-of-range'],
    [f => { f.actor.mazeX = 6; f.ctx.dungeon.cells['5,4'].tile = 'wall'; }, 'occluded-or-absent'],
    [f => { f.actor.hp = 0; }, 'dead']
  ]) {
    const f = fixture(); change(f); f.root.DungeonLife.receiveDialogue(f.event); f.root.DungeonLife.tick();
    assert.equal(f.nodes.get('dungeon-dialogue').hidden, true);
    assert.ok(f.reports.some(row => row.stage === 'skipped' && row.reason === reason));
    assert.ok(!f.reports.some(row => row.stage === 'displayed'));
  }
});

test('subtitle display omits double quotation marks without changing speech data or apostrophes', () => {
  const f = fixture();
  const line = `"Don't forget the \u201cOld King's Gate\u201d," they said.`;
  const event = { ...f.event, dialogue: [{ speaker: f.actor.name, line }] };
  f.root.DungeonLife.receiveDialogue(event);
  const displayed = `Don't forget the Old King's Gate, they said.`;
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, displayed);
  assert.equal(f.reports.find(row => row.stage === 'displayed').line, displayed);
  assert.equal(event.dialogue[0].line, line);
});

test('ambient speech enters the Game Log only when displayed, never just because it was queued', () => {
  const f = fixture(), logged = [];
  f.root.appendDungeonDialogueLog = (speaker, line) => logged.push({ speaker, line });
  f.root.DungeonLife.receiveDialogue(f.event);
  const ambient = { ...f.event, dialogue: [{ speaker: f.actor.name, line: 'Mind the old gate.', kind: 'canned' }] };
  f.root.DungeonLife.receiveDialogue(ambient);
  assert.equal(logged.length, 0);
  f.advance(20000); f.root.DungeonLife.tick();
  assert.deepEqual(logged, [{ speaker: f.actor.name, line: 'Mind the old gate.' }]);
  f.root.DungeonLife.receiveDialogue(ambient);
  assert.equal(logged.length, 1);
});

test('queued ambient words do not leak into the Game Log if the resident leaves before speaking', () => {
  const f = fixture(), logged = [];
  f.root.appendDungeonDialogueLog = (speaker, line) => logged.push({ speaker, line });
  f.root.DungeonLife.receiveDialogue(f.event);
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [{ speaker: f.actor.name, line: 'I am walking away.', kind: 'canned' }] });
  f.actor.mazeX = 25; f.advance(20000); f.root.DungeonLife.tick();
  assert.deepEqual(logged, []);
});

test('Vaelis waits through earlier speakers and her complete reply reaches the screen', () => {
  const f = fixture(), erlan = f.actor, noria = { ...erlan, name: 'Noria Helm', mazeX: 6 },
    vaelis = { ...erlan, name: 'Vaelis Thorne', mazeX: 5, mazeY: 5 };
  erlan.name = 'Erlan Vess'; f.ctx.actors.push(noria, vaelis);
  const line = 'Many fear the Sepulchra, for it is said to awaken forces best left undisturbed. Its power is a double-edged sword, capable of salvation or devastation, depending on who wields it.';
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [
    { speaker: erlan.name, line: 'The Sepulchra is a name whispered in dread.' },
    { speaker: noria.name, line: 'Its true nature remains veiled in shadow.' },
    { speaker: vaelis.name, line }
  ] });
  assert.equal(f.root.DungeonLife.isWaitingToSpeak(erlan.name), false, 'The active speaker uses the existing focus behavior.');
  assert.equal(f.root.DungeonLife.isWaitingToSpeak(noria.name), true);
  assert.equal(f.root.DungeonLife.isWaitingToSpeak(vaelis.name), true);
  f.advance(20000); f.root.DungeonLife.tick();
  assert.equal(f.nodes.get('dungeon-dialogue-caption').textContent, noria.name);
  assert.equal(f.root.DungeonLife.isWaitingToSpeak(vaelis.name), true);
  f.advance(20000); f.root.DungeonLife.tick();
  assert.equal(f.nodes.get('dungeon-dialogue-caption').textContent, vaelis.name);
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, line);
  assert.equal(f.root.DungeonLife.isWaitingToSpeak(vaelis.name), false);
  assert.ok(!f.reports.some(row => row.speaker === vaelis.name && row.stage === 'skipped'));
});

test('waiting speakers are released when the listener leaves, the speaker dies, or the room changes', () => {
  for (const change of [f => { f.ctx.player.x = 20; }, f => { f.waiting.hp = 0; }, f => { f.ctx.dungeon.geoKey = '2,0,0'; }]) {
    const f = fixture(); f.waiting = { ...f.actor, name: 'Vaelis Thorne' }; f.ctx.actors.push(f.waiting);
    f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [...f.event.dialogue, { speaker: f.waiting.name, line: 'I will answer next.' }] });
    assert.equal(f.root.DungeonLife.isWaitingToSpeak(f.waiting.name), true);
    change(f); assert.equal(f.root.DungeonLife.isWaitingToSpeak(f.waiting.name), false);
    f.advance(20000); f.root.DungeonLife.tick();
    assert.ok(!f.reports.some(row => row.speaker === f.waiting.name && row.stage === 'displayed'));
  }
});

test('the actual monster wandering loop respects the subtitle wait even during a forced movement update', () => {
  const f = fixture(), queued = { ...f.actor, name: 'Vaelis Thorne', _nextWanderAt: 0 }; f.ctx.actors.push(queued);
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [...f.event.dialogue, { speaker: queued.name, line: 'I am still answering you.' }] });
  const source = fs.readFileSync('assets/game.js', 'utf8'), begin = source.indexOf('function updateMonsterWandering('),
    end = source.indexOf('window.updateMonsterWandering =', begin);
  let steps = 0;
  const context = { window: f.root, currentDungeon: f.ctx.dungeon, isCombatRoundActive: () => false,
    getCurrentCombatRoomKey: () => f.ctx.dungeon.geoKey, resetWalkFrame() {},
    getMonsterHomeAnchor: actor => ({ x: actor.mazeX, y: actor.mazeY }), hashCharacterName: () => 1,
    isMonsterHostile: () => false, MONSTER_WANDER_MIN_MS: 100, MONSTER_WANDER_MAX_MS: 200,
    chooseMonsterWanderStep: actor => { steps++; return { x: actor.mazeX + 1, y: actor.mazeY }; },
    deriveFacingFromDelta: () => 'right', advanceWalkFrame() {}, MONSTER_WALK_FRAME_MS: 150, MONSTER_MOVE_TWEEN_MS: 420 };
  vm.runInNewContext(source.slice(begin, end), context);
  for (let i = 0; i < 5; i++) context.updateMonsterWandering([queued], new Set(), 10000 + i * 1000, true);
  assert.equal(steps, 0); assert.equal(queued.mazeX, 5);
  f.root.DungeonLife.reset();
  context.updateMonsterWandering([queued], new Set(), 16000, true);
  assert.equal(steps, 1); assert.equal(queued.mazeX, 6, 'Normal wandering resumes as soon as the subtitle queue is cleared.');
});

test('party locomotion also respects waiting turns without changing its formation or pathfinding', () => {
  const f = fixture(), queued = { ...f.actor, name: 'Companion', type: 'npc' }; f.ctx.actors.push(queued);
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [...f.event.dialogue, { speaker: queued.name, line: 'I will ask the mason next.' }] });
  const source = fs.readFileSync('assets/game.js', 'utf8'), begin = source.indexOf('function updatePartyMazeLocomotion('),
    end = source.indexOf("if (typeof window !== 'undefined')", begin);
  let goals = 0;
  const context = { window: f.root, isCombatRoundActive: () => false, shouldUsePartyMazeAnchors: () => true,
    Date: { now: () => 10000 }, _partyMazeStepAt: 0, NPC_MOVE_THINK_MS: 100, ensurePartyMazeAnchors() {},
    getCurrentPartyNpcEntries: () => [queued], getCurrentRoomMonsterEntries: () => [], getCurrentCombatRoomKey: () => f.ctx.dungeon.geoKey,
    playerDungeonX: 4, playerDungeonY: 4, hashCharacterName: () => 1, resetWalkFrame() {},
    getPartyNpcBehavior() { goals++; return { cadenceMs: 500 }; }, partyFollowCadence: () => 500,
    buildPartyNpcGoalTile: actor => actor, findNextPartyMazeStep: current => current, updateMonsterWandering: () => false };
  vm.runInNewContext(source.slice(begin, end), context);
  context.updatePartyMazeLocomotion(true); assert.equal(goals, 0);
  f.root.DungeonLife.reset(); context.updatePartyMazeLocomotion(true); assert.equal(goals, 1);
});

test('speech skipped before display is not marked as delivered and can later be retried nearby', () => {
  const f = fixture(); f.actor.mazeX = 10; f.root.DungeonLife.receiveDialogue(f.event); f.root.DungeonLife.tick();
  assert.ok(f.reports.some(row => row.stage === 'skipped' && row.reason === 'out-of-range'));
  f.actor.mazeX = 5; f.root.DungeonLife.receiveDialogue(f.event); f.root.DungeonLife.tick();
  assert.equal(f.reports.filter(row => row.stage === 'displayed').length, 1);
});

test('normal Retort prose with a short monster name displays the whole quote rather than a metadata fragment', () => {
  const f = fixture(), quote = 'The temple stirs. The wards here falter.';
  const sheet = 'Vyrixa Shadowtide\nFemale\nWraith\nSentinel\nLevel: 1\nAC: 10\nXP: 0\nHP: 20\nMaxHP: 20\nEquipped: None\nAttack: 1\nDamage: 1\nArmor: 0\nMagic: 0\nState: Friendly';
  f.root.DungeonLife.receiveTurnDialogue(`Vyrixa says, "${quote}"`, { ...f.event,
    consoleText: `NPCs in Party: None\nMonsters in Room:\n${sheet}\nMonsters Equipped Properties: None` });
  f.root.DungeonLife.tick();
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, quote);
  assert.ok(f.reports.some(row => row.stage === 'displayed' && row.source === 'retort-response' && row.line === quote));
});

test('diagnostic history and forwarding stay bounded and are detached from caller edits', () => {
  const f = fixture(); f.actor.mazeX = 10;
  for (let i = 0; i < 100; i++) f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [{ speaker: f.actor.name, line: `Line ${i}` }] });
  const history = f.root.DungeonLife.subtitleDiagnostics(); assert.equal(history.length, 64);
  history[0].line = 'Edited'; assert.notEqual(f.root.DungeonLife.subtitleDiagnostics()[0].line, 'Edited');
  f.flush(); assert.equal(f.posts[0].body.reports.length, 32);
});

test('long speech displays all cards in sequence and finishes before the next speaker line', () => {
  const f = fixture(), speech = Array.from({ length: 12 }, (_, i) => `Warning ${i}: keep close to the old temple walls and listen for the sound of moving stone.`).join(' ');
  const cards = I.splitSpeech(speech);
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [{ speaker: f.actor.name, line: speech }, { speaker: f.actor.name, line: 'Now we can continue.' }] });
  f.root.DungeonLife.tick();
  for (let i = 0; i < cards.length; i++) {
    assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, cards[i]);
    assert.ok(!/\[\d+\/\d+\]/.test(f.nodes.get('dungeon-dialogue-caption').textContent));
    f.advance(20000); f.root.DungeonLife.tick();
  }
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, 'Now we can continue.');
  const displayed = f.reports.filter(row => row.stage === 'displayed');
  assert.equal(displayed.slice(0, cards.length).map(row => row.line).join(' '), speech);
  assert.deepEqual(displayed.slice(0, cards.length).map(row => row.part), cards.map((_, i) => i + 1));
});

test('the logged multi-paragraph speech starts immediately and streams every sentence without blank cards or visible counters', () => {
  const f = fixture(); f.actor.name = continued.speaker;
  const sheet = `${continued.speaker}\nFemale\nWraith\nSentinel\nLevel: 1\nAC: 10\nXP: 0\nHP: 20\nMaxHP: 20\nEquipped: None\nAttack: 1\nDamage: 1\nArmor: 0\nMagic: 0\nState: Friendly`;
  const event = { ...f.event, consoleText: `NPCs in Party: None\nMonsters in Room:\n${sheet}\nMonsters Equipped Properties: None`,
    dialogue: [{ speaker: continued.speaker, line: continued.passages[0] }] };
  f.root.DungeonLife.receiveTurnDialogue(continued.prose, event);
  const cards = I.splitSpeech(continued.speech);
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, cards[0]);
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [{ speaker: continued.speaker, line: continued.speech }] });
  for (const card of cards) {
    assert.equal(f.nodes.get('dungeon-dialogue').hidden, false);
    assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, card);
    assert.equal(f.nodes.get('dungeon-dialogue-caption').textContent, continued.speaker);
    assert.ok(/[.!?]$/.test(card));
    f.advance(20000); f.root.DungeonLife.tick();
  }
  const displayed = f.reports.filter(row => row.stage === 'displayed');
  assert.equal(displayed.map(row => row.line).join(' '), continued.speech);
  assert.equal(displayed.length, cards.length); assert.ok(f.nodes.get('dungeon-dialogue').hidden);
});

test('available narrative speech is not discarded at the old six-line queue limit', () => {
  const f = fixture(), lines = Array.from({ length: 12 }, (_, i) => ({ speaker: f.actor.name, line: `Speech number ${i}.` }));
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: lines });
  for (const row of lines) {
    assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, row.line);
    f.advance(20000); f.root.DungeonLife.tick();
  }
  assert.deepEqual(f.reports.filter(row => row.stage === 'displayed').map(row => row.line), lines.map(row => row.line));
  assert.ok(!f.reports.some(row => row.reason === 'queue-limit'));
});

test('Zharok\'s logged monologue streams to the last sentence with only the name in each caption', () => {
  const f = fixture(); f.actor.name = zharok.speaker; f.actor.state = 'Friendly';
  const sheet = `${zharok.speaker}\nMale\nAbyssal Sand Wyrm\nRift Stalker\nLevel: 13\nAC: 22\nXP: 1280000\nHP: 81\nMaxHP: 81\nEquipped: None\nAttack: 0\nDamage: 0\nArmor: 11\nMagic: 7\nState: Friendly`;
  f.root.DungeonLife.receiveTurnDialogue(zharok.prose, { ...f.event,
    dialogue: [{ speaker: zharok.speaker, line: zharok.fragment }],
    consoleText: `NPCs in Party: None\nMonsters in Room:\n${sheet}\nMonsters Equipped Properties: None` });
  const cards = I.splitSpeech(zharok.speech);
  for (const card of cards) {
    assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, card);
    assert.equal(f.nodes.get('dungeon-dialogue-caption').textContent, zharok.speaker);
    assert.equal(f.nodes.get('dungeon-dialogue').hidden, false);
    f.advance(20000); f.root.DungeonLife.tick();
  }
  assert.equal(f.reports.filter(row => row.stage === 'displayed').map(row => row.line).join(' '), zharok.speech);
});

test('the client trusts validated backend speaker labels rather than reassigning speech from Game Log grammar', () => {
  const f = fixture(), other = { ...f.actor, name: 'Voranyx' }; f.actor.name = 'Zharok'; f.ctx.actors.push(other);
  const line = 'The gate remembers every oath.', source = `Voranyx's voice rises. "[[SPEECH:\"Zharok\"]]${line}[[/SPEECH]]"`;
  const result = I.extractDialogue(source, ['Zharok', 'Voranyx']);
  f.root.DungeonLife.receiveTurnDialogue(result.content, { ...f.event, dialogue: result.dialogue, consoleText: '' });
  assert.equal(f.nodes.get('dungeon-dialogue-caption').textContent, 'Zharok');
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, line);
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: result.dialogue });
  assert.equal(f.reports.filter(row => row.stage === 'displayed').length, 1);
});

test('pausing preserves the current speech card; leaving range stops the remaining cards', () => {
  const f = fixture(), speech = 'The old temple keeps many secrets. '.repeat(30).trim();
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [{ speaker: f.actor.name, line: speech }] }); f.root.DungeonLife.tick();
  const first = f.nodes.get('dungeon-dialogue-words').textContent;
  f.root.DungeonLife.setPaused({ paused: true, runId: 'run' }); f.advance(60000); f.root.DungeonLife.tick();
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, first);
  f.root.DungeonLife.setPaused({ paused: false, runId: 'run' }); f.root.DungeonLife.tick();
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, first);
  f.actor.mazeX = 10; f.root.DungeonLife.tick();
  assert.equal(f.nodes.get('dungeon-dialogue').hidden, true);
  assert.ok(f.reports.some(row => row.stage === 'dismissed' && row.reason === 'speaker-left-hearing-range'));
});

test('a nearby monologue continues across every card while the speaker is hidden behind a pillar', () => {
  const f = fixture();
  f.ctx.dungeon.tiles = { custom_column: { spriteSpec: { voxelShape: 'doric_column', baseWidth: .6, heightRatio: 1 } } };
  f.actor.mazeX = 6;
  const speech = Array.from({ length: 15 }, (_, i) => `Remember lesson ${i}: these ancient columns shelter travelers and carry the vaults above our heads.`).join(' ');
  f.root.DungeonLife.receiveDialogue({ ...f.event, dialogue: [{ speaker: f.actor.name, line: speech }] });
  f.ctx.dungeon.cells['5,4'] = { tile: 'custom_column', floorHeight: 0, ceilHeight: 6, structureHeight: 6 };
  const cards = I.splitSpeech(speech);
  for (const card of cards) {
    f.root.DungeonLife.tick();
    assert.equal(f.nodes.get('dungeon-dialogue').hidden, false);
    assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, card);
    f.advance(20000);
  }
  f.root.DungeonLife.tick();
  const displayed = f.reports.filter(row => row.stage === 'displayed');
  assert.equal(displayed.map(row => row.line).join(' '), speech);
  assert.ok(displayed.slice(1).every(row => row.canHear && !row.lineOfSight));
  assert.ok(!f.reports.some(row => row.reason === 'speaker-left-hearing-range'));
});

test('normal Retort speech is subtitled immediately when its nearby speaker is already behind a pillar', () => {
  const f = fixture(); f.actor.mazeX = 6;
  f.ctx.dungeon.tiles = { custom_column: { spriteSpec: { voxelShape: 'doric_column', baseWidth: .6, heightRatio: 1 } } };
  f.ctx.dungeon.cells['5,4'] = { tile: 'custom_column', floorHeight: 0, ceilHeight: 6, structureHeight: 6 };
  const line = 'You can still hear me beside the old column.';
  f.root.DungeonLife.receiveTurnDialogue(`${f.actor.name} says, "${line}"`, {
    ...f.event, dialogue: [{ speaker: f.actor.name, line, attribution: 'labelled' }], consoleText: ''
  });
  assert.equal(f.nodes.get('dungeon-dialogue-words').textContent, line);
  assert.ok(f.reports.some(row => row.stage === 'displayed' && row.canHear && !row.lineOfSight));
});

test('the live sighting pipeline announces each resident once and ignores hidden, departed and party actors', async () => {
  const f = fixture(), state = C.createAtlas().get(f.ctx.dungeon, 'run'); await state.ready;
  const notices = [], population = I.createPopulation(f.ctx.dungeon.geoKey, [
    { name: f.actor.name, allegiance: 'Neutral' }, { name: 'Departed Mason', allegiance: 'Neutral' }
  ]);
  population.actors['Departed Mason'].status = 'departed';
  f.root.DungeonLife.receivePopulation({ population, runId: 'run' });
  f.ctx.actors.push(
    { ...f.actor, name: 'Party Mason', type: 'npc' },
    { ...f.actor, name: 'Pending Mason', discoveryState: 'pending' },
    { ...f.actor, name: 'Departed Mason' },
    { ...f.actor, name: 'Distant Mason', mazeX: 25 }
  );
  f.root.DungeonExplorationMap = { ready: () => state.loaded,
    observeResident: actor => C.observeResident(state, f.ctx.dungeon, actor, f.ctx.player) };
  f.root.DungeonAreaTitles = { update() {}, encounter: actor => notices.push(actor.name) };
  f.ctx.dungeon.cells['5,4'].tile = 'wall'; f.actor.mazeX = 6;
  f.root.DungeonLife.tick(); assert.deepEqual(notices, []);
  f.ctx.dungeon.cells['5,4'].tile = 'floor'; f.actor.mazeX = 5;
  f.root.DungeonLife.tick(); f.root.DungeonLife.tick();
  assert.deepEqual(notices, [f.actor.name]); assert.equal(state.knownResidents.length, 1);
  f.actor.mazeX = 25; f.root.DungeonLife.tick();
  assert.equal(state.knownResidents[0].x, 5.5);
  f.actor.mazeX = 5; f.root.DungeonLife.tick(); assert.equal(notices.length, 1);
});

function routeFixture() {
  const routes = new Map(), logged = [], source = fs.readFileSync('server.js', 'utf8');
  const begin = source.indexOf("app.post('/debug/dialogue-subtitles'"), end = source.indexOf('// Procedural character sprites:', begin);
  vm.runInNewContext(source.slice(begin, end), { app: { post: (url, handler) => routes.set(url, handler) },
    sharedState: { getDungeonRunId: () => 'run' }, console: { info: (...values) => logged.push(values) } });
  return { logged, send(body) { let status = 200, result;
    routes.get('/debug/dialogue-subtitles')({ body }, { status(value) { status = value; return this; }, json(value) { result = value; } });
    return { status, result };
  } };
}
test('subtitle diagnostic endpoint records actual client reports, rejects stale runs and oversized or invalid payloads', () => {
  const f = routeFixture(), row = { runId: 'run', geoKey: '1,0,0', stage: 'displayed', speaker: 'Vyrixa Shadowtide',
    line: 'The wards here falter.', source: 'retort-response', at: 1000, queueDepth: 0, distance: 1, range: 3, lineOfSight: true };
  assert.equal(f.send({ runId: 'run', reports: [row] }).status, 200);
  assert.equal(JSON.parse(f.logged[0][1]).line, row.line);
  assert.equal(f.send({ runId: 'old-run', reports: [{ ...row, runId: 'old-run' }] }).status, 409);
  for (const reports of [Array(33).fill(row), [{ ...row, line: 'x'.repeat(24001) }], [{ ...row, stage: 'queued', line: 'x'.repeat(321) }], [{ ...row, stage: 'invented' }], [{ ...row, distance: -2 }]])
    assert.equal(f.send({ runId: 'run', reports }).status, 400);
  assert.equal(f.logged.length, 1);
});
