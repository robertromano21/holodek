// longformHarmony.js — seeded original harmony for retort/longformComposer.js: modal mixture, borrowed chords, secondary
// dominants, chromatic mediants, deceptive cadences, all from weighted functional-harmony rules (no literal chord lists).
'use strict';
// chord vocabulary relative to a minor tonic k: [semitone offset, quality]
const V={i:[0,'m'],I:[0,'M'],ii0:[2,'dim'],II:[2,'M'],bII:[1,'M'],bIII:[3,'M'],iii:[3,'m'],III:[4,'M'],iv:[5,'m'],IV:[5,'M'],v:[7,'m'],V:[7,'M'],
  bVI:[8,'M'],VI:[9,'M'],vi:[9,'m'],bVII:[10,'M'],vii0:[11,'dim'],'V/iv':[0,'M'],'V/bVI':[3,'M'],'V/bIII':[10,'M'],'V/V':[2,'M']};
// transition weights (modal mixture, borrowed chords, secondary dominants, chromatic mediants)
const T={
  i:{iv:3,bVI:3,bVII:3,v:2,bIII:2,'V/iv':1,ii0:1,VI:0.6,III:0.5,bII:0.5},
  iv:{i:2,V:2,bVII:2,v:1.5,bVI:1,bII:0.7,IV:0.6,ii0:1},
  v:{bVI:3,i:1.5,iv:1.5,bVII:1},
  V:{i:3,bVI:2,vi:0.5,'V/iv':0.5},                 // deceptive bVI keeps hope unfulfilled
  bIII:{bVII:2,bVI:2,iv:2,'V/bVI':1,i:1},
  bVI:{bVII:3,iv:2,v:1.5,V:1.5,bIII:1,bII:1,i:1,III:0.4},
  bVII:{i:2,bIII:2,bVI:1.5,v:1.5,IV:1,iv:1},
  ii0:{V:4,v:1,i:0.5},
  'V/iv':{iv:5},'V/bVI':{bVI:5},'V/bIII':{bIII:4,i:1},'V/V':{V:4,v:1},
  bII:{V:3,i:1.5,v:1},IV:{i:2,bVII:2,v:1},VI:{ii0:1,iv:2,bVII:1,V:1},III:{bVI:2,iv:2,i:1},vi:{iv:2,ii0:1},I:{iv:3,bVI:2,bVII:2,IV:1},II:{V:3,bVII:1},iii:{iv:1,bVI:1},vii0:{i:3},
};
// no literal progressions: the user's harmonic tendencies (i->bVI, i->bVII, minor v) live only as weights in T
const SEEDS=[];
function wpick(r,obj){const e=Object.entries(obj);let t=e.reduce((a,[,w])=>a+w,0),x=r()*t;for(const [k,w] of e){if((x-=w)<=0)return k;}return e[0][0];}
const ch=(deg,k,over)=>({root:((k+V[deg][0])%12+12)%12,q:V[deg][1],key:k,deg,over});
// free phrase: n chords starting from `start`, last chord chosen to stay unresolved (open cadence)
function phrase(r,k,n,opts={}){const out=[];let d=opts.start||'i';
  for(let i=0;i<n;i++){out.push(ch(d,k));let nx=wpick(r,T[d]||T.i);
    if(i===n-2){const open=opts.cadence||{V:2,bVI:2,bVII:2,v:1.5,iv:1,bIII:0.6,i:0.4};const cand=Object.fromEntries(Object.entries(open).map(([c,w])=>[c,w*((T[d]||{})[c]?2:0.5)]));nx=wpick(r,cand);}
    d=nx;}
  return out;}
module.exports={V,T,SEEDS,phrase,ch,wpick};
