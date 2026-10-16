'use strict';
// Shared by production speech and auditions; these are driver settings, not identities.
const STYLES = Object.freeze({
  original: Object.freeze({ gain: 1, k: null }),
  continuous: Object.freeze({ gain: 1.03, k: Object.freeze({ smoothLevels: true }) }),
  soft: Object.freeze({ gain: 1.3, k: Object.freeze({ smoothLevels: true, gamH: 1, gamH1: 1, vtF: 2400, vtilt: 2, gapMin: 0, gapMax: 0 }) })
});
const norm = value => typeof value === 'string' && Object.hasOwn(STYLES, value) ? value : null;
function effective(value = 'soft', chip = '10582') {
  if (!norm(value)) throw Error('Unsupported voice style: ' + value);
  return chip === '10582' ? value : 'original';
}
function config(value, chip) { return STYLES[effective(value, chip)]; }
module.exports = { STYLES, norm, effective, config };
