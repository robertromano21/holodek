'use strict';
const C = require('./generationContracts');
const P = require('../assets/physicalPuzzles');
const Sculptures = require('../assets/sculptureForms');
const Art = require('../assets/surfaceArt');
const optional = value => typeof value === 'function' || Array.isArray(value) ? { type: value, optional: true } : { ...value, optional: true };
const single = max => ({ ...C.text(max), pattern: '^[^<>\\r\\n]+$' });
function parameters(brief) {
  const tools = P.toolbox(), statues = Sculptures.toolbox(), art = Art.toolbox();
  const carvings = Object.fromEntries(Object.entries(art.stonework).map(([k, choices]) => [k, optional(C.choice(choices))]));
  const person = { race: optional(C.text(55)), className: optional(C.text(80)), patron: optional(C.choice(Object.keys(statues.deities))), sex: optional(C.choice(['Male', 'Female', 'Unknown'])) };
  const figure = { subject: C.choice([...art.subjects, 'Suzerain']), pose: C.choice(art.poses),
    facing: optional(C.choice(['front', 'left', 'right'])), attribute: optional(C.choice(art.attributes)),
    robe: optional(C.choice(art.robes)), head: optional(C.choice(art.heads)),
    anatomy: optional(C.choice(art.anatomy)), proportions: optional(C.choice(art.proportions)), ...person };
  const artwork = { kind: C.choice(['fresco', 'relief', 'inscription', 'mosaic']), surface: C.choice(['wall', 'floor', 'object']),
    label: single(70), description: single(220), motifs: [String], text: optional(single(120)),
    composition: optional(C.choice(['procession', 'apotheosis', 'judgment', 'lamentation', 'constellation', 'cosmogony'])),
    format: optional(C.choice(['panel', 'mural'])), pigments: optional(C.choice(['vermilion', 'lapis', 'verdigris', 'ochre'])),
    aspectRatio: optional({ type: Number, enum: art.frescoAspectRatio }), style: optional(C.choice(Object.keys(art.styles))),
    scene: optional(C.choice(art.scenes)), figures: optional(C.list(figure)), mosaicPattern: optional(C.choice(art.mosaicPattern)),
    mosaicShape: optional(C.choice(art.mosaicShape)), ...carvings };
  const statue = { label: single(70), form: C.choice(statues.forms), pose: C.choice(statues.poses),
    head: C.choice(statues.heads), robe: C.choice(statues.robes), attribute: C.choice(statues.attributes),
    deity: optional(C.choice(Object.keys(statues.deities))), workmanship: optional(C.choice(statues.workmanship)),
    sculptureStyle: optional(C.choice(statues.sculptureStyle)), material: optional(C.choice(tools.materials)), ...person };
  const controls = { id: { ...C.text(24), pattern: '^[a-z][a-z0-9_]{0,23}$' }, label: single(45), mark: single(28),
    options: [String], initial: { type: Number, minimum: 0, maximum: tools.mechanics[brief.kind].positions - 1 },
    goal: { type: Number, minimum: 0, maximum: tools.mechanics[brief.kind].positions - 1 } };
  return { kind: C.choice([brief.kind]), moduleKit: C.choice([brief.moduleKit]), title: single(70), context: single(300), lore: single(320),
    controls: C.list(controls), order: [String], arrangement: C.choice(tools.arrangements), clueStyle: C.choice(tools.clueStyles),
    material: C.choice(tools.materials), outputLabel: optional(single(60)), storyLead: optional(single(240)),
    couplings: optional([{ type: [String] }]), glyphs: C.list({ name: single(28), pixels: [String] }), roomArt: C.list(artwork),
    sculptures: C.list(statue), shrines: C.list({ type: C.choice(statues.altarTypes), label: single(70), deity: C.choice(Object.keys(statues.deities)), candles: { type: Number, minimum: 0, maximum: 3 } }),
    readables: C.list({ kind: C.choice(['book', 'spellbook', 'scroll', 'map']), name: single(65), title: single(90), backstory: single(350),
      role: C.choice(['lore', 'mechanism_clue', 'route_notes', 'spell_reference']), clueChapter: optional({ type: Number, minimum: 0, maximum: 2 }),
      chapters: C.list({ title: single(70), text: C.text(800) }), spellRefs: optional([String]),
      modifiers: optional(C.object(Object.fromEntries(['attack_modifier', 'damage_modifier', 'ac', 'magic'].map(k => [k, { type: Number, minimum: 0, maximum: 8 }])))) }),
    inscriptions: C.list({ type: C.choice(['stone_tablet', 'gravestone', 'chest_tomb', 'sarcophagus', 'obelisk']), name: single(65), title: single(90),
      backstory: single(350), text: C.text(650), role: C.choice(['lore', 'mechanism_clue']), motif: single(28), ...carvings }) };
}
module.exports = { parameters };
