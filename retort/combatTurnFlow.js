'use strict';
const { randomUUID } = require('node:crypto');
const I = require('../assets/dungeonInhabitants');

function create(dice, state) {
  return {
    round: 0, teams: null, pc: null, retreated: false,
    startRound() {
      this.round++; dice.results.clear(); dice.active.round = this.round; dice.publish();
    },
    canContinue() { return !this.retreated && this.pc?.hp > 0 && this.teams?.hostiles.some(a => a.hp > 0); },
    async initiative(actor) {
      const roll = await dice.roll({ actor: actor.name, label: 'Initiative' });
      return roll?.total ?? 0;
    },
    prompt(combatant, targets, positions, allowRetreat = true) {
      const prompt = { type: 'target_prompt', actionId: dice.active.id, turnId: randomUUID(), round: this.round,
        combatant: combatant.name, targets: targets.map(a => a.name), positions, allowRetreat,
        initiative: this.teams.combatants.filter(a => a.hp > 0).map(a => ({ name: a.name, roll: a.initiative })).sort((a, b) => b.roll - a.roll) };
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
  return party.filter(actor => actor.hp > 0 && (actor.type === 'pc' || actor.type === 'npc') &&
    (space ? space.canAttack(attacker, actor) : Number.isFinite(attacker.x) && Number.isFinite(actor.x) &&
      Math.hypot(attacker.x - actor.x, attacker.y - actor.y) <= 1.5));
}

function escapePaths(space, party, hostiles, roster, maxSteps = 4) {
  if (!space) return null;
  const pc = party.find(a => a.type === 'pc' && a.hp > 0), p = pc && space.point(pc);
  if (!p) return null;
  const occupied = new Set(roster.filter(a => (a.hp ?? 1) > 0 && space.point(a)).map(a => {
    const at = space.point(a); return `${Math.floor(at.x)},${Math.floor(at.y)}`;
  }));
  const danger = at => Math.min(...hostiles.filter(a => a.hp > 0).map(a => {
    const enemy = space.point(a); return enemy ? Math.hypot(at.x + .5 - enemy.x, at.y + .5 - enemy.y) : Infinity;
  }));
  function routes(actor, limit) {
    const at = space.point(actor), start = { x: Math.floor(at.x), y: Math.floor(at.y), path: [] };
    const queue = [start], seen = new Set([`${start.x},${start.y}`]);
    for (let i = 0; i < queue.length && i < 1024; i++) {
      const current = queue[i]; if (current.path.length >= limit) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: current.x + dx, y: current.y + dy }, key = `${next.x},${next.y}`;
        if (seen.has(key) || occupied.has(key) || !I.canTraverse(space.dungeon, current, next)) continue;
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
    occupied.delete(`${initial.x},${initial.y}`); occupied.add(`${landing.x},${landing.y}`);
    let fits = true;
    for (const companion of party.filter(a => a !== pc && a.hp > 0)) {
      const at = space.point(companion); if (!at) { fits = false; break; }
      const available = routes(companion, maxSteps + 4).filter(tile => Math.hypot(tile.x - landing.x, tile.y - landing.y) <= 3)
        .sort((a, b) => a.path.length - b.path.length || danger(b) - danger(a));
      const target = available[0]; if (!target) { fits = false; break; }
      plans.push({ actor: companion, path: target.path });
      occupied.delete(`${Math.floor(at.x)},${Math.floor(at.y)}`); occupied.add(`${target.x},${target.y}`);
    }
    occupied.clear(); for (const key of reserved) occupied.add(key);
    if (fits) return plans;
  }
  return null;
}
module.exports = { create, opportunityTargets, escapePaths };
