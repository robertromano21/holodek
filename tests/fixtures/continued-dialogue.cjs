'use strict';
const speaker = 'Zyraethis Veilshade';
const passages = [
  'The silence here is not empty,',
  'but a veil stretched thin over secrets best left buried. Since your absence, the echoes have grown louder\u2014whispers of unrest among the dead, shadows shifting where none should move. Something stirs beneath the dust, and the balance you once held falters.',
  'The runes speak of a fracture, a breaking of the old covenant. The guardians watch, but even their vigilance wanes. We must tread carefully, for the path ahead is tangled with betrayal and forgotten debts.',
  'Tell me, what have you seen beyond the veil? What truths have you uncovered in the silence?'
];
const prose = 'The air in the ruined temple hangs heavy with the weight of unspoken histories, the faintest tremor of ancient power stirring beneath the cracked stones. Zyraethis Veilshade\u2019s eyes, sharp and shadowed, flicker with a restless light as she turns toward you, her voice low and edged with urgency.\n\n' +
  `\u201c${passages[0]}\u201d she murmurs, \u201c${passages[1]}\u201d\n\n` +
  `Her gaze narrows, as if searching the shifting gloom for signs unseen. \u201c${passages[2]}\u201d\n\n` +
  `She pauses, the faintest tremor in her voice betraying a flicker of doubt. \u201c${passages[3]}\u201d`;
const speech = passages.join(' ');
module.exports = { speaker, passages, prose, speech };
