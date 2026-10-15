'use strict';
// Isolated capability studies, or real Retort composition with --generate.
// Never replaces the live room slots, save files, or campaign music database.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const Composition=require('../retort/sidComposition'),Theory=require('../retort/sidMusicTheory');
const Grammar=require('../retort/sidMusicGrammar'),Audio=require('../retort/renderAudio');
const {waveStats,assemblyStats}=require('./analyze-room-music.cjs');
const base=require('../tests/fixtures/sid-leaving-threshold.json');
const studies=[
  {id:'cavern',room:'A vast crystal cavern, cold streams reflecting hidden stars; the party seeks a passage for trapped miners.',
    plan:{title:'Lanterns Under Stone',key:'F#',scale:'lydian',progression:'lydian_wonder',contrastProgression:'plagal_hymn',bpm:104,
      leadPatch:'bell_tri',bassPatch:'plucked_tri',arpPatch:'soft_saw',phraseForm:'arch',bassStyle:'sustained',arpStyle:'harp',
      motifRhythm:[4,8,8,4,4],motifContour:[0,2,1,4,3],groove:'held_rush',contrastContour:[0,-1,0,2,3,2,1]}},
  {id:'market',room:'A crowded market of exiles around a caravanserai; workers trade, bargain and prepare a daring rescue.',
    plan:{title:'Ash Market Lanterns',key:'B',scale:'mixolydian',progression:'mixo_march',contrastProgression:'tavern_major',bpm:136,
      leadPatch:'plucked_pulse',bassPatch:'rubber_pulse',arpPatch:'muted_pulse',phraseForm:'rondo',bassStyle:'syncopated',arpStyle:'offbeat',
      motifRhythm:[8,4,8,4,4],motifContour:[0,-1,1,4,3],groove:'tresillo',contrastContour:[0,2,3,1,0,-1,0]}},
  {id:'fortress',room:'The fortress watch advances above a lava canyon, a tense infiltration before a battle with the gate captain.',
    plan:{title:'The Brass Watch',key:'C#',scale:'phrygian',progression:'phrygian_march',contrastProgression:'phrygian_vamp',bpm:128,
      leadPatch:'nasal_pulse',bassPatch:'growl_saw',arpPatch:'chip_pulse',phraseForm:'asymmetric',bassStyle:'march',arpStyle:'descending',
      motifRhythm:[8,16,16,8,8,4,4],motifContour:[0,1,3,2,1,4,3],groove:'motor',contrastContour:[0,-1,0,3,2,4,3]}},
  {id:'crypt',room:'An underground crypt where mourners keep a quiet vigil, and Mortacia promises to recover a stolen name.',
    plan:{title:'A Name Kept Safe',key:'E',scale:'dorian',progression:'dorian_rise',contrastProgression:'stately_minor',bpm:96,
      leadPatch:'bowed_saw',bassPatch:'bowed_bass',arpPatch:'chime_tri',phraseForm:'processional',bassStyle:'broken_tenths',arpStyle:'pendulum',
      motifRhythm:[4,4,8,8,4],motifContour:[0,-1,0,3,2],groove:'clave',contrastContour:[0,1,3,2,4,2,1]}}
];
function studyPlan(study){
  const {groove,...p}=study.plan;
  return {...base,...p,contrastRhythm:[8,16,16,8,8,4,4],texture:'arpeggios',percussion:'none',frameArp:true,leitmotif:'none',
    performance:{...Grammar.DEFAULT,groove,bassVariation:'interlock'},suiteForm:'single_theme',themes:[]};
}
function excerpt(song,bars=20){
  const s=structuredClone(song);
  for(const v of s.voices){let n=0;v.order=v.order.filter(i=>{const musical=v.patterns[i].some(s=>!s.cmd);if(musical)n++;return n<=bars;});}
  return s;
}
async function main(){
  const generate=process.argv.includes('--generate'),dir=path.resolve(__dirname,'../sid/music-auditions');
  fs.mkdirSync(dir,{recursive:true});
  const manifest={version:1,source:generate?'llm-validated-plan':'hand-authored arranger capability studies; not new AI compositions',rooms:[]};
  const recent=[];
  for(const study of studies){
    let song;
    if(generate){
      if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY is not configured for this terminal. Offline studies work without it.');
      const Runtime=require('../retort/gameRetort').createRuntime({log:()=>{}});
      song=await Runtime.run(Runtime.retort($=>Composition.generate($,{description:study.room,roomKey:study.id,runId:'isolated-variety-audition-v4',recent})),null,{shouldSaveToLog:false});
    }else {
      song=Composition.assertScore(Theory.arrangeSuite(Composition.develop(Composition.validate(studyPlan(study))),study.room,study.id));
      song.author='Holodek arranger study';
    }
    recent.push({roomKey:study.id,song});
    const stem=study.id+(generate?'-ai':'-study'),json=path.join(dir,stem+'.json'),asm=path.join(dir,stem+'.asm');
    fs.writeFileSync(json,JSON.stringify(song,null,2));
    const build=spawnSync(process.execPath,[path.resolve('assets/renderSid_poke.js'),json,asm],{encoding:'utf8'});
    if(build.error||build.status!==0)throw build.error||Error(build.stderr||'ASM compiler failed');
    const assembly=assemblyStats(fs.readFileSync(asm,'utf8'));
    if(!assembly.synchronized)throw Error('ASM voice timing drift');
    const clips={};
    for(const chip of ['8580','10582']){
      const output=Audio.renderArrangementToWav(excerpt(song),{outBaseNoExt:path.join(dir,stem+'-'+chip),clock:'2x',chip});
      clips[chip]={file:path.basename(output.wavPath),...waveStats(fs.readFileSync(output.wavPath))};
      if(clips[chip].clippedSamples||clips[chip].rms<.005)throw Error('Clipped or silent audition: '+stem+' '+chip);
    }
    manifest.rooms.push({id:study.id,title:song.title,description:study.room,plan:song.plan,composition:song.composition,analysis:song.analysis,assembly,
      assembledSid:fs.existsSync(path.join(dir,stem+'.sid')),clips});
    console.log(JSON.stringify({room:study.id,title:song.title,form:song.plan.phraseForm,groove:song.plan.performance?.groove,
      instruments:[song.plan.leadPatch,song.plan.bassPatch,song.plan.arpPatch],seconds:song.plan.seconds,patterns:song.analysis.uniquePatterns,clips}));
  }
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const suffix=generate?'-ai':'';
  fs.writeFileSync(path.join(dir,'manifest'+suffix+'.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(dir,'index'+suffix+'.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SID Arrangement Studies</title><style>body{max-width:70rem;margin:3rem auto;padding:0 1rem;background:#171b19;color:#ede5cf;font:18px Georgia,serif}section{border-top:1px solid #6c826e;padding:1rem 0;margin-top:2rem}audio{display:block;max-width:100%;margin:.6rem 0}p{line-height:1.5}</style><h1>Rooms With Different Musical Identities</h1><p>${esc(manifest.source)}. Full scores are about ten minutes; these matched 20-bar excerpts compare 8580 and custom 10582 rendering. No live campaign, saves or room_A/room_B files are changed. ASM is emitted separately; a playable SID requires xa.</p>${manifest.rooms.map(r=>`<section><h2>${esc(r.title)}</h2><p>${esc(r.description)}</p><p>${esc(r.plan.phraseForm)} / ${esc(r.plan.performance.groove)} / ${esc([r.plan.leadPatch,r.plan.bassPatch,r.plan.arpPatch].join(', '))}</p>${Object.entries(r.clips).map(([chip,c])=>`<label>${chip}<audio controls preload="none" src="${esc(c.file)}"></audio></label>`).join('')}</section>`).join('')}</html>`);
  console.log('Audition page: /sid/music-auditions/index'+suffix+'.html');
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={studies,studyPlan,excerpt};
