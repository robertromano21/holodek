// longformComposer.js — ~10-minute long-form room scores in the user's style (approved prototype v3, 2026-10-13).
// One developed theme per piece; sections that arrive, move forward, breathe, build and make big transitions;
// original seeded harmony (longformHarmony.js); rules-based melody (longformLead.js); composed bass lines and a
// voice 3 that alternates frame-arpeggio chords with noise drums or plays a counter-melody (original generative syncopation).
// Instruments, key and tempo come from the engine's own chooser (sidMusicTheory.arrangeSuite), so nothing changes there.
// Output: the same arrangement JSON renderAudio.js / renderSid_poke.js already play (patterns + order lists).
'use strict';
const RH = require('./longformRhythm.js');
const SMT = require('./sidMusicTheory.js');
const H = require('./longformHarmony.js');
const { makeLead } = require('./longformLead.js');
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function rng(seed){let s=(seed>>>0)||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const pc = m => ((m%12)+12)%12;
// 6502 player range: octaves 2..5 (C2..B5)
const st = (midi,d) => { midi=Math.round(midi); while(midi>83) midi-=12; while(midi<36) midi+=12; return { note:NOTES[midi%12], octave:Math.floor(midi/12)-1, duration:d }; };
const REST = d => ({ note:'REST', octave:0, duration:d });
const UNIT = { 1:16, 2:8, 4:4, 8:2, 16:1 };       // duration code -> 16th units (1 = whole, 2 = half: held notes)
function emit(m,u,out,x,hold){                     // hold: long notes as one held step (whole/half) instead of re-strikes
  if(hold&&m!=null){ if(u>=16){out.push({...st(m,1),...x});u-=16;} if(u>=8){out.push({...st(m,2),...x});u-=8;} }
  while(u>=4){out.push(m==null?REST(4):{...st(m,4),...x});u-=4;} if(u>=2){out.push(m==null?REST(8):{...st(m,8),...x});u-=2;} if(u>=1)out.push(m==null?REST(16):{...st(m,16),...x}); }
function fitBar(o){let u=0;const r=[];for(const x of o){if(u+UNIT[x.duration]>16)break;r.push(x);u+=UNIT[x.duration];}while(u<16){r.push(REST(16));u++;}return r;}
const tones = c => ({ m:[0,3,7], M:[0,4,7], dim:[0,3,6] }[c.q]).map(i=>c.root+i);

// Section plans at 96 bpm (240 bars = 10 min); scaled to the song's tempo.
const PLANS = {
  // exploration / wasteland: melancholy, spacious, mostly drumless, never fatiguing; no metal
  explore: [
    {name:'Arrive',bars:16,h:'pedal',per:2,rhythm:'thin',bass:'pedal'},
    {name:'Theme',bars:32,h:'free',per:1,rhythm:'soft',bass:'melodic',wander:true},
    {name:'Breathe',bars:24,h:'pedal',per:2,rhythm:'thin',bass:'pedal'},
    {name:'Move forward',bars:32,h:'free',per:1,secondary:true,rhythm:'dance',bass:'walking'},
    {name:'Breathe again',bars:24,h:'pedal',per:2,rhythm:'thin',bass:'pedal'},
    {name:'Build',bars:24,h:'seqUp',rhythm:'soft',bass:'melodic'},
    {name:'Descent',bars:16,h:'seqDown',rhythm:'soft',bass:'walking'},
    {name:'Unfulfilled hope (mode turn)',bars:32,h:'major',per:1,rhythm:'soft',bass:'melodic'},
    {name:'Breathe',bars:24,h:'pedal',per:2,rhythm:'thin',bass:'pedal'},
    {name:'Coda',bars:16,h:'free',per:2,rhythm:'thin',bass:'pedal',end:true},
  ],
  // story / climax pieces (Mortacia, thrones, reveals): the approved v3 form, one metal moment
  story: [
    {name:'Arrive',bars:16,h:'pedal',per:2,rhythm:'thin',bass:'pedal'},
    {name:'Theme',bars:32,h:'free',per:1,rhythm:'pulse',bass:'melodic'},
    {name:'Move forward',bars:24,h:'free',per:1,secondary:true,rhythm:'dance',bass:'walking'},
    {name:'Breathe',bars:24,h:'pedal',per:2,rhythm:'thin',bass:'pedal'},
    {name:'Build',bars:24,h:'seqUp',rhythm:'drive',bass:'ostinato'},
    {name:'Big transition — metal moment',bars:12,h:'modulate',rhythm:'metal',bass:'gallop16',metal:true},
    {name:'Climax',bars:28,h:'free',key:'K2',per:1,drama:true,rhythm:'gallop',bass:'ostinato'},
    {name:'Descent',bars:16,h:'seqDown',rhythm:'drive',bass:'walking'},
    {name:'Unfulfilled hope (mode turn)',bars:24,h:'major',per:1,rhythm:'pulse',bass:'melodic'},
    {name:'Breathe again',bars:16,h:'pedal',per:2,rhythm:'thin',bass:'pedal'},
    {name:'Coda',bars:24,h:'free',per:2,rhythm:'thin',bass:'pedal',end:true},
  ],
  // combat: driving throughout, one metal moment, still breathes once
  combat: [
    {name:'Arrive',bars:8,h:'free',per:1,rhythm:'drive',bass:'ostinato'},
    {name:'Theme',bars:32,h:'free',per:1,drama:true,rhythm:'drive',bass:'ostinato'},
    {name:'Move forward',bars:32,h:'free',per:1,secondary:true,rhythm:'gallop',bass:'walking'},
    {name:'Breathe',bars:16,h:'pedal',per:2,rhythm:'thin',bass:'pedal'},
    {name:'Build',bars:24,h:'seqUp',rhythm:'drive',bass:'ostinato'},
    {name:'Big transition — metal moment',bars:16,h:'modulate',rhythm:'metal',bass:'gallop16',metal:true},
    {name:'Climax',bars:40,h:'free',key:'K2',per:1,drama:true,rhythm:'gallop',bass:'ostinato'},
    {name:'Descent',bars:24,h:'seqDown',rhythm:'drive',bass:'walking'},
    {name:'Theme',bars:32,h:'free',per:1,drama:true,rhythm:'drive',bass:'ostinato'},
    {name:'Coda',bars:16,h:'free',per:2,rhythm:'pulse',bass:'melodic',end:true},
  ],
};
// ---- room profile: the room description (+ creatures) and the LLM music plan, when present, mapped to musical
// parameters. Combined with the fresh nonce, so each song is inspired by its room and still new on every run.
const ROOM_RULES = [ // [regex, traits]
  [/\b(sand|dust|desert|waste|wasteland|barren|bones?|ruin|ash|empty|desolat|yellowish sky)/i, { breathe:1, density:-1, mode:'dorian', diss:0.9 }],
  [/\b(crypt|tomb|grave|catacomb|ossuary|undead|lich|wraith|shadow|darkness|abyss|blood|demon|fiend|corpse)/i, { menace:1, mode:'phrygian', diss:1.3, register:-1 }],
  [/\b(boss|horde|siege|attack|battle|arena|warlord|ambush|charg|war ?band|army)/i, { danger:2, build:1, density:1, diss:1.4, metal:1 }],
  [/\b(orc|troll|ogre|giant|dragon|beast|wolves|hound|monster|golem|minotaur)/i, { danger:1, build:1, density:1 }],
  [/\b(feast|tavern|inn|revel|festival|dance|danc|carnival|market|music|bard|ghosts? dance|spirits|celebrat|wedding)/i, { groove:2, density:1 }],
  [/\b(temple|shrine|altar|sacred|holy|chapel|cathedral|choir|prayer|blessing)/i, { breathe:1, mode:'dorian', diss:0.8, register:1 }],
  [/\b(crystal|star|glow|shimmer|wonder|fae|fairy|enchant|magic|arcane|aurora|light)/i, { wonder:1, mode:'lydian', register:1, diss:0.8 }],
  [/\b(throne|palace|royal|king|queen|crown|court|hall of)/i, { build:1, climax:1, register:0 }],
  [/\b(storm|thunder|lava|volcan|eruption|collapse|flood|fire)/i, { build:1, density:1, diss:1.2 }],
  [/\b(forest|river|meadow|road|path|trail|valley|mountain|cave|cavern|tunnel|corridor)/i, { wander:1, mode:'dorian' }],
  [/\b(mortacia|sepulchra|goddess of death|throne of the dead)/i, { longing:1, climax:1 }],
];
function roomProfile(description, plan, mood){
  const t = String(description||''), P = { breathe:0, groove:0, build:0, danger:0, density:0, diss:1, register:0, mode:null, metal:0, climax:0, longing:0, wonder:0, menace:0, wander:0, hits:[] };
  for (const [re, tr] of ROOM_RULES) if (re.test(t)) { P.hits.push(re.source.slice(5,40)); for (const [k,v] of Object.entries(tr)) {
      if (k==='mode') { if (!P.mode || k==='mode' && (tr.menace||tr.wonder)) P.mode=v; } else if (k==='diss') P.diss*=v; else P[k]+=v; } }
  if (plan && typeof plan==='object') {                             // the LLM plan, when present, refines the keyword reading
    if (plan.scale==='phrygian') P.mode='phrygian'; else if (plan.scale==='dorian') P.mode='dorian'; else if (plan.scale==='lydian') P.mode='lydian';
    if (plan.mood==='battle') P.danger+=1, P.metal+=1; if (plan.mood==='tavern') P.groove+=1; if (plan.mood==='throne') P.climax+=1;
    if (plan.mood==='sacred'||plan.mood==='sorrow') P.breathe+=1; }
  if (mood==='battle') P.danger+=1;
  P.density = Math.max(-1, Math.min(1, P.density)); P.register = Math.max(-1, Math.min(1, P.register)); P.diss = Math.max(0.5, Math.min(1.6, P.diss));
  P.metalOk = P.metal>0 || P.danger>=2;                              // the metal moment only for real combat / boss rooms
  P.emphasis = P.groove>=Math.max(P.build,P.breathe,1) ? 'groove' : P.build+P.danger>P.breathe ? 'build' : P.breathe ? 'breathe' : 'balanced';
  return P;
}
// apply the room profile to the section plan: emphasis stretches matching sections, groove turns some sections into
// dances, metal only where the room calls for it
function shapePlan(plan, prof, r){
  return plan.map(s0 => { const s={...s0};
    if (prof.emphasis==='groove' && /Theme|Unfulfilled|Descent/.test(s.name) && r()<0.6) { s.rhythm='dance'; s.bass='walking'; s.danceOverride=true; }
    if (prof.emphasis==='build' && /Build|Climax|Big transition/.test(s.name)) s.bars=Math.round(s.bars*1.3/4)*4;
    if (prof.emphasis==='breathe' && /Breathe|Arrive|Coda/.test(s.name)) s.bars=Math.round(s.bars*1.3/4)*4;
    if (prof.emphasis==='breathe' && /Build|Climax/.test(s.name)) s.bars=Math.max(8,Math.round(s.bars*0.8/4)*4);
    if (s.metal && prof.metalOk) s.bars=Math.min(s.bars, 8);
    if (s.metal && !prof.metalOk) { s.metal=false; s.name='Big transition'; s.rhythm='gallop'; s.bass='ostinato'; }
    return s; });
}

function pickPlan(text, mood){
  const t = String(text||'');
  if (/\b(mortacia|sepulchra|throne of the dead|goddess of death)\b/i.test(t)) return { kind:'story', motif:null, character:'longing', mortacia:true };
  if (mood==='battle' || /\b(boss|battle|arena|siege|horde|ambush)\b/i.test(t)) return { kind:'combat', motif:null };
  if (mood==='throne' || mood==='royal' || /\b(reveal|revelation|climax|final)\b/i.test(t)) return { kind:'story', motif:null };
  return { kind:'explore', motif:null };            // default: wandering the wastes
}
// section plan varies by seed: lengths stretch or shrink, middle sections reorder (build -> metal -> climax stays a
// block), an optional extra breathe / groove section, the first and last sections stay as frame
function varyPlan(plan, r){
  const first=plan[0], last=plan[plan.length-1], mid=plan.slice(1,-1).map(x=>({...x, bars:Math.max(8, Math.round(x.bars*(0.75+r()*0.5)/4)*4)}));
  const units=[]; for (let i=0;i<mid.length;i++){ if (/^Build/.test(mid[i].name)){ const u=[mid[i]]; while (mid[i+1] && (mid[i+1].metal || /^Climax/.test(mid[i+1].name))) u.push(mid[++i]); units.push(u); } else units.push([mid[i]]); }
  for (let k=0;k<2;k++) if (r()<0.6 && units.length>2) { const i=Math.floor(r()*(units.length-1)); if (!/Breathe/.test(units[i][0].name) || !/Breathe/.test(units[i+1][0].name)) [units[i],units[i+1]]=[units[i+1],units[i]]; }
  if (r()<0.4) { const extra = r()<0.5 ? {name:'Breathe',bars:12,h:'pedal',per:2,rhythm:'thin',bass:'pedal'} : {name:'Move forward',bars:16,h:'free',per:1,secondary:true,rhythm:'dance',bass:'walking'}; units.splice(1+Math.floor(r()*(units.length-1)),0,[extra]); }
  for (let i=1;i<units.length;i++) if (/Breathe/.test(units[i][0].name) && /Breathe/.test(units[i-1][0].name)) units[i][0]={...units[i][0], name:'Move forward', h:'free', per:1, secondary:true, rhythm:'dance', bass:'walking'};
  return [{...first}, ...units.flat(), {...last}];
}
function scalePlan(plan, totalBars){
  const base = plan.reduce((a,s)=>a+s.bars,0), k = totalBars/base;
  const out = plan.map(s => ({ ...s, bars: Math.max(4, Math.round(s.bars*k/4)*4) }));
  out[out.length-1].bars += totalBars - out.reduce((a,s)=>a+s.bars,0);
  if (out[out.length-1].bars < 4) out[out.length-1].bars = 4;
  return out;
}
function sectionChords(s,P,r){
  const k = s.key==='K2' ? P.K2 : P.K, out=[];
  if (s.h==='free'||s.h==='pedal'||s.h==='major') { let start='i';
    while (out.length < s.bars) { let ph;
      if (s.h==='major') { ph = H.phrase(r,k,4,{start: out.length?'IV':'I', seedP:0, cadence:{bVI:3,bVII:2,IV:1,v:1}}); ph = ph.map(c => c.deg==='i' ? H.ch('I',k) : c); }
      else ph = H.phrase(r,k,4,{start, seedP: s.wander?0.35:0.15, cadence: s.drama?{bII:1,V:2,bVI:2,IV:1}:undefined});
      if (s.secondary && r()<0.5) { const i=1+Math.floor(r()*3), tgt=ph[i];
        if (tgt && ['iv','bVI','bIII','V'].includes(tgt.deg)) ph[i-1] = H.ch({iv:'V/iv',bVI:'V/bVI',bIII:'V/bIII',V:'V/V'}[tgt.deg],k); }
      for (const c of ph) for (let j=0;j<(s.per||1);j++) out.push(s.h==='pedal'?{...c,over:k}:c);
      start = ['iv','bVI','bVII','i','bIII'][Math.floor(r()*5)]; }
  } else if (s.h==='seqUp'||s.h==='seqDown') {
    const c1=r()<0.6?'i':H.wpick(r,H.T.i), cell=[c1, H.wpick(r,H.T[c1]||H.T.i)];   // sequence cell from the weighted rules
    const stepI = s.h==='seqUp' ? [2,5,3][Math.floor(r()*3)] : -2; let kk = s.h==='seqUp' ? k : P.lastKey;
    while (out.length < s.bars) { for (let rep=0;rep<2;rep++) for (const d of cell) out.push(H.ch(d,kk)); kk=pc(kk+stepI);
      if (s.h==='seqDown' && pc(kk-P.K)===0) { while (out.length<s.bars) out.push(H.ch(out.length%2?'V':'i',P.K)); } }
    if (s.h==='seqDown') { out.length = s.bars; out[out.length-1] = H.ch('V',P.K); }   // land on home's dominant
  } else if (s.h==='modulate') {
    const k2=P.K2; out.push(...H.phrase(r,k,4,{cadence:{V:3,bVII:1,iv:1}}));                 // generated: phrase in home key -> dominant
    out.push(H.ch('V',k2)); out.push(...H.phrase(r,k2,Math.max(4,s.bars-5),{start:'i'}));      // pivot onto the new key's dominant, then a free phrase
    while (out.length < s.bars) out.push(H.ch(out.length%2?'V':'i',k2));
  }
  if (s.end) { out.length = Math.max(out.length, s.bars); const pen=H.wpick(r,{bVI:3,iv:2,bVII:2,V:1,bII:0.6}); out[s.bars-2]=H.ch(pen,k); out[s.bars-1]={...H.ch(H.wpick(r,{bVI:2,iv:2,i:1,bVII:1}),k),over:k}; }   // open, unresolved ending, chosen by weight
  const res = out.slice(0, s.bars); P.lastKey = res[res.length-1].key; return res;
}
// Fresh motif for every composition: two bars of four notes each (each bar fills 16 sixteenths), scale-degree walk with
// one expressive leap recovered by step, ending away from the tonic. character 'longing' (Mortacia scenes): a rising
// fifth or minor sixth then a falling sigh, minor colour, unresolved ending; 'drive' more steps and repeated notes.
const BAR4 = (()=>{ const o=[]; const U=[1,2,4,8]; for(const a of U)for(const b of U)for(const c of U)for(const d of U) if(a+b+c+d===16) o.push([a,b,c,d]); return o; })();
function seededMotif(r, character){
  const scales = { longing:[0,2,3,5,7,8,10], drive:[0,2,3,5,7,8,11], plain:[[0,2,3,5,7,8,10],[0,2,3,5,7,9,10],[0,1,3,5,7,8,10]][Math.floor(r()*3)] };
  const steps = scales[character] || scales.plain;
  const okBar = b => b[3] >= 2 && b.some(u=>u>=4);                    // phrase breathes: no 16th at bar end, one longer note
  const bars = BAR4.filter(okBar); const rh = [...bars[Math.floor(r()*bars.length)], ...bars[Math.floor(r()*bars.length)]];
  const leapAt = 1 + Math.floor(r()*3), deg = [Math.floor(r()*3)===0 ? 2 : 0];
  for (let i=1;i<8;i++) { let d;
    if (i===leapAt) d = character==='longing' ? (r()<0.5?4:5) : [3,4,-3,5][Math.floor(r()*4)];
    else if (i===leapAt+1) d = -Math.sign(deg[i-1]-deg[i-2]||1) * 1;    // recover the leap by step, opposite direction
    else d = character==='drive' && r()<0.3 ? 0 : [-1,1,-1,1,2,-2][Math.floor(r()*6)];
    deg.push(Math.max(-2, Math.min(9, deg[i-1]+d))); }
  if (((deg[7]%7)+7)%7===0) deg[7] += r()<0.5 ? 1 : -1;                 // never home at the end
  return rh.map((u,i)=>{ const d=deg[i]; return [steps[((d%7)+7)%7] + 12*Math.floor(d/7), u]; });
}


// Controlled dissonance (prepared and resolved, so it reads as intent): suspensions 4-3 / 9-8 / 7-6 prepared by the
// previous bar's last note and resolved down by step; appoggiaturas on strong beats leaning into chord tones; the b9
// over a major V in minor; chromatic minor-2nd leans when harsh. Amount by section: ~0 when breathing, a mild ache
// for longing / unfulfilled hope, harsher for build, combat, climax and the metal moment.
function dissonanceLevel(s, kind){
  if (/Breathe/.test(s.name) || s.rhythm==='thin') return { p:0.03, harsh:false };
  if (s.metal) return { p:0.5, harsh:true };
  if (/Climax|Build/.test(s.name) || kind==='combat') return { p:0.4, harsh:true };
  return { p:0.28, harsh:false };                                  // theme, move forward, descent, unfulfilled hope
}
const MINOR_PCS=[0,2,3,5,7,8,10];
function dissonate(lead, c, prevC, prevLast, D, r, k){
  if (!D.p) return lead;
  const out=lead.map(n=>({...n})), ct=tones(c).map(pc), isCT=m=>ct.includes(pc(m));
  const half=u=>({1:null,2:1,4:2,8:4}[u]);
  // 1) suspension at the downbeat: previous note held over, resolves down by step to a chord tone
  const f=out[0];
  if (f && !f.rest && prevLast!=null && half(f.u) && r()<D.p*1.2) {
    const below=[1,2].map(d=>prevLast-d).find(isCT);
    if (below!=null && !isCT(prevLast)) { out.splice(0,1,{m:prevLast,u:half(f.u)},{m:below,u:half(f.u)}); }
  }
  // 2) appoggiaturas / accented leans on strong beats (pos 0 and 8)
  let pos=0; const res=[];
  for (const n of out) {
    if (!n.rest && n.u>=4 && (pos%8===0) && isCT(n.m) && r()<D.p) {
      let lean;
      if (D.harsh && c.q==='M' && pc(c.root-k)===7 && pc(n.m-c.root)===0) lean=n.m+1;            // b9 over V -> root
      else if (D.harsh) lean = r()<0.5 ? n.m+1 : n.m-1;                                            // minor-2nd lean
      else { lean=n.m+2; if (MINOR_PCS.includes(pc(n.m+1-k))) lean=n.m+1; }                         // diatonic upper neighbour
      res.push({m:lean,u:half(n.u)},{m:n.m,u:half(n.u)});
    } else res.push(n);
    pos += n.rest || n.u;
  }
  return res;
}
// voice-3 chord colour: V7 / vii°7 tritones (resolving into the next chord), added-2nd and sus4->3 ache, clusters when harsh
function chordShape(c, k, D, beat, r){
  const base=tones(c).map(x=>x-c.root);
  if (c.q==='M' && pc(c.root-k)===7) return D.harsh && beat===0 ? [0,4,10] : [0,4,10];       // V7: 3rd-b7 tritone
  if (c.q==='dim') return [0,3,9];                                                              // vii°7 colour
  if (!D.p) return base;
  if (beat===0 && r()<D.p) return c.q==='m' ? [0,5,7] : [0,5,7];                                 // sus4 on the downbeat, 3rd follows
  if (D.harsh && r()<D.p*0.5) return [0,1,7];                                                   // b2 cluster (danger)
  if (r()<D.p*0.6) return [0,2,7];                                                              // added-2nd colour
  return base;
}

// syncopated bass: onsets from longformRhythm (generative cell developed per phrase); pitches by function:
// root on the downbeat, chord tones / octave elsewhere, chromatic or diatonic approach anticipating the next root.
function syncBass(c, nx, bm, cell, out, light){
  const on=[]; for (let i=0;i<16;i++) if (cell[i]) on.push(i);
  const nRoot=36+pc(nx.over!=null?nx.over:nx.root), cyc=[0,12,10,7,12,3];
  on.forEach((p,i)=>{ const len=(on[i+1]??16)-p; let m;
    if (p===0) m=bm; else if (p>=13 && nRoot!==bm) m=nRoot+(nRoot<bm-6?12:0);   // anticipation: next chord's root a 16th/8th early
    else if (p%8===6) m=bm+7; else m=bm+cyc[i%cyc.length];
    if (len>=4 && !light) { emit(m,len-1,out,null,true); emit(m-1,1,out); }      // fall-off on the last 16th
    else emit(m,len,out,null,true); });
}

// ---- drum dynamics: fixed SID volumes, so intensity = density, accents (noise length), rolls, voices in/out ----
const BASE_LVL = { thin:0, soft:0, pulse:1, dance:1, drive:2, gallop:3, metal:4 };
const WAVE = [0,0,0,0, 0,0,1,1, 1,2,2,2, 1,1,0,0];           // 16-bar crescendo (4-8 bars) -> roll at peak -> decrescendo
function dynLevel(s, b, kind){                                  // returns {lvl, roll}
  if (s.rhythm==='thin') return { lvl:0, roll:false };
  const base = BASE_LVL[s.rhythm] ?? 1, cap = s.climax ? 4 : (kind==='explore' ? 2 : 3);
  if (s.metal) return { lvl:4, roll: b===s.bars-1 };
  if (s.climax) { const pk = Math.max(0, s.bars-8); const up = b<pk ? Math.min(2, Math.floor(b/Math.max(1,pk/3))) : 3 - Math.floor((b-pk)/3); // build to the peak, all out, then thin back out
    return { lvl: Math.max(1, Math.min(cap, base - 1 + up + (b>=pk-4&&b<pk+2?1:0))), roll: b===pk-1 }; }
  const w = WAVE[(b + (s.waveOff||0)) % 16], lvl = Math.max(0, Math.min(cap, base + w));
  return { lvl, roll: (b + (s.waveOff||0)) % 16 === 11 };
}
function leadGrid(bar){ const g=new Array(16).fill(0); let u=0; for(const x of bar){ if(x.cmd) continue; if(x.note!=='REST'&&u<16) g[u]=1; u+=UNIT[x.duration]; } return g; }
// voice 3 interlocked with the lead: noise fills the lead's gaps (16th-level call and response); chord arps sit under lead onsets
function interlockDrums(g, lvl, roll, b, CH, NZ){
  const slot=new Array(16).fill('c'), gap=i=>!g[i];
  if (lvl===0) { if (b%4===3) { const i=[14,10,6].find(gap); if (i!=null) slot[i]='n'; } }
  else if (lvl===1) { let k=0; for (const i of [6,14,10,3,11]) if (gap(i) && k<2) { slot[i]='n'; k++; } }
  else if (lvl===2) { for (const i of [4,12]) if (gap(i)&&gap(i+1)) slot[i]='N'; for (const i of [3,6,10,14,15,7]) if (gap(i)&&slot[i-1]!=='N') slot[i]='n'; }
  else if (lvl===3) { for (let i=0;i<16;i++) if (gap(i)) slot[i]= (i===4||i===12)&&gap(i+1) ? 'N' : 'n'; for (let i=1;i<16;i++) if (slot[i-1]==='N') slot[i]='x'; }
  else { for (let i=0;i<16;i++) slot[i]= gap(i) ? (i%4===0&&gap(i+1)?'N':'n') : 'c'; for (let i=1;i<16;i++) if (slot[i-1]==='N') slot[i]='x'; }
  if (roll) { const from = lvl>=3 ? 8 : 12; for (let i=from;i<16;i++) slot[i]='n'; }
  const out=[]; for (let i=0;i<16;) { const t=slot[i];
    if (t==='N') { out.push(NZ(8)); i+= slot[i+1]==='x'?2:1; continue; }
    if (t==='n'||t==='x') { out.push(NZ(16)); i++; continue; }
    let j=i; while (j<16 && slot[j]==='c') j++; let run=j-i;
    while (run>0) { const u = run>=4&&i%4===0 ? 4 : run>=2&&i%2===0 ? 2 : 1; out.push(CH({4:4,2:8,1:16}[u])); i+=u; run-=u; } }
  return out;
}

// ---- per-section style blend (seeded), styles only, never borrowed notes ----
// baroque: invertible counterpoint (bass in contrary motion to the lead, chord tones on beats), pedal points, sequences
// medieval: modal colour (Dorian raised 6th / Phrygian flat 2nd in the lead), open-fifth drone bass, open-fifth voice 3
// arpMetal: slow-building arpeggiated minor progression over a bass descending by semitone each bar, layered crescendo
// dance: dark dance groove for the underworld spirits (gigue / saltarello / minuet feel), minor edge kept
function pickStyle(s, kind, r){
  const x=r(); if (s.danceOverride) return 'dance';
  if (/Build/.test(s.name)) return x < (kind==='explore'?0.45:0.75) ? 'arpMetal' : 'baroque';
  if (/Move/.test(s.name)) return 'dance';
  if (/Breathe|Arrive|Coda/.test(s.name)) return x<0.55 ? 'medieval' : 'baroque';
  if (s.metal || /Climax/.test(s.name)) return x<0.5 ? 'arpMetal' : 'baroque';
  return x<0.5 ? 'baroque' : (x<0.8 ? 'medieval' : 'dance');
}
function modal(lead, mode, k){ if (!mode) return lead;
  return lead.map(n=>{ if (n.rest) return n; const d=pc(n.m-k);
    if (mode==='phrygian' && d===2) return {...n, m:n.m-1};
    if (mode==='dorian' && d===8) return {...n, m:n.m+1};
    if (mode==='lydian' && d===5) return {...n, m:n.m+1};   // raised 4th glint
    return n; }); }

function compose({ plan = {}, description = '', seedStr = '', nonce } = {}, lengthScale = 1) {
  // a fresh random nonce per composition: every run and every new room gets a new song and a new theme
  if (nonce == null) nonce = require('crypto').randomBytes(8).toString('hex');
  const fullSeed = `${seedStr}|${nonce}`;
  // engine's own chooser for instruments (and a starting key / tempo within the mood band), freshly seeded
  const ref = SMT.arrangeSuite(plan || {}, description, fullSeed);
  const mood = SMT.detectMood(description);
  const pk = pickPlan(description, (plan && plan.mood) || mood);
  const prof = roomProfile(description, plan, mood);
  if (pk.kind==='explore' && (prof.danger>=2)) pk.kind='combat';
  if (pk.kind==='explore' && prof.climax) pk.kind='story';
  const r = rng(SMT.hash32('longform|' + fullSeed));
  const K = r() < 0.4 && NOTES.indexOf(ref.key) >= 0 ? NOTES.indexOf(ref.key) : Math.floor(r()*12);   // key varies by seed
  // the 6502 player accepts 96..144 bpm in steps of 8; pick within the room's band, varied by seed
  const BPMS=[96,104,112,120,128,136,144];
  const band = prof.emphasis==='groove' ? [120,144] : prof.emphasis==='breathe' ? [96,104] : prof.menace ? [96,112] : { explore:[96,128], story:[96,128], combat:[128,144] }[pk.kind];
  const inBand = BPMS.filter(x=>x>=band[0]&&x<=band[1]);
  const bpm = r() < 0.35 && inBand.includes(ref.bpm) ? ref.bpm : inBand[Math.floor(r()*inBand.length)];
  const totalBars = Math.round(bpm * 10 * lengthScale / 4 / 4) * 4;   // ~10 minutes (shorter only if the 6502 pattern limit demands)
  const P = { r, K, K2: (K + [5,7,3,2][Math.floor(r()*4)]) % 12, lastKey: K };
  const sections = scalePlan(shapePlan(varyPlan(PLANS[pk.kind], r), prof, r), totalBars);
  for (const s of sections) if (/Move|Build|Climax|Big transition/.test(s.name) || (pk.kind==='combat' && !/Breathe/.test(s.name))) { s.sync=true; s.syncLight = pk.kind==='explore'; const dn=s.syncLight?0.15:0.6, sy=s.syncLight?0.3:0.7;
      s.bcellBase = RH.genCell(r, dn, sy); s.leadBank = RH.leadBank(r, 5, s.syncLight?0.2:0.5, sy); }
  { let cl=sections.find(x=>/^Climax/.test(x.name)) || sections.find(x=>/Unfulfilled/.test(x.name)) || sections[Math.floor(sections.length*0.65)]; cl.climax=true;
    sections.forEach((x,i)=>{ x.waveOff = 2*i % 8; }); }   // every piece: waves + one big climax
  for (const x of sections) { x.style=pickStyle(x,pk.kind,r); if (x.style==='medieval') x.mode = r()<0.5?'dorian':'phrygian';
    if (x.style==='dance') { x.feel=['gigue','saltarello','minuet'][Math.floor(r()*3)]; x.sync=true; x.syncLight = x.syncLight ?? (pk.kind==='explore');
      x.bcellBase = RH.genCell(r, 0.4, 0.5, x.feel); x.leadBank = RH.leadBank(r, 5, 0.4, 0.5, x.feel); } }
  const motif = seededMotif(r, pk.character || (pk.kind==='combat' ? 'drive' : 'plain'));   // theme A: always freshly generated
  let motifB = seededMotif(r, 'plain'); if (motifB.filter(x=>x[1]<=2).length < motif.filter(x=>x[1]<=2).length) motifB = motifB.map(x=>x); // secondary idea
  motifB = motifB.map((x,i)=>[i ? -x[0] + motifB[0][0]*2 : x[0], x[1]]);                       // contrasting contour (mirror of its own line)
  const climaxNote = Math.max(...motif.map(x=>x[0]));
  // thematic development: which form of the theme each section states
  const themeFor = name => {
    const A=motif, inv=A.map((x,i)=>[i? 2*A[0][0]-x[0] : x[0], x[1]]), head=[...A.slice(0,4), ...A.slice(0,4).map(x=>[x[0]+ (r()<0.5?2:3), x[1]])];
    if (/^Theme/.test(name)) return { m:A, how:'statement', orig:true };
    if (/^Move/.test(name)) return { m:motifB, how:'secondary idea' };
    if (/^Build/.test(name)) return { m:head, how:'head motif, sequenced upward' };
    if (/^Big transition/.test(name)) return { m:head.map(x=>[x[0]+12,x[1]]), how:'head motif an octave up' };
    if (/^Climax/.test(name)) return { m:A.map(x=>[x[0]+(x[0]===climaxNote?2:0),x[1]]), how:'full theme, climax note pushed higher' };
    if (/^Descent/.test(name)) return { m:inv, how:'inversion' };
    if (/^Unfulfilled/.test(name)) return { m:A.map((x,i)=>[i===7||x[0]===climaxNote? x[0]-(i===7?1:2) : x[0], x[1]]), how:'return reaching short of the climax note' };
    if (/^Coda/.test(name)) return { m:A, how:'final return (counter-voice, open ending)' };
    return { m:A, how:'echo' };
  };
  const themeLog=[]; let themeBars=0, leadBars=0;
  const V=[[],[],[]], map=[], LCTX={ r, tones, isMinorV:(c,k)=>c.q!=='m'&&pc(c.root-k)===7, MOTIF:motif, secIdx:0, LO:60 + 3*prof.register, themeStatements:0 };
  let ornPrev=0, heavyBars=0, bar=0, ctrPrev=60, prevLast=null;
  for (const s of sections) {
    const chords = sectionChords(s,P,r);
    const TH = themeFor(s.name); LCTX.MOTIF = TH.m; LCTX.themeOrig = !!TH.orig;
    const LB = makeLead(s, chords, LCTX); LCTX.secIdx++;
    { const n=LB.filter(x=>x&&x.themeOp).length; themeBars+=n; leadBars+=s.bars; themeLog.push(`${s.name}: ${/Breathe|Arrive/.test(s.name)?'theme head in voice 3 (augmented)':TH.how}`); }
    const cell=[0]; for (let q=1;q<8;q++) cell.push(q%2 && r()<0.5 ? 0 : [12,7,10,3,5,0,-2][Math.floor(r()*7)]);   // generated ostinato: root anchors + chord / scale tones
    map.push({ name:s.name, startSec: Math.round(bar*4*60/bpm), bars:s.bars, rhythm:s.rhythm, climax:!!s.climax });
    // movement start: command-only bar (same instruments) = PSID subtune boundary for the parallel 1x render
    // evolving timbre: each section re-voices the patch (small seeded ADSR drift) and moves the filter: dark and still
    // when breathing, opening with a sweep while building, bright and resonant at the climax
    { const energy = s.metal ? 3 : s.climax ? 2.5 : /Build/.test(s.name) ? 2 : /Breathe|Arrive|Coda/.test(s.name) ? 0 : 1;
      const cut = Math.round(Math.min(2047, 260 + energy*380 + r()*260)), sweep = energy>=2 ? 1+Math.floor(r()*4) : energy===0 ? -Math.floor(r()*2) : Math.floor(r()*3)-1;
      const filt = { cmd:'filter', cutoff:cut, sweep, resonance: Math.min(15, 4 + Math.round(energy*2 + r()*4)), route: r()<0.5 ? [0] : [0,1] };
      ref.voices.forEach((rv,i) => { const a={...rv.adsr}; if (i===0) { a.release=Math.max(1,Math.min(12,a.release+Math.floor(r()*5)-2)); a.sustain=Math.max(4,Math.min(15,a.sustain+Math.floor(r()*3)-1)); }
        V[i].push(i===0 ? [{ cmd:'inst', waveform: rv.waveform, adsr:a }, filt] : [{ cmd:'inst', waveform: rv.waveform, adsr: { ...rv.adsr } }]); }); }
    for (let b=0;b<s.bars;b++) {
      const c=chords[b], nx=chords[b+1]||c, k=c.key, D0=dissonanceLevel(s,pk.kind), D={...D0, p:Math.min(0.6,D0.p*prof.diss), harsh:D0.harsh||prof.diss>1.25};
      const lead=modal(dissonate(LB[b]||[{rest:16}], c, chords[b-1], prevLast, D, r, k), s.mode || prof.mode, k);
      { const ns=lead.filter(n=>!n.rest); if (ns.length) prevLast=ns[ns.length-1].m; }
      if (ornPrev>0) ornPrev--;
      { const out=[]; let pos=0;                                    // lead with baroque turns and mordents, held long notes
        for (const n of lead) { if (n.rest) { emit(null,n.rest,out); pos+=n.rest; continue; }
          const up=n.m+2, dn=n.m-(pc(n.m-k)===0?1:2);
          if (n.u===8) { if (!ornPrev && r()<0.35) { ornPrev=2; const sh=Math.floor(r()*3);            // varied ornaments, never in consecutive bars
              if (sh===0) { emit(n.m,1,out); emit(up,1,out); emit(n.m,1,out); emit(dn,1,out); emit(n.m,4,out); }   // turn
              else if (sh===1) { emit(dn,1,out); emit(n.m,1,out); emit(n.m,6,out,null,true); }                      // lower appoggiatura
              else { emit(up,2,out); emit(n.m,6,out,null,true); } }                                               // upper lean
            else emit(n.m,8,out,null,true); }
          else if (n.u===4 && pos%8===0 && r()<0.18) { emit(n.m,1,out); emit(up,1,out); emit(n.m,2,out); }
          else emit(n.m,n.u,out); pos+=n.u; }
        V[0].push(fitBar(out)); }
      const leadBusy = lead.filter(n=>!n.rest).length, lastL = lead[lead.length-1]||{}, leadTailRest = lastL.rest || (lastL.u===8?8:0);
      { const out=[], root=c.over!=null?c.over:c.root; let bm=36+pc(root);  // composed bass (counterpoint to the lead)
        const nRoot=36+pc(nx.over!=null?nx.over:nx.root), T3=tones(c).map(x=>36+pc(x)), vr=Math.floor(b/4)%4;
        if (s.style==='arpMetal' && !s.metal) { const d=b%4; const pb=bm-d+(bm-d<36?12:0);            // descending semitone bass, one per bar
          if (b>=4 && b%4===0) emit(pb,16,out,null,true); else { emit(pb,8,out,null,true); emit(pb,4,out); emit(pb+12,4,out); } }
        else if (s.style==='medieval' && s.bass==='pedal') { emit(36+pc(k),8,out,null,true); emit(36+pc(k)+7,8,out,null,true); }   // open-fifth drone on the modal final
        else if (s.style==='baroque' && !s.sync && s.bass!=='gallop16') {                               // invertible line: contrary motion to the lead
          const ns=lead.filter(n=>!n.rest); let x=bm, prevL=ns.length?ns[0].m:60; const cand=T3.flatMap(v=>[v,v+12]);
          let pos=0; for (const n of lead) { if (n.rest) { pos+=n.rest; continue; } if (pos%4) { pos+=n.u; continue; }
            const dir=-Math.sign(n.m-prevL); prevL=n.m; const tgt=x+dir*3; x = pos===0 ? bm : cand.sort((a,b2)=>Math.abs(a-tgt)-Math.abs(b2-tgt))[0]; pos+=n.u;
            out.push({_pos:pos-n.u,m:x}); }
          const pts=out.splice(0); if (!pts.length) pts.push({_pos:0,m:bm}); if (pts[0]._pos) pts.unshift({_pos:0,m:bm});
          pts.forEach((q,i)=>emit(q.m,(pts[i+1]?._pos??16)-q._pos,out,null,true)); }
        else if (s.sync && s.bass!=='gallop16') { syncBass(c,nx,bm,RH.develop(s.bcellBase,b%4,r),out,s.syncLight); }
        else if (s.bass==='pedal') { if (leadTailRest>=4) { emit(bm,8,out,null,true); emit(bm+12,2,out); emit(bm+7,2,out); emit(bm+10,2,out); emit(bm+12,2,out); } else emit(bm,16,out,null,true); }
        else if (s.bass==='walking') { const t=[bm, T3[1]<bm?T3[1]+12:T3[1], T3[2]<bm?T3[2]+12:T3[2]]; [bm,t[1],t[2],nRoot+(nRoot>bm?-1:1)].forEach(x=>emit(x,4,out)); }
        else if (s.bass==='melodic') { const third=T3[1]+(T3[1]<bm?12:0);
          (leadBusy>4 ? [[bm,8],[bm+7,4],[third,4]] : [[bm,4],[bm+7,2],[bm+12,2],[bm+10,2],[bm+7,2],[third,2],[nRoot+(nRoot>bm?-1:1),2]]).forEach(([x,u])=>emit(x,u,out,null,true)); }
        else if (s.bass==='ostinato') { let cl=cell.slice(); if(vr===1) cl=cl.map((x,i)=>i===7?(nRoot-bm):x); if(vr===2) cl=cl.map(x=>x===12?10:x); if(vr===3) cl=[...cl.slice(4),...cl.slice(0,4)]; cl.forEach(x=>emit(bm+x,2,out)); }
        else { for (let i=0;i<16;i++) emit(i%4===3?bm+12:(i%8===6?bm+7:bm),1,out); }
        V[1].push(fitBar(out)); }
      { const out=[], t=tones(c), root=48+pc(c.root), iv=t.map(x=>x-c.root);   // voice 3: chords + drums, or counter-melody
        let beatI=0; let CH=u=>({...st(root,u),chord:chordShape(c,k,D,beatI++,r).map(x=>Math.max(0,Math.min(12,x)))}), NZ=u=>({note:'C',octave:5,duration:u,wave:'NOISE'});
        const R=s.rhythm, ph=Math.floor(b/4)%3, fill=b===s.bars-1&&!s.end&&R!=='thin'&&R!=='soft';
        const dyn0=dynLevel(s,b,pk.kind);
        // melancholy baseline: heavy (level 3+) only at the one climax peak; full heavy only in threat rooms
        const peakZone = s.climax && b >= s.bars-10 && b < s.bars-4;
        const cap = s.metal ? 4 : peakZone ? (prof.metalOk ? 4 : 3) : 2;
        const dyn={ ...dyn0, lvl: dyn0.lvl===0 ? 0 : Math.max(0, Math.min(cap, dyn0.lvl+prof.density)) };
        if (dyn.lvl>=3 || s.metal) heavyBars++;
        if (s.style==='medieval') { const C0=CH; CH=u=>({...C0(u),chord:[7,12,7]}); }
        if (s.style==='arpMetal' && dyn.lvl<3 && !fill) { for (let i=0;i<16;i++) out.push(CH(16)); if (dyn.lvl===2 && b%2) out.splice(14,2,NZ(8)); }
        else
        if (dyn.lvl===0 && (R==='thin'||ph===2)) { const lm=lead.filter(n=>!n.rest).map(n=>n.m), dir=lm.length>1?Math.sign(lm[lm.length-1]-lm[0]):0;
          let x=ctrPrev; const n=R==='thin'?2:4, u=R==='thin'?8:4;
          if (R==='thin' && b%4<2) { const hd=motif.slice(0,4); for (let q=0;q<2;q++) { const deg=hd[(b%2)*2+q][0]; let y=48+pc(k+deg); if (y>62) y-=12; emit(y,8,out,null,true); x=y; } ctrPrev=x; }   // theme head, augmented, in voice 3
          else
          for (let q=0;q<n;q++) { const cands=t.flatMap(v=>[36+pc(v)+12, 36+pc(v)+24]).filter(v=>v>=48&&v<=62); const tgt=x-dir*3; x=cands.sort((a,b2)=>Math.abs(a-tgt)-Math.abs(b2-tgt))[0]; emit(x,u,out,null,true); }
          ctrPrev=x; }
        else out.push(...interlockDrums(leadGrid(V[0][V[0].length-1]), dyn.lvl, dyn.roll||fill, b, CH, NZ));
        V[2].push(fitBar(out)); }
    }
    bar += s.bars;
  }
  // repetition check: identical consecutive 4-bar lead phrases are re-generated with two changes
  // (one note displaced by an octave = register, and a long note split into two = rhythm)
  let repFixed=0;
  { const L=V[0], key=i=>JSON.stringify(L.slice(i,i+4));
    for (let i=4;i+4<=L.length;i++) { if (L.slice(i,i+4).some(b=>b.every(x=>x.cmd))) continue;
      if (key(i)===key(i-4)) { repFixed++;
        const b0=L[i].map(x=>({...x})), n=b0.find(x=>!x.cmd&&x.note!=='REST'); if (n) n.octave = n.octave>=5 ? n.octave-1 : n.octave+1; L[i]=b0;
        const b2=L[i+2].map(x=>({...x})), j=b2.findIndex(x=>!x.cmd&&x.note!=='REST'&&(x.duration===4||x.duration===8));
        if (j>=0) { const d=b2[j].duration*2; b2.splice(j,1,{...b2[j],duration:d},{...b2[j],duration:d}); } L[i+2]=b2; } } }
  const pack = list => { const patterns=[],order=[],seen=new Map(); for(const b of list){const kk=JSON.stringify(b); if(!seen.has(kk)){seen.set(kk,patterns.length);patterns.push(b);} order.push(seen.get(kk));} return {patterns,order}; };
  const voices = ref.voices.map((rv,i) => ({ role:rv.role, waveform:rv.waveform, adsr:rv.adsr, pulseWidth:rv.pulseWidth, filter:rv.filter, pwmSpeed:rv.pwmSpeed, vibrato:rv.vibrato, ...pack(V[i]) }));
  const song = { bpm, key: ref.key, scale: 'minor', title: `${ref.title || 'Room'} (long-form)`, author: 'Holodek SID', voices,
    plan: { longform: true, themeDevelopment: themeLog, themeRecurrence: 0, heavyBars, heavyShare: 0, roomProfile: { emphasis:prof.emphasis, mode:prof.mode, density:prof.density, register:prof.register, dissonance:+prof.diss.toFixed(2), metal:prof.metalOk, climax:true, cues:prof.hits }, kind: pk.kind, mortaciaScene: !!pk.mortacia, nonce, motif, mood, sections: map, bars: bar, seconds: Math.round(bar*4*60/bpm),
            progressionLabel: `long-form ${pk.kind} (${sections.length} sections, second key ${NOTES[P.K2]})`, form: map.map(m=>m.name).join(' | ') } };
  song.plan.heavyShare = +(heavyBars/bar).toFixed(3); song.plan.themeRecurrence = +(themeBars/leadBars).toFixed(3); song.plan.repeatsRegenerated = repFixed;
  if (voices.some(v => v.patterns.length > 250)) {   // 6502 player: 255 unique patterns per voice
    if (lengthScale > 0.55) return compose({ plan, description, seedStr, nonce }, lengthScale - 0.1);
    throw new Error('longform: too many unique patterns for the 6502 player');
  }
  try { song.analysis = SMT.analyze(song); } catch { song.analysis = {}; }
  return song;
}
module.exports = { compose, PLANS, seededMotif };
