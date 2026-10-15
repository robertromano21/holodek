// sidMusicTheory.js — music-theory post-processor / arranger for the existing SID composer.
// Produces the SAME arrangement JSON the renderer already accepts
// ({bpm,key,scale,voices:[LEAD,BASS,ARP_OR_DRUMS]} with pattern steps {note,octave,duration}).
// The LLM supplies a compact musical plan + motif; this module turns it into a
// coherent 12-bar loop (A / A' / B) with chord-aware melody, bass and arpeggios.
'use strict';
const Grammar = require('./sidMusicGrammar');

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const BPM_ALLOWED = [96,104,112,120,128,136,144];
const MODES = {
  major:      [0,2,4,5,7,9,11],
  lydian:     [0,2,4,6,7,9,11],
  mixolydian: [0,2,4,5,7,9,10],
  dorian:     [0,2,3,5,7,9,10],
  minor:      [0,2,3,5,7,8,10],
  phrygian:   [0,1,3,5,7,8,10],
};
const SCALES = Object.keys(MODES);

// Progressions as scale-degree roots (0 = i). 'V' = major dominant (harmonic-minor colour).
// Each has a 4-bar A progression and a 4-bar B (contrast) progression ending on a dominant/turnaround.
const PROGRESSIONS = {
  epic_aeolian:   { modes:['minor','dorian'],      A:[0,5,2,6],  B:[5,6,3,'V'], label:'i-VI-III-VII (Aeolian epic)' },
  andalusian:     { modes:['minor','phrygian'],    A:[0,6,5,'V'],B:[3,0,5,'V'], label:'i-VII-VI-V Andalusian' },
  dark_cadence:   { modes:['minor','phrygian'],    A:[0,3,0,'V'],B:[5,3,1,'V'], label:'i-iv-i-V (harmonic minor)' },
  phrygian_vamp:  { modes:['phrygian'],            A:[0,1,0,1],  B:[6,5,1,0],   label:'i-bII vamp (Phrygian dread)' },
  dorian_vamp:    { modes:['dorian'],              A:[0,3,0,3],  B:[6,2,3,4],   label:'i-IV Dorian vamp' },
  quest_minor:    { modes:['minor','dorian'],      A:[0,6,5,6],  B:[3,4,5,'V'], label:'i-VII-VI-VII quest' },
  heroic_major:   { modes:['major','mixolydian'],  A:[0,4,5,3],  B:[3,4,0,4],   label:'I-V-vi-IV heroic' },
  tavern_major:   { modes:['major','mixolydian'],  A:[0,3,4,0],  B:[5,3,1,4],   label:'I-IV-V-I folk/jig' },
  mixo_march:     { modes:['mixolydian'],          A:[0,6,3,0],  B:[3,6,0,4],   label:'I-bVII-IV-I Celtic march' },
  lydian_wonder:  { modes:['lydian','major'],      A:[0,1,0,1],  B:[5,1,4,4],   label:'I-II Lydian wonder' },
  stately_minor: { modes:['minor','dorian'],      A:[0,3,6,2],  B:[5,3,4,'V'], label:'i-iv-VII-III (stately minor)' },
  heroic_minor:   { modes:['minor'],               A:[0,5,3,'V'],B:[2,6,5,'V'], label:'i-VI-iv-V (epic minor)' },
  dorian_rise:    { modes:['dorian'],              A:[0,1,3,0],  B:[2,3,6,4],   label:'i-ii-IV-i Dorian rise' },
  phrygian_march: { modes:['phrygian'],            A:[0,1,6,0],  B:[5,6,1,'V'], label:'i-bII-bVII-i Phrygian march' },
  plagal_hymn:    { modes:['major','mixolydian','lydian'], A:[0,3,0,4], B:[5,3,0,4], label:'I-IV-I-V hymn' },
};

// SID patches (renderer-legal values). pwmSpeed is an optional extra the renderers now honour.
const PATCHES = {
  LEAD: {
    hollow_pulse: { waveform:'PULSE', pulseWidth:1024, adsr:{attack:0,decay:9,sustain:10,release:4}, filter:{type:'NONE',cutoff:1024,resonance:0}, pwmSpeed:24, vibrato:1 },
    bright_saw:  { waveform:'SAW',   pulseWidth:0,    adsr:{attack:0,decay:8,sustain:9,release:3},  filter:{type:'LP',cutoff:1280,resonance:8},  pwmSpeed:0, vibrato:1 },
    flute_tri:    { waveform:'TRI',   pulseWidth:0,    adsr:{attack:2,decay:8,sustain:11,release:6}, filter:{type:'NONE',cutoff:1024,resonance:0}, pwmSpeed:0, vibrato:1 },
    bright_pulse: { waveform:'PULSE', pulseWidth:2048, adsr:{attack:0,decay:7,sustain:9,release:3},  filter:{type:'NONE',cutoff:1024,resonance:0}, pwmSpeed:40, vibrato:1 },
    plucked_pulse:{ waveform:'PULSE', pulseWidth:640, adsr:{attack:0,decay:6,sustain:2,release:2}, filter:{type:'NONE',cutoff:1024,resonance:0}, pwmSpeed:8, vibrato:0 },
    reed_saw:    { waveform:'SAW', pulseWidth:0, adsr:{attack:1,decay:9,sustain:8,release:5}, filter:{type:'LP',cutoff:1152,resonance:5}, pwmSpeed:0, vibrato:1 },
    bell_tri:    { waveform:'TRI', pulseWidth:0, adsr:{attack:0,decay:11,sustain:1,release:8}, filter:{type:'NONE',cutoff:1024,resonance:0}, pwmSpeed:0, vibrato:0 },
    nasal_pulse: { waveform:'PULSE',pulseWidth:384,adsr:{attack:0,decay:8,sustain:7,release:3},filter:{type:'NONE',cutoff:1024,resonance:0},pwmSpeed:3,vibrato:1 },
    bowed_saw: { waveform:'SAW',pulseWidth:0,adsr:{attack:4,decay:8,sustain:10,release:6},filter:{type:'LP',cutoff:720,resonance:3},pwmSpeed:0,vibrato:1 },
  },
  BASS: {
    thick_pulse:  { waveform:'PULSE', pulseWidth:1536, adsr:{attack:0,decay:9,sustain:6,release:2},  filter:{type:'LP',cutoff:768,resonance:6},  pwmSpeed:12 },
    round_tri:    { waveform:'TRI',   pulseWidth:0,    adsr:{attack:0,decay:9,sustain:8,release:2},  filter:{type:'NONE',cutoff:768,resonance:0}, pwmSpeed:0 },
    growl_saw:    { waveform:'SAW',   pulseWidth:0,    adsr:{attack:0,decay:8,sustain:5,release:2},  filter:{type:'LP',cutoff:640,resonance:10}, pwmSpeed:0 },
    plucked_tri:  { waveform:'TRI', pulseWidth:0, adsr:{attack:0,decay:7,sustain:2,release:2}, filter:{type:'NONE',cutoff:1024,resonance:0}, pwmSpeed:0 },
    rubber_pulse: {waveform:'PULSE',pulseWidth:512,adsr:{attack:0,decay:5,sustain:1,release:1},filter:{type:'LP',cutoff:896,resonance:5},pwmSpeed:4},
    bowed_bass: {waveform:'SAW',pulseWidth:0,adsr:{attack:3,decay:8,sustain:9,release:5},filter:{type:'LP',cutoff:512,resonance:2},pwmSpeed:0},
  },
  ARP: {
    glass_tri:    { waveform:'TRI',   pulseWidth:0,    adsr:{attack:0,decay:6,sustain:3,release:3},  filter:{type:'NONE',cutoff:1024,resonance:0}, pwmSpeed:0 },
    chip_pulse:   { waveform:'PULSE', pulseWidth:768,  adsr:{attack:0,decay:5,sustain:2,release:2},  filter:{type:'NONE',cutoff:1024,resonance:0}, pwmSpeed:30 },
    soft_pulse:   { waveform:'PULSE', pulseWidth:2048, adsr:{attack:1,decay:6,sustain:4,release:4},  filter:{type:'LP',cutoff:896,resonance:4},  pwmSpeed:16 },
    chime_tri:    { waveform:'TRI', pulseWidth:0, adsr:{attack:0,decay:10,sustain:1,release:7}, filter:{type:'NONE',cutoff:1024,resonance:0}, pwmSpeed:0 },
    muted_pulse: {waveform:'PULSE',pulseWidth:320,adsr:{attack:0,decay:4,sustain:1,release:1},filter:{type:'NONE',cutoff:1024,resonance:0},pwmSpeed:2},
    soft_saw: {waveform:'SAW',pulseWidth:0,adsr:{attack:2,decay:7,sustain:3,release:4},filter:{type:'LP',cutoff:704,resonance:2},pwmSpeed:0},
  },
};
const BASS_STYLES = ['octave_pump','root_fifth','gallop','walking','pedal','lament','ostinato_fourth','syncopated','march','broken_tenths','sustained','tresillo','answering'];
// Mortacia / Sepulchra leitmotif (story theme): tonic, rising 5th, minor-6th sigh, falling back — film-score style
// bold interval + lament. Rhythm: long-short-short, then a held resolution.
const LEITMOTIF = { rhythm:[4,8,8,8,8,4], contour:[0,4,5,4,2,1] };
const ARP_STYLES  = ['up','updown','alberti','broken_octave','rolling','descending','pendulum','offbeat','harp'];

// Mood presets: used when the LLM omits fields; also keyword detection on the description.
const MOODS = {
  sacred:   { scales:['dorian','lydian','major'], bpm:[96,104],     prog:['dorian_vamp','lydian_wonder','epic_aeolian'], lead:['flute_tri','hollow_pulse'], bass:['round_tri'],   arp:['glass_tri','soft_pulse'], bassStyle:['pedal','root_fifth'], arpStyle:['updown','rolling'] },
  tavern:   { scales:['major','mixolydian'],       bpm:[128,136,144],prog:['tavern_major','mixo_march','heroic_major'], lead:['bright_pulse','flute_tri'], bass:['thick_pulse','round_tri'], arp:['chip_pulse'], bassStyle:['walking','octave_pump'], arpStyle:['alberti','up'] },
  dread:    { scales:['phrygian','minor'],         bpm:[96,104,112], prog:['phrygian_vamp','dark_cadence','andalusian'], lead:['bright_saw','hollow_pulse'], bass:['growl_saw','thick_pulse'], arp:['soft_pulse','glass_tri'], bassStyle:['pedal','root_fifth'], arpStyle:['broken_octave','updown'] },
  mystic:   { scales:['dorian','lydian'],          bpm:[104,112],    prog:['lydian_wonder','dorian_vamp','quest_minor'], lead:['flute_tri','hollow_pulse'], bass:['round_tri'], arp:['glass_tri'], bassStyle:['pedal','root_fifth'], arpStyle:['rolling','updown'] },
  battle:   { scales:['minor','phrygian'],         bpm:[136,144],    prog:['andalusian','dark_cadence','quest_minor'], lead:['bright_saw','bright_pulse'], bass:['thick_pulse','growl_saw'], arp:['chip_pulse'], bassStyle:['gallop','octave_pump'], arpStyle:['up','broken_octave'] },
  adventure:{ scales:['dorian','minor','mixolydian'], bpm:[112,120,128], prog:['epic_aeolian','quest_minor','mixo_march'], lead:['hollow_pulse','bright_pulse'], bass:['thick_pulse'], arp:['chip_pulse','glass_tri'], bassStyle:['octave_pump','root_fifth','gallop'], arpStyle:['up','alberti'] },
  royal:    { scales:['major','mixolydian'],       bpm:[104,112,120],prog:['heroic_major','mixo_march'], lead:['bright_pulse','bright_saw'], bass:['thick_pulse'], arp:['chip_pulse','soft_pulse'], bassStyle:['root_fifth','walking'], arpStyle:['alberti','updown'] },
  melancholy:{scales:['minor','dorian'],           bpm:[96,104],     prog:['epic_aeolian','andalusian'], lead:['flute_tri','hollow_pulse'], bass:['round_tri'], arp:['soft_pulse','glass_tri'], bassStyle:['root_fifth','pedal'], arpStyle:['rolling','updown'] },
  underworld:{ scales:['minor','phrygian','dorian'], bpm:[96,104,112], prog:['epic_aeolian','andalusian','quest_minor'], lead:['hollow_pulse','bright_saw'], bass:['thick_pulse','growl_saw'], arp:['soft_pulse','glass_tri'], bassStyle:['pedal','lament','ostinato_fourth'], arpStyle:['broken_octave','rolling'] },
  heroic:   { scales:['dorian','minor'],             bpm:[112,120,128], prog:['quest_minor','epic_aeolian','dorian_vamp'], lead:['bright_saw','bright_pulse'], bass:['thick_pulse'], arp:['chip_pulse'], bassStyle:['gallop','octave_pump','ostinato_fourth'], arpStyle:['up','broken_octave'] },
  throne:   { scales:['minor','dorian'],             bpm:[96,104,112], prog:['epic_aeolian','dark_cadence','andalusian'], lead:['bright_saw','hollow_pulse'], bass:['thick_pulse','growl_saw'], arp:['soft_pulse','chip_pulse'], bassStyle:['lament','root_fifth'], arpStyle:['updown','alberti'] },
  nature:   { scales:['dorian','mixolydian','lydian'], bpm:[112,120], prog:['dorian_vamp','mixo_march','lydian_wonder'], lead:['flute_tri'], bass:['round_tri','thick_pulse'], arp:['glass_tri','chip_pulse'], bassStyle:['root_fifth','walking'], arpStyle:['alberti','rolling'] },
};
const MOOD_KEYWORDS = [
  ['throne',   /\b(hades|throne of (the )?dead|sepulchra|mortacia|arithus|judg(e|ment) of the dead)/i],
  ['battle',   /\b(boss|battle|war|horde|army|arena|fight|demon|dragon|blood|siege|rage|warlord|orc)/i],
  ['underworld', /\b(tartarus|wasteland|sandstorm|yellowish sky|underworld|afterlife|river styx|styx|ruined temple)/i],
  ['dread',    /\b(crypt|tomb|undead|skelet|grave|necro|lich|ghoul|bones?|corpse|torture|abyss|tartarus|hell|shadow|darkness|cursed|sewer|pit)/i],
  ['tavern',   /\b(tavern|inn|ale|feast|market|bard|merry|festival|kitchen|bazaar)/i],
  ['royal',    /\b(throne|king|queen|royal|palace|court|crown|banner|hall of)/i],
  ['sacred',   /\b(temple|shrine|chapel|altar|holy|sanct|cathedral|priest|god|goddess|divine|choir)/i],
  ['mystic',   /\b(magic|arcane|crystal|wizard|library|tower|star|portal|rune|enchant|fae|fairy|dream)/i],
  ['nature',   /\b(forest|grove|garden|meadow|river|tree|woods|glade|field|spring)/i],
  ['melancholy',/\b(ruin|sorrow|lost|abandon|rain|lament|weep|forgotten|grief|mourn|sea|cave|tide|grotto|drown)/i],
];

// ---------- seeded RNG ----------
function hash32(str) { let h = 0x811c9dc5; for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193)>>>0; } return h>>>0; }
function rng(seed) { let s = (seed>>>0) || 1; return () => { s ^= s<<13; s>>>=0; s ^= s>>>17; s ^= s<<5; s>>>=0; return s/4294967296; }; }
const pick = (r, arr) => arr[Math.floor(r()*arr.length)];

function detectMood(text) {
  for (const [m, re] of MOOD_KEYWORDS) if (re.test(text||'')) return m;
  return 'adventure';
}

// ---------- pitch helpers ----------
function scalePcs(key, scale) { const t = NOTES.indexOf(key); return MODES[scale].map(d => (t+d)%12); }
// chord for a progression degree: triad stacked in thirds from the mode; 'V' = major dominant.
function chordFor(deg, key, scale) {
  const t = NOTES.indexOf(key), m = MODES[scale];
  if (deg === 'I+') { return { root:t, pcs:[t,(t+4)%12,(t+7)%12], degLabel:'I+' }; } // Picardy third
  if (deg === 'V') { const r = (t+7)%12; return { root:r, pcs:[r,(r+4)%12,(r+7)%12], degLabel:'V' }; }
  const pcs = [0,2,4].map(k => (t + m[(deg+k)%7] + (deg+k>=7?12:0))%12);
  // keep fifth perfect when the mode yields a diminished one (more SID-idiomatic power chords)
  if ((pcs[2]-pcs[0]+12)%12 === 6) pcs[2] = (pcs[0]+7)%12;
  return { root:pcs[0], pcs, degLabel:String(deg) };
}
function midiToStep(midi, duration) { midi = Math.max(36, Math.min(83, midi)); return { note: NOTES[midi%12], octave: Math.floor(midi/12)-1, duration }; }
const REST = d => ({ note:'REST', octave:0, duration:d });
function nearestPc(midi, pcs) { let best=midi, bd=99; for (let d=-6; d<=6; d++){ const m=midi+d; if (pcs.includes(((m%12)+12)%12) && Math.abs(d)<bd){ bd=Math.abs(d); best=m; } } return best; }
function inRange(midi, lo, hi) { while (midi < lo) midi += 12; while (midi > hi) midi -= 12; return midi; }

// ---------- rhythm ----------
// durations in sixteenths units: 16->1, 8->2, 4->4
const U = { 16:1, 8:2, 4:4, 2:8, 1:16 };
const PHRASE_FORMS = Object.keys(Grammar.FORMS);
const TEXTURES = ['arpeggios','counterpoint','drone','sparse'];
const DEVELOPMENT_TRANSFORMS = ['transpose_up','transpose_down','invert','retrograde','fragment_sequence','tail_answer'];
const ARRANGEMENT_ARCS = {
  gradual_reveal:['thin','thin','full','full','counterpoint','crest','full','thin'],
  ebb_and_flow:['full','thin','counterpoint','full','thin','crest','full','thin'],
  long_journey:['full','counterpoint','crest','thin','full','counterpoint','crest','thin']
};
const SUITE_FORMS = {
  single_theme: [], room_reflection: ['reflective'], room_threat: ['danger'],
  reflection_threat: ['reflective','danger'], threat_reflection: ['danger','reflective'],
  pilgrimage: ['reflective','mortacia']
};
const RHYTHM_BANK = [
  [8,8,4,8,8,4].map(Number),          // tum-tum TAA x2
  [4,8,8,4,4],
  [8,16,16,8,8,4,4],                  // skipping
  [4,4,8,8,4],
  [8,8,8,8,4,4],
  [16,16,8,4,8,8,4],
  [4,8,16,16,4,4],
  [8,4,8,4,4],                        // syncopated
];
function developContour(contour, operation, count, step) {
  if(!DEVELOPMENT_TRANSFORMS.includes(operation))throw Error('Unknown motif development operation.');
  const base=contour.map(n=>n-contour[0]);
  const shape=operation==='invert'?base.map(n=>-n):operation==='retrograde'?[...base].reverse():
    operation==='tail_answer'?base.slice(-Math.max(3,Math.ceil(base.length/2))):
    operation==='fragment_sequence'?base.slice(0,Math.max(3,Math.ceil(base.length/2))):base;
  return Array.from({length:count},(_,i)=>shape[i%shape.length]+(operation==='transpose_up'?Math.abs(step):operation==='transpose_down'?-Math.abs(step):
    operation==='fragment_sequence'?Math.floor(i/shape.length)*step:0));
}
function rhythmUnits(r) { return r.reduce((a,d)=>a+(U[d]||2),0); }
function fixRhythm(r) {
  let out = (Array.isArray(r)?r:[]).map(Number).filter(d=>U[d]);
  // trim / pad to exactly one bar (16 units)
  let tot = 0; const res = [];
  for (const d of out) { if (tot + U[d] > 16) break; res.push(d); tot += U[d]; }
  while (tot < 16) { const left = 16-tot; const d = left>=4?4:left>=2?8:16; res.push(d); tot += U[d]; }
  return res.length >= 3 ? res : null;
}

// ---------- melody ----------
// motif contour: array of scale-step offsets (relative, one per note); LLM-provided or seeded.
function seededContour(r, n) {
  const shapes = [[0,2,4,7,6,4,5,4],[0,1,0,1,3,2,1,0],[0,3,4,3,2,1,2,0],[0,1,2,1,0,-1,0,2],[0,2,1,3,2,1,0,-1],[0,-1,0,2,4,3,2,1],[0,0,2,1,-1,0,1,2],[4,3,2,1,2,0,1,-1],[0,2,4,3,1,2,0,0]];
  const s = pick(r, shapes); const out=[]; for (let i=0;i<n;i++) out.push(s[i%s.length]);
  return out;
}

function buildLead(ctx) {
  const { r, key, scale, barsChords, motifR, motifC, answerR } = ctx;
  const sc = scalePcs(key, scale);
  const tonicMidi = inRange(60 + NOTES.indexOf(key), 62, 73);
  const steps = [];
  const LO = 60, HI = 81;
  // scale-step walker
  function degMidi(base, stepsUp) { // move stepsUp scale steps from base midi (base snapped to scale)
    let m = nearestPc(base, sc); let k = stepsUp;
    while (k>0){ m++; while(!sc.includes(m%12)) m++; k--; }
    while (k<0){ m--; while(!sc.includes(((m%12)+12)%12)) m--; k++; }
    return m;
  }
  function renderBar(barIdx, rhythm, contour, anchor, opts={}) {
    const ch = barsChords[barIdx];
    const chordPcs = ch.pcs;
    const allowed = Array.from(new Set(sc.concat(chordPcs)));
    let pos = 0; const out = [];
    rhythm.forEach((d, i) => {
      let m = degMidi(anchor, contour[i % contour.length] + (opts.shift||0));
      const strong = (pos % 8 === 0) || U[d] >= 4;     // beat 1/3 or long note -> chord tone
      const raw = m;
      if (strong) m = nearestPc(m, chordPcs);
      else if (!allowed.includes(((m%12)+12)%12)) m = nearestPc(m, allowed);
      m = inRange(m, LO, HI);
      // keep the motif's contour: if snapping flattened a step into a repeated note, move to the
      // next chord/scale tone in the intended direction
      if (out.length && m === out[out.length-1].midi && i > 0 && contour[i % contour.length] !== contour[(i-1) % contour.length]) {
        const dir = contour[i % contour.length] > contour[(i-1) % contour.length] ? 1 : -1;
        const pool = strong ? chordPcs : sc;
        let k = m + dir; while (!pool.includes(((k%12)+12)%12)) k += dir;
        m = inRange(k, LO, HI);
      }
      out.push({ midi:m, d });
      pos += U[d];
    });
    // breathing: optional rest replaces a weak short note
    if (opts.breath && out.length > 4) { const k = out.length - 2; if (out[k].d !== 4) out[k].rest = true; }
    // cadence: last note -> target pitch class, lengthened
    if (opts.endPc != null) {
      const last = out[out.length-1]; last.midi = inRange(nearestPc(last.midi, [opts.endPc]), LO, HI);
    }
    // smooth leaps > 7 semitones by octave folding toward previous
    for (let i=1;i<out.length;i++){ const a=out[i-1].midi; let b=out[i].midi; while (b-a>7 && b-12>=LO) b-=12; while (a-b>7 && b+12<=HI) b+=12; out[i].midi=b; }
    out.forEach((n,i) => steps.push(n.rest || opts.rests?.[i] ? REST(n.d) : midiToStep(n.midi, n.d)));
    return out[out.length-1].midi;
  }
  const tonicPc = NOTES.indexOf(key), fifthPc = (tonicPc+7)%12;
  if (ctx.compositionVersion === 3) {
    const statement = { rhythm:motifR, contour:motifC }, answer = { rhythm:answerR, contour:ctx.answerC },
      contrast = { rhythm:ctx.bR, contour:ctx.bC };
    const phrases = ctx.phraseCells || {
      sentence: [statement,statement,answer,answer,statement,statement,answer,answer,contrast,contrast,contrast,answer],
      period: [statement,answer,statement,answer,contrast,answer,statement,answer,contrast,contrast,statement,answer],
      arch: [statement,statement,answer,answer,contrast,contrast,contrast,answer,statement,statement,answer,answer],
      call_response: [statement,null,answer,null,statement,null,answer,answer,contrast,null,contrast,answer],
      ostinato: [statement,statement,statement,answer,statement,statement,contrast,answer,contrast,contrast,statement,answer]
    }[ctx.phraseForm];
    const anchor = tonicMidi + (ctx.startHigh ? 4 : 0);
    phrases.forEach((phrase,i) => {
      if (!phrase) { steps.push(REST(1)); return; }
      if (i===(ctx.quoteIndex??8) && ctx.leitmotif==='quote') {
        renderBar(i,LEITMOTIF.rhythm,LEITMOTIF.contour,anchor); return;
      }
      if (i===(ctx.quoteIndex??8) && ctx.leitmotif==='vary') {
        renderBar(i,LEITMOTIF.rhythm,motifC,anchor); return;
      }
      renderBar(i,phrase.rhythm,phrase.contour,anchor+(phrase===contrast?5:0),{
        shift: i===1||i===5?ctx.seqStep:0, breath:i===6, rests:phrase.rests,
        ...(ctx.phraseCells ? ctx.cadences[i] || {} : i===3?{endPc:fifthPc}:i===7?{endPc:tonicPc}:i===11?{endPc:barsChords[11].pcs[1]}:{})
      });
    });
    return steps;
  }
  const B = [];
  // Phrase A (bars 0-3): statement, sequence, statement varied, answer -> half cadence (5th)
  let a0 = tonicMidi + (ctx.startHigh ? 4 : 0);
  renderBar(0, motifR, motifC, a0);
  renderBar(1, motifR, motifC, a0, { shift: ctx.seqStep });          // sequence
  renderBar(2, motifR, motifC.map(x=>-x), a0 + 2, { breath:true });  // inversion
  renderBar(3, answerR, [0,-1,-2,-1], a0 + 2, { endPc: fifthPc });
  // Phrase A' (bars 4-7): repeat with cadence on tonic
  renderBar(4, motifR, motifC, a0);
  renderBar(5, motifR, motifC, a0, { shift: ctx.seqStep });
  renderBar(6, ctx.varR, motifC, a0 + 3, { breath:true });
  renderBar(7, answerR, [2,1,0,-1], a0, { endPc: tonicPc });
  // Phrase B (bars 8-11): contrast — higher register, rhythmic diminution, climb, dominant turnaround
  const bAnchor = a0 + 5;
  if (ctx.leitmotif === 'quote' || ctx.leitmotif === 'main') {
    // B opens with the Mortacia/Sepulchra theme, stated then sequenced down a step
    renderBar(8, LEITMOTIF.rhythm, LEITMOTIF.contour, a0);
    renderBar(9, LEITMOTIF.rhythm, LEITMOTIF.contour, a0, { shift: -1 });
  } else if (ctx.leitmotif === 'vary') {
    renderBar(8, LEITMOTIF.rhythm, ctx.motifC, bAnchor);   // leitmotif rhythm, room's own contour
    renderBar(9, ctx.bR, ctx.bC, bAnchor, { shift: -1 });
  } else {
    renderBar(8, ctx.bR, ctx.bC, bAnchor);
    renderBar(9, ctx.bR, ctx.bC, bAnchor, { shift: -1 });
  }
  renderBar(10, ctx.bR, ctx.bC.map(x=>x+1), bAnchor + 2);
  const lastCh = barsChords[11];
  renderBar(11, answerR, [1,0,-1,0], bAnchor, { endPc: lastCh.pcs.includes((tonicPc+11)%12) ? (tonicPc+11)%12 : lastCh.pcs[1] });
  return ensureMinSteps(steps);
}
// renderer needs >=64 steps per voice: split quarter notes into repeated eighths if short
function ensureMinSteps(steps, min = 0) { // pattern/order player has no 64-step minimum any more
  let guard = 0;
  while (steps.length < min && guard++ < 200) {
    let i = -1; for (let k = steps.length-1; k >= 0; k--) if (steps[k].duration === 4) { i = k; break; }
    if (i < 0) break;
    steps.splice(i, 1, { ...steps[i], duration:8 }, { ...steps[i], duration:8 });
  }
  return steps;
}

function buildBass(barsChords, style, r, sc) {
  const steps = [];
  barsChords.forEach((ch, i) => {
    const next = barsChords[(i+1)%barsChords.length];
    const R = inRange(36 + ch.root, 36, 47), F = R + 7, O = R + 12, T = nearestPc(R+3, ch.pcs);
    const nextR = inRange(36 + next.root, 36, 47);
    const approach = nextR + (nextR > R ? -1 : 1) * (Math.abs(nextR-R) > 2 ? 2 : 1);
    let bar;
    switch (style) {
      case 'octave_pump': bar = [R,O,R,O,R,O,R,O].map(m=>[m,8]); break;
      case 'gallop':      bar = [[R,8],[R,16],[R,16],[O,8],[R,16],[R,16],[R,8],[R,16],[R,16],[F,8],[O,8]]; break;
      case 'walking':     bar = [[R,4],[T,4],[F,4],[approach,4]]; break;
      case 'lament': { // lament-style stepwise descending bass toward the next chord
        const down = k => { let m = R; for (let j=0;j<k;j++){ m--; while(!sc.includes(((m%12)+12)%12)) m--; } return m < 33 ? m+12 : m; };
        bar = [[R,8],[O,8],[down(1),8],[down(1)+12,8],[down(2),8],[down(2)+12,8],[R,8],[approach,8]]; break; }
      case 'ostinato_fourth': { const Q = R + 5; // stately root / fourth ostinato
        bar = [[R,8],[Q,8],[R,8],[Q,8],[R,8],[Q,8],[F,8],[O,8]]; break; }
      case 'pedal':       bar = [[R,4],[R,8],[F,8],[R,4],[i%2?O:F,4]]; break;
      default:            bar = [[R,8],[R,8],[F,8],[R,8],[O,8],[R,8],[F,8],[approach,8]]; // root_fifth
    }
    bar.forEach(([m,d]) => steps.push(midiToStep(m, d)));
  });
  return ensureMinSteps(steps);
}

function buildArp(barsChords, style, r, fullBars, frameArp, drums) {
  const steps = [];
  if (frameArp) {
    // classic C64 "chord" voice: one note per eighth, cycled per frame (50 Hz) through the triad
    // by the player (step.chord = semitone offsets). Old players ignore .chord and play the root.
    barsChords.forEach((ch, i) => {
      const R = inRange(48 + ch.root, 52, 63);
      const third = (ch.pcs[1] - ch.pcs[0] + 12) % 12, fifth = (ch.pcs[2] - ch.pcs[0] + 12) % 12;
      const driving = drums === 'driving';
      const rhythm = driving ? Array(16).fill(16) : (i % 4 === 3) ? [8,8,8,8,4,8,8] : [8,8,8,8,8,8,8,8];
      rhythm.forEach((d, k) => {
        // classic SID drums interleaved in the chord voice: noise snare on beats 2 and 4
        if (drums && (driving ? k===4||k===12||i%4===3&&k===15 : d===8&&(k===2||k===6))) steps.push({ note:'C', octave:5, duration:d, wave:'NOISE' });
        else steps.push({ ...midiToStep(R, d), chord:[0, third, fifth] });
      });
    });
    return steps;
  }
  barsChords.forEach((ch, i) => {
    const R = inRange(48 + ch.root, 50, 61);
    const tones = [R, nearestPc(R+3, ch.pcs), nearestPc(R+7, ch.pcs), R+12].sort((a,b)=>a-b);
    let seq;
    switch (style) {
      case 'updown':        seq = [0,1,2,3,2,1,0,1,2,3,2,1,0,1,2,1]; break;
      case 'alberti':       seq = [0,2,1,2,0,2,1,2,0,2,1,2,0,2,1,3]; break;
      case 'broken_octave': seq = [0,3,1,3,2,3,1,3,0,3,1,3,2,3,1,2]; break;
      case 'rolling':       seq = [0,1,2,3,0,1,2,3,1,2,3,2,0,1,2,3]; break;
      default:              seq = [0,1,2,3,0,1,2,3,0,1,2,3,0,1,2,3];
    }
    const sparse = !fullBars.includes(i);  // thinner in phrase A intro for build-up
    if (sparse) { for (let k=0;k<8;k++) steps.push(midiToStep(tones[seq[k*2]], 8)); }
    else seq.forEach(k => steps.push(midiToStep(tones[k], 16)));
  });
  return steps;
}

// ---------- validator / metrics ----------
function expandVoice(v) { return v.order ? v.order.flatMap(i => v.patterns[i]) : (v.pattern || []); }
function analyze(song) {
  const lead = expandVoice(song.voices[0]), sc = scalePcs(song.key, song.scale);
  let inScale=0, n=0, steps=0, leaps=0, prev=null; const pcs = new Set();
  for (const s of lead) { if (s.cmd || s.note==='REST') continue; const pc=NOTES.indexOf(s.note); n++; if (sc.includes(pc)) inScale++; pcs.add(pc);
    const m = 12*(s.octave+1)+pc; if (prev!=null){ const iv=Math.abs(m-prev); if (iv<=2) steps++; if (iv>7) leaps++; } prev=m; }
  const dur = v => expandVoice(v).filter(st=>!st.cmd).reduce((a,s)=>a+(U[s.duration]||2),0);
  return { leadNotes:n, scaleRatio:+(inScale/n).toFixed(2), stepwiseRatio:+(steps/Math.max(1,n-1)).toFixed(2), bigLeaps:leaps, distinctPitchClasses:pcs.size,
           voiceLengths16ths: song.voices.map(dur), stepCounts: song.voices.map(v=>expandVoice(v).length), uniquePatterns: song.voices.map(v=>v.patterns ? v.patterns.length : 0) };
}

// ---------- main: plan -> arrangement ----------
function normalizePlan(plan, description, seedStr) {
  const r = rng(hash32(seedStr || description || 'room'));
  const p = { ...(plan||{}) };
  const mood = MOODS[p.mood] ? p.mood : detectMood(description);
  const M = MOODS[mood];
  p.mood = mood;
  p.scale = SCALES.includes(String(p.scale).toLowerCase()) ? String(p.scale).toLowerCase() : pick(r, M.scales);
  // Phrygian is reserved for dread/underworld/battle; royal/sacred/tavern/nature/throne rooms get their own colours.
  const kwMood = detectMood(description);
  if (p.compositionVersion!==3 && p.scale === 'phrygian' && (!['dread','underworld','battle'].includes(mood) || ['royal','throne','sacred','tavern','nature'].includes(kwMood))) p.scale = pick(r, M.scales.filter(x=>x!=='phrygian'));
  const minorish = ['minor','dorian','phrygian'].includes(p.scale);
  p.picardy = minorish && (p.picardy === true || ((mood==='throne'||mood==='sacred'||mood==='heroic') && p.picardy !== false));
  p.leitmotif = ['main','quote','vary','none'].includes(p.leitmotif) ? p.leitmotif : (mood==='throne' ? 'main' : (['underworld','heroic','sacred'].includes(mood) ? 'quote' : (r() < 0.35 ? 'vary' : 'none')));
  // the full theme is reserved for Mortacia / Sepulchra / Hades rooms; elsewhere it is only quoted
  if (p.leitmotif === 'main' && kwMood !== 'throne') p.leitmotif = 'quote';
  p.frameArp = typeof p.frameArp === 'boolean' ? p.frameArp : (['battle','heroic','throne','underworld','adventure','dread'].includes(mood) && r() < 0.6);
  // v2 seed diversity stays intact; validated v3 author choices are honored exactly.
  const seededKey = pick(r, NOTES);
  p.key = (NOTES.includes(String(p.key).toUpperCase()) && (p.compositionVersion===3 || r() < 0.33)) ? String(p.key).toUpperCase() : seededKey;
  // v2 uses mood bands; v3 already validates the full supported tempo set.
  p.bpm = (p.compositionVersion===3?BPM_ALLOWED.includes(Number(p.bpm)):M.bpm.includes(Number(p.bpm)) && r() < 0.6) ? Number(p.bpm) : pick(r, M.bpm);
  const progOk = PROGRESSIONS[p.progression] && PROGRESSIONS[p.progression].modes.includes(p.scale) && (p.compositionVersion===3 || r() < 0.6);
  if (!progOk) { const cands = Object.keys(PROGRESSIONS).filter(k => PROGRESSIONS[k].modes.includes(p.scale)); const pref = M.prog.filter(k=>cands.includes(k)); p.progression = pick(r, pref.length?pref:cands); }
  p.leadPatch = PATCHES.LEAD[p.leadPatch] ? p.leadPatch : pick(r, M.lead);
  p.bassPatch = PATCHES.BASS[p.bassPatch] ? p.bassPatch : pick(r, M.bass);
  p.arpPatch  = PATCHES.ARP[p.arpPatch]   ? p.arpPatch  : pick(r, M.arp);
  p.bassStyle = BASS_STYLES.includes(p.bassStyle) ? p.bassStyle : pick(r, M.bassStyle);
  p.arpStyle  = ARP_STYLES.includes(p.arpStyle) ? p.arpStyle : pick(r, M.arpStyle);
  // motif rhythm must be distinctive: >=5 notes and >=2 different note lengths, else use a seeded idiomatic rhythm
  let mr = fixRhythm(p.motifRhythm);
  if (!mr || mr.length < 5 || new Set(mr).size < 2) mr = pick(r, RHYTHM_BANK).slice();
  p.motifRhythm = mr;
  if (p.leitmotif === 'main' && p.compositionVersion!==3) { p.motifRhythm = LEITMOTIF.rhythm.slice(); p.motifContour = LEITMOTIF.contour.slice(); }
  const n = p.motifRhythm.length;
  const c = Array.isArray(p.motifContour) ? p.motifContour.map(x=>Math.max(-5,Math.min(7,Math.round(Number(x)||0)))) : [];
  // keep LLM contour if it has shape (a leap or >=3 distinct steps); extend it to the rhythm length
  const shaped = c.length >= 3 && (new Set(c).size >= 3 || c.some(x=>Math.abs(x)>=3));
  const base = p.leitmotif === 'main' && p.compositionVersion!==3 ? LEITMOTIF.contour : (shaped ? c : seededContour(r, n));
  p.motifContour = Array.from({length:n}, (_,i) => i < base.length ? base[i] : base[i % base.length] + (i >= base.length ? 1 : 0));
  p.title = String(p.title || 'Room Theme').slice(0, 31);
  return { p, r };
}

// split a flat voice line into 4/4 bars (16 sixteenth units each)
function toBars(steps) {
  const bars = []; let cur = [], u = 0;
  steps = steps.filter(st => !st.cmd);
  for (const st of steps) { cur.push(st); u += U[st.duration] || 2; if (u >= 16) { bars.push(cur); cur = []; u = 0; } }
  if (cur.length) { while (u < 16) { const d = 16-u >= 4 ? 4 : 16-u >= 2 ? 8 : 16; cur.push(REST(d)); u += U[d]; } bars.push(cur); }
  return bars;
}
const stepMidi = st => st.note === 'REST' ? null : 12*(st.octave+1) + NOTES.indexOf(st.note);
function octaveUp(bar) { const ms = bar.map(stepMidi).filter(m=>m!=null); if (!ms.length || Math.max(...ms)+12 > 83) return bar;
  return bar.map(st => st.note==='REST' ? st : { ...midiToStep(stepMidi(st)+12, st.duration) }); }
function ornament(bar, sc) { // baroque turn: first quarter -> 8th + upper-neighbour 16th + note 16th
  const i = bar.findIndex(st => st.duration === 4 && st.note !== 'REST'); if (i < 0) return bar;
  const m = stepMidi(bar[i]); let up = m+1; while (!sc.includes(up%12)) up++;
  return [...bar.slice(0,i), midiToStep(m,8), midiToStep(up,16), midiToStep(m,16), ...bar.slice(i+1)]; }
function sparseLead(bar) { // intro/coda: keep only long notes, rest elsewhere
  return bar.map(st => (st.duration === 4 ? st : REST(st.duration))); }
function chantBar(ch, idx) { // martial modal chant: four quarter notes on chord tones, stepwise
  const R = inRange(60 + ch.root, 60, 71); const t = [R, nearestPc(R+3, ch.pcs), nearestPc(R+7, ch.pcs)];
  const shapes = [[0,1,2,1],[2,1,0,1],[0,0,1,2],[1,2,1,0]]; return shapes[idx%4].map(k => midiToStep(t[k], 4)); }

// Build one 12-bar cycle (A, A', B) with the room's material; opts vary it for development.
function buildCycle(p, r, prog, opts = {}) {
  if(p.performance){
    const groups=Grammar.layout(p),cells=groups.flatMap(g=>g.cells),chords=[],cadences={};
    const source={S:{rhythm:p.motifRhythm,contour:p.motifContour,rests:p.motifRests},
      A:{rhythm:p.answerRhythm,contour:p.answerContour},C:{rhythm:p.contrastRhythm,contour:p.contrastContour}};
    for(const group of groups){
      const path=group.part==='B'?prog.B:prog.A;
      group.cells.forEach((_,i)=>chords.push(chordFor(path[(p.performance.harmonicRhythm==='two_bars'?Math.floor(i/2):i)%path.length],p.key,p.scale)));
      const end=chords.length-1,last=end===cells.length-1;
      chords[end]=chordFor(last||group.part==='B'?0:['major','lydian','mixolydian'].includes(p.scale)?4:'V',p.key,p.scale);
      if(last&&p.picardy)chords[end]=chordFor('I+',p.key,p.scale);
      cadences[end]={endPc:chords[end].root};
    }
    const lead=buildLead({compositionVersion:3,phraseCells:cells.map(c=>source[c]||null),cadences,quoteIndex:-1,
      leitmotif:p.leitmotif,r,key:p.key,scale:p.scale,barsChords:chords,motifR:p.motifRhythm,motifC:p.motifContour,
      answerR:p.answerRhythm,answerC:p.answerContour,bR:p.contrastRhythm,bC:p.contrastContour,
      seqStep:opts.seqStep??p.sequenceStep,startHigh:!!opts.startHigh});
    return{chords,lead:toBars(lead)};
  }
  const degs = [...prog.A, ...prog.A.slice(0,2), ...(p.scale==='major'||p.scale==='mixolydian'||p.scale==='lydian' ? [4,0] : ['V',0]), ...(opts.bProg || prog.B)];
  if (p.picardy && !opts.noPicardy) degs[7] = 'I+';
  if (p.compositionVersion===3 && p.phraseForm!=='ostinato') degs[3]=['major','mixolydian','lydian'].includes(p.scale)?4:'V';
  const chords = degs.map(d => chordFor(d, p.key, p.scale));
  const authored = p.compositionVersion === 3;
  const answerR = authored?p.answerRhythm:fixRhythm([p.motifRhythm[0], p.motifRhythm[1] || 8, 4, 4, 4]) || [8,8,4,4,4];
  const bR = authored?p.contrastRhythm:opts.bR || pick(r, [[8,8,8,8,8,8,4],[16,16,8,8,8,4,4],[8,16,16,8,8,8,8,4]]).slice();
  const bC = authored?p.contrastContour:p.motifContour.map((x,i)=> (i%2? -x : x) ).concat([1,2]);
  const lead = buildLead({ compositionVersion:p.compositionVersion, phraseForm:p.phraseForm, answerC:p.answerContour,
    leitmotif: opts.leitmotif || p.leitmotif, r, key:p.key, scale:p.scale, barsChords:chords, motifR:p.motifRhythm, motifC:p.motifContour,
    answerR, bR, bC, varR: opts.varR || pick(r, RHYTHM_BANK), seqStep: opts.seqStep ?? pick(r, [1,2,-1,3]), startHigh: !!opts.startHigh });
  return { chords, lead: toBars(lead) };
}

function arrangeFromPlan(plan, description = '', seedStr = '') {
  const { p, r } = normalizePlan(plan, description, seedStr);
  return themeBody(p, r, {});
}

// One theme rendered as a full section list (used alone for single-theme songs, or as a movement of a suite).
// opts: targetBars, intro (bool), coda (bool), maxDev, feel ('half'|'normal'|'driving'), counter (bool), raw (bool)
function themeBody(p, r, opts = {}) {
  if(p.performance)return Grammar.themeBody(p,r,opts,{buildCycle,buildBass,toBars,scalePcs,stepMidi,midiToStep,nearestPc,inRange,
    REST,chordFor,octaveUp,sparseLead,developContour,arcs:ARRANGEMENT_ARCS,
    loreQuote:()=>{const ch=chordFor(0,p.key,p.scale),rhythm=LEITMOTIF.rhythm,contour=p.leitmotif==='quote'?LEITMOTIF.contour:p.motifContour;
      return{chords:[ch],lead:toBars(buildLead({compositionVersion:3,phraseCells:[{rhythm,contour}],cadences:{},quoteIndex:-1,
        key:p.key,scale:p.scale,barsChords:[ch],motifR:rhythm,motifC:contour,seqStep:0,leitmotif:'none'}))};}});
  const authored = p.compositionVersion === 3;
  const prog = authored ? { A:p.harmonyA.map(d=>d==='V'?d:Number(d)), B:p.harmonyB.map(d=>d==='V'?d:Number(d)),
    label:PROGRESSIONS[p.progression].label+' / '+PROGRESSIONS[p.contrastProgression].label } : PROGRESSIONS[p.progression];
  const sc = scalePcs(p.key, p.scale);
  const calm = ['nature','sacred','melancholy','mystic'].includes(p.mood);
  p.drums = authored?p.percussion!=='none':p.frameArp && ['battle','heroic'].includes(p.mood);
  const startHigh = authored?p.register==='high':r() < 0.5, seqStep = authored?p.sequenceStep:pick(r, [1,2,-1,3]);

  // --- material ---
  const main = buildCycle(p, r, prog, { startHigh, seqStep });                       // the loved 12-bar A A' B
  const altProgs = Object.keys(PROGRESSIONS).filter(k => k !== p.progression && PROGRESSIONS[k].modes.includes(p.scale));
  const makeDev = (k) => {
    let developed=p;
    if(authored){
      const motifContour=developContour(p.motifContour,p.developmentPath[k%p.developmentPath.length],p.motifRhythm.length,p.sequenceStep);
      developed={...p,motifContour,
        answerContour:developContour(motifContour,p.answerTransform,p.answerRhythm.length,p.sequenceStep),
        contrastContour:developContour(motifContour,p.contrastTransform,p.contrastRhythm.length,-p.sequenceStep)};
    }
    return buildCycle(developed, r, prog, { startHigh: (k % 2 === 0) ? !startHigh : startHigh, seqStep: authored?p.sequenceStep*(k%2?-1:1):[2,-1,3,1][k % 4],
      bProg: authored?prog.B:altProgs.length ? PROGRESSIONS[altProgs[k % altProgs.length]].B : prog.A.slice().reverse(),
      leitmotif: authored?p.leitmotif:p.leitmotif === 'none' ? (k % 2 ? 'none' : 'vary') : 'quote', noPicardy: true });
  };
  // --- form: Intro | A A' B | A(var) A' Bridge | B' | A A' (return) | Coda ; loops back to Intro ---
  const sections = [];
  const add = (name, chords, lead, part) => sections.push({ name, chords, lead, part });
  const sl = (c, a, b) => ({ chords: c.chords.slice(a,b), lead: c.lead.slice(a,b) });
  const intro = sl(main, 0, 4);
  if (opts.intro !== false) add('intro', intro.chords, intro.lead.map((b,i) => i < 2 ? b.map(st=>REST(st.duration)) : sparseLead(b)), 'intro');
  let x = sl(main,0,4); add('A', x.chords, x.lead, 'A');
  x = sl(main,4,8);  add("A'", x.chords, x.lead, 'A');
  x = sl(main,8,12); add('B', x.chords, x.lead, 'B');
  const targetBars = opts.targetBars ?? Math.max(48, Math.round((p.bpm * 150 / 240) / 4) * 4);          // ~2.5 minutes before looping
  let devCount = 0;
  const devSections = () => {
    const dev = makeDev(devCount);
    const odd = devCount++ % 2 === 1;
    let y = sl(dev,0,4);  add('A var', y.chords, y.lead.map((b,i) => (i%2) !== odd ? ornament(b, sc) : octaveUp(b)), 'A');
    y = sl(dev,4,8);      add("A' var", y.chords, y.lead.map(b => ornament(b, sc)), 'A');
    y = sl(dev,8,12);     add('bridge', y.chords, y.lead, 'B');
    const bc = y.chords;
    if (odd) add('B var', main.chords.slice(8,12), sl(main,8,12).lead.map(b => octaveUp(b)), 'B');            // contrast restated higher
    else add('chant', bc, bc.map((c,i) => chantBar(c, i)), 'bridge');
  };
  const tail = 4 /*B'*/ + 8 /*return*/ + (opts.coda === false ? 0 : 4) /*coda*/;
  if (opts.targetBars == null || sections.length*4 + tail + 16 <= targetBars) devSections();
  let guard = 0;
  while (sections.length*4 + tail + 16 <= targetBars && guard++ < (opts.maxDev ?? 3)) devSections();
  x = sl(main,8,12); add("B'", x.chords, x.lead.map(b => ornament(b, sc)), 'B');
  x = sl(main,0,4);  add('A return', x.chords, x.lead, 'A');
  x = sl(main,4,8);  add("A' return", x.chords, x.lead, 'A');
  // coda: A' cadence material thinned, ending on the dominant so the loop to the intro resolves
  const codaCh = [...main.chords.slice(4,7), chordFor(p.scale==='major'||p.scale==='mixolydian'||p.scale==='lydian' ? 4 : 'V', p.key, p.scale)];
  if (opts.coda !== false) add('coda', codaCh, main.lead.slice(4,8).map((b,i) => i === 3 ? [REST(4), REST(4), REST(4), REST(4)] : sparseLead(b)), 'coda');

  if(authored)sections.forEach((sct,i)=>{
    const arc=ARRANGEMENT_ARCS[p.arrangementArc];
    sct.orchestration=['intro','coda'].includes(sct.part)?'thin':arc[Math.min(7,Math.floor(i/sections.length*8))];
    if(sct.name==='A')sct.orchestration='full';
    if(sct.part==='intro'||sct.part==='coda')return;
    if(sct.orchestration==='thin')sct.lead=sct.lead.map((b,j)=>j%2?[...sparseLead(b)]:[REST(1)]);
    if(sct.orchestration==='crest')sct.lead=sct.lead.map(b=>octaveUp(b));
  });

  // --- accompaniment per section ---
  const allChords = sections.flatMap(sct => sct.chords);
  const feel = opts.feel || 'normal';
  const bassStyle = feel === 'half' ? (['pedal','lament','root_fifth'].includes(p.bassStyle) ? p.bassStyle : 'pedal')
                  : feel === 'driving' ? (['gallop','octave_pump','ostinato_fourth'].includes(p.bassStyle) ? p.bassStyle : 'gallop') : p.bassStyle;
  const bassBars = authored?sections.flatMap(sct=>toBars(buildBass(sct.chords,sct.orchestration==='thin'?'pedal':bassStyle,r,sc))):toBars(buildBass(allChords, bassStyle, r, sc));
  const arpBars = [];
  let prevLead = null;
  sections.forEach((sct, si) => {
    // counter-melody texture: voice 3 answers the lead one octave down, a bar behind (canon), instead of arpeggios
    if ((opts.counter || authored && (p.texture==='counterpoint'||p.texture==='arpeggios'&&sct.orchestration==='counterpoint')) && sct.part === 'A' && prevLead) {
      const src = [prevLead[prevLead.length-1], ...sct.lead.slice(0, sct.lead.length-1)];
      arpBars.push(...src.map((b,i) => {
        let pos=0;
        return b.map(st => {
          const strong=pos%8===0||U[st.duration]>=4; pos+=U[st.duration];
          if(st.note==='REST')return st;
          const m=Math.max(48,stepMidi(st)-12);
          return midiToStep(authored?inRange(nearestPc(m,strong?sct.chords[i].pcs:sc),48,69):m,st.duration);
        });
      }));
      prevLead = sct.lead; return;
    }
    prevLead = sct.lead;
    if(authored && p.texture==='drone') {
      arpBars.push(...sct.chords.map(ch=>[midiToStep(inRange(48+ch.root,48,59),2),midiToStep(inRange(48+ch.root+7,48,66),2)]));
      return;
    }
    if(authored && p.texture==='sparse') {
      arpBars.push(...sct.chords.map(ch=>[midiToStep(inRange(48+ch.root,48,59),4),REST(4),midiToStep(inRange(48+ch.pcs[1],48,66),4),REST(4)]));
      return;
    }
    const full = (sct.part === 'intro' || feel === 'half' || authored && sct.orchestration==='thin') ? [] : (calm && sct.part === 'A') ? [] : [0,1,2,3];
    const useFrame = authored?p.frameArp && sct.orchestration!=='thin':feel === 'driving' ? true : (p.frameArp && sct.part !== 'intro' && feel !== 'half');
    const drumsOn = authored ? p.percussion!=='none' && sct.orchestration!=='thin' && !['intro','coda'].includes(sct.part) &&
      (p.percussion!=='sparse'||(sct.part==='B'&&si%2===0)) : feel === 'driving' ? (sct.part !== 'intro' && sct.part !== 'coda' && si % 4 !== 3)          // drums drop out every 4th section
                  : (p.drums && feel !== 'half' && (sct.part === 'B' || sct.part === 'bridge' || si % 2 === 0) && sct.part !== 'intro' && sct.part !== 'coda');
    arpBars.push(...toBars(buildArp(sct.chords, p.arpStyle, r, full, useFrame, drumsOn&&authored&&p.percussion==='driving'?'driving':drumsOn)));
  });
  const leadBars = sections.flatMap(sct => sct.lead);
  if (opts.raw) return { sections, leadBars, bassBars, arpBars, prog, main, sc };

  // --- patterns + order lists (tracker style: identical bars are stored once) ---
  function packPatterns(bars) {
    const patterns = [], order = [], seen = new Map();
    for (const b of bars) { const k = JSON.stringify(b); if (!seen.has(k)) { seen.set(k, patterns.length); patterns.push(b); } order.push(seen.get(k)); }
    return { patterns, order };
  }
  const pack = (role, patch, bars) => ({ role, waveform:patch.waveform, adsr:{...patch.adsr}, pulseWidth: patch.waveform==='PULSE'?patch.pulseWidth:0,
    filter:{...patch.filter}, pwmSpeed: patch.pwmSpeed||0, vibrato: patch.vibrato||0, ...packPatterns(bars) });
  const song = {
    bpm: p.bpm, key: p.key, scale: p.scale, title: p.title, author: 'Holodek SID',
    voices: [ pack('LEAD', PATCHES.LEAD[p.leadPatch], leadBars), pack('BASS', PATCHES.BASS[p.bassPatch], bassBars), pack('ARP_OR_DRUMS', PATCHES.ARP[p.arpPatch], arpBars) ],
    plan: { mood:p.mood, progression:p.progression, progressionLabel:prog.label, chords: main.chords.map(c=>NOTES[c.root]), bassStyle:p.bassStyle, arpStyle:p.arpStyle,
            leadPatch:p.leadPatch, bassPatch:p.bassPatch, arpPatch:p.arpPatch, motifRhythm:p.motifRhythm, motifContour:p.motifContour,
            form: sections.map(sct => sct.name).join(' | ') + ' | (loop)', bars: sections.length*4,
            seconds: Math.round(sections.length*4*4*60/p.bpm), leitmotif:p.leitmotif, picardy:p.picardy, frameArp:p.frameArp, drums:p.drums },
  };
  song.analysis = analyze(song);
  return song;
}


// =====================================================================================
// SUITE: ~10-minute multi-theme room score (room theme, danger, reflective, Mortacia motif,
// return of the room theme). Each theme has its own key, mode, progression, motif, texture
// and SID instruments; movements are joined by 2-bar modulating transitions. Instrument and
// filter changes are zero-time command steps the 6502 player executes ($FD / $FC).
// =====================================================================================
const ROLE_DEFAULTS = {
  room:       { feel:'normal' },
  danger:     { mood:'battle',     feel:'driving', keyShift:[1,5,-2,6],  filter:{ cutoff:1400, sweep:1,  resonance:10, route:[0,1] } },
  reflective: { mood:'melancholy', feel:'half',    keyShift:[3,5,-3,-4], counter:true, filter:{ cutoff:640, sweep:1, resonance:6, route:[2] } },
  mortacia:   { mood:'throne',     feel:'normal',  keyShift:[0,7,-5,-2] },
};
const ROLE_ORDER = ['room','danger','reflective','mortacia'];
const SHARE = { room:0.30, danger:0.22, reflective:0.20, mortacia:0.13, ret:0.15 };

function instCmd(patch) { return { cmd:'inst', waveform:patch.waveform, adsr:{...patch.adsr} }; }
function initFilterCmd(patches, authored = false) {
  const typed = patches.map((pt,i)=>({pt,i})).filter(o => String(o.pt.filter.type).toUpperCase() !== 'NONE');
  const avg = typed.length ? Math.round(typed.reduce((a,o)=>a+o.pt.filter.cutoff,0)/typed.length) : 0;
  return { cmd:'filter', cutoff: authored?avg:((avg>>8)&7) << 3, sweep:0, resonance: Math.max(0,...patches.map(pt=>pt.filter.resonance|0)), route: typed.map(o=>o.i) };
}

function arrangeSuite(plan, description = '', seedStr = '', lengthScale = 1) {
  plan = plan || {};
  if(plan.compositionVersion===3)return arrangeAuthoredSuite(plan,description,seedStr,lengthScale);
  const r0 = rng(hash32('suite|' + seedStr));
  const { themes: aiThemes, ...globalPlan } = plan;
  const room = normalizePlan(globalPlan, description, seedStr);
  const bpm = room.p.bpm, homePc = NOTES.indexOf(room.p.key);
  const targetBars = Math.round(bpm * 10 * lengthScale / 4 / 4) * 4;  // ~10 minutes of 4/4 bars
  const usedProgs = new Set([room.p.progression]);
  const themes = ROLE_ORDER.map(role => {
    if (role === 'room') return { role, p: room.p, r: room.r, def: ROLE_DEFAULTS.room };
    const def = ROLE_DEFAULTS[role];
    const ai = (Array.isArray(aiThemes) ? aiThemes : []).find(t => t && String(t.role).toLowerCase() === role) || {};
    const shift = Number.isInteger(ai.keyShift) && ai.keyShift >= -6 && ai.keyShift <= 7 ? ai.keyShift : pick(r0, def.keyShift);
    const tp = { ...globalPlan, leitmotif: undefined, motifRhythm: undefined, motifContour: undefined, progression: undefined, ...ai, mood: MOODS[ai.mood] ? ai.mood : def.mood };
    const { p, r } = normalizePlan(tp, description, seedStr + '|' + role);
    p.key = NOTES[(homePc + shift + 12) % 12]; p.bpm = bpm;
    // keep themes harmonically distinct
    if (usedProgs.has(p.progression)) { const c = Object.keys(PROGRESSIONS).filter(k => PROGRESSIONS[k].modes.includes(p.scale) && !usedProgs.has(k)); if (c.length) p.progression = pick(r, c); }
    usedProgs.add(p.progression);
    if (role === 'mortacia' && ['major','lydian','mixolydian'].includes(p.scale)) {   // the fallen goddess's theme stays in a minor mode
      p.scale = pick(r, ['minor','dorian']);
      const c = Object.keys(PROGRESSIONS).filter(k => PROGRESSIONS[k].modes.includes(p.scale) && !usedProgs.has(k));
      p.progression = pick(r, c.length ? c : Object.keys(PROGRESSIONS).filter(k => PROGRESSIONS[k].modes.includes(p.scale)));
      usedProgs.add(p.progression);
    }
    if (role === 'mortacia') { p.leitmotif = 'main'; p.motifRhythm = LEITMOTIF.rhythm.slice(); p.motifContour = LEITMOTIF.contour.slice(); p.picardy = true; }
    if (role === 'danger') { p.frameArp = true; p.drums = true; }
    if (role === 'reflective') p.leitmotif = p.leitmotif === 'main' ? 'quote' : p.leitmotif;
    return { role, p, r, def };
  });

  const V = [[], [], []];                       // per-voice bar lists (a bar may be a command-only "bar")
  const form = [];
  const patchesOf = p => [PATCHES.LEAD[p.leadPatch], PATCHES.BASS[p.bassPatch], PATCHES.ARP[p.arpPatch]];
  const roomPatches = patchesOf(room.p);
  const pushCmds = (p, def, isRoom) => {
    const pt = patchesOf(p);
    if (def.counter) pt[2] = PATCHES.LEAD.flute_tri;
    V[0].push([instCmd(pt[0]), isRoom ? initFilterCmd(roomPatches) : (def.filter ? { cmd:'filter', ...def.filter } : initFilterCmd(roomPatches))]);
    V[1].push([instCmd(pt[1])]); V[2].push([instCmd(pt[2])]);
  };
  const pushMovement = (name, t, opts) => {
    pushCmds(t.p, t.def, t.role === 'room');
    const m = themeBody(t.p, t.r, { ...opts, feel: t.def.feel, counter: !!t.def.counter, raw: true });
    V[0].push(...m.leadBars); V[1].push(...m.bassBars); V[2].push(...m.arpBars);
    form.push(`${name} [${t.p.key} ${t.p.scale}, ${PROGRESSIONS[t.p.progression].label}, ${m.sections.length*4} bars: ${m.sections.map(x=>x.name).join(' ')}]`);
    return m.sections.length * 4;
  };
  const pushTransition = (to) => {      // 2 bars: iv/IV then V of the next key; lead anacrusis run into the new tonic
    const p = to.p, sc = scalePcs(p.key, p.scale), major = ['major','mixolydian','lydian'].includes(p.scale);
    const ch = [chordFor(3, p.key, p.scale), chordFor(major ? 4 : 'V', p.key, p.scale)];
    const tonic = inRange(60 + NOTES.indexOf(p.key), 64, 75);
    const run = []; let m = tonic; for (let k = 0; k < 8; k++) { m--; while (!sc.includes(((m%12)+12)%12)) m--; run.unshift(m); }
    V[0].push([REST(4),REST(4),REST(4),REST(4)], run.map(x => midiToStep(x, 8)));
    V[1].push(...toBars(buildBass(ch, 'pedal', to.r, sc)));
    V[2].push(...toBars(buildArp(ch, 'updown', to.r, [], false, false)));
    form.push(`transition -> ${p.key} ${p.scale}`);
    return 2;
  };
  let bars = 0;
  bars += pushMovement('Room theme', themes[0], { targetBars: Math.round(targetBars*SHARE.room*1.12/4)*4, intro: true, coda: false, maxDev: 8 });
  for (const role of ['danger','reflective','mortacia']) {
    const t = themes[ROLE_ORDER.indexOf(role)];
    bars += pushTransition(t);
    bars += pushMovement(role === 'danger' ? 'Danger' : role === 'reflective' ? 'Reflection' : 'Mortacia motif', t,
      { targetBars: Math.round(targetBars*SHARE[role]*1.12/4)*4, intro: false, coda: false, maxDev: 8 });
  }
  bars += pushTransition(themes[0]);
  const ret = { ...themes[0], r: rng(hash32('return|' + seedStr)) };
  bars += pushMovement('Room theme returns', ret, { targetBars: Math.max(28, targetBars - bars + 8), intro: false, coda: true, maxDev: 8 });

  function packPatterns(barsList) {
    const patterns = [], order = [], seen = new Map();
    for (const b of barsList) { const k = JSON.stringify(b); if (!seen.has(k)) { seen.set(k, patterns.length); patterns.push(b); } order.push(seen.get(k)); }
    return { patterns, order };
  }
  const pack = (role, patch, barsList) => ({ role, waveform:patch.waveform, adsr:{...patch.adsr}, pulseWidth: patch.waveform==='PULSE'?patch.pulseWidth:0,
    filter:{...patch.filter}, pwmSpeed: patch.pwmSpeed||0, vibrato: patch.vibrato||0, ...packPatterns(barsList) });
  const p = room.p;
  const song = {
    bpm, key: p.key, scale: p.scale, title: p.title, author: 'Holodek SID',
    voices: [ pack('LEAD', roomPatches[0], V[0]), pack('BASS', roomPatches[1], V[1]), pack('ARP_OR_DRUMS', roomPatches[2], V[2]) ],
    plan: { suite: true, mood:p.mood, progression:p.progression, progressionLabel:PROGRESSIONS[p.progression].label,
            themes: themes.map(t => ({ role:t.role, key:t.p.key, scale:t.p.scale, mood:t.p.mood, progression:t.p.progression, lead:t.p.leadPatch, bass:t.p.bassPatch,
                                       arp: t.def.counter ? 'counter-melody (flute_tri)' : t.p.arpPatch, feel:t.def.feel, motif:t.p.motifRhythm.join(',')+'/'+t.p.motifContour.join(',') })),
            form: form.join(' || ') + ' || (loop)', bars, seconds: Math.round(bars*4*60/bpm), leitmotif: p.leitmotif },
  };
  song.analysis = analyze(song);
  // 6502 player limit: 255 unique patterns per voice. Shorten the development if a dense song would overflow.
  if (song.voices.some(v => v.patterns.length > 250) && lengthScale > 0.6) return arrangeSuite(plan, description, seedStr, lengthScale - 0.15);
  return song;
}

// New compositions retain the proven voice-leading and tracker player, but the
// model owns the themes, harmony, phrase structure and choice of movements.
function arrangeAuthoredSuite(plan,description,seedStr,lengthScale){
  const home=normalizePlan(plan,description,seedStr).p,roles=SUITE_FORMS[plan.suiteForm];
  if(!roles)throw Error('Unknown authored suite form.');
  const movements=[{role:'room',p:home},...roles.map(role=>{
    const raw=plan.themes.find(t=>t.role===role);
    if(!raw)throw Error('Missing authored '+role+' movement.');
    const p=normalizePlan({...home,...raw,key:NOTES[(NOTES.indexOf(home.key)+raw.keyShift+12)%12],bpm:home.bpm},description,seedStr+'|'+role).p;
    return{role,p};
  })];
  if(roles.length)movements.push({role:'return',p:home});
  const V=[[],[],[]],forms=[],bar=()=>V[0].reduce((n,b)=>n+b.filter(s=>!s.cmd).reduce((u,s)=>u+U[s.duration],0)/16,0);
  const totalBars=Math.round(home.bpm*10*lengthScale/16)*4;
  for(const [i,m]of movements.entries()){
    const p=m.p,patches=[PATCHES.LEAD[p.leadPatch],PATCHES.BASS[p.bassPatch],PATCHES.ARP[p.arpPatch]];
    if(i){
      // Prepare the incoming tonic with two shared-grid bars; no free-text modulation.
      const sc=scalePcs(p.key,p.scale),major=['major','mixolydian','lydian'].includes(p.scale);
      const ch=[chordFor(3,p.key,p.scale),chordFor(major?4:'V',p.key,p.scale)],run=[];
      let pitch=inRange(60+NOTES.indexOf(p.key),64,75);
      for(let k=0;k<8;k++){pitch--;while(!sc.includes(((pitch%12)+12)%12))pitch--;run.unshift(pitch);}
      V[0].push([REST(1)],run.map(n=>midiToStep(n,8)));
      V[1].push(...toBars(buildBass(ch,'pedal',rng(hash32(seedStr+'|transition|'+i)),sc)));
      V[2].push(...toBars(buildArp(ch,'updown',null,[],false,false)));
    }
    V.forEach((v,j)=>v.push(j===0?[instCmd(patches[j]),initFilterCmd(patches,true)]:[instCmd(patches[j])]));
    const start=bar(),remaining=movements.length-i;
    // Rebalance remaining movements after phrase rounding. Eight bars selects
    // the nearest 16-bar development boundary rather than always rounding down.
    const budget=Math.max(32,Math.round((totalBars-start-(remaining-1)*2)/remaining/4)*4);
    const raw=themeBody(p,rng(hash32(seedStr+'|'+m.role)),{
      raw:true,intro:i===0,coda:i===movements.length-1,targetBars:budget+8,maxDev:Math.ceil(budget/16)+1
    });
    [raw.leadBars,raw.bassBars,raw.arpBars].forEach((rows,j)=>V[j].push(...rows));
    forms.push({role:m.role,startBar:start,bars:bar()-start,key:p.key,scale:p.scale,phraseForm:p.phraseForm,texture:p.texture,
      ...(p.performance?{performance:p.performance,phraseBars:Grammar.layout(p).map(g=>g.cells.length),
        sectionBars:raw.sections.map(s=>s.chords.length)}:{}),
      sections:raw.sections.map(s=>s.name),orchestration:raw.sections.map(s=>s.orchestration),
      motifRhythm:p.motifRhythm,motifContour:p.motifContour,harmonyA:p.harmonyA,harmonyB:p.harmonyB});
  }
  const voices=V.map((rows,i)=>{
    const patterns=[],order=[],seen=new Map();
    for(const b of rows){const k=JSON.stringify(b);if(!seen.has(k)){seen.set(k,patterns.length);patterns.push(b);}order.push(seen.get(k));}
    const patch=[PATCHES.LEAD[home.leadPatch],PATCHES.BASS[home.bassPatch],PATCHES.ARP[home.arpPatch]][i];
    return{role:['LEAD','BASS','ARP_OR_DRUMS'][i],waveform:patch.waveform,adsr:{...patch.adsr},pulseWidth:patch.pulseWidth,
      filter:{...patch.filter},pwmSpeed:patch.pwmSpeed||0,vibrato:patch.vibrato||0,patterns,order};
  });
  if(voices.some(v=>v.patterns.length>250)){
    throw Error('Authored score exceeds SID pattern memory. Simplify the development path or suite; do not shorten the exploration score.');
  }
  const bars=bar(),song={bpm:home.bpm,key:home.key,scale:home.scale,title:home.title,author:'AI composition / Holodek SID arrangement',voices,
    plan:{compositionVersion:3,...(home.performance?{grammarVersion:4,performance:home.performance}:{}),suite:true,suiteForm:home.suiteForm,mood:home.mood,leitmotif:home.leitmotif,
      ...(home.performance?{leadPatch:home.leadPatch,bassPatch:home.bassPatch,arpPatch:home.arpPatch,bassStyle:home.bassStyle,arpStyle:home.arpStyle}:{}),
      motifRhythm:home.motifRhythm,motifContour:home.motifContour,phraseForm:home.phraseForm,texture:home.texture,
      progression:home.progression,contrastProgression:home.contrastProgression,
      progressionLabel:PROGRESSIONS[home.progression].label+' / '+PROGRESSIONS[home.contrastProgression].label,
      themes:forms,form:forms.map(m=>m.role+': '+m.sections.join(' / ')).join(' || '),bars,seconds:Math.round(bars*4*60/home.bpm)}};
  song.analysis=analyze(song);return song;
}

function planPromptSpec() {
  return {
    moods: Object.keys(MOODS), scales: SCALES, keys: NOTES, bpm: BPM_ALLOWED,
    progressions: Object.fromEntries(Object.entries(PROGRESSIONS).map(([k,v])=>[k, `${v.label}; modes: ${v.modes.join('/')}`])),
    leadPatches: Object.keys(PATCHES.LEAD), bassPatches: Object.keys(PATCHES.BASS), arpPatches: Object.keys(PATCHES.ARP),
    bassStyles: BASS_STYLES, arpStyles: ARP_STYLES, leitmotif:['main','quote','vary','none'],
    phraseForms:PHRASE_FORMS,textures:TEXTURES,suiteForms:SUITE_FORMS,developmentTransforms:DEVELOPMENT_TRANSFORMS,arrangementArcs:Object.keys(ARRANGEMENT_ARCS),
  };
}

module.exports = { arrangeSuite, themeBody, expandVoice, LEITMOTIF, arrangeFromPlan, normalizePlan, planPromptSpec, detectMood, analyze, hash32, PROGRESSIONS, MOODS, developContour };
