'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/gameSessionUi'), 'utf8');

test('game-window presence closes on pagehide, reconnects on pageshow and never duplicates a live connection', () => {
  const events = {}, streams = [];
  class Source {
    static CLOSED = 2;
    constructor(url) { this.url = url; this.readyState = 0; streams.push(this); }
    close() { this.readyState = Source.CLOSED; }
  }
  const root = { EventSource: Source, addEventListener: (name, callback) => { events[name] = callback; } };
  vm.runInNewContext(source, { window: root });
  assert.equal(streams.length, 1); assert.equal(streams[0].url, '/game/lifecycle/presence');
  events.pageshow(); assert.equal(streams.length, 1);
  events.pagehide(); assert.equal(streams[0].readyState, 2);
  events.pageshow(); assert.equal(streams.length, 2);
  vm.runInNewContext(source, { window: root }); assert.equal(streams.length, 2);
});

test('presence connects before blocking vendor and game scripts to protect slow refreshes', () => {
  const html = fs.readFileSync(require.resolve('../assets/index.html'), 'utf8');
  const presence = html.indexOf('/assets/gameSessionUi.js');
  assert.ok(presence > 0 && presence < html.indexOf('ajax.googleapis.com'));
  assert.ok(presence < html.indexOf('/assets/game.js'));
});
