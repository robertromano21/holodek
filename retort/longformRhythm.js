// longformRhythm.js — original, generative rhythm for the long-form composer, built from general theory only:
// metric hierarchy (beat weights), additive groupings (3+3+2, 3+3+3+3+4 hemiola), syncopation by anticipation
// (an onset moved one 16th/8th ahead of a strong beat), displacement, and motif development (repeat, vary, fragment, cadence).
'use strict';
const W = [4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0];               // metric weight of each 16th in 4/4
const GROUPINGS = { 8:[[3,3,2],[2,3,3],[4,4],[3,5],[2,2,4],[4,2,2]], 16:[[3,3,3,3,4],[3,3,2,3,3,2],[4,4,4,4],[6,6,4],[3,3,4,3,3]] };
function cut(sz, r){ const opts=GROUPINGS[sz]; return opts[Math.floor(r()*opts.length)]; }
// a 16-slot onset cell. density 0..1, sync 0..1 (how often strong-beat onsets are anticipated)
// feel: 'gigue' (compound-triple: 3+3+3+3+4), 'saltarello' (3+3+2 lilt), 'minuet' (3-beat hemiola over 4: 6+6+4)
const FEEL = { gigue:[3,3,3,3,4], saltarello:[3,3,2,3,3,2], minuet:[6,6,4] };
function genCell(r, density, sync, feel){
  const g = FEEL[feel] || (r() < 0.4 ? cut(16,r) : [...cut(8,r), ...cut(8,r)]);
  const on = new Array(16).fill(0); let p = 0;
  for (const n of g) { on[p] = 1; if (n >= 4 && r() < density) on[p + 2 + (n > 4 && r()<0.5 ? 1 : 0)] = 1; p += n; }
  for (let i = 4; i < 16; i += 4) if (on[i] && !on[i-1] && W[i] >= 2 && r() < sync) { on[i] = 0; on[i - (r()<0.6?1:2)] = 1; }   // anticipation
  on[0] = 1;
  return on;
}
// develop a cell through a 4-bar phrase: statement, varied answer, statement, cadential fragment
function develop(cell, k, r){
  const c = cell.slice();
  if (k === 1) { const sh = r()<0.5 ? 2 : 3; const d = new Array(16).fill(0); c.forEach((v,i)=>{ if(v) d[(i+sh)%16]=1; }); d[0]=1; return d; }  // displacement
  if (k === 3) { for (let i = 8; i < 16; i++) c[i] = 0; c[8] = 1; if (r()<0.5) c[14] = 1; return c; }     // fragment + cadence
  if (k === 2 && r() < 0.5) { const i = [2,6,10,14].find(x=>!c[x]); if (i!=null) c[i]=1; }              // small elaboration
  return c;
}
const OK = [8,4,2,1];
function split(n){ const o=[]; for (const u of OK) while (n>=u) { o.push(u); n-=u; } return o; }
// onsets -> lead rhythm in the lead generator's format (positive = note, negative = rest; units 1/2/4/8 sixteenths)
function toLeadRhythm(on){
  const pos = []; on.forEach((v,i)=>{ if(v) pos.push(i); }); const out = [];
  pos.forEach((p,i)=>{ const len = (pos[i+1] ?? 16) - p; const note = len >= 8 ? 8 : len >= 4 ? 4 : len >= 2 ? 2 : 1;
    out.push(note); split(len-note).forEach(u=>out.push(-u)); });
  return out;
}
function leadBank(r, n, density, sync, feel){ const b=[]; for (let i=0;i<n;i++) b.push(toLeadRhythm(genCell(r,density,sync,feel))); return b; }
module.exports = { FEEL, genCell, develop, toLeadRhythm, leadBank, W };
