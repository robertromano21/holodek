'use strict';
const { createHash } = require('node:crypto');
function create({ limit = 8 } = {}) {
  const entries = new Map();
  async function run(identity, author) {
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    let entry = entries.get(key);
    if (!entry) {
      // Never evict active work and accidentally launch a duplicate chain.
      if (entries.size >= limit) {
        const idle = [...entries].find(([, value]) => !value.pending);
        if (!idle) throw Error('Local authoring checkpoint capacity is busy.');
        entries.delete(idle[0]);
      }
      entry = { parts: new Map(), pending: null }; entries.set(key, entry);
    }
    if (entry.pending) return entry.pending;
    const pending = Promise.resolve().then(() => author(entry.parts));
    entry.pending = pending;
    try {
      const value = await pending;
      if (value != null) entries.delete(key);
      return value;
    } finally { if (entry.pending === pending) entry.pending = null; }
  }
  return { run };
}
module.exports = { create };
