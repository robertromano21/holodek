'use strict';
const { randomUUID } = require('node:crypto');
const R = require('../assets/economyRules');
const Gear = require('../assets/equipmentRules');
const SpellRules = require('../assets/spellRules');
const I = require('../assets/dungeonInhabitants');
const Inventory = require('../assets/inventoryUi');
const Reach = require('./dungeonReach');
const { isReservedBossKeyName } = require('./bossGate');
const { formatStartingCharacterSheet } = require('./initialGameState');
const Campaign = require('./campaignSetting');
const Objects = require('../assets/sceneObjectSync');
const World = require('../assets/worldInteractionUi');
const Discovery = require('../assets/outdoorDiscovery');
const Divinity = require('./divineEncounters');
const Pantheon = require('../assets/pantheonCharacters');
const field = (text, label) => String(text).match(new RegExp('^' + label + ':[ \\t]*([^\\r\\n]*)', 'm'))?.[1]?.trim() || '';
function write(text, label, value) {
  const pattern = new RegExp('^' + label + ':[^\\r\\n]*', 'm');
  return pattern.test(text) ? text.replace(pattern, () => label + ': ' + value) : label + ': ' + value + '\n' + text;
}
const databaseOf = state => JSON.parse(state.getRoomNameDatabase() || '{}');
const namesOf = text => field(text, 'Inventory').split(/,\s*/).filter(n => n && !/^(empty|none)$/i.test(n));
const propertiesOf = text => Inventory.parseProperties(field(text, 'Inventory Properties'));
const flatItem = item => Object.fromEntries(Object.entries(item).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
const roomKey = state => I.roomKey(field(state.getUpdatedGameConsole(), 'Coordinates'));
const paymentLabel = mission => mission.rewardItem ? `${mission.rewardItem.name} (Magic ${mission.rewardItem.magic})` : `${mission.rewardSilver} silver pieces`;
const itemLabel = name => String(name).replace(/[,|:"<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
function ledger(state, db) {
  db['0,0,0'] ||= {};
  const runId = state.getDungeonRunId();
  if (db['0,0,0'].economy?.runId !== runId) db['0,0,0'].economy = {
    version: 1, runId, silver: 0, revision: 0, receipts: [], source: 'engine-economy-v1', initialized: 'legacy-zero' };
  return db['0,0,0'].economy;
}
function commit(state, db, text = state.getUpdatedGameConsole()) {
  const book = ledger(state, db);
  state.setRoomNameDatabase(JSON.stringify(db));
  state.setUpdatedGameConsole(write(text, 'Silver Pieces', book.silver));
  return book;
}
function start(state, pc, party) {
  const db = databaseOf(state), book = ledger(state, db);
  if (book.initialized === 'new-game') return book;
  book.silver = R.startingSilver(pc, party); book.initialized = 'new-game';
  book.initialContributors = [...new Set([pc, ...(party || [])].map(a => a.Name || a.name))].filter(n => R.key(n) !== 'mortacia');
  return commit(state, db);
}
function project(state) {
  const db = databaseOf(state), book = ledger(state, db);
  const text = write(state.getUpdatedGameConsole(), 'Silver Pieces', book.silver);
  commit(state, db, text);
  return book;
}
function inventoryText(text, names, props) {
  return write(write(text, 'Inventory', names.join(', ') || 'Empty'), 'Inventory Properties',
    props.filter(p => names.some(n => R.key(n) === R.key(p.name))).map(p => JSON.stringify(flatItem(p))).join(', ') || 'None');
}
function addItem(text, item) {
  if (R.isHealingPotion(item)) item = { ...item, consumable_kind: 'healing' };
  item = { ...item, attack_modifier: item.attack_modifier ?? item.attack ?? 0, damage_modifier: item.damage_modifier ?? item.damage ?? 0 };
  delete item.economyItemId; delete item.quantity;
  const names = namesOf(text), props = propertiesOf(text);
  if (names.length >= 25) throw Error('The party inventory is full.');
  names.push(item.name);
  if (!props.some(p => R.key(p.name) === R.key(item.name))) props.push({ ...item });
  return inventoryText(text, names, props);
}
function removeItem(text, name) {
  const names = namesOf(text), props = propertiesOf(text), index = names.findIndex(n => R.key(n) === R.key(name));
  if (index < 0) throw Error('That item is not in the party inventory. Unequip it first if it is being used.');
  names.splice(index, 1); return inventoryText(text, names, props);
}
function syncGround(text, room) {
  return write(write(text, 'Objects in Room', (room.objects || []).map(o => o.name).join(', ') || 'None'),
    'Objects in Room Properties', (room.objects || []).map(o => JSON.stringify(flatItem({ ...o.properties, ...o, properties: undefined }))).join(', ') || 'None');
}
function registerGround(room, text, geoKey, excluded = new Set()) {
  if (!room || I.roomKey(field(text, 'Coordinates')) !== geoKey || !/^Objects in Room:/m.test(text)) return false;
  const names = field(text, 'Objects in Room').split(/,\s*/).filter(n => n && !/^(none|empty|nothing)\.?$/i.test(n));
  const props = Inventory.parseProperties(field(text, 'Objects in Room Properties'));
  room.objects ||= [];
  let changed = room.groundInventoryVersion !== 1;
  for (const name of names) {
    if (excluded.has(R.key(name)) || room.objects.some(o => R.key(o.name) === R.key(name))) continue;
    const item = props.find(o => R.key(o.name) === R.key(name));
    if (!item || item.currency_kind || !['weapon', 'armor', 'shield', 'other', 'key', 'artifact'].includes(item.type)) continue;
    room.objects.push({ ...item, name, quantity: names.filter(n => R.key(n) === R.key(name)).length });
    changed = true;
  }
  room.groundInventoryVersion = 1;
  return changed;
}
const scrollsForLevel = level => SpellRules.scrollIds.filter(id => !SpellRules.templates[id].castMinLevel || level >= SpellRules.templates[id].castMinLevel);
function stock(kind, level = 1) {
  const potions = [3, 6, 10].map(magic => ({ ...R.healingPotion(magic), quantity: 2 }));
  if (kind === 'temple') return potions;
  return [...potions, ...scrollsForLevel(level).map(id => ({ ...SpellRules.scroll(id, 'of the ashroad'), quantity: 1 })),
    ...Gear.stock(),
    { name: 'ashroad spear', type: 'weapon', attack_modifier: 1, damage_modifier: 1, ac: 0, magic: 0, quantity: 1 },
    { name: 'caravan short sword', type: 'weapon', attack_modifier: 1, damage_modifier: 2, ac: 0, magic: 0, quantity: 1 },
    { name: 'pilgrims cuirass', type: 'armor', attack_modifier: 0, damage_modifier: 0, ac: 2, magic: 0, quantity: 1 },
    { name: 'wellkeepers shield', type: 'shield', attack_modifier: 0, damage_modifier: 0, ac: 1, magic: 0, quantity: 1 }];
}
function seedRoom(db, geoKey, population, seed = '', consoleText = '') {
  const room = db[geoKey]; if (!room || room.economySeeded) return;
  room.economySeeded = true;
  const partyLevel = Math.max(1, ...[...I.parseSheets(consoleText, 'PC'), ...I.parseSheets(consoleText, 'NPCs in Party')].map(a => SpellRules.casterLevel(a.className, a.level)));
  const roomScrolls = scrollsForLevel(partyLevel);
  const actors = Object.values(population.actors || {});
  for (const actor of actors) {
    actor.wallet = { ...R.wallet(actor, `${seed}:${geoKey}`), source: 'engine-birth-purse-v1', id: `birth:${seed}:${geoKey}:${actor.name}`, looted: false };
    if (actor.wallet.origin === 'uncrossed-fare') actor.fareHistory = 'Died ready for a crossing, but never reached the boat; the fare remains in hand.';
    const potionSeed = R.hash(`${seed}:${geoKey}:potion:${actor.name}`);
    if (potionSeed % 13 === 0) { actor.inventory ||= []; actor.inventory.push(R.healingPotion(3 + potionSeed % 8)); }
    if (potionSeed % 11 === 0) {
      const own = SpellRules.catalog(actor.className).filter(id => scrollsForLevel(SpellRules.casterLevel(actor.className, actor.level)).includes(id)), ids = own.length ? own : roomScrolls;
      actor.inventory ||= []; actor.inventory.push(SpellRules.scroll(ids[potionSeed % ids.length], R.hash(actor.name).toString(36)));
    }
  }
  const n = R.hash(`${seed}:${geoKey}:services`), setting = room.campaignSetting;
  const kind = Campaign.hostileTemple(setting, room.name) ? null : /temple|basilica|sanctuary|shrine|chapel/i.test(room.name) ? 'temple' :
    ['market', 'inn', 'guildhall'].includes(setting?.siteKind) || n % 7 === 0 ? 'shop' : n % 17 === 0 ? 'temple' : null;
  const operator = actors.find((a, index) => index > 0 && a.allegiance === 'Neutral');
  if (geoKey !== '0,0,0' && kind && operator) {
    const id = `service:${geoKey}:${kind}`;
    operator.serviceId = id; operator.routine = 'work';
    operator.job = kind === 'temple' ? 'neutral temple healer' : 'neutral equipment merchant';
    operator.dialogue.unshift(kind === 'temple' ? 'Healing, resurrection and healing potions are available here for silver.' : 'We buy and sell useful equipment for silver. Ask to trade.');
    room.services ||= {}; room.services[id] = { id, kind, operator: operator.name, originalOperator: operator.name,
      name: kind === 'temple' ? `${setting?.community || room.name} Healing Shrine` : `${setting?.community || room.name} Outfitters`,
      stock: stock(kind, partyLevel), till: kind === 'shop' ? 12 : 0, revision: 0 };
  }
  if (R.hash(`${seed}:${geoKey}:ground-potion`) % 5 === 0) {
    room.objects ||= [];
    const item = { ...R.healingPotion(3 + n % 8), economyItemId: `potion:${geoKey}`, quantity: 1 };
    const existing = room.objects.find(o => o.name === item.name && o.magic === item.magic);
    if (existing) { existing.quantity = Math.max(1, existing.quantity || 1) + 1; existing.economyItemId ||= item.economyItemId; }
    else room.objects.push(item);
  }
  Campaign.seedResidents(population, setting);
  const scrollSeed = R.hash(`${seed}:${geoKey}:spell-scroll`);
  if (geoKey === '0,0,0' || scrollSeed % 4 === 0) {
    const id = roomScrolls[scrollSeed % roomScrolls.length];
    const scroll = SpellRules.scroll(id, scrollSeed.toString(36));
    room.objects ||= []; room.objects.push(scroll);
  }
  room.inhabitants = population;
  const scrolls = [...(room.objects || []), ...actors.flatMap(a => a.inventory || []), ...Object.values(room.services || {}).flatMap(s => s.stock || [])].filter(o => SpellRules.templates[o.spell_scroll]);
  for (const scroll of scrolls) {
    room.readables ||= [];
    if (!room.readables.some(r => r.name === scroll.name)) room.readables.push({ id: 'spell-scroll:' + R.hash(scroll.name), name: scroll.name,
      kind: 'scroll', title: scroll.name, chapters: [{ title: 'Spell Formula', text: SpellRules.templates[scroll.spell_scroll].description +
        `\nMagic: ${scroll.magic}. That is the exact casting cost. ` + SpellRules.scroll(scroll.spell_scroll)?.description }] });
  }
  seedMission(db, geoKey, population, seed);
  Divinity.seedRoom(db, geoKey, population, seed, consoleText);
}
function seedMission(db, geoKey, population, seed) {
  const room = db[geoKey], setting = room.campaignSetting;
  if (!setting?.inhabited || geoKey === '0,0,0' || R.hash(seed + geoKey + ':mission') % 3 !== 0) return;
  const giver = Object.values(population.actors).find(a => a.allegiance === 'Neutral' && !a.serviceId);
  const source = Object.entries(db).find(([key, r]) => key !== geoKey && r?.campaignSetting?.communityId === setting.communityId &&
    r.populationComplete && !r.bossGate);
  if (!giver || !source) return;
  const id = `mission:${geoKey}`, name = `sealed ${itemLabel(setting.faction.name)} packet ${R.hash(id).toString(36)}`;
  const item = { name, type: 'other', attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 0,
    minor_mission_id: id, description: `A sealed supply record. Deliver it to ${giver.name} in ${room.name}.` };
  source[1].objects ||= []; source[1].objects.push(item);
  const rewardItem = R.hash(seed + id + ':payment') % 2 ? R.healingPotion(3 + R.hash(seed + id) % 8) : null;
  room.minorMissions ||= {}; room.minorMissions[id] = { id, source: 'engine-local-contract-v1', status: 'offered',
    recipient: giver.name, originalRecipient: giver.name, item: name, sourceRoomKey: source[0], sourceRoomName: source[1].name,
    roomKey: geoKey, roomName: room.name, faction: setting.faction.name, rewardSilver: rewardItem ? 0 : 2, escrowSilver: rewardItem ? 0 : 2,
    rewardItem, escrowItems: rewardItem ? [rewardItem] : [] };
  const mission = room.minorMissions[id];
  mission.description = `Recover ${name} from ${source[1].name} and give it to ${giver.name} in ${room.name}. Payment: ${paymentLabel(mission)}.`;
  giver.minorMissionId = id;
  giver.dialogue.unshift(`Our guild has a paid delivery contract. Ask me about local work.`);
}
function ensureSuccessors(state, db, roomKey, text) {
  const room = db[roomKey], population = state.getRoomPopulation?.(roomKey) || room?.inhabitants;
  if (!population || !room) return text;
  const contracts = [...Object.values(room.services || {}).map(service => ({ contract: service, field: 'operator', idField: 'serviceId' })),
    ...Object.values(room.minorMissions || {}).filter(m => m.status !== 'completed').map(m => ({ contract: m, field: 'recipient', idField: 'minorMissionId' }))];
  for (const { contract, field: actorField, idField } of contracts) {
    const oldName = contract[actorField], old = population.actors[oldName];
    if (!old || old.status === 'present' && I.isAlive(old)) continue;
    // The counter/contract owns its stock and escrow. A successor does not create a new purse or reward.
    let index = (contract.successorCount || 0) + 1, name = `${contract.originalOperator || contract.originalRecipient} assistant ${index}`;
    const taken = new Set(Object.values(db).flatMap(r => Object.keys(r?.inhabitants?.actors || {})));
    while (taken.has(name)) name = `${contract.originalOperator || contract.originalRecipient} assistant ${++index}`;
    const extra = I.createPopulation(roomKey, [{ name, race: old.race || 'Human', className: old.className || 'Cleric',
      allegiance: 'Neutral', encounterId: `assistant:${contract.id}`, routine: 'work',
      job: old.job, dialogue: [`I have taken over ${oldName}'s work. The existing terms still apply.`] }], { indoor: population.indoor });
    const actor = extra.actors[name]; Object.assign(actor, { hp: 12, maxHp: 12, [idField]: contract.id,
      patron: old.patron, factionId: old.factionId, communityId: old.communityId,
      wallet: { silver: 0, origin: 'no-recorded-coins', source: 'engine-birth-purse-v1', looted: false } });
    Object.assign(population.actors, extra.actors); population.groups.push(...extra.groups); delete population.placementStamp;
    const sheet = formatStartingCharacterSheet({ Name: name, Race: actor.race, Class: actor.className, Sex: 'Unknown',
      Level: 2, AC: 10, HP: 12, MaxHP: 12, State: 'Neutral' }, 6, 'npc').replace('State: Friendly', 'State: Neutral');
    population.initialSheets = [population.initialSheets, sheet].filter(Boolean).join('\n');
    room.monsters ||= {}; room.monsters.inRoom = [room.monsters.inRoom && !/^none$/i.test(room.monsters.inRoom) ? room.monsters.inRoom : '', sheet].filter(Boolean).join('\n');
    room.monsters.consoleBlock = room.monsters.inRoom;
    contract.successorCount = index; contract[actorField] = name;
    contract.assistants ||= []; contract.assistants.push(name);
    if (idField === 'minorMissionId') contract.description = contract.type === 'raid' ?
      `${contract.patron} commissions a raid on ${contract.sourceRoomName}. Defeat ${contract.targets.join(', ')} (each HP <= 0). Payment: ${paymentLabel(contract)}, held by ${name} in ${room.name}.` :
      `Recover ${contract.item} from ${contract.sourceRoomName} and give it to ${name} in ${room.name}. Payment: ${paymentLabel(contract)}.`;
    if (roomKey === I.roomKey(field(text, 'Coordinates'))) text = text.replace(I.sectionPattern('Monsters in Room'), (_, header, body) =>
      header + (body.trim() === 'None' ? '\n' : body) + '\n' + sheet + '\n');
  }
  room.inhabitants = population; state.setRoomPopulation?.(roomKey, population); return text;
}
function corpseDrops(state, actorName) {
  const db = databaseOf(state), geoKey = roomKey(state), room = db[geoKey]; if (!room) return false;
  const population = state.getRoomPopulation?.(geoKey) || room.inhabitants;
  const record = population?.actors?.[actorName];
  let text = state.getUpdatedGameConsole();
  const sheet = I.parseSheets(text).find(a => a.name === actorName);
  if (!record || record.corpseInventoryDropped || !(I.state(sheet || record) === 'Dead' || record.status === 'dead')) return false;
  record.corpseInventoryDropped = true;
  room.objects ||= [];
  const firstDrop = room.objects.length;
  const purse = record.wallet;
  if (purse && !purse.looted && Number.isSafeInteger(purse.silver) && purse.silver > 0) {
    const baseName = `silver ${purse.origin === 'uncrossed-fare' ? 'fare' : 'purse'} of ${itemLabel(actorName)}`;
    room.objects.push({ name: room.objects.some(o => o.name === baseName) ? baseName + ' ' + R.hash(purse.id || actorName).toString(36) : baseName,
      type: 'other', currency_kind: 'silver', silver: purse.silver, economyItemId: `purse:${purse.id || geoKey + ':' + actorName}`,
      description: `Recorded ${purse.origin.replace(/-/g, ' ')}; ${purse.silver} silver pieces.`,
      attack_modifier: 0, damage_modifier: 0, ac: 0, magic: 0 });
    purse.silver = 0; purse.looted = true;
  }
  for (const item of record.inventory || []) room.objects.push({ ...item, economyItemId: item.economyItemId || `carried:${geoKey}:${actorName}:${room.objects.length}` });
  if (sheet) {
    const equipped = I.parseEquipment(sheet.lines[9]), props = Inventory.parseProperties(field(text, 'Monsters Equipped Properties'));
    const removed = new Set();
    for (const slot of I.EQUIPMENT_SLOTS) {
      const name = I.equipmentName(equipped[slot]); if (!name) continue;
      const item = props.find(p => R.key(p.name) === R.key(name) && (!p.owner || R.key(p.owner) === R.key(actorName)));
      if (!item) continue;
      const loose = { ...item }; delete loose.owner; delete loose.slot;
      room.objects.push({ ...loose, economyItemId: `equipped:${geoKey}:${actorName}:${slot}` });
      equipped[slot] = 'None'; removed.add(item);
    }
    const usedElsewhere = new Set(I.parseSheets(text).filter(a => a.name !== actorName).flatMap(a => Object.values(I.parseEquipment(a.lines[9]))).map(R.key));
    text = write(text, 'Monsters Equipped Properties', props.filter(p => !removed.has(p) || !p.owner && usedElsewhere.has(R.key(p.name))).map(p => JSON.stringify(flatItem(p))).join(', ') || 'None');
    const nextSheet = sheet.rawSheet.replace(/^([ \t]*Equipped:)[^\r\n]*/m, (_, h) => h + ' ' + Object.entries(equipped).map(([s, n]) => s + ': ' + n).join(', '));
    text = text.replace(sheet.rawSheet, () => nextSheet); record.sheet = nextSheet;
    if (room.monsters?.inRoom) room.monsters.inRoom = room.monsters.inRoom.replace(sheet.rawSheet, () => nextSheet);
  }
  const dungeon = state.getRoomDungeonForSimulation?.(state.getLastCoords());
  const dead = JSON.parse(state.getCombatCharactersString() || '[]').find(a => a.name === actorName && a.type === 'monster');
  const point = Reach.position(dead, geoKey) || record.position;
  if (dungeon && point && I.walkable(dungeon, Math.floor(point.x), Math.floor(point.y))) {
    dungeon.sceneObjects ||= [];
    for (const item of room.objects.slice(firstDrop))
      if (!dungeon.sceneObjects.some(o => R.key(o.name) === R.key(item.name))) dungeon.sceneObjects.push({
        id: item.economyItemId, name: item.name, type: item.type, magic: item.magic || 0, x: Math.floor(point.x), y: Math.floor(point.y) });
  }
  record.inventory = []; room.inhabitants = population;
  state.setRoomPopulation?.(geoKey, population);
  commit(state, db, syncGround(text, room));
  return true;
}
function protectedItem(state, db, item) {
  return item.type === 'key' || item.type === 'artifact' || item.minor_mission_id || item.unlocks || isReservedBossKeyName(db, item.name) ||
    (state.getCurrentTasks?.() || []).some(t => t.status !== 'Completed' && t.requiredElements?.some(e => R.key(e.name) === R.key(item.name)));
}
function context(state) {
  const text = state.getUpdatedGameConsole(), db = databaseOf(state), geoKey = roomKey(state);
  const coords = state.getLastCoords();
  if (geoKey !== `${coords.x},${coords.y},${coords.z}` || !db[geoKey]) throw Error('The current room is not ready.');
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'), room = db[geoKey];
  const pc = roster.find(a => a.type === 'pc' && a.hp > 0) ||
    roster.find(a => a.type === 'npc' && a.hp > 0 && Reach.position(a, geoKey));
  const dungeon = state.getRoomDungeonForSimulation?.(coords);
  const player = Reach.position(pc, geoKey);
  if (dungeon && player) Objects.sync(dungeon, syncGround(text, room), { player });
  return { text, db, geoKey, roster, room, pc, dungeon, player, book: ledger(state, db) };
}
function operatorReach(ctx, name) {
  const actor = ctx.roster.find(a => a.name === name && a.type === 'monster');
  const record = ctx.room.inhabitants?.actors?.[name];
  if (!actor || !record || actor.hp <= 0 || record.status !== 'present' || actor.discoveryState === 'pending' ||
      I.allegiance(actor) === 'Hostile' || record.allegiance === 'Hostile') throw Error('That resident is not available for peaceful business.');
  const reach = I.dialogueReach(ctx.dungeon, actor, ctx.player);
  if (!ctx.pc || !reach.canSpeak || !reach.lineOfSight || reach.distance > 3) throw Error(`Move closer to ${name}.`);
  return record;
}
function health(text, name, hp) {
  for (const label of ['PC', 'NPCs in Party']) text = text.replace(I.sectionPattern(label), (match, header, body) => {
    const a = I.parseBlocks(body, label === 'PC' ? 'pc' : 'npc').find(a => a.name === name);
    if (!a) return match;
    const next = a.rawSheet.replace(/^(\s*HP:)[^\r\n]*/m, (_, prefix) => prefix + ' ' + hp)
      .replace(/^(\s*State:)[^\r\n]*/m, (_, prefix) => prefix + ' ' + (label === 'PC' ? 'Alive' : 'Friendly'));
    return header + body.replace(a.rawSheet, () => next);
  });
  return text;
}
function changeEquipment(text, input) {
  const party = [...I.parseSheets(text, 'PC'), ...I.parseSheets(text, 'NPCs in Party')];
  const name = input.target && R.key(input.target);
  const exact = name && party.find(a => R.key(a.name) === name);
  const matches = name ? party.filter(a => R.key(a.name).startsWith(name + ' ')) : [];
  if (!exact && matches.length > 1) throw Error('Which party member do you mean? ' + matches.map(a => a.name).join(', '));
  const actor = name ? exact || matches[0] : party.find(a => a.type === 'pc');
  if (!actor || !I.canAct(actor)) throw Error('Choose a conscious party member to change equipment.');
  const slots = I.parseEquipment(actor.lines[9]);
  const props = Inventory.parseProperties(field(text, 'Party Equipped Properties'));
  let item, slot, direction;
  if (input.kind === 'equip') {
    if (!namesOf(text).some(n => R.key(n) === R.key(input.item))) throw Error('That item is not in the party inventory.');
    item = propertiesOf(text).find(p => R.key(p.name) === R.key(input.item));
    if (!item) throw Error('That item has no verified equipment properties. Nothing was moved.');
    if (R.isHealingPotion(item)) throw Error('Use Drink for healing potions; they cannot be equipped.');
    slot = { weapon: 'Weapon', armor: 'Armor', shield: 'Shield' }[R.key(item.type)] || 'Other';
    if (slots[slot] && slots[slot] !== 'None') throw Error(`Unequip ${slots[slot]} from ${actor.name} before equipping ${item.name}.`);
    direction = 1;
    text = removeItem(text, item.name);
    props.push({ ...flatItem(item), owner: actor.name, slot });
    slots[slot] = item.name;
  } else {
    slot = Object.keys(slots).find(s => R.key(slots[s]) === R.key(input.item));
    if (!slot) throw Error(`${actor.name} does not have ${input.item} equipped.`);
    item = props.find(p => R.key(p.owner) === R.key(actor.name) && p.slot === slot && R.key(p.name) === R.key(slots[slot]));
    if (!item) throw Error('That equipped item has no verified properties. Nothing was moved.');
    direction = -1;
    const loose = { ...item }; delete loose.owner; delete loose.slot;
    text = addItem(text, loose);
    props.splice(props.indexOf(item), 1); slots[slot] = 'None';
  }
  const modifiers = { Attack: item.attack_modifier, Damage: item.damage_modifier, Armor: item.ac, AC: item.ac, Magic: item.magic };
  if (Object.values(modifiers).some(value => value !== undefined && !Number.isFinite(Number(value))))
    throw Error('That item has invalid modifiers. Nothing was moved.');
  let sheet = actor.rawSheet.replace(/^([ \t]*Equipped:)[^\r\n]*/m,
    (_, h) => h + ' ' + Object.entries(slots).map(([s, n]) => s + ': ' + n).join(', '));
  for (const [stat, modifier] of Object.entries(modifiers)) if (Number(modifier)) sheet = sheet.replace(
    new RegExp('^([ \\t]*' + stat + ':)[^\\r\\n]*', 'm'),
    (_, h) => h + ' ' + (Number(actor.lines.find(line => line.startsWith(stat + ':'))?.split(':')[1]) + direction * Number(modifier)));
  text = text.replace(actor.rawSheet, () => sheet);
  text = write(text, 'Party Equipped Properties', props.map(p => JSON.stringify(flatItem(p))).join(', ') || 'None');
  return { text, actor: actor.name, item: item.name, slot };
}
function view(state, actorName) {
  try {
    const ctx = context(state), resident = operatorReach(ctx, actorName);
    const service = Object.values(ctx.room.services || {}).find(s => s.operator === actorName);
    const missions = Object.values(ctx.db).flatMap(r => Object.values(r?.minorMissions || {}))
      .filter(m => m.patron === actorName || m.recipient === actorName && m.roomKey === ctx.geoKey);
    const deity = resident.deityId && Pantheon.canon(actorName);
    if (!service && !missions.length && !deity) throw Error('This resident has no shop, temple or local contract.');
    const storedProperties = propertiesOf(ctx.text);
    return { silver: ctx.book.silver, revision: ctx.book.revision, service: service ? { ...service,
      stock: service.stock.filter(i => i.quantity > 0).map(i => ({ ...i, price: R.price(i) })) } : null,
      divine: deity ? { name: deity.name, domain: deity.domain, interest: resident.motivation,
        visits: ctx.db['0,0,0']?.divineCourt?.actors?.[deity.name]?.visits || 1,
        completedCommissions: ctx.db['0,0,0']?.divineCourt?.actors?.[deity.name]?.completedCommissions || [],
        possessions: (resident.inventory || []).map(o => ({ name: o.name, type: o.type, magic: o.magic || 0 })) } : null,
      missions, sceneObjects: ctx.dungeon?.sceneObjects, saleItems: Inventory.inventoryItems(namesOf(ctx.text), storedProperties)
        .filter(i => !protectedItem(state, ctx.db, storedProperties.find(p => R.key(p.name) === R.key(i.name)) || i))
        .map(i => ({ ...i, salePrice: Math.max(1, Math.floor(R.price(i) / 2)) })),
      party: [...I.parseSheets(ctx.text, 'PC'), ...I.parseSheets(ctx.text, 'NPCs in Party')].map(a => ({ name: a.name, hp: a.hp, state: I.state(a),
        maxHp: a.maxHp, healPrice: Math.ceil(Math.max(0, a.maxHp - a.hp) / R.PRICES.healingHP), resurrectPrice: R.resurrectionPrice(a.level) })) };
  } catch (error) { return { error: error.message }; }
}
function action(state, service, input) {
  try {
    if (input.runId !== state.getDungeonRunId() || input.geoKey !== roomKey(state)) throw Error('That action belongs to another room or game.');
    if (state.getGamePaused?.()) throw Error('Resume the game first.');
    if (!/^[\w:-]{8,100}$/.test(input.nonce || '')) throw Error('A transaction identifier is required.');
    const ctx = context(state), { db, room, book, geoKey, roster } = ctx;
    const old = book.receipts.find(r => r.nonce === input.nonce);
    if (old) {
      if (old.roomKey !== geoKey || old.kind !== input.kind || old.actor !== input.actor || old.item !== input.item || old.target !== input.target)
        throw Error('That transaction identifier was already used for a different action.');
      return { content: old.content, duplicate: true };
    }
    if (input.revision !== book.revision) throw Error('The balance changed. Reopen the menu and try again.');
    let text = ctx.text, content, amount = 0, business, equipmentOwner;
    if (['buy', 'sell', 'heal', 'resurrect'].includes(input.kind)) {
      operatorReach(ctx, input.actor);
      business = Object.values(room.services || {}).find(s => s.operator === input.actor);
      if (!business) throw Error('No business is registered for that resident.');
    }
    if (['equip', 'unequip'].includes(input.kind)) {
      const changed = changeEquipment(text, input);
      text = changed.text; equipmentOwner = changed.actor;
      content = `${changed.item} has been ${input.kind === 'equip' ? 'equipped to' : 'unequipped from'} ${changed.slot} of ${changed.actor}.`;
    } else if (input.kind === 'buy') {
      const item = business.stock.find(i => R.key(i.name) === R.key(input.item) && i.quantity > 0);
      if (!item) throw Error('That item is out of stock.');
      amount = -R.price(item); if (book.silver + amount < 0) throw Error('Not enough silver pieces.');
      const copy = { ...item }; delete copy.quantity;
      text = addItem(text, copy); item.quantity--; business.till -= amount;
      content = `You buy ${item.name} from ${input.actor} for ${-amount} silver pieces.`;
    } else if (input.kind === 'sell') {
      if (business.kind !== 'shop') throw Error('Temples do not buy equipment.');
      const item = propertiesOf(text).find(i => R.key(i.name) === R.key(input.item));
      if (!item || protectedItem(state, db, item)) throw Error('Quest items, keys and artifacts cannot be sold.');
      amount = Math.max(1, Math.floor(R.price(item) / 2));
      if (business.till < amount) throw Error('The merchant has insufficient silver to buy that item.');
      if (business.stock.length >= 100 && !business.stock.some(i => R.key(i.name) === R.key(item.name))) throw Error('The shop cannot store more stock.');
      text = removeItem(text, item.name); business.till -= amount;
      const existing = business.stock.find(i => R.key(i.name) === R.key(item.name));
      if (existing) existing.quantity++; else business.stock.push({ ...item, quantity: 1 });
      content = `You sell ${item.name} to ${input.actor} for ${amount} silver pieces.`;
    } else if (['drink', 'heal', 'resurrect'].includes(input.kind)) {
      const target = [...I.parseSheets(text, 'PC'), ...I.parseSheets(text, 'NPCs in Party')].find(a => a.name === input.target);
      if (!target || target.maxHp <= 0) throw Error('Choose an actual party member.');
      const revive = input.kind === 'resurrect';
      if (revive ? I.isAlive(target) : !I.isAlive(target)) throw Error(revive ? 'That character is still alive.' : 'The dead need resurrection, not healing.');
      if (!revive && target.hp >= target.maxHp) throw Error('That character is already at full health.');
      let nextHP;
      if (input.kind === 'drink') {
        const potion = propertiesOf(text).find(i => R.key(i.name) === R.key(input.item) && R.isHealingPotion(i));
        if (!potion || !Number.isSafeInteger(potion.magic) || potion.magic < 3 || potion.magic > 10) throw Error('That item is not a drinkable healing potion.');
        text = removeItem(text, potion.name); nextHP = Math.min(target.maxHp, target.hp + potion.magic);
      } else {
        if (business.kind !== 'temple') throw Error('Only temples perform healing or resurrection.');
        amount = -(revive ? R.resurrectionPrice(target.level) : Math.ceil((target.maxHp - target.hp) / R.PRICES.healingHP));
        if (book.silver + amount < 0) throw Error('Not enough silver pieces.');
        business.till -= amount; nextHP = revive ? 1 : target.maxHp;
      }
      text = health(text, target.name, nextHP);
      const Life = require('./combatLife');
      if (db['0,0,0']?.combatLife) Life.apply(db, state.getDungeonRunId(), target, nextHP, null, { geoKey, resurrect: revive });
      let actor = roster.find(a => a.name === target.name && a.type === target.type);
      if (!actor) {
        const p = ctx.player || ctx.dungeon?.start;
        if (!p) throw Error('The party position is not ready.');
        actor = { name: target.name, type: target.type, race: target.race, class: target.className,
          mazeX: Math.floor(p.x), mazeY: Math.floor(p.y), mazeRoomKey: geoKey, hp: nextHP, maxHP: target.maxHp };
        roster.push(actor);
      }
      actor.hp = nextHP; actor.state = target.type === 'pc' ? 'Alive' : 'Friendly';
      state.setCombatCharactersString(JSON.stringify(roster));
      content = input.kind === 'drink' ? `${target.name} drinks ${input.item}, restoring ${nextHP - target.hp} HP.` :
        revive ? `${input.actor} resurrects ${target.name} at 1 HP for ${-amount} silver pieces.` :
          `${input.actor} restores ${target.name} to ${nextHP} HP for ${-amount} silver pieces.`;
    } else if (input.kind === 'receive') {
      const god = operatorReach(ctx, input.actor);
      if (!god.deityId || !Pantheon.canon(god.name)) throw Error('Only the divine audience supports this item exchange.');
      const item = god.inventory?.find(o => R.key(o.name) === R.key(input.item));
      if (!item) throw Error('That item is not in this deity\'s inventory.');
      text = addItem(text, item); god.inventory.splice(god.inventory.indexOf(item), 1);
      content = `${god.name} gives you ${item.name}.`;
    } else if (input.kind === 'take') {
      const item = room.objects?.find(i => R.key(i.name) === R.key(input.item));
      const original = ctx.dungeon?.sceneObjects?.find(i => R.key(i.name) === R.key(input.item));
      const population = state.getRoomPopulation?.(geoKey) || room.inhabitants;
      // Travel encounters project loot away from its initial seed; validate the same placement the browser renders.
      const physical = Discovery.objects(original ? [original] : [], population)[0];
      if (!item || !physical || !ctx.pc || !ctx.player) throw Error('That object is not present here.');
      if (!World.itemInView(ctx.dungeon, ctx.player, physical, input.objectView)) throw Error('That object is not currently in view. Turn toward it before taking it.');
      const p = { x: physical.x + .5, y: physical.y + .5 };
      if (Math.hypot(ctx.player.x - p.x, ctx.player.y - p.y) > 2.5 || !Reach.lineClear(ctx.dungeon, ctx.player, p)) throw Error('Move closer to the object with a clear path.');
      if (item.currency_kind === 'silver') {
        if (!Number.isSafeInteger(item.silver) || item.silver < 1 || item.silver > 1000) throw Error('The recorded purse is invalid.');
        amount = item.silver; content = `You collect ${amount} silver pieces from ${item.name}.`;
      } else { text = addItem(text, { ...item.properties, ...item, properties: undefined }); content = `You take ${item.name}.`; }
      const quantity = Math.max(1, Number(item.quantity) || 1);
      if (quantity > 1 && !item.currency_kind) item.quantity = quantity - 1;
      else { room.objects.splice(room.objects.indexOf(item), 1); ctx.dungeon.sceneObjects.splice(ctx.dungeon.sceneObjects.indexOf(original), 1); }
      text = syncGround(text, room);
    } else if (['drop', 'drop-all'].includes(input.kind)) {
      const names = input.kind === 'drop-all' ? namesOf(text) : [input.item];
      const items = names.map(name => propertiesOf(text).find(i => R.key(i.name) === R.key(name)));
      if (!items.length || items.some(item => !item) || !ctx.pc || !ctx.player) throw Error('That carried item cannot be dropped here.');
      room.objects ||= [];
      for (const item of items) {
        text = removeItem(text, item.name);
        const existing = room.objects.find(i => R.key(i.name) === R.key(item.name));
        if (existing) existing.quantity = Math.max(1, existing.quantity || 1) + 1;
        else room.objects.push({ ...item, economyItemId: 'drop:' + randomUUID() });
      }
      text = syncGround(text, room); content = input.kind === 'drop-all' ? 'You drop all unequipped inventory items.' : `You drop ${items[0].name}.`;
    } else if (input.kind === 'accept-mission') {
      operatorReach(ctx, input.actor);
      const mission = room.minorMissions?.[input.missionId] || Object.values(db).flatMap(r => Object.values(r?.minorMissions || {}))
        .find(m => m.id === input.missionId && m.patron === input.actor);
      if (!mission || ![mission.recipient, mission.patron].includes(input.actor) || mission.status !== 'offered') throw Error('That local contract is unavailable.');
      mission.status = 'accepted'; content = `Local contract accepted: ${mission.description}`;
    } else throw Error('Unsupported economy action.');
    book.silver += amount; book.revision++;
    const receipt = { id: randomUUID(), nonce: input.nonce, kind: input.kind, amount, roomKey: geoKey, actor: input.actor,
      item: input.item, target: input.target, equipmentOwner, ...(input.kind === 'drop-all' ? { items: namesOf(ctx.text) } : {}),
      at: Date.now(), content, source: 'engine-economy-v1' };
    book.receipts.push(receipt); if (book.receipts.length > 2048) book.receipts.shift();
    if (business) business.revision++;
    commit(state, db, text);
    if (['drink', 'heal', 'resurrect'].includes(input.kind) && db['0,0,0']?.combatLife) require('./combatLife').commit(state, db, text);
    if (ctx.dungeon && ctx.player) Objects.sync(ctx.dungeon, syncGround(text, room), { player: ctx.player });
    if (room.inhabitants) { state.setRoomPopulation?.(geoKey, room.inhabitants); service?.save(room.inhabitants); }
    refresh(state);
    if (input.kind === 'accept-mission') state.emitter?.emit('quest:minorMission');
    return { content, sceneObjects: ctx.dungeon?.sceneObjects };
  } catch (error) { return { error: error.message }; }
}
function refresh(state) {
  const db = databaseOf(state), book = ledger(state, db); let text = state.getUpdatedGameConsole(), changed = false;
  const notices = []; let missionCompleted = false;
  const geoKey = roomKey(state), active = db[geoKey], coords = state.getLastCoords();
  // Older room generation saved the console loot but overwrote the database with its puzzle-only snapshot.
  // Import that saved metadata once; receipts prevent spent or collected items from being recreated.
  if (active && geoKey === `${coords.x},${coords.y},${coords.z}` && active.groundInventoryVersion !== 1) {
    const excluded = new Set([...namesOf(text), ...book.receipts.filter(r => r.kind === 'take' && r.roomKey === geoKey).map(r => r.item)].map(R.key));
    changed = registerGround(active, text, geoKey, excluded);
  }
  const partyNames = new Set([...I.parseSheets(text, 'PC'), ...I.parseSheets(text, 'NPCs in Party')].map(a => R.key(a.name)));
  for (const [key, room] of Object.entries(db)) {
    text = ensureSuccessors(state, db, key, text);
    const population = state.getRoomPopulation?.(key) || room?.inhabitants;
    for (const a of Object.values(population?.actors || {})) if (partyNames.has(R.key(a.name)) && !['dead', 'departed'].includes(a.status) &&
        (!a.possessionsPooled || a.inventory?.length)) {
      const oldSilver = book.silver, oldInventoryCount = namesOf(text).length, wasPooled = a.possessionsPooled;
      book.pooledPurses ||= [];
      const purseId = a.wallet?.id || `${key}:${a.name}`;
      if (a.wallet?.source === 'engine-birth-purse-v1' && !a.wallet.looted) {
        if (!book.pooledPurses.includes(purseId)) { book.silver += a.wallet.silver; book.pooledPurses.push(purseId); }
        a.wallet.silver = 0; a.wallet.looted = true;
      }
      const items = a.inventory || [];
      while (items.length && namesOf(text).length < 25) text = addItem(text, items.shift());
      a.possessionsPooled = !items.length; room.inhabitants = population;
      changed ||= book.silver !== oldSilver || namesOf(text).length !== oldInventoryCount || a.possessionsPooled !== wasPooled;
      if (book.silver > oldSilver) notices.push(`${a.name}'s ${book.silver - oldSilver} silver pieces are added to the party balance.`);
      if (namesOf(text).length > oldInventoryCount) notices.push(`${a.name}'s unequipped belongings are added to the party inventory.`);
    }
    for (const mission of Object.values(room?.minorMissions || {})) {
      if (mission.status !== 'accepted' || !(mission.escrowSilver > 0 || mission.escrowItems?.length)) continue;
      const assessment = mission.type === 'raid' ? require('./questProgress').evaluateTaskRequirements(mission,
        { roomKey: roomKey(state), consoleText: text, database: db }) : null;
      const receipt = assessment ? null : room.itemTransfers?.find(r => r.source === 'engine-give-item-v1' && r.roomKey === mission.roomKey &&
        R.key(r.item) === R.key(mission.item) && [mission.recipient, mission.originalRecipient, ...(mission.assistants || [])].some(n => R.key(r.recipient) === R.key(n)));
      if (assessment ? !mission.targets?.length || !assessment.progress.eligible : !receipt) continue;
      if (namesOf(text).length + (mission.escrowItems?.length || 0) > 25) { mission.pendingReward = true; continue; }
      for (const item of mission.escrowItems || []) text = addItem(text, item);
      mission.escrowItems = []; delete mission.pendingReward;
      book.silver += mission.escrowSilver; mission.escrowSilver = 0; mission.status = 'completed';
      if (receipt) mission.deliveryReceiptId = receipt.id;
      if (assessment) {
        mission.completionEvidence = assessment.checks;
        if (db[mission.sourceRoomKey]) db[mission.sourceRoomKey].templeSuppression = { source: 'engine-temple-raid-v1',
          missionId: mission.id, patron: mission.enemyPatron, defenders: mission.targets, evidence: assessment.checks };
      }
      mission.rewardReceiptId = randomUUID(); changed = true;
      const patron = db['0,0,0']?.divineCourt?.actors?.[mission.patron];
      if (patron) { patron.completedCommissions ||= []; if (!patron.completedCommissions.includes(mission.id)) patron.completedCommissions.push(mission.id); }
      notices.push(`Local contract completed: payment of ${paymentLabel(mission)} received.`);
      missionCompleted = true;
    }
  }
  if (active?.groundInventoryVersion === 1) {
    const nextText = syncGround(text, active);
    changed ||= nextText !== text; text = nextText;
    if (geoKey === `${coords.x},${coords.y},${coords.z}`) {
      const dungeon = state.getRoomDungeonForSimulation?.(coords);
      const roster = JSON.parse(state.getCombatCharactersString() || '[]');
      const player = Reach.position(roster.find(a => a.type === 'pc' && a.hp > 0), geoKey) || dungeon?.start;
      if (dungeon && player) {
        const sync = Objects.sync(dungeon, text, { player });
        changed ||= sync.changed;
      }
    }
  }
  if (changed) book.revision++;
  const missions = Object.values(active?.minorMissions || {});
  if (missions.length) text = write(text, 'Local Missions', missions.map(m => `${m.status}: ${m.description}`).join(' | '));
  else text = write(text, 'Local Missions', 'None');
  const setting = active?.campaignSetting;
  text = write(text, 'Region', setting?.region || 'Tartarus');
  text = write(text, 'Patronage', setting?.religion?.patron ? `${setting.faction.name}: ${setting.faction.patron || setting.religion.patron}; local shrine: ${setting.religion.patron}` : 'None recorded');
  text = write(text, 'Community', setting?.inhabited ? `${setting.community}; ${setting.authority}; ${setting.faction.name}` : 'None nearby');
  commit(state, db, text);
  if (missionCompleted) state.emitter?.emit('quest:minorMission');
  return { changed, silver: book.silver, notices };
}
function preserve(oldJSON, incomingJSON, options = {}) {
  const old = JSON.parse(oldJSON || '{}'), next = JSON.parse(incomingJSON || '{}');
  const raidRooms = new Set(Object.values(old).flatMap(r => Object.values(r?.minorMissions || {}))
    .filter(m => m.type === 'raid').map(m => m.sourceRoomKey));
  const fields = ['economy', 'services', 'minorMissions', 'economySeeded', 'groundInventoryVersion', 'campaignSetting', 'campaignAtlas', 'itemTransfers', 'divineCourt', 'divineVisitChecked', 'templeSuppression', 'spellSystem', 'questFailures',
    'factionMemory', 'adventureJournal', 'regionalAdventure', 'regionalAdventureAttempt', 'regionalSite', 'questStories', 'questScenes', 'combatLife',
    'fortifiedSite', 'fortifiedFloor', 'fortifiedApproaches', 'fortifiedSiteScan'];
  for (const [key, room] of Object.entries(next)) {
    if (!room || typeof room !== 'object') continue;
    if (!options.trustedNewFields) {
      for (const name of fields) if (old[key]?.[name] === undefined) delete room[name];
      for (const actor of Object.values(room.inhabitants?.actors || {})) for (const name of ['wallet', 'inventory', 'receivedItems', 'corpseInventoryDropped', 'possessionsPooled', 'serviceId', 'minorMissionId', 'combatRole', 'combatArchetype', 'spellPreferences', 'regionalStoryId'])
        if (old[key]?.inhabitants?.actors?.[actor.name]?.[name] === undefined) delete actor[name];
      room.objects = (room.objects || []).filter(o => !o.currency_kind && !o.economyItemId && !o.minor_mission_id);
    }
  }
  for (const [key, room] of Object.entries(old)) {
    if (!room) continue;
    if (!next[key] && (key === '0,0,0' || room.fortifiedFloor || room.fortifiedApproaches || room.groundInventoryVersion === 1 || room.services || room.minorMissions || room.templeSuppression || room.regionalSite || room.questStories || raidRooms.has(key) || room.objects?.some(o => o.currency_kind || o.minor_mission_id) ||
        Object.values(room.inhabitants?.actors || {}).some(a => a.deityId))) next[key] = room;
    if (!next[key]) continue;
    for (const field of fields)
      if (room[field] !== undefined) next[key][field] = room[field];
    if (room.regionalSite) {
      for (const field of ['name', 'exits', 'environmentIntent', 'campaignSetting', 'indoor']) next[key][field] = room[field];
    }
    if (room.fortifiedFloor && !options.trustedNewFields) {
      for (const field of ['name', 'exits', 'environmentIntent', 'indoor', 'isIndoor', 'isOutdoor', 'classification', 'complexId']) next[key][field] = room[field];
    }
    if (room.fortifiedApproaches && !options.trustedNewFields) {
      next[key].exits ||= {};
      for (const a of room.fortifiedApproaches) next[key].exits[a.direction] = room.exits[a.direction];
    }
    if (room.inscriptions?.some(r => r.questStoryId)) next[key].inscriptions = [
      ...(next[key].inscriptions || []).filter(r => !r.questStoryId), ...room.inscriptions.filter(r => r.questStoryId)];
    const protectedObjects = (room.objects || []).filter(o => o.currency_kind || o.economyItemId || o.minor_mission_id);
    next[key].objects = [...(next[key].objects || []).filter(o => !o.currency_kind && !o.economyItemId && !o.minor_mission_id), ...protectedObjects];
    if (room.groundInventoryVersion === 1 && !options.trustedNewFields) next[key].objects = structuredClone(room.objects || []);
    for (const [name, actor] of Object.entries(room.inhabitants?.actors || {})) {
      if (actor.deityId || actor.regionalStoryId) {
        next[key].inhabitants ||= structuredClone(room.inhabitants);
        next[key].inhabitants.actors ||= {};
        next[key].inhabitants.actors[name] ||= structuredClone(actor);
        next[key].inhabitants.groups ||= [];
        for (const group of room.inhabitants.groups.filter(g => g.members.includes(name))) {
          const index = next[key].inhabitants.groups.findIndex(g => g.id === group.id);
          if (index < 0) next[key].inhabitants.groups.push(structuredClone(group));
          else next[key].inhabitants.groups[index] = structuredClone(group);
        }
      }
      const a = next[key].inhabitants?.actors?.[name]; if (!a) continue;
      for (const field of ['wallet', 'inventory', 'receivedItems', 'corpseInventoryDropped', 'possessionsPooled', 'serviceId', 'minorMissionId', 'recruitable', 'patron', 'factionId', 'combatRole', 'combatArchetype', 'spellPreferences'])
        if (actor[field] !== undefined) a[field] = actor[field];
      if (actor.combatArchetype) a.className = actor.className;
      if (actor.deityId) for (const field of ['deityId', 'recruitable', 'hp', 'maxHp', 'sheet', 'status', 'allegiance', 'divineMissionId', 'profile', 'memory', 'history', 'personality', 'motivation', 'dialogue']) a[field] = actor[field];
      if (actor.regionalStoryId) for (const field of ['regionalStoryId', 'hp', 'maxHp', 'sheet', 'status', 'allegiance', 'profile', 'history', 'personality']) a[field] = actor[field];
    }
  }
  return JSON.stringify(next);
}
function preserveInventory(oldText, incomingText, databaseJSON = '{}') {
  Divinity.validateParty(incomingText);
  if (roomKeyFromText(oldText) === roomKeyFromText(incomingText)) {
    const oldGods = new Map(I.parseSheets(oldText).filter(a => !Pantheon.canRecruit(a)).map(a => [a.name, a]));
    for (const actor of I.parseSheets(incomingText)) if (oldGods.has(actor.name))
      incomingText = incomingText.replace(actor.rawSheet, () => oldGods.get(actor.name).rawSheet);
  }
  const transfers = JSON.parse(databaseJSON || '{}')['0,0,0']?.economy?.receipts || [];
  const gear = transfers.filter(r => ['equip', 'unequip'].includes(r.kind));
  // Gear transactions are server-owned. Late browser snapshots cannot undo a slot change or duplicate its item.
  const equippedProps = Inventory.parseProperties(field(oldText, 'Party Equipped Properties'));
  const currentParty = [...I.parseSheets(oldText, 'PC'), ...I.parseSheets(oldText, 'NPCs in Party')];
  const protectedActors = new Set(gear.map(r => R.key(r.equipmentOwner || r.target || currentParty.find(a => a.type === 'pc')?.name)));
  for (const actor of [...I.parseSheets(incomingText, 'PC'), ...I.parseSheets(incomingText, 'NPCs in Party')]) {
    if (!protectedActors.has(R.key(actor.name))) continue;
    const current = currentParty.find(a => a.name === actor.name); if (!current) continue;
    const sheet = actor.rawSheet.replace(/^([ \t]*)(Equipped|Attack|Damage|Armor|Magic|AC):[^\r\n]*/gm,
      (line, indent, label) => indent + current.lines.find(l => l.startsWith(label + ':')));
    incomingText = incomingText.replace(actor.rawSheet, () => sheet);
  }
  if (gear.length) {
    const incomingProps = Inventory.parseProperties(field(incomingText, 'Party Equipped Properties'))
      .filter(p => !protectedActors.has(R.key(p.owner)));
    incomingText = write(incomingText, 'Party Equipped Properties', [...incomingProps,
      ...equippedProps.filter(p => protectedActors.has(R.key(p.owner)))].map(p => JSON.stringify(flatItem(p))).join(', ') || 'None');
  }
  const names = namesOf(incomingText), props = propertiesOf(incomingText);
  const db = JSON.parse(databaseJSON || '{}');
  const recorded = new Set(transfers.filter(r => ['take', 'buy', 'receive', 'drop', 'drop-all', 'drink', 'sell', 'equip', 'unequip'].includes(r.kind))
    .flatMap(r => r.items || [r.item]).filter(Boolean).map(R.key));
  for (const c of Object.values(db['0,0,0']?.spellSystem?.casters || {})) if (c.settings?.spellbook) recorded.add(R.key(c.bookName));
  for (const room of Object.values(db)) for (const receipt of room?.itemTransfers || []) recorded.add(R.key(receipt.item));
  for (const receipt of db['0,0,0']?.combatLife?.receipts || []) if (receipt.item) recorded.add(R.key(receipt.item));
  const equipmentCounts = text => {
    const counts = new Map();
    for (const label of ['PC', 'NPCs in Party']) for (const sheet of I.parseSheets(text, label))
      for (const name of Object.values(I.parseEquipment(sheet.lines[9]))) if (name !== 'None')
        counts.set(R.key(name), (counts.get(R.key(name)) || 0) + 1);
    return counts;
  };
  const equippedBefore = equipmentCounts(oldText), equippedAfter = equipmentCounts(incomingText);
  // Protect both additions and removals: stale pre-drop, sale and handoff snapshots must not recreate spent copies.
  for (const name of recorded) {
    const oldNames = namesOf(oldText).filter(n => R.key(n) === name);
    const count = Math.max(0, oldNames.length + (equippedBefore.get(name) || 0) - (equippedAfter.get(name) || 0));
    const spelling = oldNames[0] || names.find(n => R.key(n) === name) || name;
    for (let i = names.length - 1; i >= 0; i--) if (R.key(names[i]) === name) names.splice(i, 1);
    for (let i = 0; i < count; i++) names.push(spelling);
  }
  for (const item of propertiesOf(oldText)) if ((item.consumable_kind || item.minor_mission_id || item.equipment_source === 'engine-srd-basic-v1') && names.some(n => R.key(n) === R.key(item.name))) {
    const index = props.findIndex(i => R.key(i.name) === R.key(item.name));
    if (index >= 0) props[index] = item; else props.push(item);
  }
  for (const item of propertiesOf(oldText)) if (recorded.has(R.key(item.name)) && names.some(n => R.key(n) === R.key(item.name))) {
    const index = props.findIndex(i => R.key(i.name) === R.key(item.name));
    if (index >= 0) props[index] = item; else props.push(item);
  }
  return inventoryText(incomingText, names, props);
}
function roomKeyFromText(text) { return I.roomKey(field(text, 'Coordinates')); }
module.exports = { start, project, seedRoom, corpseDrops, refresh, view, action, preserve, preserveInventory, field, write, syncGround, registerGround, protectedItem,
  validateDivineRoster: Divinity.validateRoster };
