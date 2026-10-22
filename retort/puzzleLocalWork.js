'use strict';
function rules(brief, checkpoint) {
  const mechanic = require('../assets/physicalPuzzles').toolbox().mechanics[brief.kind], ordered = mechanic.ordered;
  return {
    checkpoint,
    isolate: ['context', 'lore', 'backstory', 'text', 'storyLead', 'options', 'initial', 'subject', 'deity'],
    uniqueFields: path => /^\$\.controls\[/.test(path) ? ['id', 'label', 'mark'] : ['name'],
    validatePart(path, value, prior) {
      if (!/^\$\.controls\[/.test(path)) return;
      if (value.label && /^(ash|ember|bone)( seal)?$/i.test(value.label))
        throw Object.assign(Error('label: choose an original, distinguishable control label, not a retired seal label.'), { rejectedAnswer: value, invalidFields: ['label'] });
      if (value.options && new Set(value.options.map(option => option.toLowerCase())).size !== value.options.length)
        throw Object.assign(Error('options: each control position needs a distinct name.'), { rejectedAnswer: value, invalidFields: ['options'] });
      const marks = [...prior.acceptedRows.map(row => row.mark?.toLowerCase()), value.mark?.toLowerCase()];
      if (value.mark && ['ash', 'ember', 'bone'].every(mark => marks.includes(mark)))
        throw Object.assign(Error('mark: do not recreate the retired Ash/Ember/Bone seal puzzle; choose an original symbol.'), { rejectedAnswer: value, invalidFields: ['mark'] });
    },
    field(path, source, prior) {
      if (/\.figures\[\d+\]\.(race|className|patron|sex)$/.test(path) &&
          (require('../assets/shrineIconography').name(prior.subject) || require('../assets/artCharacters').hero(prior.subject)))
        return { ...source, enum: [] };
      if (/^\$\.sculptures\[\d+\]\.(race|className|patron|sex)$/.test(path) && require('../assets/shrineIconography').name(prior.deity))
        return { ...source, enum: [] };
      if (/^\$\.readables\[\d+\]\.clueChapter$/.test(path) && Array.isArray(prior.chapters))
        return { ...source, enum: prior.chapters.map((_chapter, index) => index + 1) };
      if (/^\$\.controls\[\d+\]\.id$/.test(path))
        return { ...source, enum: brief.controls.map(row => row.id).filter(id => !prior.acceptedRows.some(row => row.id === id)) };
      if (/^\$\.controls\[\d+\]\.label$/.test(path))
        return { ...source, pattern: "^[A-Za-z][A-Za-z0-9 '-]* " + mechanic.suffix + '$' };
      if (/^\$\.controls\[\d+\]\.options$/.test(path))
        return { ...source, minItems: mechanic.positions, maxItems: mechanic.positions };
      if (/^\$\.controls\[\d+\]\.(initial|goal)$/.test(path)) {
        const goal = path.endsWith('.goal');
        let values = Array.from({ length: mechanic.positions }, (_, i) => i);
        if (ordered) values = [goal ? 1 : 0];
        else if (goal && prior.nextIndex === brief.controls.length - 1) {
          const previous = prior.acceptedRows;
          if (brief.kind === 'balance') {
            const delta = previous.reduce((n, row) => n + row.initial - row.goal, 0);
            values = values.filter(value => delta + prior.initial - value !== 0);
          } else if (previous.every(row => row.initial === row.goal)) values = values.filter(value => value !== prior.initial);
        }
        return { ...source, enum: values };
      }
      if (/^\$\.roomArt\[\d+\]\.aspectRatio$/.test(path) && prior.kind !== 'fresco' ||
          /^\$\.roomArt\[\d+\]\.(mosaicPattern|mosaicShape)$/.test(path) && prior.kind !== 'mosaic')
        return { ...source, enum: [] }; // Strict optional fields offer only null, not an inapplicable attribute.
      return source;
    },
    order: { count: ordered ? brief.controls.length : 0, max: brief.controls.length,
      sequence: ({ prior, values }) => prior.controls.map(row => row.id).filter(id => !values.includes(id)) }
  };
}
module.exports = { rules };
