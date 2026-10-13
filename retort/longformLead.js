// longformLead.js — melody generator for retort/longformComposer.js (the user's melody rules: chord tones on strong beats,
// stepwise passing/neighbour motion, tendency tones, leaps recovered by step, arcs, rhythm first, motif development).
'use strict';
const OK=new Set([1,2,4,8]);
const RH=require('./longformRhythm.js');
// rhythms are generated per section (metric weights + groupings); sparse = few onsets for breathing sections
const genSparse=r=>{const on=new Array(16).fill(0);const p0=r()<0.25?4:0;on[p0]=1;if(r()<0.7)on[[8,12,6][Math.floor(r()*3)]]=1;const R=RH.toLeadRhythm(on);return p0?[-4,...R]:R;};
const PEAKS=[['Arrive',7],['Theme',12],['Move',14],['Breathe again',8],['Breathe',9],['Build',17],['Big transition',19],['Climax',22],['Descent',14],['Unfulfilled',15],['Coda',7]];
const peakOf=n=>{for(const [k,v] of PEAKS)if(n.startsWith(k))return v;return 12;};
const sum=a=>a.reduce((x,y)=>x+Math.abs(y),0), valid=a=>sum(a)===16&&a.every(u=>OK.has(Math.abs(u)));
function vary(R,op,r){let a=R.slice();
  if(op==='aug'){const o=[];for(let i=0;i<a.length;i+=2){const m=Math.abs(a[i])+Math.abs(a[i+1]||0);if(a[i+1]!=null&&OK.has(m))o.push(m);else{o.push(a[i]);if(a[i+1]!=null)o.push(a[i+1]);}}a=o;}
  if(op==='displace'){a=[-2,...a];let over=sum(a)-16;while(over>0){const l=a.pop();const u=Math.abs(l);if(u>over){a.push(u-over);over=0;}else over-=u;}}
  if(op==='sync'){for(let i=0;i<a.length-1;i++)if(a[i]===4&&a[i+1]===4){a.splice(i,2,2,4,2);break;}}
  if(op==='rest'){const i=1+Math.floor(r()*(a.length-1));if(a[i]>0)a[i]=-a[i];}
  if(op==='dim'){const i=a.indexOf(4);if(i>=0)a.splice(i,1,2,2);}
  return valid(a)?a:R.slice();}
const pc=m=>((m%12)+12)%12;
function makeLead(s,chords,ctx){
  const {r,tones,isMinorV,MOTIF}=ctx;const peak=peakOf(s.name),LO=67,sparse=/Breathe|Arrive|Coda/.test(s.name);
  const bars=[];const bank=s.leadBank||(s.leadBank=RH.leadBank(r,5,0.4,0.3));const R0=sparse?genSparse(r):bank[Math.floor(r()*bank.length)];
  const useMortacia=!!ctx.MOTIF&&!sparse;   // the song's theme (transformed per section by the composer) opens every phrase
  let motif=null; // {rhythm:[...2 bars], iv:[intervals]}
  let prev=ctx.prevNote||LO+5,leapDir=0;
  const ops=['seq','inv','widen','narrow','tail','orig'];const rops=['orig','sync','displace','aug','rest','dim'];
  const nPh=Math.ceil(s.bars/4);
  for(let ph=0;ph<nPh;ph++){
    const arc=Math.sin(Math.PI*(ph+0.5)/nPh); // section arc: middle phrases highest
    const pPeak=LO+Math.round(peak*(0.55+0.45*arc))+(s.metal?5:0);
    const antecedent=ph%2===0;
    for(let bi=0;bi<4&&ph*4+bi<s.bars;bi++){
      const bIdx=ph*4+bi,ch=chords[bIdx],k=ch.key;
      // scale for this bar: natural minor; harmonic (raised 7) on a major V; major on a major tonic (glint)
      let sc=[0,2,3,5,7,8,10];if(ch.q!=='m'&&pc(ch.root-k)===7)sc=[0,2,3,5,7,8,11];if(ch.q!=='m'&&pc(ch.root-k)===0)sc=[0,2,4,5,7,9,11];
      const pcs=sc.map(d=>pc(k+d)),ct=tones(ch).map(pc);
      const inScale=m=>pcs.includes(pc(m)),step=(m,d)=>{let x=m+d;while(!inScale(x))x+=d;return x;};
      // rhythm first
      let R;const cad=bi===3;
      if(sparse)R=(bIdx%2)?[-16].map(x=>x).flat():vary(R0,rops[(bIdx+ph)%rops.length],r);
      else if(cad)R=antecedent?[4,4,8]:[4,2,2,8];
      else R=vary(R0,rops[(bIdx*3+ph)%rops.length],r);
      if(sparse&&(bIdx%2)){bars.push([{rest:16}]);continue;}
      if(!valid(R))R=[-16].length&&sparse?[8,-8]:R0;
      // mortacia motif / section motif statement on bar 0-1 of each phrase (developed every time)
      let fixed=null;
      if(bi<2&&!sparse&&useMortacia&&MOTIF){const half=MOTIF.slice(bi*4,bi*4+4);R=half.map(x=>x[1]);fixed=half.map(x=>x[0]);
        // after the exposition (and at most one near-exact restatement) every return also changes its rhythm
        if(ctx.themeStatements>=2||!(ph===0&&ctx.themeOrig)){const i=Math.floor(r()*3);if(R[i]!==R[i+1]){[R[i],R[i+1]]=[R[i+1],R[i]];}else if(R[i]>=2&&R.length<6){/* keep */}}}
      else if(bi===0&&motif&&!sparse){R=motif.rhythm.slice();fixed='dev';}
      // contour target over the 4-bar phrase: arc (antecedent rises), wave (consequent falls)
      let pos=0;const out=[];let j=0;
      for(const u of R){
        if(u<0){out.push({rest:-u});pos+=-u;continue;}
        const t=(bi*16+pos)/64;const target=antecedent?LO+4+(pPeak-LO-4)*Math.sin(Math.PI*t*0.9):pPeak-(pPeak-LO-2)*t;
        let m;
        if(fixed&&fixed!=='dev'){ // Mortacia motif, transposed to the bar's key, op-varied per phrase
          let op=(ph===0&&ctx.themeOrig&&ctx.themeStatements<2)?'orig':ops[(ph+ctx.secIdx)%ops.length];if(op==='orig'&&!(ph===0&&ctx.themeOrig&&ctx.themeStatements<2))op=ops[(ph+ctx.secIdx+1)%5];if(bi===0&&j===0)ctx.themeStatements=(ctx.themeStatements||0)+1;let iv=fixed[j];out.themeOp=op;
          if(op==='inv'&&j>0)iv=-iv; if(op==='widen')iv=Math.round(iv*1.3); if(op==='narrow')iv=Math.round(iv*0.7);
          if(op==='tail'&&bi===1&&j>=2)iv=fixed[j]+ (r()<.5?-2:3);
          let base=LO+pc(k-LO)+(op==='seq'?(ph%3)*2:0)+(pPeak-LO>16?12:0);m=base+iv;if(!inScale(m))m=step(m,iv>=0?1:-1);
        } else if(fixed==='dev'){ const op=ops[(ph+ctx.secIdx+1)%ops.length];let iv=motif.iv[j]||0;
          if(op==='inv')iv=-iv;if(op==='widen')iv=Math.round(iv*1.4);if(op==='narrow')iv=Math.round(iv*0.6);
          m=(j===0?prev:prev)+ (j===0?0:iv); if(j===0){m=ct.map(c=>{let x=LO+pc(c-LO);while(x<target-6)x+=12;return x;}).sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0];}
          if(!inScale(m))m=step(m,iv>=0?1:-1);
        } else {
          const strong=pos%8===0;
          if(isMinorV(ch,k)&&pc(prev-k)===11)m=prev+1;                                  // raised 7 -> 1
          else if(pc(prev-k)===8&&!strong)m=step(prev,-1);                                // b6 -> 5
          else if(strong){const cands=[];for(let x=LO-2;x<=LO+23;x++)if(ct.includes(pc(x)))cands.push(x);
            m=cands.sort((a,b)=>(Math.abs(a-target)+Math.abs(a-prev)*0.4)-(Math.abs(b-target)+Math.abs(b-prev)*0.4))[0];}
          else if(leapDir){m=step(prev,-leapDir);leapDir=0;}                              // recover by step, opposite direction
          else if(r()<0.18){const d=target>=prev?1:-1;m=prev+d*[3,4,5,7][Math.floor(r()*4)];if(!inScale(m))m=step(m,d);leapDir=d;}
          else {const d=target>prev+1?1:target<prev-1?-1:(r()<.5?1:-1);m=step(prev,d);}   // passing / neighbour
        }
        m=Math.max(LO-2,Math.min(LO+23,m));
        out.push({m,u});prev=m;pos+=u;j++;
      }
      if(bi===0&&!motif&&!sparse){const ns=out.filter(x=>x.m!=null);motif={rhythm:R.slice(),iv:ns.map((x,i)=>i?x.m-ns[i-1].m:0)};}
      // final cadence note: antecedent on 5 or 2 (open); consequent on a chord tone, never tonic in unfulfilled/coda
      if(cad){const lastN=out.filter(x=>x.m!=null).pop();if(lastN){const want=antecedent?[7,2]:(/Unfulfilled|Coda|Climax/.test(s.name)?[3,7,2]:[0,3,7]);
        let best=lastN.m,bd=99;for(let x=lastN.m-5;x<=lastN.m+5;x++)if(want.includes(pc(x-k))&&Math.abs(x-lastN.m)<bd){bd=Math.abs(x-lastN.m);best=x;}lastN.m=best;}}
      bars.push(out);
    }
  }
  ctx.prevNote=prev;
  return bars;
}
module.exports={makeLead};
