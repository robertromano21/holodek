'use strict';
const I = require('../assets/dungeonInhabitants');
const Catalog = require('../assets/monsterRaces');
const Discovery = require('../assets/outdoorDiscovery');
const Campaign = require('./campaignMemory');
const { generateInhabitants } = require('./inhabitantGeneration');
const { randomInt } = require('node:crypto');
const pending = new WeakSet();
const policy = indoor => indoor ? { limit: 2, distance: 48, cooldown: 120000, groupSize: 1 } :
  { limit: 5, distance: 96, cooldown: 90000, groupSize: 3 };

function observe(population, dungeon, player, now = Date.now()) {
  const pacing = population.randomEncounters ||= { version: 1, count: 0, attempts: 0, distance: 0, lastAttempt: now, recentRaces: [] };
  const prior = pacing.sample;
  pacing.sample = { x: player.x, y: player.y, at: now };
  if (prior && now > prior.at && now - prior.at < 10000) {
    const distance = Math.hypot(player.x - prior.x, player.y - prior.y);
    if (distance >= .3 && distance <= 12 && I.lineClear(dungeon, prior, player)) {
      pacing.distance += distance; pacing.heading = Math.atan2(player.y - prior.y, player.x - prior.x);
    }
  }
  return pacing;
}
function opportunity(state, visit, player, now = Date.now()) {
  if (!visit?.population || visit.error || visit.encounters?.length || visit.discoveries?.length || visit.dialogue?.length ||
      state.getGamePaused?.() || state.getDungeonTestingMode?.()) return null;
  const p = visit.population, coords = state.getLastCoords(), d = state.getRoomDungeonForSimulation(coords);
  if (!d || p.starting || p.geoKey === '0,0,0' || d.geoKey !== p.geoKey || !I.pointWalkable(d, player.x, player.y)) return null;
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'), pc = roster.find(a => a.type === 'pc');
  if (!pc || pc.hp <= 0 || !I.isAlive(pc)) return null;
  const pacing = observe(p, d, player, now), rules = policy(d.classification?.indoor !== false);
  if (pacing.count >= rules.limit || pacing.attempts >= rules.limit * 3 || pacing.distance < rules.distance || now - pacing.lastAttempt < rules.cooldown ||
      p.travelDiscovery?.active || (p.retreatUntil || 0) > now || Object.keys(p.actors).length + rules.groupSize > 32) return null;
  // Extra encounters never crowd an existing local opportunity, irrespective of its allegiance.
  if (Object.values(p.actors).some(a => a.status === 'present' && a.hp > 0 && a.discoveryState !== 'pending' && a.position &&
      Math.hypot(a.position.x + .5 - player.x, a.position.y + .5 - player.y) < 28)) return null;
  const occupied = new Set(Object.values(p.actors).filter(a => a.position).map(a => `${a.position.x},${a.position.y}`));
  for (const actor of roster) if (I.isAlive(actor) && actor.mazeRoomKey === p.geoKey && Number.isFinite(actor.mazeX) && Number.isFinite(actor.mazeY)) occupied.add(`${actor.mazeX},${actor.mazeY}`);
  for (const item of d.sceneObjects || []) occupied.add(`${item.x},${item.y}`);
  const heading = p.travelDiscovery?.heading ?? pacing.heading ?? 0;
  const pool = Discovery.candidates(d, player, heading || 0, occupied);
  for (const candidate of pool) {
    const spaces = [candidate];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: candidate.x + dx, y: candidate.y + dy }, cell = d.cells[`${next.x},${next.y}`];
      if (!occupied.has(`${next.x},${next.y}`) && cell?.tile === 'floor' && !cell.feature && !cell.object &&
          !cell.exitMarker && !cell.complexExit && I.canTraverse(d, candidate, next)) spaces.push(next);
    }
    if (spaces.length >= rules.groupSize) return { population: p, dungeon: d, roster, pacing, rules, spaces: spaces.slice(0, rules.groupSize), player: { ...player } };
  }
  return null;
}
function levelBudget(roster) {
  const party = roster.filter(a => ['pc', 'npc'].includes(a.type) && I.isAlive(a) && a.name !== 'Mortacia');
  const average = party.length ? party.reduce((sum, a) => sum + (a.level || 1), 0) / party.length : 3;
  return Math.max(1, Math.min(12, Math.floor(average)));
}
function xp(level, archetype) {
  const threshold = { Wizard: 2500, Witch: 2500, Sorcerer: 3000, Warlock: 3000, Necromancer: 2500 }[archetype] || 3500;
  return level < 2 ? 0 : threshold * 2 ** Math.min(7, level - 2) * Math.max(1, level - 8);
}
async function maybeGenerate({ state, service, visit, player, isCurrent = () => true, runtime, now = Date.now() }) {
  if (pending.has(state) || !isCurrent()) return visit;
  const ready = opportunity(state, visit, player, now);
  if (!ready) return visit;
  pending.add(state);
  const { population: p, dungeon: d, pacing, rules } = ready, runId = state.getDungeonRunId(), revision = p.revision;
  pacing.lastAttempt = now; pacing.distance = 0; pacing.attempts++;
  service.save(p);
  const savedRevision = p.revision, consoleText = state.getUpdatedGameConsole(), db = JSON.parse(state.getRoomNameDatabase() || '{}'), room = db[p.geoKey] || {};
  try {
    const generator = runtime || require('./graveMasterProtocol').runtimeFor(state);
    const level = levelBudget(ready.roster), choices = Catalog;
    const result = await generator.run(generator.retort(async $ => {
      require('./graveMasterStoryPrompts').appendOriginal($);
      await Campaign.appendPlanning($, state, 'supplemental encounter: fresh local themes, prior encounters, factions and unresolved choices', { consoleText });
      return generateInhabitants($, { roomName: room.name, roomDescription: room.description || consoleText.match(/^Room Description:[ \t]*(.*)$/m)?.[1],
        geoKey: p.geoKey, indoor: d.classification?.indoor !== false,
        campaignSetting: room.campaignSetting?.village ? { ...room.campaignSetting, village: undefined } : room.campaignSetting,
        partyNames: ready.roster.filter(a => a.type !== 'monster').map(a => a.name),
        usedNames: Object.values(db).flatMap(r => Object.keys(r?.inhabitants?.actors || {})), quest: state.getCurrentQuest?.(),
        encounter: { count: rules.groupSize, races: choices.map(row => row.name), catalog: choices,
          theme: `Choose a small coherent encounter suitable for ${room.name || 'this location'} and its current ecology, lore and conflicts. Existing residents (do not replace): ${Object.values(p.actors).slice(0, 24).map(a => `${a.race}: ${a.job}`).join('; ')}. Recently selected supplementary races: ${pacing.recentRaces.join(', ') || 'None'}. Prefer a fresh choice unless continuity calls for a repeat. Not every encounter is hostile. Native plane data, when supplied, governs knowledge of the war.` } },
      { level: () => Math.max(1, level - randomInt(0, 2)), random: randomInt, sex: () => randomInt(0, 2) ? 'Female' : 'Male', xp, equipment: async () => null });
    }));
    if (result.skipped) return visit;
    const coords = state.getLastCoords(), currentRoster = JSON.parse(state.getCombatCharactersString() || '[]');
    const currentPc = currentRoster.find(a => a.type === 'pc');
    if (!isCurrent() || state.getGamePaused() || runId !== state.getDungeonRunId() || p.geoKey !== `${coords.x},${coords.y},${coords.z}` ||
        state.getRoomPopulation(p.geoKey) !== p || p.revision !== savedRevision || consoleText !== state.getUpdatedGameConsole() ||
        !currentPc || currentPc.hp <= 0 || state.getRoomDungeonForSimulation(coords) !== d || !I.pointWalkable(d, player.x, player.y) ||
        Number.isFinite(currentPc.mazeX) && Math.hypot(currentPc.mazeX + .5 - player.x, currentPc.mazeY + .5 - player.y) > 6) return visit;
    const sheets = I.parseBlocks(result.sheets), names = new Set(Object.keys(p.actors));
    if (sheets.length !== rules.groupSize || sheets.some(a => names.has(a.name))) throw Error('Supplementary cast is incomplete or duplicates an existing resident.');
    const id = `random:${p.geoKey}:${pacing.count + 1}`, extra = result.population;
    const groups = extra.groups.map((g, i) => ({ ...g, id: `${id}:${i}`, discoveryState: 'fixed', supplemental: true,
      site: { ...ready.spaces[Object.keys(extra.actors).indexOf(g.members[0])] } }));
    for (const [i, actor] of Object.values(extra.actors).entries()) {
      actor.encounterId = groups.find(g => g.members.includes(actor.name)).id; actor.home = { x: ready.spaces[i].x, y: ready.spaces[i].y }; actor.position = { ...actor.home };
      actor.discoveryState = 'fixed'; actor.supplemental = true; actor.sheet = sheets.find(s => s.name === actor.name).sheet;
      p.actors[actor.name] = actor;
    }
    p.groups.push(...groups);
    p.initialSheets = [p.initialSheets, result.sheets].filter(Boolean).join('\n');
    pacing.count++; pacing.recentRaces = [...new Set([...pacing.recentRaces, ...sheets.map(a => a.race)])].slice(-8);
    I.attach(currentRoster, p); state.setCombatCharactersString(JSON.stringify(currentRoster)); service.save(p);
    return { ...visit, population: p, discoveries: [...(visit.discoveries || []), { id, kind: 'people', groupId: id,
      text: 'An unfamiliar encounter lies ahead.', x: ready.spaces[0].x, y: ready.spaces[0].y }] };
  } catch (error) {
    console.warn('[RandomEncounter]', JSON.stringify({ geoKey: p.geoKey, status: 'not-installed', error: error.message, revision }));
    return visit;
  } finally { pending.delete(state); }
}
module.exports = { policy, observe, opportunity, levelBudget, maybeGenerate };
