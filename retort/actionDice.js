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
  }

  snapshot() {
    return {
      type: 'dice_state', epoch: this.epoch, revision: this.revision,
      active: this.active && { id: this.active.id, kind: this.active.kind, geoKey: this.active.geoKey },
      pending: this.pending?.request || null,
      results: [...this.results.values()]
    };
  }

  publish() {
    this.revision++;
    this.active?.broadcast(this.snapshot());
  }

  begin(kind, geoKey, broadcast = () => {}) {
    if (this.active) throw new Error('Another action is still resolving.');
    this.results.clear();
    this.active = { id: randomUUID(), kind, geoKey, broadcast };
    this.publish();
  }

  end() {
    if (!this.active) return;
    if (this.pending) this.finish(null);
    const broadcast = this.active.broadcast;
    this.active = null;
    this.revision++;
    broadcast(this.snapshot());
  }

  async roll({ actor, player = false, label, target = '', modifier = 0, difficulty = null, sides = 20 }) {
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
      return result;
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
