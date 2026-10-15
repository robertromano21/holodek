'use strict';
// Versioned, shared-grid development. Archived scores do not enter this path.
const GROOVES = ['straight','offbeat','tresillo','clave','held_rush','motor'];
const RHYTHMIC_OPS = ['rotate','augment_fragment','diminish_repeat','displace','fragment_rest'];
const FORMS = {
  sentence: [['A','SSSA'],['B','ACAA']],
  period: [['A','SASA'],['B','CASA']],
  arch: [['A','SSAA'],['B','CCAA'],['B','CCAA'],['A','SSAA']],
  call_response: [['A','S-A-'],['B','SACA']],
  ostinato: [['A','SSSA'],['A','SSCA'],['B','CCSA']],
  binary: [['A','SSAA'],['B','CCAA']],
  rounded_binary: [['A','SSAA'],['B','CCAA'],['A','SASA']],
  rondo: [['A','SASA'],['B','CCAA'],['A','SASA'],['B','CSCA']],
  asymmetric: [['A','SSA'],['B','CCA'],['A','SACA']],
  processional: [['A','SSA'],['B','CCA']]
};
const DEFAULT = { groove:'straight', harmonicRhythm:'bar', bassVariation:'steady', rhythmicDevelopment:['rotate','augment_fragment','fragment_rest'] };
const units = d => 16 / d;
const lengths = [16,8,4,2,1];
function cut(events, start, length) {
  const out = []; let at = 0;
  for (const ev of events) {
    let n = Math.max(0, Math.min(at + units(ev.d), start + length) - Math.max(at, start));
    for (const size of lengths) while (n >= size) { out.push({...ev,d:16/size}); n -= size; }
    at += units(ev.d);
  }
  return out;
}
function developCell(rhythm, contour, operation) {
  if (!RHYTHMIC_OPS.includes(operation)) throw Error('Unknown rhythmic development operation.');
  let events = rhythm.map((d,i)=>({d,c:contour[i % contour.length]}));
  if (operation === 'rotate') events = [...events.slice(1),events[0]];
  if (operation === 'augment_fragment') events = cut(events,0,8).map(e=>({...e,d:e.d/2}));
  if (operation === 'diminish_repeat') {
    if (rhythm.includes(16)) throw Error('diminish_repeat needs a motif without sixteenths: the player has no thirty-seconds.');
    const half = events.map(e=>({...e,d:e.d*2})); events = [...half,...half];
  }
  if (operation === 'displace') events = [{d:8,rest:true,c:0},...cut(events,0,14)];
  if (operation === 'fragment_rest') events = [...cut(events,0,8),{d:2,rest:true,c:0}];
  return { rhythm:events.map(e=>e.d), contour:events.map(e=>e.c), rests:events.map(e=>!!e.rest) };
}
function layout(p) {
  let at = 0;
  return FORMS[p.phraseForm].map(([part,cells])=>{ const s = {part,cells:[...cells],start:at}; at += cells.length; return s; });
}
// Durations and rests, not micro-timing: all parts keep the same sixteenth clock.
const CELLS = {
  straight: [[8,0],[8,1],[8,2],[8,1],[8,3],[8,1],[8,2],[8,0]],
  offbeat: [[8,null],[8,0],[8,null],[8,2],[8,null],[8,1],[8,3],[8,2]],
  tresillo: [[8,0],[16,null],[8,1],[16,null],[8,2],[8,0],[16,null],[8,3],[16,null],[8,2]],
  clave: [[4,0],[8,null],[8,2],[4,null],[8,1],[8,3]],
  held_rush: [[2,0],[8,1],[16,2],[16,1],[8,3],[16,2],[16,1]],
  motor: Array.from({length:16},(_,i)=>[16,[0,2,1,3][i%4]])
};
const BASS_CELLS = {
  syncopated: [[8,0],[16,null],[16,0],[8,2],[8,null],[8,3],[8,0],[8,null],[8,2]],
  march: [[4,0],[8,2],[8,0],[4,3],[8,2],[8,null]],
  broken_tenths: [[4,0],[8,1],[8,3],[4,2],[8,1],[8,null]],
  sustained: [[2,0],[4,2],[4,null]],
  tresillo: CELLS.tresillo,
  answering: [[4,0],[4,null],[8,2],[8,3],[4,0]]
};
function accompaniment(chords,p,section,engine) {
  const {midiToStep:note,REST,nearestPc,inRange,stepMidi} = engine, perf=p.performance;
  const bass=[],arp=[];
  const seqs={up:[0,1,2,3],updown:[0,1,2,3,2,1],alberti:[0,2,1,2],broken_octave:[0,3,1,3,2,3],rolling:[0,1,2,3,1,2],
    descending:[3,2,1,0],pendulum:[0,2,3,1],offbeat:[2,0,3,1],harp:[0,1,3,2,1,2]};
  const seq=seqs[p.arpStyle];
  chords.forEach((ch,i)=>{
    const root=inRange(36+ch.root,36,47),tones=[root,nearestPc(root+3,ch.pcs)+(p.bassStyle==='broken_tenths'?12:0),root+7,root+12];
    let bc = BASS_CELLS[p.bassStyle];
    if (!bc && perf.groove!=='straight') bc=CELLS[perf.groove];
    const applyGaps=bar=>{
      let pos=0;
      const onsets=new Set(); let t=0;
      for (const s of section.lead[i]) { if(s.note!=='REST')onsets.add(t); t+=units(s.duration); }
      return bar.map((s,n)=>{
        const interlock=perf.bassVariation==='interlock'&&pos%4!==0&&onsets.has(pos);
        const answering=perf.bassVariation==='answering'&&i%2===1&&n%3===1;
        pos+=units(s.duration);return interlock||answering?REST(s.duration):s;
      });
    };
    const bassBar=bc?bc.map(([d,k])=>k===null?REST(d):note(tones[k],d)):
      engine.toBars(engine.buildBass([ch],p.bassStyle,null,engine.scalePcs(p.key,p.scale)))[0];
    bass.push(applyGaps(bassBar));
    const low=inRange(48+ch.root,48,59), pitches=[low,nearestPc(low+3,ch.pcs),low+7,low+12];
    if (p.texture==='drone') { arp.push([note(low,2),note(low+7,2)]); return; }
    if ((p.texture==='counterpoint'||p.texture==='arpeggios'&&section.orchestration==='counterpoint') && section.part==='A' && i>0) {
      let pos=0;
      arp.push(section.lead[i-1].map(s=>{const strong=pos%8===0;pos+=units(s.duration);return s.note==='REST'?s:
        note(inRange(nearestPc(stepMidi(s)-12,strong?ch.pcs:engine.scalePcs(p.key,p.scale)),48,69),s.duration);})); return;
    }
    const thin=section.orchestration==='thin'||p.texture==='sparse';
    const pattern=thin?[[4,0],[4,null],[4,1],[4,null]]:CELLS[perf.groove];
    let pos=0;
    arp.push(pattern.map(([d,k],n)=>{
      const at=pos;pos+=units(d);
      if(k===null)return REST(d);
      const drums=p.percussion!=='none'&&!thin&&!['intro','coda'].includes(section.part)&&
        (p.percussion!=='sparse'||section.part==='B'&&i%2===1);
      if(drums&&(at===4||at===12||p.percussion==='driving'&&i%4===3&&at===15))
        return {note:'C',octave:5,duration:d,wave:'NOISE'};
      if(p.frameArp&&!thin){
        const offsets=[0,(ch.pcs[1]-ch.root+12)%12,7,12],index=seq[n%seq.length];
        const shape=[index,seq[(n+1)%seq.length],seq[(n+2)%seq.length]].map(k=>offsets[k]);
        return {...note(low,d),chord:shape};
      }
      return note(pitches[seq[n%seq.length]],d);
    }));
  });
  return {bass,arp};
}
function themeBody(p,r,opts,engine) {
  const {buildCycle,developContour,REST,scalePcs,chordFor,octaveUp,sparseLead}=engine;
  const prog={A:p.harmonyA.map(d=>d==='V'?d:Number(d)),B:p.harmonyB.map(d=>d==='V'?d:Number(d))};
  const main=buildCycle(p,r,prog,{startHigh:p.register==='high',seqStep:p.sequenceStep}),sections=[];
  const add=(name,chords,lead,part)=>sections.push({name,chords,lead,part});
  const append=(cycle,label)=>layout(p).forEach((group,i)=>add(label+(i?' '+(i+1):''),cycle.chords.slice(group.start,group.start+group.cells.length),
    cycle.lead.slice(group.start,group.start+group.cells.length),group.part));
  const cycleLength=main.chords.length, used=()=>sections.reduce((n,s)=>n+s.chords.length,0);
  const introCount=opts.intro===false?0:4,codaCount=opts.coda===false?0:4;
  const target=Math.max(introCount+cycleLength*2+codaCount,Math.round((opts.targetBars||64)/2)*2);
  if(introCount)add('intro',main.chords.slice(0,4),main.lead.slice(0,4).map((b,i)=>i<2?[REST(1)]:sparseLead(b)),'intro');
  append(main,'A');
  if(p.leitmotif==='quote'||p.leitmotif==='vary'){
    const quote=engine.loreQuote();add('Mortacia remembrance',quote.chords,quote.lead,'B');
  }
  let k=0;
  while(used()+cycleLength+codaCount<target){
    const index=k%p.developmentPath.length,op=p.performance.rhythmicDevelopment[k%p.performance.rhythmicDevelopment.length];
    const cell=developCell(p.motifRhythm,developContour(p.motifContour,p.developmentPath[index],p.motifRhythm.length,p.sequenceStep),op);
    const dev={...p,motifRhythm:cell.rhythm,motifContour:cell.contour,motifRests:cell.rests,
      answerContour:developContour(cell.contour,p.answerTransform,p.answerRhythm.length,p.sequenceStep),
      contrastContour:developContour(p.authoredContrastContour||cell.contour,p.contrastTransform,p.contrastRhythm.length,-p.sequenceStep)};
    const cycle=buildCycle(dev,r,prog,{startHigh:k%2?p.register==='high':p.register!=='high',seqStep:p.sequenceStep});
    const remain=target-used()-cycleLength-codaCount;
    if(remain<cycleLength){add('link '+op,cycle.chords.slice(0,remain),cycle.lead.slice(0,remain),'B');break;}
    append(cycle,'development '+p.developmentPath[index]+' / '+op);k++;
  }
  append(main,'theme return');
  if(codaCount){const ch=main.chords.slice(-4);ch[3]=chordFor(['major','lydian','mixolydian'].includes(p.scale)?4:'V',p.key,p.scale);
    add('coda',ch,main.lead.slice(-4).map((b,i)=>i===3?[REST(1)]:sparseLead(b)),'coda');}
  const arc=engine.arcs[p.arrangementArc];
  sections.forEach((s,i)=>{
    s.orchestration=['intro','coda'].includes(s.part)?'thin':arc[Math.min(7,Math.floor(i/sections.length*8))];
    if(s.name==='A')s.orchestration='full';
    if(s.orchestration==='thin'&&!['intro','coda'].includes(s.part))s.lead=s.lead.map((b,j)=>j%2?sparseLead(b):[REST(1)]);
    if(s.orchestration==='crest')s.lead=s.lead.map(octaveUp);
  });
  const bassBars=[],arpBars=[];
  for(const section of sections){const acc=accompaniment(section.chords,p,section,engine);bassBars.push(...acc.bass);arpBars.push(...acc.arp);}
  return {sections,leadBars:sections.flatMap(s=>s.lead),bassBars,arpBars,prog,main,sc:scalePcs(p.key,p.scale)};
}
module.exports={GROOVES,RHYTHMIC_OPS,FORMS,DEFAULT,layout,developCell,accompaniment,themeBody};
