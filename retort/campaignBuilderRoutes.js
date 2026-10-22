'use strict';
// Campaign Builder HTTP routes. Mounted only when CAMPAIGN_BUILDER is on (default on; HOLODEK_CAMPAIGN_BUILDER=0 disables), on any port including live 3000.
const fs = require('fs'), path = require('path');
const Flags = require('./worldFlags'), B = require('./campaignBuilder'), Setting = require('./settingLayer');
const Exits = require('../assets/dungeonExits');
const enabled = port => Flags.on('CAMPAIGN_BUILDER'); // port 3000 guard removed 2026-10-20 (user-approved); dev sandbox stays gated by its own env var.
const coordsOf = key => { const [x, y, z] = String(key).split(',').map(Number); return { x, y, z }; };
function install(app, express, port, sharedState, { broadcast = () => {}, busy = () => false } = {}) {
  if (!enabled(port)) return false;
  const DIR = path.join(process.cwd(), 'builder-worlds'), SNAP = path.join(DIR, 'snapshots'); fs.mkdirSync(SNAP, { recursive: true });
  const db = () => JSON.parse(sharedState.getRoomNameDatabase() || '{}'), setDb = d => sharedState.setRoomNameDatabase(JSON.stringify(d));
  const cur = () => { const c = sharedState.getLastCoords(); return c ? `${c.x},${c.y},${c.z}` : '0,0,0'; };
  const json = express.json({ limit: '2mb' });
  const safe = name => String(name || 'world').replace(/[^\w-]+/g, '_').slice(0, 60) || 'world';
  const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { res.status(400).json({ error: e.message }); } };
  const guard = (req, res, next) => busy() ? res.status(409).json({ error: 'A turn is in progress; try again in a moment.' }) : next();

  app.get('/builder/state', wrap(req => { const d = db(), key = req.query.key || cur();
    return { key, current: cur(), room: d[key] || null, modes: B.roomModes(d), rooms: Object.keys(d), setting: d['0,0,0']?.setting || null, world: d['0,0,0']?.builderWorld || null,
      worlds: fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)), objectTypes: B.OBJECT_TYPES, tiles: B.TILES }; }));
  app.post('/builder/object', guard, json, wrap(req => { const { key = cur(), object, position, toInventory } = req.body || {};
    if (toInventory) { const o = B.object(object); sharedState.setUpdatedGameConsole(B.giveToParty(sharedState.getUpdatedGameConsole() || '', o.name));
      const d = db(); (d['0,0,0'] ||= {}).builderInventory = [...(d['0,0,0'].builderInventory || []), o]; setDb(d); return { ok: true, inventory: true, object: o }; }
    const d = db(), o = B.placeObject(d, key, object, { position }); setDb(d); return { ok: true, object: o, index: d[key].objects.length - 1 }; }));
  app.post('/builder/object/duplicate', guard, json, wrap(req => { const d = db(), o = B.duplicateObject(d, req.body.key || cur(), req.body.index); setDb(d); return { ok: true, object: o }; }));
  app.post('/builder/object/delete', guard, json, wrap(req => { const d = db(), o = B.deleteObject(d, req.body.key || cur(), req.body.index); setDb(d); return { ok: true, removed: o.name }; }));
  // Encounters go into the room's real population, so beginEncounterCombat -> /room-population/engage -> combat runs normally.
  app.post('/builder/encounter', guard, json, wrap(req => { const key = req.body.key || cur(), enc = B.encounter(req.body.encounter || {});
    const pop = sharedState.getRoomPopulation(key) || { actors: {}, groups: [], revision: 0 };
    const dungeon = sharedState.getRoomDungeonForSimulation(coordsOf(key)), p = req.body.near || dungeon?.start || { x: 3, y: 3 }, free = [];
    for (let r = 2; r <= 4 && free.length < 12; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy; if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (dungeon?.cells?.[`${x},${y}`]?.tile === 'floor' && !free.some(f => f.x === x && f.y === y)) free.push({ x, y }); }
    const group = B.injectEncounter(pop, enc, free); sharedState.setRoomPopulation(key, pop);
    const d = db(); ((d[key] ||= {}).builderEncounters ||= []).push(enc); d[key].builderEncounters = d[key].builderEncounters.filter((e, i, a) => a.findIndex(x => x.id === e.id) === i); setDb(d);
    return { ok: true, group, names: group.members, surprise: enc.surprise, starting: !!pop.starting }; }));
  // Hand-made room: built on a real dungeon from this save (tiles/textures), then layout/cells/start/exits replaced.
  app.post('/builder/room', guard, json, wrap(req => { const key = req.body.key || cur(), spec = req.body.spec || {}, mode = req.body.mode || 'hand';
    const d = db(); B.installRoom(d, key, spec); d[key].builderMode = mode; setDb(d);
    const template = sharedState.getRoomDungeon(coordsOf(key)) || sharedState.getRoomDungeon(coordsOf(cur())) || {};
    const hand = d[key].builderDungeon, next = { ...template, ...hand, geoKey: key, sceneStructures: spec.keepScenery ? template.sceneStructures || [] : [], surfaceArt: spec.keepScenery ? template.surfaceArt : [],
      moldingArt: [], sceneObjects: [], tiles: template.tiles || {}, visualStyle: template.visualStyle || {}, builder: { mode, at: Date.now() },
      sceneSpec: { ...(template.sceneSpec || {}), exits: hand.exits.map(e => e.direction), source: { roomName: d[key].name, description: d[key].description, exits: hand.exits.map(e => e.direction) } } };
    try { Exits.install(next, hand.exits.map(e => e.direction)); } catch (e) { next.roomExits = { markers: [] }; }
    sharedState.setRoomDungeon(coordsOf(key), next, template.customTiles || []);
    return { ok: true, key, mode, layout: next.layout, exits: (next.roomExits?.markers || []).map(m => m.direction) }; }));
  app.post('/builder/world/save', json, wrap(req => { const w = B.world(req.body.world); fs.writeFileSync(path.join(DIR, safe(w.name) + '.json'), B.save(w)); return { ok: true, name: w.name, file: safe(w.name) + '.json' }; }));
  app.get('/builder/world/:name', wrap(req => B.load(fs.readFileSync(path.join(DIR, safe(req.params.name) + '.json'), 'utf8'))));
  app.post('/builder/world/play', guard, json, wrap(req => { const w = req.body.world ? B.world(req.body.world) : B.load(fs.readFileSync(path.join(DIR, safe(req.body.name) + '.json'), 'utf8'));
    const d = B.seedCampaign(db(), w); if (w.setting) d['0,0,0'].setting = w.setting; setDb(d); return { ok: true, built: Object.keys(w.rooms), start: w.start }; }));
  // Open in Campaign Editor: snapshot the live game first; Return to game resumes from the (edited) save.
  app.post('/builder/snapshot', json, wrap(() => { const file = path.join(SNAP, `snap-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), key: cur(), console: sharedState.getUpdatedGameConsole(), db: sharedState.getRoomNameDatabase(), dungeon: sharedState.getRoomDungeon(coordsOf(cur())) }));
    return { ok: true, file: path.basename(file), key: cur() }; }));
  // Homebrew setting bible from a seed; mock-friendly (one contract call, local fallback).
  app.post('/builder/instructions/expand', guard, json, async (req, res) => { try { const d = db(), b = d['0,0,0']?.settingDraft || d['0,0,0']?.setting || {};
    const ins = await Setting.expandInstructions(req.body.instructions, b, { runner: Setting.defaultRunner }); if (d['0,0,0']?.settingDraft) { d['0,0,0'].settingDraft.instructions = ins; setDb(d); } res.json({ ok: true, instructions: ins }); } catch (e) { res.status(400).json({ error: e.message }); } });
  // Test mode (walk, Test encounter now, test-play): the GM persona is 'Holodek'.
  app.post('/builder/testmode', json, wrap(req => ({ ok: true, testMode: Setting.setTestMode(!!req.body?.on), gmName: Setting.gmName() })));
  // New-world flow: picked genres (authoritative) + game prompt -> bible + MASTER SYSTEM PROMPT draft for review.
  // Nothing goes live until /builder/setting/start; the draft is saved so it can be edited later.
  // world1: live progress for the slow new-world steps so the panel can show what Holodek is doing (GET /builder/progress).
  const progress = { stage: null, stages: [], error: null, at: 0 }, stage = (name, error = null) => { Object.assign(progress, { stage: name, error, at: Date.now() }); if (name && !progress.stages.includes(name)) progress.stages.push(name); console.info('[BuilderProgress]', JSON.stringify({ stage: name, error })); };
  app.get('/builder/progress', (req, res) => res.json({ ok: true, ...progress }));
  const draft = async body => { progress.stages = []; stage('setting bible'); const prompt = String(body.prompt || '').slice(0, 2000), seed = String(body.seed || prompt || 'a new world').slice(0, 200);
    const bible = await Setting.generate(seed, { runner: Setting.defaultRunner, picked: body.genres || null });
    bible.gamePrompt = prompt;
    return Setting.withDraft(bible, async () => { // draft calls are translated and linted as this world, never as Children of the Grave
      stage('master prompt'); const master = await Setting.generateMaster(bible, prompt, { runner: Setting.defaultRunner }); bible.masterDraft = master.text; bible.gmName = master.gmName;
      stage('world roster'); Object.assign(bible, await Setting.generateRoster(bible, { runner: Setting.defaultRunner })); // classes + races, cached in the world file
      stage('additional instructions'); const ins = await Setting.expandInstructions(body.instructions, bible, { runner: Setting.defaultRunner }); bible.instructions = ins;
      stage('ready for review'); return { bible, master, ins }; }); };
  app.post('/builder/setting', guard, json, async (req, res) => { try { const { bible, master, ins } = await draft(req.body || {});
    const d = db(); (d['0,0,0'] ||= {}).settingDraft = bible; setDb(d); res.json({ ok: true, bible, master: master.text, gmName: master.gmName, instructions: ins, sections: master.sections, leaks: [...B.lintGenerated(bible), ...master.leaks] }); } catch (e) { stage(progress.stage, e.message); console.error('[BuilderProgress] ERROR', e.message); res.status(400).json({ error: e.message, stage: progress.stage }); } });
  app.post('/builder/setting/start', guard, json, wrap(req => { const d = db(), b = d['0,0,0']?.settingDraft || d['0,0,0']?.setting; if (!b) throw Error('Build a setting first.');
    if (typeof req.body.expanded === 'string' && b.instructions) b.instructions.expanded = req.body.expanded.slice(0, 4000);
    Setting.setMaster(b, Setting.withInstructions(req.body.master || b.masterDraft, b.instructions)); if (req.body.gmName && /^[A-Za-z][\w' -]{2,39}$/.test(req.body.gmName)) b.gmName = req.body.gmName; Setting.setTestMode(false); if (req.body.genres) { const g = Setting.normalizePicked(req.body.genres); if (g) { b.genres = g.map(x => x.genre); b.genreWeights = g; b.genresPicked = true; } }
    b.party = req.body.party !== false; b.mainCharacter = String(req.body.mainCharacter || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    B.setPlayerText('mainCharacter', b.mainCharacter); // player-provided: never filtered or renamed, even if it uses a Children of the Grave name
    if (b.mainCharacter || !b.party) Setting.setMaster(b, String(b.masterPrompt || '').replace(/\n## Main character[\s\S]*$/, '') + `\n## Main character\n${b.mainCharacter ? 'The player chose this main character (authoritative): ' + b.mainCharacter : 'The player will create the main character.'}\nParty: ${b.party ? 'the player travels with companions from this world.' : 'the player travels solo; do not add companions.'}`);
    if (!b.classes || !b.races) Object.assign(b, Setting.localRoster(b)); // worlds drafted before rosters existed
    d['0,0,0'].setting = b; delete d['0,0,0'].settingDraft; setDb(d); Setting.setActive(b); Setting.rememberNames(b);
    return { ok: true, name: b.name, gmName: b.gmName, genres: b.genreWeights, resourceName: b.resourceName, classes: b.classes, races: b.races, firstRoom: Setting.firstRoom(b).name, party: b.party, mainCharacter: b.mainCharacter, active: !!Setting.current() }; }));
  // Prefab texture library (existing generators only) and non-destructive per-room overrides.
  const Tex = require('./textureLibrary');
  app.get('/builder/textures', wrap(req => ({ counts: Tex.counts(), entries: Tex.list(req.query.q).slice(0, Number(req.query.limit) || 400) })));
  app.get('/builder/texture.png', (req, res) => { try { const e = Tex.list().find(x => x.id === req.query.id); if (!e) return res.status(404).end();
    res.type('png').send(Tex.thumbnail({ ...e.spec, ...(req.query.palette ? { paletteName: req.query.palette } : {}) }, Math.min(256, Number(req.query.size) || 64))); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/builder/texture/generate', guard, json, async (req, res) => { try { res.json({ ok: true, entry: await Tex.generate(req.body.description, { runner: Setting.defaultRunner }) }); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/builder/overrides', json, wrap(req => { const key = req.body.key || cur(), d = db(); (d[key] ||= {}).overrides = req.body.overrides || null; setDb(d); return { ok: true, key, overrides: d[key].overrides }; }));
  console.info('[CampaignBuilder] enabled on port', port);
  return true;
}
module.exports = { install, enabled };
