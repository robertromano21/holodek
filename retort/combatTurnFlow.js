'use strict';
const { randomUUID } = require('node:crypto');
const I = require('../assets/dungeonInhabitants');
const Spells = require('./spellSystem');
const Life = require('./combatLife');
const Footprint = require('../assets/combatFootprint');

function footprint(space, actor, at) {
  const canonical = space.roster?.find(a => a.name?.toLowerCase() === actor.name?.toLowerCase()) || actor;
  return Footprint.cells(canonical, at);
}
function canStep(space, actor, from, to, occupied, own = new Set()) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return footprint(space, actor, to).every(p => (!occupied.has(`${p.x},${p.y}`) || own.has(`${p.x},${p.y}`)) &&
    I.canTraverse(space.dungeon, { x: p.x - dx, y: p.y - dy,
      ...(Number.isFinite(from.pointX) ? { pointX: from.pointX + p.x - to.x, pointY: from.pointY + p.y - to.y } : {}) }, p));
}

function create(dice, state) {
  return {
    round: 0, teams: null, pc: null, retreated: false,
    startRound() {
      if (state.getRoomNameDatabase) { Spells.synchronize(state); Spells.advance(state); }
      this.round++; dice.results.clear(); dice.active.round = this.round;
      if (dice.active.ledger) { dice.active.ledger.round = this.round; dice.active.ledger.initiative = []; }
      dice.publish();
    },
    canContinue() { return !this.retreated && !(state.getRoomNameDatabase && Life.status(state).gameOver) &&
      this.teams?.friends.some(I.canAct) && this.teams?.hostiles.some(I.canAct); },
    async initiative(actor) {
      if (!I.canAct(actor)) return null;
      const roll = await dice.roll({ actor: actor.name, label: 'Initiative' });
      return I.canAct(actor) ? roll?.total ?? 0 : null;
    },
    refreshInitiative() {
      const ledger = dice.active?.ledger;
      if (!ledger || !this.teams) return;
      const conscious = new Set(this.teams.combatants.filter(I.canAct).map(a => a.name));
      const next = ledger.initiative.filter(a => conscious.has(a.name));
      if (next.length === ledger.initiative.length) return;
      ledger.initiative = next;
      if (dice.active.turn) dice.active.turn.initiative = next.map(a => ({ ...a }));
      dice.publish();
    },
    prompt(combatant, targets, positions, allowRetreat = true) {
      const prompt = { type: 'target_prompt', actionId: dice.active.id, turnId: randomUUID(), round: this.round,
        combatant: combatant.name, targets: targets.map(a => a.name), positions, allowRetreat,
        spells: state.getRoomNameDatabase ? Spells.choices(state, combatant.name, targets.map(a => a.name)) : [],
        care: state.getRoomNameDatabase ? Life.careChoices(state, combatant.name) : [],
        initiative: this.teams.combatants.filter(I.canAct).map(a => ({ name: a.name, roll: a.initiative })).sort((a, b) => b.roll - a.roll) };
      dice.active.turn = prompt; dice.publish(); return prompt;
    },
    clearPrompt(turnId) {
      if (dice.active?.turn?.turnId === turnId) { delete dice.active.turn; dice.publish(); }
    }
  };
}

// Re-evaluate after every strike so another enemy cannot choose a just-killed party member.
function opportunityTargets(attacker, party, space) {
  if (attacker.hp <= 0 || I.allegiance(attacker) !== 'Hostile') return [];
  return party.filter(actor => I.isAlive(actor) && (actor.type === 'pc' || actor.type === 'npc') &&
    (space ? (space.canStrike || space.canAttack)(attacker, actor) : Number.isFinite(attacker.x) && Number.isFinite(actor.x) &&
      Math.hypot(attacker.x - actor.x, attacker.y - actor.y) <= 1.5));
}

function turnPath(space, actor, source, roster, maxSteps = 2) {
  const at = space?.point(actor), from = space?.point(source); if (!at || !from) return [];
  const occupied = new Set(roster.filter(a => a.name !== actor.name && (a.hp ?? 1) > 0 && space.point(a))
    .flatMap(a => footprint(space, a, space.point(a)).map(p => `${p.x},${p.y}`)));
  const distance = p => Math.hypot(p.x + .5 - from.x, p.y + .5 - from.y);
  const start = { x: Math.floor(at.x), y: Math.floor(at.y), pointX: at.x, pointY: at.y, path: [] }, queue = [start], seen = new Set([`${start.x},${start.y}`]);
  let best = start;
  for (let i = 0; i < queue.length && i < 128; i++) {
    const current = queue[i]; if (current.path.length >= maxSteps) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, y: current.y + dy }, key = `${next.x},${next.y}`;
      if (seen.has(key) || distance(next) <= distance(current) || !canStep(space, actor, current, next, occupied)) continue;
      seen.add(key); const entry = { ...next, path: [...current.path, next] }; queue.push(entry);
      if (distance(entry) > distance(best)) best = entry;
    }
  }
  return best.path;
}

function escapePaths(space, party, hostiles, roster, maxSteps = 4) {
  if (!space) return null;
  const pc = party.find(a => a.type === 'pc' && I.canAct(a)) || party.find(I.canAct), p = pc && space.point(pc);
  if (!p) return null;
  const occupied = new Set(roster.filter(a => (a.hp ?? 1) > 0 && space.point(a))
    .flatMap(a => footprint(space, a, space.point(a)).map(p => `${p.x},${p.y}`)));
  const danger = at => Math.min(...hostiles.filter(a => a.hp > 0).map(a => {
    const enemy = space.point(a); return enemy ? Math.hypot(at.x + .5 - enemy.x, at.y + .5 - enemy.y) : Infinity;
  }));
  function routes(actor, limit) {
    const at = space.point(actor), start = { x: Math.floor(at.x), y: Math.floor(at.y), pointX: at.x, pointY: at.y, path: [] };
    const own = new Set(footprint(space, actor, at).map(p => `${p.x},${p.y}`));
    const queue = [start], seen = new Set([`${start.x},${start.y}`]);
    for (let i = 0; i < queue.length && i < 1024; i++) {
      const current = queue[i]; if (current.path.length >= limit) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: current.x + dx, y: current.y + dy }, key = `${next.x},${next.y}`;
        if (seen.has(key) || !canStep(space, actor, current, next, occupied, own)) continue;
        seen.add(key); queue.push({ ...next, path: [...current.path, next] });
      }
    }
    return queue;
  }
  const initial = { x: Math.floor(p.x), y: Math.floor(p.y) }, initialDanger = danger(initial);
  const choices = routes(pc, maxSteps).filter(at => at.path.length && danger(at) > initialDanger + 1)
    .sort((a, b) => danger(b) - danger(a) || a.path.length - b.path.length);
  for (const landing of choices) {
    const reserved = new Set(occupied), plans = [{ actor: pc, path: landing.path }];
    for (const c of footprint(space, pc, initial)) occupied.delete(`${c.x},${c.y}`);
    for (const c of footprint(space, pc, landing)) occupied.add(`${c.x},${c.y}`);
    let fits = true;
    for (const companion of party.filter(a => a !== pc && I.isAlive(a))) {
      const at = space.point(companion); if (!at) { fits = false; break; }
      const available = routes(companion, maxSteps + 4).filter(tile => Math.hypot(tile.x - landing.x, tile.y - landing.y) <= 3)
        .sort((a, b) => a.path.length - b.path.length || danger(b) - danger(a));
      const target = available[0]; if (!target) { fits = false; break; }
      plans.push({ actor: companion, path: target.path });
      for (const c of footprint(space, companion, at)) occupied.delete(`${c.x},${c.y}`);
      for (const c of footprint(space, companion, target)) occupied.add(`${c.x},${c.y}`);
    }
    occupied.clear(); for (const key of reserved) occupied.add(key);
    if (fits) return plans;
  }
  return null;
}
module.exports = { create, opportunityTargets, escapePaths, turnPath };
