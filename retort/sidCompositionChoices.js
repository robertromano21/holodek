'use strict';
const { createHash } = require('node:crypto');
const Theory = require('./sidMusicTheory');
const Extended = require('./sid10582');
const enumField = enumValues => ({ type: String, enum: enumValues });
const rhythms = [];
function collect(cell, units) {
  if (units > 16 || cell.length > 9) return;
  if (units === 16) {
    if (cell.length >= 5 && new Set(cell).size > 1) rhythms.push(cell.join(','));
    return;
  }
  for (const d of [4, 8, 16]) collect([...cell, d], units + 16 / d);
}
collect([], 0);
const spec = Theory.planPromptSpec();
const harmony = spec.scales.flatMap(scale => {
  const paths = Object.keys(Theory.PROGRESSIONS).filter(p => Theory.PROGRESSIONS[p].modes.includes(scale));
  return paths.flatMap(a => paths.map(b => [scale, a, b].join('/')));
});
function orchestration(root) {
  return spec.textures.flatMap(texture => [false, true].flatMap(frame =>
    ['none', 'sparse', 'backbeat', 'driving'].flatMap(percussion => {
      if (percussion !== 'none' && (!frame || ['drone', 'sparse'].includes(texture))) return [];
      return (root ? percussion === 'none' ? ['off'] : Extended.TRANSIENTS : [''])
        .map(transients => [texture, percussion, frame ? 'framed' : 'free', ...(root ? [transients] : [])].join('/'));
    })));
}
function rhythmChoices(seed) {
  const rank = value => createHash('sha256').update(seed + '|' + value).digest('hex');
  // Rotate a broad menu, not a replacement tune. The composer supplies every contour.
  return [5, 6, 7, 8, 9].flatMap(count => rhythms.filter(r => r.split(',').length === count)
    .sort((a, b) => rank(a).localeCompare(rank(b))).slice(0, 12));
}
function create(parameters, seed) {
  const bars = rhythmChoices(seed);
  function theme(fields, root) {
    const out = { ...fields, harmony: enumField(harmony), orchestration: enumField(orchestration(root)) };
    for (const key of ['scale', 'progression', 'contrastProgression', 'texture', 'percussion', 'frameArp']) delete out[key];
    for (const key of ['motifRhythm', 'answerRhythm', 'contrastRhythm']) out[key] = enumField(bars);
    return out;
  }
  const out = theme(parameters, true);
  out.extensions = { ...parameters.extensions }; delete out.extensions.transients;
  out.themes = parameters.themes.map(item => ({ ...item, type: theme(item.type, false) }));
  function decodeTheme(value, root) {
    if (!value || typeof value !== 'object') throw Error('A structured theme is required.');
    const p = { ...value };
    // Arrays remain readable for archived plans and existing callers, never repaired.
    if (p.harmony !== undefined) {
      if (!harmony.includes(p.harmony)) throw Error('harmony must be an offered mode/progression/contrast choice.');
      [p.scale, p.progression, p.contrastProgression] = p.harmony.split('/'); delete p.harmony;
    }
    if (p.orchestration !== undefined) {
      if (!orchestration(root).includes(p.orchestration)) throw Error('orchestration must be an offered complete choice.');
      const [texture, percussion, frame, transients] = p.orchestration.split('/');
      Object.assign(p, { texture, percussion, frameArp: frame === 'framed' });
      if (root) p.extensions = { ...p.extensions, transients };
      delete p.orchestration;
    }
    for (const key of ['motifRhythm', 'answerRhythm', 'contrastRhythm']) if (typeof p[key] === 'string') {
      if (!bars.includes(p[key])) throw Error(key + ': choose a complete rhythm from the offered enum.');
      p[key] = p[key].split(',').map(Number);
    }
    if (root && Array.isArray(p.themes)) p.themes = p.themes.map(t => decodeTheme(t, false));
    return p;
  }
  return { parameters: out, bars, decode: p => decodeTheme(p, true) };
}
module.exports = { create, rhythmChoices, harmony, orchestration, rhythms };
