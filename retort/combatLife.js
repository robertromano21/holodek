'use strict';
const { randomInt } = require('node:crypto');
const I = require('../assets/dungeonInhabitants'), Rules = require('../assets/spellRules');
const Inventory = require('../assets/inventoryUi'), Reach = require('./dungeonReach');
const SURVIVAL_DC = 12, DYING_ROUNDS = 2;
const key = Rules.key;
const actors = text => ['PC', 'NPCs in Party', 'Monsters in Room'].flatMap(label => I.parseSheets(text, label));
const dbOf = state => JSON.parse(state.getRoomNameDatabase() || '{}');
const geoOf = text => I.roomKey(String(text).match(/^Coordinates:[ \t]*([^\r\n]*)/m)?.[1]);
function ledger(db, runId) {
  db['0,0,0'] ||= {};
  if (db['0,0,0'].combatLife?.runId !== runId) db['0,0,0'].combatLife = {
    version: 1, runId, clock: 0, revision: 0, actors: {}, receipts: [], source: 'engine-combat-life-v1' };
  return db['0,0,0'].combatLife;
}
function saveBonus(actor) { return Math.min(5, Math.floor(Rules.casterLevel(actor.className || actor.class || actor.Class, actor.level || actor.Level || 1) / 4)); }
function survivalPlan(actor) { return { actor: actor.name, label: 'Survival Save', sides: 20, modifier: saveBonus(actor), difficulty: SURVIVAL_DC, player: false }; }
function apply(db, runId, actor, nextHp, natural, options = {}) {
  const life = ledger(db, runId);
  if (!actor?.name || !Number.isFinite(nextHp)) throw Error('Invalid injury.');
  const prior = I.state(actor), record = { name: actor.name, type: actor.type, geoKey: options.geoKey,
    maxHp: actor.maxHp ?? actor.maxHP ?? actor.MaxHP, hp: Math.max(0, nextHp),
    allegiance: I.isDown(actor) ? life.actors[key(actor.name)]?.allegiance || I.allegiance(actor) : I.allegiance(actor),
    state: actor.type === 'pc' ? 'Alive' : I.isDown(actor) ? life.actors[key(actor.name)]?.allegiance || I.allegiance(actor) : I.allegiance(actor), at: life.clock };
  if (prior === 'Dead' && !options.resurrect) { record.hp = 0; record.state = 'Dead'; }
  else if (nextHp <= 0) {
    if (I.isDown(actor)) record.state = options.damage > 0 ? 'Dead' : prior;
    else {
      if (!Number.isInteger(natural) || natural < 1 || natural > 20) throw Error('A real survival save is required.');
      const total = natural + saveBonus(actor), passed = natural === 20 || natural !== 1 && total >= SURVIVAL_DC;
      record.state = passed ? 'Unconscious' : 'Dying';
      record.save = { natural, total, difficulty: SURVIVAL_DC, passed };
    }
    if (record.state === 'Dying') record.remaining = life.actors[key(actor.name)]?.remaining ?? DYING_ROUNDS;
    if (record.state === 'Unconscious') record.recoverAt = life.actors[key(actor.name)]?.recoverAt ?? life.clock + 2;
  }
  life.actors[key(actor.name)] = record; life.revision++;
  Object.assign(actor, { hp: record.hp, state: record.state, dyingRounds: record.remaining });
  return record;
}
function paint(text, life) {
  if (!life) return text;
  for (const [label, type] of [['PC', 'pc'], ['NPCs in Party', 'npc'], ['Monsters in Room', 'monster']])
    text = text.replace(I.sectionPattern(label), (whole, head, body) => {
      for (const a of I.parseBlocks(body, type)) {
        const r = life.actors[key(a.name)]; if (!r) continue;
        let sheet = a.rawSheet.replace(/^([ \t]*HP:)[^\r\n]*/m, (_, h) => h + ' ' + r.hp);
        if (/^[ \t]*State:/m.test(sheet)) sheet = sheet.replace(/^([ \t]*State:)[^\r\n]*/m, (_, h) => h + ' ' + r.state);
        else sheet += (sheet.includes('\r\n') ? '\r\n' : '\n') + '      State: ' + r.state;
        body = body.replace(a.rawSheet, () => sheet);
      }
      return head + body;
    });
  if (life.pcName) {
    const value = `Divine Rescues: ${life.rescuesUsed || 0}/2 used`;
    text = /^Divine Rescues:/m.test(text) ? text.replace(/^Divine Rescues:[^\r\n]*/m, value) : value + '\n' + text;
  }
  return text;
}
function rosterPaint(roster, life) {
  for (const a of roster) {
    const r = life?.actors[key(a.name)]; if (!r) continue;
    Object.assign(a, { hp: r.hp, state: r.state, dyingRounds: r.remaining });
  }
  return roster;
}
function commit(state, db, text = state.getUpdatedGameConsole(), roster = JSON.parse(state.getCombatCharactersString() || '[]')) {
  const life = ledger(db, state.getDungeonRunId());
  const pc = actors(text).find(a => a.type === 'pc'), injury = pc && life.actors[key(pc.name)];
  if (pc && injury && !life.gameOver && (injury.state === 'Dead' || key(pc.name) === 'mortacia' && injury.hp <= 0)) {
    life.pcName = pc.name;
    const mortacia = key(pc.name) === 'mortacia', by = mortacia ? 'Dyanetzia' : 'Mortacia';
    if ((life.rescuesUsed || 0) < 2) {
      life.rescuesUsed = (life.rescuesUsed || 0) + 1;
      injury.hp = Math.max(1, Math.ceil(pc.maxHp / 2)); injury.state = 'Alive'; delete injury.remaining;
      life.message = `${by} ${mortacia ? 'revives' : 'resurrects'} ${pc.name} at ${injury.hp} HP. Divine rescue ${life.rescuesUsed} of 2.`;
    } else {
      injury.hp = 0; injury.state = 'Dead'; delete injury.remaining;
      life.gameOver = { pc: pc.name, reason: mortacia ? 'Dantuea and Arithus triumph. The world falls into darkness.' :
        'Mortacia moves on to find another chosen. Your journey ends.', at: life.clock };
      state.setGamePaused?.(true);
      life.message = 'Game Over. ' + life.gameOver.reason;
    }
    life.revision++;
    life.messageRevision = life.revision;
  }
  const next = paint(text, life);
  const sheets = new Map(actors(next).map(a => [key(a.name), a]));
  for (const [geoKey, room] of Object.entries(db)) {
    const p = state.getRoomPopulation?.(geoKey) || room?.inhabitants; if (!p) continue;
    for (const a of Object.values(p.actors || {})) {
      const r = life.actors[key(a.name)]; if (!r) continue;
      a.hp = r.hp; a.state = r.state;
      if (r.state === 'Dead') a.status = 'dead';
      else if (a.status === 'dead') a.status = r.type === 'npc' ? 'recruited' : 'present';
      const sheet = sheets.get(key(a.name)); if (sheet) a.sheet = sheet.rawSheet;
    }
    room.inhabitants = p; state.setRoomPopulation?.(geoKey, p);
  }
  state.setRoomNameDatabase(JSON.stringify(db)); state.setUpdatedGameConsole(next);
  state.setCombatCharactersString(JSON.stringify(rosterPaint(roster, life)));
  if (life.message) state.emitter?.emit('combat_life', status(state));
  return life;
}
function status(state) {
  const saved = dbOf(state)['0,0,0']?.combatLife, life = saved?.runId === state.getDungeonRunId() ? saved : null;
  return { runId: state.getDungeonRunId(), revision: life?.revision || 0, rescuesUsed: life?.rescuesUsed || 0,
    messageRevision: life?.messageRevision || 0, gameOver: life?.gameOver || null, message: life?.message || '' };
}
function advance(state) {
  if (state.getGamePaused?.() || status(state).gameOver) return [];
  const db = dbOf(state), life = db['0,0,0']?.combatLife;
  if (!life || life.runId !== state.getDungeonRunId()) return [];
  life.clock++; const died = [];
  for (const r of Object.values(life.actors)) if (r.state === 'Dying' && r.at < life.clock) {
    r.remaining--; life.revision++;
    if (r.remaining <= 0) { r.state = 'Dead'; delete r.remaining; died.push(r.name); }
  } else if (r.state === 'Unconscious' && r.recoverAt <= life.clock) {
    r.hp = 1; r.state = r.type === 'pc' ? 'Alive' : r.allegiance || 'Friendly'; delete r.recoverAt; life.revision++;
  }
  commit(state, db);
  for (const name of died) if (life.actors[key(name)]?.type === 'monster') require('./economy').corpseDrops(state, name);
  return died;
}
function claimDeaths(state, name) {
  const db = dbOf(state), life = db['0,0,0']?.combatLife; if (!life) return [];
  const found = Object.values(life.actors).filter(r => r.state === 'Dead' && r.type !== 'pc' && !r.deathProcessed && (!name || r.name === name));
  for (const r of found) r.deathProcessed = true;
  if (found.length) state.setRoomNameDatabase(JSON.stringify(db));
  const sheets = actors(state.getUpdatedGameConsole());
  return found.map(r => ({ ...r, ...sheets.find(a => a.name === r.name), allegiance: r.allegiance }));
}
function preserve(state, text, database, rosterJSON) {
  const life = dbOf(state)['0,0,0']?.combatLife;
  if (!life || life.runId !== state.getDungeonRunId()) return { text, database, roster: rosterJSON };
  if (database !== undefined) { const db = JSON.parse(database); db['0,0,0'] ||= {}; db['0,0,0'].combatLife = life; database = JSON.stringify(db); }
  return { text: typeof text === 'string' ? paint(text, life) : text, database,
    roster: rosterJSON === undefined ? undefined : JSON.stringify(rosterPaint(JSON.parse(rosterJSON), life)) };
}
function careChoices(state, actorName) {
  const text = state.getUpdatedGameConsole(), all = actors(text), actor = all.find(a => a.name === actorName && I.canAct(a));
  if (!actor) return [];
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'), geoKey = geoOf(text);
  const dungeon = state.getRoomDungeonForSimulation?.(state.getLastCoords());
  const from = Reach.position(roster.find(a => a.name === actor.name), geoKey);
  const team = a => a.type === 'pc' || a.type === 'npc' ? 'Friendly' : I.allegiance(a);
  const inventoryNames = String(text.match(/^Inventory:[ \t]*([^\r\n]*)/m)?.[1] || '').split(/,\s*/).map(key);
  const potions = actor.type === 'monster' ? [] : Inventory.parseProperties(text.match(/^Inventory Properties:[ \t]*([^\r\n]*)/m)?.[1]).filter(p =>
    inventoryNames.includes(key(p.name)) && (p.consumable_kind === 'healing' || /^healing potion \d+ hp$/i.test(p.name)) && Number.isInteger(p.magic) && p.magic >= 3 && p.magic <= 10);
  return all.flatMap(target => {
    const to = Reach.position(roster.find(a => a.name === target.name), geoKey);
    if (!I.isAlive(target) || team(target) !== team(actor) || target.hp >= target.maxHp || !dungeon || !from || !to ||
      Math.hypot(from.x - to.x, from.y - to.y) > 1.5 || !Reach.lineClear(dungeon, from, to)) return [];
    return [...(I.state(target) === 'Dying' ? [{ kind: 'bandage', target: target.name, label: 'Bandage ' + target.name }] : []),
      ...potions.map(p => ({ kind: 'drink', target: target.name, item: p.name, label: `Heal ${target.name}: ${p.name} (+${p.magic} HP)` }))];
  });
}
function care(state, input) {
  try {
    if (input.runId !== state.getDungeonRunId() || input.geoKey !== geoOf(state.getUpdatedGameConsole()) || state.getGamePaused?.() || status(state).gameOver) throw Error('That aid action is unavailable in this room.');
    const db = dbOf(state), life = ledger(db, state.getDungeonRunId());
    if (!/^[\w:-]{8,100}$/.test(input.nonce || '')) throw Error('An aid transaction ID is required.');
    const request = JSON.stringify([input.actor, input.kind, input.target, input.item]);
    const old = life.receipts.find(r => r.nonce === input.nonce);
    if (old) { if (old.request !== request) throw Error('That aid transaction was already used.'); return { ...old.result, duplicate: true }; }
    if (!careChoices(state, input.actor).some(c => c.kind === input.kind && c.target === input.target && c.item === input.item)) throw Error('Move adjacent to a living wounded ally and choose an available aid action.');
    let text = state.getUpdatedGameConsole(); const target = actors(text).find(a => a.name === input.target);
    let amount = 0;
    if (input.kind === 'bandage') {
      const r = life.actors[key(target.name)] || apply(db, state.getDungeonRunId(), target, 0, 1, { geoKey: input.geoKey });
      r.state = 'Unconscious'; r.recoverAt = life.clock + 2; delete r.remaining; life.revision++;
    } else {
      const names = text.match(/^Inventory:[ \t]*([^\r\n]*)/m)[1].split(/,\s*/), props = Inventory.parseProperties(text.match(/^Inventory Properties:[ \t]*([^\r\n]*)/m)?.[1]);
      const potion = props.find(p => key(p.name) === key(input.item)), index = names.findIndex(n => key(n) === key(input.item));
      names.splice(index, 1); amount = Math.min(potion.magic, target.maxHp - target.hp);
      text = text.replace(/^Inventory:[^\r\n]*/m, () => 'Inventory: ' + (names.join(', ') || 'Empty'))
        .replace(/^Inventory Properties:[^\r\n]*/m, () => 'Inventory Properties: ' + (props.filter(p => names.some(n => key(n) === key(p.name))).map(p => JSON.stringify(p)).join(', ') || 'None'));
      apply(db, state.getDungeonRunId(), target, target.hp + amount, null, { geoKey: input.geoKey });
    }
    const result = { content: input.kind === 'bandage' ? `${input.actor} bandages ${target.name}. Stable, unconscious at 0 HP.` :
      `${input.actor} gives ${input.item} to ${target.name}, restoring ${amount} HP.`, target: target.name, kind: input.kind };
    life.receipts.push({ nonce: input.nonce, request, result, item: input.item }); if (life.receipts.length > 512) life.receipts.shift();
    commit(state, db, text); return result;
  } catch (error) { return { error: error.message }; }
}
function wait(state, input) {
  try {
    if (input.runId !== state.getDungeonRunId() || input.geoKey !== geoOf(state.getUpdatedGameConsole()) || state.getGamePaused?.() || status(state).gameOver)
      throw Error('Waiting is unavailable in this room.');
    if (!/^[\w:-]{8,100}$/.test(input.nonce || '')) throw Error('A wait transaction ID is required.');
    const db = dbOf(state), life = ledger(db, state.getDungeonRunId());
    const old = life.receipts.find(r => r.nonce === input.nonce);
    if (old) { if (old.request !== 'wait') throw Error('That transaction was already used.'); return { ...old.result, duplicate: true }; }
    const result = { content: 'One turn passes while the wounded await aid or recover.' };
    life.receipts.push({ nonce: input.nonce, request: 'wait', result }); if (life.receipts.length > 512) life.receipts.shift();
    state.setRoomNameDatabase(JSON.stringify(db)); return result;
  } catch (error) { return { error: error.message }; }
}
module.exports = { SURVIVAL_DC, DYING_ROUNDS, actors, ledger, saveBonus, survivalPlan, apply, paint, rosterPaint, commit, advance, preserve, careChoices, care, wait, status, claimDeaths,
  natural: () => randomInt(1, 21) };
