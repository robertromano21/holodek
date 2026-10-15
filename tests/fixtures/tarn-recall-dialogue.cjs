'use strict';
const rows = [
  { speaker: 'Iven Sootleaf', intro: 'Iven pauses, choosing his words with care.',
    line: 'I remember the keeper\u2019s scroll and the plaque\u2019s marks. I can\u2019t tell you what the temple meant to everyone who passed through it. A record is not the same as a memory.' },
  { speaker: 'Vessa Reedwake', intro: 'Vessa\u2019s gaze rests on the green-stained basalt.',
    line: 'I remember Tarn keeping watch, and your farewell to him. That tells me something about the people there, not the whole temple.' },
  { speaker: 'Orro Flintcup', intro: 'Orro gives a small, gravelly shrug.',
    line: 'Stone, mechanisms, a guardian at the entrance. That\u2019s what I can speak to. The rest would be guesswork.' },
  { speaker: 'Nera Quill', intro: 'Nera keeps one hand on her smoke-stained ledger.',
    line: 'I can\u2019t add to their memories. I keep the words people give me here, and I\u2019m still trying to learn what this graveplate can actually tell us.' }
];
module.exports = { rows, prose: 'Mortacia asks her companions what they remember of the ruined temple.\n\n' +
  rows.map(row => `${row.intro} \u201c${row.line}\u201d`).join('\n\n') };
