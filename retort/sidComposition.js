'use strict';
const Theory = require('./sidMusicTheory');
const Contracts = require('./generationContracts');
const Extended = require('./sid10582');
const Grammar = require('./sidMusicGrammar');
const Diversity = require('./sidMusicDiversity');
const { createHash } = require('node:crypto');
const VERSION = 4, spec = Theory.planPromptSpec();
const TRANSFORMS = spec.developmentTransforms;
const PERCUSSION = ['none','sparse','backbeat','driving'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const enumField = values => ({ type:String, enum:values });
const numbers = values => [{ type:Number, enum:values }];
const motifFields = {
  mood:enumField(spec.moods), scale:enumField(spec.scales),
  progression:enumField(Object.keys(spec.progressions)), contrastProgression:enumField(Object.keys(spec.progressions)),
  bassStyle:enumField(spec.bassStyles), arpStyle:enumField(spec.arpStyles),
  phraseForm:enumField(spec.phraseForms), texture:enumField(spec.textures), percussion:enumField(PERCUSSION),
  register:enumField(['middle','high']), sequenceStep:{ type:Number, enum:[-2,-1,1,2] },
  frameArp:{type:Boolean}, picardy:{type:Boolean}, leitmotif:enumField(['none','vary','quote']),
  motifRhythm:numbers([4,8,16]), motifContour:numbers(Array.from({length:12},(_,i)=>i-4)),
  answerRhythm:numbers([4,8,16]), contrastRhythm:numbers([4,8,16]),
  contrastContour:numbers(Array.from({length:12},(_,i)=>i-4)),
  answerTransform:enumField(TRANSFORMS), contrastTransform:enumField(TRANSFORMS),
  developmentPath:[enumField(TRANSFORMS)], arrangementArc:enumField(spec.arrangementArcs)
};
const performanceField = {
  groove:enumField(Grammar.GROOVES), harmonicRhythm:enumField(['bar','two_bars']),
  bassVariation:enumField(['steady','answering','interlock']), rhythmicDevelopment:[enumField(Grammar.RHYTHMIC_OPS)]
};
const parameters = {
  title:Contracts.text(30), rationale:Contracts.text(360), style:enumField(['modal_procession','chamber_counterpoint','folk_dance','sparse_lament','driving_ostinato','crystal_arpeggio','shadow_groove']),
  key:enumField(spec.keys), bpm:{type:Number,enum:spec.bpm}, suiteForm:enumField(Object.keys(spec.suiteForms)),
  leadPatch:enumField(spec.leadPatches), bassPatch:enumField(spec.bassPatches), arpPatch:enumField(spec.arpPatches),
  ...motifFields,
  performance:performanceField,
  extensions:{ profile:enumField(Object.keys(Extended.PROFILES)), motion:enumField(Extended.MOTION),
    depth:{type:Number,enum:Extended.DEPTHS}, transients:enumField(Extended.TRANSIENTS) },
  themes:Contracts.list({role:enumField(['reflective','danger','mortacia']),keyShift:{type:Number,enum:Array.from({length:14},(_,i)=>i-6)},...motifFields,performance:performanceField}),
  ambience:Contracts.list({tag:enumField(['wind','sandstorm','drips','fire','howls','chant','rumble','water']),level:{type:Number,minimum:0,maximum:1}})
};
function rhythm(value,label){
  const legal=Array.isArray(value)&&value.every(n=>[4,8,16].includes(n));
  const total=legal?value.reduce((n,d)=>n+16/d,0):null;
  if(legal&&value.length>=5&&value.length<=9&&total===16&&new Set(value).size>=2)return;
  const count=Array.isArray(value)&&value.length>=5&&value.length<=9?value.length:6, examples=[];
  function collect(cell,units){
    const left=count-cell.length;
    if(units+left>16||units+left*4<16)return;
    if(!left){if(units===16&&new Set(cell).size>=2)examples.push(cell);return;}
    for(const duration of[4,8,16])collect([...cell,duration],units+16/duration);
  }
  collect([],0);
  const difference=cell=>cell.reduce((n,d,i)=>n+(d===value?.[i]?0:1),0);
  examples.sort((a,b)=>difference(a)-difference(b));
  throw Error(`${label}: ${JSON.stringify(value)} totals ${total??'invalid'} units; exactly 16 required. 4=4 units, 8=2, 16=1. Use 5-9 events and two durations. Valid ${count}-event choices: ${examples.slice(0,2).map(v=>JSON.stringify(v)).join(' or ')}. Keep the matching contour length.`);
}
function choice(value,choices,label){if(!choices.includes(value))throw Error(label+': choose exactly '+choices.join(', '));}
function validateTheme(p,label){
  if(p.performance){
    for(const [field,choices]of Object.entries({groove:Grammar.GROOVES,harmonicRhythm:['bar','two_bars'],bassVariation:['steady','answering','interlock']}))
      choice(p.performance[field],choices,label+'.performance.'+field);
    const ops=p.performance.rhythmicDevelopment;
    if(!Array.isArray(ops)||ops.length<2||ops.length>4||new Set(ops).size!==ops.length||ops.some(op=>!Grammar.RHYTHMIC_OPS.includes(op)))
      throw Error(label+'.performance.rhythmicDevelopment: 2-4 distinct executable rhythm operations required.');
    if(ops.includes('diminish_repeat')&&p.motifRhythm?.includes(16))throw Error(label+': diminish_repeat needs a motif without sixteenths.');
  }
  for(const [field,choices]of Object.entries({mood:spec.moods,scale:spec.scales,progression:Object.keys(spec.progressions),bassStyle:spec.bassStyles,
    arpStyle:spec.arpStyles,phraseForm:spec.phraseForms,texture:spec.textures,percussion:PERCUSSION,register:['middle','high'],
    answerTransform:TRANSFORMS,contrastTransform:TRANSFORMS,leitmotif:['none','vary','quote']}))choice(p[field],choices,label+'.'+field);
  for(const field of['progression','contrastProgression']){
    choice(p[field],Object.keys(spec.progressions),label+'.'+field);
    if(!Theory.PROGRESSIONS[p[field]].modes.includes(p.scale))throw Error(label+'.'+field+': progression must support the selected mode.');
  }
  if(![-2,-1,1,2].includes(p.sequenceStep))throw Error(label+'.sequenceStep: exact signed scale step required.');
  choice(p.arrangementArc,spec.arrangementArcs,label+'.arrangementArc');
  if(!Array.isArray(p.developmentPath)||p.developmentPath.length<3||p.developmentPath.length>6||
    !p.developmentPath.every((op,i)=>TRANSFORMS.includes(op)&&(i===0||op!==p.developmentPath[i-1])))throw Error(label+'.developmentPath: 3-6 exact transform enums, without adjacent repeats.');
  for(const field of['frameArp','picardy'])if(typeof p[field]!=='boolean')throw Error(label+'.'+field+': boolean required.');
  if(p.percussion!=='none'&&(!p.frameArp||['drone','sparse'].includes(p.texture)))throw Error(label+': percussion needs frameArp and arpeggios/counterpoint texture.');
  const rhythmErrors=[];
  for(const field of['motifRhythm','answerRhythm','contrastRhythm']){
    try{rhythm(p[field],label+'.'+field);}catch(error){rhythmErrors.push(error.message);}
  }
  if(rhythmErrors.length)throw Error(rhythmErrors.join('\n'));
  const c=p.motifContour;
  if(!Array.isArray(c)||c.length!==p.motifRhythm.length||!c.every(n=>Number.isInteger(n)&&n>=-4&&n<=7)||c[0]!==0||new Set(c).size<3)
    throw Error(label+'.motifContour: match rhythm length, start at 0, use three distinct integer degrees within -4..7.');
  const intervals=c.slice(1).map((n,i)=>Math.abs(n-c[i]));
  if(intervals.some(n=>n>5)||intervals.filter(n=>n>=3).length>2)throw Error(label+'.motifContour: mostly steps, optionally one or two expressive leaps of 3-5 scale steps.');
  if(Math.max(...c)-Math.min(...c)>8||intervals.filter(n=>n===0).length>Math.floor(intervals.length/2))throw Error(label+'.motifContour: keep within eight scale steps and avoid excessive repeated notes.');
  if(p.contrastContour!==undefined){
    const b=p.contrastContour;
    if(!Array.isArray(b)||b.length!==p.contrastRhythm.length||b[0]!==0||new Set(b).size<3||
      b.some((n,i)=>!Number.isInteger(n)||n < -4||n>7||i>0&&Math.abs(n-b[i-1])>5)||Math.max(...b)-Math.min(...b)>8)
      throw Error(label+'.contrastContour: a singable second cell must start at zero, match contrastRhythm and stay within -4..7.');
  }
}
function motifOf(song){
  if(song.composition?.acceptedPlan)return song.composition.acceptedPlan;
  const p=song.plan||song,legacy=p.themes?.find(t=>t.role==='room');
  if(legacy?.motif){const[r,c]=legacy.motif.split('/');return{motifRhythm:r.split(',').map(Number),motifContour:c.split(',').map(Number)};}
  return p;
}
function motifSignature(p){
  const c=p.motifContour||[],r=p.motifRhythm||[];
  return digest([r,c.map(n=>n-(c[0]||0))]);
}
function recentSummaries(songs){
  return (songs||[]).slice(-8).map(s=>{
    const song=s.song||s,p=motifOf(song);
    return{roomKey:s.roomKey,title:song.title,key:song.key,scale:song.scale,bpm:song.bpm,
      motifRhythm:p.motifRhythm,motifContour:p.motifContour,phraseForm:p.phraseForm,texture:p.texture,suiteForm:p.suiteForm,
      leadPatch:p.leadPatch,bassPatch:p.bassPatch,arpPatch:p.arpPatch,bassStyle:p.bassStyle,arpStyle:p.arpStyle,
      progression:p.progression,contrastProgression:p.contrastProgression,performance:p.performance};
  });
}
function statementOf(song, startBar=4){
  let units=0;const statement=[];
  for(const s of Theory.expandVoice(song.voices[0])){
    if(s.cmd)continue;
    if(units>=startBar*16&&units<(startBar+1)*16)statement.push({pitch:s.note==='REST'?null:12*(s.octave+1)+spec.keys.indexOf(s.note),duration:s.duration});
    units+=16/s.duration;if(units>=(startBar+1)*16)break;
  }
  return statement;
}
function realizedMotifSignature(song){
  const cell=statementOf(song),first=cell.find(s=>s.pitch!==null)?.pitch||0;
  return digest(cell.map(s=>[s.pitch===null?null:s.pitch-first,s.duration]));
}
function validate(raw,recent=[]){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('A complete structured music plan is required.');
  for(const[field,max]of[['title',30],['rationale',360]])if(typeof raw[field]!=='string'||!raw[field].trim()||raw[field].length>max||/[\r\n<>]/.test(raw[field]))throw Error(field+': bounded single-line text required.');
  for(const[field,choices]of Object.entries({key:spec.keys,bpm:spec.bpm,suiteForm:Object.keys(spec.suiteForms),leadPatch:spec.leadPatches,bassPatch:spec.bassPatches,arpPatch:spec.arpPatches,style:parameters.style.enum}))choice(raw[field],choices,field);
  validateTheme(raw,'room');
  // Archived plans predate this optional palette; strict new generations include it.
  if(raw.extensions !== undefined)Extended.validate(raw.extensions);
  if(raw.percussion === 'none' && raw.extensions && raw.extensions.transients !== 'off')throw Error('extensions.transients must be off for a drumless score.');
  const wanted=spec.suiteForms[raw.suiteForm];
  if(!Array.isArray(raw.themes)||raw.themes.length!==wanted.length||new Set(raw.themes.map(t=>t.role)).size!==wanted.length||raw.themes.some(t=>!wanted.includes(t.role)))throw Error('themes must contain exactly the roles required by suiteForm, with no duplicates.');
  for(const t of raw.themes){validateTheme(t,t.role);if(!Number.isInteger(t.keyShift)||t.keyShift < -6||t.keyShift>7)throw Error(t.role+'.keyShift: -6..7 required.');}
  if(!Array.isArray(raw.ambience)||raw.ambience.length<1||raw.ambience.length>3||new Set(raw.ambience.map(a=>a.tag)).size!==raw.ambience.length||
    raw.ambience.some(a=>!parameters.ambience[0].type.tag.enum.includes(a.tag)||typeof a.level!=='number'||!Number.isFinite(a.level)||a.level<0||a.level>1))throw Error('ambience: 1-3 distinct valid tags with level 0..1. Quiet layers such as 0.1 are valid.');
  for(const p of recent)if(motifSignature(raw)===motifSignature(motifOf(p.song||p)))throw Error('The room motif repeats a recent song, even ignoring transposition. Compose a different rhythmic/interval cell, not just a new key or title.');
  Diversity.check(raw,recent);
  if(motifSignature(raw)===motifSignature({motifRhythm:Theory.LEITMOTIF.rhythm,motifContour:Theory.LEITMOTIF.contour}))throw Error('Do not replace this room\'s identity with the shared Mortacia motif. Use a new motif; a lore quote can appear separately.');
  return raw;
}
function transform(contour,operation,count,step){
  choice(operation,TRANSFORMS,'development operation');
  return Theory.developContour(contour,operation,count,step);
}
function develop(raw){
  const p={...raw,compositionVersion:3};
  if(raw.performance || !['sentence','period','arch','call_response','ostinato'].includes(raw.phraseForm))
    p.performance=structuredClone(raw.performance||Grammar.DEFAULT);
  // Select complete harmonic paths, not independent random chord roots.
  p.harmonyA=Theory.PROGRESSIONS[p.progression].A.map(String);
  p.harmonyB=Theory.PROGRESSIONS[p.contrastProgression].B.map(String);
  p.answerContour=transform(p.motifContour,p.answerTransform,p.answerRhythm.length,p.sequenceStep);
  p.contrastContour=p.performance&&raw.contrastContour?raw.contrastContour.slice():transform(p.motifContour,p.contrastTransform,p.contrastRhythm.length,-p.sequenceStep);
  if(p.performance&&raw.contrastContour)p.authoredContrastContour=raw.contrastContour.slice();
  p.themes=(raw.themes||[]).map(t=>develop({...t,themes:[]}));
  return p;
}
function assertScore(song){
  if(song.voices.length!==3)throw Error('Exactly three SID voices required.');
  const lengths=[];
  for(const v of song.voices){
    if(v.patterns.length>250||v.order.length>4000)throw Error('SID pattern/order memory exceeded.');
    let units=0;
    for(const index of v.order){
      const b=v.patterns[index];if(!b?.length||b.length>60)throw Error('Invalid tracker pattern.');
      let n=0;
      for(const s of b){if(s.cmd)continue;if(![1,2,4,8,16].includes(s.duration)||!['REST',...spec.keys].includes(s.note)||
        s.note!=='REST'&&(!Number.isInteger(s.octave)||s.octave<2||s.octave>5))throw Error('Invalid SID note, duration or voice range.');n+=16/s.duration;}
      if(n!==0&&n!==16)throw Error('Every musical pattern must fill one shared 16-unit bar.');units+=n;
    }
    lengths.push(units);
  }
  if(!lengths[0]||new Set(lengths).size!==1||lengths[0]!==song.plan.bars*16)throw Error('SID voices drift: unequal musical lengths.');
  // Judge the realized statement after chord snapping, not just its requested contour.
  for(const theme of song.plan.themes){
    const statement=statementOf(song,theme.startBar+(theme.sections[0]==='intro'?4:0)).filter(s=>s.pitch!==null).map(s=>s.pitch);
    if(new Set(statement).size<3||Math.max(...statement)-Math.min(...statement)<5)throw Error('The realized '+theme.role+' motif flattened after chord anchoring: use a more distinct, singable contour.');
  }
  return song;
}
function suiteChoices(context = {}) {
  return Object.keys(spec.suiteForms).filter(form => !(context.plane || context.portal) || spec.suiteForms[form].length > 0);
}
async function generate($,{description='',roomKey='',runId='',context={},recent=[]}={}){
  const seed=`${runId}|${roomKey}|${description}`;
  const diversity=Diversity.brief(seed,spec,recent);
  if (context.plane || context.portal) await $.user`PORTAL / PLANAR SUITE WORK ORDER. This room must receive a complete, original multi-movement SID exploration suite, not a single_theme or the preceding room's song. Choose suiteForm only from ${suiteChoices(context).join(', ')}. Keep the existing arranger, enum grammar, diversity rotation and complete three-voice 8580 core plus optional 10582 layer. No new register effects or extra voices are implied.
Score the actual supplied room and realm: the purple arch may suggest a threshold gesture, while the plane's terrain, inhabitants and concerns determine the body, contrast and return. YOU choose mode, timbres, rhythm, themes and arc; do not make every portal an identical crystalline arpeggio. When plane data is supplied, it overrides the default Tartarus/Hades narrative: an unaware or independent culture needs its own musical identity, not a mandatory Mortacia lament, war march or victory theme. A portal in Tartarus is still its established local setting; do not invent an alien landscape on this side of the arch. This work order controls suite form, not a claim that narrative events have occurred.`;
  await $.system`Compose original, coherent Commodore-64-style dark-fantasy room music, not imitations of an existing tune. The player may be Mortacia, Suzerain or the Children of the Grave. The arc is exile from Hades, Mortacia's lost Sepulchra, Dantuea's rising undead, Arithus's occupation, and the struggle to restore judgment and balance. Score this PLACE and the current aspiration, not the same lament merely because Mortacia is present. Supplied planar identity takes precedence for unrelated realms beyond Tartarus: their inhabitants and culture need not know or participate in that war. A portal/planar suite work order requires a multi-movement form from its narrowed enum; ordinary rooms keep every form choice.
The proven arranger owns chord-tone anchoring, voice ranges, synchronized tracker cells, gate articulation, bass/arp execution and motif development. You compose the room's short rhythmic/scale-degree cell, harmony and explicit development enums. NEVER write assembly, every note of a ten-minute song, or prose instructions for the arranger to interpret. Rationale is display/log metadata, never executable music.
Use the nostalgic range of SID writing: modal processions, chamber counterpoint, folk dances, spare lament, driving ostinato, crystalline arpeggios and syncopated shadow grooves. Original melodies only; do not borrow a game's tune. The same patch bank and timing engine stay in use. Build a memorable statement, an answer and contrast from it, not random unrelated bars. A rest still occupies the shared grid.
Durations are denominators: 4=quarter=4 units, 8=eighth=2, 16=sixteenth=1. EACH rhythm totals exactly 16, 5-9 events, with at least two lengths. Contour starts at zero, mostly steps, optionally one or two leaps of 3-5 scale steps, offsets -4..7. Stepwise melodies need no mandatory leap. Example rhythms are [8,8,4,8,8,4] and [4,8,8,4,4]; invent a fitting contour. Choose answer/contrast transforms ONLY from the enumerated set. They are executed directly, never parsed as sentences.
Modes: minor sorrow/resolve; Dorian noble/modal; Phrygian menace; Lydian wonder; Mixolydian communal/folk; major warmth or triumph. Key and tempo choices are honored, not silently randomized. Choose progression and contrastProgression from the vetted harmonic paths, BOTH compatible with the mode. The arranger uses the first path's A and the contrast path's B, with half/full cadences, tonic returns and dominant turnarounds. No arbitrary chord sequences. Scale and patch/register matter more than a mystical emotional meaning attached to a key name. Keep the motif mostly stepwise with a recognizable rhythm; avoid zigzagging or constant repeated pitches. Sentence/period/arch are tracker phrase templates inspired by those forms, not claims of strict classical formal analysis. Use a close transformation for the answer; reserve inversion/retrograde or fragmentation for stronger contrast.
Texture drone/sparse is drumless; percussion needs frameArp=true and arpeggios or counterpoint. Do not give every shrine combat drums or every encounter the full Mortacia theme. Counterpoint is a delayed, harmonically re-anchored imitation, not a second unrelated melody. Make the bass's repeating rhythmic cell support the lead rather than chase every lead note.
Arrangement can carry a fantasy score with a simple timbral palette: a clear foreground, interlocking rhythmic parts, articulated short notes and strategically changing density. Other rooms can use moving pulse colors and changes of texture. Do not confuse constant fast arpeggios, extra noise hits or complicated contours with better composition. Give the foreground space to be heard, and make the contrast lead somewhere before returning home. Do not reproduce melodies from reference games.
Music and environmental ambience are independently switchable layers. Compose a complete three-voice song that works without ambience, and choose 1-3 distinct ambience tags with levels from 0 to 1 (quiet layers such as 0.1 are valid). Ambience should evoke this place on its own without carrying an essential missing musical part. While both play, the ambience engine follows the song's key and movement timing; use restrained layers that leave space for the foreground.
Also choose an extensions palette for players who enable our custom emulated 10582: reed_resonance adds a woody resonator; spectral_choir a breath-shaped sacred halo; glass_halo a crystalline resonance; ember_air a restrained noisy resonance. motion is still, breath or phrase; depth is 0.15, 0.25 or 0.4; transients is off, soft or crisp. These enums drive actual 10582 registers for 8-bit levels, mute, fast burst envelopes, formant resonance and a soft output notch. This optional companion layer never replaces your melody, harmony, rhythm or the complete traditional SID arrangement. It is not stock C64 hardware. Select restraint for quiet rooms; do not add percussion via transients to a drumless score.
Choose a suiteForm appropriate to this room; it controls which extra themes are required. A single_theme score still develops for roughly ten minutes. Extra movements each have their own motif and choices; per-room SID instruments are shared across movements. Instrument palette: hollow/bright pulses and saw for urgency; flute/reed for modal or lyrical writing; plucked pulse and triangle for dance; bell/chime triangles for wonder. Do not default every song to the same key, rhythm, patch trio and suite. Return the strict Retort answer fields, no prose outside them.`;
  await $.user`Plan a ten-minute exploration arc, not a short loop padded to length. developmentPath is 3-6 ordered transformation enums, with no adjacent duplicates: each transforms the original motif for a development cycle. Keep the answer recognizable and use stronger transformations for contrast. arrangementArc controls long-range orchestration: gradual_reveal = spare opening, growing body, counterpoint, crest, withdrawal; ebb_and_flow = repeated spacious breathing and renewal; long_journey = two separated crests with a quiet middle. The first statement and final theme return remain identifiable. Dynamics here mean changes of register, note density and texture, not extra voices. These are executed templates, never free-form sentences.`;
  await $.user`The expanded arranger executes performance choices literally. groove: straight=eighth-note flow; offbeat=spaces on downbeats; tresillo=3+3+2 accents in 4/4; clave=spacious syncopation; held_rush=held opening then faster tail; motor=sixteenth ostinato. These are NOT changes to a 6/8 time signature. harmonicRhythm two_bars slows harmonic turnover; bar changes each bar. bassVariation answering leaves response gaps; interlock leaves weak lead onsets free. Rhythmic development: rotate moves the first event to the tail; augment_fragment doubles the first half-bar into a whole bar; diminish_repeat halves the whole cell and repeats it (only if the motif contains no sixteenths); displace delays it by an eighth; fragment_rest answers half a cell with half a bar of silence. Choose 2-4 distinct rhythm ops, not sentences. Original motif, answer and contrast still anchor the work.
Phrase cycles now differ in length: sentence/period/call_response/binary 8 bars; processional 6; asymmetric 10 (3+3+4); ostinato/rounded_binary 12; arch/rondo 16. All remain on a shared 4/4 grid. Pick a form that fits the setting, not arch in every dark room. Each extra movement also needs its own performance object. Instruments are still shared across movements. Include the required performance fields; archived plans without them use the old renderer.
This room's instrument shortlist is a deterministic rotation away from recent rooms, not a procedural replacement song. Choose leadPatch/bassPatch/arpPatch ONLY from these shortlists: ${JSON.stringify(diversity.allowed)}. The rest of the full patch list describes available sounds, not permission to ignore this rotation. Suggested unused rhythm cells (you may compose your own): ${JSON.stringify(diversity.startingRhythms)}. Avoid simply repeating this last recipe: ${JSON.stringify(diversity.avoidLastRecipe)}. Change actual foreground, rhythm, harmonic route and phrase behavior, not merely title/key.`;
  await $.user`ROOM ${roomKey}: ${String(description).slice(0,3500)}
Read-only setting and aspiration: ${JSON.stringify(context)}
Supported choices and suite roles: ${JSON.stringify({...spec,leitmotif:parameters.leitmotif.enum})}
Recent room identities to contrast with, without merely transposing: ${JSON.stringify(recentSummaries(recent))}
Provide title and a concise rationale tied to THIS room. All musical choices must use the provided enums. themes must contain exactly suiteForm's required roles (zero for single_theme).`;
  await $.user`Author contrastContour as a real second, singable cell matching contrastRhythm, starting at zero and using the same degree/leap bounds as the room motif. It may share an interval or gesture with the statement, but it need not be only its mechanical inversion. contrastTransform develops that cell later. Keep both identities recognizable. Style/rationale labels do not change the notes: the rhythm, contours and performance choices must carry the distinction.`;
  const roomParameters={...parameters,suiteForm:enumField(suiteChoices(context)),...Object.fromEntries(Object.entries(diversity.allowed).map(([field,choices])=>[field,enumField(choices)]))};
  const result=await Contracts.request($,{component:'sid-composition',context:{geoKey:roomKey,runId},parameters:roomParameters,maxTokens:4800,attempts:3,
    validate:value=>{
      const accepted=validate(value,recent);
      if (!suiteChoices(context).includes(accepted.suiteForm)) throw Error('Portal and planar rooms need a multi-movement suite, not single_theme.');
      Diversity.check(accepted,recent,diversity.allowed);
      const song=assertScore(Theory.arrangeSuite(develop(accepted),description,seed));
      if(recent.some(row=>(row.song||row).composition?.realizedMotifSignature===realizedMotifSignature(song)))
        throw Error('After chord anchoring, the melody still repeats a recent room. Change the rhythmic/interval cell, not just title or key.');
      return{accepted,song};
    }});
  if(!result.value)throw Error('SID composition failed validation; no procedural substitute was accepted: '+result.error?.message);
  const {accepted,song}=result.value;
  song.ambience=structuredClone(accepted.ambience);
  song.composition={version:VERSION,source:'llm-validated-plan',roomKey,runId,seed,attempt:result.attempt,
    acceptedPlan:structuredClone(accepted),diversityBrief:diversity,motifSignature:motifSignature(accepted),realizedMotifSignature:realizedMotifSignature(song),scoreSignature:digest(song.voices),
    responsibilities:{ai:'room motif, rhythm, modal harmony, patches, phrase form, texture and explicit development operations',
      arranger:'derived answer/contrast, voice leading, accompaniment, synchronization, articulation and tracker compilation'}};
  console.info('[SidComposition]',JSON.stringify({roomKey,title:song.title,style:accepted.style,form:accepted.suiteForm,
    motif:song.composition.motifSignature.slice(0,12),score:song.composition.scoreSignature.slice(0,12),analysis:song.analysis}));
  return song;
}
module.exports={VERSION,TRANSFORMS,parameters,validate,develop,transform,assertScore,generate,motifSignature,realizedMotifSignature,recentSummaries,suiteChoices};
