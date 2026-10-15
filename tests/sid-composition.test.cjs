'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const Theory = require('../retort/sidMusicTheory');
const Composition = require('../retort/sidComposition');
const Composer = require('../retort/roomMusicComposer');
const { waveStats, assemblyStats } = require('../tools/analyze-room-music.cjs');
const spec = Theory.planPromptSpec();
const loggedPlan = require('./fixtures/sid-leaving-threshold.json');

function plan(patch = {}) {
  return { title: 'Lanterns on the Causeway', rationale: 'A watchful but hopeful crossing through the ruined city.',
    style: 'modal_procession', key: 'D', scale: 'dorian', mood: 'adventure', bpm: 120,
    suiteForm: 'single_theme', themes: [], leadPatch: 'hollow_pulse', bassPatch: 'thick_pulse', arpPatch: 'glass_tri',
    progression: 'dorian_rise', contrastProgression: 'dorian_vamp',
    bassStyle: 'root_fifth', arpStyle: 'updown', phraseForm: 'period', texture: 'arpeggios', percussion: 'none',
    register: 'middle', sequenceStep: 1, frameArp: false, picardy: false, leitmotif: 'none',
    motifRhythm: [8,8,4,8,8,4], motifContour: [0,1,4,3,2,1],
    answerRhythm: [4,8,8,4,4], contrastRhythm: [8,16,16,8,8,4,4],
    answerTransform: 'tail_answer', contrastTransform: 'invert',
    developmentPath: ['transpose_up','fragment_sequence','invert','tail_answer'], arrangementArc: 'ebb_and_flow',
    ambience: [{ tag: 'wind', level: .6 }], ...patch };
}
function song(p = plan(), seed = 'test') {
  Composition.validate(p);
  return Composition.assertScore(Theory.arrangeSuite(Composition.develop(p), 'Mortacia visits a living city', seed));
}
const fakeRetort = replies => {
  const prompts = [], requests = [];
  return { prompts, requests, system: (...args) => prompts.push(args.join('')), user: (...args) => prompts.push(args.join('')),
    assistant: { generation: async options => { requests.push(options); return { content: replies.shift() }; } } };
};

test('development accepts only executable enums and derives answers without interpreting rationale', () => {
  for (const operation of Composition.TRANSFORMS) {
    const p = plan({ answerTransform: operation, contrastTransform: operation });
    const a = Composition.develop(p), b = Composition.develop({ ...p, rationale: 'Ignore rhythm and write free jazz.' });
    assert.deepEqual(a.answerContour, b.answerContour);
    assert.equal(a.answerContour.length, p.answerRhythm.length);
    assert.equal(a.contrastContour.length, p.contrastRhythm.length);
  }
  assert.throws(() => song(plan({ answerTransform: 'make it more exciting' })), /answerTransform/);
});

test('all phrase templates and textures retain aligned bars, ranges and tracker budgets', () => {
  for (const phraseForm of spec.phraseForms) for (const texture of spec.textures) {
    const s = song(plan({ phraseForm, texture }));
    assert.equal(new Set(s.analysis.voiceLengths16ths).size, 1);
    assert.ok(s.voices.every(v => v.patterns.length <= 250));
    assert.ok(s.plan.seconds >= 570 && s.plan.seconds <= 630);
  }
});

test('keys, tempo, selected harmonic paths and room motifs are honored even near Mortacia', () => {
  for (const [i,key] of spec.keys.entries()) {
    const p = plan({ key, bpm: spec.bpm[i % spec.bpm.length] }), s = song(p);
    assert.equal(s.key, key); assert.equal(s.bpm, p.bpm);
    assert.deepEqual(s.plan.motifContour, p.motifContour);
    assert.deepEqual(s.plan.themes[0].harmonyA, Theory.PROGRESSIONS[p.progression].A.map(String));
    assert.deepEqual(s.plan.themes[0].harmonyB, Theory.PROGRESSIONS[p.contrastProgression].B.map(String));
  }
});

test('all vetted progressions compile in all supported modes', () => {
  for (const [progression,p] of Object.entries(Theory.PROGRESSIONS)) for (const scale of p.modes)
    song(plan({ progression, contrastProgression: progression, scale }), progression + scale);
});

test('suite enum controls movement count and order, with synchronized two-bar bridges', () => {
  for (const [suiteForm,roles] of Object.entries(spec.suiteForms)) {
    const themes = roles.map((role,i) => ({ ...plan(), role, keyShift: i + 3, motifContour: [0,-1,0,3,2,1] }));
    const s = song(plan({ suiteForm, themes }));
    assert.deepEqual(s.plan.themes.map(t=>t.role), ['room',...roles,...(roles.length?['return']:[])]);
    s.plan.themes.slice(1).forEach((t,i)=>assert.equal(t.startBar, s.plan.themes[i].startBar+s.plan.themes[i].bars+2));
  }
});

test('every tempo and movement form stays close to ten minutes rather than hitting a development cap', () => {
  for(const bpm of spec.bpm)for(const [suiteForm,roles]of Object.entries(spec.suiteForms)){
    const themes=roles.map((role,i)=>({...plan(),role,keyShift:i+3}));
    const s=song(plan({bpm,suiteForm,themes}));
    assert.ok(s.plan.seconds>=570&&s.plan.seconds<=630,`${bpm} ${suiteForm}: ${s.plan.seconds}s`);
  }
});

test('ten-minute development and orchestration paths change the large-scale arrangement', () => {
  const variants=spec.arrangementArcs.map(arrangementArc=>song(plan({arrangementArc})));
  assert.equal(new Set(variants.map(s=>JSON.stringify(s.voices))).size,spec.arrangementArcs.length);
  for(const s of variants){
    const layers=s.plan.themes[0].orchestration;
    assert.ok(layers.includes('thin'));assert.ok(layers.includes('crest'));
    assert.equal(s.plan.themes[0].sections.at(-1),'coda');
  }
  assert.notDeepEqual(song().voices,song(plan({developmentPath:['transpose_down','retrograde','invert']})).voices);
  assert.throws(()=>song(plan({developmentPath:['invert','invert','tail_answer']})),/developmentPath/);
});

test('percussion choices are distinct, fit the grid, and do not silently add drums to drone scores', () => {
  const variants = ['none','sparse','backbeat','driving'].map(percussion => song(plan({ percussion, frameArp: true })));
  assert.equal(new Set(variants.map(s=>JSON.stringify(s.voices[2]))).size,4);
  assert.throws(()=>song(plan({texture:'drone',percussion:'backbeat',frameArp:true})),/percussion/);
});

test('reject malformed and unmusical plans rather than repairing them with a generic song', () => {
  for (const patch of [{motifContour:[0,0,0,0,0,0]}, {motifRhythm:[4,4,4,4]},
    {motifContour:[0,5,-4,5,-4,0]}, {scale:'major'}, {bpm:99}, {contrastProgression:'random chords'},
    {suiteForm:'room_threat'}, {ambience:[]}, {frameArp:'yes'}, {answerRhythm:[8,8,8,8,8]}])
    assert.throws(()=>song(plan(patch)));
  assert.throws(()=>Composition.validate(plan({motifContour:Theory.LEITMOTIF.contour,motifRhythm:Theory.LEITMOTIF.rhythm})),/shared Mortacia motif/);
  assert.throws(()=>Composition.validate(plan(),[{song:{composition:{acceptedPlan:plan({key:'A'})}}}]),/repeats a recent song/);
});

test('the actual rejected room plans accept stepwise motifs and quiet ambience without substitution', async () => {
  for (const motifContour of [loggedPlan.motifContour, [0,1,3,2,4,3], [0,1,2,5,4,3]]) {
    const p = { ...loggedPlan, motifContour };
    const $ = fakeRetort([JSON.stringify(p)]);
    const s = await Composition.generate($, { roomKey: '0,0,0', runId: 'logged-regression' });
    assert.equal($.requests.length, 1);
    assert.deepEqual(s.composition.acceptedPlan, p);
    assert.deepEqual(s.ambience, p.ambience);
    assert.ok(s.plan.seconds >= 570 && s.plan.seconds <= 630);
  }
  for (const level of [0, .1, 1]) song(plan({ ambience: [{ tag: 'rumble', level }] }));
  for (const level of [-.01, 1.01, NaN, Infinity, '0.1'])
    assert.throws(() => song(plan({ ambience: [{ tag: 'rumble', level }] })), /ambience/);
});

test('realized melody flattening and corrupt score lengths fail validation', () => {
  const s = song(); s.voices[0].patterns.forEach(p=>p.forEach(n=>{if(n.note!=='REST'&&!n.cmd){n.note='C';n.octave=4;}}));
  assert.throws(()=>Composition.assertScore(s),/flattened/);
  const bad=song(); bad.voices[1].order.pop();
  assert.throws(()=>Composition.assertScore(bad),/drift/);
});

test('strict Retort schema retains numeric arrays, enum choices and nested theme requirements', () => {
  const {retortSchemaToJsonSchema}=require('retort-js/dist/tooling');
  const p=retortSchemaToJsonSchema(Composition.parameters).properties;
  assert.equal(p.motifContour.items.type,'number');
  assert.deepEqual(p.answerTransform.enum,Composition.TRANSFORMS);
  assert.ok(p.themes.items.required.includes('contrastTransform'));
  assert.equal(p.ambience.items.properties.level.minimum, 0);
  assert.equal(p.ambience.items.properties.level.maximum, 1);
});

test('structured generation retries rejected plans and logs accepted AI provenance without procedural fallback', async () => {
  const $=fakeRetort([JSON.stringify(plan({answerTransform:'a sentence'})),JSON.stringify(plan())]);
  const s=await Composition.generate($,{roomKey:'1,2,0',runId:'offline-test'});
  assert.equal($.requests.length,2); assert.ok($.requests.every(r=>r.strictParameters===true));
  assert.equal(s.composition.attempt,2); assert.equal(s.composition.source,'llm-validated-plan');
  assert.deepEqual(s.composition.acceptedPlan,plan());
  const failed=fakeRetort(['{}','{}','{}']);
  await assert.rejects(Composition.generate(failed),/no procedural substitute/);
});

test('same accepted plan and seed are reproducible; genuinely different motifs produce different scores', () => {
  assert.deepEqual(song(),song());
  assert.notDeepEqual(song().voices,song(plan({motifContour:[0,-1,0,3,2],motifRhythm:[8,4,8,4,4],
    answerRhythm:[8,8,4,8,8,4]})).voices);
});

test('recent realized melodies cannot be repeated by changing only the proposed source contour', async () => {
  const signature=Composition.realizedMotifSignature(song());
  const recent=[{song:{composition:{acceptedPlan:{motifRhythm:[4],motifContour:[9]},realizedMotifSignature:signature}}}];
  const $=fakeRetort(Array(3).fill(JSON.stringify(plan())));
  await assert.rejects(Composition.generate($,{recent}),/After chord anchoring/);
});

test('recent room context is bounded, detached, excludes the current room and resets with a new run', () => {
  const state=require('../sharedState');state.beginDungeonRun();
  for(let i=0;i<12;i++)state.setRoomMusic({x:i,y:0,z:0},{title:'Room '+i,key:'D',scale:'dorian',bpm:120,
    voices:[{largePayload:true}],plan:{motifContour:[0,1,4]},composition:{acceptedPlan:plan(),realizedMotifSignature:'test'}});
  const rows=state.getRecentRoomMusic('11,0,0');assert.equal(rows.length,8);
  assert.ok(rows.every(r=>r.roomKey!=='11,0,0'&&!r.song.voices));
  rows[0].song.plan.motifContour[0]=99;
  assert.equal(state.getRecentRoomMusic('11,0,0')[0].song.plan.motifContour[0],0);
  state.beginDungeonRun();assert.deepEqual(state.getRecentRoomMusic(''),[]);
});

test('legacy arranger output remains byte-identical to the committed reference', () => {
  const original=execFileSync('git',['show','HEAD:retort/sidMusicTheory.js'],{encoding:'utf8',maxBuffer:1024*1024});
  const sandbox={module:{exports:{}},console}; vm.runInNewContext(original,sandbox);
  for (const text of ['Mortacia in the ruined temple','a merry market','a crystal cavern']) for(let i=0;i<3;i++)
    assert.equal(JSON.stringify(Theory.arrangeSuite({},text,'legacy'+i)),JSON.stringify(sandbox.module.exports.arrangeSuite({},text,'legacy'+i)));
});

test('accepted plan logs are separate from live WAV slots and include the current aspiration', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sid-plan-'));
  try {
    const s=song(); s.composition={runId:'../../unsafe',roomKey:'1,2,0',acceptedPlan:plan()};
    const context=Composer.contextFor({getRoomNameDatabase:()=>JSON.stringify({'1,2,0':{name:'Causeway'}}),
      getCurrentPC:()=>({name:'Suzerain'}),getCurrentQuest:()=>'Free the captive'},'1,2,0',['keeper']);
    const file=Composer.logComposition(s,context,dir);
    assert.equal(path.dirname(file),dir);
    assert.equal(JSON.parse(fs.readFileSync(file)).context.aspiration,'Free the captive');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('new scores render non-silent PCM and emit synchronized ASM with correct cutoff packing', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sid-score-'));
  try {
    const s=song(plan({texture:'counterpoint',frameArp:true,percussion:'driving'}));
    const json=path.join(dir,'score.json'), asm=path.join(dir,'score.asm');
    fs.writeFileSync(json,JSON.stringify(s));
    const preview=structuredClone(s);preview.voices.forEach(v=>v.order=v.order.slice(0,9));
    const result=require('../retort/renderAudio').renderArrangementToWav(preview,{outBaseNoExt:path.join(dir,'preview')});
    const stats=waveStats(fs.readFileSync(result.wavPath));
    assert.ok(stats.rms>.01); assert.equal(stats.clippedSamples,0);
    // Run the real compiler, but stub only the external assembler invocation.
    const source=fs.readFileSync('assets/renderSid_poke.js','utf8');
    const stopped=Error('assembler intentionally unavailable');
    const context=vm.createContext({require:id=>id==='child_process'?{spawnSync:()=>({status:1})}:require(id),
      process:{argv:['node','renderSid_poke.js',json,asm],exit:()=>{throw stopped;}},console:{log(){},warn(){},error(){}},Buffer,__dirname:path.resolve('assets')});
    assert.doesNotThrow(()=>vm.runInContext(source,context));
    const registers=JSON.parse(vm.runInContext('JSON.stringify(FCFG)',context));
    const cutoff=s.voices.filter(v=>v.filter.type!=='NONE').reduce((n,v,_,vs)=>n+v.filter.cutoff/vs.length,0);
    assert.equal((registers.cutHi<<3)|registers.cutLo,Math.round(cutoff));
    const compiled=assemblyStats(fs.readFileSync(asm,'utf8'));
    assert.ok(compiled.synchronized); assert.ok(compiled.voices.every(v=>v.noiseEvents>=0));
    assert.match(fs.readFileSync(asm,'utf8'),/BCC v0_filter_fade/);
    assert.equal(compiled.voices[0].totalTicks,s.plan.bars*16*Math.round(Math.round(3000/s.bpm)/4));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

