'use strict';
const I = require('../assets/dungeonInhabitants');
const Catalog = require('../assets/monsterRaces');
const Discovery = require('../assets/outdoorDiscovery');
const Campaign = require('./campaignMemory');
const Balance = require('./encounterBalance');
const EncounterPolicy = require('./encounterPolicy');
const { generateInhabitants } = require('./inhabitantGeneration');
const { randomInt } = require('node:crypto');
const pending = new WeakSet();
const inCombat = state => state.getCombatActive?.() === true || require('./actionDice').actionDice.active?.kind === 'combat';
const policy = (indoor,roll=0,{partySize,settled=false,city=false}={}) => ({
  ...(city ? {limit:2,distance:48,cooldown:90000,activeTime:true} : indoor ? settled ? {limit:2,distance:48,cooldown:120000} : {limit:2,distance:32,cooldown:60000} : {limit:2,distance:96,cooldown:90000}),
  groupMin:2,groupMax:6,groupSize:partySize ? Balance.groupSize(partySize,roll) : 2+Math.min(4,Math.max(0,Math.floor(roll*5)))});

function observe(population, dungeon, player, now = Date.now()) {
  const pacing = population.randomEncounters ||= { version: 1, count: 0, attempts: 0, distance: 0, lastAttempt: now, recentRaces: [] };
  if (Discovery.city(dungeon)) {
    pacing.movingMs ||= 0; pacing.walkedDistance ||= 0; pacing.excursion ||= 0; pacing.explored ||= '';
    Discovery.sample(pacing, dungeon, player, now);
    return pacing;
  }
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
  if (!visit?.population || visit.error || visit.encounters?.length || visit.discoveries?.length ||
      state.getGamePaused?.() || state.getDungeonTestingMode?.() || inCombat(state)) return null;
  const p = visit.population, coords = state.getLastCoords(), d = state.getRoomDungeonForSimulation(coords);
  if (!d || p.starting || p.geoKey === '0,0,0'&&!d.cityFloorContext || d.geoKey !== p.geoKey || !I.pointWalkable(d, player.x, player.y)) return null;
  if(['starting','safe'].includes(p.encounterBudget?.profile))return null;
  if(!Discovery.city(d)&&p.venue&&Object.values(p.actors).some(a=>a.serviceRole))return null;
  const city = Discovery.city(d);
  if (city && (!Discovery.publicPoint(d, player) || p.dialogueFocus?.until > now)) {
    if(p.randomEncounters)delete p.randomEncounters.sample;
    return null;
  }
  if (!city && visit.dialogue?.length) return null;
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'), pc = roster.find(a => a.type === 'pc');
  if (!pc || pc.hp <= 0 || !I.isAlive(pc)) return null;
  const settled = city || (p.encounterBalance?.settled ?? !!(p.venue || p.settlement || d.cityFloorContext));
  const pacing = observe(p, d, player, now), rules = policy(d.classification?.indoor !== false,
    I.hash(`${state.getDungeonRunId()}:${p.geoKey}:encounter-size:${pacing.attempts}`)/4294967296,
    {partySize:Balance.partySummary(roster).size,settled,city});
  const travelled = pacing.distance >= rules.distance || city && pacing.walkedDistance >= rules.distance && pacing.excursion >= 8;
  // City civilians are atmosphere, not a blanket exclusion zone for street encounters.
  const crowded = Object.values(p.actors).some(a => a.status === 'present' && a.hp > 0 && a.discoveryState !== 'pending' && a.position &&
    (a.allegiance === 'Hostile' || !city) && Math.hypot(a.position.x + .5 - player.x, a.position.y + .5 - player.y) <
      (a.allegiance === 'Hostile' || settled ? 28 : 8));
  if(crowded){if(city)Discovery.resetPacing(pacing);return null;}
  if (pacing.count >= rules.limit || pacing.attempts >= rules.limit * 3 || !travelled || now - pacing.lastAttempt < rules.cooldown ||
      rules.activeTime && pacing.movingMs < rules.cooldown ||
      p.travelDiscovery?.active || (p.retreatUntil || 0) > now || Object.keys(p.actors).length + rules.groupSize > 32) return null;
  const occupied = new Set(Object.values(p.actors).filter(a => a.position).map(a => `${a.position.x},${a.position.y}`));
  if(city)for(const a of Object.values(d.cityCrowd?.actors || {}))if(a.status==='ambient'&&a.position)occupied.add(`${a.position.x},${a.position.y}`);
  for (const actor of roster) if (I.isAlive(actor) && actor.mazeRoomKey === p.geoKey && Number.isFinite(actor.mazeX) && Number.isFinite(actor.mazeY)) occupied.add(`${actor.mazeX},${actor.mazeY}`);
  for (const item of d.sceneObjects || []) occupied.add(`${item.x},${item.y}`);
  const heading = p.travelDiscovery?.heading ?? pacing.heading ?? 0;
  const pool = Discovery.candidates(d, player, heading || 0, occupied);
  for (const candidate of pool) {
    const spaces = Discovery.groupSpaces(d, candidate, rules.groupSize, occupied, player);
    if (spaces.length >= rules.groupSize) return { population: p, dungeon: d, roster, pacing, rules, spaces: spaces.slice(0, rules.groupSize), player: { ...player } };
  }
  return null;
}
function levelBudget(roster) {
  return Balance.partySummary(roster).level;
}
function xp(level, archetype) {
  const threshold = { Wizard: 2500, Witch: 2500, Sorcerer: 3000, Warlock: 3000, Necromancer: 2500 }[archetype] || 3500;
  return level < 2 ? 0 : threshold * 2 ** Math.min(7, level - 2) * Math.max(1, level - 8);
}
async function maybeGenerate({ state, service, visit, player, isCurrent = () => true, runtime, now = Date.now(), random }) {
  if (pending.has(state) || !isCurrent()) return visit;
  const ready = opportunity(state, visit, player, now);
  if (!ready) return visit;
  pending.add(state);
  const { population: p, dungeon: d, pacing, rules } = ready, runId = state.getDungeonRunId(), revision = p.revision;
  try {
    pacing.lastAttempt = now; pacing.distance = 0; pacing.attempts++;
    if (rules.activeTime) Discovery.resetPacing(pacing);
    const draw=random||((purpose)=>EncounterPolicy.unit(`${runId}:${p.geoKey}:random:${pacing.attempts}:${purpose}`));
    const hit=draw('chance')<.25,allegiance=hit?EncounterPolicy.disposition(draw('disposition')):null;
    pacing.lastRoll={attempt:pacing.attempts,hit,allegiance};
    service.save(p);
    if(!hit)return visit;
    const savedRevision = p.revision, consoleText = state.getUpdatedGameConsole(), db = JSON.parse(state.getRoomNameDatabase() || '{}'), room = db[p.geoKey] || {};
    const generator = runtime || require('./graveMasterProtocol').runtimeFor(state);
    const ecology=require('./settingEcology'),table=ecology.get(db),city=room.campaignSetting?.city;
    if(ecology.enabled()&&db['0,0,0']?.setting?.kind==='homebrew'&&!table)throw Error('This setting has no authored encounter ecology; no CotG prefab was substituted.');
    const cotg=!require('./settingLayer').current()&&db['0,0,0']?.setting?.kind!=='homebrew';
    const cotgAuthorship=cotg?require('./cotgPopulationAuthoring').select({
      seed:`${runId}:${p.geoKey}:random:${pacing.attempts}`,group:'supplemental',table,mix:city?.populationMix,roll:draw('authorship')
    }):null;
    const selected=!cotg&&table?ecology.choose(table,city?.populationMix):null;
    const party = Balance.partyMembers(ready.roster,consoleText), level = levelBudget(party), choices = selected?[selected]:Catalog;
    const pickLevel=Balance.levelPicker(party,{fallback:()=>Math.max(1,level-randomInt(0,2)),random:(min,max)=>randomInt(min,max+1)});
    const result = await generator.run(generator.retort(async $ => {
      require('./graveMasterStoryPrompts').appendOriginal($);
      await Campaign.appendPlanning($, state, 'supplemental encounter: fresh local themes, prior encounters, factions and unresolved choices', { consoleText });
      return generateInhabitants($, { roomName: room.name, roomDescription: room.description || consoleText.match(/^Room Description:[ \t]*(.*)$/m)?.[1],
        geoKey: p.geoKey, indoor: d.classification?.indoor !== false, rooms: db,
        campaignSetting: room.campaignSetting?.village ? { ...room.campaignSetting, village: undefined } : room.campaignSetting,
        partyNames: ready.roster.filter(a => a.type !== 'monster').map(a => a.name),
        party,
        usedNames: Object.values(db).flatMap(r => Object.keys(r?.inhabitants?.actors || {})), quest: state.getCurrentQuest?.(),
        encounter: { count: rules.groupSize, allegiance, required:true,
          ...(cotgAuthorship?{cotgAuthorship,races:[],catalog:[]}: {races:choices.map(row => row.name),catalog:choices}),
          theme: `Author one coherent ${rules.groupSize}-member encounter sharing an encounterId. Ordinary hostile groups have 2-6 members, not unrelated solo threats. Suitable for ${room.name || 'this location'} and its ecology, lore and conflicts. Existing residents (do not replace): ${Object.values(p.actors).slice(0, 24).map(a => `${a.race}: ${a.job}`).join('; ')}. Recently selected supplementary races: ${pacing.recentRaces.join(', ') || 'None'}. Prefer a fresh choice unless continuity calls for a repeat. Not every encounter is hostile. Native plane data, when supplied, governs knowledge of the war.` } },
      { level: pickLevel, random: randomInt, sex: () => randomInt(0, 2) ? 'Female' : 'Male', xp, equipment: async () => null });
    }));
    if (result.skipped) return visit;
    const coords = state.getLastCoords(), currentRoster = JSON.parse(state.getCombatCharactersString() || '[]');
    const currentPc = currentRoster.find(a => a.type === 'pc');
    if (!isCurrent() || state.getGamePaused() || inCombat(state) || runId !== state.getDungeonRunId() || p.geoKey !== `${coords.x},${coords.y},${coords.z}` ||
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
    console.info('[RandomEncounter]',JSON.stringify({geoKey:p.geoKey,status:'installed',groupId:id,partyLevel:level,allegiance,levels:sheets.map(actor=>actor.level)}));
    return { ...visit, population: p, discoveries: [...(visit.discoveries || []), { id, kind: 'people', groupId: id,
      text: 'An unfamiliar encounter lies ahead.', x: ready.spaces[0].x, y: ready.spaces[0].y }] };
  } catch (error) {
    console.warn('[RandomEncounter]', JSON.stringify({ geoKey: p.geoKey, status: 'not-installed', error: error.message, revision }));
    return visit;
  } finally { pending.delete(state); }
}
module.exports = { policy, observe, opportunity, levelBudget, maybeGenerate };
