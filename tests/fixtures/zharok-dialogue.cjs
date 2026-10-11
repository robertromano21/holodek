'use strict';
const speaker = 'Zharok the Dune Reaper';
const passages = [
  'The sands have whispered many secrets since your passing, Mortacia. The temple\u2019s shadows have deepened, and the ruins have stirred with restless echoes. A faint pulse lingers beneath the shattered stones\u2014an ancient mechanism, waiting for the right voice to awaken it. The silence here is no longer empty; it hums with the promise of reckoning.',
  'I have watched the shifting sands and listened to the faint chant of the winds. The broken oaths here are not yet laid to rest. Something stirs beneath the surface, a shadow of the past reaching toward the future. You have returned at a time when the balance teeters.'
];
const prose = 'The obsidian carapace of Zharok the Dune Reaper shifts subtly as he turns his many-faceted eyes toward you, the faint hum of the temple\u2019s ancient magic mingling with the desert winds outside. His voice, low and gravelly, carries the weight of long years spent in silent vigil.\n\n' +
  `\u201c${passages[0]}\u201d\n\n` +
  `He pauses, his gaze flickering to the cryptic glyphs that twist and invert along the walls. \u201c${passages[1]}\u201d\n\n` +
  'The faint scent of scorched incense drifts through the chamber, mingling with the ozone and the dry desert air, as Zharok\u2019s words hang between you, heavy with portent.';
const speech = passages.join(' ');
const fragment = 'The sands have whispered many secrets since your passing, Mortacia. The temple\u2019s shadows have deepened, and the ruins have stirred with restless echoes.';
module.exports = { speaker, passages, prose, speech, fragment };
