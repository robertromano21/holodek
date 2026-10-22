'use strict';
const C = require('./generationContracts');
const P = require('../assets/physicalPuzzles');
const Sculptures = require('../assets/sculptureForms');
const Art = require('../assets/surfaceArt');
const Schema = require('./structuredSchema');
const Icons = require('../assets/shrineIconography');
const People = require('../assets/artCharacters');
const optional = value => typeof value === 'function' || Array.isArray(value) ? { type: value, optional: true } : { ...value, optional: true };
const single = max => ({ ...C.text(max), pattern: '^[^<>\\r\\n]+$' });
function parameters(brief) {
  const tools = P.toolbox(), statues = Sculptures.toolbox(), art = Art.toolbox();
  const homebrew = require('./worldFlags').on('ARCHITECTURE_EXPANSION') && require('./settingLayer').current();
  const deities = homebrew ? ['none'] : Object.keys(statues.deities);
  const carvings = Object.fromEntries(Object.entries(art.stonework).map(([k, choices]) => [k, optional(C.choice(choices))]));
  const person = { race: optional(C.choice([...People.races, ...People.creatures])), className: optional(C.choice(Object.keys({ ...People.classes, ...People.occupations }))),
    ...(!homebrew ? {patron: optional(C.choice(deities))} : {}), sex: optional(C.choice(['Male', 'Female', 'Neutral'])) };
  const subjects = homebrew ? art.subjects.filter(s => !Object.hasOwn(statues.deities,s)) : [...art.subjects, 'Suzerain'];
  const figure = { subject: C.choice(subjects), pose: C.choice(art.poses),
    facing: optional(C.choice(['front', 'left', 'right'])), attribute: optional(C.choice(art.attributes)),
    robe: optional(C.choice(art.robes)), head: optional(C.choice(art.heads)),
    anatomy: optional(C.choice(art.anatomy)), proportions: optional(C.choice(art.proportions)), ...person,
    name: optional(single(40)), role: optional(single(60)), story: optional(single(240)) };
  const canonical = subjects.filter(subject => Icons.name(subject) || People.hero(subject));
  const ordinary = subjects.filter(subject => !canonical.includes(subject));
  const figureContract = canonical.length && ordinary.length ? Schema.discriminatedGroups(figure, 'subject', [
    { values: canonical, omit: Object.keys(person) }, { values: ordinary } ]) : { type: figure };
  const artwork = { kind: C.choice(['fresco', 'relief', 'inscription', 'mosaic']), surface: C.choice(['wall', 'floor', 'object']),
    label: single(70), description: single(220), motifs: { type: [single(28)], minItems: 1, maxItems: 6 }, text: optional(single(120)),
    title: optional(single(70)), backstory: optional(single(600)),
    composition: optional(C.choice(['procession', 'apotheosis', 'judgment', 'lamentation', 'constellation', 'cosmogony'])),
    format: optional(C.choice(['panel', 'mural'])), pigments: optional(C.choice(['vermilion', 'lapis', 'verdigris', 'ochre'])),
    aspectRatio: optional({ type: Number, enum: art.frescoAspectRatio }), style: optional(C.choice(Object.keys(art.styles))),
    scene: optional(C.choice(homebrew ? art.scenes.filter(s=>!/tartarus|hades|mortacia|sepulchra/i.test(s)) : art.scenes)), figures: optional([figureContract]), mosaicPattern: optional(C.choice(art.mosaicPattern)),
    mosaicShape: optional(C.choice(art.mosaicShape)), ...carvings };
  const statue = { label: single(70), form: C.choice(statues.forms), pose: C.choice(statues.poses),
    head: C.choice(statues.heads), robe: C.choice(statues.robes), attribute: C.choice(statues.attributes),
    ...(!homebrew ? {deity: optional(C.choice(deities))} : {}), workmanship: optional(C.choice(statues.workmanship)),
    sculptureStyle: optional(C.choice(statues.sculptureStyle)), material: optional(C.choice(tools.materials)), ...person,
    aspect: optional(C.choice(['dragon', 'avatar'])) };
  const statueContract = homebrew ? { type: statue } : Schema.alternatives(statue, [
    { ...Object.fromEntries(Object.entries(statue).filter(([key]) => !Object.hasOwn(person, key))), deity: C.choice(deities) },
    Object.fromEntries(Object.entries(statue).filter(([key]) => key !== 'deity')) ]);
  const mechanic = tools.mechanics[brief.kind], positions = Array.from({ length: mechanic.positions }, (_, i) => i);
  const controls = { id: { ...C.text(24), pattern: '^[a-z][a-z0-9_]{0,23}$' },
    label: { ...single(45), pattern: "^[A-Za-z][A-Za-z0-9 '-]* " + mechanic.suffix + '$' }, mark: single(28),
    options: { type: [single(25)], minItems: mechanic.positions, maxItems: mechanic.positions },
    initial: { type: Number, enum: mechanic.ordered ? [0] : positions }, goal: { type: Number, enum: mechanic.ordered ? [1] : positions } };
  const parameters = { kind: C.choice([brief.kind]), moduleKit: C.choice([brief.moduleKit]), title: single(70), context: single(300), lore: single(320),
    controls: { type: C.list(controls), minItems: brief.controls.length, maxItems: brief.controls.length },
    order: { type: [C.nonblankText(24)], minItems: mechanic.ordered ? brief.controls.length : 0, maxItems: mechanic.ordered ? brief.controls.length : 0 },
    arrangement: C.choice(tools.arrangements), clueStyle: C.choice(tools.clueStyles),
    material: C.choice(tools.materials), outputLabel: optional(single(60)), storyLead: optional(single(240)),
    couplings: optional({ type: [{ type: [C.text(24)], minItems: 1, maxItems: brief.controls.length }],
      minItems: brief.kind === 'interlock' ? brief.controls.length : 0, maxItems: brief.controls.length }),
    glyphs: C.list({ name: { ...single(28), pattern: "^[A-Za-z][A-Za-z '-]{0,27}$" },
      pixels: { type: [{ ...C.text(7), pattern: '^[01]{7}$' }], minItems: 7, maxItems: 7 } }),
    roomArt: [Schema.discriminated(artwork, 'kind', {
      fresco: ['mosaicPattern', 'mosaicShape'], mosaic: ['aspectRatio'], relief: ['aspectRatio', 'mosaicPattern', 'mosaicShape'],
      inscription: ['aspectRatio', 'mosaicPattern', 'mosaicShape'] })],
    sculptures: [statueContract], shrines: C.list({ type: C.choice(statues.altarTypes), label: single(70), deity: C.choice(deities), candles: { type: Number, minimum: 0, maximum: 3, multipleOf: 1 } }),
    readables: C.list({ kind: C.choice(['book', 'spellbook', 'scroll', 'map']), name: single(65), title: single(90), backstory: single(350),
      role: C.choice(['lore', 'mechanism_clue', 'route_notes', 'spell_reference']),
      chapters: { type: C.list({ title: single(70), text: C.text(800) }), minItems: 1, maxItems: 3 },
      clueChapter: optional({ type: Number, enum: [1, 2, 3] }),
      spellRefs: optional({ type: [{ ...C.text(32), pattern: '^[a-z][a-z0-9_]{0,31}$' }], minItems: 0, maxItems: 6 }),
      modifiers: optional(C.object(Object.fromEntries(['attack_modifier', 'damage_modifier', 'ac', 'magic'].map(k => [k, { type: Number, minimum: 0, maximum: 8, multipleOf: 1 }])))) }),
    inscriptions: C.list({ type: C.choice(['stone_tablet', 'gravestone', 'chest_tomb', 'sarcophagus', 'obelisk']), name: single(65), title: single(90),
      backstory: single(350), text: C.text(650), role: C.choice(['lore', 'mechanism_clue']), motif: single(28), ...carvings }) };
  for (const [key, maximum] of Object.entries({ glyphs: 12, roomArt: 6, sculptures: 2, shrines: homebrew ? 0 : 1, readables: 4, inscriptions: 4 }))
    parameters[key] = { type: parameters[key], minItems: 0, maxItems: maximum };
  return parameters;
}
module.exports = { parameters };
