'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const Theory=require('../retort/sidMusicTheory'),Composition=require('../retort/sidComposition');
const Grammar=require('../retort/sidMusicGrammar'),Diversity=require('../retort/sidMusicDiversity');
const archived=require('./fixtures/sid-leaving-threshold.json');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function plan(patch={}){return {...archived,phraseForm:'period',texture:'arpeggios',percussion:'none',frameArp:true,
  motifRhythm:[8,8,4,8,8,4],motifContour:[0,1,4,3,2,1],
  performance:structuredClone(Grammar.DEFAULT),...patch};}
function song(p){return Composition.assertScore(Theory.arrangeSuite(Composition.develop(Composition.validate(p)),'audition','variety-test'));}
test('every expanded form, groove, tempo and suite fits the player and ten-minute budget',()=>{
  for(const phraseForm of Object.keys(Grammar.FORMS))for(const groove of Grammar.GROOVES){
    const s=song(plan({phraseForm,performance:{...Grammar.DEFAULT,groove}}));
    assert.equal(s.plan.grammarVersion,4);assert.ok(s.plan.seconds>=570&&s.plan.seconds<=630,s.plan.seconds);
    assert.equal(new Set(s.analysis.voiceLengths16ths).size,1);
  }
  for(const bpm of Theory.planPromptSpec().bpm)for(const [suiteForm,roles]of Object.entries(Theory.planPromptSpec().suiteForms)){
    const s=song(plan({bpm,suiteForm,themes:roles.map((role,i)=>({...plan(),role,keyShift:i+2}))}));
    assert.ok(s.plan.seconds>=570&&s.plan.seconds<=630,`${bpm} ${suiteForm} ${s.plan.seconds}`);
  }
});
test('phrase lengths are genuinely different, including three-bar subphrases',()=>{
  const lengths=new Set(),signatures=new Set();
  for(const phraseForm of Object.keys(Grammar.FORMS)){
    const s=song(plan({phraseForm})),t=s.plan.themes[0];signatures.add(hash(s.voices));lengths.add(t.phraseBars.reduce((a,b)=>a+b,0));
    if(phraseForm==='asymmetric')assert.deepEqual(t.phraseBars,[3,3,4]);
  }
  assert.deepEqual([...lengths].sort((a,b)=>a-b),[6,8,10,12,16]);
  assert.equal(signatures.size,Object.keys(Grammar.FORMS).length);
});
test('authored second melodies and bass response choices are executed rather than metadata-only',()=>{
  const a=song(plan({contrastContour:[0,-1,1,3,2,1]})),b=song(plan({contrastContour:[0,1,2,4,3,1]}));
  assert.notDeepEqual(a.voices[0],b.voices[0]);
  const variants=['steady','answering','interlock'].map(bassVariation=>hash(song(plan({performance:{...Grammar.DEFAULT,bassVariation}})).voices[1]));
  assert.equal(new Set(variants).size,3);
});
test('frame arpeggios execute every selected style instead of collapsing to root-position eighths',()=>{
  for(const frameArp of [true,false]){
    const signatures=Theory.planPromptSpec().arpStyles.map(arpStyle=>hash(song(plan({arpStyle,frameArp})).voices[2]));
    assert.equal(new Set(signatures).size,signatures.length);
  }
});
test('grooves, harmonic turnover and every bass cell produce distinct scores',()=>{
  assert.equal(new Set(Grammar.GROOVES.map(groove=>hash(song(plan({performance:{...Grammar.DEFAULT,groove}})).voices))).size,Grammar.GROOVES.length);
  const styles=Theory.planPromptSpec().bassStyles;
  assert.equal(new Set(styles.map(bassStyle=>hash(song(plan({bassStyle})).voices[1]))).size,styles.length);
  const a=song(plan()),b=song(plan({performance:{...Grammar.DEFAULT,harmonicRhythm:'two_bars'}}));assert.notDeepEqual(a.voices,b.voices);
});
test('rhythm operators conserve a bar, retain contour order, and do not invent unsupported thirty-seconds',()=>{
  const rhythm=[8,8,4,8,8,4],contour=[0,1,4,3,2,1],signatures=new Set();
  for(const operation of Grammar.RHYTHMIC_OPS){
    const c=Grammar.developCell(rhythm,contour,operation);signatures.add(hash(c));
    assert.equal(c.rhythm.reduce((u,d)=>u+16/d,0),16);assert.equal(c.rhythm.length,c.contour.length);
    assert.ok(c.rhythm.every(d=>[1,2,4,8,16].includes(d)));
  }
  assert.equal(signatures.size,Grammar.RHYTHMIC_OPS.length);
  assert.deepEqual(Grammar.developCell(rhythm,contour,'augment_fragment').rhythm,[4,4,2]);
  assert.ok(Grammar.developCell(rhythm,contour,'fragment_rest').rests.at(-1));
  assert.throws(()=>song(plan({motifRhythm:[8,16,16,8,8,4,4],motifContour:[0,1,2,4,3,2,1],
    performance:{...Grammar.DEFAULT,rhythmicDevelopment:['rotate','diminish_repeat']}})),/sixteenths/);
});
test('room instrument shortlists are deterministic, exclude the last palette and include the full library over seeds',()=>{
  const spec=Theory.planPromptSpec(),seen={leadPatch:new Set(),bassPatch:new Set(),arpPatch:new Set()};
  for(let i=0;i<80;i++){
    const a=Diversity.brief('room'+i,spec,[{song:{composition:{acceptedPlan:archived}}}]);
    assert.deepEqual(a,Diversity.brief('room'+i,spec,[{song:{composition:{acceptedPlan:archived}}}]));
    for(const [field,choices]of Object.entries(a.allowed)){assert.equal(choices.length,3);assert.ok(!choices.includes(archived[field]));choices.forEach(p=>seen[field].add(p));}
    a.startingRhythms.forEach(r=>assert.equal(r.reduce((n,d)=>n+16/d,0),16));
  }
  for(const [field,all]of Object.entries({leadPatch:spec.leadPatches,bassPatch:spec.bassPatches,arpPatch:spec.arpPatches}))
    assert.equal(seen[field].size,all.length-1);
});
test('near-repeated timbre, recipe and melody are reported, not silently replaced',()=>{
  const p=plan(),old={song:{composition:{acceptedPlan:p}}};
  assert.throws(()=>Diversity.check({...p,motifContour:[0,1,3,3,2,1]},[old]),/lead\/bass/);
  assert.throws(()=>Diversity.check({...p,leadPatch:'nasal_pulse'},[old]),/recipe/);
  assert.throws(()=>Diversity.check({...p,leadPatch:'nasal_pulse',phraseForm:'rondo',bassStyle:'march'},[old]),/melody/);
  assert.doesNotThrow(()=>Diversity.check({...p,leadPatch:'nasal_pulse',phraseForm:'rondo',bassStyle:'march',motifRhythm:[4,8,8,4,4],motifContour:[0,-1,0,3,2]},[old]));
});
test('archived v3 notes and timbres remain byte-identical',()=>{
  const original=execFileSync('git',['show','HEAD:retort/sidMusicTheory.js'],{encoding:'utf8',maxBuffer:1024*1024});
  const sandbox={module:{exports:{}},console,require:id=>require(path.resolve('retort',id))};vm.runInNewContext(original,sandbox);
  const p=Composition.develop(archived),old=sandbox.module.exports.arrangeSuite(p,'temple','archive');
  assert.equal(JSON.stringify(Theory.arrangeSuite(p,'temple','archive').voices),JSON.stringify(old.voices));
});
module.exports={plan,song};
