'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const config = require('../ecosystem.config.cjs');

test('city expansion activation is explicit and does not change normal launch defaults or models', () => {
  const app = config.apps.find(app => app.name === 'gameServer');
  assert.ok(app);
  assert.equal(app.env, undefined);
  assert.deepEqual(Object.keys(app.env_city_expansion).sort(), [
    'HOLODEK_ARCHITECTURE_EXPANSION', 'HOLODEK_CITY_COMPLETE', 'HOLODEK_CITY_SITES',
    'HOLODEK_GENRE_EXPANSION', 'HOLODEK_TRADE_ROUTES'
  ]);
  assert.ok(Object.values(app.env_city_expansion).every(value => value === '1'));
  assert.equal(app.env_city_expansion.HOLODEK_DEFAULT_MODEL, undefined);
  assert.equal(app.env_city_expansion.HOLODEK_DEV_SANDBOX, undefined);
});
