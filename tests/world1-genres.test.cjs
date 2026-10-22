'use strict';
// world1: genre kits, genre lights, setting-aware portals, resource names, ranged/ammo, multi-genre bibles,
// master prompt + GM persona, library catalogue. Pure/local (no model, no server).
process.env.HOLODEK_GENRE_KITS = '1'; process.env.HOLODEK_GENRE_LIGHTS = '1'; process.env.HOLODEK_RANGED_COMBAT = '1'; process.env.HOLODEK_LIBRARY_BOOKS = '1';
const assert = require('assert');
const K = require('../assets/genreKits'), L = require('../assets/genreLights'), R = require('../assets/rangedRules'), Catalog = require('../assets/designCatalog');
const Sprite = require('../assets/renderCharacterSprite'), Props = require('../assets/scenePropVoxels'), Gear = require('../assets/equipmentRules');
const S = require('../retort/settingLayer'), Layer = require('../retort/genreLayer');
let n = 0, fail = 0; const pending = []; const t = (name, fn) => { n++; const id = n; try { const r = fn(); if (r?.then) pending.push(r.then(() => console.log(`ok ${id} - ${name}`), e => { fail++; console.log(`not ok ${id} - ${name}\n  ${e.message}`); })); else console.log(`ok ${id} - ${name}`); } catch (e) { fail++; console.log(`not ok ${id} - ${name}\n  ${e.message}`); } };
const GENRES = ['fantasy', 'dark-fantasy', 'sci-fi', 'cyberpunk', 'post-apocalyptic', 'steampunk', 'western', 'modern', 'cosmic-horror', 'nautical', 'mythic', 'noir'];
const GAME = new Set(Object.values(Catalog.PALETTES).flat());

t('all 12 genres have body plans, clothing, gear, held items, creatures, props, building pieces, palette, voxel material and lights', () => {
  assert.deepStrictEqual(Object.keys(K.GENRES).sort(), [...GENRES].sort());
  for (const g of GENRES) { const k = K.GENRES[g]; for (const f of ['plans', 'gear', 'held', 'creatures', 'props', 'building', 'lights']) assert.ok(k[f].length >= 2 || f === 'building' && k[f].length, `${g}.${f}`);
    assert.ok(k.clothing.head.length && k.clothing.torso.length && k.clothing.legs.length && k.voxel && k.textures.floor, g); for (const l of k.lights) assert.ok(L.TYPES[l], `${g} light ${l}`); }
});
t('palette discipline: every genre colour is one of the game palette colours', () => { for (const g of GENRES) for (const c of Object.values(K.GENRES[g].palette)) assert.ok(GAME.has(c), `${g} ${c}`); });
t('each genre produces valid voxel sprites (npc + creature) through the existing semantic generator; gear stays at the weapon hand', () => {
  for (const g of GENRES) for (const role of ['npc', 'creature']) { const spec = K.characterSpec(g, role, 7), f = Sprite.createSemanticCharacterVoxelFrame({ name: spec.name }, spec, {});
    const filled = f.voxels.reduce((a, b) => a + b, 0); assert.ok(f.size >= 20 && filled > 150, `${g}/${role} filled ${filled}`);
    for (let i = 0; i < f.voxels.length; i++) if (f.voxels[i]) for (let c = 0; c < 3; c++) assert.ok(f.colors[i * 3 + c] >= 0 && f.colors[i * 3 + c] <= 1); }
  const spec = K.characterSpec('western', 'npc', 1); spec.genreGear.held = 'revolver'; spec.parts.weapon = 'revolver';
  const a = Sprite.createSemanticCharacterVoxelFrame({ name: 'x' }, spec, {}), m = Sprite.createSemanticCharacterVoxelFrame({ name: 'x' }, spec, { mirror: true });
  const side = f => { let l = 0, r = 0; for (let z = 0; z < f.size; z++) for (let y = 0; y < f.size; y++) for (let x = 0; x < f.size; x++) if (f.voxels[x + y * f.size + z * f.size * f.size]) (x < f.size / 2 ? l++ : r++); return l - r; };
  assert.ok(Math.sign(side(a)) !== Math.sign(side(m)) || side(a) === 0, 'mirrored frame flips the weapon side');
});
t('each genre prop and building piece builds through ScenePropVoxels (city-kit pattern) with shaded colours', () => {
  for (const s of K.SHAPES) { const v = Props.build(s, 16, 1, {}); assert.ok(v && v.reduce((a, b) => a + (b > 0), 0) > 3, s); const c = Props.color(s, .5, .5, .5, [0, 0, 1], null, 'stone', {}); assert.ok(c.every(x => x >= 0 && x <= 1), s); }
});
t('light types: own curve, radius, colour; torch stays the existing torchFlicker; flicker/pulse/strobe behave', () => {
  assert.ok(Object.keys(L.TYPES).length >= 16);
  const torch = L.light('torch', 0, 0, 0, .3, 1000, 1, () => .77); assert.equal(torch.intensity, .77);
  const strobe = L.sample('emergency_strobe', .1, 4, 200); assert.ok(Math.max(...strobe) > 1 && Math.min(...strobe) < .2);
  const fl = L.sample('fluorescent', .2, 30, 600); assert.ok(fl.filter(x => x > .9).length > fl.length * .9);
  const breath = L.sample('eldritch_breath', .5, 40, 200); assert.ok(Math.max(...breath) - Math.min(...breath) > .4);
  for (const [k, T] of Object.entries(L.TYPES)) assert.match(T.color, /^#[0-9a-f]{6}$/, k);
  const sway = L.light('bulb_sway', 2, 2, 1, .4, 1300, 1); assert.ok(sway.x !== 2 || sway.y !== 2);
});
t('Children of the Grave tags: fantasy-family prefabs and lights only', () => {
  for (const s of ['g_candle_stand', 'g_rune_stone', 'g_crystal_lamp', 'g_moon_brazier', 'g_ruined_wall', 'g_book_lectern']) assert.ok(K.COTG_TAGS.includes(s), s);
  for (const s of ['g_neon_sign', 'g_console', 'g_vending_machine', 'g_tentacle_growth']) assert.ok(!K.COTG_TAGS.includes(s), s);
  for (const l of ['candle', 'rune_glow', 'crystal_glow', 'brazier_moon', 'eldritch_fantasy']) assert.ok(L.COTG_TAGS.includes(l), l);
  for (const l of ['neon_buzz', 'fluorescent', 'emergency_strobe']) assert.ok(!L.COTG_TAGS.includes(l), l);
});
t('portal rooms: Children of the Grave stays fantasy-family (keeps the purple-arch/crystal base); homebrew portals switch genre', () => {
  const realm = { palette: { skyTop: '#301040', skyBot: '#100820', floorColor: '#402060', wallColor: '#201030' } };
  const cotg = K.resolve({ planarRealm: { ...realm, genre: 'cyberpunk' } }, null); assert.ok(K.COTG_ALLOWED.includes(cotg.genre)); assert.equal(cotg.base.arch, 'portal_arch'); assert.ok(cotg.lights.includes('crystal_glow'));
  assert.ok(cotg.lights.every(l => L.TYPES[l]), 'lights exist');
  const hb = { seed: 'x', genres: ['fantasy'], genreWeights: [{ genre: 'fantasy', weight: 1 }] };
  assert.equal(K.resolve({ planarRealm: { ...realm, genre: 'cyberpunk' } }, hb).genre, 'cyberpunk'); assert.equal(K.resolve({ planarRealm: { ...realm, genre: 'cosmic-horror' } }, hb).genre, 'cosmic-horror');
  const d = { cells: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`${i % 20},${Math.floor(i / 20)}`, { tile: 'floor' }])) };
  Layer.decorate(d, { planarRealm: { ...realm, genre: 'cyberpunk' } }, { setting: hb, geoKey: '500,500,500' }); assert.equal(d.genreKit.genre, 'cyberpunk'); assert.ok(d.genreLights.length >= 2 && d.genreLights.every(l => K.GENRES.cyberpunk.lights.includes(l.type) || l.type === 'crystal_glow'));
  const plain = { cells: d.cells }; Layer.decorate(plain, { name: 'Hall' }, { setting: null }); assert.equal(plain.genreKit.genre, 'fantasy'); assert.equal(plain.genreLights, undefined, 'plain CotG rooms keep their torches only');
});
t('weighted multi-genre blending: kits, lights, creatures and ammo come from every listed genre', () => {
  const r = K.resolve({}, { seed: 'weird west', genres: ['western', 'cosmic-horror'], genreWeights: [{ genre: 'western', weight: .6 }, { genre: 'cosmic-horror', weight: .4 }] });
  assert.equal(r.genre, 'western'); assert.ok(r.props.some(p => K.GENRES['cosmic-horror'].props.includes(p)) && r.props.some(p => K.GENRES.western.props.includes(p)));
  assert.ok(r.lights.includes('oil_lantern') && r.lights.includes('eldritch_breath')); assert.ok(r.creatures.some(c => K.GENRES['cosmic-horror'].creatures.includes(c)));
});
t('resource stat name: CotG Magic; Magic/Tech/Luck by genre; unknown -> Luck; bible override', () => {
  assert.equal(R.resourceLabel('cotg'), 'Magic'); for (const g of ['fantasy', 'dark-fantasy', 'mythic', 'cosmic-horror']) assert.equal(R.resourceLabel(g), 'Magic', g);
  for (const g of ['sci-fi', 'cyberpunk', 'steampunk']) assert.equal(R.resourceLabel(g), 'Tech', g); for (const g of ['western', 'modern', 'noir', 'post-apocalyptic', 'nautical']) assert.equal(R.resourceLabel(g), 'Luck', g);
  assert.equal(R.resourceLabel('space-opera-thing'), 'Luck'); assert.equal(R.resourceLabel('western', { resourceName: 'Grit' }), 'Grit'); assert.equal(R.resourceLabel('cotg', { resourceName: 'Grit' }), 'Magic');
  assert.equal(S.validateBible(S.localBible('weird west town')).resourceName, 'Luck'); assert.equal(S.validateBible(S.localBible('space station dystopian setting')).resourceName, 'Tech');
});
t('ranged: falloff with distance, long shots, out of range; melee-range -4 stays in dungeonReach', () => {
  const bow = R.find('longbow'); assert.equal(R.falloff(bow, 5), 0); assert.equal(R.falloff(bow, 15), -2); assert.equal(R.falloff(bow, 28), -4); assert.equal(R.falloff(bow, 31), null);
  assert.equal(R.falloff(R.find('shotgun'), 5), -4, 'shotguns fall off steeply');
  assert.match(require('fs').readFileSync(require.resolve('../retort/dungeonReach'), 'utf8'), /distance <= 1\.5 && lineClear[\s\S]{0,40}\? 4 : 0/);
});
t('ranged: cover from walls/pillars beside the target on the shooter side', () => {
  const cells = {}; for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells[`${x},${y}`] = { tile: 'floor' }; const d = { cells };
  assert.equal(R.cover(d, { x: 1.5, y: 5.5 }, { x: 8.5, y: 5.5 }), 0); cells['7,5'] = { tile: 'pillar' }; assert.equal(R.cover(d, { x: 1.5, y: 5.5 }, { x: 8.5, y: 5.5 }), 2);
  cells['7,6'] = { tile: 'wall' }; assert.equal(R.cover(d, { x: 1.5, y: 7.5 }, { x: 8.5, y: 5.5 }), 4);
});
t('ammo: revolver 6-shot cylinder + reload; arrows recoverable; blaster uses power cells with heat; melee unlimited', () => {
  const st = {}, a = { name: 'Kit' }, rev = R.find('revolver');
  for (let i = 0; i < 6; i++) assert.ok(R.fire(st, a, rev).ok); const re = R.fire(st, a, rev); assert.ok(re.reload && !re.ok); assert.equal(R.readout(st, a, rev), 'Bullets: 6/6 (+18)');
  let out; for (let i = 0; i < 40 && !(out = R.fire(st, a, rev)).empty; i++);  assert.ok(out.empty); assert.match(out.message, /out of bullets/);
  const bow = R.find('shortbow'), s2 = {}; for (let i = 0; i < 10; i++) R.fire(s2, a, bow); assert.match(R.fire(s2, a, bow).message, /out of arrows/); const rec = R.recover(s2, () => .1); assert.equal(rec[0].recovered, 10);
  const bl = R.find('blaster pistol'), s3 = {}; assert.equal(bl.ammo, 'cells'); for (let i = 0; i < 4; i++) assert.ok(R.fire(s3, a, bl).ok); assert.ok(R.fire(s3, a, bl).overheated); R.cool(s3); assert.ok(R.fire(s3, a, bl).ok);
  assert.equal(R.find('longsword'), null, 'melee is not an ammo weapon');
});
t('rare resource items spend the Magic/Tech/Luck stat, not ammo; pools are separate; marked rare; not in shops', () => {
  let magic = 5; const res = { label: 'Tech', get: () => magic, spend: n => { magic -= n; } }, st = {}, lance = R.find('plasma lance');
  assert.equal(lance.costType, 'resource'); assert.ok(lance.rare); assert.match(R.tooltip(lance), /RARE, HIGH-POWERED/);
  assert.ok(R.fire(st, { name: 'Ada' }, lance, res).ok); assert.equal(magic, 1); assert.deepStrictEqual(st, {}, 'no ammo state touched'); assert.match(R.fire(st, { name: 'Ada' }, lance, res).message, /out of Tech/);
  for (const g of GENRES) assert.ok(R.stock(g).every(i => !R.find(i.name)?.rare), g);
  assert.ok(R.forGenre('western').some(w => w.name === 'dead-eye shot' && w.costType === 'resource'), 'western Luck moves');
  let lucky = 0; for (let i = 0; i < 2000; i++) { const x = R.lootRoll('sci-fi', Math.random); if (x?.rare) lucky++; } assert.ok(lucky < 120, 'rare items placed sparingly');
});
t('every genre and Children of the Grave has ranged weapons and ammo in stock; EquipmentRules resolves genre guns at range', () => {
  for (const g of [...GENRES, 'cotg']) assert.ok(R.forGenre(g).some(w => w.costType === 'ammo') || g === 'cotg' && R.forGenre('cotg').length, g);
  for (const w of ['shortbow', 'light crossbow', 'sling', 'throwing axe']) assert.ok(R.forGenre('cotg').some(x => x.name === w), w);
  assert.equal(Gear.weapon({ equipped: { Weapon: 'Revolver' } }).range_tiles, 10); assert.ok(Gear.ranged({ equipped: { Weapon: 'smartgun' } }));
  assert.ok(Gear.stock('western').some(i => i.type === 'ammo' && /bullets/.test(i.name)));
});
t('multi-genre bibles: keyword fallback infers weighted combos; picked genres are authoritative; CotG stays fantasy', async () => {
  assert.deepStrictEqual(S.weightedGenres('weird west').map(g => g.genre), ['western', 'cosmic-horror']); assert.deepStrictEqual(S.weightedGenres('space wizards').map(g => g.genre).slice(0, 2), ['sci-fi', 'fantasy']);
  assert.deepStrictEqual(S.weightedGenres('steampunk noir').map(g => g.genre).slice(0, 2), ['steampunk', 'noir']);
  const b = await S.generate('a lonely lighthouse', { picked: [{ genre: 'noir', weight: 1 }, { genre: 'nautical', weight: 3, primary: true }] });
  assert.deepStrictEqual(b.genres, ['nautical', 'noir']); assert.ok(b.genresPicked); assert.equal(b.resourceName, 'Luck');
  const mock = await S.generate('space wizards', { picked: ['western'], runner: async () => ({ genres: [{ genre: 'sci-fi', weight: 1 }] }) }); assert.deepStrictEqual(mock.genres, ['western'], 'model cannot override picks');
});
t('master system prompt: core + world sections, original GM persona, lint-clean; instructions verbatim + Expanded; Holodek in test mode', async () => {
  const b = S.validateBible(S.localBible('weird west town')), m = await S.generateMaster(b, 'The dead walk at noon in a silver town');
  assert.ok(m.text.startsWith(S.CORE.slice(0, 40)) || m.text.includes('Game Master')); for (const k of ['PREMISE', 'TONE', 'RULES', 'FACTIONS', 'NPCS', 'PLACES', 'CONFLICT', 'MYSTERIES', 'START', 'RESOURCE STAT: Luck']) assert.ok(m.text.includes(k), k);
  assert.deepStrictEqual(m.leaks, []); assert.ok(m.gmName && !/grave master|holodek/i.test(m.gmName)); assert.ok(m.text.includes(m.gmName));
  const ins = await S.expandInstructions('No magic exists. Water is currency', b); assert.equal(ins.verbatim, 'No magic exists. Water is currency'); assert.match(ins.expanded, /No magic exists/);
  const full = S.withInstructions(m.text, ins); assert.ok(full.indexOf('No magic exists. Water is currency') < full.indexOf('Expanded:')); assert.match(full, /authoritative/);
  assert.throws(() => S.setMaster({}, 'You are the Grave Master of Children of the Grave'), /other-setting/);
  assert.equal(S.gmName(), 'Grave Master'); S.setTestMode(true); assert.equal(S.gmName(), 'Holodek');
  const body = { messages: [{ role: 'system', content: 'Instructions for the Grave Master: you are the Grave Master.' }] }; S.applyBody(body); assert.ok(!/Grave Master/.test(body.messages[0].content)); S.setTestMode(false);
});
t('library: ruined temple gets sparse shelves; city library is vast and lazy; catalogue search is local', () => {
  const LB = require('../assets/libraryBooks'), Spec = require('../retort/sceneSpec');
  const shelfRoom = (n, scale) => { const cells = {}; for (let i = 0; i < n; i++) cells[`${i},1`] = { tile: 'lm_shelf' }; return { roomName: scale === 'ruin' ? 'Ruined Temple Entrance' : 'Great City Library', tiles: { lm_shelf: { spriteSpec: { landmarkType: 'bookshelf' }, landmark: { type: 'bookshelf', condition: scale === 'ruin' ? 'broken' : 'pristine', label: scale === 'ruin' ? 'toppled temple bookshelf' : 'library bookshelf' } } }, cells, sceneSpec: { source: { roomName: scale === 'ruin' ? 'Ruined Temple Entrance' : 'Great City Library' } } }; };
  const temple = shelfRoom(3, 'ruin'), lib = shelfRoom(6, 'vast'); const tb = LB.books(temple), lb = LB.books(lib);
  assert.ok(tb.length > 0 && tb.length < 40, `temple books ${tb.length}`); assert.ok(lb.length > 200, `library books ${lb.length}`);
  assert.ok(LB.sections(lib).length >= 6); const r = LB.searchCatalog(lib, LB.sections(lib)[0].subject.split(' ')[0], []); assert.ok(r.sections.length >= 1 && r.counts.books === lb.length);
  assert.ok(typeof Spec.buildSceneSpec === 'function');
});
t('homebrew: no Children of the Grave premades, Mortacia NPC, CotG classes or start options in a homebrew world (regression: Suzerain leak)', () => {
  const fs = require('fs'), path = require('path'), g = fs.readFileSync(path.join(__dirname, '../assets/game.js'), 'utf8'), srv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(g, /\(typeof holodekHomebrewActive === 'function' && holodekHomebrewActive\(\)\) \? createRandomNPC\(\) : createMortaciaNPC\(\)/);
  assert.match(g, /\(typeof holodekHomebrewActive === 'function' && holodekHomebrewActive\(\)\)\) for \(const n of npcs\) n\.Class = .*Knight of \(Atinus\|Atricles\|Urther\|Poena\)/);
  assert.equal((g.match(/\(typeof holodekHomebrewActive === 'function' && holodekHomebrewActive\(\)\) \? 'Start Menu: \\n \\n 3\)/g) || []).length, 2, 'both start menus hide 1/2');
  assert.match(g, /userWords\[0\] === '2'\) && charactersString\.length <= 0 && \(typeof holodekHomebrewActive === 'function' && holodekHomebrewActive\(\)\)\) \{[\s\S]{0,160}userWords = \['3'\]/);
  const top = g.slice(g.indexOf('async function chatbotprocessinput('), g.indexOf('async function chatbotprocessinput(') + 600); assert.doesNotMatch(top, /charactersString/, 'no TDZ read of charactersString at function top');
  assert.match(srv, /homebrew world: Children of the Grave premades are disabled/);
  assert.match(srv, /HOMEBREW_ACTIVE:/);
  const CB = require('../retort/campaignBuilder'); assert.deepEqual(CB.lint('Suzerain, Knight of Atinus'), ['Suzerain', 'Atinus']); assert.deepEqual(CB.lint('Marshal Dranycal of Bitterwell'), []);
});
t('world roster: generated classes/races validate and clamp; every genre yields >=4 classes and >=2 races; denylist; two worlds with the same inputs differ', () => {
  const S = require('../retort/settingLayer');
  for (const g of Object.keys(S.ROSTER_EXAMPLES)) { const b = S.validateBible(S.localBible('a town', [{ genre: g, weight: 1 }], 'seed-' + g)); const r = S.localRoster(b);
    assert.ok(r.classes.length >= 4, `STEP roster ${g}: ${r.classes.length} classes`); assert.ok(r.races.length >= 2, `STEP roster ${g}: races`); assert.deepEqual(require('../retort/campaignBuilder').lint(r), [], g); }
  const v = S.validateRoster({ classes: [1, 2, 3, 4].map(i => ({ name: 'Role ' + 'ABCD'[i - 1], hitDie: 7, stats: { Attack: 9, Damage: -9, Magic: '2' }, abilities: [{ name: 'Edge', cost: 99 }], bodyPlan: 'robot' })), races: [{ name: 'Kin A', hpBonus: 50 }, { name: 'Kin B' }] });
  assert.equal(v.classes[0].hitDie, 8); assert.deepEqual(v.classes[0].stats, { Attack: 3, Damage: -2, Armor: 0, Magic: 2 }); assert.equal(v.classes[0].abilities[0].cost, 5); assert.equal(v.classes[0].bodyPlan, 'humanoid'); assert.equal(v.races[0].hpBonus, 4);
  assert.throws(() => S.validateRoster({ classes: [1, 2, 3, 4].map(i => ({ name: i === 1 ? 'Knight of Atinus' : 'R' + 'BCD'[i - 2] })), races: [{ name: 'X1' }, { name: 'X2' }] }), /leaked terms/);
  assert.throws(() => S.validateRoster({ classes: [{ name: 'A1' }], races: [] }), /at least 4 classes/);
  const P = [{ genre: 'western', weight: 2 }, { genre: 'cosmic-horror', weight: 1 }], w = ws => { const b = S.validateBible(S.localBible('same prompt', P, ws)); return { b, r: S.localRoster(b) }; };
  const A = w('w1'), B = w('w2'); const names = x => [...x.r.classes, ...x.r.races].map(c => c.name).sort().join('|');
  assert.notEqual(names(A), names(B), 'class/race names differ between worlds'); assert.notEqual(A.b.topology.start, B.b.topology.start, 'starting place differs');
});
t('option-4 e2e (server side): western + cosmic-horror -> non-CotG first room, Luck stat, western/eldritch kits, master prompt replaces CotG lore in model calls', () => {
  const S = require('../retort/settingLayer'), WF = require('../retort/worldFlags'), old = process.env.HOLODEK_HOMEBREW; process.env.HOLODEK_HOMEBREW = '1';
  try { const b = S.validateBible(S.localBible('A dust-choked frontier town; the mine broke into something older than the stars', [{ genre: 'western', weight: 2 }, { genre: 'cosmic-horror', weight: 1 }], 'e2e'));
    Object.assign(b, S.localRoster(b)); S.setMaster(b, S.masterText(S.masterLocal(b, 'x'), b)); S.setActive(b); assert.ok(S.current(), 'STEP activate: homebrew bible not active');
    const room = S.firstRoom(b); assert.doesNotMatch(room.name + room.description, /Ruined Temple|Tartarus|afterlife/, 'STEP first-room'); assert.deepEqual(require('../retort/campaignBuilder').lint(room), [], 'STEP first-room denylist');
    assert.equal(b.resourceName || 'Luck', 'Luck', 'STEP resource'); assert.deepEqual(b.genres.slice(0, 2), ['western', 'cosmic-horror'], 'STEP genres');
    const K = require('../assets/genreKits').resolve({}, b); assert.equal(K.genre, 'western', 'STEP kits primary'); assert.ok(K.mix.some(m => m.genre === 'cosmic-horror'), 'STEP kits blend'); assert.equal(K.locked, false, 'STEP kits not CotG-locked');
    const body = { messages: [{ role: 'user', content: "Hereafter, 'You' refers to you, who is adminstering this chat... Tartarus ... Mortacia" }, { role: 'user', content: 'You enter the Ruined Temple Entrance.' }] };
    S.applyBody(body); assert.equal(body.messages[0].content, b.masterPrompt, 'STEP lore->master'); assert.match(body.messages[1].content, new RegExp(room.name), 'STEP translate first room');
    assert.deepEqual(require('../retort/campaignBuilder').lint(body.messages.map(m => m.content).join(' ')), [], 'STEP no leaks');
  } finally { S.setActive(null); if (old === undefined) delete process.env.HOLODEK_HOMEBREW; else process.env.HOLODEK_HOMEBREW = old; }
});
Promise.all(pending).then(() => { console.log(`# ${n - fail}/${n} passed`); process.exitCode = fail ? 1 : 0; });

