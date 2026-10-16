const { randomInt, randomUUID } = require('node:crypto');

// One live game is hosted by sharedState today. Keep requests scoped to its current action.
class ActionDice {
  constructor({ random = sides => randomInt(1, sides + 1), timeoutMs = 180000, animationMs = 1000 } = {}) {
    this.random = random;
    this.timeoutMs = timeoutMs;
    this.animationMs = animationMs;
    this.active = null;
    this.pending = null;
    this.results = new Map();
    this.revision = 0;
    this.epoch = randomUUID();
    this.paused = false;
    this.resumeWaiters = [];
  }

  snapshot() {
    return {
      type: 'dice_state', epoch: this.epoch, revision: this.revision, paused: this.paused,
      active: this.active && { id: this.active.id, kind: this.active.kind, geoKey: this.active.geoKey,
        ...(this.active.round ? { round: this.active.round } : {}), ...(this.active.turn ? { turn: this.active.turn } : {}),
        ...(this.active.ledger ? { ledger: { ...this.active.ledger, initiative: this.active.ledger.initiative.map(a => ({ ...a })),
          entries: this.active.ledger.entries.map(a => ({ ...a })) } } : {}) },
      pending: this.pending?.request || null,
      results: [...this.results.values()]
    };
  }

  publish() {
    this.revision++;
    this.active?.broadcast(this.snapshot());
  }

  recordCombat(entry) {
    if (this.active?.kind !== 'combat' || !entry || !this.active.ledger) return false;
    const ledger = this.active.ledger;
    const name = value => typeof value === 'string' && value.length > 0 && value.length <= 120;
    if (entry.kind === 'initiative') {
      if (!Array.isArray(entry.order) || !entry.order.every(a => a && name(a.name) && Number.isFinite(a.roll))) return false;
      ledger.round = this.active.round || 1;
      ledger.initiative = entry.order.map(a => ({ name: a.name, roll: a.roll })).sort((a, b) => b.roll - a.roll);
    } else {
      if (entry.kind === 'hit' && (!name(entry.actor) || !name(entry.target) || !Number.isFinite(entry.damage) || entry.damage < 0 || !Number.isFinite(entry.hp))) return false;
      if (entry.kind === 'miss' && (!name(entry.actor) || !name(entry.target))) return false;
      if (entry.kind === 'notice' && (typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 1200)) return false;
      if (!['hit', 'miss', 'notice'].includes(entry.kind)) return false;
      ledger.entries.push({ ...entry, id: `${this.active.id}:${++ledger.sequence}`, round: this.active.round || 1 });
      if (ledger.entries.length > 60) ledger.entries.shift();
    }
    this.publish(); return true;
  }

  setPaused(value) {
    if (this.paused === value) return;
    this.paused = value;
    if (this.pending) {
      if (value) {
        this.pending.remaining = Math.max(1, this.pending.request.expiresAt - Date.now());
        clearTimeout(this.pending.timer);
        this.pending.request.expiresAt = null;
      } else {
        this.pending.request.expiresAt = Date.now() + this.pending.remaining;
        this.pending.timer = setTimeout(() => this.finish(null), this.pending.remaining);
        this.pending.timer.unref?.();
      }
    }
    if (!value) this.resumeWaiters.splice(0).forEach(resolve => resolve());
    this.publish();
  }

  waitUntilResumed() {
    return this.paused ? new Promise(resolve => this.resumeWaiters.push(resolve)) : Promise.resolve();
  }

  begin(kind, geoKey, broadcast = () => {}) {
    if (this.active) throw new Error('Another action is still resolving.');
    this.results.clear();
    this.active = { id: randomUUID(), kind, geoKey, broadcast };
    if (kind === 'combat') this.active.ledger = { version: 1, round: 0, initiative: [], entries: [], sequence: 0 };
    this.publish();
  }

  end() {
    if (!this.active) return;
    delete this.moveCombatant;
    if (this.pending) this.finish(null);
    const broadcast = this.active.broadcast;
    this.active = null;
    this.resumeWaiters.splice(0).forEach(resolve=>resolve());
    this.revision++;
    broadcast(this.snapshot());
  }

  async roll({ actor, player = false, label, target = '', modifier = 0, difficulty = null, sides = 20 }) {
    const action = this.active;
    if (!action || this.pending) throw new Error('Invalid dice action state.');
    if (this.paused) await this.waitUntilResumed();
    if (this.active !== action) return null;
    if (!this.active || this.pending) throw new Error('Invalid dice action state.');
    if (!Number.isInteger(sides) || sides < 2 || sides > 1000 || !Number.isFinite(modifier) || (difficulty !== null && !Number.isFinite(difficulty))) {
      throw new Error('Invalid dice modifiers.');
    }
    const request = {
      id: randomUUID(), actionId: this.active.id, actor, label, target, modifier, difficulty, sides,
      geoKey: this.active.geoKey, expiresAt: Date.now() + this.timeoutMs
    };
    if (!player) {
      const result = this.makeResult(request);
      this.publish();
      if (this.animationMs > 0) await new Promise(resolve => setTimeout(resolve, this.animationMs));
      await this.waitUntilResumed();
      return this.active===action ? result : null;
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finish(null), this.timeoutMs);
      timer.unref?.();
      this.pending = { request, resolve, timer };
      this.publish();
    });
  }

  makeResult(request) {
    const natural = this.random(request.sides);
    if (!Number.isInteger(natural) || natural < 1 || natural > request.sides) throw new Error(`Invalid d${request.sides} result.`);
    const result = { ...request, natural, total: natural + request.modifier };
    result.success = request.difficulty === null ? null : result.total >= request.difficulty;
    this.results.set(request.id, result);
    return result;
  }

  submit(id, actionId, geoKey) {
    if (this.paused) throw new Error('Resume the game before rolling.');
    const previous = this.results.get(id);
    if (previous && previous.actionId === actionId && previous.geoKey === geoKey) return previous;
    const request = this.pending?.request;
    if (!request || request.id !== id || request.actionId !== actionId || request.geoKey !== geoKey) {
      throw new Error('This roll is no longer pending.');
    }
    if (Date.now() >= request.expiresAt) {
      this.finish(null);
      throw new Error('This roll expired; the action was not taken.');
    }
    const result = this.makeResult(request);
    this.finish(result);
    return result;
  }

  finish(result) {
    if (!this.pending) return;
    const { timer, resolve } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    this.publish();
    resolve(result);
  }
}

module.exports = { ActionDice, actionDice: new ActionDice() };
