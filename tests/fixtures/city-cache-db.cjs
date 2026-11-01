'use strict';
function database() {
  const db = { tables: { rooms: new Map(), inhabitants: new Map() }, writes: [], tail: Promise.resolve(), failNext: false };
  class Store {
    constructor(name, tx) { this.name = name; this.transaction = tx; }
    get(key) {
      const request = {}, tx = this.transaction;
      tx.ops.push(() => { request.result = structuredClone(tx.copy[this.name].get(key)); request.onsuccess?.(); }); return request;
    }
    put(value, key) {
      const copy = structuredClone(value), tx = this.transaction, request = {};
      tx.ops.push(() => { tx.copy[this.name].set(key, copy); tx.writes.push({ store: this.name, key, value: copy }); request.onsuccess?.(); }); return request;
    }
  }
  db.Store = Store;
  db.transaction = function(names, mode) {
    names = Array.isArray(names) ? names : [names];
    const tx = { ops: [], writes: [], aborted: false, abort() { tx.aborted = true; },
      objectStore(name) { if (!names.includes(name)) throw Error('Wrong store.'); return new Store(name, tx); } };
    db.tail = db.tail.then(async () => {
      await new Promise(setImmediate); tx.copy = Object.fromEntries(names.map(name => [name, new Map(db.tables[name])]));
      try {
        for (let i = 0; i < tx.ops.length; i++) { if (tx.aborted) throw Error('transaction aborted'); tx.ops[i](); }
        if (db.failNext || tx.aborted) { db.failNext = false; throw Error('transaction failed'); }
        if (mode === 'readwrite') { for (const name of names) db.tables[name] = tx.copy[name]; db.writes.push(...tx.writes); }
        tx.oncomplete?.();
      } catch (error) { tx.error = error; tx.onabort?.(); }
    });
    return tx;
  };
  return db;
}
module.exports = { database };
