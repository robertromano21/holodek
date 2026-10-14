'use strict';
const speaker = 'Edran Bellworn';
const passages = [
  'I know the name Mortacia. The keepers carved it into this place, and the dead spoke it as the name of the one who judged them. But knowing a name isn\u2019t the same as knowing the person who bears it.',
  'You told me you were driven out of Hades. I believe you had reason to leave. I can\u2019t tell you what happened there; I wasn\u2019t there.',
  'Are you asking whether I recognize you\u2014or whether I still trust what your name means?'
];
const prose = 'Edran\u2019s fingers pause above the names worn into the mosaic. He looks at Mortacia, then at the carved scales beneath his hand, as if the answer ought to be visible there.\n\n' +
  `Edran Bellworn says, \u201c${passages[0]}\u201d His thumb rubs at a faded groove. \u201c${passages[1]}\u201d He meets her gaze again, cautious and searching. \u201c${passages[2]}\u201d`;
const replies = [
  'I know the name Mortacia. The keepers carved it here, but a name is not the person who bears it.',
  'You told me you were driven out of Hades. I wasn\u2019t there; I can\u2019t say what happened.',
  'Are you asking whether I recognize you, or whether I trust what your name means?'
];
module.exports = { speaker, passages, prose, speech: passages.join(' '), replies };
