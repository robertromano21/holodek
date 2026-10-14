const Inhabitants = require('../assets/dungeonInhabitants');
const Memory = require('./dialogueMemory');
const MonsterConsoleSync = require('./monsterConsoleSync');
const Discovery = require('../assets/outdoorDiscovery');
const Pursuit = require('./hostilePursuit');
const Divinity = require('./divineEncounters');

function prepareEntryQuestContact(population, dungeon, roster, perception, quest) {
  const introduction = population?.questIntroduction, text = String(quest || '').trim();
  if (!dungeon || population?.geoKey !== dungeon.geoKey || population?.starting || population?.geoKey === '0,0,0' || introduction?.status !== 'pending' ||
      !text || /^none$/i.test(text) || introduction.questId !== String(Inhabitants.hash(text))) return null;
  const record = population.actors[introduction.speaker], actor = roster.find(a => a.name === introduction.speaker && a.type === 'monster');
  if (!record || record.status !== 'present' || !actor || !['Neutral', 'Friendly'].includes(Inhabitants.state(actor))) return null;
  const reach = Inhabitants.dialogueReach(dungeon, actor, perception?.player);
  // An entry introduction is a real, nearby sighting, not discovery of the entire encounter group.
  if (!reach.canSpeak || !reach.lineOfSight && !Inhabitants.hasEncountered(actor, population)) return null;
  if (!record.encounteredAt) {
    record.encounteredAt = Date.now(); population.revision++;
    const group = population.groups.find(g => g.members.includes(actor.name));
    if (group?.status === 'unseen') group.status = 'discovered';
  }
  return { speaker: actor.name, state: Inhabitants.state(actor), quest: text.slice(0, 800), hook: String(introduction.hook || record.dialogue?.[0] || '').slice(0, 400) };
}

function createPopulationService(state) {
  const persistedAt=new WeakMap();
  const discoveryLoggedAt = new WeakMap();
  function discoveryProtection() {
    const names = (state.getCurrentTasks?.() || []).slice(0, 32).flatMap(task =>
      [...(Array.isArray(task?.requiredElements) ? task.requiredElements : []).slice(0, 64).map(element => element?.name),
        ...(task?.status==='Completed'?[]:task?.story?.stages||[]).flatMap(s=>[s.actor,...(s.targets||[])])].filter(Boolean));
    const text = state.getUpdatedGameConsole() || '';
    const boss = text.match(/^Next Boss:[ \t]*([^\r\n]*)/m)?.[1]?.trim();
    if (boss) names.push(boss);
    names.push(...Pursuit.protectedNames(state));
    return names;
  }
  function get(geoKey, consoleText = state.getUpdatedGameConsole(), dungeon = null, observer = null) {
    const consoleKey = Inhabitants.roomKey(consoleText?.match(/^Coordinates:[ \t]*(.*)$/m)?.[1]);
    // Construction can still hold the previous room's console. Never import its cast.
    if (consoleKey && consoleKey !== geoKey) consoleText = '';
    let population = state.getRoomPopulation(geoKey);
    if (!population) {
      let saved;
      try { saved = JSON.parse(state.getRoomNameDatabase() || '{}')[geoKey]?.inhabitants; } catch {}
      const sheets = Inhabitants.parseSheets(consoleText);
      const fallback = consoleText?.match(/^Monsters State:\s*(\w+)/m)?.[1] || 'Neutral';
      const starting = geoKey === '0,0,0';
      population = saved?.version === Inhabitants.VERSION ? saved : Inhabitants.createPopulation(geoKey,
        sheets.map(a => ({ ...a, allegiance: starting ? 'Friendly' : Inhabitants.allegiance(a, fallback), encounterId: 'legacy' })),
        { starting, indoor: dungeon?.classification?.indoor !== false });
      state.setRoomPopulation(geoKey, population);
    }
    try { Divinity.reconcile(JSON.parse(state.getRoomNameDatabase() || '{}'), population); } catch {}
    const sheets = Inhabitants.parseSheets(consoleText);
    const missing = sheets.filter(a => !population.actors[a.name]);
    for (const actor of missing) {
      const fallback = consoleText?.match(/^Monsters State:\s*(\w+)/m)?.[1] || 'Neutral';
      const extra = Inhabitants.createPopulation(geoKey, [{ ...actor, allegiance: geoKey === '0,0,0' ? 'Friendly' :
        Inhabitants.allegiance(actor, fallback === 'Mixed' ? 'Hostile' : fallback), encounterId: `arrival-${Inhabitants.hash(actor.name)}` }],
        { indoor: population.indoor, starting: population.starting });
      Object.assign(population.actors, extra.actors); population.groups.push(...extra.groups);
      delete population.placementStamp;
    }
    Inhabitants.sync(population, sheets, Inhabitants.parseSheets(consoleText, 'NPCs in Party'));
    if (dungeon) {
      const previousStamp = population.placementStamp;
      const alreadyPlaced = population.groups.some(group => group.site || group.introPlayed || group.status !== 'unseen');
      Inhabitants.place(population, dungeon);
      const bossKey = Inhabitants.roomKey(consoleText?.match(/^Boss Room Coordinates:[ \t]*([^\r\n]*)/m)?.[1]);
      Discovery.setup(dungeon, population, { protectedNames: discoveryProtection(), fresh: !previousStamp && !alreadyPlaced,
        bossRoom: bossKey === geoKey,
        player: observer || dungeon.start });
      if (previousStamp !== population.placementStamp) console.info('[RoomPopulation]', JSON.stringify({
        phase: 'placement', geoKey, starting: population.starting, indoor: population.indoor, entry: dungeon.start,
        groups: population.groups.map(group => ({ id: group.id, site: group.site, members: group.members,
          allegiance: population.actors[group.members[0]]?.allegiance,
          entryDistance: group.site && dungeon.start ? Math.round(Math.hypot(group.site.x - dungeon.start.x, group.site.y - dungeon.start.y)) : null }))
      }));
    }
    return population;
  }
  function save(population,{eager=true}={}) {
    population.revision++;
    state.setRoomPopulation(population.geoKey, population);
    const current = state.getUpdatedGameConsole();
    const active = Inhabitants.roomKey(current?.match(/^Coordinates:[ \t]*(.*)$/m)?.[1]) === population.geoKey;
    const projected = active ? Inhabitants.withStates(MonsterConsoleSync.dedupeConsole(current), population) : current;
    if (active && projected !== current) { state.setUpdatedGameConsole?.(projected); eager = true; }
    if(!eager && Date.now()-(persistedAt.get(population) || 0)<15000)return;
    let db;
    try { db = JSON.parse(state.getRoomNameDatabase() || '{}'); } catch { return; }
    if (!db[population.geoKey]) db[population.geoKey] = {};
    db[population.geoKey].inhabitants = population;
    if (active) {
      const room = db[population.geoKey];
      const sheets = Inhabitants.residentSheets(population, Inhabitants.parseSheets(projected));
      const states = new Set(sheets.map(actor => Inhabitants.state(actor)));
      room.monsters = { ...room.monsters,
        inRoom: sheets.map(actor => actor.rawSheet || actor.sheet).join('\n') || 'None',
        equippedProperties: projected.match(/^Monsters Equipped Properties:[ \t]*([^\r\n]*)/m)?.[1]?.trim() || 'None',
        state: states.size > 1 ? 'Mixed' : [...states][0] || 'None' };
      if (population.equipmentProperties !== undefined) population.equipmentProperties = room.monsters.equippedProperties;
      room.monsters.consoleBlock = room.monsters.inRoom;
    }
    Divinity.capture(db, population);
    state.setRoomNameDatabase(JSON.stringify(db));
    persistedAt.set(population,Date.now());
  }
  function prepare(consoleText, dungeon) {
    const geoKey = dungeon?.geoKey || Inhabitants.roomKey(consoleText.match(/^Coordinates:\s*(.*)$/m)?.[1]);
    if (!geoKey) return null;
    const population = get(geoKey, consoleText, dungeon);
    population.companions ||= {};
    const companions = new Set(Inhabitants.parseSheets(consoleText, 'NPCs in Party').filter(Inhabitants.isAlive).map(a=>a.name));
    for (const name of Object.keys(population.companions)) if (!companions.has(name)) delete population.companions[name];
    // The active roster is room-local; residents remain saved in their own population, not in the travelling party.
    const roster = JSON.parse(state.getCombatCharactersString() || '[]').filter(actor =>
      actor.type !== 'monster' || Object.hasOwn(population.actors, actor.name));
    const profiles = new Map((state.getCampaignMemory?.().records || []).filter(row => row.kind === 'biography' && row.profile)
      .map(row => [row.actors[0], row.profile]));
    for (const actor of roster) if (profiles.has(actor.name) || actor.originProfile || population.companions[actor.name]?.profile) {
      actor.originProfile ||= profiles.get(actor.name) || population.companions[actor.name].profile;
      if (actor.type === 'npc') {
        population.companions[actor.name] ||= { name: actor.name, dialogue: [], dialogueIndex: 0 };
        population.companions[actor.name].profile = actor.originProfile;
        population.companions[actor.name].memory ||= { first: '', recent: [], notes: [], player: [], profile: actor.originProfile };
      }
    }
    for (const sheet of [...Inhabitants.parseSheets(consoleText, 'PC'), ...Inhabitants.parseSheets(consoleText, 'NPCs in Party')]) {
      const actor = roster.find(a => a.name === sheet.name && a.type === sheet.type);
      if (actor) { actor.hp = sheet.hp; actor.state = Inhabitants.state(sheet); }
    }
    for (const sheet of Inhabitants.residentSheets(population, Inhabitants.parseSheets(consoleText))) {
      const previous = roster.find(a => a.name === sheet.name);
      if (previous?.type === 'npc') continue;
      if (previous) Object.assign(previous, { hp: sheet.hp, state: Inhabitants.state(sheet), type: 'monster' });
      else if (Inhabitants.isAlive(sheet)) roster.push({ name: sheet.name, type: 'monster', hp: sheet.hp, state: sheet.state });
    }
    Inhabitants.attach(roster, population);
    state.setCombatCharactersString(JSON.stringify(roster));
    save(population);
    return population;
  }
  function recordPositions(population, roster) {
    for (const actor of roster) {
      const record = population.actors[actor.name];
      if (!record || record.discoveryState === 'pending' || actor.type !== 'monster' || Inhabitants.roomKey(actor.mazeRoomKey) !== population.geoKey ||
          !Number.isInteger(actor.mazeX) || !Number.isInteger(actor.mazeY)) continue;
      record.position = { x: actor.mazeX, y: actor.mazeY };
    }
  }
  function visit({ geoKey, runId, actors = [], player, deferIntroductions = false }) {
    if (runId !== state.getDungeonRunId()) return { error: 'That game is no longer active.', status: 409 };
    const coords = state.getLastCoords();
    if (geoKey !== `${coords.x},${coords.y},${coords.z}`) return { error: 'That room is no longer active.', status: 409 };
    if (state.getGamePaused()) return { error: 'The game is paused.', status: 409 };
    const dungeon = state.getRoomDungeonForSimulation ? state.getRoomDungeonForSimulation(coords) : state.getRoomDungeon(coords);
    if (!dungeon || !Number.isFinite(player?.x) || !Number.isFinite(player?.y) ||
        !Inhabitants.pointWalkable(dungeon,player.x,player.y)) return { error: 'No valid observer position.', status: 400 };
    const previousRevision=state.getRoomPopulation(geoKey)?.revision;
    const population = get(geoKey, undefined, dungeon, player);
    let persistentChange=previousRevision!==population.revision;
    const roster = JSON.parse(state.getCombatCharactersString() || '[]');
    for (const incoming of Array.isArray(actors) ? actors.slice(0, 32) : []) {
      if (!incoming || typeof incoming.name !== 'string') continue;
      const actor = roster.find(a => a.name === incoming.name);
      const record = population.actors[incoming.name];
      if (record?.discoveryState === 'pending' || record?.discoveryRevision && incoming.discoveryRevision !== record.discoveryRevision) continue;
      if (!actor || !Number.isInteger(incoming.mazeX) || !Number.isInteger(incoming.mazeY) ||
          !Inhabitants.walkable(dungeon, incoming.mazeX, incoming.mazeY)) continue;
      actor.mazeX = incoming.mazeX; actor.mazeY = incoming.mazeY; actor.mazeRoomKey = geoKey;
      const point = incoming.mazePoint;
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y) &&
          Math.hypot(point.x - actor.mazeX - 0.5, point.y - actor.mazeY - 0.5) <= 1.5 &&
          Inhabitants.pointWalkable(dungeon, point.x, point.y) &&
          Inhabitants.lineClear(dungeon, point, { x: actor.mazeX + 0.5, y: actor.mazeY + 0.5 })) actor.mazePoint = { x: point.x, y: point.y };
      else delete actor.mazePoint;
    }
    const pc = roster.find(a => a.type === 'pc');
    if (pc) { pc.mazeX = Math.floor(player.x); pc.mazeY = Math.floor(player.y); pc.mazePoint={x:player.x,y:player.y};pc.mazeRoomKey = geoKey; }
    Inhabitants.attach(roster, population);
    recordPositions(population, roster);
    const discovery = Discovery.tick(dungeon, population, roster, player, {
      consoleText: state.getUpdatedGameConsole(), protectedNames: discoveryProtection() });
    persistentChange ||= discovery.changed;
    persistentChange = Pursuit.observe(population, dungeon, player, Pursuit.protectedNames(state)) || persistentChange;
    if (discovery.waitReason && (discovery.discoveries.length || Date.now() - (discoveryLoggedAt.get(population) || 0) >= 30000)) {
      discoveryLoggedAt.set(population, Date.now());
      const travel = population.travelDiscovery;
      console.info('[RoomPopulation]', JSON.stringify({ phase: discovery.discoveries.length ? 'discovery' : 'travel',
        geoKey, player, reason: discovery.waitReason, distance: Math.round(travel.distance), nextDistance: travel.nextDistance,
        movingSeconds: Math.round(travel.movingMs / 1000), sequence: travel.sequence,
        pendingGroups: population.groups.filter(g => g.discoveryState === 'pending').length,
        unseenPlacedGroups: population.groups.filter(g => g.discoveryState === 'placed' && g.status === 'unseen').length,
        active: travel.active || null, discoveries: discovery.discoveries }));
    }
    const dialogue = [], candidates = [], encounters = [];
    const speakerActor = record => roster.find(a => a.name === record.name && a.type === 'monster') ||
      { ...record, type: 'monster', mazeX: record.position?.x, mazeY: record.position?.y, mazeRoomKey: geoKey };
    for (const group of population.groups) {
      if (group.status === 'exhausted' || group.discoveryState === 'pending' || !group.site) continue;
      const near = group.members.map(name => population.actors[name]).filter(a => a?.status === 'present' && a.position &&
        Math.hypot(a.position.x + 0.5 - player.x, a.position.y + 0.5 - player.y) <= 8 &&
        Inhabitants.lineClear(dungeon, player, { x: a.position.x + 0.5, y: a.position.y + 0.5 }));
      for (const resident of near) if (!resident.encounteredAt) {
        resident.encounteredAt = Date.now(); persistentChange = true;
      }
      const speakers = group.members.map(name => population.actors[name]).filter(a => a?.status === 'present' && a.encounteredAt > 0 &&
        Inhabitants.dialogueReach(dungeon, speakerActor(a), player).canSpeak);
      if (!deferIntroductions || group.introPlayed) candidates.push(...speakers.filter(a=>a.dialogueIndex<a.dialogue.length));
      if (near.length && group.status === 'unseen') { group.status = 'discovered'; population.revision++;persistentChange=true; Discovery.release(population, group.id); }
      // Seeing a resident is not a conversation. Keep its introduction unspent until approached.
      if (!speakers.length) continue;
      if (dialogue.length>=2) continue;
      if (!group.introPlayed) {
        if (deferIntroductions) {
          if (encounters.length < 2) encounters.push({ groupId: group.id, names: speakers.map(a => a.name) });
          continue;
        }
        const speaker = speakers[0];
        const line = speaker.dialogue[0];
        if (line) dialogue.push({ speaker: speaker.name, line, kind: 'encounter' });
        group.introPlayed = true;
        speaker.dialogueIndex = line ? 1 : 0;
      }
    }
    const focused = population.dialogueFocus?.until > Date.now();
    if (!dialogue.length && !encounters.length && !focused && Date.now() - (population.lastCannedSpeechAt || 0) >= 30000) {
      const party = roster.filter(a => a.type==='npc' && (a.hp ?? 1)>0 && Inhabitants.state(a)!=='Dead');
      const partyNames = new Set(party.map(actor => actor.name));
      population.dialogueQueue = Inhabitants.sanitizeExchanges(population.dialogueQueue, [...partyNames]);
      // An exchange is atomic: don't deliver an answer if its other speaker cannot be heard.
      const exchangeIndex = population.dialogueQueue.findIndex(exchange => exchange.lines.every(row =>
        Inhabitants.dialogueReach(dungeon, party.find(actor => actor.name===row.speaker), player).canSpeak));
      if (exchangeIndex >= 0) {
        const [exchange] = population.dialogueQueue.splice(exchangeIndex, 1);
        dialogue.push(...exchange.lines.map(row => ({ ...row, kind:'canned' })));
      }
      const companions = roster.filter(a => a.type==='npc' && (a.hp ?? 1)>0 &&
        population.companions?.[a.name]?.dialogueIndex < (population.companions?.[a.name]?.dialogue?.length || 0) &&
        Inhabitants.dialogueReach(dungeon, a, player).canSpeak);
      candidates.push(...companions.map(a=>population.companions[a.name]));
      const cache=candidates.sort((a,b)=>(a.lastSpokeAt || 0)-(b.lastSpokeAt || 0) || a.name.localeCompare(b.name))[0];
      if (cache && !dialogue.length) {
        dialogue.push({speaker:cache.name,line:cache.dialogue[cache.dialogueIndex++],kind:'canned'});
      }
    }
    if (dialogue.length) {
      population.lastCannedSpeechAt = Date.now();
      Inhabitants.noteSpoken(population,dialogue);
      if (state.getDialogueMemory) Memory.rememberDialogue(state, population, dialogue, 'canned');
    }
    state.setCombatCharactersString(JSON.stringify(roster));
    save(population,{eager:persistentChange || dialogue.length>0});
    const speech = dialogue.slice(0, 2).map(row => {
      const actor = roster.find(a => a.name === row.speaker) || speakerActor(population.actors[row.speaker]);
      const reach = Inhabitants.dialogueReach(dungeon, actor, player);
      return { speaker: row.speaker, kind: row.kind, distance: Math.round(reach.distance * 100) / 100,
        range: reach.range, lineOfSight: reach.lineOfSight, canHear: reach.canHear };
    });
    return { population, dialogue: dialogue.slice(0, 2), speech, discoveries: discovery.discoveries,
      ...(deferIntroductions ? { encounters } : {}) };
  }
  return { get, save, prepare, visit, recordPositions };
}

module.exports = { createPopulationService, prepareEntryQuestContact };
