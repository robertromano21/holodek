'use strict';
const Grammar = require('./sidMusicGrammar');
const Theory = require('./sidMusicTheory');
const degrees = Array.from({ length: 12 }, (_, i) => i - 4);
function contourChoices({ values, count, path }) {
  const motif = path.endsWith('.motifContour'), maxRepeats = Math.floor((count - 1) / 2);
  function legal(notes) {
    const gaps = notes.slice(1).map((n, i) => Math.abs(n - notes[i]));
    return notes[0] === 0 && Math.max(...notes) - Math.min(...notes) <= 8 &&
      gaps.every(n => n <= 5) && (!motif || gaps.filter(n => n >= 3).length <= 2 && gaps.filter(n => n === 0).length <= maxRepeats);
  }
  function canComplete(notes) {
    if (!legal(notes) || new Set(notes).size + count - notes.length < 3) return false;
    if (notes.length === count) return new Set(notes).size >= 3;
    return degrees.some(note => canComplete([...notes, note]));
  }
  return (values.length ? degrees : [0]).filter(note => canComplete([...values, note]));
}
function rules() {
  const spec = Theory.planPromptSpec();
  return {
    field(path, source, prior) {
      if (path === '$.ambience.level' || /^\$\.ambience\[\d+\]\.level$/.test(path))
        return { ...source, enum: [.05, .1, .15, .2, .3, .4, .5] };
      if (/^\$\.ambience\[\d+\]\.tag$/.test(path))
        return { ...source, enum: source.enum.filter(tag => !prior.acceptedRows.some(row => row.tag === tag)) };
      if (/^\$\.themes\[\d+\]\.role$/.test(path))
        return { ...source, enum: [spec.suiteForms[prior.suiteForm][prior.nextIndex]] };
      return source;
    },
    arrays: {
      themes: { count: (_root, prior) => spec.suiteForms[prior.suiteForm]?.length ?? 0, max: 3, batch: 1, split: true },
      ambience: { min: 1, max: 3, batch: 1, split: true },
      motifContour: { count: (_root, prior) => prior.motifRhythm.split(',').length, sequence: contourChoices },
      contrastContour: { count: (_root, prior) => prior.contrastRhythm.split(',').length, sequence: contourChoices },
      developmentPath: { min: 3, max: 6, sequence: ({ values }) => spec.developmentTransforms.filter(op => op !== values.at(-1)) },
      rhythmicDevelopment: { min: 2, max: 4, sequence: ({ values, prior }) => Grammar.RHYTHMIC_OPS.filter(op =>
        !values.includes(op) && (op !== 'diminish_repeat' || !prior.motifRhythm.split(',').map(Number).includes(16))) }
    },
    repairFields(message) {
      if (/^\$\.motifContour:/.test(message)) return ['motifContour'];
      if (/^\$\.themes\[\d+\]\.motifContour:/.test(message)) return ['themes'];
      if (/repeats a recent|shared Mortacia motif|rhythmic\/interval cell/i.test(message)) return ['motifRhythm', 'motifContour'];
      const keys = new Set();
      for (const line of message.split('\n')) {
        const field = /^room\.(\w+)/.exec(line)?.[1];
        if (field) keys.add(field);
        else if (/^(reflective|danger|mortacia)\b|^themes\b/.test(line)) keys.add('themes');
        else return undefined;
      }
      return keys.size ? [...keys] : undefined;
    }
  };
}
module.exports = { rules, contourChoices };
