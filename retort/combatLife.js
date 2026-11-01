'use strict';
const { randomInt } = require('node:crypto');
const I = require('../assets/dungeonInhabitants'), Rules = require('../assets/spellRules');
const Inventory = require('../assets/inventoryUi'), Reach = require('./dungeonReach');
const SURVIVAL_DC = 12, DYING_ROUNDS = 2;
const key = Rules.key;
const DeathStory = require('./deathStory');
const Defeats = require('./questDefeatEvidence');
const actors = text => ['PC', 'NPCs in Party', 'Monsters in Room'].flatMap(label => I.parseSheets(text, label));
const dbOf = state => JSON.parse(state.getRoomNameDatabase() || '{}');
const geoOf = text => I.roomKey(String(text).match(/^Coordinates:[ \t]*([^\r\n]*)/m)?.[1]);
function announce(state, notice) {
  state.emitter?.emit('combat_life_action', notice);
}
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
  const previousDefeat = actor.type === 'monster' && Defeats.evidence(db, options.geoKey, actor.name);
  if (previousDefeat) Defeats.remember(life, actor.name, options.geoKey, previousDefeat.at ?? life.clock);
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
  if (actor.type === 'monster' && record.hp === 0) Defeats.remember(life, actor.name, options.geoKey);
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
    const label=life.recoveryLabel || 'Divine Rescues';
    const value = `${label}: ${life.rescuesUsed || 0}/2 used`;
    text = /^(?:Divine Rescues|Recoveries):/m.test(text) ? text.replace(/^(?:Divine Rescues|Recoveries):[^\r\n]*/m, value) : value + '\n' + text;
  }
  return text;
}
function rosterPaint(roster, life) {
  for (const a of roster) {
    const r = life?.actors[key(a.name)]; if (!r) continue;
    Object.assign(a, { hp: r.hp, state: r.state, allegiance: r.allegiance, dyingRounds: r.remaining });
    if (r.mercy) { a.mercy = { ...r.mercy }; delete a.pursuit; }
  }
  return roster;
}
function commit(state, db, text = state.getUpdatedGameConsole(), roster = JSON.parse(state.getCombatCharactersString() || '[]')) {
  const prior = dbOf(state)['0,0,0']?.combatLife;
  const life = ledger(db, state.getDungeonRunId());
  const pc = actors(text).find(a => a.type === 'pc'), injury = pc && life.actors[key(pc.name)];
  const policy=DeathStory.policy(db['0,0,0']?.setting);
  life.recoveryLabel=policy.counter;life.recoveryTitle=policy.title;
  if (pc && injury && !life.gameOver && (injury.state === 'Dead' || policy.cotg && key(pc.name) === 'mortacia' && injury.hp <= 0)) {
    const story=policy.cotg?null:DeathStory.validate(policy.story);
    life.pcName = pc.name;
    const mortacia = policy.cotg && key(pc.name) === 'mortacia', by = mortacia ? 'Dyanetzia' : 'Mortacia';
    if ((life.rescuesUsed || 0) < 2) {
      life.rescuesUsed = (life.rescuesUsed || 0) + 1;
      const fromKey = geoOf(text);
      life.respawn = { id: require('node:crypto').randomUUID(), fromKey, recovery: life.rescuesUsed };
      const reviver = policy.cotg ? by : story.reviver;
      life.deathScene = { reviver, description: policy.cotg ? `Darkness gives way to a quiet threshold in the underworld. ${by} stands before you.` : story.scene,
        words: policy.cotg ? `Your journey is unfinished. I can return you ${2 - life.rescuesUsed} more time${life.rescuesUsed === 1 ? '' : 's'} after this. You will wake alone at the level entrance; seek your companions.` : life.rescuesUsed === 1 ? story.firstMeeting : story.secondMeeting };
      injury.hp = Math.max(1, Math.ceil(pc.maxHp / 2)); injury.state = 'Alive'; delete injury.remaining;
      life.message = policy.cotg ? `${by} ${mortacia ? 'revives' : 'resurrects'} ${pc.name} at ${injury.hp} HP. Divine rescue ${life.rescuesUsed} of 2.` : `${story.reason} ${life.rescuesUsed===1?story.firstReturn:story.secondReturn} Recovery ${life.rescuesUsed} of 2; ${injury.hp} HP.`;
    } else {
      injury.hp = 0; injury.state = 'Dead'; delete injury.remaining;
      life.gameOver = { pc: pc.name, reason: !policy.cotg ? story.finalDeath : mortacia ? 'Dantuea and Arithus triumph. The world falls into darkness.' :
        'Mortacia moves on to find another chosen. Your journey ends.', at: life.clock };
      state.setGamePaused?.(true);
      life.deathScene = { reviver: policy.cotg ? by : story.reviver, description: policy.cotg ? 'The threshold is silent now.' : story.scene, words: life.gameOver.reason };
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
      a.hp = r.hp; a.state = r.state; a.allegiance = r.allegiance;
      if (r.mercy) { a.mercy = { ...r.mercy }; delete a.pursuit; }
      if (r.state === 'Dead') a.status = 'dead';
      else if (a.status === 'dead') a.status = r.type === 'npc' ? 'recruited' : 'present';
      const sheet = sheets.get(key(a.name)); if (sheet) a.sheet = sheet.rawSheet;
    }
    room.inhabitants = p; state.setRoomPopulation?.(geoKey, p);
  }
  state.setRoomNameDatabase(JSON.stringify(db)); state.setUpdatedGameConsole(next);
  state.setCombatCharactersString(JSON.stringify(rosterPaint(roster, life)));
  if (life.respawn) require('./economy').playerDeathDrops(state, life.respawn.id);
  for (const actor of actors(state.getUpdatedGameConsole()).filter(a => a.type === 'monster' && (I.isDown(a) || I.state(a) === 'Dead')))
    require('./economy').corpseDrops(state, actor.name);
  const committedRoster = new Map(JSON.parse(state.getCombatCharactersString() || '[]').map(actor => [actor.name, actor]));
  for (const actor of roster) {
    const committed = committedRoster.get(actor.name); if (!committed) continue;
    for (const field of ['equipped', 'Equipped', 'attack', 'damage', 'armor', 'ac', 'magic'])
      if (committed[field] !== undefined) actor[field] = committed[field];
  }
  state.emitter?.emit('combat_life', status(state));
  for (const r of Object.values(life.actors)) {
    const before = prior?.runId === life.runId ? prior.actors?.[key(r.name)] : null;
    if (r.save && (!before?.save || before.at !== r.at || JSON.stringify(before.save) !== JSON.stringify(r.save)))
      announce(state, { kind: 'survival-save', title: r.name, subject: r.name, activity: 'Survival Save',
        roll: r.save.natural, result: r.save.passed ? 'success' : 'failure',
        message: `${r.name}: Survival Save d20 ${r.save.natural} + ${r.save.total - r.save.natural} = ${r.save.total} vs ${r.save.difficulty}. ` +
          (r.state === 'Unconscious' ? 'Stable, unconscious at 0 HP.' : r.state === 'Dying' ?
            `Dying at 0 HP; ${r.remaining} rounds or actions remain for aid. Reading menus does not advance this countdown.` : life.message || r.state) });
  }
  return life;
}
function status(state) {
  const saved = dbOf(state)['0,0,0']?.combatLife, life = saved?.runId === state.getDungeonRunId() ? saved : null;
  return { runId: state.getDungeonRunId(), pendingRespawn: !!life?.respawn, deathScene: life?.deathScene || null,
    recovery: recoveryStatus(state, life), revision: life?.revision || 0, rescuesUsed: life?.rescuesUsed || 0,
    recoveryTitle: life?.recoveryTitle || 'Divine Intervention', livesRemaining: Math.max(0,3-(life?.rescuesUsed||0)-(life?.gameOver?1:0)),
    messageRevision: life?.messageRevision || 0, gameOver: life?.gameOver || null, message: life?.message || '',
    injuries: actors(state.getUpdatedGameConsole?.() || '').filter(I.isDown).map(a => ({ name: a.name, state: I.state(a),
      remaining: life?.actors[key(a.name)]?.remaining ?? a.dyingRounds })) };
}
function recoveryStatus(state, life) {
  const party = actors(state.getUpdatedGameConsole?.() || '').filter(a => a.type === 'pc' || a.type === 'npc');
  const pc = party.find(a => a.type === 'pc');
  if (!pc || !I.isDown(pc)) return null;
  const record = life?.actors[key(pc.name)];
  return { name: pc.name, state: pc.state, clock: life?.clock || 0, remaining: pc.state === 'Unconscious' ? Math.max(1, (record?.recoverAt || 0) - (life?.clock || 0)) : record?.remaining,
    message: pc.state === 'Unconscious' ? pc.name + ' is slowly recovering from the wounds.' : pc.name + ' is dying and needs aid.',
    afterBattle: !!life?.afterBattle };
}
function settle(state) {
  const db = dbOf(state), life = ledger(db, state.getDungeonRunId());
  const party = actors(state.getUpdatedGameConsole()).filter(a => a.type === 'pc' || a.type === 'npc');
  const pc = party.find(a => a.type === 'pc');
  life.afterBattle = true;
  if (pc && pc.hp <= 0 && !party.some(a => a.hp > 0 || I.state(a) === 'Unconscious')) {
    for (const actor of party.filter(a => I.state(a) === 'Dying')) {
      const r = life.actors[key(actor.name)]; if (r) { r.state = 'Dead'; r.hp = 0; delete r.remaining; }
    }
    life.revision++;
  }
  return commit(state, db);
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
  const present = new Set(actors(state.getUpdatedGameConsole()).map(a => a.name));
  for (const r of Object.values(life.actors)) if (r.state === 'Dying' && present.has(r.name))
    announce(state, { kind: 'dying-warning', title: r.name, subject: r.name, activity: 'First Aid Needed', result: 'blocked',
      message: `${r.name} is still dying. ${r.remaining} round or action remains for aid. Bandaging stabilizes without a roll; waiting advances the countdown.` });
  for (const name of died.filter(name => present.has(name))) announce(state, { kind: 'injury-death', title: name, subject: name, activity: 'Untreated Injuries', result: 'defeated',
    message: `${name} dies from untreated injuries. The aid window expired before stabilization.` });
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
function careChoices(state, actorName, { mercy = true } = {}) {
  const text = state.getUpdatedGameConsole(), all = actors(text), actor = all.find(a => a.name === actorName && I.canAct(a));
  if (!actor) return [];
  const roster = JSON.parse(state.getCombatCharactersString() || '[]'), geoKey = geoOf(text);
  const dungeon = state.getRoomDungeonForSimulation?.(state.getLastCoords());
  const from = Reach.position(roster.find(a => a.name === actor.name), geoKey);
  const life = dbOf(state)['0,0,0']?.combatLife;
  const team = a => a.type === 'pc' || a.type === 'npc' ? 'Friendly' :
    I.isDown(a) && life?.actors[key(a.name)]?.allegiance || I.allegiance(roster.find(r => r.name === a.name) || a);
  const inventoryNames = String(text.match(/^Inventory:[ \t]*([^\r\n]*)/m)?.[1] || '').split(/,\s*/).map(key);
  const potions = actor.type === 'monster' ? [] : Inventory.parseProperties(text.match(/^Inventory Properties:[ \t]*([^\r\n]*)/m)?.[1]).filter(p =>
    inventoryNames.includes(key(p.name)) && (p.consumable_kind === 'healing' || /^healing potion \d+ hp$/i.test(p.name)) && Number.isInteger(p.magic) && p.magic >= 3 && p.magic <= 10);
  return all.flatMap(target => {
    const to = Reach.position(roster.find(a => a.name === target.name), geoKey);
    const rescue = mercy && actor.type !== 'monster' && target.type === 'monster' && I.state(target) === 'Dying';
    if (!I.isAlive(target) || !rescue && team(target) !== team(actor) || target.hp >= target.maxHp || !dungeon || !from || !to ||
      Math.hypot(from.x - to.x, from.y - to.y) > 1.5 || !Reach.lineClear(dungeon, from, to)) return [];
    return [...(I.state(target) === 'Dying' ? [{ kind: 'bandage', target: target.name, label: 'Bandage ' + target.name }] : []),
      ...(rescue && team(target) !== team(actor) ? [] : potions.map(p => ({ kind: 'drink', target: target.name, item: p.name, label: `Heal ${target.name}: ${p.name} (+${p.magic} HP)` })))];
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
    if (!careChoices(state, input.actor).some(c => c.kind === input.kind && c.target === input.target && c.item === input.item)) throw Error('Move adjacent with clear access to a living wounded character and choose an available aid action.');
    let text = state.getUpdatedGameConsole(); const target = actors(text).find(a => a.name === input.target);
    let amount = 0, spared = false;
    if (input.kind === 'bandage') {
      // A legacy dying sheet may lack a ledger. Stabilization never invents a survival roll.
      const rosterActor = JSON.parse(state.getCombatCharactersString() || '[]').find(a => a.name === target.name);
      const r = life.actors[key(target.name)] ||= { name: target.name, type: target.type, geoKey: input.geoKey,
        maxHp: target.maxHp, hp: 0, allegiance: I.allegiance(rosterActor || target), state: 'Dying', at: life.clock };
      const healer = actors(text).find(a => a.name === input.actor);
      if (target.type === 'monster' && healer?.type !== 'monster' && r.allegiance === 'Hostile') {
        r.allegiance = 'Neutral'; r.mercy = { by: input.actor, at: life.clock }; spared = true;
      }
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
      `${input.actor} gives ${input.item} to ${target.name}, restoring ${amount} HP.`, target: target.name, kind: input.kind,
      ...(spared ? { allegiance: 'Neutral', spared: true } : {}) };
    if (spared) result.content += ' Their hostility ends; they are Neutral, not a party member.';
    life.receipts.push({ nonce: input.nonce, request, result, item: input.item }); if (life.receipts.length > 512) life.receipts.shift();
    commit(state, db, text);
    announce(state, { kind: 'first-aid', title: target.name, subject: target.name, actor: input.actor,
      activity: input.kind === 'bandage' ? 'Bandaging' : 'Healing', result: 'success',
      message: result.content + (input.kind === 'bandage' ? ' No bandaging roll is required; the dying countdown has stopped.' : '') });
    return result;
  } catch (error) {
    if (input.runId === state.getDungeonRunId() && input.geoKey === geoOf(state.getUpdatedGameConsole()))
      announce(state, { kind: 'first-aid', title: input.target || 'First Aid', subject: input.target, actor: input.actor,
        activity: 'First Aid', result: 'blocked', message: `${input.actor || 'The healer'} could not aid ${input.target || 'the target'}: ${error.message} No turn was spent.` });
    return { error: error.message };
  }
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
  settle, recoveryStatus, natural: () => randomInt(1, 21) };
